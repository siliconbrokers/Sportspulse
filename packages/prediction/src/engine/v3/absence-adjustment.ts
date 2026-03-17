/**
 * absence-adjustment.ts — Motor Predictivo V3: §T3-02 + §T3-03 Ajuste por ausencias.
 *
 * Spec: SP-MKT-T3-00 §6.2 + §SP-V4-13 (positional factors)
 *
 * Computa multiplicadores de lambda por equipo basado en:
 *   - Injuries/suspensions (InjuryRecord[])
 *   - Confirmed lineups que revelan ausencias adicionales de starters (ConfirmedLineupRecord[])
 *
 * Fórmula base (§SP-MKT-T3-00 §6.2, posición desconocida):
 *   absence_score = SUM(importance_i * typeWeight_i)
 *   typeWeight: INJURY/SUSPENSION → 1.0, DOUBTFUL → DOUBTFUL_WEIGHT (0.5)
 *   mult = clamp(1 - absence_score * ABSENCE_IMPACT_FACTOR, ABSENCE_MULT_MIN, 1.0)
 *
 * Fórmula con posición (§SP-V4-13):
 *   attack_score  = SUM(importance_i * typeWeight_i * POSITION_IMPACT[pos].attackFactor)
 *   defense_score = SUM(importance_i * typeWeight_i * POSITION_IMPACT[pos].defenseFactor)
 *   mult_attack  = clamp(1 - attack_score,  ABSENCE_MULT_MIN, 1.0)
 *   mult_defense = clamp(1 - defense_score, ABSENCE_MULT_MIN, 1.0)
 *
 *   mult_home = mult_attack_home  (lambda of goals SCORED by home team)
 *   mult_away = mult_attack_away  (lambda of goals SCORED by away team)
 *   mult_defense_home = defense multiplier for home team (affects lambda_away in v3-engine)
 *   mult_defense_away = defense multiplier for away team (affects lambda_home in v3-engine)
 *
 * Application in v3-engine.ts:
 *   lambda_home *= mult_attack_home * mult_defense_away
 *   lambda_away *= mult_attack_away * mult_defense_home
 *
 *   (home scores: home attack × away defense)
 *   (away scores: away attack × home defense)
 *
 * Backward compatibility:
 *   mult_home / mult_away are preserved for explanation output. When no positional
 *   data is available (lineup-only absences), ABSENCE_IMPACT_FACTOR is used uniformly
 *   and mult_attack === mult_defense (positional split unavailable).
 *
 * Detección via lineup:
 *   Para cada jugador en confirmedLineup.players con isRegularStarter=true:
 *     Si su playerName NO está en injuries[] del equipo → ausencia adicional detectada
 *     con importancia LINEUP_MISSING_STARTER_IMPORTANCE y posición del player record.
 *
 * Función pura. Sin IO. Determinista.
 */

import type { InjuryRecord, ConfirmedLineupRecord } from './types.js';
import {
  ABSENCE_IMPACT_FACTOR,
  ABSENCE_MULT_MIN,
  LINEUP_MISSING_STARTER_IMPORTANCE,
  DOUBTFUL_WEIGHT,
  POSITION_IMPACT,
} from './constants.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AbsenceMultiplierResult {
  /** Lambda multiplier for goals SCORED by home team (attack component). */
  mult_home: number;
  /** Lambda multiplier for goals SCORED by away team (attack component). */
  mult_away: number;
  /**
   * Defense multiplier for home team.
   * Applied to lambda_away in v3-engine: home defense absence → opponent scores more.
   * §SP-V4-13
   */
  mult_defense_home: number;
  /**
   * Defense multiplier for away team.
   * Applied to lambda_home in v3-engine: away defense absence → opponent scores more.
   * §SP-V4-13
   */
  mult_defense_away: number;
  applied: boolean;
  absence_score_home: number;
  absence_score_away: number;
  absence_count_home: number;
  absence_count_away: number;
  lineup_used_home: boolean;
  lineup_used_away: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Calcula la contribución de peso de un tipo de ausencia.
 * INJURY/SUSPENSION → 1.0, DOUBTFUL → DOUBTFUL_WEIGHT.
 */
function absenceTypeWeight(absenceType: InjuryRecord['absenceType']): number {
  return absenceType === 'DOUBTFUL' ? DOUBTFUL_WEIGHT : 1.0;
}

/**
 * Computa absence scores (attack + defense + unified) y count para un equipo dado.
 * §SP-V4-13: uses POSITION_IMPACT when position is known.
 *
 * @param teamId           ID del equipo.
 * @param injuries         Lista global de ausencias (todos los equipos).
 * @param confirmedLineup  Lineup confirmado del equipo (si existe).
 * @returns                { score, attackScore, defenseScore, count, lineupUsed }
 */
function computeTeamAbsenceScore(
  teamId: string,
  injuries: InjuryRecord[],
  confirmedLineup: ConfirmedLineupRecord | undefined,
): { score: number; attackScore: number; defenseScore: number; count: number; lineupUsed: boolean } {
  // Filtrar injuries del equipo
  const teamInjuries = injuries.filter((inj) => inj.teamId === teamId);

  let score = 0;
  let attackScore = 0;
  let defenseScore = 0;
  let count = teamInjuries.length;

  // Contribución de cada ausencia en injuries[]
  for (const inj of teamInjuries) {
    const typeW = absenceTypeWeight(inj.absenceType);
    const baseContrib = inj.importance * typeW;
    score += baseContrib;

    // §SP-V4-13: positional differentiation
    const posImpact = POSITION_IMPACT[inj.position];
    if (posImpact !== undefined) {
      // Scale by normalized positional factors (using ABSENCE_IMPACT_FACTOR as reference scale)
      // attackScore and defenseScore are raw sums — converted to multipliers below
      attackScore  += baseContrib * posImpact.attackFactor  / ABSENCE_IMPACT_FACTOR;
      defenseScore += baseContrib * posImpact.defenseFactor / ABSENCE_IMPACT_FACTOR;
    } else {
      // Unknown position: treat as uniform (backward compatible)
      attackScore  += baseContrib;
      defenseScore += baseContrib;
    }
  }

  // Set de nombres ya cubiertos por injuries (para evitar doble conteo)
  const injuredPlayerNames = new Set<string>(
    teamInjuries.map((inj) => inj.playerName),
  );

  let lineupUsed = false;

  if (confirmedLineup !== undefined) {
    // Detectar starters adicionales ausentes vía lineup:
    // Un jugador en confirmedLineup.players con isRegularStarter=true que NO está
    // en injuries[] es tratado como starter ausente adicional.
    for (const player of confirmedLineup.players) {
      if (!player.isRegularStarter) continue;
      // Si ya está en injuries[], no doble contar
      if (injuredPlayerNames.has(player.playerName)) {
        lineupUsed = true; // el lineup confirmó esta ausencia ya registrada
        continue;
      }
      // Starter adicional detectado solo por lineup (posición del player)
      lineupUsed = true;
      const lineupBaseContrib = LINEUP_MISSING_STARTER_IMPORTANCE;
      score += lineupBaseContrib;
      count++;

      // §SP-V4-13: use player's position from lineup if available
      const posImpact = POSITION_IMPACT[player.position];
      if (posImpact !== undefined) {
        attackScore  += lineupBaseContrib * posImpact.attackFactor  / ABSENCE_IMPACT_FACTOR;
        defenseScore += lineupBaseContrib * posImpact.defenseFactor / ABSENCE_IMPACT_FACTOR;
      } else {
        attackScore  += lineupBaseContrib;
        defenseScore += lineupBaseContrib;
      }
    }
  }

  return { score, attackScore, defenseScore, count, lineupUsed };
}

/** Clamp helper for multiplier floor/ceiling. */
function clampMult(raw: number): number {
  return Math.min(1.0, Math.max(ABSENCE_MULT_MIN, raw));
}

// ── Función exportada principal ───────────────────────────────────────────────

/**
 * Computa multiplicadores de lambda por ausencias (injuries + lineup) para ambos equipos.
 *
 * Cuando `injuries` y `confirmedLineups` son ambos undefined, retorna
 * { mult_home: 1.0, mult_away: 1.0, applied: false } sin efecto.
 *
 * Spec: SP-MKT-T3-00 §6.2 + §SP-V4-13
 *
 * Application in v3-engine.ts:
 *   lambda_home_final *= result.mult_home * result.mult_defense_away
 *   lambda_away_final *= result.mult_away * result.mult_defense_home
 */
export function computeAbsenceMultiplier(
  homeTeamId: string,
  awayTeamId: string,
  injuries: InjuryRecord[] | undefined,
  confirmedLineups: ConfirmedLineupRecord[] | undefined,
): AbsenceMultiplierResult {
  // Noop si no hay datos
  if (
    (injuries === undefined || injuries.length === 0) &&
    (confirmedLineups === undefined || confirmedLineups.length === 0)
  ) {
    return {
      mult_home: 1.0,
      mult_away: 1.0,
      mult_defense_home: 1.0,
      mult_defense_away: 1.0,
      applied: false,
      absence_score_home: 0,
      absence_score_away: 0,
      absence_count_home: 0,
      absence_count_away: 0,
      lineup_used_home: false,
      lineup_used_away: false,
    };
  }

  const injuriesArr = injuries ?? [];

  // Buscar lineup confirmado por equipo
  const homeLineup = confirmedLineups?.find((l) => l.teamId === homeTeamId);
  const awayLineup = confirmedLineups?.find((l) => l.teamId === awayTeamId);

  const homeResult = computeTeamAbsenceScore(homeTeamId, injuriesArr, homeLineup);
  const awayResult = computeTeamAbsenceScore(awayTeamId, injuriesArr, awayLineup);

  // §SP-V4-13: positional multipliers
  // attackScore/defenseScore are already scaled relative to ABSENCE_IMPACT_FACTOR,
  // so multiplying by ABSENCE_IMPACT_FACTOR gives the penalty in [0, 1] space.
  const mult_home         = clampMult(1 - homeResult.attackScore  * ABSENCE_IMPACT_FACTOR);
  const mult_away         = clampMult(1 - awayResult.attackScore  * ABSENCE_IMPACT_FACTOR);
  const mult_defense_home = clampMult(1 - homeResult.defenseScore * ABSENCE_IMPACT_FACTOR);
  const mult_defense_away = clampMult(1 - awayResult.defenseScore * ABSENCE_IMPACT_FACTOR);

  const applied = mult_home !== 1.0 || mult_away !== 1.0 || mult_defense_home !== 1.0 || mult_defense_away !== 1.0;

  return {
    mult_home,
    mult_away,
    mult_defense_home,
    mult_defense_away,
    applied,
    absence_score_home: homeResult.score,
    absence_score_away: awayResult.score,
    absence_count_home: homeResult.count,
    absence_count_away: awayResult.count,
    lineup_used_home: homeResult.lineupUsed,
    lineup_used_away: awayResult.lineupUsed,
  };
}

/**
 * absence-adjustment.ts — Motor Predictivo V3: §T3-02 + §T3-03 Ajuste por ausencias.
 *
 * Spec: SP-MKT-T3-00 §6.2
 *
 * Computa un multiplicador de lambda por equipo basado en:
 *   - Injuries/suspensions (InjuryRecord[])
 *   - Confirmed lineups que revelan ausencias adicionales de starters (ConfirmedLineupRecord[])
 *
 * Fórmula:
 *   absence_score = SUM(importance_i * typeWeight_i)
 *   typeWeight: INJURY/SUSPENSION → 1.0, DOUBTFUL → DOUBTFUL_WEIGHT (0.5)
 *   mult = clamp(1 - absence_score * ABSENCE_IMPACT_FACTOR, ABSENCE_MULT_MIN, 1.0)
 *
 * Detección via lineup:
 *   Para cada jugador en confirmedLineup.players con isRegularStarter=true:
 *     Si su playerName NO está en injuries[] del equipo → ausencia adicional detectada
 *     con importancia LINEUP_MISSING_STARTER_IMPORTANCE.
 *   Esto permite que el caller señalice starters ausentes incluyéndolos en el array
 *   del lineup con isRegularStarter=true aunque no estén en el XI activo.
 *   El caller convencional pasa en confirmedLineup.players los 11 titulares confirmados
 *   (isRegularStarter puede ser true/false). Los starters ausentes que el caller quiere
 *   que el engine detecte deben incluirse en injuries[] o marcarse de otra forma.
 *
 *   Nota: isRegularStarter=true en un jugador del lineup significa que el caller lo
 *   considera un starter habitual. Si el caller los incluye explícitamente en el array
 *   aunque no vayan a jugar (para señalizar su ausencia), el engine los detecta.
 *   Este es el mecanismo de T3-03a.
 *
 * Función pura. Sin IO. Determinista.
 */

import type { InjuryRecord, ConfirmedLineupRecord } from './types.js';
import {
  ABSENCE_IMPACT_FACTOR,
  ABSENCE_MULT_MIN,
  LINEUP_MISSING_STARTER_IMPORTANCE,
  DOUBTFUL_WEIGHT,
} from './constants.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AbsenceMultiplierResult {
  mult_home: number;
  mult_away: number;
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
 * Computa absence score y count para un equipo dado.
 *
 * @param teamId           ID del equipo.
 * @param injuries         Lista global de ausencias (todos los equipos).
 * @param confirmedLineup  Lineup confirmado del equipo (si existe).
 * @returns                { score, count, lineupUsed }
 */
function computeTeamAbsenceScore(
  teamId: string,
  injuries: InjuryRecord[],
  confirmedLineup: ConfirmedLineupRecord | undefined,
): { score: number; count: number; lineupUsed: boolean } {
  // Filtrar injuries del equipo
  const teamInjuries = injuries.filter((inj) => inj.teamId === teamId);

  let score = 0;
  let count = teamInjuries.length;

  // Contribución de cada ausencia en injuries[]
  for (const inj of teamInjuries) {
    score += inj.importance * absenceTypeWeight(inj.absenceType);
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
    // El caller señaliza starters ausentes incluyéndolos en el array del lineup
    // con isRegularStarter=true (aunque no estén en el XI activo).
    for (const player of confirmedLineup.players) {
      if (!player.isRegularStarter) continue;
      // Si ya está en injuries[], no doble contar
      if (injuredPlayerNames.has(player.playerName)) {
        lineupUsed = true; // el lineup confirmó esta ausencia ya registrada
        continue;
      }
      // Starter adicional detectado solo por lineup
      lineupUsed = true;
      score += LINEUP_MISSING_STARTER_IMPORTANCE;
      count++;
    }
  }

  return { score, count, lineupUsed };
}

// ── Función exportada principal ───────────────────────────────────────────────

/**
 * Computa multiplicadores de lambda por ausencias (injuries + lineup) para ambos equipos.
 *
 * Cuando `injuries` y `confirmedLineups` son ambos undefined, retorna
 * { mult_home: 1.0, mult_away: 1.0, applied: false } sin efecto.
 *
 * Spec: SP-MKT-T3-00 §6.2
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

  // Convertir scores a multiplicadores: §SP-MKT-T3-00 §6.2
  const rawMultHome = 1 - homeResult.score * ABSENCE_IMPACT_FACTOR;
  const rawMultAway = 1 - awayResult.score * ABSENCE_IMPACT_FACTOR;

  const mult_home = Math.min(1.0, Math.max(ABSENCE_MULT_MIN, rawMultHome));
  const mult_away = Math.min(1.0, Math.max(ABSENCE_MULT_MIN, rawMultAway));

  const applied = mult_home !== 1.0 || mult_away !== 1.0;

  return {
    mult_home,
    mult_away,
    applied,
    absence_score_home: homeResult.score,
    absence_score_away: awayResult.score,
    absence_count_home: homeResult.count,
    absence_count_away: awayResult.count,
    lineup_used_home: homeResult.lineupUsed,
    lineup_used_away: awayResult.lineupUsed,
  };
}

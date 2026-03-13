/**
 * rival-adjustment.ts — Ajuste por rival (§8).
 *
 * Corrige el sesgo de calendario: evalúa cada partido contra lo esperable
 * del rival, no en términos absolutos.
 *
 * Señal ofensiva  = goles_marcados / defensa_rival_baseline
 * Señal defensiva = goles_recibidos / ataque_rival_baseline
 * Valor neutro = 1.0 (rindió exactamente como se esperaba vs ese rival).
 *
 * Funciones puras. Sin IO.
 */

import type { V2MatchRecord, TeamStats, TeamPrior, LeagueBaselines, MatchSignal } from './types.js';

// ── Baseline del rival (§8.2) ─────────────────────────────────────────────────

/**
 * Obtiene el baseline de ataque/defensa del rival con degradación graceful.
 *
 * Orden de prioridad (§8.2):
 *   1. Tasa efectiva de la temporada actual (stats crudas)
 *   2. Prior del rival
 *   3. Baseline de liga
 *
 * El contexto (local/visitante del rival) determina qué índices usar.
 */
export function getRivalBaseline(
  opponentStats: TeamStats | null,
  opponentPrior: TeamPrior | null,
  leagueBaselines: LeagueBaselines,
  /** true si el rival es el equipo local en ESE partido. */
  opponentIsHome: boolean,
): { attack_baseline: number; defense_baseline: number } {
  // Opción 1: stats de temporada actual disponibles
  if (opponentStats && opponentStats.pj_total > 0) {
    if (opponentIsHome) {
      const attack =
        opponentStats.pj_home > 0
          ? opponentStats.gf_home / opponentStats.pj_home
          : opponentStats.gf_total / opponentStats.pj_total;
      const defense =
        opponentStats.pj_home > 0
          ? opponentStats.gc_home / opponentStats.pj_home
          : opponentStats.gc_total / opponentStats.pj_total;
      return { attack_baseline: attack, defense_baseline: defense };
    } else {
      const attack =
        opponentStats.pj_away > 0
          ? opponentStats.gf_away / opponentStats.pj_away
          : opponentStats.gf_total / opponentStats.pj_total;
      const defense =
        opponentStats.pj_away > 0
          ? opponentStats.gc_away / opponentStats.pj_away
          : opponentStats.gc_total / opponentStats.pj_total;
      return { attack_baseline: attack, defense_baseline: defense };
    }
  }

  // Opción 2: prior del rival disponible
  if (opponentPrior && opponentPrior.prior_quality !== 'NONE') {
    if (opponentIsHome) {
      return {
        attack_baseline: opponentPrior.attack_prior_home,
        defense_baseline: opponentPrior.defense_prior_home,
      };
    } else {
      return {
        attack_baseline: opponentPrior.attack_prior_away,
        defense_baseline: opponentPrior.defense_prior_away,
      };
    }
  }

  // Opción 3: baseline de liga
  if (opponentIsHome) {
    return {
      attack_baseline: leagueBaselines.league_home_goals_pg,
      defense_baseline: leagueBaselines.league_away_goals_pg,
    };
  } else {
    return {
      attack_baseline: leagueBaselines.league_away_goals_pg,
      defense_baseline: leagueBaselines.league_home_goals_pg,
    };
  }
}

// ── Señales por partido (§8.1) ────────────────────────────────────────────────

/**
 * Computa señales ofensiva/defensiva ajustadas por rival para cada partido.
 *
 * @param matches              Partidos de la temporada actual (anti-lookahead ya aplicado).
 * @param teamId               Equipo evaluado.
 * @param getOpponentContext   Función que devuelve baselines del rival dado su ID y contexto.
 */
export function computeMatchSignals(
  matches: V2MatchRecord[],
  teamId: string,
  getOpponentContext: (
    opponentId: string,
    opponentIsHome: boolean,
  ) => { attack_baseline: number; defense_baseline: number },
): MatchSignal[] {
  const signals: MatchSignal[] = [];

  for (const m of matches) {
    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;
    if (!isHome && !isAway) continue;

    const goalsScored = isHome ? m.homeGoals : m.awayGoals;
    const goalsConceded = isHome ? m.awayGoals : m.homeGoals;
    const opponentId = isHome ? m.awayTeamId : m.homeTeamId;
    const opponentIsHome = !isHome;

    const { attack_baseline, defense_baseline } = getOpponentContext(opponentId, opponentIsHome);

    // Floor mínimo para evitar división por cero.
    // Interpretación: si el rival no marca (baseline ≈ 0), defendemos vs un rival
    // extremadamente malo → señal defensiva no informativa → usar floor conservador.
    const safe_def_baseline = Math.max(defense_baseline, 0.1);
    const safe_attack_baseline = Math.max(attack_baseline, 0.1);

    signals.push({
      utcDate: m.utcDate,
      attack_signal: goalsScored / safe_def_baseline,
      defense_signal: goalsConceded / safe_attack_baseline,
    });
  }

  return signals;
}

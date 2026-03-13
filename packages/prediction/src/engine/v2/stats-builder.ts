/**
 * stats-builder.ts — Tasas observadas y baselines de liga (§5, §4.3).
 *
 * Funciones puras. Sin IO. Sin efectos secundarios.
 * Anti-lookahead: el caller es responsable de filtrar los partidos.
 */

import type { V2MatchRecord, TeamStats, ObservedRates, LeagueBaselines } from './types.js';

// ── Fallbacks europeos cuando no hay datos suficientes ────────────────────────

/** Baseline europeo por defecto cuando no hay partidos en la liga actual. */
const FALLBACK_HOME_GOALS_PG = 1.5;
const FALLBACK_AWAY_GOALS_PG = 1.2;

// ── TeamStats ─────────────────────────────────────────────────────────────────

/**
 * Computa stats acumulados del equipo en los partidos dados.
 * Partidos donde el equipo no participa son ignorados silenciosamente.
 *
 * @param matches  Partidos ya filtrados por anti-lookahead.
 * @param teamId   Equipo a evaluar.
 */
export function computeTeamStats(matches: V2MatchRecord[], teamId: string): TeamStats {
  let pj_total = 0,
    pj_home = 0,
    pj_away = 0;
  let gf_total = 0,
    gc_total = 0;
  let gf_home = 0,
    gc_home = 0;
  let gf_away = 0,
    gc_away = 0;

  for (const m of matches) {
    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;
    if (!isHome && !isAway) continue;

    pj_total++;
    if (isHome) {
      pj_home++;
      gf_home += m.homeGoals;
      gc_home += m.awayGoals;
      gf_total += m.homeGoals;
      gc_total += m.awayGoals;
    } else {
      pj_away++;
      gf_away += m.awayGoals;
      gc_away += m.homeGoals;
      gf_total += m.awayGoals;
      gc_total += m.homeGoals;
    }
  }

  return {
    teamId,
    pj_total,
    pj_home,
    pj_away,
    gf_total,
    gc_total,
    gf_home,
    gc_home,
    gf_away,
    gc_away,
  };
}

// ── ObservedRates (§5) ────────────────────────────────────────────────────────

/**
 * Computa tasas observadas brutas desde TeamStats.
 * División por cero retorna 0 — manejado en shrinkage con el prior.
 */
export function computeObservedRates(stats: TeamStats): ObservedRates {
  return {
    gf_pg_total: stats.pj_total > 0 ? stats.gf_total / stats.pj_total : 0,
    gc_pg_total: stats.pj_total > 0 ? stats.gc_total / stats.pj_total : 0,
    gf_pg_home: stats.pj_home > 0 ? stats.gf_home / stats.pj_home : 0,
    gc_pg_home: stats.pj_home > 0 ? stats.gc_home / stats.pj_home : 0,
    gf_pg_away: stats.pj_away > 0 ? stats.gf_away / stats.pj_away : 0,
    gc_pg_away: stats.pj_away > 0 ? stats.gc_away / stats.pj_away : 0,
  };
}

// ── LeagueBaselines (§4.3) ────────────────────────────────────────────────────

/**
 * Computa las tasas promedio de la liga desde todos los partidos pasados.
 *
 * Si no hay partidos, retorna baselines europeos de fallback.
 * Decisión conservadora: no inventar jerarquía. §6.8
 */
export function computeLeagueBaselines(matches: V2MatchRecord[]): LeagueBaselines {
  if (matches.length === 0) {
    return {
      league_home_goals_pg: FALLBACK_HOME_GOALS_PG,
      league_away_goals_pg: FALLBACK_AWAY_GOALS_PG,
      league_goals_pg: FALLBACK_HOME_GOALS_PG + FALLBACK_AWAY_GOALS_PG,
    };
  }

  let total_home = 0,
    total_away = 0;
  for (const m of matches) {
    total_home += m.homeGoals;
    total_away += m.awayGoals;
  }

  const n = matches.length;
  const home_pg = total_home / n;
  const away_pg = total_away / n;

  return {
    league_home_goals_pg: home_pg,
    league_away_goals_pg: away_pg,
    league_goals_pg: home_pg + away_pg,
  };
}

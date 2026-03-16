/**
 * league-baseline.ts — Motor Predictivo V3: §4 League Baseline.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §4
 *
 * Función pura. Sin IO. Determinista.
 */

import type { V3MatchRecord, LeagueBaselines } from './types.js';
import {
  HOME_GOALS_FALLBACK,
  AWAY_GOALS_FALLBACK,
  MIN_GAMES_FOR_BASELINE,
  DECAY_XI,
  MS_PER_DAY,
} from './constants.js';

/**
 * Computa los baselines de goles de la liga desde los partidos de la temporada actual.
 *
 * Usa time-decay exponencial (mismo DECAY_XI que team-stats.ts) para que partidos
 * recientes pesen más. Esto asegura consistencia con los stats de equipo — el ratio
 * equipo/liga es coherente cuando ambos usan el mismo esquema de ponderación.
 *
 * Solo usa partidos con utcDate < buildNowUtc (anti-lookahead).
 * Fallback si hay < MIN_GAMES_FOR_BASELINE partidos terminados.
 *
 * @param matches           Partidos de la temporada actual (ya filtrados por < kickoffUtc)
 * @param buildNowUtc       Anchor temporal — excluye partidos futuros
 */
export function computeLeagueBaselines(
  matches: readonly V3MatchRecord[],
  buildNowUtc: string,
): LeagueBaselines {
  const buildMs = new Date(buildNowUtc).getTime();

  let wHomeGoals = 0;
  let wAwayGoals = 0;
  let wTotal = 0;
  let count = 0;

  for (const m of matches) {
    if (m.utcDate >= buildNowUtc) continue;
    const daysAgo = (buildMs - new Date(m.utcDate).getTime()) / MS_PER_DAY;
    const w = Math.exp(-DECAY_XI * daysAgo);
    wHomeGoals += m.homeGoals * w;
    wAwayGoals += m.awayGoals * w;
    wTotal += w;
    count += 1;
  }

  if (count < MIN_GAMES_FOR_BASELINE) {
    const league_home_goals_pg = HOME_GOALS_FALLBACK;
    const league_away_goals_pg = AWAY_GOALS_FALLBACK;
    return {
      league_home_goals_pg,
      league_away_goals_pg,
      league_goals_pg: (league_home_goals_pg + league_away_goals_pg) / 2,
    };
  }

  const league_home_goals_pg = wHomeGoals / wTotal;
  const league_away_goals_pg = wAwayGoals / wTotal;

  return {
    league_home_goals_pg,
    league_away_goals_pg,
    league_goals_pg: (league_home_goals_pg + league_away_goals_pg) / 2,
  };
}

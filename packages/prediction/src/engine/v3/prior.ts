/**
 * prior.ts — Motor Predictivo V3: §7 Prior de temporada anterior.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §7
 *
 * Función pura. Sin IO. Determinista.
 */

import type { V3MatchRecord, LeagueBaselines, PriorResult, PriorQuality } from './types.js';
import {
  PRIOR_EQUIV_GAMES,
  PREV_SEASON_MIN_GAMES,
  PARTIAL_MIN_GAMES,
  DECAY_XI,
  MS_PER_DAY,
} from './constants.js';

/** Stats de temporada anterior con time-decay desde el final de la temporada. */
interface PrevSeasonStats {
  prior_attack: number;
  prior_defense: number;
  games: number;
}

/**
 * Calcula stats de la temporada anterior para un equipo con time-decay.
 *
 * Usa el mismo DECAY_XI que team-stats.ts y league-baseline.ts.
 * El anchor es el partido más reciente de prevSeasonMatches (final de temporada):
 * w = exp(-DECAY_XI × days_from_season_end)
 *
 * Resultado: el form del final de temporada pesa más que el arranque.
 * El campo `games` sigue siendo conteo real (no ponderado) para calidad PREV_SEASON/PARTIAL.
 */
function computePrevSeasonStats(
  prevSeasonMatches: readonly V3MatchRecord[],
  teamId: string,
): PrevSeasonStats {
  // Encontrar el partido más reciente (ancla de decay = fin de temporada)
  let latestMs = 0;
  for (const m of prevSeasonMatches) {
    const ms = new Date(m.utcDate).getTime();
    if (ms > latestMs) latestMs = ms;
  }

  let wScored = 0;
  let wConceded = 0;
  let wTotal = 0;
  let games = 0;

  for (const m of prevSeasonMatches) {
    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;
    if (!isHome && !isAway) continue;

    const daysFromEnd = (latestMs - new Date(m.utcDate).getTime()) / MS_PER_DAY;
    const w = Math.exp(-DECAY_XI * daysFromEnd);

    wScored   += (isHome ? m.homeGoals : m.awayGoals) * w;
    wConceded += (isHome ? m.awayGoals : m.homeGoals) * w;
    wTotal    += w;
    games     += 1;
  }

  return {
    prior_attack:   wTotal > 0 ? wScored   / wTotal : 0,
    prior_defense:  wTotal > 0 ? wConceded / wTotal : 0,
    games,
  };
}

/**
 * Determina la calidad del prior según la cantidad de partidos en prevSeason (§7).
 *
 * ≥ 15 → PREV_SEASON
 * 5–14 → PARTIAL
 * < 5 → LEAGUE_BASELINE
 */
function determinePriorQuality(games: number): PriorQuality {
  if (games >= PREV_SEASON_MIN_GAMES) return 'PREV_SEASON';
  if (games >= PARTIAL_MIN_GAMES) return 'PARTIAL';
  return 'LEAGUE_BASELINE';
}

/**
 * Construye el prior de temporada anterior para un equipo.
 * Si prevSeasonMatches está vacío o el equipo tiene < PARTIAL_MIN_GAMES partidos,
 * retorna LEAGUE_BASELINE como prior_quality y las stats de liga como effective rates.
 *
 * @param prevSeasonMatches  Partidos de la temporada anterior
 * @param teamId             ID del equipo
 * @param baselines          Baselines de liga (para usar como fallback)
 */
export function buildPrior(
  prevSeasonMatches: readonly V3MatchRecord[],
  teamId: string,
  baselines: LeagueBaselines,
): { prior_attack: number; prior_defense: number; prior_quality: PriorQuality } {
  if (prevSeasonMatches.length === 0) {
    return {
      prior_attack: baselines.league_goals_pg,
      prior_defense: baselines.league_goals_pg,
      prior_quality: 'LEAGUE_BASELINE',
    };
  }

  const stats = computePrevSeasonStats(prevSeasonMatches, teamId);
  const quality = determinePriorQuality(stats.games);

  if (quality === 'LEAGUE_BASELINE') {
    return {
      prior_attack: baselines.league_goals_pg,
      prior_defense: baselines.league_goals_pg,
      prior_quality: 'LEAGUE_BASELINE',
    };
  }

  return {
    prior_attack: stats.prior_attack,
    prior_defense: stats.prior_defense,
    prior_quality: quality,
  };
}

/**
 * Mezcla las stats actuales post-shrinkage con el prior de temporada anterior.
 *
 * ALPHA_CURR = games / (games + PRIOR_EQUIV_GAMES)   [dinámico]
 * effective_attack  = ALPHA_CURR × attack_shrunk  + (1 − ALPHA_CURR) × prior_attack
 * effective_defense = ALPHA_CURR × defense_shrunk + (1 − ALPHA_CURR) × prior_defense
 *
 * Si prior_quality = LEAGUE_BASELINE, no hay mezcla real con temporada anterior —
 * pero la fórmula aplica igualmente con prior_attack = league_goals_pg.
 *
 * @param currentGames     Número de partidos en temporada actual
 * @param attack_shrunk    Attack tras shrinkage bayesiano
 * @param defense_shrunk   Defense tras shrinkage bayesiano
 * @param prior_attack     Prior de ataque (temporada anterior o league baseline)
 * @param prior_defense    Prior de defensa (temporada anterior o league baseline)
 * @param prior_quality    Calidad del prior
 */
export function mixWithPrior(
  currentGames: number,
  attack_shrunk: number,
  defense_shrunk: number,
  prior_attack: number,
  prior_defense: number,
  prior_quality: PriorQuality,
  priorEquivGamesOverride?: number,
): PriorResult {
  const priorEquivGames = priorEquivGamesOverride ?? PRIOR_EQUIV_GAMES;
  const alpha = currentGames / (currentGames + priorEquivGames);

  return {
    effective_attack: alpha * attack_shrunk + (1 - alpha) * prior_attack,
    effective_defense: alpha * defense_shrunk + (1 - alpha) * prior_defense,
    prior_quality,
  };
}

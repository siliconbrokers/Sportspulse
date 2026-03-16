/**
 * team-stats.ts — Motor Predictivo V3: §5 Stats por equipo con time-decay.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §5
 *
 * Función pura. Sin IO. Determinista.
 */

import type { V3MatchRecord, TeamTDStats } from './types.js';
import { DECAY_XI, MIN_GAMES_VENUE, MS_PER_DAY } from './constants.js';

/**
 * Calcula stats time-decay para un equipo, con filtro opcional por venue.
 *
 * weight(match) = exp(−DECAY_XI × days_ago(match, buildNowUtc))
 * attack_raw_td  = Σ(goals_scored_i  × weight_i) / Σ(weight_i)
 * defense_raw_td = Σ(goals_conceded_i × weight_i) / Σ(weight_i)
 *
 * @param teamId        ID del equipo
 * @param matches       Partidos filtrados (ya anti-lookahead aplicado)
 * @param buildNowUtc   Anchor temporal para calcular days_ago
 * @param venue         Si se especifica, solo usa partidos de ese venue
 */
export function computeTeamStatsTD(
  teamId: string,
  matches: readonly V3MatchRecord[],
  buildNowUtc: string,
  venue?: 'HOME' | 'AWAY',
): TeamTDStats {
  const buildMs = new Date(buildNowUtc).getTime();

  let wAttack = 0;
  let wDefense = 0;
  let wTotal = 0;
  let games = 0;

  for (const m of matches) {
    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;

    if (!isHome && !isAway) continue;
    if (venue === 'HOME' && !isHome) continue;
    if (venue === 'AWAY' && !isAway) continue;

    const scored = isHome ? m.homeGoals : m.awayGoals;
    const conceded = isHome ? m.awayGoals : m.homeGoals;
    const daysAgo = (buildMs - new Date(m.utcDate).getTime()) / MS_PER_DAY;
    const w = Math.exp(-DECAY_XI * daysAgo);

    wAttack += scored * w;
    wDefense += conceded * w;
    wTotal += w;
    games += 1;
  }

  return {
    attack_td: wTotal > 0 ? wAttack / wTotal : 0,
    defense_td: wTotal > 0 ? wDefense / wTotal : 0,
    games,
    venueSplit: false, // se sobreescribe en resolveTeamStats
  };
}

/**
 * Resuelve las stats finales de un equipo con venue split automático (§5 venue split logic).
 *
 * Si el equipo tiene ≥ MIN_GAMES_VENUE partidos en su venue (HOME para local, AWAY para visitante):
 *   - Usa las stats de venue específico → venueSplit = true
 * Si tiene < MIN_GAMES_VENUE:
 *   - Usa las stats totales (sin filtro de venue) → venueSplit = false
 *
 * @param teamId        ID del equipo
 * @param matches       Partidos filtrados (ya anti-lookahead aplicado)
 * @param buildNowUtc   Anchor temporal
 * @param venue         'HOME' si el equipo juega en casa en este partido, 'AWAY' si fuera
 */
export function resolveTeamStats(
  teamId: string,
  matches: readonly V3MatchRecord[],
  buildNowUtc: string,
  venue: 'HOME' | 'AWAY',
): TeamTDStats {
  const venueStats = computeTeamStatsTD(teamId, matches, buildNowUtc, venue);

  // Total games siempre refleja el historial completo del equipo (§5: "total games in sample").
  // Se usa para elegibilidad, confianza y recency.
  const totalStats = computeTeamStatsTD(teamId, matches, buildNowUtc, undefined);

  if (venueStats.games >= MIN_GAMES_VENUE) {
    // Usar attack/defense de venue específico, pero games = total
    return {
      attack_td: venueStats.attack_td,
      defense_td: venueStats.defense_td,
      games: totalStats.games,
      venueSplit: true,
    };
  }

  // Usar stats totales (sin filtro de venue)
  return {
    ...totalStats,
    venueSplit: false,
  };
}

/**
 * home-advantage.ts — NEXUS Track 1: Dynamic Home Advantage estimation.
 *
 * Spec authority:
 *   - taxonomy spec S3.2 Extension 1: Dynamic Home Advantage
 *   - master spec S5.1: "context-dependent home advantage"
 *   - master spec S4.2: V3 limitation — "home advantage is the same for every
 *     match within a league"; NEXUS replaces this with a dynamic estimate
 *
 * Phase 1A: league-wide dynamic home advantage baseline.
 * (Team-level trending window is Phase 1B, per S3.2 Extension 1 step 1-2.)
 *
 * Algorithm:
 *   homeAdvantage = mean(goalsHome - goalsAway) over all FINISHED,
 *                   non-neutral-venue matches in the supplied history.
 *
 *   If sampleSize < MIN_SAMPLE_SIZE, fall back to league-specific defaults
 *   grounded in European football literature (see DEFAULT_HOME_ADVANTAGES).
 *
 * All functions are PURE — same inputs → same outputs. No IO, no Date.now().
 *
 * @module nexus/track1/home-advantage
 */

import type { HistoricalMatch, LeagueHomeAdvantageConfig } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Minimum number of finished, non-neutral-venue matches required before
 * the empirical estimate is used instead of the prior.
 *
 * < 30 matches → prior (too little data to trust the empirical mean).
 * taxonomy spec S3.2 Extension 1: "Teams with fewer home matches rely more
 * on the league prior" — we apply the same principle at the league level.
 */
export const MIN_SAMPLE_SIZE_FOR_EMPIRICAL = 30;

/**
 * Default league home advantage (goal differential) when sample is too small.
 *
 * Derived from literature on European top-5 league home advantage:
 *   PD  (LaLiga):       ~0.35 goal advantage (moderate, stable)
 *   PL  (Premier):      ~0.30 (lower since 2020 with COVID matches)
 *   BL1 (Bundesliga):   ~0.30 (high-scoring league, similar ratio)
 *   SA  (Serie A):      ~0.30 (tactical, lower-scoring)
 *   FL1 (Ligue 1):      ~0.28 (less reliable attendance data)
 *
 * GLOBAL_DEFAULT is the conservative fallback for any unknown league.
 */
export const DEFAULT_HOME_ADVANTAGES: Readonly<Record<string, number>> = {
  PD:  0.35,
  PL:  0.30,
  BL1: 0.30,
  SA:  0.30,
  FL1: 0.28,
};

/** Fallback for leagues not in DEFAULT_HOME_ADVANTAGES. */
export const GLOBAL_HOME_ADVANTAGE_DEFAULT = 0.30;

// ── Core function ──────────────────────────────────────────────────────────

/**
 * Estimate the league-wide home advantage from historical match data.
 *
 * taxonomy spec S3.2 Extension 1:
 *   "For neutral-venue matches (identified by the `neutral` flag in the
 *    canonical match data), set home advantage to 1.0 (no advantage)."
 *   → We exclude neutral-venue matches entirely from the estimation.
 *
 * @param matches - Historical FINISHED matches. Must include only completed
 *   matches (homeGoals and awayGoals are valid non-negative integers).
 * @param leagueId - League code for default lookup when sample is insufficient.
 * @param computedAt - ISO-8601 UTC timestamp for provenance. Caller provides
 *   this (typically buildNowUtc) so the function remains pure.
 * @returns LeagueHomeAdvantageConfig with the estimated home advantage.
 */
export function estimateHomeAdvantage(
  matches: readonly HistoricalMatch[],
  leagueId: string,
  computedAt: string,
): LeagueHomeAdvantageConfig {
  // Filter to non-neutral, FINISHED matches only.
  // taxonomy spec S3.2 Extension 1: neutral venue → exclude from home adv calc.
  const eligible = matches.filter(
    (m) => !m.isNeutralVenue && isFinished(m),
  );

  const sampleSize = eligible.length;

  if (sampleSize < MIN_SAMPLE_SIZE_FOR_EMPIRICAL) {
    // Insufficient sample — use prior.
    const prior =
      DEFAULT_HOME_ADVANTAGES[leagueId] ?? GLOBAL_HOME_ADVANTAGE_DEFAULT;
    return {
      leagueId,
      homeAdvantage: prior,
      sampleSize,
      computedAt,
    };
  }

  // Empirical estimate: mean(goalsHome - goalsAway) over eligible matches.
  // taxonomy spec S3.2 Extension 1 step 1: compute ratio of home goals to
  // expected goals. Phase 1A uses the simpler mean-differential form which
  // is equivalent for league-level estimation with balanced schedules.
  const totalDiff = eligible.reduce(
    (acc, m) => acc + (m.homeGoals - m.awayGoals),
    0,
  );
  const homeAdvantage = totalDiff / sampleSize;

  return {
    leagueId,
    homeAdvantage,
    sampleSize,
    computedAt,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Guard: a HistoricalMatch is FINISHED when both goals are non-negative integers.
 * Caller is responsible for passing only FINISHED matches, but this guard
 * protects against accidental inclusion of scheduled/in-progress entries.
 */
function isFinished(m: HistoricalMatch): boolean {
  return (
    typeof m.homeGoals === 'number' &&
    typeof m.awayGoals === 'number' &&
    m.homeGoals >= 0 &&
    m.awayGoals >= 0 &&
    Number.isFinite(m.homeGoals) &&
    Number.isFinite(m.awayGoals)
  );
}

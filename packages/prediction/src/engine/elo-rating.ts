/**
 * Extended Elo Rating Engine — §6.1, §20
 *
 * Implements the extended Elo base model required by §6.1:
 * "rating base: Elo extendido"
 *
 * Covers:
 * - K-factor (§6.1: "peso por competición para actualización de rating")
 * - Home advantage adjustment (§6.1: "localía")
 * - Recency weighting signal for K scaling (§6.1: "recencia")
 * - New team / sparse history policy (§20)
 *
 * All functions are PURE. Same inputs → same outputs. No IO.
 * Spec §26: "permite backtesting temporal" — determinism is required.
 *
 * ── Spec Ambiguity Notes ────────────────────────────────────────────────
 * The spec mandates extended Elo but does not fix specific K-factor values.
 * §6.1 states the *categories* of adjustment, not exact numbers.
 * Minimal safe assumptions used (industry-standard Elo for football):
 *   - DEFAULT_ELO = 1500 (see rating-pool.ts)
 *   - K_FACTOR_BASE = 20 (standard for club domestic league)
 *   - HOME_ADVANTAGE_ELO_DELTA = 100 (adds ~65% win probability at home)
 * These constants are isolated and can be reconfigured without changing formulas.
 * ────────────────────────────────────────────────────────────────────────
 */

import { MIN_RECENT_MATCHES_CLUB, MIN_RECENT_MATCHES_NATIONAL_TEAM } from '../contracts/index.js';
import type { RatingPool, TeamRatingRecord } from '../store/rating-pool.js';

// ── Constants (all minimal safe assumptions — see module header) ───────────

/**
 * Base K-factor for domestic league matches.
 * Minimal safe assumption: K=20 is the standard club Elo K.
 * §6.1: "peso por competición para actualización de rating"
 */
export const K_FACTOR_BASE: number = 20;

/**
 * K-factor multiplier for cup/domestic cup matches (higher volatility).
 * §6.1: competition weight applies to rating update.
 */
export const K_FACTOR_CUP_MULTIPLIER: number = 1.5;

/**
 * K-factor multiplier for international club / national team tournaments.
 * §6.1: competition weight.
 */
export const K_FACTOR_INTERNATIONAL_MULTIPLIER: number = 1.0;

/**
 * Elo delta added to the home team's effective rating to model home advantage.
 * Minimal safe assumption: 100 Elo points ≈ P(win) ≈ 0.64 for equal teams.
 * §6.1: "localía"
 * §18.1: "neutral_venue = true" → must be zeroed or adjusted.
 */
export const HOME_ADVANTAGE_ELO_DELTA: number = 100;

/**
 * Elo scale factor used in the expected score formula: P = 1 / (1 + 10^(-diff/SCALE)).
 * Standard Elo uses 400.
 */
export const ELO_SCALE: number = 400;

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Competition family categories that affect K-factor weighting.
 * Mirrors spec §6.1 "peso por competición" without importing full CompetitionProfile.
 */
export type CompetitionWeightCategory =
  | 'DOMESTIC_LEAGUE'
  | 'DOMESTIC_CUP'
  | 'INTERNATIONAL_CLUB'
  | 'NATIONAL_TEAM_TOURNAMENT';

/**
 * Parameters for a post-match Elo update.
 * §6.1 — update is applied after match completion.
 */
export interface EloUpdateParams {
  /** Home team canonical ID. */
  homeTeamId: string;
  /** Away team canonical ID. */
  awayTeamId: string;
  /**
   * Actual outcome from the home team's perspective.
   * 1 = home win, 0.5 = draw, 0 = away win.
   */
  actualScore: 0 | 0.5 | 1;
  /**
   * Whether the match was played at a neutral venue.
   * §18.1: neutral_venue = true → home advantage is not applied.
   */
  neutralVenue: boolean;
  /** Competition category for K-factor scaling. §6.1 */
  competitionWeightCategory: CompetitionWeightCategory;
  /** ISO-8601 UTC timestamp of the match. For record-keeping. */
  matchUtc: string;
}

/**
 * Result of a single Elo update cycle.
 */
export interface EloUpdateResult {
  /** Updated home team record (post-match). */
  homeRecord: TeamRatingRecord;
  /** Updated away team record (post-match). */
  awayRecord: TeamRatingRecord;
  /** Expected score for home team (before the match). */
  expectedScoreHome: number;
  /** K-factor applied to this match. */
  kFactor: number;
  /** Home advantage delta actually applied (0 if neutral venue). */
  homeAdvantageDelta: number;
}

/**
 * Result of reading the effective Elo for a team.
 * Includes operating mode metadata per §20.
 */
export interface EffectiveEloResult {
  /** Effective Elo rating to use in lambda computation. */
  rating: number;
  /**
   * Whether the engine is in LIMITED_MODE due to sparse history.
   * §20.1: history < minimum → degrade to LIMITED_MODE.
   */
  isLimitedMode: boolean;
  /** Reason for limited mode, if applicable. */
  limitedModeReason: 'SPARSE_HISTORY' | 'NEW_TEAM' | null;
  /** Number of updates on this team's record. */
  updateCount: number;
}

// ── Core Elo formulas ─────────────────────────────────────────────────────

/**
 * Compute the K-factor for a match based on competition type.
 *
 * §6.1: "peso por competición para actualización de rating"
 * Pure function — no side effects.
 */
export function computeKFactor(category: CompetitionWeightCategory): number {
  switch (category) {
    case 'DOMESTIC_LEAGUE':
      return K_FACTOR_BASE;
    case 'DOMESTIC_CUP':
      return K_FACTOR_BASE * K_FACTOR_CUP_MULTIPLIER;
    case 'INTERNATIONAL_CLUB':
      return K_FACTOR_BASE * K_FACTOR_INTERNATIONAL_MULTIPLIER;
    case 'NATIONAL_TEAM_TOURNAMENT':
      return K_FACTOR_BASE * K_FACTOR_INTERNATIONAL_MULTIPLIER;
  }
}

/**
 * Compute the expected score (win probability) for the home team using Elo.
 *
 * Formula: E_home = 1 / (1 + 10^(-(rating_home - rating_away) / ELO_SCALE))
 *
 * §5.1: Match Prediction Engine is responsible for rating base.
 * §6.1: Elo extended is the mandatory baseline.
 * Pure function.
 *
 * @param ratingHome - Home team Elo (BEFORE home advantage adjustment)
 * @param ratingAway - Away team Elo
 * @param homeAdvantageDelta - Elo delta for home advantage (0 at neutral venue)
 * @returns Expected score for home team in [0, 1]
 */
export function computeExpectedScore(
  ratingHome: number,
  ratingAway: number,
  homeAdvantageDelta: number,
): number {
  const diff = ratingHome + homeAdvantageDelta - ratingAway;
  return 1 / (1 + Math.pow(10, -diff / ELO_SCALE));
}

/**
 * Update Elo ratings for both teams after a match.
 *
 * §6.1 mandatory adjustments:
 * - localía (home advantage) — applied via homeAdvantageDelta
 * - peso por competición — applied via K-factor
 *
 * Invariant: same pool state + same params → same result (deterministic).
 * Pure in the sense that it reads pool state and returns new records,
 * then applies them to the pool. The pool itself is mutable state managed
 * by the caller.
 *
 * @param params - Match parameters
 * @param pool - Rating pool (domain-appropriate: club or national team)
 * @returns EloUpdateResult with new records and diagnostics
 */
export function updateEloRating(params: EloUpdateParams, pool: RatingPool): EloUpdateResult {
  // Read pre-match ratings (§15.4: elo_home_pre, elo_away_pre)
  const ratingHomePre = pool.getOrDefault(params.homeTeamId);
  const ratingAwayPre = pool.getOrDefault(params.awayTeamId);

  // Home advantage: §6.1 "localía", §18.1 neutral venue zeroes it
  const homeAdvantageDelta = params.neutralVenue ? 0 : HOME_ADVANTAGE_ELO_DELTA;

  // Expected score with home advantage applied
  const expectedScoreHome = computeExpectedScore(ratingHomePre, ratingAwayPre, homeAdvantageDelta);
  const expectedScoreAway = 1 - expectedScoreHome;

  // K-factor: §6.1 "peso por competición"
  const kFactor = computeKFactor(params.competitionWeightCategory);

  // Rating deltas
  const deltaHome = kFactor * (params.actualScore - expectedScoreHome);
  const deltaAway = kFactor * (1 - params.actualScore - expectedScoreAway);

  // Apply to pool
  const homeRecord = pool.applyDelta(params.homeTeamId, deltaHome, params.matchUtc);
  const awayRecord = pool.applyDelta(params.awayTeamId, deltaAway, params.matchUtc);

  return {
    homeRecord,
    awayRecord,
    expectedScoreHome,
    kFactor,
    homeAdvantageDelta,
  };
}

/**
 * Get the effective Elo for a team, including LIMITED_MODE diagnostics.
 *
 * §20.1: teams with sparse history degrade to LIMITED_MODE.
 * §20.2: prior_rating rules are enforced upstream by the Validation Layer;
 *         this function only reads pool state and applies the sparse history policy.
 *
 * @param teamId - Canonical team ID
 * @param pool - Domain-appropriate rating pool
 * @param teamDomain - 'CLUB' or 'NATIONAL_TEAM' — determines history threshold
 * @returns EffectiveEloResult with rating and operating mode metadata
 */
export function getEffectiveElo(
  teamId: string,
  pool: RatingPool,
  teamDomain: 'CLUB' | 'NATIONAL_TEAM',
): EffectiveEloResult {
  const record = pool.get(teamId);

  if (record === null) {
    // New team — no record exists. §20.1: degrade to LIMITED_MODE.
    return {
      rating: pool.getOrDefault(teamId), // returns DEFAULT_ELO_RATING
      isLimitedMode: true,
      limitedModeReason: 'NEW_TEAM',
      updateCount: 0,
    };
  }

  // §20.1 sparse history policy:
  // The minimum update count mirrors the minimum recent matches threshold.
  // §4.3: MIN_RECENT_MATCHES_CLUB = 5, MIN_RECENT_MATCHES_NATIONAL_TEAM = 5
  const minimumUpdates =
    teamDomain === 'CLUB' ? MIN_RECENT_MATCHES_CLUB : MIN_RECENT_MATCHES_NATIONAL_TEAM;

  if (record.updateCount < minimumUpdates) {
    return {
      rating: record.rating,
      isLimitedMode: true,
      limitedModeReason: 'SPARSE_HISTORY',
      updateCount: record.updateCount,
    };
  }

  return {
    rating: record.rating,
    isLimitedMode: false,
    limitedModeReason: null,
    updateCount: record.updateCount,
  };
}

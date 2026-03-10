/**
 * MatchInput v1 — Prediction engine input contract.
 *
 * Spec authority: §7 (Contract de entrada — MatchInput v1)
 *
 * DESIGN NOTES:
 * - `schemaVersion: 1` is a literal type field. Any MatchInput with a different
 *   version is caught at compile time as a type mismatch.
 * - Fields marked required in §7.1 are non-optional here.
 * - Fields described as "conditionally required" in §7.3 are typed as optional
 *   (?) because their presence/absence is enforced at runtime by the Validation
 *   Layer (§5.3), not the type system. The type system cannot know leg_type at
 *   compile time for arbitrary inputs.
 * - No imports from @sportpulse/scoring, @sportpulse/signals, @sportpulse/layout.
 */

import type { CompetitionProfile } from './competition-profile.js';

/**
 * Historical context provided with each MatchInput.
 * Used by the Validation Layer to determine eligibility and operating mode.
 * Spec §7.1
 */
export interface MatchInputHistoricalContext {
  /** Completed official matches for the home team in the last 365 days. §7.1 */
  home_completed_official_matches_last_365d?: number;
  /** Completed official matches for the away team in the last 365 days. §7.1 */
  away_completed_official_matches_last_365d?: number;

  /** Completed official matches for the home team in the last 730 days. §7.1 */
  home_completed_official_matches_last_730d?: number;
  /** Completed official matches for the away team in the last 730 days. §7.1 */
  away_completed_official_matches_last_730d?: number;

  /**
   * Whether a utilizable prior rating exists for the home team.
   * "Utilizable" is defined in §20.2.
   * §7.1
   */
  home_prior_rating_available: boolean;

  /**
   * Whether a utilizable prior rating exists for the away team.
   * "Utilizable" is defined in §20.2.
   * §7.1
   */
  away_prior_rating_available: boolean;
}

/**
 * The primary input object to the Match Prediction Engine.
 *
 * Spec §7.1 — all required fields must be present or the party is NOT_ELIGIBLE (§7.2).
 * Conditionally required fields (§7.3) are enforced at runtime by the Validation Layer.
 *
 * `schemaVersion: 1` is a compile-time version gate. If this type is ever
 * extended to v2, the literal type change will break callers at compile time.
 */
export interface MatchInput {
  /** Version gate — must always be literal 1. §7 */
  readonly schemaVersion: 1;

  // ── Critical fields (§7.2) — absence triggers NOT_ELIGIBLE ──────────────

  /** Canonical match identifier. §7.1, §7.2 */
  match_id: string;

  /**
   * Kick-off time in ISO-8601 UTC format.
   * Used as the leakage guard boundary (§3.6). §7.1, §7.2
   */
  kickoff_utc: string;

  /** Canonical competition identifier. §7.1, §7.2 */
  competition_id: string;

  /** Season identifier within the competition. §7.1, §7.2 */
  season_id: string;

  /**
   * Stage identifier within the season.
   * Optional globally, but required by the Competition Engine when constructing
   * standings, brackets, or resolution. §7.1, §7.7
   */
  stage_id?: string | null;

  /**
   * Group identifier within a GROUP_STAGE or GROUP_CLASSIC stage.
   * Optional globally, but required by the Competition Engine for group ranking. §7.1, §7.7
   */
  group_id?: string | null;

  /** Canonical home team identifier. §7.1, §7.2 */
  home_team_id: string;

  /** Canonical away team identifier. §7.1, §7.2 */
  away_team_id: string;

  /**
   * Full competition profile for this match.
   * Required fields within competition_profile are listed in §7.2.
   * §7.1, §7.2, §8
   */
  competition_profile: CompetitionProfile;

  /**
   * Domain identifier for the home team's rating pool.
   * Used to enforce pool separation (§10.1) and bridging (§10.2). §7.1
   */
  home_team_domain_id: string;

  /**
   * Domain identifier for the away team's rating pool.
   * Used to enforce pool separation (§10.1) and bridging (§10.2). §7.1
   */
  away_team_domain_id: string;

  /** Historical context for eligibility and operating mode determination. §7.1 */
  historical_context: MatchInputHistoricalContext;
}

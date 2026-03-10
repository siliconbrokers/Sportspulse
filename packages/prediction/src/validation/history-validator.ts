/**
 * history-validator.ts
 *
 * Validates historical context and prior_rating utilizable status for both
 * teams in a MatchInput.
 *
 * Spec authority:
 *   §7.4  — Minimum history requirements per team_domain
 *   §20.1 — Minimum v1 rule for new/low-history teams
 *   §20.2 — Operative rule for prior_rating utilizable status (5 conditions)
 *   §10.4 — INTERNATIONAL_CLUB without league_strength_factor → LIMITED_MODE floor
 *
 * This module is responsible ONLY for history and prior_rating checks.
 * Operating mode determination is done by match-validator.ts.
 *
 * DESIGN NOTE — §20.2 and MatchInput interaction:
 * The MatchInput provides `historical_context.home_prior_rating_available` and
 * `away_prior_rating_available` as pre-evaluated booleans. These flags are the
 * Phase 2b fallback path when the engine does not pass actual PriorRating records.
 *
 * When the engine passes actual PriorRating records via MatchValidationContext
 * (home_prior_rating / away_prior_rating), match-validator.ts evaluates the full
 * §20.2 conditions (domain_matches checked first → NOT_ELIGIBLE if false; then
 * age_within_limit and sufficient_updates_in_window) and passes the resulting
 * effective boolean here via `effectiveHomePriorAvailable` /
 * `effectiveAwayPriorAvailable`. This is the enforcement path for CRITICAL-001.
 *
 * This module never recomputes domain matching — that check is done in
 * match-validator.ts Step 5 before validateHistory is called.
 *
 * Package boundary: @sportpulse/prediction only.
 */

import type { MatchInput } from '../contracts/types/match-input.js';
import type { TeamDomain } from '../contracts/types/competition-profile.js';
import type { ReasonCode } from '../contracts/types/validation-result.js';
import {
  MIN_RECENT_MATCHES_CLUB,
  MIN_RECENT_MATCHES_NATIONAL_TEAM,
  STRONG_RECENT_MATCHES_CLUB,
  STRONG_RECENT_MATCHES_NATIONAL_TEAM,
} from '../contracts/constants.js';

// ── Result type ────────────────────────────────────────────────────────────

/**
 * Per-team history evaluation summary.
 *
 * Used internally by match-validator to make operating mode decisions.
 */
export interface TeamHistoryEval {
  /** Team identifier for traceability. */
  team_id: string;

  /**
   * Whether the team has at least the minimum required matches for the domain.
   * CLUB: >= 5 completed in last 365d (§7.4, §4.3)
   * NATIONAL_TEAM: >= 5 completed in last 730d (§7.4, §4.3)
   */
  meets_min_history: boolean;

  /**
   * Whether the team has at least the "strong" threshold of recent matches.
   * CLUB: >= 12 completed in last 365d (§4.3, §13.1)
   * NATIONAL_TEAM: >= 8 completed in last 730d (§4.3, §13.1)
   */
  meets_strong_history: boolean;

  /**
   * Whether a utilizable prior_rating is available for this team.
   * "Utilizable" per §20.2 (pre-evaluated by caller).
   */
  prior_rating_available: boolean;

  /**
   * Whether the team is eligible to participate (meets_min_history OR prior_rating_available).
   * §7.4, §20.1
   */
  is_eligible: boolean;
}

/**
 * Outcome of history validation for both teams.
 */
export interface HistoryValidationResult {
  home: TeamHistoryEval;
  away: TeamHistoryEval;

  /**
   * True when BOTH teams are eligible (min history or prior_rating).
   * If false, the match must be NOT_ELIGIBLE. §7.4
   */
  both_eligible: boolean;

  /**
   * True when BOTH teams meet the strong history threshold (no team
   * enters only via prior_rating). Required (among other conditions)
   * for STRONG applicability_level. §13.1
   */
  both_strong_history: boolean;

  /**
   * Reason codes that should be appended to ValidationResult.reasons.
   * Non-empty only when both_eligible = false.
   */
  reasons: ReasonCode[];
}

// ── Internal helper ────────────────────────────────────────────────────────

/**
 * Evaluates a single team's history against the domain-specific thresholds.
 *
 * @param team_id               Canonical team identifier
 * @param domain                The team_domain from CompetitionProfile
 * @param matches_365d          Completed official matches in last 365 days (may be undefined)
 * @param matches_730d          Completed official matches in last 730 days (may be undefined)
 * @param prior_rating_available Whether a utilizable prior_rating is available
 */
function evaluateTeamHistory(
  team_id: string,
  domain: TeamDomain,
  matches_365d: number | undefined,
  matches_730d: number | undefined,
  prior_rating_available: boolean,
): TeamHistoryEval {
  if (domain === 'CLUB') {
    // §7.4 CLUB: 5+ official completed matches in last 365 days
    // §4.3: min_recent_matches_club = 5, strong_recent_matches_club = 12
    const m = matches_365d ?? 0;
    const meets_min = m >= MIN_RECENT_MATCHES_CLUB; // §4.3: 5
    const meets_strong = m >= STRONG_RECENT_MATCHES_CLUB; // §4.3: 12
    return {
      team_id,
      meets_min_history: meets_min,
      meets_strong_history: meets_strong,
      prior_rating_available,
      is_eligible: meets_min || prior_rating_available,
    };
  } else {
    // domain === 'NATIONAL_TEAM'
    // §7.4 NATIONAL_TEAM: 5+ official completed matches in last 730 days
    // §4.3: min_recent_matches_national_team = 5, strong_recent_matches_national_team = 8
    const m = matches_730d ?? 0;
    const meets_min = m >= MIN_RECENT_MATCHES_NATIONAL_TEAM; // §4.3: 5
    const meets_strong = m >= STRONG_RECENT_MATCHES_NATIONAL_TEAM; // §4.3: 8
    return {
      team_id,
      meets_min_history: meets_min,
      meets_strong_history: meets_strong,
      prior_rating_available,
      is_eligible: meets_min || prior_rating_available,
    };
  }
}

// ── Main validator ─────────────────────────────────────────────────────────

/**
 * Validates historical context for both teams in a MatchInput.
 *
 * Applies §7.4 minimum eligibility rules and §13.1 strong-history checks.
 * Returns per-team evaluations and aggregate flags used by match-validator
 * to determine operating mode and applicability_level.
 *
 * Precondition: caller must have already verified that competition_profile
 * and critical fields are present. This function only evaluates history.
 *
 * @param input                       The MatchInput (frozen Phase 1 contract)
 * @param effectiveHomePriorAvailable Override for home_prior_rating_available.
 *   When the engine provides an actual PriorRating record, match-validator
 *   evaluates §20.2 conditions (age, updates, cross_season_carry) and passes
 *   the result here. Falls back to historical_context.home_prior_rating_available
 *   when undefined. §19.6, §20.2
 * @param effectiveAwayPriorAvailable Same semantics for the away team.
 */
export function validateHistory(
  input: MatchInput,
  effectiveHomePriorAvailable?: boolean,
  effectiveAwayPriorAvailable?: boolean,
): HistoryValidationResult {
  const domain: TeamDomain = input.competition_profile.team_domain;
  const hc = input.historical_context;

  // Use the caller-computed effective flags when provided; otherwise trust
  // the pre-evaluated booleans in MatchInput (Phase 2b backwards-compatible path).
  const homePriorAvailable =
    effectiveHomePriorAvailable !== undefined
      ? effectiveHomePriorAvailable
      : hc.home_prior_rating_available;

  const awayPriorAvailable =
    effectiveAwayPriorAvailable !== undefined
      ? effectiveAwayPriorAvailable
      : hc.away_prior_rating_available;

  const home = evaluateTeamHistory(
    input.home_team_id,
    domain,
    hc.home_completed_official_matches_last_365d,
    hc.home_completed_official_matches_last_730d,
    homePriorAvailable,
  );

  const away = evaluateTeamHistory(
    input.away_team_id,
    domain,
    hc.away_completed_official_matches_last_365d,
    hc.away_completed_official_matches_last_730d,
    awayPriorAvailable,
  );

  const both_eligible = home.is_eligible && away.is_eligible;
  const both_strong_history = home.meets_strong_history && away.meets_strong_history;

  const reasons: ReasonCode[] = [];
  if (!both_eligible) {
    // §7.4, §20.1: no history AND no utilizable prior_rating → NOT_ELIGIBLE
    reasons.push('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  }

  return { home, away, both_eligible, both_strong_history, reasons };
}

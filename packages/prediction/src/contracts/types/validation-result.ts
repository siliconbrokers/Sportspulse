/**
 * ValidationResult and related types.
 *
 * Spec authority: §12 (Resultado de validación), §11.2 (Razones explícitas de fallo)
 *
 * DESIGN NOTES:
 * - `ValidationResult` is the OUTPUT of the Validation Layer (§5.3), not an input.
 *   The spec explicitly states: "Los flags de integridad no forman parte del input;
 *   son resultado de validación interna." §12
 * - `ReasonCode` is typed as a string literal union covering the full catalog defined
 *   in §11.2. Additional codes not in the catalog would be caught as type errors.
 * - `DataIntegrityFlags` is a required nested object (not optional) within
 *   ValidationResult per the spec shape in §12.
 */

import type { EligibilityStatus, OperatingMode, ApplicabilityLevel } from './operating-mode.js';

/**
 * Catalog of failure and degradation reason codes.
 *
 * These are the only valid values for the `reasons` array in both
 * `ValidationResult` and `PredictionResponse`. §11.2
 */
export type ReasonCode =
  | 'MISSING_CRITICAL_FIELD'
  | 'INVALID_COMPETITION_PROFILE'
  | 'MISSING_AGGREGATE_STATE_FOR_SECOND_LEG'
  | 'INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING'
  | 'UNSUPPORTED_MATCH_TYPE'
  | 'DOMAIN_POOL_UNAVAILABLE'
  | 'INTERLEAGUE_FACTOR_UNAVAILABLE'
  | 'KNOCKOUT_RULES_UNAVAILABLE'
  | 'INVALID_PRIOR_RATING'
  | 'EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS';

/**
 * Internal integrity flag set produced by the Validation Layer.
 *
 * All fields are required booleans — each flag must be evaluated explicitly.
 * The Validation Layer must not omit or skip any flag.
 * Spec §12
 */
export interface DataIntegrityFlags {
  /** home_team_id !== away_team_id. §12 */
  teams_distinct: boolean;

  /** kickoff_utc is present and parseable as ISO-8601 UTC. §12 */
  kickoff_present: boolean;

  /** All required CompetitionProfile fields are present and non-null. §12 */
  profile_complete: boolean;

  /**
   * stage_type is consistent with format_type per the rules in §8.3.
   * E.g. GROUP_CLASSIC cannot appear without group ranking rules. §12
   */
  stage_consistent_with_format: boolean;

  /**
   * aggregate_state_before_match is present if and only if leg_type = SECOND_LEG.
   * §12, §8.3
   */
  aggregate_state_consistent_with_leg_type: boolean;

  /**
   * If neutral_venue = true, the profile does not rely on standard home/away
   * advantage without correction. §12, §8.3
   */
  neutral_venue_consistent: boolean;

  /**
   * The appropriate rating pool (club or national team) is available for
   * both teams. §12, §10.1
   */
  domain_pool_available: boolean;

  /**
   * No data posterior to kickoff_utc was used in constructing the inputs
   * (anti-leakage check per §3.6). §12
   */
  leakage_guard_passed: boolean;

  /**
   * KnockoutResolutionRules are present and valid when required by the
   * format_type, and absent when not required. §12, §8.4
   */
  knockout_rules_consistent: boolean;

  /**
   * Prior ratings, if present, belong to the correct team_domain and pass
   * all utilizable conditions from §20.2. No domain_mismatch. §12, §20.2
   */
  prior_rating_consistent: boolean;
}

/**
 * Output produced by the Validation Layer for every MatchInput.
 *
 * This is the authoritative determination of eligibility and mode before
 * any prediction computation begins. §12
 */
export interface ValidationResult {
  /** Match this result applies to. §12 */
  match_id: string;

  /**
   * Whether the match is eligible for any form of prediction.
   * NOT_ELIGIBLE means no probabilities will be produced. §12, §11.1
   */
  eligibility_status: EligibilityStatus;

  /**
   * The operating mode assigned to this match.
   * Aligned with eligibility_status per §11.1.
   * §12
   */
  operating_mode: OperatingMode;

  /**
   * Confidence level for any prediction produced.
   * Determined by deterministic rules (§13.1), not subjective assessment.
   * §12, §13
   */
  applicability_level: ApplicabilityLevel;

  /**
   * Explicit reason codes for degradation or failure.
   * Must contain at least one entry when operating_mode = NOT_ELIGIBLE.
   * Values must come from the ReasonCode catalog (§11.2).
   * §12
   */
  reasons: ReasonCode[];

  /**
   * Internal integrity flags computed during validation.
   * Not part of MatchInput — these are validation outputs. §12
   */
  data_integrity_flags: DataIntegrityFlags;
}

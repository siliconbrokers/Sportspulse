/**
 * Public contract surface for the SportPulse Predictive Engine v1.
 *
 * This barrel re-exports ALL types, interfaces, and constants required by
 * the prediction engine contracts as defined in spec v1.3.
 *
 * IMPORTANT: PredictionResponseInternals is intentionally exported here
 * for use by the internal pipeline. However, the API layer must NEVER
 * include it in external responses — it must use PredictionResponsePublic.
 *
 * The web package must never import from this barrel (hard-forbidden dependency).
 */

// ── Constants (§4) ─────────────────────────────────────────────────────────
export {
  EPSILON_PROBABILITY,
  EPSILON_DNB_DENOMINATOR,
  MIN_RECENT_MATCHES_CLUB,
  MIN_RECENT_MATCHES_NATIONAL_TEAM,
  STRONG_RECENT_MATCHES_CLUB,
  STRONG_RECENT_MATCHES_NATIONAL_TEAM,
  MAX_TAIL_MASS_RAW,
  PRIOR_RATING_MAX_AGE_DAYS,
  PRIOR_RATING_MIN_UPDATES_LAST_730D,
  PRIOR_RATING_CROSS_SEASON_CARRY_ALLOWED,
  TOO_CLOSE_MARGIN_THRESHOLD_DEFAULT,
  STRONG_BRIDGING_CONFIDENCE_LEVELS,
  MIN_BUCKET_SAMPLE_FOR_CALIBRATION_EVAL,
  MATRIX_MAX_GOAL_DEFAULT,
} from './constants.js';

// ── Competition Profile types (§8) ────────────────────────────────────────
export type {
  TeamDomain,
  CompetitionFamily,
  PredictiveStageType,
  FormatType,
  LegType,
  BracketMappingStrategy,
  RankByCriterion,
  SeedingStrategy,
  SecondLegResolutionStep,
  SingleLegResolutionStep,
  GroupRankingRules,
  QualificationRules,
  TieBreakRules,
  LeaguePhaseRules,
  KnockoutResolutionRules,
  CompetitionProfile,
} from './types/competition-profile.js';

// ── MatchInput (§7) ────────────────────────────────────────────────────────
export type { MatchInputHistoricalContext, MatchInput } from './types/match-input.js';

// ── Operating modes (§11, §12, §13) ──────────────────────────────────────
export type {
  EligibilityStatus,
  OperatingMode,
  ApplicabilityLevel,
} from './types/operating-mode.js';

// ── ValidationResult (§12) ────────────────────────────────────────────────
export type {
  ReasonCode,
  DataIntegrityFlags,
  ValidationResult,
} from './types/validation-result.js';

// ── PriorRating (§20) ─────────────────────────────────────────────────────
export type { PriorRatingConditions, PriorRating } from './types/prior-rating.js';

// ── League strength factor (§10.3) ────────────────────────────────────────
export type {
  LeagueStrengthConfidenceLevel,
  LeagueStrengthFactorRecord,
} from './types/league-strength.js';

// ── PredictionResponse (§21) ──────────────────────────────────────────────
export type {
  ScorelineCellProbability,
  ScorelineKey,
  RawMatchDistribution,
  Raw1x2Probs,
  Calibrated1x2Probs,
  PredictedResult,
  ScorelineProbability,
  TopScorelinesOutput,
  PredictionCore,
  PredictionSecondary,
  PredictionExplainability,
  PredictionOutputs,
  PredictionResponseInternals,
  PredictionResponseEligible,
  PredictionResponseNotEligible,
  PredictionResponse,
  PredictionResponsePublic,
  DerivedRawOutputs,
  DerivedCalibratedOutputs,
} from './types/prediction-response.js';

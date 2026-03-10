/**
 * Global constants for the SportPulse Predictive Engine v1.
 *
 * All values are sourced directly from spec §4 (Global Constants).
 * These are compile-time constants — no logic, no computation.
 */

// ── §4.1 Numerical tolerances ──────────────────────────────────────────────

/** Minimum probability value used for numerical stability checks. §4.1 */
export const EPSILON_PROBABILITY: number = 1e-9;

/** Minimum value used as denominator guard for DNB market calculations. §4.1 */
export const EPSILON_DNB_DENOMINATOR: number = 1e-9;

// ── §4.3 Operative thresholds ─────────────────────────────────────────────

/**
 * Minimum number of recently completed official matches required for a CLUB
 * team to be considered eligible without a prior rating. §4.3, §7.4
 */
export const MIN_RECENT_MATCHES_CLUB: number = 5;

/**
 * Minimum number of recently completed official matches required for a
 * NATIONAL_TEAM to be considered eligible without a prior rating. §4.3, §7.4
 */
export const MIN_RECENT_MATCHES_NATIONAL_TEAM: number = 5;

/**
 * Number of recent matches a CLUB team must have to receive STRONG
 * applicability level. §4.3, §13
 */
export const STRONG_RECENT_MATCHES_CLUB: number = 12;

/**
 * Number of recent matches a NATIONAL_TEAM must have to receive STRONG
 * applicability level. §4.3, §13
 */
export const STRONG_RECENT_MATCHES_NATIONAL_TEAM: number = 8;

/**
 * Maximum allowed tail mass in the raw scoreline matrix before the system
 * must take a versioned policy action (expand grid, degrade, or audit). §4.3, §14.2
 */
export const MAX_TAIL_MASS_RAW: number = 0.01;

/**
 * Maximum age in days for a prior rating to be considered utilizable. §4.3, §20.2
 */
export const PRIOR_RATING_MAX_AGE_DAYS: number = 400;

/**
 * Minimum number of rating update events within the last 730 days required for
 * a prior rating to be considered utilizable. §4.3, §20.2
 */
export const PRIOR_RATING_MIN_UPDATES_LAST_730D: number = 3;

/**
 * Whether carry of prior rating across season boundaries is permitted. §4.3, §20.2
 */
export const PRIOR_RATING_CROSS_SEASON_CARRY_ALLOWED: boolean = true;

/**
 * Default business-level indecision threshold for predicted_result. If the
 * margin between the top-1 and top-2 calibrated probabilities is below this
 * value, the result is classified as TOO_CLOSE. §4.3, §16.12
 */
export const TOO_CLOSE_MARGIN_THRESHOLD_DEFAULT: number = 0.02;

/**
 * Confidence levels that qualify for STRONG bridging in international club
 * tournaments. §4.3, §13
 */
export const STRONG_BRIDGING_CONFIDENCE_LEVELS: ReadonlyArray<'HIGH' | 'MEDIUM'> = [
  'HIGH',
  'MEDIUM',
];

/**
 * Minimum number of samples in a calibration bucket required for the bucket
 * to be evaluated. §4.3
 */
export const MIN_BUCKET_SAMPLE_FOR_CALIBRATION_EVAL: number = 100;

// ── §14.2 Scoreline matrix ─────────────────────────────────────────────────

/**
 * Default maximum goal count per side in the scoreline matrix (0..matrix_max_goal).
 * The matrix covers (matrix_max_goal+1)^2 cells. §14.2
 */
export const MATRIX_MAX_GOAL_DEFAULT: number = 7;

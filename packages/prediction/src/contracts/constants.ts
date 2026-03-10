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

// ── §7.5 / §7.6 Official / senior / 11v11 competition catalog ──────────────

/**
 * Authoritative set of competition IDs confirmed as official, senior, and
 * 11v11 for the SportPulse v1 MVP scope.
 *
 * §7.6: "la clasificación de partido como oficial, senior, 11v11 no viene
 * resuelta por flags ad hoc del MatchInput, sino por un catálogo confiable de
 * competición asociado a competition_id y season_id."
 *
 * §7.6 invariant: queda PROHIBIDO inferir esta clasificación por heurística
 * blanda o por nombre libre del torneo.
 *
 * This catalog covers all ID representations used across the system:
 *   - Short codes (PD, PL, BL1, 4432) — as supplied by the prediction engine
 *   - Namespaced forms (comp:football-data:PD, comp:thesportsdb:4432) — as used
 *     by the server routing layer
 *
 * Any competition_id NOT in this set → catalog_confirms_official_senior_11v11 = false
 * → NOT_ELIGIBLE per §7.6.
 *
 * To add a new competition: update this set AND bump policyVersion (scoring
 * semantics change gate per SDD versioning rules).
 */
export const OFFICIAL_SENIOR_11V11_COMPETITION_IDS: ReadonlySet<string> = new Set([
  // ── LaLiga (football-data.org competition code PD) ──────────────────────
  'PD',
  'comp:football-data:PD',

  // ── Premier League (football-data.org competition code PL) ──────────────
  'PL',
  'comp:football-data:PL',

  // ── Bundesliga (football-data.org competition code BL1) ─────────────────
  'BL1',
  'comp:football-data:BL1',

  // ── Liga Uruguaya (TheSportsDB league ID 4432) ───────────────────────────
  '4432',
  'TheSportsDB:4432',
  'comp:thesportsdb:4432',
]);

/**
 * Returns true iff the given competition_id is in the authoritative catalog
 * of official / senior / 11v11 competitions for the MVP v1 scope.
 *
 * This is the ONLY permitted way to resolve catalog_confirms_official_senior_11v11
 * for a MatchValidationContext. Callers MUST NOT pass true without calling this
 * function (or an equivalent authoritative source).
 *
 * §7.6: "si el catálogo no permite determinar que el partido pertenece a una
 * competición oficial senior 11v11, el partido debe pasar a NOT_ELIGIBLE."
 */
export function isKnownOfficialSenior11v11(competition_id: string): boolean {
  return OFFICIAL_SENIOR_11V11_COMPETITION_IDS.has(competition_id);
}

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

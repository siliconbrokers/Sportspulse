/**
 * PredictionResponse v1 — Prediction engine output contract.
 *
 * Spec authority: §21 (Envelope de salida — PredictionResponse v1),
 *                 §15 (Outputs obligatorios del v1),
 *                 §16 (Fórmulas de outputs derivados),
 *                 §19 (Invariantes y validaciones matemáticas obligatorias)
 *
 * DESIGN NOTES:
 *
 * 1. DISCRIMINATED UNION FOR ELIGIBILITY (§21.1):
 *    `PredictionResponse` is a discriminated union on `eligibility_status`.
 *    When eligibility_status = 'NOT_ELIGIBLE', the `predictions` field is
 *    structurally absent at the TYPE level (not just null). This makes the
 *    spec's invariant "queda prohibido devolver probabilidades parciales
 *    cuando el partido es NOT_ELIGIBLE" unrepresentable — you cannot construct
 *    a NOT_ELIGIBLE response with a predictions field.
 *
 * 2. RAW VS CALIBRATED TYPE INCOMPATIBILITY (§19.5):
 *    `RawMatchDistribution`, `Raw1x2Probs`, and `Calibrated1x2Probs` are
 *    DISTINCT branded types. They cannot be assigned to each other even
 *    though all three contain number fields with probability values.
 *    This enforces the spec invariant: "queda prohibido etiquetar como
 *    calibrado cualquier output no cubierto por una calibración específica".
 *
 * 3. INTERNALS ISOLATION (§22.3):
 *    `PredictionResponseInternals` is a separate named type. The public
 *    API surface type `PredictionResponsePublic` is defined WITHOUT the
 *    `internals` field. The full `PredictionResponse` type (used in internal
 *    pipeline) extends public with internals. External consumers of the API
 *    must use `PredictionResponsePublic` — they will receive a type error if
 *    they try to access internals.
 *
 * 4. LIMITED_MODE structural constraint (§11.3, §21.3):
 *    In LIMITED_MODE, `predictions.core` must be present (§21.3). The type
 *    reflects this: `predictions` cannot be null when eligibility_status =
 *    'ELIGIBLE', and `predictions.core` is required (not optional).
 *    `predictions.secondary` and `predictions.explainability` can be null.
 *
 * 5. SCORE MODEL TYPE (§21):
 *    The spec fixes v1 to "INDEPENDENT_POISSON" as a string literal in the
 *    internals block. This is encoded as a literal type.
 *
 * 6. RawMatchDistribution (§14.2):
 *    The v1 matrix covers goals 0..7 for both home and away = 8×8 = 64 cells.
 *    Modeled as a branded Record to allow both index access and type safety.
 */

import type { OperatingMode, ApplicabilityLevel } from './operating-mode.js';
import type { ReasonCode } from './validation-result.js';

// ── Branding helpers ──────────────────────────────────────────────────────

declare const RawBrand: unique symbol;
declare const CalibratedBrand: unique symbol;

// ── Raw match distribution ────────────────────────────────────────────────

/**
 * A single cell in the scoreline matrix: P(home_goals = i, away_goals = j).
 * Each value must be in [0, 1]. §14.2, §19.2
 */
export type ScorelineCellProbability = number & { readonly [RawBrand]: 'scoreline_cell' };

/**
 * Scoreline key in the format "i-j" where i = home goals, j = away goals.
 * Both i and j range from 0 to matrix_max_goal (default 7). §14.2
 */
export type ScorelineKey = string;

/**
 * Raw match distribution: the 8×8 (or NxN) matrix of P(i, j).
 *
 * Derived from lambda_home and lambda_away using INDEPENDENT_POISSON. §14.1
 * This type is BRANDED and is structurally incompatible with Calibrated1x2Probs.
 * Keys are scoreline strings in format "i-j".
 * Sum of all cells must equal 1 ± epsilon_probability after renormalization. §19.2
 * Spec §14.2, §19.2
 */
export type RawMatchDistribution = Readonly<Record<ScorelineKey, number>> & {
  readonly [RawBrand]: 'raw_match_distribution';
};

/**
 * Raw 1X2 probabilities aggregated from RawMatchDistribution.
 *
 * raw_p_home_win = Σ P(i,j) where i > j
 * raw_p_draw     = Σ P(i,j) where i = j
 * raw_p_away_win = Σ P(i,j) where i < j
 *
 * BRANDED: Cannot be assigned to Calibrated1x2Probs. §16.1, §19.1
 * Spec §16.1
 */
export interface Raw1x2Probs {
  readonly [RawBrand]: 'raw_1x2';
  home: number;
  draw: number;
  away: number;
}

/**
 * Calibrated 1X2 probabilities — OUTPUT of the isotonic calibration layer.
 *
 * These are the visible probabilities exposed to users. §16.2
 * BRANDED: Cannot be assigned to Raw1x2Probs. §19.5
 *
 * Invariant: abs((home + draw + away) - 1) <= epsilon_probability. §19.1
 * Spec §16.2, §17, §19.1, §19.5
 */
export interface Calibrated1x2Probs {
  readonly [CalibratedBrand]: 'calibrated_1x2';
  home: number;
  draw: number;
  away: number;
}

// ── Predicted result ──────────────────────────────────────────────────────

/**
 * Possible values for the predicted outcome of a match.
 *
 * TOO_CLOSE is assigned when decision_margin < too_close_margin_threshold.
 * Spec §16.12
 */
export type PredictedResult = 'HOME' | 'DRAW' | 'AWAY' | 'TOO_CLOSE';

// ── Scoreline output types ────────────────────────────────────────────────

/**
 * A single scoreline with its probability.
 * score is a string like "2-1". p is a raw probability in [0, 1].
 * Spec §15.3, §16.11
 */
export interface ScorelineProbability {
  score: string;
  p: number;
}

/**
 * Top-5 scorelines ordered by probability descending. §15.3, §16.11
 */
export type TopScorelinesOutput = readonly ScorelineProbability[];

// ── Core prediction outputs ───────────────────────────────────────────────

/**
 * Nucleus of visible prediction outputs.
 *
 * `predictions.core` must be present for any ELIGIBLE match (§21.3).
 * However, calibration-derived fields (p_home_win, p_draw, p_away_win,
 * predicted_result, predicted_result_conflict, favorite_margin, draw_risk)
 * MUST be null in LIMITED_MODE because calibration is not applied in that mode.
 * Per §16.2: "los outputs visibles 1X2 deben ser calibrated_1x2_probs" — raw
 * probabilities are explicitly prohibited from occupying these fields.
 *
 * Only expected_goals_home and expected_goals_away (lambda-derived, not
 * calibration-derived) are always non-null for any ELIGIBLE match.
 *
 * Sources per §19.5:
 * - p_home_win, p_draw, p_away_win: from calibrated_1x2_probs (null in LIMITED_MODE)
 * - expected_goals_home, expected_goals_away: from raw (lambda values) — always present
 * - predicted_result, favorite_margin, draw_risk: derived from calibrated (null in LIMITED_MODE)
 *
 * Spec §15.1, §16.2, §16.12, §16.13, §21, §21.3
 */
export interface PredictionCore {
  /**
   * Calibrated probability of home team winning 90'. §16.2
   * Null in LIMITED_MODE — calibration not applied; raw probs must never fill this field.
   */
  p_home_win: number | null;
  /**
   * Calibrated probability of a draw after 90'. §16.2
   * Null in LIMITED_MODE — calibration not applied.
   */
  p_draw: number | null;
  /**
   * Calibrated probability of away team winning 90'. §16.2
   * Null in LIMITED_MODE — calibration not applied.
   */
  p_away_win: number | null;

  /** Expected goals for home team (= lambda_home in Poisson v1 baseline). §15.1 — always present */
  expected_goals_home: number;
  /** Expected goals for away team (= lambda_away in Poisson v1 baseline). §15.1 — always present */
  expected_goals_away: number;

  /**
   * Predicted match result. TOO_CLOSE when decision_margin < threshold.
   * Null in LIMITED_MODE — requires calibrated probs.
   * §15.1, §16.12
   */
  predicted_result: PredictedResult | null;

  /**
   * True when predicted_result = TOO_CLOSE. False otherwise.
   * Null in LIMITED_MODE — requires calibrated probs.
   * §15.1, §16.12
   */
  predicted_result_conflict: boolean | null;

  /**
   * top_1_calibrated_prob - top_2_calibrated_prob.
   * Always >= 0. Calculated on non-rounded values.
   * Null in LIMITED_MODE — requires calibrated probs.
   * §15.1, §16.13
   */
  favorite_margin: number | null;

  /**
   * draw_risk = p_draw (convenience alias exposed at core level).
   * Null in LIMITED_MODE — requires calibrated probs.
   * §15.1, §16.11
   */
  draw_risk: number | null;
}

// ── Secondary (derived) outputs ───────────────────────────────────────────

/**
 * Secondary derived prediction outputs.
 *
 * 1X2-consistent outputs (derived from calibrated_1x2_probs): §16.3, §16.4
 * Goal/scoreline outputs (derived from raw_match_distribution): §16.5–§16.10
 *
 * All fields are optional (?) and nullable because:
 * - In LIMITED_MODE, this entire block may be null (§21.3).
 * - Even in FULL_MODE, dnb_home/dnb_away may be null when p_draw >= 1 - epsilon.
 *
 * Spec §15.2, §16.3–§16.10, §21
 */
export interface PredictionSecondary {
  // ── Double chance (from calibrated_1x2_probs) ──────────────────────────
  /** p_home_win + p_draw. §16.3 */
  home_or_draw?: number | null;
  /** p_draw + p_away_win. §16.3 */
  draw_or_away?: number | null;
  /** p_home_win + p_away_win. §16.3 */
  home_or_away?: number | null;

  // ── Draw No Bet (from calibrated_1x2_probs) ────────────────────────────
  /** p_home_win / (1 - p_draw). Null if 1 - p_draw <= epsilon_dnb_denominator. §16.4 */
  dnb_home?: number | null;
  /** p_away_win / (1 - p_draw). Null if 1 - p_draw <= epsilon_dnb_denominator. §16.4 */
  dnb_away?: number | null;

  // ── Goal totals (from raw_match_distribution) ─────────────────────────
  /** P(i + j >= 3). §16.5 */
  over_2_5?: number | null;
  /** P(i + j <= 2). §16.5 */
  under_2_5?: number | null;
  /** P(i + j >= 2). §16.5 */
  over_1_5?: number | null;
  /** P(i + j <= 3). §16.5 */
  under_3_5?: number | null;

  // ── BTTS (from raw_match_distribution) ───────────────────────────────
  /** P(i >= 1 and j >= 1). §16.6 */
  btts_yes?: number | null;
  /** 1 - btts_yes. §16.6 */
  btts_no?: number | null;

  // ── Team goal totals (from raw_match_distribution) ────────────────────
  /** P(i >= 1). §16.7 */
  team_home_over_0_5?: number | null;
  /** P(j >= 1). §16.7 */
  team_away_over_0_5?: number | null;
  /** P(i >= 2). §16.7 */
  team_home_over_1_5?: number | null;
  /** P(j >= 2). §16.7 */
  team_away_over_1_5?: number | null;

  // ── Clean sheets (from raw_match_distribution) ────────────────────────
  /** P(j = 0). §16.8 */
  clean_sheet_home?: number | null;
  /** P(i = 0). §16.8 */
  clean_sheet_away?: number | null;

  // ── Win to nil (from raw_match_distribution) ──────────────────────────
  /** Σ P(i,j) where i > j and j = 0. §16.9 */
  win_to_nil_home?: number | null;
  /** Σ P(i,j) where j > i and i = 0. §16.9 */
  win_to_nil_away?: number | null;

  // ── Low scoring risk (from raw_match_distribution) ────────────────────
  /** P(0,0) + P(1,0) + P(0,1) + P(1,1). §16.10 */
  low_scoring_risk?: number | null;
}

// ── Explainability outputs ────────────────────────────────────────────────

/**
 * Explainability outputs for scoreline interpretation.
 *
 * May be partial or null in LIMITED_MODE. §21.3
 * All values are derived from raw_match_distribution. §19.5
 * Spec §15.3, §16.11
 */
export interface PredictionExplainability {
  /**
   * The scoreline string with the highest P(i,j) in the current matrix.
   * Must belong to the active matrix. §16.11, §19.2
   */
  most_likely_scoreline?: string | null;

  /**
   * Top 5 scorelines ordered by probability descending.
   * §15.3, §16.11
   */
  top_scorelines?: TopScorelinesOutput | null;
}

// ── Predictions container ─────────────────────────────────────────────────

/**
 * Container for all visible prediction outputs.
 *
 * `core` is always required when predictions is present (§21.3).
 * `secondary` and `explainability` may be null in LIMITED_MODE.
 * Spec §21
 */
export interface PredictionOutputs {
  /** Required in both FULL_MODE and LIMITED_MODE. §21.3 */
  core: PredictionCore;

  /**
   * Required in FULL_MODE (except explicit math exceptions like null DNB).
   * May be null in LIMITED_MODE. §21.3
   */
  secondary?: PredictionSecondary | null;

  /**
   * Required in FULL_MODE.
   * May be null in LIMITED_MODE. §21.3
   */
  explainability?: PredictionExplainability | null;
}

// ── Internal pipeline data ────────────────────────────────────────────────

/**
 * Internal pipeline data — NEVER exposed via the public API type surface.
 *
 * This type is Priority C (§22.3). It must ONLY be accessible within the
 * internal pipeline. External consumers must use PredictionResponsePublic,
 * which does not include this field.
 *
 * Contains raw lambdas, raw and calibrated 1X2 vectors, Elo values, and
 * model metadata required for reconstruction and audit. §15.4, §21
 */
export interface PredictionResponseInternals {
  /** Home team Elo before this match. §15.4 */
  elo_home_pre: number;
  /** Away team Elo before this match. §15.4 */
  elo_away_pre: number;
  /** elo_home_pre - elo_away_pre. §15.4 */
  elo_diff: number;

  /**
   * Raw 1X2 probabilities aggregated from raw_match_distribution.
   * Distinct from calibrated_1x2_probs. §15.4, §19.5
   */
  raw_1x2_probs: {
    home: number;
    draw: number;
    away: number;
  };

  /**
   * Calibrated 1X2 probabilities — source for all visible 1X2-consistent outputs.
   * Distinct from raw_1x2_probs. §15.4, §16.2, §19.5
   * Null in LIMITED_MODE (calibration not applied — raw MUST NOT substitute here).
   */
  calibrated_1x2_probs: {
    home: number;
    draw: number;
    away: number;
  } | null;

  /** Lambda (expected goals) for home team before any normalization. §15.4 */
  lambda_home: number;
  /** Lambda (expected goals) for away team before any normalization. §15.4 */
  lambda_away: number;

  /**
   * Tail mass NOT captured by the truncated matrix (1 - Σ P(i,j)).
   * Must be persisted always. §14.3, §15.4, §19.2
   */
  tail_mass_raw: number;

  /**
   * Maximum goal count per side used in the scoreline matrix.
   * Default 7 (matrix covers goals 0..7). §14.2, §15.4
   */
  matrix_max_goal: number;

  /**
   * Computed home advantage adjustment applied to this match.
   * 0 if neutral_venue = true with full adjustment. §15.4
   */
  home_advantage_effect: number;

  /**
   * Score model type used. Literal "INDEPENDENT_POISSON" in v1. §21
   */
  score_model_type: 'INDEPENDENT_POISSON';

  /**
   * Calibration mode applied for this prediction. §17.2
   * - 'bootstrap': identity calibrator in use — no historical calibration data available.
   *                The system passes raw probs through unchanged before renormalization.
   *                Must be declared explicitly so consumers know calibration is not trained.
   * - 'trained':  a fitted isotonic calibrator was applied (segmented, intermediate, or global).
   * - 'not_applied': calibration was not applied because operating_mode = LIMITED_MODE.
   */
  calibration_mode: 'bootstrap' | 'trained' | 'not_applied';
}

// ── Common header fields ──────────────────────────────────────────────────

/**
 * Fields present in ALL prediction responses, regardless of eligibility.
 * These are the versioning and identification envelope. §21
 */
interface PredictionResponseHeader {
  /** Match this response applies to. §21 */
  match_id: string;

  /** Version identifier of the prediction model. §17.4, §21 */
  model_version: string;

  /** Version identifier of the calibration applied. §17.4, §21 */
  calibration_version: string;

  /** Version identifier of the competition profile used. §8.1, §21 */
  competition_profile_version: string;

  /**
   * Version of the league strength factor record applied, if any.
   * Null if no bridging was applied (non-INTERNATIONAL_CLUB). §10.3, §21
   */
  league_strength_factor_version?: string | null;

  /** Version identifier of the decision policy (controls predicted_result logic). §17.4, §21 */
  decision_policy_version: string;

  /**
   * The indecision threshold used for this specific response.
   * Persisted so predicted_result can be reconstructed deterministically. §17.4, §21
   */
  too_close_margin_threshold: number;

  /**
   * Current operating mode for this response.
   * §11, §21
   */
  operating_mode: OperatingMode;

  /**
   * Applicability level for any prediction in this response.
   * §13, §21
   */
  applicability_level: ApplicabilityLevel;

  /**
   * Reason codes for degradation or failure.
   * Must contain at least one entry when eligibility_status = NOT_ELIGIBLE.
   * §11.2, §21
   */
  reasons: ReasonCode[];
}

// ── Discriminated union variants ──────────────────────────────────────────

/**
 * Response when a match IS eligible for prediction.
 *
 * `eligibility_status = 'ELIGIBLE'` is the discriminant.
 * `predictions` MUST be present (never null or undefined for ELIGIBLE).
 * §21, §21.3
 */
export interface PredictionResponseEligible extends PredictionResponseHeader {
  eligibility_status: 'ELIGIBLE';
  /** Always present for ELIGIBLE matches. Core is required; secondary/explainability may be null in LIMITED_MODE. */
  predictions: PredictionOutputs;
  /** Internal pipeline data. Never included in PredictionResponsePublic. §22.3 */
  internals?: PredictionResponseInternals | null;
}

/**
 * Response when a match is NOT eligible for prediction.
 *
 * `eligibility_status = 'NOT_ELIGIBLE'` is the discriminant.
 * `predictions` is STRUCTURALLY ABSENT — this field does not exist on this type.
 * This makes it impossible to accidentally populate probability fields. §21.1
 *
 * Spec §21.1, §21.2
 */
export interface PredictionResponseNotEligible extends PredictionResponseHeader {
  eligibility_status: 'NOT_ELIGIBLE';
  /**
   * `predictions` is intentionally absent on this variant.
   * The spec states: "predictions = null" but also "queda prohibido devolver
   * probabilidades parciales". Structural absence is stronger than null.
   * §21.1 — internals is required and must be explicitly null (never omitted).
   */
  internals: null;
}

/**
 * Full PredictionResponse v1 — discriminated union on eligibility_status.
 *
 * Use `response.eligibility_status === 'ELIGIBLE'` to narrow to the variant
 * that has the `predictions` field.
 *
 * Spec §21
 */
export type PredictionResponse = PredictionResponseEligible | PredictionResponseNotEligible;

// ── Public API surface type ───────────────────────────────────────────────

/**
 * Public-facing prediction response type.
 *
 * `internals` is OMITTED from this type. External API consumers must use
 * this type, not PredictionResponse. This prevents accidental exposure of
 * Priority C internal fields via the API layer. §22.3
 *
 * The API layer must serialize using this type, never PredictionResponse directly.
 */
export type PredictionResponsePublic =
  | Omit<PredictionResponseEligible, 'internals'>
  | Omit<PredictionResponseNotEligible, 'internals'>;

// ── Derived raw output helpers (for internal pipeline use) ────────────────

/**
 * Bundle of raw-derived outputs computed from raw_match_distribution.
 *
 * These are for internal pipeline stages only. They feed into PredictionSecondary
 * for goal/scoreline fields. §19.5
 */
export interface DerivedRawOutputs {
  // Totals
  over_2_5: number;
  under_2_5: number;
  over_1_5: number;
  under_3_5: number;

  // BTTS
  btts_yes: number;
  btts_no: number;

  // Team totals
  team_home_over_0_5: number;
  team_away_over_0_5: number;
  team_home_over_1_5: number;
  team_away_over_1_5: number;

  // Clean sheets
  clean_sheet_home: number;
  clean_sheet_away: number;

  // Win to nil
  win_to_nil_home: number;
  win_to_nil_away: number;

  // Low scoring
  low_scoring_risk: number;

  // Scoreline explainability
  most_likely_scoreline: string;
  top_scorelines: TopScorelinesOutput;
}

/**
 * Bundle of calibrated-derived outputs computed from calibrated_1x2_probs.
 *
 * These are for internal pipeline stages only. They feed into PredictionSecondary
 * for 1X2-consistent fields. §19.5
 */
export interface DerivedCalibratedOutputs {
  // Double chance
  home_or_draw: number;
  draw_or_away: number;
  home_or_away: number;

  // Draw No Bet (null when denominator <= epsilon)
  dnb_home: number | null;
  dnb_away: number | null;
}

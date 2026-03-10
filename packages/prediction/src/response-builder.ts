/**
 * response-builder.ts — assemble PredictionResponse v1 from pipeline outputs.
 *
 * Spec authority:
 *   §21   — Envelope de salida PredictionResponse v1
 *   §21.1 — NOT_ELIGIBLE: predictions structurally absent
 *   §21.3 — LIMITED_MODE: core required, secondary/explainability null
 *   §15.1 — Core outputs (calibrated 1X2, expected_goals, predicted_result)
 *   §15.2 — Secondary outputs
 *   §15.3 — Explainability outputs
 *   §15.4 — Internal pipeline fields (never in public surface)
 *   §16.2 — Calibrated 1X2 probs are the source for visible 1X2 outputs
 *   §17.4 — model_version, calibration_version, decision_policy_version always present
 *   §19.5 — raw_1x2_probs and calibrated_1x2_probs in SEPARATE fields
 *   §22.3 — internals: Priority C, never exposed via PredictionResponsePublic
 *
 * Invariants enforced:
 *   - raw_match_distribution NEVER in the public response (only in internals)
 *   - calibrated_1x2_probs and raw_1x2_probs are in distinct fields
 *   - model_version, calibration_version, decision_policy_version always present in FULL_MODE
 *   - NOT_ELIGIBLE response has no predictions field (discriminated union)
 */

import type { MatchInput } from './contracts/types/match-input.js';
import type { ValidationResult } from './contracts/types/validation-result.js';
import type {
  PredictionResponse,
  PredictionResponseEligible,
  PredictionResponseNotEligible,
  PredictionResponseInternals,
  PredictionCore,
  PredictionSecondary,
  PredictionExplainability,
  PredictionOutputs,
  Raw1x2Probs,
  Calibrated1x2Probs,
  DerivedRawOutputs,
  DerivedCalibratedOutputs,
} from './contracts/types/prediction-response.js';
import type { CalibrationVersionMetadata } from './calibration/version-metadata.js';
import type { PredictedResultOutput } from './engine/decision-policy.js';
import type { RawMatchDistributionResult } from './engine/scoreline-matrix.js';
import type { LambdaResult } from './engine/lambda-computer.js';
import type { EffectiveEloResult } from './engine/elo-rating.js';

// ── Parameter types ────────────────────────────────────────────────────────

/**
 * Raw engine outputs computed from the pipeline.
 * Available in both FULL_MODE and LIMITED_MODE (lambdas + raw distribution).
 * §14.1, §14.2, §16.1
 */
export interface RawEngineOutputs {
  /** Lambda result from computeLambdas — used for expected_goals. §14.1, §15.1 */
  readonly lambdaResult: LambdaResult;

  /** Raw match distribution result. raw_match_distribution stays in internals only. §14.2, §22.3 */
  readonly distributionResult: RawMatchDistributionResult;

  /** Aggregated raw 1X2 probabilities from the distribution. §16.1 */
  readonly raw1x2: Raw1x2Probs;

  /** Derived raw outputs (goal markets, BTTS, scoreline explainability). §16.5–§16.11 */
  readonly derivedRaw: DerivedRawOutputs;

  /** Effective Elo values used — for internals block. §15.4 */
  readonly effectiveElo?: {
    readonly home: number;
    readonly away: number;
    readonly homAdvantageEffect: number;
  };
}

/**
 * Calibrated outputs, available in FULL_MODE only (not LIMITED_MODE).
 * §17.1, §16.2–§16.4, §16.12, §16.13
 */
export interface CalibratedOutputs {
  /** Calibrated 1X2 probabilities. Source for all visible 1X2-consistent outputs. §16.2 */
  readonly calibrated1x2: Calibrated1x2Probs;

  /** Derived calibrated outputs (double chance, DNB). §16.3, §16.4 */
  readonly derivedCalibrated: DerivedCalibratedOutputs;

  /** Predicted result output (predicted_result, favorite_margin). §16.12, §16.13 */
  readonly predictedResult: PredictedResultOutput;
}

/**
 * Parameters for buildPredictionResponse.
 * Spec §21
 */
export interface BuildPredictionResponseParams {
  matchInput: MatchInput;
  validationResult: ValidationResult;
  /** Present when eligibility_status = 'ELIGIBLE'. Undefined for NOT_ELIGIBLE. */
  engineOutputs?: RawEngineOutputs;
  /** Present in FULL_MODE only. Undefined in LIMITED_MODE and NOT_ELIGIBLE. */
  calibratedOutputs?: CalibratedOutputs;
  versionMetadata: CalibrationVersionMetadata;
}

// ── Main builder ──────────────────────────────────────────────────────────

/**
 * Assemble the final PredictionResponse v1 from pipeline outputs.
 *
 * Delegates to one of three builders based on eligibility_status and operating_mode:
 *   - NOT_ELIGIBLE   → buildNotEligibleResponse
 *   - LIMITED_MODE   → buildLimitedModeResponse
 *   - FULL_MODE      → buildFullModeResponse
 *
 * Spec §21, §21.1, §21.3
 */
export function buildPredictionResponse(params: BuildPredictionResponseParams): PredictionResponse {
  const { matchInput, validationResult, engineOutputs, calibratedOutputs, versionMetadata } =
    params;

  if (validationResult.eligibility_status === 'NOT_ELIGIBLE') {
    return buildNotEligibleResponse(matchInput, validationResult, versionMetadata);
  }

  // ELIGIBLE — determine operating mode
  if (validationResult.operating_mode === 'LIMITED_MODE') {
    // Limited mode: core required, secondary/explainability null
    // engineOutputs must be present (caller guarantees this for ELIGIBLE)
    return buildLimitedModeResponse(matchInput, validationResult, engineOutputs!, versionMetadata);
  }

  // FULL_MODE — all outputs present
  return buildFullModeResponse(
    matchInput,
    validationResult,
    engineOutputs!,
    calibratedOutputs!,
    versionMetadata,
  );
}

// ── NOT_ELIGIBLE builder ──────────────────────────────────────────────────

/**
 * Build a PredictionResponseNotEligible.
 *
 * The `predictions` field is structurally absent on this type — enforced at
 * the type level. §21.1
 */
function buildNotEligibleResponse(
  matchInput: MatchInput,
  validationResult: ValidationResult,
  versionMetadata: CalibrationVersionMetadata,
): PredictionResponseNotEligible {
  return {
    match_id: matchInput.match_id,
    eligibility_status: 'NOT_ELIGIBLE',
    model_version: versionMetadata.model_version,
    calibration_version: versionMetadata.calibration_version,
    competition_profile_version: matchInput.competition_profile.competition_profile_version,
    league_strength_factor_version: null,
    decision_policy_version: versionMetadata.decision_policy_version,
    too_close_margin_threshold: versionMetadata.too_close_margin_threshold,
    operating_mode: validationResult.operating_mode,
    applicability_level: validationResult.applicability_level,
    reasons: validationResult.reasons,
    internals: null,
  };
}

// ── LIMITED_MODE builder ──────────────────────────────────────────────────

/**
 * Build a PredictionResponseEligible in LIMITED_MODE.
 *
 * In LIMITED_MODE: core present (from raw lambdas only, no calibration).
 * secondary and explainability are null. §21.3
 *
 * Note: In LIMITED_MODE, calibration is not applied. The core probabilities
 * are taken directly from raw_1x2_probs since calibrated outputs are unavailable.
 * §11.3: "predictions.core debe estar presente"
 *
 * When called with tailMassExceeded = true (tail mass policy v1, §14.2), the
 * reason EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS is already present in
 * validationResult.reasons (added by the caller before delegating here).
 * tail_mass_policy_version: 1
 */
function buildLimitedModeResponse(
  matchInput: MatchInput,
  validationResult: ValidationResult,
  engineOutputs: RawEngineOutputs,
  versionMetadata: CalibrationVersionMetadata,
): PredictionResponseEligible {
  // Tail mass policy v1 (§14.2): if tailMassExceeded and the reason is not yet
  // in validationResult.reasons, add it now. This handles the case where
  // LIMITED_MODE was already the operating_mode from validation (not a degradation
  // from FULL_MODE), but the matrix still exceeded the tail mass threshold.
  const hasTailReason = validationResult.reasons.includes(
    'EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS',
  );
  const effectiveReasons: ValidationResult['reasons'] =
    engineOutputs.distributionResult.tailMassExceeded && !hasTailReason
      ? [...validationResult.reasons, 'EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS']
      : validationResult.reasons;

  const { lambdaResult, raw1x2, derivedRaw } = engineOutputs;

  // In LIMITED_MODE, core uses raw probabilities as best available estimate.
  // TOO_CLOSE is used as predicted_result since no calibration → no reliable decision.
  // favorite_margin computed on raw probs, draw_risk from raw p_draw. §21.3
  const rawProbs = [
    { class: 'HOME' as const, p: raw1x2.home },
    { class: 'DRAW' as const, p: raw1x2.draw },
    { class: 'AWAY' as const, p: raw1x2.away },
  ].sort((a, b) => b.p - a.p);

  const top1 = rawProbs[0]!.p;
  const top2 = rawProbs[1]!.p;
  const favoriteMargin = top1 - top2;
  const tooClose = favoriteMargin < versionMetadata.too_close_margin_threshold;

  const core: PredictionCore = {
    // §21.3: In LIMITED_MODE, use raw_1x2_probs as the best available estimate.
    // These are raw (not calibrated) — the LIMITED_MODE reason codes explain why.
    p_home_win: raw1x2.home,
    p_draw: raw1x2.draw,
    p_away_win: raw1x2.away,
    expected_goals_home: lambdaResult.lambda_home,
    expected_goals_away: lambdaResult.lambda_away,
    predicted_result: tooClose ? 'TOO_CLOSE' : rawProbs[0]!.class,
    predicted_result_conflict: tooClose,
    favorite_margin: favoriteMargin,
    draw_risk: raw1x2.draw,
  };

  const predictions: PredictionOutputs = {
    core,
    secondary: null,
    explainability: null,
  };

  // Internals: persist raw data for audit. §15.4, §22.3
  const internals: PredictionResponseInternals = buildInternals(
    engineOutputs,
    null, // no calibrated probs in LIMITED_MODE
    versionMetadata,
  );

  return {
    match_id: matchInput.match_id,
    eligibility_status: 'ELIGIBLE',
    model_version: versionMetadata.model_version,
    calibration_version: versionMetadata.calibration_version,
    competition_profile_version: matchInput.competition_profile.competition_profile_version,
    league_strength_factor_version: null,
    decision_policy_version: versionMetadata.decision_policy_version,
    too_close_margin_threshold: versionMetadata.too_close_margin_threshold,
    operating_mode: validationResult.operating_mode,
    applicability_level: validationResult.applicability_level,
    reasons: effectiveReasons,
    predictions,
    internals,
  };
}

// ── FULL_MODE builder ─────────────────────────────────────────────────────

/**
 * Build a PredictionResponseEligible in FULL_MODE.
 *
 * All outputs present: core, secondary, explainability, internals. §21
 * model_version, calibration_version, decision_policy_version always present. §17.4
 *
 * Tail mass policy v1 (§14.2):
 *   When tailMassExceeded = true, the scoreline matrix was truncated beyond the
 *   maximum allowed threshold. Explainability outputs derived from this matrix
 *   are not reliable. Policy v1 action:
 *     1. Degrade operating_mode to LIMITED_MODE (even if validation said FULL_MODE).
 *     2. Omit explainability (null) — scorelines from a truncated matrix are unreliable.
 *     3. Emit EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS in reasons.
 *   §14.2: "queda prohibido renormalizar silenciosamente una matriz truncada
 *           cuya masa omitida supere el umbral máximo permitido."
 *   tail_mass_policy_version: 1
 */
function buildFullModeResponse(
  matchInput: MatchInput,
  validationResult: ValidationResult,
  engineOutputs: RawEngineOutputs,
  calibratedOutputs: CalibratedOutputs,
  versionMetadata: CalibrationVersionMetadata,
): PredictionResponseEligible {
  // ── Tail mass policy v1 check (§14.2) ─────────────────────────────────
  // When tail mass exceeds the threshold, the matrix is truncated beyond what
  // the policy allows for full explainability. Degrade to LIMITED_MODE so that
  // the unreliable scoreline outputs are never surfaced to callers.
  if (engineOutputs.distributionResult.tailMassExceeded) {
    const reasons: ValidationResult['reasons'] = [
      ...validationResult.reasons,
      'EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS',
    ];
    const degradedValidation: ValidationResult = {
      ...validationResult,
      operating_mode: 'LIMITED_MODE',
      reasons,
    };
    return buildLimitedModeResponse(matchInput, degradedValidation, engineOutputs, versionMetadata);
  }

  const { lambdaResult, derivedRaw } = engineOutputs;
  const { calibrated1x2, derivedCalibrated, predictedResult } = calibratedOutputs;

  // Core: calibrated 1X2 probs + expected goals + predicted result. §15.1, §16.2
  const core: PredictionCore = {
    p_home_win: calibrated1x2.home,
    p_draw: calibrated1x2.draw,
    p_away_win: calibrated1x2.away,
    expected_goals_home: lambdaResult.lambda_home, // §15.1: = lambda_home directly
    expected_goals_away: lambdaResult.lambda_away, // §15.1: = lambda_away directly
    predicted_result: predictedResult.predicted_result,
    predicted_result_conflict: predictedResult.predicted_result_conflict,
    favorite_margin: predictedResult.favorite_margin,
    draw_risk: calibrated1x2.draw, // §15.1: draw_risk = p_draw
  };

  // Secondary: goal markets (from raw), double chance + DNB (from calibrated). §15.2, §19.5
  const secondary: PredictionSecondary = {
    // Double chance — §16.3, from calibrated
    home_or_draw: derivedCalibrated.home_or_draw,
    draw_or_away: derivedCalibrated.draw_or_away,
    home_or_away: derivedCalibrated.home_or_away,
    // DNB — §16.4, from calibrated (null when denominator <= epsilon)
    dnb_home: derivedCalibrated.dnb_home,
    dnb_away: derivedCalibrated.dnb_away,
    // Goal totals — §16.5, from raw
    over_2_5: derivedRaw.over_2_5,
    under_2_5: derivedRaw.under_2_5,
    over_1_5: derivedRaw.over_1_5,
    under_3_5: derivedRaw.under_3_5,
    // BTTS — §16.6, from raw
    btts_yes: derivedRaw.btts_yes,
    btts_no: derivedRaw.btts_no,
    // Team totals — §16.7, from raw
    team_home_over_0_5: derivedRaw.team_home_over_0_5,
    team_away_over_0_5: derivedRaw.team_away_over_0_5,
    team_home_over_1_5: derivedRaw.team_home_over_1_5,
    team_away_over_1_5: derivedRaw.team_away_over_1_5,
    // Clean sheets — §16.8, from raw
    clean_sheet_home: derivedRaw.clean_sheet_home,
    clean_sheet_away: derivedRaw.clean_sheet_away,
    // Win to nil — §16.9, from raw
    win_to_nil_home: derivedRaw.win_to_nil_home,
    win_to_nil_away: derivedRaw.win_to_nil_away,
    // Low scoring — §16.10, from raw
    low_scoring_risk: derivedRaw.low_scoring_risk,
  };

  // Explainability: scoreline outputs from raw distribution. §15.3, §16.11
  const explainability: PredictionExplainability = {
    most_likely_scoreline: derivedRaw.most_likely_scoreline,
    top_scorelines: derivedRaw.top_scorelines,
  };

  const predictions: PredictionOutputs = {
    core,
    secondary,
    explainability,
  };

  // Internals: full internal data for audit/reconstruction. §15.4, §22.3
  const internals: PredictionResponseInternals = buildInternals(
    engineOutputs,
    calibrated1x2,
    versionMetadata,
  );

  return {
    match_id: matchInput.match_id,
    eligibility_status: 'ELIGIBLE',
    model_version: versionMetadata.model_version,
    calibration_version: versionMetadata.calibration_version,
    competition_profile_version: matchInput.competition_profile.competition_profile_version,
    league_strength_factor_version: null,
    decision_policy_version: versionMetadata.decision_policy_version,
    too_close_margin_threshold: versionMetadata.too_close_margin_threshold,
    operating_mode: validationResult.operating_mode,
    applicability_level: validationResult.applicability_level,
    reasons: validationResult.reasons,
    predictions,
    internals,
  };
}

// ── Internals builder ─────────────────────────────────────────────────────

/**
 * Build the PredictionResponseInternals block.
 *
 * The internals block contains raw pipeline data for reconstruction/audit.
 * raw_match_distribution is NEVER exposed — only internals, which are
 * omitted from PredictionResponsePublic. §15.4, §22.3
 */
function buildInternals(
  engineOutputs: RawEngineOutputs,
  calibrated1x2: Calibrated1x2Probs | null,
  versionMetadata: CalibrationVersionMetadata,
): PredictionResponseInternals {
  const { lambdaResult, distributionResult, raw1x2, effectiveElo } = engineOutputs;

  const eloHome = effectiveElo?.home ?? 0;
  const eloAway = effectiveElo?.away ?? 0;
  const eloDiff = eloHome - eloAway;
  const homeAdvantageEffect = effectiveElo?.homAdvantageEffect ?? 0;

  // calibrated_1x2_probs in internals: use calibrated if available, else raw
  // but keep them in SEPARATE fields per §19.5.
  // In LIMITED_MODE, calibrated_1x2_probs matches raw (best available). §21.3
  const calibratedForInternals = calibrated1x2 ?? raw1x2;

  return {
    elo_home_pre: eloHome,
    elo_away_pre: eloAway,
    elo_diff: eloDiff,
    raw_1x2_probs: {
      home: raw1x2.home,
      draw: raw1x2.draw,
      away: raw1x2.away,
    },
    // §19.5: calibrated_1x2_probs in a SEPARATE field from raw_1x2_probs
    calibrated_1x2_probs: {
      home: calibratedForInternals.home,
      draw: calibratedForInternals.draw,
      away: calibratedForInternals.away,
    },
    lambda_home: lambdaResult.lambda_home,
    lambda_away: lambdaResult.lambda_away,
    tail_mass_raw: distributionResult.tail_mass_raw,
    matrix_max_goal: distributionResult.matrix_max_goal,
    home_advantage_effect: homeAdvantageEffect,
    score_model_type: 'INDEPENDENT_POISSON',
  };
}

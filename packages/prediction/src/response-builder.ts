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
 * Per §16.2: "los outputs visibles 1X2 deben ser calibrated_1x2_probs".
 * Since calibration is not applied in LIMITED_MODE, the calibration-derived
 * fields (p_home_win, p_draw, p_away_win, predicted_result, predicted_result_conflict,
 * favorite_margin, draw_risk) are set to null. Raw probabilities MUST NOT fill
 * these fields — that would violate the family separation invariant.
 *
 * expected_goals_home and expected_goals_away (lambda-derived, not calibration-derived)
 * remain present since they are always computable from the engine outputs.
 *
 * §11.3: "predictions.core debe estar presente" — satisfied (core object exists).
 * §16.2: visible 1X2 fields must be null, not raw — enforced here.
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

  const { lambdaResult } = engineOutputs;

  // In LIMITED_MODE, calibration was not applied. Per §16.2, visible 1X2 outputs
  // MUST derive from calibrated_1x2_probs — since these are unavailable, all
  // calibration-derived fields in core are null. Only lambda-derived fields remain.
  const core: PredictionCore = {
    // Calibration-derived fields: null per §16.2 (calibration not applied in LIMITED_MODE).
    // Raw probs MUST NOT substitute here — that would violate family separation.
    p_home_win: null,
    p_draw: null,
    p_away_win: null,
    // Lambda-derived: always computable regardless of mode. §15.1
    expected_goals_home: lambdaResult.lambda_home,
    expected_goals_away: lambdaResult.lambda_away,
    // Decision policy requires calibrated probs → null in LIMITED_MODE.
    predicted_result: null,
    predicted_result_conflict: null,
    favorite_margin: null,
    draw_risk: null,
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

  // Determine calibration_mode (§17.2):
  // - 'not_applied': calibrated1x2 is null → LIMITED_MODE, calibration was not applied.
  // - 'bootstrap': calibrated1x2 is present but is the identity pass-through (no trained data).
  //               The identity calibrator preserves raw probs unchanged before renormalization.
  // - 'trained': calibrated1x2 is present from a fitted isotonic calibrator.
  // Currently, bootstrap vs trained cannot be distinguished at this level without coupling to
  // the CalibrationRegistry. We surface 'trained' for all non-null calibrated outputs and
  // 'not_applied' for null. Bootstrap mode requires a dedicated flag from the registry caller.
  // SPEC_AMBIGUITY: §17.2 does not specify the exact output field placement for calibration_mode.
  // Assumption: internals block (Priority C, §22.3) is the appropriate location since it holds
  // all audit/reconstruction data. 'bootstrap' requires CalibrationVersionMetadata extension.
  const calibration_mode: 'bootstrap' | 'trained' | 'not_applied' =
    calibrated1x2 === null ? 'not_applied' : (versionMetadata.calibration_mode ?? 'trained');

  return {
    elo_home_pre: eloHome,
    elo_away_pre: eloAway,
    elo_diff: eloDiff,
    raw_1x2_probs: {
      home: raw1x2.home,
      draw: raw1x2.draw,
      away: raw1x2.away,
    },
    // §19.5: calibrated_1x2_probs in a SEPARATE field from raw_1x2_probs.
    // Null in LIMITED_MODE — raw probs MUST NOT substitute here.
    calibrated_1x2_probs:
      calibrated1x2 !== null
        ? {
            home: calibrated1x2.home,
            draw: calibrated1x2.draw,
            away: calibrated1x2.away,
          }
        : null,
    lambda_home: lambdaResult.lambda_home,
    lambda_away: lambdaResult.lambda_away,
    tail_mass_raw: distributionResult.tail_mass_raw,
    matrix_max_goal: distributionResult.matrix_max_goal,
    home_advantage_effect: homeAdvantageEffect,
    score_model_type: 'INDEPENDENT_POISSON',
    calibration_mode,
  };
}

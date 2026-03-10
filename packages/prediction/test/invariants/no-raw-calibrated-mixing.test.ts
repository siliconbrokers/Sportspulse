/**
 * no-raw-calibrated-mixing.test.ts — Family separation invariant tests.
 *
 * Spec authority: §19.5 (Invariantes de calibración y exposición), §19.7,
 *                 §3.1 (Fuente única de verdad del partido)
 *
 * Invariants tested:
 * - FULL_MODE: predictions.core win probabilities come from calibrated_1x2_probs
 *   (NOT raw_1x2_probs). Verified by using distinct calibrated vs raw values.
 * - LIMITED_MODE: predictions.core win probabilities come from raw_1x2_probs
 *   (no calibration available). Spec §21.3.
 * - Goal-market outputs (over_2_5, btts_yes, etc.) come from raw_match_distribution.
 * - Double-chance outputs (home_or_draw, etc.) come from calibrated_1x2_probs.
 * - internals block has raw_1x2_probs and calibrated_1x2_probs in SEPARATE fields.
 * - The two fields must differ when raw != calibrated.
 *
 * §19.5: "queda prohibido etiquetar como calibrado cualquier output no cubierto
 *          por una calibración específica versionada"
 * §19.7: "queda prohibido validar mercados de goles usando invariantes algebraicos
 *          propios del vector calibrado 1X2."
 */

import { describe, it, expect } from 'vitest';
import { buildPredictionResponse } from '../../src/response-builder.js';
import type {
  BuildPredictionResponseParams,
  RawEngineOutputs,
  CalibratedOutputs,
} from '../../src/response-builder.js';
import type { MatchInput } from '../../src/contracts/types/match-input.js';
import type { ValidationResult } from '../../src/contracts/types/validation-result.js';
import type {
  Raw1x2Probs,
  Calibrated1x2Probs,
  DerivedRawOutputs,
  DerivedCalibratedOutputs,
} from '../../src/contracts/types/prediction-response.js';
import type { CalibrationVersionMetadata } from '../../src/calibration/version-metadata.js';
import type { PredictedResultOutput } from '../../src/engine/decision-policy.js';
import type { RawMatchDistributionResult } from '../../src/engine/scoreline-matrix.js';
import type { LambdaResult } from '../../src/engine/lambda-computer.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

function mkMatchInput(matchId = 'mixing-test-001'): MatchInput {
  return {
    schemaVersion: 1,
    match_id: matchId,
    kickoff_utc: '2025-09-01T20:00:00Z',
    competition_id: 'comp:PL',
    season_id: '2025-26',
    home_team_id: 'arsenal',
    away_team_id: 'chelsea',
    home_team_domain_id: 'CLUB',
    away_team_domain_id: 'CLUB',
    competition_profile: {
      team_domain: 'CLUB',
      competition_family: 'DOMESTIC_LEAGUE',
      stage_type: 'GROUP_STAGE',
      format_type: 'ROUND_ROBIN',
      leg_type: 'SINGLE',
      neutral_venue: false,
      competition_profile_version: '1.0',
    },
    historical_context: {
      home_completed_official_matches_last_365d: 30,
      away_completed_official_matches_last_365d: 28,
      home_completed_official_matches_last_730d: 58,
      away_completed_official_matches_last_730d: 54,
      home_prior_rating_available: false,
      away_prior_rating_available: false,
    },
  };
}

function mkVersionMetadata(): CalibrationVersionMetadata {
  return {
    model_version: 'v1.0',
    calibration_version: 'v1.0',
    decision_policy_version: 'v1.0',
    too_close_margin_threshold: 0.02,
  };
}

/** Raw probabilities: 0.48/0.28/0.24 */
const RAW_HOME = 0.48;
const RAW_DRAW = 0.28;
const RAW_AWAY = 0.24;

/** Calibrated probabilities: distinctly different from raw */
const CAL_HOME = 0.55;
const CAL_DRAW = 0.22;
const CAL_AWAY = 0.23;

function mkEngineOutputs(): RawEngineOutputs {
  const distribution = { '0-0': 1.0 } as unknown as RawMatchDistributionResult['distribution'];
  const lambdaResult: LambdaResult = {
    lambda_home: 1.6,
    lambda_away: 1.2,
    eloDiff: 80,
    epsilonApplied: false,
  };
  const distributionResult: RawMatchDistributionResult = {
    distribution,
    tail_mass_raw: 0.003,
    tailMassExceeded: false,
    matrix_max_goal: 7,
    lambda_home: 1.6,
    lambda_away: 1.2,
  };
  const raw1x2: Raw1x2Probs = {
    home: RAW_HOME,
    draw: RAW_DRAW,
    away: RAW_AWAY,
  } as unknown as Raw1x2Probs;
  const derivedRaw: DerivedRawOutputs = {
    // RAW-derived goal markets — from raw_match_distribution §19.5
    over_2_5: 0.54,
    under_2_5: 0.46,
    over_1_5: 0.75,
    under_3_5: 0.67,
    btts_yes: 0.57,
    btts_no: 0.43,
    team_home_over_0_5: 0.74,
    team_away_over_0_5: 0.66,
    team_home_over_1_5: 0.44,
    team_away_over_1_5: 0.37,
    clean_sheet_home: 0.28,
    clean_sheet_away: 0.2,
    win_to_nil_home: 0.18,
    win_to_nil_away: 0.09,
    low_scoring_risk: 0.13,
    most_likely_scoreline: '1-0',
    top_scorelines: [
      { score: '1-0', p: 0.13 },
      { score: '1-1', p: 0.12 },
      { score: '2-0', p: 0.1 },
      { score: '2-1', p: 0.09 },
      { score: '0-0', p: 0.07 },
    ],
  };
  return { lambdaResult, distributionResult, raw1x2, derivedRaw };
}

function mkCalibratedOutputs(): CalibratedOutputs {
  // Calibrated probs distinctly different from raw
  const calibrated1x2: Calibrated1x2Probs = {
    home: CAL_HOME,
    draw: CAL_DRAW,
    away: CAL_AWAY,
  } as unknown as Calibrated1x2Probs;

  // Double-chance from calibrated (§16.3, §19.5)
  const derivedCalibrated: DerivedCalibratedOutputs = {
    home_or_draw: CAL_HOME + CAL_DRAW, // 0.77
    draw_or_away: CAL_DRAW + CAL_AWAY, // 0.45
    home_or_away: CAL_HOME + CAL_AWAY, // 0.78
    dnb_home: CAL_HOME / (1 - CAL_DRAW), // from calibrated
    dnb_away: 1 - CAL_HOME / (1 - CAL_DRAW),
  };

  const predictedResult: PredictedResultOutput = {
    predicted_result: 'HOME',
    predicted_result_conflict: false,
    favorite_margin: CAL_HOME - CAL_AWAY, // 0.32 > threshold
    too_close_margin_threshold: 0.02,
    decision_policy_version: 'v1.0',
  };

  return { calibrated1x2, derivedCalibrated, predictedResult };
}

const fullValidation: ValidationResult = {
  match_id: 'mixing-test-001',
  eligibility_status: 'ELIGIBLE',
  operating_mode: 'FULL_MODE',
  applicability_level: 'STRONG',
  reasons: [],
  data_integrity_flags: {
    teams_distinct: true,
    kickoff_present: true,
    profile_complete: true,
    stage_consistent_with_format: true,
    aggregate_state_consistent_with_leg_type: true,
    neutral_venue_consistent: true,
    domain_pool_available: true,
    leakage_guard_passed: true,
    knockout_rules_consistent: true,
    prior_rating_consistent: true,
  },
};

const limitedValidation: ValidationResult = {
  match_id: 'mixing-test-001',
  eligibility_status: 'ELIGIBLE',
  operating_mode: 'LIMITED_MODE',
  applicability_level: 'WEAK',
  reasons: ['INTERLEAGUE_FACTOR_UNAVAILABLE'],
  data_integrity_flags: { ...fullValidation.data_integrity_flags },
};

// ── Family: CALIBRATED 1X2 — source check ─────────────────────────────────

describe('No raw-calibrated mixing — FULL_MODE core from calibrated (§19.5)', () => {
  it('p_home_win comes from calibrated_1x2_probs in FULL_MODE (not raw)', () => {
    // §19.5: "p_home_win...deben derivarse de calibrated_1x2_probs"
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    // Must be calibrated value (0.55), NOT raw value (0.48)
    expect(result.predictions.core.p_home_win).toBeCloseTo(CAL_HOME, 8);
    expect(result.predictions.core.p_home_win).not.toBeCloseTo(RAW_HOME, 2);
  });

  it('p_draw comes from calibrated_1x2_probs in FULL_MODE (not raw)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.core.p_draw).toBeCloseTo(CAL_DRAW, 8);
    expect(result.predictions.core.p_draw).not.toBeCloseTo(RAW_DRAW, 2);
  });

  it('p_away_win comes from calibrated_1x2_probs in FULL_MODE (not raw)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.core.p_away_win).toBeCloseTo(CAL_AWAY, 8);
    expect(result.predictions.core.p_away_win).not.toBeCloseTo(RAW_AWAY, 2);
  });

  it('double-chance home_or_draw = CAL_HOME + CAL_DRAW (from calibrated, §16.3, §19.5)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    // home_or_draw must come from calibrated probs
    expect(result.predictions.secondary?.home_or_draw).toBeCloseTo(CAL_HOME + CAL_DRAW, 8);
  });
});

// ── Family: RAW GOAL/SCORELINE — source check ──────────────────────────────

describe('No raw-calibrated mixing — FULL_MODE goal markets from raw (§19.5)', () => {
  it('over_2_5 comes from raw_match_distribution (§19.5)', () => {
    // §19.5: goal market outputs come from raw_match_distribution, never calibrated
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.secondary?.over_2_5).toBeCloseTo(0.54, 8);
  });

  it('btts_yes comes from raw_match_distribution (§16.6, §19.5)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.secondary?.btts_yes).toBeCloseTo(0.57, 8);
  });

  it('top_scorelines comes from raw_match_distribution (§16.11, §19.5)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.explainability?.most_likely_scoreline).toBe('1-0');
  });
});

// ── internals: separate raw and calibrated fields ──────────────────────────

describe('No raw-calibrated mixing — internals separate fields (§19.5, §15.4)', () => {
  it('raw_1x2_probs and calibrated_1x2_probs are in distinct internals fields', () => {
    // §19.5: "Debe persistirse raw_1x2_probs y calibrated_1x2_probs"
    // They must be SEPARATE fields, not merged.
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    const internals = result.internals;
    expect(internals?.raw_1x2_probs).toBeDefined();
    expect(internals?.calibrated_1x2_probs).toBeDefined();

    // They must be in distinct fields (not the same object reference)
    expect(internals?.raw_1x2_probs).not.toBe(internals?.calibrated_1x2_probs);
  });

  it('internals.raw_1x2_probs contains the raw values (0.48/0.28/0.24)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.internals?.raw_1x2_probs.home).toBeCloseTo(RAW_HOME, 8);
    expect(result.internals?.raw_1x2_probs.draw).toBeCloseTo(RAW_DRAW, 8);
    expect(result.internals?.raw_1x2_probs.away).toBeCloseTo(RAW_AWAY, 8);
  });

  it('internals.calibrated_1x2_probs contains the calibrated values (0.55/0.22/0.23)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.internals?.calibrated_1x2_probs.home).toBeCloseTo(CAL_HOME, 8);
    expect(result.internals?.calibrated_1x2_probs.draw).toBeCloseTo(CAL_DRAW, 8);
    expect(result.internals?.calibrated_1x2_probs.away).toBeCloseTo(CAL_AWAY, 8);
  });
});

// ── LIMITED_MODE: calibration-derived fields are null, not raw ────────────
//
// FIX #64 (F-002): LIMITED_MODE core must NOT use raw probs in calibrated slots.
// Per §16.2: "los outputs visibles 1X2 deben ser calibrated_1x2_probs".
// Since calibration is not applied in LIMITED_MODE, the fields are null.
// This is the CORRECT family separation behavior per spec.

describe('No raw-calibrated mixing — LIMITED_MODE core fields are null (§16.2, §21.3, FIX#64)', () => {
  it('p_home_win is null in LIMITED_MODE — raw probs must NOT substitute (§16.2)', () => {
    // FIX #64: raw probs must not fill calibrated slots.
    // Spec §16.2: visible 1X2 = calibrated_1x2_probs. When calibration not applied → null.
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      // No calibratedOutputs in LIMITED_MODE
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    // Must be null — NOT the raw value (0.48)
    expect(result.predictions.core.p_home_win).toBeNull();
    expect(result.predictions.core.p_draw).toBeNull();
    expect(result.predictions.core.p_away_win).toBeNull();
  });

  it('predictions.secondary is null in LIMITED_MODE — calibrated outputs not exposed', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    // No double-chance, no DNB (calibrated outputs) in LIMITED_MODE
    expect(result.predictions.secondary).toBeNull();
  });
});

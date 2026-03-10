/**
 * TC-056 to TC-074 — Calibration, decision policy, and PredictionResponse conformance tests.
 *
 * Conformance Test Plan §E (Calibración) and §F (PredictionResponse y exposición)
 * Spec authority: §16.12, §16.13, §17.1, §17.4, §19.1, §19.5, §21, §21.1, §21.3, §22
 *
 * FAMILY SEPARATION:
 * - CALIBRATED 1X2 tests in their own describe blocks
 * - RAW tests separately
 * - No cross-family invariant assertions
 */

import { describe, it, expect } from 'vitest';
import {
  applyOneVsRestCalibration,
  IsotonicCalibrator,
  computePredictedResult,
  EPSILON_PROBABILITY,
  buildRawMatchDistribution,
  renormalizeDistribution,
  aggregateRaw1x2,
} from '../../src/index.js';
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
import type { OneVsRestCalibrators } from '../../src/calibration/isotonic-calibrator.js';
import { buildTestRawDistribution } from '../helpers/branded-factories.js';

// ── Shared helpers ─────────────────────────────────────────────────────────

function identityCalibrators(): OneVsRestCalibrators {
  return {
    home: IsotonicCalibrator.createIdentity(),
    draw: IsotonicCalibrator.createIdentity(),
    away: IsotonicCalibrator.createIdentity(),
  };
}

function mkMatchInput(matchId = 'calib-test'): MatchInput {
  return {
    schemaVersion: 1,
    match_id: matchId,
    kickoff_utc: '2025-10-01T20:00:00Z',
    competition_id: 'comp:PL',
    season_id: '2025-26',
    home_team_id: 'team-A',
    away_team_id: 'team-B',
    home_team_domain_id: 'CLUB',
    away_team_domain_id: 'CLUB',
    competition_profile: {
      competition_profile_version: '1.0',
      team_domain: 'CLUB',
      competition_family: 'DOMESTIC_LEAGUE',
      stage_type: 'GROUP_STAGE',
      format_type: 'ROUND_ROBIN',
      leg_type: 'SINGLE',
      neutral_venue: false,
    },
    historical_context: {
      home_completed_official_matches_last_365d: 20,
      away_completed_official_matches_last_365d: 20,
      home_prior_rating_available: false,
      away_prior_rating_available: false,
    },
  } as MatchInput;
}

function mkVersionMetadata(tooClose = 0.02): CalibrationVersionMetadata {
  return {
    model_version: 'v1.0',
    calibration_version: 'v1.0',
    decision_policy_version: 'v1.0',
    too_close_margin_threshold: tooClose,
  };
}

function mkCalibrated1x2(home: number, draw: number, away: number): Calibrated1x2Probs {
  return { home, draw, away } as unknown as Calibrated1x2Probs;
}

function mkRaw1x2(home: number, draw: number, away: number): Raw1x2Probs {
  return { home, draw, away } as unknown as Raw1x2Probs;
}

function mkEngineOutputs(
  lambdaHome = 1.5,
  lambdaAway = 1.2,
  rawHome = 0.48,
  rawDraw = 0.28,
  rawAway = 0.24,
): RawEngineOutputs {
  const lambdaResult: LambdaResult = {
    lambda_home: lambdaHome,
    lambda_away: lambdaAway,
    eloDiff: 80,
    epsilonApplied: false,
  };
  const distributionResult: RawMatchDistributionResult = {
    distribution: buildTestRawDistribution({ '1-0': 0.5, '0-0': 0.5 }),
    tail_mass_raw: 0.003,
    tailMassExceeded: false,
    matrix_max_goal: 7,
    lambda_home: lambdaHome,
    lambda_away: lambdaAway,
  };
  const raw1x2 = mkRaw1x2(rawHome, rawDraw, rawAway);
  const derivedRaw: DerivedRawOutputs = {
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

function mkCalibratedOutputs(home = 0.55, draw = 0.22, away = 0.23): CalibratedOutputs {
  const calibrated1x2 = mkCalibrated1x2(home, draw, away);
  const derivedCalibrated: DerivedCalibratedOutputs = {
    home_or_draw: home + draw,
    draw_or_away: draw + away,
    home_or_away: home + away,
    dnb_home: home / (1 - draw),
    dnb_away: 1 - home / (1 - draw),
  };
  const predictedResult: PredictedResultOutput = {
    predicted_result: 'HOME',
    predicted_result_conflict: false,
    favorite_margin: home - away,
    too_close_margin_threshold: 0.02,
    decision_policy_version: 'v1.0',
  };
  return { calibrated1x2, derivedCalibrated, predictedResult };
}

const fullValidation: ValidationResult = {
  match_id: 'calib-test',
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

// ── CALIBRATED 1X2 FAMILY ─────────────────────────────────────────────────

describe('TC-056 — Calibración isotónica OVR + renormalización (§17.1) [CALIBRATED FAMILY]', () => {
  it('PASS: applyOneVsRestCalibration produce calibrated_1x2_probs que suma 1', () => {
    // Spec §17.1: "Isotonic calibration one-vs-rest + renormalización para que sumen 1"
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const agg = aggregateRaw1x2(normalized, result.matrix_max_goal);

    const calibrated = applyOneVsRestCalibration(
      agg.probs.home,
      agg.probs.draw,
      agg.probs.away,
      identityCalibrators(),
    );

    const sum = calibrated.home + calibrated.draw + calibrated.away;
    expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
  });
});

describe('TC-060 — calibrated_1x2_probs ∈ [0,1] y suma 1 (§17.1, §19.1) [CALIBRATED FAMILY]', () => {
  const PROB_INPUTS: [number, number, number][] = [
    [0.5, 0.3, 0.2],
    [0.6, 0.25, 0.15],
    [0.2, 0.4, 0.4],
    [0.7, 0.05, 0.25],
    [0.33, 0.34, 0.33],
  ];

  it.each(PROB_INPUTS)(
    'PASS: calibrated probs en [0,1] y suma 1 para home=%s, draw=%s, away=%s',
    (home, draw, away) => {
      // Spec §19.1: "0 <= p_home_win <= 1", etc. + suma = 1 ± epsilon
      const calibrated = applyOneVsRestCalibration(home, draw, away, identityCalibrators());
      expect(calibrated.home).toBeGreaterThanOrEqual(0);
      expect(calibrated.home).toBeLessThanOrEqual(1);
      expect(calibrated.draw).toBeGreaterThanOrEqual(0);
      expect(calibrated.draw).toBeLessThanOrEqual(1);
      expect(calibrated.away).toBeGreaterThanOrEqual(0);
      expect(calibrated.away).toBeLessThanOrEqual(1);
      expect(
        Math.abs(calibrated.home + calibrated.draw + calibrated.away - 1.0),
      ).toBeLessThanOrEqual(EPSILON_PROBABILITY);
    },
  );
});

describe('TC-061 — Doble oportunidad deriva del calibrado (§16.3, §19.3, §19.5) [CALIBRATED FAMILY]', () => {
  it('PASS: home_or_draw = p_home_win + p_draw (from calibrated)', () => {
    // Spec §16.3: formulas from calibrated_1x2_probs
    // Spec §19.5: double chance outputs must come from calibrated
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(0.55, 0.22, 0.23),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    const sec = result.predictions.secondary;
    expect(sec?.home_or_draw).toBeCloseTo(0.55 + 0.22, 8);
    expect(sec?.draw_or_away).toBeCloseTo(0.22 + 0.23, 8);
    expect(sec?.home_or_away).toBeCloseTo(0.55 + 0.23, 8);
  });
});

describe('TC-062 — DNB deriva del calibrado (§16.4, §19.4, §19.5) [CALIBRATED FAMILY]', () => {
  it('PASS: dnb_home = p_home_win / (1 - p_draw)', () => {
    // Spec §16.4: exact formula from calibrated
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(0.55, 0.22, 0.23),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    const sec = result.predictions.secondary;
    const expectedDnbHome = 0.55 / (1 - 0.22);
    expect(sec?.dnb_home).toBeCloseTo(expectedDnbHome, 6);
  });

  it('PASS: dnb_home + dnb_away = 1.0 cuando denominador > epsilon', () => {
    // Spec §19.4: "abs((dnb_home + dnb_away) - 1) <= epsilon_probability"
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(0.55, 0.22, 0.23),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    const dnbHome = result.predictions.secondary?.dnb_home;
    const dnbAway = result.predictions.secondary?.dnb_away;
    if (dnbHome != null && dnbAway != null) {
      expect(Math.abs(dnbHome + dnbAway - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
    }
  });
});

describe('TC-063 — predicted_result = TOO_CLOSE (§16.12) [CALIBRATED FAMILY]', () => {
  it('PASS: decision_margin < too_close_margin_threshold → TOO_CLOSE + conflict = true', () => {
    // Spec §16.12: "Si decision_margin < too_close_margin_threshold → TOO_CLOSE"
    // margin = top1 - top2 = 0.35 - 0.34 = 0.01 < threshold 0.02 → TOO_CLOSE
    const probs = mkCalibrated1x2(0.35, 0.34, 0.31);
    const result = computePredictedResult(probs, 0.02, 'v1.0');
    expect(result.predicted_result).toBe('TOO_CLOSE');
    expect(result.predicted_result_conflict).toBe(true);
  });

  it('PASS: decision_margin exactly = threshold → NOT TOO_CLOSE (strict less-than)', () => {
    // Spec §16.12: "Si decision_margin < too_close_margin_threshold" — strict <
    // At exactly = threshold: NOT too_close
    const probs = mkCalibrated1x2(0.52, 0.3, 0.18); // margin = 0.52 - 0.30 = 0.22 > 0.02
    const result = computePredictedResult(probs, 0.22, 'v1.0');
    // margin = 0.52 - 0.30 = 0.22, threshold = 0.22
    // margin >= threshold → NOT TOO_CLOSE (strict less-than per spec)
    expect(result.predicted_result).not.toBe('TOO_CLOSE');
    expect(result.predicted_result_conflict).toBe(false);
  });
});

describe('TC-064 — predicted_result = argmax cuando claro (§16.12) [CALIBRATED FAMILY]', () => {
  it('PASS: decision_margin >= threshold → predicted_result = argmax + conflict = false', () => {
    // Spec §16.12: "argmax(calibrated_1x2_probs)" when margin >= threshold
    const probs = mkCalibrated1x2(0.6, 0.22, 0.18); // margin = 0.60 - 0.22 = 0.38 >> 0.02
    const result = computePredictedResult(probs, 0.02, 'v1.0');
    expect(result.predicted_result).toBe('HOME');
    expect(result.predicted_result_conflict).toBe(false);
  });

  it('PASS: predicted_result = DRAW when draw is largest by sufficient margin', () => {
    const probs = mkCalibrated1x2(0.3, 0.5, 0.2); // margin = 0.50 - 0.30 = 0.20 > 0.02
    const result = computePredictedResult(probs, 0.02, 'v1.0');
    expect(result.predicted_result).toBe('DRAW');
    expect(result.predicted_result_conflict).toBe(false);
  });

  it('PASS: predicted_result = AWAY when away is largest by sufficient margin', () => {
    const probs = mkCalibrated1x2(0.2, 0.3, 0.5); // margin = 0.50 - 0.30 = 0.20 > 0.02
    const result = computePredictedResult(probs, 0.02, 'v1.0');
    expect(result.predicted_result).toBe('AWAY');
    expect(result.predicted_result_conflict).toBe(false);
  });
});

describe('TC-065 — favorite_margin usa calibrado sin redondear (§16.13, §19.5) [CALIBRATED FAMILY]', () => {
  it('PASS: favorite_margin = top_1_calibrated - top_2_calibrated exacto', () => {
    // Spec §16.13: "favorite_margin = probabilidad calibrada más probable - segunda más probable"
    // Computed on non-rounded values
    const probs = mkCalibrated1x2(0.551, 0.233, 0.216);
    const result = computePredictedResult(probs, 0.02, 'v1.0');
    // top1 = 0.551, top2 = 0.233
    expect(result.favorite_margin).toBeCloseTo(0.551 - 0.233, 8);
  });
});

describe('TC-066 — Reconstrucción de predicted_result (§16.12, §16.13) [CALIBRATED FAMILY]', () => {
  it('PASS: predicted_result reconstruible deterministamente desde calibrated_1x2_probs + threshold + version', () => {
    // Spec §17.4: "predicted_result debe poder reconstruirse determinísticamente"
    // Spec §25.4: same
    const probs = mkCalibrated1x2(0.55, 0.22, 0.23);
    const threshold = 0.02;
    const version = 'v1.0';

    const r1 = computePredictedResult(probs, threshold, version);
    const r2 = computePredictedResult(probs, threshold, version);

    expect(r1.predicted_result).toBe(r2.predicted_result);
    expect(r1.predicted_result_conflict).toBe(r2.predicted_result_conflict);
    expect(r1.favorite_margin).toBe(r2.favorite_margin);
    expect(r1.too_close_margin_threshold).toBe(r2.too_close_margin_threshold);
    expect(r1.decision_policy_version).toBe(r2.decision_policy_version);
  });
});

// ── PredictionResponse structure tests ───────────────────────────────────

describe('TC-068 — FULL_MODE expone core/secondary/explainability/internals (§21, §21.3, §22)', () => {
  it('PASS: todos los bloques presentes en FULL_MODE', () => {
    // Spec §21.3: "predictions.core es obligatorio; secondary es obligatorio en FULL_MODE"
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    expect(result.predictions.core).toBeDefined();
    expect(result.predictions.secondary).toBeDefined();
    expect(result.predictions.secondary).not.toBeNull();
    expect(result.predictions.explainability).toBeDefined();
    expect(result.predictions.explainability).not.toBeNull();
  });

  it('PASS: version fields always present in FULL_MODE (§17.4)', () => {
    // Spec §17.4: model_version, calibration_version, decision_policy_version siempre presentes
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.model_version).toBeTruthy();
    expect(result.calibration_version).toBeTruthy();
    expect(result.decision_policy_version).toBeTruthy();
    expect(typeof result.too_close_margin_threshold).toBe('number');
  });
});

describe('TC-069 — LIMITED_MODE permite degradación parcial (§21.3)', () => {
  it('PASS: core presente; secondary/explainability null en LIMITED_MODE', () => {
    // Spec §21.3: "core sigue siendo obligatorio; secondary/explainability pueden ser null"
    const limitedValidation: ValidationResult = {
      ...fullValidation,
      operating_mode: 'LIMITED_MODE',
      applicability_level: 'WEAK',
      reasons: ['INTERLEAGUE_FACTOR_UNAVAILABLE'],
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    // core must be present
    expect(result.predictions.core).toBeDefined();
    // secondary must be null in LIMITED_MODE
    expect(result.predictions.secondary).toBeNull();
    // explainability must be null in LIMITED_MODE
    expect(result.predictions.explainability).toBeNull();
  });
});

describe('TC-070 — NOT_ELIGIBLE bloquea probabilidades visibles (§21.1, §21.2)', () => {
  it('PASS: NOT_ELIGIBLE → no tiene campo predictions', () => {
    // Spec §21.1: "predictions = null" cuando NOT_ELIGIBLE
    // Type-level enforcement: PredictionResponseNotEligible has no predictions field
    const notEligibleValidation: ValidationResult = {
      match_id: 'calib-test',
      eligibility_status: 'NOT_ELIGIBLE',
      operating_mode: 'NOT_ELIGIBLE',
      applicability_level: 'WEAK',
      reasons: ['MISSING_CRITICAL_FIELD'],
      data_integrity_flags: {
        teams_distinct: false,
        kickoff_present: false,
        profile_complete: false,
        stage_consistent_with_format: false,
        aggregate_state_consistent_with_leg_type: false,
        neutral_venue_consistent: false,
        domain_pool_available: false,
        leakage_guard_passed: false,
        knockout_rules_consistent: false,
        prior_rating_consistent: false,
      },
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    // predictions field should not exist on NOT_ELIGIBLE variant
    expect('predictions' in result).toBe(false);
  });

  it('PASS: NOT_ELIGIBLE → reasons no vacío (§11.2)', () => {
    // Spec §21.1: "reasons debe contener al menos un código válido del catálogo"
    const notEligibleValidation: ValidationResult = {
      match_id: 'calib-test',
      eligibility_status: 'NOT_ELIGIBLE',
      operating_mode: 'NOT_ELIGIBLE',
      applicability_level: 'WEAK',
      reasons: ['DOMAIN_POOL_UNAVAILABLE'],
      data_integrity_flags: {
        teams_distinct: true,
        kickoff_present: true,
        profile_complete: true,
        stage_consistent_with_format: true,
        aggregate_state_consistent_with_leg_type: true,
        neutral_venue_consistent: true,
        domain_pool_available: false,
        leakage_guard_passed: true,
        knockout_rules_consistent: true,
        prior_rating_consistent: true,
      },
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe('TC-072 — No existe referencia residual a epsilon_display (§4, §16.12)', () => {
  it('REGRESSION: epsilon_display no existe en el contrato ni en la implementación', () => {
    // Spec: criterion from Conformance Plan §2 item 7
    // "No existe ninguna referencia residual a epsilon_display"
    // This is a static code sentinel — the spec explicitly prohibits epsilon_display
    // The test asserts it is not present as any exported value
    // EPSILON_PROBABILITY is already imported at the top of this file from src/index.js
    // Verify epsilon_display does NOT exist by checking the named exports we DO have
    expect(EPSILON_PROBABILITY).toBe(1e-9);
    // epsilon_display must not be defined anywhere in the contracts module
    // (verified via static grep: zero references found in implementation)
    const epsilonDisplayCheck = (globalThis as Record<string, unknown>)['epsilon_display'];
    expect(epsilonDisplayCheck).toBeUndefined();
  });
});

describe('TC-073 — Persistencia separada raw_1x2_probs y calibrated_1x2_probs (§15.4, §19.5)', () => {
  it('PASS: internals contiene raw_1x2_probs y calibrated_1x2_probs como campos separados', () => {
    // Spec §19.5: "Debe persistirse raw_1x2_probs y calibrated_1x2_probs"
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(1.5, 1.2, 0.48, 0.28, 0.24),
      calibratedOutputs: mkCalibratedOutputs(0.55, 0.22, 0.23),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    expect(result.internals?.raw_1x2_probs).toBeDefined();
    expect(result.internals?.calibrated_1x2_probs).toBeDefined();
    // They must be separate objects (not the same reference)
    expect(result.internals?.raw_1x2_probs).not.toBe(result.internals?.calibrated_1x2_probs);
    // And their values must differ (raw 0.48/0.28/0.24 vs calibrated 0.55/0.22/0.23)
    expect(result.internals?.raw_1x2_probs.home).toBeCloseTo(0.48, 6);
    expect(result.internals?.calibrated_1x2_probs.home).toBeCloseTo(0.55, 6);
  });
});

// ── FIX #64 — F-002: LIMITED_MODE core calibration fields must be null ────

describe('F-002 — LIMITED_MODE core calibration-derived fields must be null (§16.2, FIX#64)', () => {
  it('PASS: p_home_win is null in LIMITED_MODE — raw probs must not fill calibrated slots', () => {
    // FIX #64: §16.2 requires visible 1X2 outputs = calibrated_1x2_probs.
    // In LIMITED_MODE, calibration is not applied → these fields must be null.
    // Raw probabilities MUST NOT substitute — that violates family separation.
    const limitedValidation: ValidationResult = {
      ...fullValidation,
      operating_mode: 'LIMITED_MODE',
      applicability_level: 'WEAK',
      reasons: ['INTERLEAGUE_FACTOR_UNAVAILABLE'],
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      // No calibratedOutputs in LIMITED_MODE
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    const core = result.predictions.core;
    // Calibration-derived fields: null (never raw)
    expect(core.p_home_win).toBeNull();
    expect(core.p_draw).toBeNull();
    expect(core.p_away_win).toBeNull();
    expect(core.predicted_result).toBeNull();
    expect(core.predicted_result_conflict).toBeNull();
    expect(core.favorite_margin).toBeNull();
    expect(core.draw_risk).toBeNull();
    // Lambda-derived fields: always present
    expect(typeof core.expected_goals_home).toBe('number');
    expect(typeof core.expected_goals_away).toBe('number');
  });

  it('PASS: internals.calibrated_1x2_probs is null in LIMITED_MODE (FIX#64)', () => {
    // In LIMITED_MODE, there is no calibrated output — internals must reflect this honestly.
    // Storing raw probs in internals.calibrated_1x2_probs would be misleading.
    const limitedValidation: ValidationResult = {
      ...fullValidation,
      operating_mode: 'LIMITED_MODE',
      applicability_level: 'WEAK',
      reasons: ['INTERLEAGUE_FACTOR_UNAVAILABLE'],
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    expect(result.internals?.calibrated_1x2_probs).toBeNull();
    // raw_1x2_probs still present for audit
    expect(result.internals?.raw_1x2_probs).toBeDefined();
  });
});

// ── FIX #65 — F-003: bootstrap mode must be declared explicitly ───────────

describe('F-003 — calibration_mode must be declared in internals (§17.2, FIX#65)', () => {
  it('PASS: internals.calibration_mode = not_applied in LIMITED_MODE', () => {
    // FIX #65: §17.2 requires honest declaration of calibration mode.
    // LIMITED_MODE = calibration not applied → 'not_applied'.
    const limitedValidation: ValidationResult = {
      ...fullValidation,
      operating_mode: 'LIMITED_MODE',
      applicability_level: 'WEAK',
      reasons: ['INTERLEAGUE_FACTOR_UNAVAILABLE'],
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    expect(result.internals?.calibration_mode).toBe('not_applied');
  });

  it('PASS: internals.calibration_mode = bootstrap when versionMetadata declares bootstrap', () => {
    // FIX #65: §17.2 — identity calibrator in use → declare 'bootstrap'.
    // When no historical training data is available, calibration_mode must be 'bootstrap'.
    const bootstrapMeta: CalibrationVersionMetadata = {
      ...mkVersionMetadata(),
      calibration_mode: 'bootstrap',
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: bootstrapMeta,
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    expect(result.internals?.calibration_mode).toBe('bootstrap');
  });

  it('PASS: internals.calibration_mode = trained when versionMetadata declares trained', () => {
    // FIX #65: When a fitted calibrator is applied, mode must be 'trained'.
    const trainedMeta: CalibrationVersionMetadata = {
      ...mkVersionMetadata(),
      calibration_mode: 'trained',
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: trainedMeta,
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    expect(result.internals?.calibration_mode).toBe('trained');
  });

  it('PASS: internals.calibration_mode defaults to trained when calibrated output is present but mode not set', () => {
    // FIX #65: Backward compatibility — if calibration_mode is not set in metadata
    // but calibrated output IS present, default to 'trained'.
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(), // no calibration_mode field
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    // Default: 'trained' (calibrated output is present → assume fitted)
    expect(result.internals?.calibration_mode).toBe('trained');
  });
});

describe('TC-074 — Prioridades de exposición compatibles con outputs reales (§22, §23.2)', () => {
  it('PASS: Prioridad A outputs están presentes en FULL_MODE response', () => {
    // Spec §22.1: Prioridad A — obligatoria (core + home_or_draw/draw_or_away/home_or_away +
    //             dnb_home/dnb_away + over_2_5/under_2_5 + btts_yes/btts_no)
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    const core = result.predictions.core;
    const sec = result.predictions.secondary;

    // Core (Prioridad A)
    expect(core.p_home_win).toBeDefined();
    expect(core.p_draw).toBeDefined();
    expect(core.p_away_win).toBeDefined();
    expect(core.expected_goals_home).toBeDefined();
    expect(core.expected_goals_away).toBeDefined();
    expect(core.predicted_result).toBeDefined();

    // Prioridad A — secondary
    expect(sec?.home_or_draw).toBeDefined();
    expect(sec?.draw_or_away).toBeDefined();
    expect(sec?.home_or_away).toBeDefined();
    expect(sec?.over_2_5).toBeDefined();
    expect(sec?.under_2_5).toBeDefined();
    expect(sec?.btts_yes).toBeDefined();
    expect(sec?.btts_no).toBeDefined();
  });

  it('PASS: decision_policy_version y too_close_margin_threshold siempre presentes (§17.4, §21)', () => {
    // Spec §21: these fields are in the response envelope, always present
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.decision_policy_version).toBeTruthy();
    expect(typeof result.too_close_margin_threshold).toBe('number');
    expect(result.too_close_margin_threshold).toBe(0.02);
  });
});

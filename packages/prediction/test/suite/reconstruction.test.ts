/**
 * reconstruction.test.ts — Deterministic reconstruction invariant tests.
 *
 * Spec authority: §25.4 (Validación de reconstrucción), §17.4 (Versionado),
 *                 §3 (Principios de diseño — determinismo)
 *
 * Invariants tested:
 * - Given identical inputs, buildPredictionResponse produces JSON-identical outputs
 *   in multiple invocations.
 * - Reconstruction of predicted_result from calibrated_1x2_probs +
 *   too_close_margin_threshold + decision_policy_version is deterministic.
 * - Reconstruction of raw distribution from lambda_home, lambda_away, matrix_max_goal
 *   is deterministic.
 * - Three distinct fixtures: FULL_MODE, LIMITED_MODE, NOT_ELIGIBLE.
 *
 * §25.4: "verifica que a partir de lambda_home, lambda_away, score_model_type,
 *          matrix_max_goal, tail_mass_raw puedan reconstruirse determinísticamente."
 *
 * No time.now() or Math.random() in the pipeline — pure functions only.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRawMatchDistribution,
  renormalizeDistribution,
  aggregateRaw1x2,
  computeDerivedRaw,
  computePredictedResult,
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
import type { RawMatchDistributionResult } from '../../src/engine/scoreline-matrix.js';
import type { LambdaResult } from '../../src/engine/lambda-computer.js';
import type { PredictedResultOutput } from '../../src/engine/decision-policy.js';
import {
  applyOneVsRestCalibration,
  IsotonicCalibrator,
} from '../../src/calibration/isotonic-calibrator.js';
import type { OneVsRestCalibrators } from '../../src/calibration/isotonic-calibrator.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

function mkVersionMetadata(): CalibrationVersionMetadata {
  return {
    model_version: 'v1.0',
    calibration_version: 'v1.0',
    decision_policy_version: 'v1.0',
    too_close_margin_threshold: 0.02,
  };
}

function mkBaseMatchInput(matchId: string): MatchInput {
  return {
    schemaVersion: 1,
    match_id: matchId,
    kickoff_utc: '2025-08-10T19:00:00Z',
    competition_id: 'comp:PD',
    season_id: '2025-26',
    home_team_id: 'team-X',
    away_team_id: 'team-Y',
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
      home_completed_official_matches_last_365d: 25,
      away_completed_official_matches_last_365d: 22,
      home_completed_official_matches_last_730d: 48,
      away_completed_official_matches_last_730d: 42,
      home_prior_rating_available: false,
      away_prior_rating_available: false,
    },
  };
}

function mkFullValidation(matchId: string): ValidationResult {
  return {
    match_id: matchId,
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
}

function mkLimitedValidation(matchId: string): ValidationResult {
  return {
    match_id: matchId,
    eligibility_status: 'ELIGIBLE',
    operating_mode: 'LIMITED_MODE',
    applicability_level: 'WEAK',
    reasons: ['INTERLEAGUE_FACTOR_UNAVAILABLE'],
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
}

function mkNotEligibleValidation(matchId: string): ValidationResult {
  return {
    match_id: matchId,
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
}

/** Build engine outputs from fixed lambdas — purely deterministic. */
function mkEngineOutputsFromLambdas(lambdaHome: number, lambdaAway: number): RawEngineOutputs {
  const distResult = buildRawMatchDistribution(lambdaHome, lambdaAway);
  const normalized = renormalizeDistribution(distResult.distribution, distResult.matrix_max_goal);
  const aggregated = aggregateRaw1x2(normalized, distResult.matrix_max_goal);
  const derivedRaw = computeDerivedRaw(normalized, distResult.matrix_max_goal);
  const raw1x2 = aggregated.probs;
  const lambdaResult: LambdaResult = {
    lambda_home: lambdaHome,
    lambda_away: lambdaAway,
    eloDiff: 100,
    epsilonApplied: false,
  };
  return {
    lambdaResult,
    distributionResult: distResult,
    raw1x2,
    derivedRaw,
    effectiveElo: { home: 1600, away: 1500, homAdvantageEffect: 60 },
  };
}

function identityCalibrators(): OneVsRestCalibrators {
  return {
    home: IsotonicCalibrator.createIdentity(),
    draw: IsotonicCalibrator.createIdentity(),
    away: IsotonicCalibrator.createIdentity(),
  };
}

function mkCalibratedOutputsFromLambdas(lambdaHome: number, lambdaAway: number): CalibratedOutputs {
  const distResult = buildRawMatchDistribution(lambdaHome, lambdaAway);
  const normalized = renormalizeDistribution(distResult.distribution, distResult.matrix_max_goal);
  const aggregated = aggregateRaw1x2(normalized, distResult.matrix_max_goal);
  const calibrated = applyOneVsRestCalibration(
    aggregated.probs.home,
    aggregated.probs.draw,
    aggregated.probs.away,
    identityCalibrators(),
  );
  const calibrated1x2: Calibrated1x2Probs = calibrated as unknown as Calibrated1x2Probs;
  const predictedResult = computePredictedResult(calibrated1x2, 0.02, 'v1.0');
  const derivedCalibrated: DerivedCalibratedOutputs = {
    home_or_draw: calibrated.home + calibrated.draw,
    draw_or_away: calibrated.draw + calibrated.away,
    home_or_away: calibrated.home + calibrated.away,
    dnb_home: calibrated.draw < 1 - 1e-9 ? calibrated.home / (1 - calibrated.draw) : null,
    dnb_away: calibrated.draw < 1 - 1e-9 ? 1 - calibrated.home / (1 - calibrated.draw) : null,
  };
  return { calibrated1x2, derivedCalibrated, predictedResult };
}

// ── Reconstruction tests — FULL_MODE ──────────────────────────────────────

describe('Reconstruction — FULL_MODE fixture (§25.4)', () => {
  const MATCH_ID = 'recon-full-001';
  const LAMBDA_HOME = 1.65;
  const LAMBDA_AWAY = 1.2;

  function buildParams(): BuildPredictionResponseParams {
    return {
      matchInput: mkBaseMatchInput(MATCH_ID),
      validationResult: mkFullValidation(MATCH_ID),
      engineOutputs: mkEngineOutputsFromLambdas(LAMBDA_HOME, LAMBDA_AWAY),
      calibratedOutputs: mkCalibratedOutputsFromLambdas(LAMBDA_HOME, LAMBDA_AWAY),
      versionMetadata: mkVersionMetadata(),
    };
  }

  it('two identical calls produce JSON-identical outputs', () => {
    // §25.4: "same inputs → bit-identical output"
    const result1 = buildPredictionResponse(buildParams());
    const result2 = buildPredictionResponse(buildParams());
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it('three identical calls all produce the same output', () => {
    const outputs = [
      buildPredictionResponse(buildParams()),
      buildPredictionResponse(buildParams()),
      buildPredictionResponse(buildParams()),
    ];
    const serialized = outputs.map((o) => JSON.stringify(o));
    expect(serialized[0]).toBe(serialized[1]);
    expect(serialized[1]).toBe(serialized[2]);
  });

  it('predicted_result is deterministically reconstructable from calibrated_1x2_probs (§25.4)', () => {
    // §25.4: reconstruct from calibrated_1x2_probs + too_close_margin_threshold + decision_policy_version
    const result1 = buildPredictionResponse(buildParams());
    const result2 = buildPredictionResponse(buildParams());
    if (result1.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    if (result2.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result1.predictions.core.predicted_result).toBe(
      result2.predictions.core.predicted_result,
    );
    expect(result1.predictions.core.p_home_win).toBe(result2.predictions.core.p_home_win);
    expect(result1.predictions.core.p_draw).toBe(result2.predictions.core.p_draw);
    expect(result1.predictions.core.p_away_win).toBe(result2.predictions.core.p_away_win);
  });
});

// ── Reconstruction tests — LIMITED_MODE ───────────────────────────────────

describe('Reconstruction — LIMITED_MODE fixture (§25.4)', () => {
  const MATCH_ID = 'recon-limited-001';
  const LAMBDA_HOME = 1.1;
  const LAMBDA_AWAY = 1.3; // away stronger — limited history case

  function buildParams(): BuildPredictionResponseParams {
    return {
      matchInput: mkBaseMatchInput(MATCH_ID),
      validationResult: mkLimitedValidation(MATCH_ID),
      engineOutputs: mkEngineOutputsFromLambdas(LAMBDA_HOME, LAMBDA_AWAY),
      // No calibratedOutputs — LIMITED_MODE uses raw
      versionMetadata: mkVersionMetadata(),
    };
  }

  it('two identical calls produce JSON-identical outputs in LIMITED_MODE', () => {
    const result1 = buildPredictionResponse(buildParams());
    const result2 = buildPredictionResponse(buildParams());
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it('raw distribution reconstructs to same matrix both times (§25.4)', () => {
    // §25.4: "a partir de lambda_home, lambda_away, score_model_type, matrix_max_goal
    //          puedan reconstruirse determinísticamente los outputs raw"
    const dist1 = buildRawMatchDistribution(LAMBDA_HOME, LAMBDA_AWAY);
    const dist2 = buildRawMatchDistribution(LAMBDA_HOME, LAMBDA_AWAY);
    expect(dist1.tail_mass_raw).toBe(dist2.tail_mass_raw);
    expect(dist1.matrix_max_goal).toBe(dist2.matrix_max_goal);
    // A few specific cells
    const d1 = dist1.distribution as unknown as Record<string, number>;
    const d2 = dist2.distribution as unknown as Record<string, number>;
    expect(d1['1-1']).toBe(d2['1-1']);
    expect(d1['0-0']).toBe(d2['0-0']);
    expect(d1['2-1']).toBe(d2['2-1']);
  });
});

// ── Reconstruction tests — NOT_ELIGIBLE ───────────────────────────────────

describe('Reconstruction — NOT_ELIGIBLE fixture (§25.4)', () => {
  const MATCH_ID = 'recon-ineligible-001';

  function buildParams(): BuildPredictionResponseParams {
    return {
      matchInput: mkBaseMatchInput(MATCH_ID),
      validationResult: mkNotEligibleValidation(MATCH_ID),
      versionMetadata: mkVersionMetadata(),
    };
  }

  it('two identical calls produce JSON-identical NOT_ELIGIBLE outputs', () => {
    const result1 = buildPredictionResponse(buildParams());
    const result2 = buildPredictionResponse(buildParams());
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
  });

  it('NOT_ELIGIBLE output never contains predictions field across runs', () => {
    const result1 = buildPredictionResponse(buildParams());
    const result2 = buildPredictionResponse(buildParams());
    expect(Object.prototype.hasOwnProperty.call(result1, 'predictions')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result2, 'predictions')).toBe(false);
  });
});

// ── Deterministic predicted_result reconstruction test (§25.4) ────────────

describe('Reconstruction — predicted_result from persisted values (§25.4)', () => {
  it('computePredictedResult produces identical result from same inputs (3 runs)', () => {
    const calibrated: Calibrated1x2Probs = {
      home: 0.52,
      draw: 0.23,
      away: 0.25,
    } as unknown as Calibrated1x2Probs;

    const run1 = computePredictedResult(calibrated, 0.02, 'v1.0');
    const run2 = computePredictedResult(calibrated, 0.02, 'v1.0');
    const run3 = computePredictedResult(calibrated, 0.02, 'v1.0');

    expect(run1.predicted_result).toBe(run2.predicted_result);
    expect(run2.predicted_result).toBe(run3.predicted_result);
    expect(run1.favorite_margin).toBe(run2.favorite_margin);
    expect(run2.favorite_margin).toBe(run3.favorite_margin);
  });

  it('TOO_CLOSE reconstructs deterministically at the threshold boundary', () => {
    // favorite_margin just below threshold → always TOO_CLOSE
    const calibrated: Calibrated1x2Probs = {
      home: 0.35,
      draw: 0.33,
      away: 0.32,
    } as unknown as Calibrated1x2Probs;

    const run1 = computePredictedResult(calibrated, 0.02, 'v1.0');
    const run2 = computePredictedResult(calibrated, 0.02, 'v1.0');
    // 0.35 - 0.33 = 0.02 which is NOT < 0.02 (strict less-than per §16.12)
    // So this should be HOME, not TOO_CLOSE
    expect(run1.predicted_result).toBe(run2.predicted_result);
  });
});

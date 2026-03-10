/**
 * mode-gating.test.ts — Operating mode structural gating tests.
 *
 * Spec authority: §19.6 (Invariantes contextuales), §25.1 (Schema validation),
 *                 §25.3 (Operating mode validation), §21.1, §21.3
 *
 * Invariants tested:
 * - NOT_ELIGIBLE → predictions field structurally absent (§21.1)
 * - NOT_ELIGIBLE → reasons array is non-empty (§11.2)
 * - NOT_ELIGIBLE → eligibility_status = 'NOT_ELIGIBLE' (§21)
 * - LIMITED_MODE → predictions.core present (§21.3)
 * - LIMITED_MODE → predictions.secondary is null (§21.3)
 * - LIMITED_MODE → predictions.explainability is null (§21.3)
 * - FULL_MODE → core, secondary, explainability all present and non-null (§21)
 *
 * Test family: operating-mode (shared). No cross-family probability assertions.
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

// ── Test fixtures ──────────────────────────────────────────────────────────

function mkMatchInput(matchId = 'test-match-001'): MatchInput {
  return {
    schemaVersion: 1,
    match_id: matchId,
    kickoff_utc: '2025-06-01T18:00:00Z',
    competition_id: 'comp:PD',
    season_id: '2024-25',
    home_team_id: 'team-A',
    away_team_id: 'team-B',
    home_team_domain_id: 'CLUB',
    away_team_domain_id: 'CLUB',
    competition_profile: {
      team_domain: 'CLUB',
      competition_family: 'DOMESTIC_LEAGUE',
      stage_type: 'REGULAR_SEASON',
      format_type: 'LEAGUE',
      leg_type: 'SINGLE',
      neutral_venue: false,
      competition_profile_version: '1.0',
    } as any,
    historical_context: {
      home_completed_official_matches_last_365d: 20,
      away_completed_official_matches_last_365d: 20,
      home_completed_official_matches_last_730d: 38,
      away_completed_official_matches_last_730d: 38,
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

function mkEngineOutputs(): RawEngineOutputs {
  const distribution = { '0-0': 1.0 } as unknown as RawMatchDistributionResult['distribution'];
  const lambdaResult: LambdaResult = {
    lambda_home: 1.4,
    lambda_away: 1.1,
    eloDiff: 30,
    epsilonApplied: false,
  };
  const distributionResult: RawMatchDistributionResult = {
    distribution,
    tail_mass_raw: 0.005,
    tailMassExceeded: false,
    matrix_max_goal: 7,
    lambda_home: 1.4,
    lambda_away: 1.1,
  };
  const raw1x2: Raw1x2Probs = { home: 0.45, draw: 0.27, away: 0.28 } as unknown as Raw1x2Probs;
  const derivedRaw: DerivedRawOutputs = {
    over_2_5: 0.5,
    under_2_5: 0.5,
    over_1_5: 0.7,
    under_3_5: 0.65,
    btts_yes: 0.52,
    btts_no: 0.48,
    team_home_over_0_5: 0.68,
    team_away_over_0_5: 0.62,
    team_home_over_1_5: 0.4,
    team_away_over_1_5: 0.35,
    clean_sheet_home: 0.32,
    clean_sheet_away: 0.25,
    win_to_nil_home: 0.16,
    win_to_nil_away: 0.1,
    low_scoring_risk: 0.14,
    most_likely_scoreline: '1-1',
    top_scorelines: [
      { score: '1-1', p: 0.11 },
      { score: '1-0', p: 0.1 },
      { score: '2-1', p: 0.09 },
      { score: '0-0', p: 0.08 },
      { score: '0-1', p: 0.07 },
    ],
  };
  return {
    lambdaResult,
    distributionResult,
    raw1x2,
    derivedRaw,
  };
}

function mkCalibratedOutputs(): CalibratedOutputs {
  const calibrated1x2: Calibrated1x2Probs = {
    home: 0.48,
    draw: 0.25,
    away: 0.27,
  } as unknown as Calibrated1x2Probs;
  const derivedCalibrated: DerivedCalibratedOutputs = {
    home_or_draw: 0.73,
    draw_or_away: 0.52,
    home_or_away: 0.75,
    dnb_home: 0.64,
    dnb_away: 0.36,
  };
  const predictedResult: PredictedResultOutput = {
    predicted_result: 'HOME',
    predicted_result_conflict: false,
    favorite_margin: 0.21,
    too_close_margin_threshold: 0.02,
    decision_policy_version: 'v1.0',
  };
  return { calibrated1x2, derivedCalibrated, predictedResult };
}

// ── NOT_ELIGIBLE gating tests ──────────────────────────────────────────────

describe('Operating mode gating — NOT_ELIGIBLE (§21.1, §25.3)', () => {
  const notEligibleValidation: ValidationResult = {
    match_id: 'test-match-001',
    eligibility_status: 'NOT_ELIGIBLE',
    operating_mode: 'NOT_ELIGIBLE',
    applicability_level: 'WEAK',
    reasons: ['MISSING_CRITICAL_FIELD'],
    data_integrity_flags: {
      teams_distinct: true,
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

  it('predictions field is structurally absent — NOT present as null or undefined (§21.1)', () => {
    // §21.1: "queda prohibido devolver probabilidades parciales cuando NOT_ELIGIBLE"
    // Structural absence is stronger than null.
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(Object.prototype.hasOwnProperty.call(result, 'predictions')).toBe(false);
  });

  it('eligibility_status is NOT_ELIGIBLE (§21)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
  });

  it('reasons array is non-empty (§11.2)', () => {
    // §11.2: "reasons array must contain at least one entry when NOT_ELIGIBLE"
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.reasons).toBeDefined();
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('reasons array non-empty for INSUFFICIENT_HISTORY reason', () => {
    const validation: ValidationResult = {
      ...notEligibleValidation,
      reasons: ['INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING'],
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: validation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });

  it('reasons array non-empty for INVALID_COMPETITION_PROFILE reason', () => {
    const validation: ValidationResult = {
      ...notEligibleValidation,
      reasons: ['INVALID_COMPETITION_PROFILE'],
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: validation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('engineOutputs are silently ignored for NOT_ELIGIBLE (§21.1)', () => {
    // Even if engine outputs were passed, NOT_ELIGIBLE must never expose predictions
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      engineOutputs: mkEngineOutputs(), // should be ignored
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(Object.prototype.hasOwnProperty.call(result, 'predictions')).toBe(false);
  });
});

// ── LIMITED_MODE gating tests ──────────────────────────────────────────────

describe('Operating mode gating — LIMITED_MODE (§21.3, §25.3)', () => {
  const limitedValidation: ValidationResult = {
    match_id: 'test-match-001',
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

  it('predictions.core is present and non-null (§21.3)', () => {
    // §21.3: "predictions.core debe estar presente"
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions).toBeDefined();
    expect(result.predictions.core).toBeDefined();
    expect(result.predictions.core).not.toBeNull();
  });

  it('predictions.secondary is null in LIMITED_MODE (§21.3)', () => {
    // §21.3: "secondary y explainability pueden ser null"
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.secondary).toBeNull();
  });

  it('predictions.explainability is null in LIMITED_MODE (§21.3)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.explainability).toBeNull();
  });

  it('operating_mode is LIMITED_MODE (§21)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.operating_mode).toBe('LIMITED_MODE');
  });

  it('eligibility_status is ELIGIBLE in LIMITED_MODE', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });

  it('predictions.core contains all required fields (§15.1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    const core = result.predictions.core;
    expect(typeof core.p_home_win).toBe('number');
    expect(typeof core.p_draw).toBe('number');
    expect(typeof core.p_away_win).toBe('number');
    expect(typeof core.expected_goals_home).toBe('number');
    expect(typeof core.expected_goals_away).toBe('number');
    expect(typeof core.predicted_result).toBe('string');
    expect(typeof core.predicted_result_conflict).toBe('boolean');
    expect(typeof core.favorite_margin).toBe('number');
    expect(typeof core.draw_risk).toBe('number');
  });
});

// ── FULL_MODE gating tests ─────────────────────────────────────────────────

describe('Operating mode gating — FULL_MODE (§21, §25.3)', () => {
  const fullValidation: ValidationResult = {
    match_id: 'test-match-001',
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

  it('predictions.core is present in FULL_MODE (§21)', () => {
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
    expect(result.predictions.core).not.toBeNull();
  });

  it('predictions.secondary is present and non-null in FULL_MODE (§21)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.secondary).toBeDefined();
    expect(result.predictions.secondary).not.toBeNull();
  });

  it('predictions.explainability is present and non-null in FULL_MODE (§21)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.explainability).toBeDefined();
    expect(result.predictions.explainability).not.toBeNull();
  });

  it('predictions.explainability.top_scorelines has at least 1 entry (§15.3)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.explainability?.top_scorelines?.length).toBeGreaterThan(0);
  });

  it('operating_mode is FULL_MODE (§21)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.operating_mode).toBe('FULL_MODE');
  });
});

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
import type { CompetitionProfile } from '../../src/contracts/types/competition-profile.js';
import type { ValidationResult } from '../../src/contracts/types/validation-result.js';
import type {
  DerivedRawOutputs,
  DerivedCalibratedOutputs,
} from '../../src/contracts/types/prediction-response.js';
import type { CalibrationVersionMetadata } from '../../src/calibration/version-metadata.js';
import type { PredictedResultOutput } from '../../src/engine/decision-policy.js';
import type { RawMatchDistributionResult } from '../../src/engine/scoreline-matrix.js';
import type { LambdaResult } from '../../src/engine/lambda-computer.js';
import {
  buildTestRaw1x2Probs,
  buildTestCalibratedProbs,
  buildTestRawDistribution,
} from '../helpers/branded-factories.js';

// ── Test fixtures ──────────────────────────────────────────────────────────

// Spec §8.1: valid CompetitionProfile for a domestic league round-robin match.
// stage_type: 'GROUP_STAGE' is the correct spec-defined value for a league
// matchday. §8.1 enumerates valid PredictiveStageType values — 'REGULAR_SEASON'
// and 'LEAGUE' are NOT in the spec enum and must not be used in tests.
const BASE_COMPETITION_PROFILE: CompetitionProfile = {
  team_domain: 'CLUB',
  competition_family: 'DOMESTIC_LEAGUE',
  stage_type: 'GROUP_STAGE', // §8.1: valid PredictiveStageType
  format_type: 'ROUND_ROBIN', // §8.1: valid FormatType for domestic league
  leg_type: 'SINGLE',
  neutral_venue: false,
  competition_profile_version: '1.0',
};

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
    // Spec §7.2: competition_profile uses valid CompetitionProfile type (no as any).
    competition_profile: BASE_COMPETITION_PROFILE,
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
  // §14.2: RawMatchDistribution branded type — use factory helper, not as any.
  const distribution = buildTestRawDistribution({ '0-0': 1.0 });
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
  // §16.1: Raw1x2Probs branded type — use factory helper, not as any.
  const raw1x2 = buildTestRaw1x2Probs(0.45, 0.27, 0.28);
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
  // §16.2: Calibrated1x2Probs branded type — use factory helper, not as any.
  const calibrated1x2 = buildTestCalibratedProbs(0.48, 0.25, 0.27);
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

  it('predictions.core contains all required fields (§15.1, FIX#64)', () => {
    // FIX #64 (F-002): In LIMITED_MODE, calibration-derived fields MUST be null.
    // Per §16.2: visible 1X2 outputs must be from calibrated_1x2_probs.
    // Since calibration is not applied in LIMITED_MODE, those fields are null.
    // Only lambda-derived fields (expected_goals_home/away) are always present.
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    const core = result.predictions.core;
    // Calibration-derived fields: null in LIMITED_MODE (§16.2, §21.3)
    expect(core.p_home_win).toBeNull();
    expect(core.p_draw).toBeNull();
    expect(core.p_away_win).toBeNull();
    // Lambda-derived fields: always present (§15.1)
    expect(typeof core.expected_goals_home).toBe('number');
    expect(typeof core.expected_goals_away).toBe('number');
    // Decision policy fields: null in LIMITED_MODE (require calibrated probs)
    expect(core.predicted_result).toBeNull();
    expect(core.predicted_result_conflict).toBeNull();
    expect(core.favorite_margin).toBeNull();
    expect(core.draw_risk).toBeNull();
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

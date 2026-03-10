/**
 * Tests for buildPredictionResponse — Phase 4 §21
 *
 * Spec authority:
 *   §21   — PredictionResponse v1 envelope
 *   §21.1 — NOT_ELIGIBLE: predictions structurally absent
 *   §21.3 — LIMITED_MODE: core required, secondary/explainability null
 *   §17.4 — version fields always present in FULL_MODE
 *   §19.5 — raw_1x2_probs and calibrated_1x2_probs in SEPARATE fields
 *   §22.3 — internals never in PredictionResponsePublic
 *
 * Tests:
 *   - NOT_ELIGIBLE → eligibility_status, predictions absent, reasons populated
 *   - LIMITED_MODE → predictions.core present, secondary/explainability null
 *   - FULL_MODE    → all fields present, version fields included
 */

import { describe, it, expect } from 'vitest';
import { buildPredictionResponse } from '../src/response-builder.js';
import type {
  BuildPredictionResponseParams,
  RawEngineOutputs,
  CalibratedOutputs,
} from '../src/response-builder.js';
import type { MatchInput } from '../src/contracts/types/match-input.js';
import type { ValidationResult } from '../src/contracts/types/validation-result.js';
import type {
  Raw1x2Probs,
  Calibrated1x2Probs,
  DerivedRawOutputs,
  DerivedCalibratedOutputs,
} from '../src/contracts/types/prediction-response.js';
import type { CalibrationVersionMetadata } from '../src/calibration/version-metadata.js';
import type { PredictedResultOutput } from '../src/engine/decision-policy.js';
import type { RawMatchDistributionResult } from '../src/engine/scoreline-matrix.js';
import type { LambdaResult } from '../src/engine/lambda-computer.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function mkRaw1x2(home: number, draw: number, away: number): Raw1x2Probs {
  return { home, draw, away } as unknown as Raw1x2Probs;
}

function mkCalibrated(home: number, draw: number, away: number): Calibrated1x2Probs {
  return { home, draw, away } as unknown as Calibrated1x2Probs;
}

function mkMatchInput(): MatchInput {
  return {
    schemaVersion: 1,
    match_id: 'match-001',
    kickoff_utc: '2025-03-15T20:00:00Z',
    competition_id: 'comp:football-data:PD',
    season_id: 'season-2024',
    home_team_id: 'team-001',
    away_team_id: 'team-002',
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
      away_completed_official_matches_last_365d: 18,
      home_completed_official_matches_last_730d: 38,
      away_completed_official_matches_last_730d: 36,
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

function mkLambdaResult(): LambdaResult {
  return {
    lambda_home: 1.45,
    lambda_away: 1.25,
    eloDiff: 50,
    epsilonApplied: false,
  };
}

function mkDistributionResult(): RawMatchDistributionResult {
  // Minimal distribution: "0-0" = 1.0 for testing purposes
  const distribution = { '0-0': 1.0 } as unknown as RawMatchDistributionResult['distribution'];
  return {
    distribution,
    tail_mass_raw: 0.001,
    tailMassExceeded: false,
    matrix_max_goal: 7,
    lambda_home: 1.45,
    lambda_away: 1.25,
  };
}

function mkDerivedRaw(): DerivedRawOutputs {
  return {
    over_2_5: 0.52,
    under_2_5: 0.48,
    over_1_5: 0.73,
    under_3_5: 0.65,
    btts_yes: 0.55,
    btts_no: 0.45,
    team_home_over_0_5: 0.72,
    team_away_over_0_5: 0.65,
    team_home_over_1_5: 0.42,
    team_away_over_1_5: 0.38,
    clean_sheet_home: 0.3,
    clean_sheet_away: 0.22,
    win_to_nil_home: 0.18,
    win_to_nil_away: 0.12,
    low_scoring_risk: 0.15,
    most_likely_scoreline: '1-1',
    top_scorelines: [
      { score: '1-1', p: 0.12 },
      { score: '2-1', p: 0.1 },
      { score: '1-0', p: 0.09 },
      { score: '0-0', p: 0.08 },
      { score: '2-0', p: 0.07 },
    ],
  };
}

function mkDerivedCalibrated(): DerivedCalibratedOutputs {
  return {
    home_or_draw: 0.72,
    draw_or_away: 0.52,
    home_or_away: 0.8,
    dnb_home: 0.58,
    dnb_away: 0.42,
  };
}

function mkPredictedResult(): PredictedResultOutput {
  return {
    predicted_result: 'HOME',
    predicted_result_conflict: false,
    favorite_margin: 0.25,
    too_close_margin_threshold: 0.02,
    decision_policy_version: 'v1.0',
  };
}

function mkEngineOutputs(): RawEngineOutputs {
  return {
    lambdaResult: mkLambdaResult(),
    distributionResult: mkDistributionResult(),
    raw1x2: mkRaw1x2(0.48, 0.28, 0.24),
    derivedRaw: mkDerivedRaw(),
    effectiveElo: {
      home: 1550,
      away: 1500,
      homAdvantageEffect: 50,
    },
  };
}

function mkCalibratedOutputs(): CalibratedOutputs {
  return {
    calibrated1x2: mkCalibrated(0.5, 0.25, 0.25),
    derivedCalibrated: mkDerivedCalibrated(),
    predictedResult: mkPredictedResult(),
  };
}

// ── NOT_ELIGIBLE tests ────────────────────────────────────────────────────

describe('buildPredictionResponse — NOT_ELIGIBLE (§21.1)', () => {
  const notEligibleValidation: ValidationResult = {
    match_id: 'match-001',
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

  it('returns eligibility_status NOT_ELIGIBLE', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
  });

  it('predictions field is structurally absent (not null, not undefined on the object)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    // NOT_ELIGIBLE response must not have a predictions field — §21.1
    expect(Object.prototype.hasOwnProperty.call(result, 'predictions')).toBe(false);
  });

  it('reasons contains at least one entry (§11.2)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons).toContain('MISSING_CRITICAL_FIELD');
  });

  it('version fields are present (§17.4)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.model_version).toBe('v1.0');
    expect(result.calibration_version).toBe('v1.0');
    expect(result.decision_policy_version).toBe('v1.0');
    expect(result.too_close_margin_threshold).toBe(0.02);
  });

  it('match_id is propagated', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.match_id).toBe('match-001');
  });

  it('engineering outputs ignored — no computation for NOT_ELIGIBLE (§21.1)', () => {
    // Even if engineOutputs is passed, NOT_ELIGIBLE path must return predictions-absent
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: notEligibleValidation,
      engineOutputs: mkEngineOutputs(), // should be ignored
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(Object.prototype.hasOwnProperty.call(result, 'predictions')).toBe(false);
  });
});

// ── LIMITED_MODE tests ────────────────────────────────────────────────────

describe('buildPredictionResponse — LIMITED_MODE (§21.3)', () => {
  const limitedValidation: ValidationResult = {
    match_id: 'match-001',
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

  it('returns eligibility_status ELIGIBLE', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });

  it('operating_mode is LIMITED_MODE', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkEngineOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.operating_mode).toBe('LIMITED_MODE');
  });

  it('predictions.core is present (§21.3)', () => {
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
    expect(result.predictions.core.expected_goals_home).toBeCloseTo(1.45);
    expect(result.predictions.core.expected_goals_away).toBeCloseTo(1.25);
  });

  it('predictions.secondary is null in LIMITED_MODE (§21.3)', () => {
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

  it('calibrated fields are absent from core probs (uses raw in LIMITED_MODE)', () => {
    const engineOutputs = mkEngineOutputs();
    // raw1x2 is 0.48/0.28/0.24 — should appear in core for LIMITED_MODE
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs,
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    // core probs should be raw in LIMITED_MODE
    expect(result.predictions.core.p_home_win).toBeCloseTo(0.48);
    expect(result.predictions.core.p_draw).toBeCloseTo(0.28);
    expect(result.predictions.core.p_away_win).toBeCloseTo(0.24);
  });
});

// ── FULL_MODE tests ───────────────────────────────────────────────────────

describe('buildPredictionResponse — FULL_MODE (§21)', () => {
  const fullValidation: ValidationResult = {
    match_id: 'match-001',
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

  it('returns eligibility_status ELIGIBLE with FULL_MODE', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.eligibility_status).toBe('ELIGIBLE');
    expect(result.operating_mode).toBe('FULL_MODE');
  });

  it('predictions.core uses calibrated probs (§15.1, §16.2)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    // core must use calibrated 1X2 probs (0.50/0.25/0.25), not raw (0.48/0.28/0.24)
    expect(result.predictions.core.p_home_win).toBeCloseTo(0.5);
    expect(result.predictions.core.p_draw).toBeCloseTo(0.25);
    expect(result.predictions.core.p_away_win).toBeCloseTo(0.25);
  });

  it('predictions.core.expected_goals comes from lambdas (§15.1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.core.expected_goals_home).toBeCloseTo(1.45);
    expect(result.predictions.core.expected_goals_away).toBeCloseTo(1.25);
  });

  it('predictions.core.predicted_result propagated from decision policy', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.core.predicted_result).toBe('HOME');
    expect(result.predictions.core.predicted_result_conflict).toBe(false);
    expect(result.predictions.core.favorite_margin).toBeCloseTo(0.25);
  });

  it('predictions.secondary is present in FULL_MODE (§15.2)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    const secondary = result.predictions.secondary;
    expect(secondary).not.toBeNull();
    // Double chance from calibrated
    expect(secondary?.home_or_draw).toBeCloseTo(0.72);
    // Goal totals from raw
    expect(secondary?.over_2_5).toBeCloseTo(0.52);
    expect(secondary?.btts_yes).toBeCloseTo(0.55);
  });

  it('predictions.explainability is present in FULL_MODE (§15.3)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    const explainability = result.predictions.explainability;
    expect(explainability).not.toBeNull();
    expect(explainability?.most_likely_scoreline).toBe('1-1');
    expect(explainability?.top_scorelines).toHaveLength(5);
  });

  it('version fields all present (§17.4)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.model_version).toBe('v1.0');
    expect(result.calibration_version).toBe('v1.0');
    expect(result.decision_policy_version).toBe('v1.0');
    expect(result.too_close_margin_threshold).toBe(0.02);
  });

  it('internals block contains raw_1x2_probs and calibrated_1x2_probs as SEPARATE fields (§19.5)', () => {
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
    expect(internals).toBeDefined();

    // raw_1x2_probs should be the raw values (0.48/0.28/0.24)
    expect(internals?.raw_1x2_probs.home).toBeCloseTo(0.48);
    expect(internals?.raw_1x2_probs.draw).toBeCloseTo(0.28);

    // calibrated_1x2_probs should be the calibrated values (0.50/0.25/0.25)
    expect(internals?.calibrated_1x2_probs.home).toBeCloseTo(0.5);
    expect(internals?.calibrated_1x2_probs.draw).toBeCloseTo(0.25);

    // The two must be in separate fields (§19.5)
    expect(internals?.raw_1x2_probs).not.toBe(internals?.calibrated_1x2_probs);
  });

  it('internals contains lambda and matrix metadata (§15.4)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');

    expect(result.internals?.lambda_home).toBeCloseTo(1.45);
    expect(result.internals?.lambda_away).toBeCloseTo(1.25);
    expect(result.internals?.tail_mass_raw).toBeCloseTo(0.001);
    expect(result.internals?.matrix_max_goal).toBe(7);
    expect(result.internals?.score_model_type).toBe('INDEPENDENT_POISSON');
  });

  it('PredictionResponsePublic omits internals (§22.3)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    // Simulate what the API layer does: delete internals before sending
    const publicResponse = { ...result };
    delete (publicResponse as Record<string, unknown>).internals;
    expect(Object.prototype.hasOwnProperty.call(publicResponse, 'internals')).toBe(false);
    // Public core must still be accessible
    if (publicResponse.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(publicResponse.predictions.core.p_home_win).toBeCloseTo(0.5);
  });
});

// ── Tail mass policy v1 tests (§14.2, CRITICAL-002) ──────────────────────
//
// Policy v1: when tailMassExceeded = true, the response-builder MUST:
//   1. Degrade operating_mode to LIMITED_MODE (even if input said FULL_MODE)
//   2. Set explainability to null (unreliable scorelines must not be surfaced)
//   3. Include EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS in reasons
//
// tail_mass_policy_version: 1

describe('Tail mass policy v1 — FULL_MODE input with tailMassExceeded=true (§14.2)', () => {
  const fullValidation: ValidationResult = {
    match_id: 'match-001',
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

  function mkEngineOutputsWithExceededTail(): RawEngineOutputs {
    const distribution = { '0-0': 1.0 } as unknown as RawMatchDistributionResult['distribution'];
    const distributionResult: RawMatchDistributionResult = {
      distribution,
      tail_mass_raw: 0.05, // exceeds MAX_TAIL_MASS_RAW = 0.01
      tailMassExceeded: true,
      matrix_max_goal: 7,
      lambda_home: 1.45,
      lambda_away: 1.25,
    };
    return {
      lambdaResult: mkLambdaResult(),
      distributionResult,
      raw1x2: mkRaw1x2(0.48, 0.28, 0.24),
      derivedRaw: mkDerivedRaw(),
      effectiveElo: { home: 1550, away: 1500, homAdvantageEffect: 50 },
    };
  }

  it('operating_mode is degraded to LIMITED_MODE when tailMassExceeded=true (policy v1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation, // FULL_MODE input
      engineOutputs: mkEngineOutputsWithExceededTail(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    // Policy v1: FULL_MODE must be degraded to LIMITED_MODE
    expect(result.operating_mode).toBe('LIMITED_MODE');
  });

  it('EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS is in reasons when tailMassExceeded=true (policy v1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputsWithExceededTail(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.reasons).toContain('EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS');
  });

  it('explainability is null when tailMassExceeded=true (policy v1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputsWithExceededTail(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.explainability).toBeNull();
  });

  it('eligibility_status remains ELIGIBLE after tail mass degradation (policy v1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputsWithExceededTail(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    // Degradation changes operating_mode, not eligibility_status
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });

  it('predictions.core is still present after tail mass degradation (policy v1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputsWithExceededTail(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    // Core must still be present — §21.3
    expect(result.predictions.core).toBeDefined();
    expect(result.predictions.core).not.toBeNull();
  });

  it('predictions.secondary is null after tail mass degradation (policy v1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputsWithExceededTail(),
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.secondary).toBeNull();
  });
});

describe('Tail mass policy v1 — FULL_MODE input with tailMassExceeded=false (no degradation)', () => {
  const fullValidation: ValidationResult = {
    match_id: 'match-001',
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

  it('operating_mode remains FULL_MODE when tailMassExceeded=false (policy v1 non-trigger)', () => {
    // tailMassExceeded=false in mkEngineOutputs() (tail_mass_raw=0.001 < 0.01)
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(), // tailMassExceeded: false
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.operating_mode).toBe('FULL_MODE');
  });

  it('EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS is NOT in reasons when tailMassExceeded=false', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(), // tailMassExceeded: false
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.reasons).not.toContain('EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS');
  });

  it('explainability is present when tailMassExceeded=false (no degradation)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: fullValidation,
      engineOutputs: mkEngineOutputs(), // tailMassExceeded: false
      calibratedOutputs: mkCalibratedOutputs(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    if (result.eligibility_status !== 'ELIGIBLE') throw new Error('Expected ELIGIBLE');
    expect(result.predictions.explainability).not.toBeNull();
  });
});

describe('Tail mass policy v1 — LIMITED_MODE input with tailMassExceeded=true', () => {
  const limitedValidation: ValidationResult = {
    match_id: 'match-001',
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

  function mkLimitedEngineOutputsWithExceededTail(): RawEngineOutputs {
    const distribution = { '0-0': 1.0 } as unknown as RawMatchDistributionResult['distribution'];
    const distributionResult: RawMatchDistributionResult = {
      distribution,
      tail_mass_raw: 0.05,
      tailMassExceeded: true,
      matrix_max_goal: 7,
      lambda_home: 1.45,
      lambda_away: 1.25,
    };
    return {
      lambdaResult: mkLambdaResult(),
      distributionResult,
      raw1x2: mkRaw1x2(0.48, 0.28, 0.24),
      derivedRaw: mkDerivedRaw(),
    };
  }

  it('EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS is added to reasons even in LIMITED_MODE input (policy v1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkLimitedEngineOutputsWithExceededTail(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    expect(result.reasons).toContain('EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS');
  });

  it('original reasons are preserved alongside the tail mass reason (policy v1)', () => {
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: limitedValidation,
      engineOutputs: mkLimitedEngineOutputsWithExceededTail(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    // Original reason must still be present
    expect(result.reasons).toContain('INTERLEAGUE_FACTOR_UNAVAILABLE');
    // Tail mass reason must also be present
    expect(result.reasons).toContain('EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS');
  });

  it('reason is not duplicated if already present (idempotent, policy v1)', () => {
    const validationWithTailReason: ValidationResult = {
      ...limitedValidation,
      reasons: ['INTERLEAGUE_FACTOR_UNAVAILABLE', 'EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS'],
    };
    const params: BuildPredictionResponseParams = {
      matchInput: mkMatchInput(),
      validationResult: validationWithTailReason,
      engineOutputs: mkLimitedEngineOutputsWithExceededTail(),
      versionMetadata: mkVersionMetadata(),
    };
    const result = buildPredictionResponse(params);
    const tailReasonCount = result.reasons.filter(
      (r) => r === 'EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS',
    ).length;
    expect(tailReasonCount).toBe(1);
  });
});

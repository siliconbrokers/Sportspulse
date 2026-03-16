/**
 * Tests for calibration metrics.
 *
 * Spec §23.2, §24
 *
 * Invariants tested:
 * - inclusive_accuracy counts TOO_CLOSE as wrong (§23.2)
 * - conditional_accuracy only over definite predictions (§23.2)
 * - effective_prediction_coverage = definite / total (§23.2)
 * - too_close_rate = too_close / total (§23.2)
 * - ClassificationMetrics always includes both accuracy AND coverage (§23.2)
 * - FullCalibrationMetrics always includes both (§23.2)
 * - Brier score and log loss computed correctly
 */

import { describe, it, expect } from 'vitest';
import {
  computeClassificationMetrics,
  computeProbabilityMetrics,
  computeCalibrationBuckets,
  computeFullCalibrationMetrics,
  computeMatchRPS,
} from '../../src/metrics/calibration-metrics.js';
import type { PredictionRecord } from '../../src/metrics/calibration-metrics.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRecord(
  predicted: 'HOME' | 'DRAW' | 'AWAY' | 'TOO_CLOSE',
  actual: 'HOME' | 'DRAW' | 'AWAY',
  home = 0.5,
  draw = 0.3,
  away = 0.2,
): PredictionRecord {
  return {
    predicted_result: predicted,
    actual_outcome: actual,
    calibrated_probs: { home, draw, away },
  };
}

// ── Classification metrics ─────────────────────────────────────────────────

describe('computeClassificationMetrics — accuracy and coverage (§23.2)', () => {
  it('returns zeroes for empty input', () => {
    const result = computeClassificationMetrics([]);
    expect(result.total_predictions).toBe(0);
    expect(result.inclusive_accuracy).toBe(0);
    expect(result.conditional_accuracy).toBe(0);
    expect(result.effective_prediction_coverage).toBe(0);
    expect(result.too_close_rate).toBe(0);
  });

  it('inclusive_accuracy counts TOO_CLOSE as wrong', () => {
    const records: PredictionRecord[] = [
      makeRecord('HOME', 'HOME'), // correct
      makeRecord('HOME', 'DRAW'), // wrong
      makeRecord('TOO_CLOSE', 'HOME'), // TOO_CLOSE → wrong for inclusive
    ];
    const result = computeClassificationMetrics(records);

    // Only 1 correct out of 3 total
    expect(result.inclusive_accuracy).toBeCloseTo(1 / 3, 10);
  });

  it('conditional_accuracy only over definite predictions', () => {
    const records: PredictionRecord[] = [
      makeRecord('HOME', 'HOME'), // definite, correct
      makeRecord('AWAY', 'DRAW'), // definite, wrong
      makeRecord('TOO_CLOSE', 'HOME'), // not counted in conditional
      makeRecord('DRAW', 'DRAW'), // definite, correct
    ];
    const result = computeClassificationMetrics(records);

    // 2 correct out of 3 definite
    expect(result.conditional_accuracy).toBeCloseTo(2 / 3, 10);
  });

  it('too_close_rate = too_close_count / total', () => {
    const records: PredictionRecord[] = [
      makeRecord('TOO_CLOSE', 'HOME'),
      makeRecord('TOO_CLOSE', 'DRAW'),
      makeRecord('HOME', 'HOME'),
      makeRecord('AWAY', 'AWAY'),
    ];
    const result = computeClassificationMetrics(records);

    expect(result.too_close_rate).toBeCloseTo(2 / 4, 10);
    expect(result.too_close_count).toBe(2);
  });

  it('effective_prediction_coverage = 1 - too_close_rate', () => {
    const records: PredictionRecord[] = [
      makeRecord('TOO_CLOSE', 'HOME'),
      makeRecord('HOME', 'HOME'),
      makeRecord('DRAW', 'DRAW'),
      makeRecord('AWAY', 'AWAY'),
    ];
    const result = computeClassificationMetrics(records);

    expect(result.effective_prediction_coverage).toBeCloseTo(1 - result.too_close_rate, 10);
    expect(result.effective_prediction_coverage).toBeCloseTo(3 / 4, 10);
  });

  it('always includes both conditional_accuracy AND effective_prediction_coverage (§23.2)', () => {
    // This test verifies the spec rule: never report accuracy alone without coverage
    const records = [makeRecord('HOME', 'HOME')];
    const result = computeClassificationMetrics(records);

    // Both fields must be present and have meaningful values
    expect(result).toHaveProperty('conditional_accuracy');
    expect(result).toHaveProperty('effective_prediction_coverage');
    expect(result).toHaveProperty('inclusive_accuracy');
    expect(typeof result.conditional_accuracy).toBe('number');
    expect(typeof result.effective_prediction_coverage).toBe('number');
    expect(typeof result.inclusive_accuracy).toBe('number');
  });

  it('all-correct scenario: inclusive = conditional = 1.0, coverage = 1.0', () => {
    const records: PredictionRecord[] = [
      makeRecord('HOME', 'HOME'),
      makeRecord('DRAW', 'DRAW'),
      makeRecord('AWAY', 'AWAY'),
    ];
    const result = computeClassificationMetrics(records);

    expect(result.inclusive_accuracy).toBeCloseTo(1.0, 10);
    expect(result.conditional_accuracy).toBeCloseTo(1.0, 10);
    expect(result.effective_prediction_coverage).toBeCloseTo(1.0, 10);
    expect(result.too_close_rate).toBeCloseTo(0.0, 10);
  });

  it('all-TOO_CLOSE scenario: inclusive = conditional = 0, coverage = 0', () => {
    const records: PredictionRecord[] = [
      makeRecord('TOO_CLOSE', 'HOME'),
      makeRecord('TOO_CLOSE', 'DRAW'),
    ];
    const result = computeClassificationMetrics(records);

    expect(result.inclusive_accuracy).toBe(0);
    expect(result.conditional_accuracy).toBe(0);
    expect(result.effective_prediction_coverage).toBe(0);
    expect(result.too_close_rate).toBe(1.0);
  });
});

// ── Probability metrics ────────────────────────────────────────────────────

describe('computeProbabilityMetrics — log loss and Brier score (§23.2)', () => {
  it('returns zeroes for empty input', () => {
    const result = computeProbabilityMetrics([]);
    expect(result.log_loss).toBe(0);
    expect(result.brier_score).toBe(0);
  });

  it('perfect prediction gives near-zero Brier score', () => {
    // p_home = 1.0 (effectively), outcome = HOME
    const records: PredictionRecord[] = [
      {
        predicted_result: 'HOME',
        actual_outcome: 'HOME',
        calibrated_probs: { home: 0.999, draw: 0.001, away: 0.0 },
      },
    ];
    const result = computeProbabilityMetrics(records);
    // Brier = (0.999-1)^2 + (0.001-0)^2 + (0-0)^2 ≈ 0.000002
    expect(result.brier_score).toBeLessThan(0.001);
    expect(result.log_loss).toBeLessThan(0.01);
  });

  it('worst prediction gives high log loss', () => {
    const records: PredictionRecord[] = [
      {
        predicted_result: 'AWAY',
        actual_outcome: 'HOME',
        calibrated_probs: { home: 0.001, draw: 0.001, away: 0.998 }, // very wrong
      },
    ];
    const result = computeProbabilityMetrics(records);
    // log loss = -log(0.001) ≈ 6.9
    expect(result.log_loss).toBeGreaterThan(5.0);
  });

  it('Brier score formula: mean of sum of squared errors over 3 classes', () => {
    const record: PredictionRecord = {
      predicted_result: 'HOME',
      actual_outcome: 'HOME',
      calibrated_probs: { home: 0.6, draw: 0.3, away: 0.1 },
    };
    const expected_brier = (0.6 - 1) ** 2 + (0.3 - 0) ** 2 + (0.1 - 0) ** 2;
    const result = computeProbabilityMetrics([record]);
    expect(result.brier_score).toBeCloseTo(expected_brier, 10);
  });

  it('returns zero rps for empty input', () => {
    const result = computeProbabilityMetrics([]);
    expect(result.rps).toBe(0);
  });

  it('rps is included in the probability metrics result', () => {
    const record: PredictionRecord = {
      predicted_result: 'HOME',
      actual_outcome: 'HOME',
      calibrated_probs: { home: 0.7, draw: 0.2, away: 0.1 },
    };
    const result = computeProbabilityMetrics([record]);
    expect(typeof result.rps).toBe('number');
    expect(result.rps).toBeGreaterThanOrEqual(0);
  });
});

// ── RPS (Ranked Probability Score) ────────────────────────────────────────

describe('computeMatchRPS — proper scoring rule for ordinal outcomes', () => {
  it('perfect home prediction → RPS = 0', () => {
    // p_home=1, outcome=HOME: F1=1, F2=1, O1=1, O2=1 → 0
    expect(computeMatchRPS({ home: 1, draw: 0, away: 0 }, 'HOME')).toBeCloseTo(0, 10);
  });

  it('perfect draw prediction → RPS = 0', () => {
    // p_draw=1, outcome=DRAW: F1=0, F2=1, O1=0, O2=1 → 0
    expect(computeMatchRPS({ home: 0, draw: 1, away: 0 }, 'DRAW')).toBeCloseTo(0, 10);
  });

  it('perfect away prediction → RPS = 0', () => {
    // p_away=1, outcome=AWAY: F1=0, F2=0, O1=0, O2=0 → 0
    expect(computeMatchRPS({ home: 0, draw: 0, away: 1 }, 'AWAY')).toBeCloseTo(0, 10);
  });

  it('worst prediction: p_home=1 but outcome=AWAY → RPS = 1', () => {
    // F1=1, F2=1, O1=0, O2=0 → ½[(1-0)²+(1-0)²] = 1
    expect(computeMatchRPS({ home: 1, draw: 0, away: 0 }, 'AWAY')).toBeCloseTo(1, 10);
  });

  it('adjacent miss: p_home=1 but outcome=DRAW → RPS = 0.5', () => {
    // F1=1, F2=1, O1=0, O2=1 → ½[(1-0)²+(1-1)²] = 0.5
    expect(computeMatchRPS({ home: 1, draw: 0, away: 0 }, 'DRAW')).toBeCloseTo(0.5, 10);
  });

  it('uniform prediction 1/3 each, outcome=HOME → RPS ≈ 0.2778', () => {
    // F1=1/3, F2=2/3, O1=1, O2=1 → ½[(1/3-1)²+(2/3-1)²] = ½[4/9+1/9] = 5/18
    const expected = 5 / 18;
    expect(computeMatchRPS({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, 'HOME')).toBeCloseTo(expected, 8);
  });

  it('uniform prediction 1/3 each, outcome=DRAW → RPS ≈ 0.1667', () => {
    // F1=1/3, F2=2/3, O1=0, O2=1 → ½[(1/3-0)²+(2/3-1)²] = ½[1/9+1/9] = 1/9
    const expected = 1 / 9;
    expect(computeMatchRPS({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, 'DRAW')).toBeCloseTo(expected, 8);
  });

  it('uniform prediction 1/3 each, outcome=AWAY → RPS ≈ 0.2778', () => {
    // F1=1/3, F2=2/3, O1=0, O2=0 → ½[(1/3-0)²+(2/3-0)²] = ½[1/9+4/9] = 5/18
    const expected = 5 / 18;
    expect(computeMatchRPS({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, 'AWAY')).toBeCloseTo(expected, 8);
  });

  it('ordinal penalty: predicting home when away wins > predicting draw when away wins', () => {
    // Predicting home (far from away) should get higher RPS than predicting draw (adjacent to away)
    const rpsHome = computeMatchRPS({ home: 1, draw: 0, away: 0 }, 'AWAY');     // = 1.0
    const rpsDraw = computeMatchRPS({ home: 0, draw: 1, away: 0 }, 'AWAY');     // = 0.5
    expect(rpsHome).toBeGreaterThan(rpsDraw);
  });

  it('mean RPS over batch of perfect predictions = 0', () => {
    const records: PredictionRecord[] = [
      { predicted_result: 'HOME', actual_outcome: 'HOME', calibrated_probs: { home: 1, draw: 0, away: 0 } },
      { predicted_result: 'DRAW', actual_outcome: 'DRAW', calibrated_probs: { home: 0, draw: 1, away: 0 } },
      { predicted_result: 'AWAY', actual_outcome: 'AWAY', calibrated_probs: { home: 0, draw: 0, away: 1 } },
    ];
    expect(computeProbabilityMetrics(records).rps).toBeCloseTo(0, 10);
  });
});

// ── FullCalibrationMetrics — coverage invariant ───────────────────────────

describe('computeFullCalibrationMetrics — complete reporting (§23.2)', () => {
  it('always includes classification.conditional_accuracy AND effective_prediction_coverage', () => {
    const records = [makeRecord('HOME', 'HOME'), makeRecord('TOO_CLOSE', 'DRAW')];
    const result = computeFullCalibrationMetrics(records);

    // The full metrics bundle must expose both fields
    expect(result.classification).toHaveProperty('conditional_accuracy');
    expect(result.classification).toHaveProperty('effective_prediction_coverage');
    expect(result.classification).toHaveProperty('inclusive_accuracy');
    expect(typeof result.classification.conditional_accuracy).toBe('number');
    expect(typeof result.classification.effective_prediction_coverage).toBe('number');
  });

  it('contains probability and calibration_buckets fields', () => {
    const records = [makeRecord('HOME', 'HOME')];
    const result = computeFullCalibrationMetrics(records);

    expect(result).toHaveProperty('probability');
    expect(result).toHaveProperty('calibration_buckets');
    expect(result.calibration_buckets).toHaveProperty('home');
    expect(result.calibration_buckets).toHaveProperty('draw');
    expect(result.calibration_buckets).toHaveProperty('away');
  });

  it('TOO_CLOSE predictions are included in total and coverage denominator', () => {
    // §23.2 rule: TOO_CLOSE is NOT excluded from the denominator
    const records: PredictionRecord[] = [
      makeRecord('TOO_CLOSE', 'HOME'),
      makeRecord('HOME', 'HOME'),
    ];
    const result = computeFullCalibrationMetrics(records);

    // Total should be 2, not 1
    expect(result.classification.total_predictions).toBe(2);
    // Coverage = 1 / 2 (only 1 definite prediction out of 2 total)
    expect(result.classification.effective_prediction_coverage).toBeCloseTo(0.5, 10);
  });
});

// ── Calibration buckets ───────────────────────────────────────────────────

describe('computeCalibrationBuckets', () => {
  it('returns numBuckets entries', () => {
    const records = [makeRecord('HOME', 'HOME', 0.6, 0.3, 0.1)];
    const buckets = computeCalibrationBuckets(records, 'HOME', 10);
    expect(buckets.length).toBe(10);
  });

  it('bucket with count = 0 has meets_acceptance_criterion = null', () => {
    const records = [makeRecord('HOME', 'HOME', 0.85, 0.1, 0.05)];
    // Bucket 0 (range [0, 0.1)) will be empty
    const buckets = computeCalibrationBuckets(records, 'HOME', 10);
    const emptyBucket = buckets[0]!; // [0, 0.1) — no samples here (0.85 goes to bucket 8)
    expect(emptyBucket.count).toBe(0);
    expect(emptyBucket.meets_acceptance_criterion).toBeNull();
  });
});

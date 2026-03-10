/**
 * coverage.test.ts — Classification metrics bundle invariant tests.
 *
 * Spec authority: §23.2 (Métricas), §24.1 (Umbrales de aceptación)
 *
 * Invariants tested:
 * - computeFullCalibrationMetrics returns BOTH inclusive_accuracy AND conditional_accuracy
 *   (never one without the other — §23.2 hard rule)
 * - effective_prediction_coverage always accompanies conditional_accuracy (§23.2)
 * - too_close_rate = too_close_count / total_predictions (§23.2)
 * - too_close_rate + effective_prediction_coverage = 1.0 (by definition)
 * - inclusive_accuracy ≤ conditional_accuracy always (inclusive counts TOO_CLOSE as wrong)
 * - computeClassificationMetrics handles empty input without errors
 * - calibration_buckets has entries for all three classes: HOME, DRAW, AWAY
 *
 * §23.2: "Queda prohibido reportar solo la accuracy condicional sin acompañarla de cobertura."
 */

import { describe, it, expect } from 'vitest';
import {
  computeClassificationMetrics,
  computeFullCalibrationMetrics,
} from '../../src/metrics/calibration-metrics.js';
import type { PredictionRecord } from '../../src/metrics/calibration-metrics.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

/** 20 records: mix of correct, incorrect, and TOO_CLOSE predictions. */
const RECORDS_MIXED: PredictionRecord[] = [
  // Correct HOME predictions
  {
    predicted_result: 'HOME',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.6, draw: 0.25, away: 0.15 },
  },
  {
    predicted_result: 'HOME',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.65, draw: 0.2, away: 0.15 },
  },
  {
    predicted_result: 'HOME',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.55, draw: 0.25, away: 0.2 },
  },
  {
    predicted_result: 'HOME',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.7, draw: 0.15, away: 0.15 },
  },
  // Incorrect HOME predictions
  {
    predicted_result: 'HOME',
    actual_outcome: 'DRAW',
    calibrated_probs: { home: 0.5, draw: 0.3, away: 0.2 },
  },
  {
    predicted_result: 'HOME',
    actual_outcome: 'AWAY',
    calibrated_probs: { home: 0.45, draw: 0.3, away: 0.25 },
  },
  // Correct DRAW predictions
  {
    predicted_result: 'DRAW',
    actual_outcome: 'DRAW',
    calibrated_probs: { home: 0.3, draw: 0.45, away: 0.25 },
  },
  {
    predicted_result: 'DRAW',
    actual_outcome: 'DRAW',
    calibrated_probs: { home: 0.28, draw: 0.5, away: 0.22 },
  },
  // Incorrect DRAW prediction
  {
    predicted_result: 'DRAW',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.35, draw: 0.4, away: 0.25 },
  },
  // Correct AWAY predictions
  {
    predicted_result: 'AWAY',
    actual_outcome: 'AWAY',
    calibrated_probs: { home: 0.2, draw: 0.25, away: 0.55 },
  },
  {
    predicted_result: 'AWAY',
    actual_outcome: 'AWAY',
    calibrated_probs: { home: 0.15, draw: 0.2, away: 0.65 },
  },
  // Incorrect AWAY prediction
  {
    predicted_result: 'AWAY',
    actual_outcome: 'DRAW',
    calibrated_probs: { home: 0.25, draw: 0.35, away: 0.4 },
  },
  // TOO_CLOSE predictions (always wrong for inclusive_accuracy)
  {
    predicted_result: 'TOO_CLOSE',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.35, draw: 0.33, away: 0.32 },
  },
  {
    predicted_result: 'TOO_CLOSE',
    actual_outcome: 'DRAW',
    calibrated_probs: { home: 0.34, draw: 0.35, away: 0.31 },
  },
  {
    predicted_result: 'TOO_CLOSE',
    actual_outcome: 'AWAY',
    calibrated_probs: { home: 0.33, draw: 0.33, away: 0.34 },
  },
  {
    predicted_result: 'TOO_CLOSE',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.36, draw: 0.32, away: 0.32 },
  },
  // More correct predictions
  {
    predicted_result: 'HOME',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.58, draw: 0.22, away: 0.2 },
  },
  {
    predicted_result: 'AWAY',
    actual_outcome: 'AWAY',
    calibrated_probs: { home: 0.18, draw: 0.22, away: 0.6 },
  },
  {
    predicted_result: 'DRAW',
    actual_outcome: 'DRAW',
    calibrated_probs: { home: 0.29, draw: 0.43, away: 0.28 },
  },
  {
    predicted_result: 'HOME',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.62, draw: 0.2, away: 0.18 },
  },
];

/** Records with all TOO_CLOSE results. */
const RECORDS_ALL_TOO_CLOSE: PredictionRecord[] = Array.from({ length: 10 }, (_, i) => ({
  predicted_result: 'TOO_CLOSE' as const,
  actual_outcome: (['HOME', 'DRAW', 'AWAY'] as const)[i % 3]!,
  calibrated_probs: { home: 0.34, draw: 0.33, away: 0.33 },
}));

/** Records with no TOO_CLOSE. */
const RECORDS_NO_TOO_CLOSE: PredictionRecord[] = [
  {
    predicted_result: 'HOME',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.6, draw: 0.25, away: 0.15 },
  },
  {
    predicted_result: 'HOME',
    actual_outcome: 'HOME',
    calibrated_probs: { home: 0.65, draw: 0.2, away: 0.15 },
  },
  {
    predicted_result: 'AWAY',
    actual_outcome: 'DRAW',
    calibrated_probs: { home: 0.2, draw: 0.35, away: 0.45 },
  },
  {
    predicted_result: 'DRAW',
    actual_outcome: 'DRAW',
    calibrated_probs: { home: 0.25, draw: 0.5, away: 0.25 },
  },
];

// ── Mandatory reporting bundle tests ───────────────────────────────────────

describe('computeFullCalibrationMetrics — mandatory bundle (§23.2)', () => {
  it('returns inclusive_accuracy in the classification bundle (§23.2)', () => {
    // §23.2: inclusive_accuracy = correct / total_eligible
    const metrics = computeFullCalibrationMetrics(RECORDS_MIXED);
    expect(metrics.classification).toBeDefined();
    expect(typeof metrics.classification.inclusive_accuracy).toBe('number');
  });

  it('returns conditional_accuracy in the classification bundle (§23.2)', () => {
    // §23.2: conditional_accuracy = correct / definite_result_count
    const metrics = computeFullCalibrationMetrics(RECORDS_MIXED);
    expect(typeof metrics.classification.conditional_accuracy).toBe('number');
  });

  it('returns effective_prediction_coverage alongside conditional_accuracy (§23.2)', () => {
    // §23.2: HARD RULE — "queda prohibido reportar solo la accuracy condicional
    //         sin acompañarla de cobertura"
    const metrics = computeFullCalibrationMetrics(RECORDS_MIXED);
    // Both must be present in the same bundle
    expect(typeof metrics.classification.conditional_accuracy).toBe('number');
    expect(typeof metrics.classification.effective_prediction_coverage).toBe('number');
  });

  it('returns calibration_buckets for all three classes (HOME, DRAW, AWAY)', () => {
    const metrics = computeFullCalibrationMetrics(RECORDS_MIXED);
    expect(metrics.calibration_buckets.home).toBeDefined();
    expect(metrics.calibration_buckets.draw).toBeDefined();
    expect(metrics.calibration_buckets.away).toBeDefined();
  });

  it('returns probability metrics (log_loss and brier_score)', () => {
    const metrics = computeFullCalibrationMetrics(RECORDS_MIXED);
    expect(typeof metrics.probability.log_loss).toBe('number');
    expect(typeof metrics.probability.brier_score).toBe('number');
  });
});

// ── too_close_rate correctness ─────────────────────────────────────────────

describe('computeClassificationMetrics — too_close_rate (§23.2)', () => {
  it('too_close_rate = too_close_count / total_predictions', () => {
    // §23.2: too_close_rate = TOO_CLOSE_count / total_eligible
    const metrics = computeClassificationMetrics(RECORDS_MIXED);
    const expected = 4 / 20; // 4 TOO_CLOSE out of 20 total
    expect(metrics.too_close_rate).toBeCloseTo(expected, 10);
  });

  it('too_close_rate = 1.0 when all predictions are TOO_CLOSE', () => {
    const metrics = computeClassificationMetrics(RECORDS_ALL_TOO_CLOSE);
    expect(metrics.too_close_rate).toBeCloseTo(1.0, 10);
  });

  it('too_close_rate = 0.0 when no predictions are TOO_CLOSE', () => {
    const metrics = computeClassificationMetrics(RECORDS_NO_TOO_CLOSE);
    expect(metrics.too_close_rate).toBeCloseTo(0.0, 10);
  });

  it('too_close_rate + effective_prediction_coverage = 1.0', () => {
    // By definition: rate + coverage = (TOO_CLOSE / total) + (definite / total) = 1
    const metrics = computeClassificationMetrics(RECORDS_MIXED);
    const sum = metrics.too_close_rate + metrics.effective_prediction_coverage;
    expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(1e-10);
  });

  it('too_close_count = total_predictions - definite_count', () => {
    const metrics = computeClassificationMetrics(RECORDS_MIXED);
    expect(metrics.too_close_count + metrics.definite_count).toBe(metrics.total_predictions);
  });
});

// ── inclusive vs conditional accuracy relationship ─────────────────────────

describe('computeClassificationMetrics — accuracy relationship (§23.2)', () => {
  it('inclusive_accuracy ≤ conditional_accuracy when there are TOO_CLOSE predictions', () => {
    // Inclusive counts TOO_CLOSE as wrong; conditional ignores them.
    // Therefore inclusive_accuracy ≤ conditional_accuracy.
    const metrics = computeClassificationMetrics(RECORDS_MIXED);
    expect(metrics.inclusive_accuracy).toBeLessThanOrEqual(metrics.conditional_accuracy + 1e-10);
  });

  it('inclusive_accuracy = conditional_accuracy when no TOO_CLOSE predictions', () => {
    // When too_close_count = 0, both accuracies should be equal
    const metrics = computeClassificationMetrics(RECORDS_NO_TOO_CLOSE);
    expect(metrics.too_close_count).toBe(0);
    expect(metrics.inclusive_accuracy).toBeCloseTo(metrics.conditional_accuracy, 10);
  });

  it('inclusive_accuracy = 0 when all predictions are TOO_CLOSE', () => {
    // TOO_CLOSE never counts as correct — inclusive_accuracy = 0
    const metrics = computeClassificationMetrics(RECORDS_ALL_TOO_CLOSE);
    expect(metrics.inclusive_accuracy).toBeCloseTo(0, 10);
  });

  it('conditional_accuracy = 0 when definite_count = 0 (all TOO_CLOSE)', () => {
    const metrics = computeClassificationMetrics(RECORDS_ALL_TOO_CLOSE);
    expect(metrics.definite_count).toBe(0);
    expect(metrics.conditional_accuracy).toBeCloseTo(0, 10);
  });
});

// ── Empty input edge case ─────────────────────────────────────────────────

describe('computeClassificationMetrics — empty input (§23.2)', () => {
  it('returns zero metrics for empty input without throwing', () => {
    const metrics = computeClassificationMetrics([]);
    expect(metrics.total_predictions).toBe(0);
    expect(metrics.inclusive_accuracy).toBe(0);
    expect(metrics.conditional_accuracy).toBe(0);
    expect(metrics.too_close_rate).toBe(0);
    expect(metrics.effective_prediction_coverage).toBe(0);
  });
});

// ── Metric correctness verification ───────────────────────────────────────

describe('computeClassificationMetrics — value correctness (§23.2)', () => {
  it('total_predictions matches input record count', () => {
    const metrics = computeClassificationMetrics(RECORDS_MIXED);
    expect(metrics.total_predictions).toBe(RECORDS_MIXED.length);
    expect(metrics.total_predictions).toBe(20);
  });

  it('too_close_count is exactly 4 for RECORDS_MIXED', () => {
    const metrics = computeClassificationMetrics(RECORDS_MIXED);
    expect(metrics.too_close_count).toBe(4);
  });

  it('effective_prediction_coverage = definite_count / total', () => {
    const metrics = computeClassificationMetrics(RECORDS_MIXED);
    const expected = metrics.definite_count / metrics.total_predictions;
    expect(metrics.effective_prediction_coverage).toBeCloseTo(expected, 10);
  });

  it('all metric values are in [0, 1] (valid probability range)', () => {
    const metrics = computeClassificationMetrics(RECORDS_MIXED);
    expect(metrics.inclusive_accuracy).toBeGreaterThanOrEqual(0);
    expect(metrics.inclusive_accuracy).toBeLessThanOrEqual(1);
    expect(metrics.conditional_accuracy).toBeGreaterThanOrEqual(0);
    expect(metrics.conditional_accuracy).toBeLessThanOrEqual(1);
    expect(metrics.too_close_rate).toBeGreaterThanOrEqual(0);
    expect(metrics.too_close_rate).toBeLessThanOrEqual(1);
    expect(metrics.effective_prediction_coverage).toBeGreaterThanOrEqual(0);
    expect(metrics.effective_prediction_coverage).toBeLessThanOrEqual(1);
  });
});

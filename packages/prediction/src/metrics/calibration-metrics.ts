/**
 * calibration-metrics.ts — batch evaluation metrics for the prediction engine.
 *
 * Spec authority:
 * - §23.2 (Métricas — clasificación, probabilidades, scoreline, goles)
 * - §24 (Umbrales de aceptación v1)
 *
 * These are BATCH functions, not called per-prediction at runtime.
 * They operate on historical sets of predictions and actual outcomes.
 *
 * HARD RULE from spec §23.2:
 * "Queda prohibido reportar solo la accuracy condicional sin acompañarla de cobertura."
 * Every public function that returns accuracy MUST also return coverage.
 *
 * Metric definitions (§23.2):
 * - inclusive_accuracy: correct / total_eligible (TOO_CLOSE counts as wrong)
 * - conditional_accuracy: correct / predictions_with_definite_result
 * - too_close_rate: TOO_CLOSE_count / total_eligible
 * - effective_prediction_coverage: definite_result_count / total_eligible
 */

import type { PredictedResult } from '../contracts/index.js';
import { MIN_BUCKET_SAMPLE_FOR_CALIBRATION_EVAL } from '../contracts/constants.js';

// ── Input types ────────────────────────────────────────────────────────────

/**
 * A single prediction record for batch evaluation.
 */
export interface PredictionRecord {
  /** The predicted result. */
  readonly predicted_result: PredictedResult;

  /** Actual match outcome. */
  readonly actual_outcome: 'HOME' | 'DRAW' | 'AWAY';

  /** Calibrated 1X2 probabilities used for this prediction. */
  readonly calibrated_probs: {
    readonly home: number;
    readonly draw: number;
    readonly away: number;
  };
}

// ── Core accuracy metrics ─────────────────────────────────────────────────

/**
 * Classification accuracy metrics for a batch of predictions.
 *
 * Per §23.2 — mandatory reporting bundle.
 * NEVER return conditional_accuracy alone. Always return coverage with it.
 */
export interface ClassificationMetrics {
  /** Total number of eligible predictions evaluated. */
  readonly total_predictions: number;

  /** Number of predictions with predicted_result = TOO_CLOSE. */
  readonly too_close_count: number;

  /**
   * Number of predictions with definite result (HOME, DRAW, AWAY).
   * = total_predictions - too_close_count
   */
  readonly definite_count: number;

  /**
   * inclusive_accuracy = correct / total_predictions.
   * TOO_CLOSE is counted as incorrect. §23.2
   */
  readonly inclusive_accuracy: number;

  /**
   * conditional_accuracy = correct / definite_count.
   * Only predictions with HOME, DRAW, AWAY results are counted. §23.2
   * MUST be reported alongside effective_prediction_coverage. §23.2
   */
  readonly conditional_accuracy: number;

  /**
   * too_close_rate = too_close_count / total_predictions. §23.2
   * Acceptance threshold (STRONG context): <= 0.15. §24.1
   */
  readonly too_close_rate: number;

  /**
   * effective_prediction_coverage = definite_count / total_predictions. §23.2
   * = 1 - too_close_rate
   * Acceptance threshold (STRONG context): >= 0.85. §24.1
   * MUST accompany conditional_accuracy. §23.2
   */
  readonly effective_prediction_coverage: number;
}

/**
 * Compute classification metrics for a batch of predictions.
 *
 * Implements all metrics defined in §23.2 and satisfies the mandatory
 * coverage + accuracy reporting rule.
 *
 * @param records Batch of prediction records with actual outcomes
 */
export function computeClassificationMetrics(
  records: readonly PredictionRecord[],
): ClassificationMetrics {
  const total = records.length;

  if (total === 0) {
    return {
      total_predictions: 0,
      too_close_count: 0,
      definite_count: 0,
      inclusive_accuracy: 0,
      conditional_accuracy: 0,
      too_close_rate: 0,
      effective_prediction_coverage: 0,
    };
  }

  let too_close_count = 0;
  let definite_correct = 0;
  let definite_count = 0;

  for (const record of records) {
    if (record.predicted_result === 'TOO_CLOSE') {
      too_close_count++;
      // TOO_CLOSE counts as incorrect for inclusive_accuracy
    } else {
      definite_count++;
      if (record.predicted_result === record.actual_outcome) {
        definite_correct++;
      }
    }
  }

  const inclusive_accuracy = definite_correct / total;
  const conditional_accuracy = definite_count > 0 ? definite_correct / definite_count : 0;
  const too_close_rate = too_close_count / total;
  const effective_prediction_coverage = definite_count / total;

  return {
    total_predictions: total,
    too_close_count,
    definite_count,
    inclusive_accuracy,
    conditional_accuracy,
    too_close_rate,
    effective_prediction_coverage,
  };
}

// ── Probability scoring metrics ────────────────────────────────────────────

/**
 * Log loss, Brier score, and RPS for 1X2 probability predictions.
 *
 * Per §23.2: "log loss, Brier score, calibración por buckets"
 * RPS (Ranked Probability Score) is a proper scoring rule for ordinal outcomes.
 */
export interface ProbabilityMetrics {
  /** Log loss over all predictions. Lower is better. §23.2 */
  readonly log_loss: number;

  /** Mean Brier score over all predictions. Lower is better. §23.2 */
  readonly brier_score: number;

  /**
   * Mean Ranked Probability Score (RPS) over all predictions. Lower is better.
   *
   * RPS captures the ordinal structure H > D > A — a prediction that places mass
   * far from the actual outcome is penalized more heavily than Brier score.
   *
   * Formula (K=3):
   *   F1 = p_home;  F2 = p_home + p_draw
   *   O1 = I(outcome=HOME);  O2 = I(outcome∈{HOME,DRAW})
   *   RPS = ½ × [(F1−O1)² + (F2−O2)²]
   *
   * Range [0, 1]. Baseline (1/3 each): ≈ 0.222 for uniform outcome distribution.
   */
  readonly rps: number;
}

/**
 * Compute RPS for a single prediction.
 *
 * Pure function. Stable for use outside batch evaluation.
 *
 * @param probs   Calibrated 1X2 probabilities { home, draw, away }
 * @param outcome Actual match outcome
 */
export function computeMatchRPS(
  probs: { home: number; draw: number; away: number },
  outcome: 'HOME' | 'DRAW' | 'AWAY',
): number {
  // Cumulative forecasts
  const F1 = probs.home;
  const F2 = probs.home + probs.draw;

  // Cumulative outcomes (ordinal: HOME > DRAW > AWAY)
  const O1 = outcome === 'HOME' ? 1 : 0;
  const O2 = outcome === 'HOME' || outcome === 'DRAW' ? 1 : 0;

  return 0.5 * ((F1 - O1) ** 2 + (F2 - O2) ** 2);
}

/**
 * Compute log loss, Brier score, and RPS for a batch of predictions.
 *
 * Log loss = -mean(log(p_correct_class)) per prediction.
 * Brier score = mean(Σ(p_i - o_i)^2) per prediction (sum over 3 classes).
 * RPS = mean(computeMatchRPS(probs, outcome)) per prediction.
 *
 * @param records Batch of prediction records
 */
export function computeProbabilityMetrics(
  records: readonly PredictionRecord[],
): ProbabilityMetrics {
  const total = records.length;

  if (total === 0) {
    return { log_loss: 0, brier_score: 0, rps: 0 };
  }

  const LOG_EPSILON = 1e-15; // clamp to avoid log(0)
  let totalLogLoss = 0;
  let totalBrier = 0;
  let totalRPS = 0;

  for (const record of records) {
    const { home, draw, away } = record.calibrated_probs;
    const outcome = record.actual_outcome;

    // One-hot encoding of actual outcome
    const o_home = outcome === 'HOME' ? 1 : 0;
    const o_draw = outcome === 'DRAW' ? 1 : 0;
    const o_away = outcome === 'AWAY' ? 1 : 0;

    // Log loss: -log(p_correct_class)
    const p_correct = outcome === 'HOME' ? home : outcome === 'DRAW' ? draw : away;
    totalLogLoss -= Math.log(Math.max(p_correct, LOG_EPSILON));

    // Brier score: Σ(p_i - o_i)^2 over 3 classes
    const brier = (home - o_home) ** 2 + (draw - o_draw) ** 2 + (away - o_away) ** 2;
    totalBrier += brier;

    // RPS
    totalRPS += computeMatchRPS(record.calibrated_probs, outcome);
  }

  return {
    log_loss: totalLogLoss / total,
    brier_score: totalBrier / total,
    rps: totalRPS / total,
  };
}

// ── Calibration bucket metrics ────────────────────────────────────────────

/**
 * A single calibration bucket for one class.
 *
 * Per §23.2: "calibración por buckets"
 * Per §24.1: "error absoluto por bucket <= 0.07 en buckets con n >= min_bucket_sample_for_calibration_eval"
 */
export interface CalibrationBucket {
  /** Class this bucket is for. */
  readonly class_label: 'HOME' | 'DRAW' | 'AWAY';
  /** Lower bound of the predicted probability range. */
  readonly bucket_lower: number;
  /** Upper bound of the predicted probability range. */
  readonly bucket_upper: number;
  /** Number of samples in this bucket. */
  readonly count: number;
  /** Mean predicted probability for this bucket. */
  readonly mean_predicted: number;
  /** Fraction of actual outcomes matching this class in this bucket. */
  readonly actual_fraction: number;
  /** |mean_predicted - actual_fraction| */
  readonly absolute_error: number;
  /**
   * True if this bucket meets the acceptance criterion from §24.1:
   * absolute_error <= 0.07 when count >= MIN_BUCKET_SAMPLE_FOR_CALIBRATION_EVAL.
   * For underpopulated buckets, this is null (not evaluated).
   */
  readonly meets_acceptance_criterion: boolean | null;
}

/**
 * Compute calibration bucket metrics for a single class.
 *
 * Uses equal-width buckets from 0 to 1.
 *
 * @param records Batch of prediction records
 * @param classLabel The class to evaluate
 * @param numBuckets Number of equal-width buckets (default 10)
 */
export function computeCalibrationBuckets(
  records: readonly PredictionRecord[],
  classLabel: 'HOME' | 'DRAW' | 'AWAY',
  numBuckets = 10,
): CalibrationBucket[] {
  // Initialize buckets
  const buckets: Array<{
    sum_predicted: number;
    count: number;
    actual_count: number;
  }> = Array.from({ length: numBuckets }, () => ({
    sum_predicted: 0,
    count: 0,
    actual_count: 0,
  }));

  for (const record of records) {
    const p =
      classLabel === 'HOME'
        ? record.calibrated_probs.home
        : classLabel === 'DRAW'
          ? record.calibrated_probs.draw
          : record.calibrated_probs.away;

    // Assign to bucket (clamp to [0, numBuckets - 1])
    const bucketIdx = Math.min(Math.floor(p * numBuckets), numBuckets - 1);
    const bucket = buckets[bucketIdx]!;
    bucket.sum_predicted += p;
    bucket.count++;
    if (record.actual_outcome === classLabel) {
      bucket.actual_count++;
    }
  }

  const result: CalibrationBucket[] = [];

  for (let i = 0; i < numBuckets; i++) {
    const bucket = buckets[i]!;
    const bucket_lower = i / numBuckets;
    const bucket_upper = (i + 1) / numBuckets;

    if (bucket.count === 0) {
      result.push({
        class_label: classLabel,
        bucket_lower,
        bucket_upper,
        count: 0,
        mean_predicted: 0,
        actual_fraction: 0,
        absolute_error: 0,
        meets_acceptance_criterion: null,
      });
      continue;
    }

    const mean_predicted = bucket.sum_predicted / bucket.count;
    const actual_fraction = bucket.actual_count / bucket.count;
    const absolute_error = Math.abs(mean_predicted - actual_fraction);

    let meets_acceptance_criterion: boolean | null = null;
    if (bucket.count >= MIN_BUCKET_SAMPLE_FOR_CALIBRATION_EVAL) {
      // §24.1: absolute error per bucket <= 0.07
      meets_acceptance_criterion = absolute_error <= 0.07;
    }

    result.push({
      class_label: classLabel,
      bucket_lower,
      bucket_upper,
      count: bucket.count,
      mean_predicted,
      actual_fraction,
      absolute_error,
      meets_acceptance_criterion,
    });
  }

  return result;
}

// ── Full metrics bundle ───────────────────────────────────────────────────

/**
 * Complete metrics bundle for a batch evaluation run.
 *
 * Satisfies §23.2 mandatory reporting:
 * - classification (inclusive + conditional + coverage)
 * - probability scoring (log loss + Brier)
 * - calibration buckets per class
 *
 * HARD RULE: no path exposes conditional_accuracy without coverage. §23.2
 */
export interface FullCalibrationMetrics {
  readonly classification: ClassificationMetrics;
  readonly probability: ProbabilityMetrics;
  readonly calibration_buckets: {
    readonly home: CalibrationBucket[];
    readonly draw: CalibrationBucket[];
    readonly away: CalibrationBucket[];
  };
}

/**
 * Compute all mandatory metrics for a batch of predictions.
 *
 * This is the authoritative entry point for model evaluation.
 * Returns all metrics required by §23.2 and §24.
 *
 * @param records Batch of prediction records
 * @param numBuckets Calibration bucket count (default 10)
 */
export function computeFullCalibrationMetrics(
  records: readonly PredictionRecord[],
  numBuckets = 10,
): FullCalibrationMetrics {
  return {
    classification: computeClassificationMetrics(records),
    probability: computeProbabilityMetrics(records),
    calibration_buckets: {
      home: computeCalibrationBuckets(records, 'HOME', numBuckets),
      draw: computeCalibrationBuckets(records, 'DRAW', numBuckets),
      away: computeCalibrationBuckets(records, 'AWAY', numBuckets),
    },
  };
}

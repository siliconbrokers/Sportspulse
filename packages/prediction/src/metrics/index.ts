/**
 * Metrics module public surface.
 *
 * Batch evaluation metrics for the prediction engine. §23, §24
 * These are never called in runtime prediction paths.
 */

export {
  computeClassificationMetrics,
  computeProbabilityMetrics,
  computeCalibrationBuckets,
  computeFullCalibrationMetrics,
  computeMatchRPS,
} from './calibration-metrics.js';

export type {
  PredictionRecord,
  ClassificationMetrics,
  ProbabilityMetrics,
  CalibrationBucket,
  FullCalibrationMetrics,
} from './calibration-metrics.js';

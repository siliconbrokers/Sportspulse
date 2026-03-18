/**
 * NEXUS Ensemble Module — Phase 3 Barrel Export.
 *
 * Spec authority: taxonomy spec S7–S8.
 *
 * Exports the complete meta-ensemble API:
 * - Types and constants
 * - Weight optimizer (walk-forward)
 * - Ensemble combiner (linear combination + redistribution)
 * - Ensemble calibrator (isotonic one-vs-rest, per-liga/global)
 * - Ensemble orchestrator (top-level runNexusEnsemble)
 */

// Types, constants, and configuration
export type {
  Track12Output,
  Track3EnsembleInput,
  Track4EnsembleInput,
  PredictionHorizon,
  // DataQualityTier is NOT re-exported here — it is already exported by
  // nexus/feature-store/index.ts with the same canonical definition (NEXUS-0 S7.3).
  // Callers should import DataQualityTier from the feature-store or nexus root.
  SegmentKey,
  WeightVector,
  WeightRegistry,
  CalibrationDataPoint,
  CalibrationPoint,
  PerClassCalibrator,
  NexusCalibrationTable,
  CalibrationSource,
  EnsembleTrainingRecord,
  CombinedProbsUncalibrated,
  NexusEnsembleOutput,
} from './types.js';

export {
  MIN_WEIGHT_TRACK12,
  MIN_SAMPLES_PER_LIGA_CALIBRATION,
  MIN_SAMPLES_SEGMENT,
  MIN_SAMPLES_LEAGUE,
  MIN_SAMPLES_GLOBAL,
  ENSEMBLE_VERSION,
  CALIBRATION_VERSION,
  CONFIDENCE_THRESHOLD_HIGH,
  CONFIDENCE_THRESHOLD_MEDIUM,
} from './types.js';

// Weight optimizer
export {
  computeRPS,
  learnWeights,
  learnEnsembleWeights,
  lookupWeights,
  buildSegmentKey,
  buildLeagueHorizonKey,
  buildLeagueKey,
} from './weight-optimizer.js';

// Ensemble combiner
export {
  redistributeWeights,
  linearCombine,
  combineEnsemble,
} from './ensemble-combiner.js';

// Ensemble calibrator
export {
  CalibrationTemporalLeakageError,
  fitPAVA,
  interpolate,
  fitNexusCalibrationFromTriplets,
  applyNexusCalibration,
  buildBootstrapCalibrationTable,
} from './ensemble-calibrator.js';
export type { CalibrationTripletBundle } from './ensemble-calibrator.js';

// Ensemble orchestrator
export { runNexusEnsemble } from './nexus-ensemble.js';

/**
 * Calibration module public surface.
 *
 * Exports isotonic calibration, segment selection, and version metadata.
 * Spec §17
 */

export {
  IsotonicCalibrator,
  TemporalLeakageError,
  fitOneVsRestCalibrators,
  applyOneVsRestCalibration,
} from './isotonic-calibrator.js';

export type {
  CalibrationSample,
  OneVsRestCalibrators,
  OneVsRestTrainingSample,
} from './isotonic-calibrator.js';

export {
  selectCalibrator,
  buildSegmentId,
  MIN_SAMPLES_FOR_SEGMENTED_CALIBRATION,
  MIN_SAMPLES_FOR_INTERMEDIATE_CALIBRATION,
} from './calibration-selector.js';

export type {
  CalibrationSegmentId,
  CalibrationSegmentRecord,
  CalibrationRegistry,
  CalibrationSelectionResult,
} from './calibration-selector.js';

export {
  buildCurrentVersionMetadata,
  getDecisionPolicyConfig,
  DECISION_POLICY_REGISTRY,
  CURRENT_DECISION_POLICY_VERSION,
  CURRENT_MODEL_VERSION,
  CURRENT_CALIBRATION_VERSION,
} from './version-metadata.js';

export type { CalibrationVersionMetadata, DecisionPolicyConfig } from './version-metadata.js';

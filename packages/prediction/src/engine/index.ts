/**
 * Engine module public surface.
 *
 * Exports derived calibrated computations and decision policy.
 * Spec §16.3, §16.4, §16.12, §16.13
 */

export { computeDerivedCalibrated } from './derived-calibrated.js';

export {
  computePredictedResult,
  computePredictedResultFromCurrentPolicy,
} from './decision-policy.js';

export type { PredictedResultOutput } from './decision-policy.js';

export { computePreMatchTeamState } from './team-state-replay.js';
export type {
  FinishedMatchRecord,
  TeamHistoricalState,
  PreMatchTeamState,
} from './team-state-replay.js';

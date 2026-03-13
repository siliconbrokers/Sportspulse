/**
 * Validation Layer public surface.
 *
 * Exports:
 *   - validateMatch: main entry point (§5.3, §11, §12, §13)
 *   - MatchValidationContext: input contract for the validator
 *   - validateCompetitionProfile: profile-level consistency check (§8.3, §8.4)
 *   - CompetitionProfileValidationResult
 *   - validateHistory: per-team history and prior_rating evaluation (§7.4, §20.1, §20.2)
 *   - HistoryValidationResult, TeamHistoryEval
 */

export { validateMatch } from './match-validator.js';
export type { MatchValidationContext } from './match-validator.js';

export { validateCompetitionProfile } from './competition-profile-validator.js';
export type { CompetitionProfileValidationResult } from './competition-profile-validator.js';

export { validateHistory } from './history-validator.js';
export type { HistoryValidationResult, TeamHistoryEval } from './history-validator.js';

// ── Walk-forward validation (§17) ────────────────────────────────────────────
export { runWalkForward } from './walk-forward.js';
export type { WFPrediction, Outcome, WalkForwardOptions } from './walk-forward.js';
export {
  NAIVE_LOG_LOSS,
  NAIVE_BRIER,
  computeLogLoss,
  computeBrierScore,
  computeAccuracy,
  computeDrawRate,
  computeGoalsComparison,
  computeCalibration,
  computePerClassCalibration,
  computeOutcomeDistribution,
  computeAllMetrics,
} from './metrics.js';
export type {
  DrawRateResult,
  GoalsResult,
  WFCalibrationBucket,
  PerClassCalibrationBuckets,
  OutcomeDistribution,
  MetricBundle,
} from './metrics.js';

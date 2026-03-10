/**
 * @sportpulse/prediction — SportPulse Predictive Engine v1
 *
 * Public surface of the prediction package.
 * Phase 1 exports: domain contracts (types, interfaces, constants).
 * Phase 2a exports: rating pool, elo, bridging, lambda, matrix, aggregator,
 *                   derived raw outputs, scoreline explainer.
 * Phase 2b exports: validation layer.
 * Phase 2c exports: calibration, derived calibrated outputs, decision policy, metrics.
 */

// ── Contracts (Phase 1) ────────────────────────────────────────────────────
export * from './contracts/index.js';

// ── Rating Pool (Phase 2a — §10.1) ────────────────────────────────────────
export {
  DEFAULT_ELO_RATING,
  createClubRatingPool,
  createNationalTeamRatingPool,
} from './store/rating-pool.js';
export type { TeamRatingRecord, TeamRatingSnapshot, RatingPool } from './store/rating-pool.js';

// ── Elo Rating Engine (Phase 2a — §6.1, §20) ──────────────────────────────
export {
  K_FACTOR_BASE,
  K_FACTOR_CUP_MULTIPLIER,
  K_FACTOR_INTERNATIONAL_MULTIPLIER,
  HOME_ADVANTAGE_ELO_DELTA,
  ELO_SCALE,
  computeKFactor,
  computeExpectedScore,
  updateEloRating,
  getEffectiveElo,
} from './engine/elo-rating.js';
export type {
  CompetitionWeightCategory,
  EloUpdateParams,
  EloUpdateResult,
  EffectiveEloResult,
} from './engine/elo-rating.js';

// ── Bridging (Phase 2a — §10.2, §10.3) ────────────────────────────────────
export {
  applyLeagueStrengthBridging,
  isBridgingApplicable,
  applyNationalTeamBridging,
} from './engine/bridging.js';
export type {
  BridgingResult,
  BridgingResultSuccess,
  BridgingResultDegraded,
} from './engine/bridging.js';

// ── Lambda Computer (Phase 2a — §14.1, §6.1) ──────────────────────────────
export { BASE_GOALS_PER_TEAM, ELO_LAMBDA_SCALE, computeLambdas } from './engine/lambda-computer.js';
export type {
  FormAdjustments,
  LambdaComputeParams,
  LambdaResult,
} from './engine/lambda-computer.js';

// ── Scoreline Matrix (Phase 2a — §14.2) ───────────────────────────────────
export {
  poissonPmf,
  buildRawMatchDistribution,
  renormalizeDistribution,
  getScorelineProbability,
  validateDistributionCells,
} from './engine/scoreline-matrix.js';
export type { RawMatchDistributionResult } from './engine/scoreline-matrix.js';

// ── Raw 1X2 Aggregator (Phase 2a — §16.1) ─────────────────────────────────
export { aggregateRaw1x2, buildRaw1x2Probs } from './engine/raw-aggregator.js';
export type { Raw1x2AggregationResult } from './engine/raw-aggregator.js';

// ── Derived Raw Outputs (Phase 2a — §16.5–§16.11) ────────────────────────
export {
  computeDerivedRaw,
  verifyBttsInvariant,
  verifyOverUnderInvariant,
} from './engine/derived-raw.js';

// ── Scoreline Explainer (Phase 2a — §15.3, §16.11) ───────────────────────
export {
  getMostLikelyScoreline,
  getTopScorelines,
  computeTop5ScorelineCoverage,
} from './engine/scoreline-explainer.js';
export type { MostLikelyScorelineResult } from './engine/scoreline-explainer.js';

// ── Validation Layer (Phase 2b — §5.3, §11, §12, §13) ────────────────────
export * from './validation/index.js';

// ── Calibration (Phase 2c — §17) ──────────────────────────────────────────
export * from './calibration/index.js';

// ── Engine: derived calibrated outputs (Phase 2c — §16.3, §16.4) ─────────
export { computeDerivedCalibrated } from './engine/derived-calibrated.js';

// ── Engine: decision policy (Phase 2c — §16.12, §16.13, §17.4) ───────────
export {
  computePredictedResult,
  computePredictedResultFromCurrentPolicy,
} from './engine/decision-policy.js';
export type { PredictedResultOutput } from './engine/decision-policy.js';

// ── Metrics (Phase 2c — §23, §24) ─────────────────────────────────────────
export * from './metrics/index.js';

// ── Competition Engine (Phase 3 — §5.2, §7.7, §8.2-§8.4, §18) ───────────
export * from './competition/index.js';

// ── Historical Team State Replay (H2) ─────────────────────────────────────
export { computePreMatchTeamState } from './engine/team-state-replay.js';
export type {
  FinishedMatchRecord,
  TeamHistoricalState,
  PreMatchTeamState,
} from './engine/team-state-replay.js';

// ── Response Builder (Phase 4 — §21) ──────────────────────────────────────
export { buildPredictionResponse } from './response-builder.js';
export type {
  BuildPredictionResponseParams,
  RawEngineOutputs,
  CalibratedOutputs,
} from './response-builder.js';

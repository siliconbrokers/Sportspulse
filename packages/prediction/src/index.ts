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

// ── Motor Predictivo V3 (Unificado) ────────────────────────────────────────
// Solo exports únicos de V3 — constantes y tipos con mismo nombre que V2 se omiten
// para evitar ambigüedad. Acceder a V3 internals via import directo a packages/prediction/src/engine/v3/.
export { runV3Engine } from './engine/v3/index.js';
export type {
  V3MatchRecord,
  V3EngineInput,
  V3PredictionOutput,
  V3Explanation,
  TeamTDStats,
  ShrunkStats,
  PriorResult,
  MatchSignalRA,
  RecencyDeltas,
  V3Warning,
  PoissonMatrixResult,
  // T3 data source types — re-exported for server/ consumers
  XgRecord,
  InjuryRecord,
  ConfirmedLineupRecord,
  AbsenceType,
  PlayerPosition,
  // §Cal Phase 5 calibration types
  CalibrationPoint,
  CalibrationTable,
  // §SP-V4-10 market blend
  MarketOddsRecord,
  // §SP-V4-20/21/23: Logistic + Ensemble types for shadow runner
  LogisticCoefficients,
  EnsembleWeights,
} from './engine/v3/index.js';

// ── Response Builder (Phase 4 — §21) ──────────────────────────────────────
export { buildPredictionResponse } from './response-builder.js';
export type {
  BuildPredictionResponseParams,
  RawEngineOutputs,
  CalibratedOutputs,
} from './response-builder.js';

// ── NEXUS (PE v2) — Track 1+2 pipeline ───────────────────────────────────
// Exported for shadow runner (server/prediction/nexus-shadow-runner.ts).
// taxonomy spec S4: Track 2 converts Track 1 strengths to Poisson distribution.
export { computeTrack1 } from './nexus/track1/track1-engine.js';
export type { HistoricalMatch, Track1Output } from './nexus/track1/types.js';
export {
  computeTrack2,
  computeTrack2FromInput,
} from './nexus/track2/track2-engine.js';
export type { Track2Input, Track2Output } from './nexus/track2/types.js';

// ── NEXUS (PE v2) — Track 3 Tabular Discriminative ────────────────────────
// Exported for shadow runner (server/prediction/nexus-shadow-runner.ts).
// taxonomy spec S5: logistic regression context model.
export { computeTrack3 } from './nexus/track3/track3-engine.js';
export type { LogisticWeights } from './nexus/track3/logistic-model.js';
export type { Track3Output } from './nexus/track3/types.js';

// ── NEXUS (PE v2) — Meta-Ensemble and Scorecard Infrastructure ─────────────
// Exports the NEXUS ensemble orchestrator + scorecard types for server/ consumers.
// Shadow runner (server/prediction/nexus-shadow-runner.ts) imports from here.
export {
  runNexusEnsemble,
  buildBootstrapCalibrationTable,
} from './nexus/ensemble/index.js';
export type {
  WeightRegistry,
  NexusEnsembleOutput,
  Track12Output,
  Track3EnsembleInput,
  Track4EnsembleInput,
  PredictionHorizon,
  NexusCalibrationTable,
} from './nexus/ensemble/index.js';
export type { DataQualityTier } from './nexus/feature-store/index.js';

// ── NEXUS startup-init exports (FINDING-008: replaces direct relative imports) ─
// Allows server/prediction/nexus-startup-init.ts to import via @sportpulse/prediction
// instead of bypassing the workspace boundary with relative paths.
export { buildTrack3FeatureVector } from './nexus/track3/context-features.js';
export { MISSING } from './nexus/feature-store/index.js';
export type { FeatureValue } from './nexus/feature-store/index.js';
export { appendOddsRecord } from './nexus/odds/raw-odds-store.js';
export type { OddsRecord, OddsProvider } from './nexus/odds/types.js';

// NEXUS Scorecards — Phase 4 evaluation infrastructure
export {
  appendScorecardEntry,
  loadScorecard,
  computeRps as computeNexusRps,
  buildCombinedScorecard,
} from './nexus/scorecards/index.js';
export type {
  ScorecardType,
  ScorecardEntry,
  NexusScorecard,
} from './nexus/scorecards/index.js';

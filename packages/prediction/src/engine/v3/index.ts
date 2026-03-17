/**
 * index.ts — Motor Predictivo V3: exports públicos.
 *
 * Exporta el motor, todos los tipos y todas las constantes.
 * NO modifica packages/prediction/src/index.ts — eso es Fase 2.
 */

// Motor principal
export { runV3Engine } from './v3-engine.js';

// Tipos
export type {
  V3MatchRecord,
  V3EngineInput,
  V3PredictionOutput,
  V3Explanation,
  LeagueBaselines,
  TeamTDStats,
  ShrunkStats,
  PriorQuality,
  PriorResult,
  MatchSignalRA,
  RecencyDeltas,
  EligibilityStatus,
  ConfidenceLevel,
  V3Warning,
  PoissonMatrixResult,
  OverUnderMarkets,
  BTTSMarket,
  DoubleChanceMarkets,
  DNBMarkets,
  AsianHandicapMarkets,
  ExpectedGoalsMarkets,
  TopScoreline,
  MarketsOutput,
  GoalFormStats,
  // T3 types
  XgRecord,
  AbsenceType,
  PlayerPosition,
  InjuryRecord,
  LineupPlayer,
  ConfirmedLineupRecord,
  MarketOddsRecord,
  // §Cal Phase 5
  CalibrationPoint,
  CalibrationTable,
} from './types.js';

// Constantes
export {
  DECAY_XI,
  MIN_GAMES_VENUE,
  MIN_GAMES_FOR_BASELINE,
  MIN_GAMES_FOR_RECENCY,
  K_SHRINK,
  PRIOR_EQUIV_GAMES,
  HOME_ADVANTAGE_MULT,
  HOME_GOALS_FALLBACK,
  AWAY_GOALS_FALLBACK,
  DC_RHO,
  DC_RHO_PER_LEAGUE,
  N_RECENT,
  BETA_ATTACK,
  BETA_DEFENSE,
  BETA_RECENT,
  LAMBDA_MIN,
  LAMBDA_MAX,
  MAX_GOALS,
  MAX_TAIL_MASS,
  THRESHOLD_NOT_ELIGIBLE,
  THRESHOLD_ELIGIBLE,
  TOO_CLOSE_THRESHOLD,
  MS_PER_DAY,
  PREV_SEASON_MIN_GAMES,
  PARTIAL_MIN_GAMES,
  RA_MIN_RIVAL_GAMES,
  RECENCY_DELTA_MIN,
  RECENCY_DELTA_MAX,
  // T3 constants
  XG_PARTIAL_COVERAGE_THRESHOLD,
  ABSENCE_IMPACT_FACTOR,
  ABSENCE_MULT_MIN,
  LINEUP_MISSING_STARTER_IMPORTANCE,
  DOUBTFUL_WEIGHT,
  MARKET_WEIGHT,
  MARKET_WEIGHT_MAX,
  MARKET_ODDS_SUM_TOLERANCE,
} from './constants.js';

// Sub-módulos (para tests unitarios y acceso directo)
export { computeLeagueBaselines } from './league-baseline.js';
export { computeTeamStatsTD, resolveTeamStats } from './team-stats.js';
export { applyShrinkage } from './shrinkage.js';
export { buildPrior, mixWithPrior } from './prior.js';
export { computeMatchSignalsRA } from './rival-adjustment.js';
export { computeRecencyDeltas } from './recency.js';
export { computeV3Lambdas } from './lambda.js';
export type { V3LambdaInputs, V3LambdaResult } from './lambda.js';
export { dcTau } from './dixon-coles.js';
export { estimateDcRho } from './dc-rho-estimator.js';
export { computePoissonMatrix } from './poisson-matrix.js';
export { computeEligibility } from './eligibility.js';
export { computeConfidence } from './confidence.js';
export { computePredictedResult } from './predicted-result.js';
export type { PredictedResultOutput } from './predicted-result.js';
export { renderProbText } from './pre-match-text.js';
export {
  computeOverUnder,
  computeBtts,
  computeDoubleChance,
  computeDnb,
  computeAsianHandicap,
  computeExpectedGoals,
  computeTopScorelines,
  computeMarkets,
} from './markets.js';
export { daysToLastMatch, restMultiplier, REST_MULT_SEVERE, REST_MULT_MILD, REST_MULT_OPTIMAL } from './rest-adjustment.js';
export { computeH2HAdjustment, H2H_MIN_MATCHES, H2H_SHRINK, H2H_MULT_MIN, H2H_MULT_MAX } from './h2h-adjustment.js';
export type { H2HAdjustmentResult } from './h2h-adjustment.js';
export { computeGoalForm, GOAL_FORM_WINDOW } from './goal-form.js';
// T3 modules
export { augmentMatchesWithXg, computeXgCoverage } from './xg-augment.js';
export type { AbsenceMultiplierResult } from './absence-adjustment.js';
export { computeAbsenceMultiplier } from './absence-adjustment.js';
export type { MarketBlendResult } from './market-blend.js';
export { blendWithMarketOdds } from './market-blend.js';
// SP-V4-20/21/23: Logistic model + Ensemble
export {
  extractLogisticFeatures,
  predictLogistic,
  DEFAULT_LOGISTIC_COEFFICIENTS,
  LOGISTIC_FEATURE_KEYS,
} from './logistic-model.js';
export type {
  LogisticFeatureVector,
  LogisticCoefficients,
} from './logistic-model.js';
export { combineEnsemble } from './ensemble.js';
export type {
  Prob1X2,
  EnsembleInput,
  EnsembleWeights,
  EnsembleResult,
} from './ensemble.js';
// SP-V4-23: Ensemble feature flag + default weights (from constants)
export { ENSEMBLE_ENABLED, ENSEMBLE_WEIGHTS_DEFAULT } from './constants.js';

/**
 * Motor Predictivo V2 — superficie pública del módulo.
 *
 * Exporta tipos y la función principal del motor.
 * V1 (elo-rating, team-state-replay, lambda-computer) permanece intacto.
 */

export { runV2Engine } from './v2-engine.js';

export type {
  V2MatchRecord,
  TeamStats,
  ObservedRates,
  LeagueBaselines,
  TeamPrior,
  MatchSignal,
  RecentFormDeltas,
  V2EligibilityStatus,
  V2ConfidenceLevel,
  SampleSizeEffect,
  PriorQuality,
  PriorSource,
  V2PredictionOutput,
  V2EngineInput,
} from './types.js';

// Constantes útiles para tests y validación externa
export { ALPHA_PREV, D_PROMOTED } from './prior-builder.js';
export { K_TOTAL, K_HOME, K_AWAY } from './shrinkage.js';
export { K_FORM } from './recency.js';
export {
  BETA_ATTACK,
  BETA_DEFENSE,
  BETA_RECENT_ATTACK,
  BETA_RECENT_DEFENSE,
  LAMBDA_MIN,
  LAMBDA_MAX,
} from './lambda-v2.js';
export { THRESHOLD_NOT_ELIGIBLE, THRESHOLD_ELIGIBLE } from './eligibility-v2.js';

// Sub-funciones exportadas para tests unitarios
export { computeTeamStats, computeObservedRates, computeLeagueBaselines } from './stats-builder.js';
export { buildTeamPrior } from './prior-builder.js';
export { computeShrinkageWeights, computeEffectiveRates } from './shrinkage.js';
export { getRivalBaseline, computeMatchSignals } from './rival-adjustment.js';
export { computeRecentFormDeltas } from './recency.js';
export { computeV2Lambdas } from './lambda-v2.js';
export { computeV2Eligibility } from './eligibility-v2.js';
export { computeV2Confidence } from './confidence-v2.js';
export { computePoissonProbs } from './poisson-v2.js';

/**
 * nexus/promotion — NEXUS Promotion Gate Barrel
 *
 * Spec authority: evaluation-and-promotion spec S6–S8.
 *
 * Exports:
 *   - types: GateResult, GateEvaluationInput, SwapState, SwapAction,
 *            DemotionCheckResult, VolumeRequirements, PerformanceRequirements,
 *            GateConditionId, ActiveModel, SwapActionType, GateEvidence,
 *            LeagueSummary, MatchdaySummary
 *   - gate-evaluator: evaluatePromotionGate
 *   - demotion-trigger: checkDemotionTrigger, evaluateDemotionSequence
 *   - swap-controller: activate_nexus, demotion_check, deprecate_v3, applySwapAction
 *
 * @module nexus/promotion
 */

export type {
  VolumeRequirements,
  PerformanceRequirements,
  GateEvaluationInput,
  LeagueSummary,
  MatchdaySummary,
  GateResult,
  GateEvidence,
  GateConditionId,
  DemotionCheckResult,
  ActiveModel,
  SwapState,
  SwapAction,
  SwapActionType,
} from './types.js';

export {
  DEFAULT_VOLUME_REQUIREMENTS,
  DEFAULT_PERFORMANCE_REQUIREMENTS,
  GATE_CONDITION,
  DEMOTION_RPS_THRESHOLD,
  DEMOTION_CONSECUTIVE_MATCHES_REQUIRED,
  OBSERVATION_PERIOD_DAYS,
  NEXUS_PROMOTED_ENV_VAR,
} from './types.js';

export { evaluatePromotionGate } from './gate-evaluator.js';

export type { MatchRpsResult } from './demotion-trigger.js';
export { checkDemotionTrigger, evaluateDemotionSequence } from './demotion-trigger.js';

export { activate_nexus, demotion_check, deprecate_v3, applySwapAction } from './swap-controller.js';

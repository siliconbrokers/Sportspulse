/**
 * swap-controller.ts — NEXUS Swap Controller.
 *
 * Spec authority:
 *   - evaluation-and-promotion spec S7: Promotion Process
 *   - evaluation-and-promotion spec S8: Demotion Process
 *   - evaluation-and-promotion spec S12.4: V3 preservation during observation
 *
 * This module is EVALUATIVE, not imperative. It returns recommended
 * SwapAction values — it never modifies production state directly.
 *
 * "The swap-controller does not execute changes in production directly —
 * it returns recommended actions that the operator confirms."
 *
 * Three operations:
 *
 * 1. activate_nexus(gateResult, now) → SwapAction
 *    If gate passed → ACTIVATE_NEXUS
 *    If gate failed → BLOCKED (with reason listing failed conditions)
 *
 * 2. demotion_check(currentState, demotionResult, now) → SwapAction
 *    If demotion triggered → DEMOTE_NEXUS
 *    If not triggered → NO_ACTION
 *
 * 3. deprecate_v3(currentState, now) → SwapAction
 *    If >= OBSERVATION_PERIOD_DAYS since promotion AND no demotion → DEPRECATE_V3
 *    If < OBSERVATION_PERIOD_DAYS → BLOCKED (pre-observation period)
 *    If demotion fired → BLOCKED (V3 should be active, not deprecated)
 *
 * PURE FUNCTIONS — no IO, no Date.now(), no mutation.
 *
 * @module nexus/promotion/swap-controller
 */

import type {
  SwapAction,
  SwapState,
  GateResult,
  DemotionCheckResult,
} from './types.js';
import { OBSERVATION_PERIOD_DAYS } from './types.js';

// ── Day conversion helper ─────────────────────────────────────────────────────

/**
 * Compute elapsed days between two ISO 8601 UTC timestamps.
 * Returns a non-negative number.
 */
function elapsedDays(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.max(0, (to - from) / (1000 * 60 * 60 * 24));
}

// ── activate_nexus ────────────────────────────────────────────────────────────

/**
 * Recommend the ACTIVATE_NEXUS action if the promotion gate passed.
 *
 * evaluation-and-promotion spec S7.1 Step 5:
 *   "If the decision is to promote: Set NEXUS_PROMOTED=true in the production
 *    environment."
 *
 * This function does NOT set NEXUS_PROMOTED. It returns the recommended action.
 * The operator confirms and executes.
 *
 * PURE FUNCTION — no IO, no side effects.
 *
 * @param gateResult Result of evaluatePromotionGate.
 * @param now        ISO 8601 UTC timestamp for recommendedAt.
 * @returns          SwapAction: ACTIVATE_NEXUS if gate passed, BLOCKED otherwise.
 */
export function activate_nexus(gateResult: GateResult, now: string): SwapAction {
  if (gateResult.passed) {
    return {
      action: 'ACTIVATE_NEXUS',
      reason: 'All promotion gate conditions passed. Recommend activating NEXUS in production and starting 30-day observation period with V3 in shadow.',
      recommendedAt: now,
    };
  }

  const failedList = gateResult.failedConditions.join(', ');
  return {
    action: 'BLOCKED',
    reason: `Promotion gate not passed. Failed conditions: [${failedList}]. All conditions must be satisfied simultaneously (spec S6.1). No override, no majority vote.`,
    recommendedAt: now,
  };
}

// ── demotion_check ────────────────────────────────────────────────────────────

/**
 * Recommend DEMOTE_NEXUS if the demotion trigger fired.
 *
 * evaluation-and-promotion spec S8.2:
 *   "NEXUS is demoted if: RPS_NEXUS > RPS_V3 + 0.005 sustained for >= 10
 *    consecutive matches evaluated."
 *
 * evaluation-and-promotion spec S8.3 Step 2:
 *   "Immediate swap. V3 resumes serving production predictions. No grace period."
 *
 * This function does NOT modify production state. It returns the recommendation.
 *
 * PURE FUNCTION — no IO, no side effects.
 *
 * @param currentState   Current swap state.
 * @param demotionResult Result of evaluateDemotionSequence or checkDemotionTrigger.
 * @param now            ISO 8601 UTC timestamp for recommendedAt.
 * @returns              SwapAction: DEMOTE_NEXUS if triggered, NO_ACTION otherwise.
 */
export function demotion_check(
  currentState: SwapState,
  demotionResult: DemotionCheckResult,
  now: string,
): SwapAction {
  if (demotionResult.demotionSignal) {
    const consecutiveInfo =
      demotionResult.consecutiveMatches !== undefined
        ? ` (${demotionResult.consecutiveMatches} consecutive matches)`
        : '';
    return {
      action: 'DEMOTE_NEXUS',
      reason:
        `Demotion trigger fired${consecutiveInfo}. ` +
        `NEXUS RPS exceeded V3 RPS by ${demotionResult.rpsDelta.toFixed(4)} ` +
        `(threshold: ${demotionResult.threshold}). ` +
        `Recommend immediate swap: V3 resumes production, NEXUS moves to shadow. ` +
        `No grace period per spec S8.3.`,
      recommendedAt: now,
    };
  }

  // No demotion needed
  const isActive = currentState.activeModel === 'nexus';
  return {
    action: 'NO_ACTION',
    reason: isActive
      ? `No demotion trigger detected. NEXUS continues serving production.`
      : `No demotion trigger detected. Current active model: ${currentState.activeModel}.`,
    recommendedAt: now,
  };
}

// ── deprecate_v3 ──────────────────────────────────────────────────────────────

/**
 * Recommend DEPRECATE_V3 after the observation period completes without demotion.
 *
 * evaluation-and-promotion spec S7.2 + S8.4:
 *   "V3 may be deprecated only after the observation period completes without a
 *    demotion trigger. 'Deprecation' means V3's shadow runner is deactivated
 *    and its code is archived."
 *
 * "DEPRECATED" means V3's shadow runner is deactivated. V3 code and calibration
 * tables are preserved indefinitely (spec S8.4).
 *
 * Blocking conditions:
 *   - NEXUS not yet promoted (nexusPromotedAt = null)
 *   - < OBSERVATION_PERIOD_DAYS elapsed since promotion
 *   - Demotion fired (V3 should be active, not deprecated)
 *   - V3 already deprecated
 *
 * PURE FUNCTION — no IO, no side effects.
 *
 * @param currentState   Current swap state.
 * @param now            ISO 8601 UTC timestamp (used to compute elapsed days).
 * @returns              SwapAction: DEPRECATE_V3 if allowed, BLOCKED otherwise.
 */
export function deprecate_v3(currentState: SwapState, now: string): SwapAction {
  // Guard: NEXUS must be promoted
  if (currentState.nexusPromotedAt === null) {
    return {
      action: 'BLOCKED',
      reason: 'NEXUS has not been promoted yet. Deprecation of V3 is only possible after NEXUS promotion.',
      recommendedAt: now,
    };
  }

  // Guard: V3 already deprecated
  if (currentState.v3DeprecatedAt !== null) {
    return {
      action: 'BLOCKED',
      reason: `V3 was already deprecated at ${currentState.v3DeprecatedAt}. No action needed.`,
      recommendedAt: now,
    };
  }

  // Guard: demotion fired → V3 must remain active
  if (currentState.demotionFired) {
    return {
      action: 'BLOCKED',
      reason: 'Demotion was triggered during the observation period. V3 must remain active (and is currently the production model). Deprecation is not allowed.',
      recommendedAt: now,
    };
  }

  // Guard: observation period must be complete
  const elapsed = elapsedDays(currentState.nexusPromotedAt, now);
  if (elapsed < OBSERVATION_PERIOD_DAYS) {
    const remaining = OBSERVATION_PERIOD_DAYS - elapsed;
    return {
      action: 'BLOCKED',
      reason:
        `Observation period not complete. ` +
        `Elapsed: ${elapsed.toFixed(1)} days. ` +
        `Required: ${OBSERVATION_PERIOD_DAYS} days. ` +
        `Remaining: ${remaining.toFixed(1)} days. ` +
        `V3 must remain operational until observation completes (spec S7.2, S8.4).`,
      recommendedAt: now,
    };
  }

  // All conditions met — recommend deprecation
  return {
    action: 'DEPRECATE_V3',
    reason:
      `Observation period complete (${elapsed.toFixed(1)} days elapsed, required: ${OBSERVATION_PERIOD_DAYS}). ` +
      `No demotion trigger fired. ` +
      `Recommend deactivating V3 shadow runner. ` +
      `V3 code, tests, and calibration tables must be preserved (spec S8.4).`,
    recommendedAt: now,
  };
}

// ── applySwapAction (state transition helper) ─────────────────────────────────

/**
 * Compute the next SwapState given the current state and a confirmed action.
 *
 * This function models the STATE TRANSITION that occurs after the operator
 * confirms a SwapAction. It is pure and does not perform any IO.
 *
 * Only ACTIVATE_NEXUS, DEMOTE_NEXUS, and DEPRECATE_V3 modify state.
 * NO_ACTION and BLOCKED return the state unchanged.
 *
 * @param current  Current swap state.
 * @param action   The SwapAction that was confirmed by the operator.
 * @param now      ISO 8601 UTC timestamp for state timestamps.
 * @returns        New SwapState (immutable copy — does not mutate input).
 */
export function applySwapAction(current: SwapState, action: SwapAction, now: string): SwapState {
  switch (action.action) {
    case 'ACTIVATE_NEXUS':
      return {
        ...current,
        activeModel: 'nexus',
        v3InShadow: true,
        nexusPromotedAt: current.nexusPromotedAt ?? now,
        demotionFired: false,
      };

    case 'DEMOTE_NEXUS':
      return {
        ...current,
        activeModel: 'v3',
        v3InShadow: false,
        demotionFired: true,
      };

    case 'DEPRECATE_V3':
      return {
        ...current,
        v3InShadow: false,
        v3DeprecatedAt: now,
      };

    case 'NO_ACTION':
    case 'BLOCKED':
    default:
      return { ...current };
  }
}

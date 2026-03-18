/**
 * demotion-trigger.ts — NEXUS Demotion Trigger Detection.
 *
 * Spec authority:
 *   - evaluation-and-promotion spec S8.2: Demotion Trigger
 *   - evaluation-and-promotion spec S8.3: Demotion Procedure
 *
 * The demotion trigger fires when:
 *   RPS_NEXUS > RPS_V3 + 0.005 sustained for >= 10 consecutive matches.
 *
 * This module contains two pure functions:
 *
 * 1. checkDemotionTrigger(nexusRps, v3Rps) — point-in-time check:
 *    "Given these two RPS values, does the trigger condition hold for this
 *    data point?" Returns true if nexusRps > v3Rps + threshold.
 *    Used for single-match checks during the observation period.
 *
 * 2. evaluateDemotionSequence(matchResults) — sequence check:
 *    "Given a sequence of per-match results, has the trigger fired?"
 *    Returns DemotionCheckResult with demotionSignal = true if >= 10
 *    consecutive matches satisfy the trigger condition.
 *
 * Both functions are PURE: no IO, no Date.now(), no mutation.
 *
 * NOTE ON PROMPT VS SPEC:
 * The implementation prompt described a different demotion rule:
 *   "RPS_live > RPS_hwf + 0.015 → overfitting signal"
 * The spec S8.2 defines:
 *   "RPS_NEXUS > RPS_V3 + 0.005 sustained for >= 10 consecutive matches"
 * THE SPEC GOVERNS. The prompt's rule is NOT implemented.
 *
 * @module nexus/promotion/demotion-trigger
 */

import type { DemotionCheckResult } from './types.js';
import { DEMOTION_RPS_THRESHOLD, DEMOTION_CONSECUTIVE_MATCHES_REQUIRED } from './types.js';

// ── Per-match result for sequence evaluation ──────────────────────────────────

/**
 * A single per-match RPS comparison result.
 * Used as input to evaluateDemotionSequence.
 */
export interface MatchRpsResult {
  /** NEXUS RPS for this match. Lower is better. */
  nexusRps: number;
  /** V3 RPS for the same match. Lower is better. */
  v3Rps: number;
}

// ── Point-in-time check ───────────────────────────────────────────────────────

/**
 * Check if the demotion trigger condition holds for a single data point.
 *
 * The condition is: nexusRps > v3Rps + threshold.
 * Threshold per spec S8.2: 0.005.
 *
 * This is the atomic unit of the trigger check. The trigger FIRES only when
 * this condition holds for >= 10 CONSECUTIVE matches (evaluateDemotionSequence).
 *
 * PURE FUNCTION — no IO, no side effects.
 *
 * @param nexusRps  NEXUS RPS for the match (or aggregate).
 * @param v3Rps     V3 RPS for the same match (or aggregate).
 * @param threshold Override threshold (default: DEMOTION_RPS_THRESHOLD = 0.005).
 * @returns         True if NEXUS exceeds V3 RPS by more than the threshold.
 */
export function checkDemotionTrigger(
  nexusRps: number,
  v3Rps: number,
  threshold: number = DEMOTION_RPS_THRESHOLD,
): boolean {
  return nexusRps > v3Rps + threshold;
}

// ── Sequence evaluation ───────────────────────────────────────────────────────

/**
 * Evaluate whether the demotion trigger has fired over a sequence of matches.
 *
 * The trigger fires when the per-match condition (checkDemotionTrigger) holds
 * for >= DEMOTION_CONSECUTIVE_MATCHES_REQUIRED (10) consecutive matches.
 *
 * Consecutive matches are evaluated in the order provided. The sequence must
 * represent matches in temporal order (oldest first) to be meaningful.
 *
 * Returns DemotionCheckResult with:
 *   - demotionSignal = true + consecutiveMatches = (length of trigger run) if triggered
 *   - demotionSignal = false if no run of length >= 10 found
 *
 * PURE FUNCTION — no IO, no side effects.
 *
 * @param matches  Ordered sequence of per-match RPS comparisons (oldest first).
 * @param threshold Override threshold (default: DEMOTION_RPS_THRESHOLD = 0.005).
 * @returns        DemotionCheckResult.
 */
export function evaluateDemotionSequence(
  matches: MatchRpsResult[],
  threshold: number = DEMOTION_RPS_THRESHOLD,
): DemotionCheckResult {
  if (matches.length === 0) {
    return {
      demotionSignal: false,
      rpsDelta: 0,
      threshold,
    };
  }

  let maxConsecutive = 0;
  let currentRun = 0;
  let maxRunNexusRps = 0;
  let maxRunV3Rps = 0;

  // Track the aggregate RPS of the triggering run for reporting
  let runNexusRpsSum = 0;
  let runV3RpsSum = 0;

  for (const match of matches) {
    if (checkDemotionTrigger(match.nexusRps, match.v3Rps, threshold)) {
      currentRun += 1;
      runNexusRpsSum += match.nexusRps;
      runV3RpsSum += match.v3Rps;

      if (currentRun > maxConsecutive) {
        maxConsecutive = currentRun;
        maxRunNexusRps = runNexusRpsSum / currentRun;
        maxRunV3Rps = runV3RpsSum / currentRun;
      }
    } else {
      // Reset run
      currentRun = 0;
      runNexusRpsSum = 0;
      runV3RpsSum = 0;
    }
  }

  const triggered = maxConsecutive >= DEMOTION_CONSECUTIVE_MATCHES_REQUIRED;

  if (triggered) {
    return {
      demotionSignal: true,
      rpsDelta: maxRunNexusRps - maxRunV3Rps,
      consecutiveMatches: maxConsecutive,
      threshold,
    };
  }

  // Not triggered — report the last match's delta for observability
  const last = matches[matches.length - 1];
  return {
    demotionSignal: false,
    rpsDelta: last.nexusRps - last.v3Rps,
    threshold,
  };
}

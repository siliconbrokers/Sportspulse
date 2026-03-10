/**
 * decision-policy.ts — deterministic predicted_result computation.
 *
 * Spec authority:
 * - §16.12 (Regla de tie-break para predicted_result)
 * - §16.13 (favorite_margin)
 * - §17.4 (Versionado — reconstruction requirements)
 * - §25.4 (Validación de reconstrucción)
 *
 * Invariants:
 * 1. predicted_result is ALWAYS derived from calibrated_1x2_probs — never from raw.
 * 2. predicted_result is fully reconstructable from {calibrated_1x2_probs,
 *    too_close_margin_threshold, decision_policy_version} — no hidden state,
 *    no randomness. §17.4, §25.4
 * 3. TOO_CLOSE when decision_margin < threshold (strict less-than). §16.12
 * 4. favorite_margin is computed on non-rounded calibrated values. §16.13
 *
 * Values for predicted_result: 'HOME' | 'DRAW' | 'AWAY' | 'TOO_CLOSE'. §16.12
 * (Not 'CONFLICT' — the spec uses 'TOO_CLOSE'.)
 */

import type { Calibrated1x2Probs, PredictedResult } from '../contracts/index.js';
import {
  getDecisionPolicyConfig,
  CURRENT_DECISION_POLICY_VERSION,
} from '../calibration/version-metadata.js';

// ── Output types ──────────────────────────────────────────────────────────

/**
 * Output of the decision policy computation.
 *
 * All fields must be persisted to enable deterministic reconstruction per §17.4.
 */
export interface PredictedResultOutput {
  /** Predicted match result. §16.12 */
  readonly predicted_result: PredictedResult;

  /**
   * True when predicted_result = 'TOO_CLOSE'.
   * False for HOME, DRAW, AWAY. §16.12
   */
  readonly predicted_result_conflict: boolean;

  /**
   * top_1_calibrated_prob - top_2_calibrated_prob.
   * Non-negative. Computed on non-rounded values. §16.13
   */
  readonly favorite_margin: number;

  /**
   * The exact threshold used for this prediction.
   * Persisted for reconstruction. §17.4
   */
  readonly too_close_margin_threshold: number;

  /**
   * The decision policy version applied.
   * Together with too_close_margin_threshold, fully determines predicted_result. §17.4
   */
  readonly decision_policy_version: string;
}

// ── Core computation ──────────────────────────────────────────────────────

/**
 * Compute predicted_result from calibrated 1X2 probabilities.
 *
 * Procedure (§16.12):
 * 1. Take calibrated_1x2_probs.
 * 2. Sort p_home, p_draw, p_away descending.
 * 3. top_1 = largest; top_2 = second largest.
 * 4. decision_margin = top_1 - top_2.
 * 5. If decision_margin < too_close_margin_threshold → TOO_CLOSE.
 * 6. Else → argmax(calibrated_1x2_probs).
 *
 * favorite_margin = top_1 - top_2 per §16.13. Always computed on calibrated values.
 *
 * @param probs Calibrated 1X2 probabilities
 * @param too_close_margin_threshold Business indecision threshold
 * @param decision_policy_version Version string for this policy config
 */
export function computePredictedResult(
  probs: Calibrated1x2Probs,
  too_close_margin_threshold: number,
  decision_policy_version: string,
): PredictedResultOutput {
  const p_home = probs.home;
  const p_draw = probs.draw;
  const p_away = probs.away;

  // Sort descending to get top_1 and top_2 (§16.12)
  const sorted = [
    { class: 'HOME' as const, p: p_home },
    { class: 'DRAW' as const, p: p_draw },
    { class: 'AWAY' as const, p: p_away },
  ].sort((a, b) => b.p - a.p);

  const top_1 = sorted[0]!.p;
  const top_2 = sorted[1]!.p;

  // favorite_margin = top_1 - top_2 per §16.13
  const favorite_margin = top_1 - top_2;

  // Decision rule (§16.12): strict less-than
  if (favorite_margin < too_close_margin_threshold) {
    return {
      predicted_result: 'TOO_CLOSE',
      predicted_result_conflict: true,
      favorite_margin,
      too_close_margin_threshold,
      decision_policy_version,
    };
  }

  // argmax(calibrated_1x2_probs) — sorted[0] is the winner
  const predicted_result: PredictedResult = sorted[0]!.class;

  return {
    predicted_result,
    predicted_result_conflict: false,
    favorite_margin,
    too_close_margin_threshold,
    decision_policy_version,
  };
}

/**
 * Compute predicted_result using the current policy version from the registry.
 *
 * This is the standard call for new predictions. Reads threshold from the
 * versioned policy registry — no hardcoded magic numbers here.
 *
 * Spec §17.4: decision_policy_version fully specifies too_close_margin_threshold.
 */
export function computePredictedResultFromCurrentPolicy(
  probs: Calibrated1x2Probs,
  policy_version: string = CURRENT_DECISION_POLICY_VERSION,
): PredictedResultOutput {
  const config = getDecisionPolicyConfig(policy_version);
  return computePredictedResult(probs, config.too_close_margin_threshold, policy_version);
}

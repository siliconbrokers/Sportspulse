/**
 * derived-calibrated.ts — compute 1X2-consistent outputs from calibrated probs.
 *
 * Spec authority:
 * - §16.3 (Doble oportunidad): from calibrated_1x2_probs
 * - §16.4 (Draw No Bet): from calibrated_1x2_probs
 * - §19.3 (Invariantes de derivados 1X2-consistentes)
 * - §19.4 (Invariante DNB)
 * - §19.5 (Outputs visibles que deben salir de calibrated_1x2_probs)
 *
 * Invariants enforced:
 * - home_or_draw = p_home + p_draw (§16.3, §19.3)
 * - draw_or_away = p_draw + p_away (§16.3, §19.3)
 * - home_or_away = p_home + p_away (§16.3, §19.3)
 * - dnb_home + dnb_away = 1.0 exactly when denominator > epsilon (§19.4)
 * - dnb_home = null, dnb_away = null when 1 - p_draw <= epsilon (§16.4, §19.4)
 *
 * NOTE: §16.4 uses denominator = (1 - p_draw), NOT (p_home + p_away).
 * This ensures the invariant dnb_home + dnb_away = 1.0 holds exactly by
 * construction: dnb_home + dnb_away = (p_home + p_away) / (1 - p_draw).
 * Since calibrated probs sum to 1: p_home + p_away = 1 - p_draw, so
 * the sum is (1 - p_draw) / (1 - p_draw) = 1.0 exactly.
 */

import type { Calibrated1x2Probs, DerivedCalibratedOutputs } from '../contracts/index.js';
import { EPSILON_DNB_DENOMINATOR } from '../contracts/constants.js';

/**
 * Compute double-chance and Draw-No-Bet outputs from calibrated 1X2 probs.
 *
 * @param probs Calibrated 1X2 probabilities (must sum to 1 ± epsilon)
 * @returns DerivedCalibratedOutputs with double-chance and DNB fields
 *
 * Spec §16.3, §16.4, §19.3, §19.4
 */
export function computeDerivedCalibrated(probs: Calibrated1x2Probs): DerivedCalibratedOutputs {
  const p_home = probs.home;
  const p_draw = probs.draw;
  const p_away = probs.away;

  // ── Double chance (§16.3) ──────────────────────────────────────────────
  const home_or_draw = p_home + p_draw;
  const draw_or_away = p_draw + p_away;
  const home_or_away = p_home + p_away;

  // ── Draw No Bet (§16.4) ───────────────────────────────────────────────
  // Denominator = (1 - p_draw) per §16.4
  // This is algebraically equivalent to (p_home + p_away) only when probs sum to 1,
  // but the spec formula is explicit: "dnb_home = p_home_win / (1 - p_draw)"
  const dnb_denominator = 1 - p_draw;

  let dnb_home: number | null;
  let dnb_away: number | null;

  if (dnb_denominator > EPSILON_DNB_DENOMINATOR) {
    // §19.4: dnb_home + dnb_away = 1.0 EXACTLY by construction.
    // We compute dnb_home from the spec formula, then dnb_away = 1 - dnb_home.
    // This guarantees exact IEEE 754 sum = 1.0 for all finite inputs,
    // satisfying the hard invariant from §19.4.
    // (Computing both as p/denom independently can yield 0.9999999999999999
    // due to floating-point rounding — the structural approach eliminates this.)
    dnb_home = p_home / dnb_denominator;
    dnb_away = 1 - dnb_home;
  } else {
    // Denominator too close to zero → indeterminate, return null per §16.4, §19.4
    dnb_home = null;
    dnb_away = null;
  }

  return {
    home_or_draw,
    draw_or_away,
    home_or_away,
    dnb_home,
    dnb_away,
  };
}

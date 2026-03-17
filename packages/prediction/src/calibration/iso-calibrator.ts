/**
 * iso-calibrator.ts — Lightweight isotonic calibration interface for PE v3.
 *
 * Provides:
 *   - applyIsoCalibration: apply a CalibrationTable to raw 1X2 probs
 *   - interpolateCalibration: piecewise-linear interpolation
 *   - fitIsotonicRegression: PAVA algorithm → CalibrationPoint[]
 *
 * This module operates directly on the V3 CalibrationTable format
 * (CalibrationPoint[]). It complements the full IsotonicCalibrator
 * class used by the Phase 2c pipeline. There is no overlap in
 * responsibilities: this module is used by tools/gen-calibration.ts
 * and by the v3-engine.ts calibration step.
 *
 * Spec authority: §15.1 (isotonic calibration one-vs-rest), §16.3 (renorm).
 */

import type { CalibrationPoint, CalibrationTable } from '../engine/v3/types.js';

const EPSILON = 1e-12;

// ── Interpolation ────────────────────────────────────────────────────────────

/**
 * Piecewise-linear interpolation between calibration points.
 * Clamps to the first/last fitted value if rawProb is out of range.
 *
 * @param rawProb  Raw probability in [0, 1]
 * @param points   CalibrationPoints sorted by rawProb ascending
 * @returns        Calibrated probability clamped to [0, 1]
 */
export function interpolateCalibration(
  rawProb: number,
  points: CalibrationPoint[],
): number {
  if (points.length === 0) return rawProb;

  // Clamp below
  if (rawProb <= points[0]!.rawProb) {
    return Math.max(0, Math.min(1, points[0]!.calProb));
  }
  // Clamp above
  if (rawProb >= points[points.length - 1]!.rawProb) {
    return Math.max(0, Math.min(1, points[points.length - 1]!.calProb));
  }

  // Binary search for surrounding points
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.rawProb <= rawProb) lo = mid;
    else hi = mid;
  }

  const p0 = points[lo]!;
  const p1 = points[hi]!;
  const dx = p1.rawProb - p0.rawProb;

  if (dx < EPSILON) {
    return Math.max(0, Math.min(1, p0.calProb));
  }

  const t = (rawProb - p0.rawProb) / dx;
  const result = p0.calProb + t * (p1.calProb - p0.calProb);
  return Math.max(0, Math.min(1, result));
}

// ── PAVA ─────────────────────────────────────────────────────────────────────

/**
 * Pool Adjacent Violators Algorithm (PAVA) for isotonic regression.
 *
 * Input: (rawProb, isActual) pairs SORTED by rawProb ascending.
 * Output: CalibrationPoint[] — monotone non-decreasing.
 *
 * Each output point represents a block average: the calProb is the mean
 * of actual outcomes for all samples in that block, and the rawProb is
 * the mean of raw probabilities in that block.
 *
 * @param pairs  Sorted (rawProb, isActual) pairs — isActual ∈ {0, 1}
 * @returns      CalibrationPoint[] for piecewise-linear interpolation
 */
export function fitIsotonicRegression(
  pairs: Array<{ rawProb: number; isActual: number }>,
): CalibrationPoint[] {
  if (pairs.length === 0) return [];

  interface Block {
    sumRawProb: number;
    sumActual: number;
    count: number;
  }

  const blocks: Block[] = pairs.map((p) => ({
    sumRawProb: p.rawProb,
    sumActual: p.isActual,
    count: 1,
  }));

  // Merge adjacent blocks that violate non-decreasing monotonicity
  let i = 0;
  while (i < blocks.length - 1) {
    const curr = blocks[i]!;
    const next = blocks[i + 1]!;
    const avgCurr = curr.sumActual / curr.count;
    const avgNext = next.sumActual / next.count;
    if (avgCurr > avgNext) {
      // Merge curr and next into curr
      curr.sumRawProb += next.sumRawProb;
      curr.sumActual += next.sumActual;
      curr.count += next.count;
      blocks.splice(i + 1, 1);
      // Step back to re-check the merged block with its predecessor
      if (i > 0) i--;
    } else {
      i++;
    }
  }

  // Convert blocks to CalibrationPoint[]
  return blocks.map((b) => ({
    rawProb: b.sumRawProb / b.count,
    calProb: b.sumActual / b.count,
  }));
}

// ── Apply calibration ─────────────────────────────────────────────────────────

/**
 * Apply isotonic calibration (one-vs-rest) to raw 1X2 probabilities.
 *
 * Steps:
 * 1. Apply interpolateCalibration to each class independently.
 * 2. Renormalize so p_home + p_draw + p_away = 1.0. §16.3
 *
 * If the table is empty or degenerate (sum ≤ ε), returns the original
 * values unchanged with calibrated = false.
 *
 * @param p_home  Raw home-win probability
 * @param p_draw  Raw draw probability
 * @param p_away  Raw away-win probability
 * @param table   CalibrationTable (must have non-empty home/draw/away arrays)
 */
export function applyIsoCalibration(
  p_home: number,
  p_draw: number,
  p_away: number,
  table: CalibrationTable,
): { p_home: number; p_draw: number; p_away: number; calibrated: boolean } {
  // Guard: table must have at least one point per class
  if (
    table.home.length === 0 ||
    table.draw.length === 0 ||
    table.away.length === 0
  ) {
    return { p_home, p_draw, p_away, calibrated: false };
  }

  const cal_home = interpolateCalibration(p_home, table.home);
  const cal_draw = interpolateCalibration(p_draw, table.draw);
  const cal_away = interpolateCalibration(p_away, table.away);

  // Renormalize §16.3
  const total = cal_home + cal_draw + cal_away;
  if (total <= EPSILON) {
    // Degenerate case — uniform fallback
    return { p_home: 1 / 3, p_draw: 1 / 3, p_away: 1 / 3, calibrated: true };
  }

  return {
    p_home: cal_home / total,
    p_draw: cal_draw / total,
    p_away: cal_away / total,
    calibrated: true,
  };
}

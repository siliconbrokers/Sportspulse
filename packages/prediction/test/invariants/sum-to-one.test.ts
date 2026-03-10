/**
 * sum-to-one.test.ts — Property tests for probability sum invariants.
 *
 * Spec authority: §19.1 (Invariantes base)
 *
 * Invariants tested:
 * - calibrated_1x2_probs.home + calibrated_1x2_probs.draw + calibrated_1x2_probs.away = 1.0 ± epsilon
 * - raw_1x2_probs sum = 1.0 ± epsilon (after renormalization from raw matrix)
 * - All calibrated probabilities ∈ [0, 1]
 * - All raw probabilities ∈ [0, 1]
 *
 * Test family: CALIBRATED 1X2 and RAW GOAL/SCORELINE — strictly separated.
 * Raw scoreline sum invariants are NOT cross-checked against calibrated 1X2.
 *
 * Property sweep: 20 distinct lambda combinations (deterministic, no Math.random()).
 */

import { describe, it, expect } from 'vitest';
import {
  buildRawMatchDistribution,
  renormalizeDistribution,
  aggregateRaw1x2,
  applyOneVsRestCalibration,
  IsotonicCalibrator,
  EPSILON_PROBABILITY,
} from '../../src/index.js';
import type { OneVsRestCalibrators } from '../../src/calibration/isotonic-calibrator.js';

// ── Deterministic lambda sweep ─────────────────────────────────────────────

/** 20 distinct (lambda_home, lambda_away) pairs for property testing. */
const LAMBDA_PAIRS: [number, number][] = [
  [0.5, 0.5],
  [0.5, 1.0],
  [0.5, 2.0],
  [0.5, 4.0],
  [1.0, 0.5],
  [1.0, 1.0],
  [1.0, 1.5],
  [1.0, 3.0],
  [1.5, 0.5],
  [1.5, 1.5],
  [1.5, 2.5],
  [2.0, 0.5],
  [2.0, 1.0],
  [2.0, 2.0],
  [2.0, 3.5],
  [2.5, 1.0],
  [2.5, 2.5],
  [3.0, 1.0],
  [3.5, 2.0],
  [4.0, 1.5],
];

/** Build an identity calibrator triple (no calibration applied). */
function identityCalibrators(): OneVsRestCalibrators {
  return {
    home: IsotonicCalibrator.createIdentity(),
    draw: IsotonicCalibrator.createIdentity(),
    away: IsotonicCalibrator.createIdentity(),
  };
}

// ── Family: RAW GOAL/SCORELINE ─────────────────────────────────────────────

describe('Sum-to-one invariants — RAW 1X2 family (§19.1)', () => {
  it.each(LAMBDA_PAIRS)(
    'raw_1x2 sum = 1.0 ± epsilon_probability for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // Spec §19.1: raw_1x2_probs.home + raw_1x2_probs.draw + raw_1x2_probs.away ≈ 1.0
      // This holds after renormalization of the raw distribution (§14.2).
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const aggregated = aggregateRaw1x2(normalized, result.matrix_max_goal);

      // §19.1: sum deviates only when using non-renormalized distributions
      const sum = aggregated.probs.home + aggregated.probs.draw + aggregated.probs.away;
      expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
    },
  );

  it.each(LAMBDA_PAIRS)(
    'all raw 1X2 probabilities ∈ [0,1] for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const aggregated = aggregateRaw1x2(normalized, result.matrix_max_goal);

      expect(aggregated.probs.home).toBeGreaterThanOrEqual(0);
      expect(aggregated.probs.home).toBeLessThanOrEqual(1);
      expect(aggregated.probs.draw).toBeGreaterThanOrEqual(0);
      expect(aggregated.probs.draw).toBeLessThanOrEqual(1);
      expect(aggregated.probs.away).toBeGreaterThanOrEqual(0);
      expect(aggregated.probs.away).toBeLessThanOrEqual(1);
    },
  );

  it('tail_mass_raw from raw (non-renormalized) distribution plus matrix sum = 1.0', () => {
    // §14.2: tail_mass_raw = 1 - Σ P(i,j) for i,j ∈ [0..maxGoal]
    // So: matrix_sum + tail_mass_raw ≈ 1.0 always.
    for (const [lambdaHome, lambdaAway] of LAMBDA_PAIRS) {
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const aggregated = aggregateRaw1x2(result.distribution, result.matrix_max_goal);
      const matrixSum = aggregated.sumCheck;
      const reconstructed = matrixSum + result.tail_mass_raw;
      // matrixSum + tail_mass_raw should equal 1.0 ± epsilon
      expect(Math.abs(reconstructed - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
    }
  });
});

// ── Family: CALIBRATED 1X2 ─────────────────────────────────────────────────

describe('Sum-to-one invariants — CALIBRATED 1X2 family (§19.1)', () => {
  it.each(LAMBDA_PAIRS)(
    'calibrated_1x2_probs sum = 1.0 ± epsilon_probability for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // §19.1: abs((p_home_win + p_draw + p_away_win) - 1) <= epsilon_probability
      // After renormalization in applyOneVsRestCalibration, sum = 1.0 exactly.
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const aggregated = aggregateRaw1x2(normalized, result.matrix_max_goal);

      const calibrated = applyOneVsRestCalibration(
        aggregated.probs.home,
        aggregated.probs.draw,
        aggregated.probs.away,
        identityCalibrators(),
      );

      const sum = calibrated.home + calibrated.draw + calibrated.away;
      // §19.1 tolerance: epsilon_probability = 1e-9
      expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
    },
  );

  it.each(LAMBDA_PAIRS)(
    'all calibrated probabilities ∈ [0,1] for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // §19.1: 0 <= p_home_win <= 1, 0 <= p_draw <= 1, 0 <= p_away_win <= 1
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const aggregated = aggregateRaw1x2(normalized, result.matrix_max_goal);

      const calibrated = applyOneVsRestCalibration(
        aggregated.probs.home,
        aggregated.probs.draw,
        aggregated.probs.away,
        identityCalibrators(),
      );

      expect(calibrated.home).toBeGreaterThanOrEqual(0);
      expect(calibrated.home).toBeLessThanOrEqual(1);
      expect(calibrated.draw).toBeGreaterThanOrEqual(0);
      expect(calibrated.draw).toBeLessThanOrEqual(1);
      expect(calibrated.away).toBeGreaterThanOrEqual(0);
      expect(calibrated.away).toBeLessThanOrEqual(1);
    },
  );

  it('calibrated sum invariant uses calibrated values — NOT raw scoreline invariants (§19.7)', () => {
    // §19.7: "Queda prohibido validar mercados de goles usando invariantes algebraicos
    //         propios del vector calibrado 1X2."
    // This test is a sentinel: it asserts the calibrated sum invariant is tested against
    // calibrated outputs only, and that this describe block is strictly isolated from
    // the raw goal/scoreline describe block above.
    //
    // Mechanical verification: compute calibrated probs then assert sum — never assert
    // the over/under totals here.
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const aggregated = aggregateRaw1x2(normalized, result.matrix_max_goal);
    const calibrated = applyOneVsRestCalibration(
      aggregated.probs.home,
      aggregated.probs.draw,
      aggregated.probs.away,
      identityCalibrators(),
    );
    // Only calibrated sum is checked here
    const sum = calibrated.home + calibrated.draw + calibrated.away;
    expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
  });
});

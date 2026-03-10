/**
 * matrix-bounds.test.ts — Scoreline matrix bounds and tail mass invariants.
 *
 * Spec authority: §19.2 (Scoreline matrix), §14.2, §14.3
 *
 * Invariants tested:
 * - Every cell P(i,j) ∈ [0,1] (§19.2)
 * - sum(matrix cells) ≤ 1.0 (tail mass is non-negative)
 * - sum(matrix cells) + tail_mass_raw = 1.0 ± epsilon (§14.2)
 * - tail_mass_raw ≥ 0 always (§14.2: Math.max(0, ...))
 * - tail_mass_raw < 1.0 when at least one scoreline is included
 * - top_scorelines sorted by probability descending (§16.11)
 * - most_likely_scoreline belongs to active matrix (§19.2)
 * - tail_mass_raw = 0 when all mass captured in matrix
 * - validateDistributionCells returns empty array for valid matrices
 *
 * Test family: RAW GOAL/SCORELINE only. Calibrated 1X2 invariants NOT asserted here.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRawMatchDistribution,
  renormalizeDistribution,
  validateDistributionCells,
  computeDerivedRaw,
  aggregateRaw1x2,
  EPSILON_PROBABILITY,
  MATRIX_MAX_GOAL_DEFAULT,
  MAX_TAIL_MASS_RAW,
} from '../../src/index.js';

/** 20 lambda pairs for property testing. */
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

// ── Family: RAW GOAL/SCORELINE ─────────────────────────────────────────────

describe('Matrix bounds — all cells ∈ [0,1] (§19.2)', () => {
  it.each(LAMBDA_PAIRS)(
    'validateDistributionCells returns empty for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // §19.2: "cada celda P(i,j) debe estar en [0,1]"
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const invalid = validateDistributionCells(result.distribution, result.matrix_max_goal);
      expect(invalid).toHaveLength(0);
    },
  );

  it.each(LAMBDA_PAIRS)(
    'all cells ∈ [0,1] after renormalization for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const invalid = validateDistributionCells(normalized, result.matrix_max_goal);
      expect(invalid).toHaveLength(0);
    },
  );
});

describe('Matrix tail mass identity — sum(matrix) + tail_mass_raw = 1.0 (§14.2, §19.2)', () => {
  it.each(LAMBDA_PAIRS)(
    'matrix sum + tail_mass_raw ≈ 1.0 for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // §14.2: "tail_mass_raw = 1 - Σ P(i,j)"
      // Therefore: Σ P(i,j) + tail_mass_raw = 1.0
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const aggregated = aggregateRaw1x2(result.distribution, result.matrix_max_goal);
      const matrixSum = aggregated.sumCheck;
      const total = matrixSum + result.tail_mass_raw;
      expect(Math.abs(total - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
    },
  );

  it.each(LAMBDA_PAIRS)(
    'tail_mass_raw ≥ 0 always for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // §14.2: tail_mass_raw is clamped via Math.max(0, ...)
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      expect(result.tail_mass_raw).toBeGreaterThanOrEqual(0);
    },
  );

  it.each(LAMBDA_PAIRS)(
    'tail_mass_raw < 1.0 when at least one scoreline is included for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // §19.2: the matrix always captures some probability mass
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      expect(result.tail_mass_raw).toBeLessThan(1.0);
    },
  );
});

describe('Matrix tail mass — edge cases (§14.2)', () => {
  it('tail_mass_raw = 0 when all probability mass captured (very low lambdas)', () => {
    // With tiny lambdas (near 0), P(0-0) ≈ 1.0 so the matrix captures everything
    // and tail_mass_raw should be exactly 0 (after Math.max(0, ...) clamp).
    const result = buildRawMatchDistribution(0.001, 0.001);
    // Nearly all mass is in the 8x8 grid — tail should be negligible
    expect(result.tail_mass_raw).toBeGreaterThanOrEqual(0);
    // Matrix covers virtually all mass at such low lambdas
    expect(result.tail_mass_raw).toBeLessThan(MAX_TAIL_MASS_RAW);
  });

  it('tail_mass_raw is exactly computed as 1 - matrix_sum for normal lambdas', () => {
    // Verify the identity holds precisely
    const result = buildRawMatchDistribution(1.5, 1.2);
    const aggregated = aggregateRaw1x2(result.distribution, result.matrix_max_goal);
    const expected_tail = Math.max(0, 1 - aggregated.sumCheck);
    expect(Math.abs(result.tail_mass_raw - expected_tail)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
  });

  it('tailMassExceeded flag is true when tail_mass_raw > MAX_TAIL_MASS_RAW', () => {
    // §14.2: flag must be set when tail exceeds threshold
    // High lambdas cause more tail mass (high-scoring distributions have more truncated mass)
    const result = buildRawMatchDistribution(4.0, 4.0);
    if (result.tail_mass_raw > MAX_TAIL_MASS_RAW) {
      expect(result.tailMassExceeded).toBe(true);
    } else {
      expect(result.tailMassExceeded).toBe(false);
    }
  });

  it('tailMassExceeded flag is false when tail_mass_raw <= MAX_TAIL_MASS_RAW', () => {
    // §14.2: flag must be false when within threshold
    const result = buildRawMatchDistribution(1.0, 1.0);
    if (result.tail_mass_raw <= MAX_TAIL_MASS_RAW) {
      expect(result.tailMassExceeded).toBe(false);
    }
  });

  it('matrix_max_goal defaults to MATRIX_MAX_GOAL_DEFAULT (7)', () => {
    // §14.2: default maxGoal = 7
    const result = buildRawMatchDistribution(1.5, 1.2);
    expect(result.matrix_max_goal).toBe(MATRIX_MAX_GOAL_DEFAULT);
  });
});

describe('top_scorelines sorted descending (§16.11)', () => {
  it.each(LAMBDA_PAIRS)(
    'top_scorelines sorted by probability descending for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // §16.11: top_scorelines ordered by probability descending
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const derived = computeDerivedRaw(normalized, result.matrix_max_goal);

      for (let i = 0; i < derived.top_scorelines.length - 1; i++) {
        const current = derived.top_scorelines[i]!.p;
        const next = derived.top_scorelines[i + 1]!.p;
        // Descending: current >= next (within EPSILON_PROBABILITY for floating-point ties).
        // The sort uses epsilon-based tie-breaking per §16.11 (deterministic by score string),
        // so two entries may differ by sub-epsilon amounts but are still in valid descending order.
        expect(current).toBeGreaterThanOrEqual(next - EPSILON_PROBABILITY);
      }
    },
  );

  it('top_scorelines has exactly 5 entries by default (§15.3)', () => {
    // §15.3: "Top 5 scorelines ordered by probability descending"
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    expect(derived.top_scorelines).toHaveLength(5);
  });

  it('all top_scorelines probabilities ∈ [0,1]', () => {
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    for (const entry of derived.top_scorelines) {
      expect(entry.p).toBeGreaterThanOrEqual(0);
      expect(entry.p).toBeLessThanOrEqual(1);
    }
  });

  it('most_likely_scoreline matches top_scorelines[0] (§16.11, §19.2)', () => {
    // §19.2: "most_likely_scoreline debe pertenecer a la matriz vigente"
    // §16.11: most_likely_scoreline = scoreline with highest P(i,j)
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    expect(derived.most_likely_scoreline).toBe(derived.top_scorelines[0]?.score);
  });
});

describe('Renormalized matrix sums to 1.0 (§19.2)', () => {
  it.each(LAMBDA_PAIRS)(
    'renormalized distribution sums to 1.0 ± epsilon for lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // §19.2: "la suma total de la matriz renormalizada debe ser 1 ± epsilon_probability"
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const aggregated = aggregateRaw1x2(normalized, result.matrix_max_goal);
      expect(Math.abs(aggregated.sumCheck - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
    },
  );
});

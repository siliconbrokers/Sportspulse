/**
 * totals-split.test.ts — Invariant: over_2_5 + under_2_5 = 1 − tail_mass_raw
 *
 * Spec authority: §16.5, §19.3
 *
 * Core invariant tested (raw, non-renormalized distribution):
 *
 *   over_2_5 + under_2_5 = Σ P(i,j) over the matrix = 1 − tail_mass_raw
 *
 * Why this invariant exists:
 *   §16.5 defines over_2_5 = P(i+j >= 3) and under_2_5 = P(i+j <= 2).
 *   Every cell in the matrix falls into exactly one of those two buckets
 *   (since i+j is an integer, and the boundary is exactly 2.5).
 *   Therefore over_2_5 + under_2_5 = Σ all cells = matrixSum = 1 − tail_mass_raw.
 *
 * Test structure:
 *   - Uses buildRawMatchDistribution (real implementation) to produce raw distributions.
 *   - Uses computeDerivedRaw on the RAW (non-renormalized) distribution.
 *   - Verifies over_2_5 + under_2_5 = 1 − tail_mass_raw to within ε = 1e-9.
 *   - Separately verifies over_2_5 + under_2_5 = 1 after renormalization.
 *   - Tests multiple lambda combinations: low, balanced, high, asymmetric.
 *
 * Separation of families (§19.7):
 *   This file tests ONLY the raw goal/scoreline family. No calibrated 1X2
 *   values are used or tested here. Cross-family assertions are forbidden.
 *
 * All tests are pure / deterministic — no external I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRawMatchDistribution,
  renormalizeDistribution,
} from '../../src/engine/scoreline-matrix.js';
import { computeDerivedRaw } from '../../src/engine/derived-raw.js';
import { EPSILON_PROBABILITY } from '../../src/contracts/index.js';

// Tolerance for floating-point comparisons
const ε = EPSILON_PROBABILITY; // 1e-9 per §4.1

// ── Helper ────────────────────────────────────────────────────────────────

/**
 * Build a raw distribution, compute derived raw outputs on it (without
 * renormalizing), and return the distribution result along with derivedRaw.
 * This exposes the raw invariant: over_2_5 + under_2_5 = 1 - tail_mass_raw.
 */
function buildRawAndDerive(lambdaHome: number, lambdaAway: number) {
  const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
  const derivedRaw = computeDerivedRaw(result.distribution, result.matrix_max_goal);
  return { result, derivedRaw };
}

// ── Test suite: raw (non-renormalized) distribution ───────────────────────

describe('Raw totals split invariant — over_2_5 + under_2_5 = 1 − tail_mass_raw (§16.5, §19.3)', () => {
  it('low-scoring game (λ_home=0.7, λ_away=0.6): over+under = 1 − tail_mass_raw', () => {
    // Spec §16.5: totals derived from raw_match_distribution.
    // With low lambdas the matrix captures more mass and tail_mass_raw is smaller.
    const { result, derivedRaw } = buildRawAndDerive(0.7, 0.6);
    const expected = 1 - result.tail_mass_raw;
    const actual = derivedRaw.over_2_5 + derivedRaw.under_2_5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ε);
  });

  it('typical game (λ_home=1.5, λ_away=1.2): over+under = 1 − tail_mass_raw', () => {
    const { result, derivedRaw } = buildRawAndDerive(1.5, 1.2);
    const expected = 1 - result.tail_mass_raw;
    const actual = derivedRaw.over_2_5 + derivedRaw.under_2_5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ε);
  });

  it('balanced game (λ_home=1.0, λ_away=1.0): over+under = 1 − tail_mass_raw', () => {
    const { result, derivedRaw } = buildRawAndDerive(1.0, 1.0);
    const expected = 1 - result.tail_mass_raw;
    const actual = derivedRaw.over_2_5 + derivedRaw.under_2_5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ε);
  });

  it('high-scoring game (λ_home=2.5, λ_away=2.0): over+under = 1 − tail_mass_raw', () => {
    // High lambdas push more mass into the tail → larger tail_mass_raw.
    // The invariant must still hold: over_2_5 + under_2_5 = 1 − tail_mass_raw.
    const { result, derivedRaw } = buildRawAndDerive(2.5, 2.0);
    const expected = 1 - result.tail_mass_raw;
    const actual = derivedRaw.over_2_5 + derivedRaw.under_2_5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ε);
  });

  it('very high-scoring game (λ_home=4.0, λ_away=3.5): over+under = 1 − tail_mass_raw (near threshold)', () => {
    // Near or above MAX_TAIL_MASS_RAW. The invariant is a tautology regardless:
    // every cell lands in exactly one bucket. tail_mass_raw may be > 0.01 here.
    const { result, derivedRaw } = buildRawAndDerive(4.0, 3.5);
    const expected = 1 - result.tail_mass_raw;
    const actual = derivedRaw.over_2_5 + derivedRaw.under_2_5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ε);
  });

  it('asymmetric game (λ_home=3.0, λ_away=0.5): over+under = 1 − tail_mass_raw', () => {
    // Highly asymmetric lambdas. Home side has substantial tail mass;
    // invariant still holds because both buckets exhaust the matrix.
    const { result, derivedRaw } = buildRawAndDerive(3.0, 0.5);
    const expected = 1 - result.tail_mass_raw;
    const actual = derivedRaw.over_2_5 + derivedRaw.under_2_5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ε);
  });

  it('reverse asymmetric game (λ_home=0.5, λ_away=3.0): over+under = 1 − tail_mass_raw', () => {
    const { result, derivedRaw } = buildRawAndDerive(0.5, 3.0);
    const expected = 1 - result.tail_mass_raw;
    const actual = derivedRaw.over_2_5 + derivedRaw.under_2_5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ε);
  });

  it('extreme low game (λ_home=0.2, λ_away=0.2): over+under = 1 − tail_mass_raw', () => {
    // Very low lambdas: nearly all mass in 0-0, 1-0, 0-1. Tiny tail.
    const { result, derivedRaw } = buildRawAndDerive(0.2, 0.2);
    const expected = 1 - result.tail_mass_raw;
    const actual = derivedRaw.over_2_5 + derivedRaw.under_2_5;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(ε);
  });

  it('tail_mass_raw is non-negative for all lambda combinations', () => {
    // §14.2: tail_mass_raw = max(0, 1 - matrixSum) — always >= 0.
    const lambdaPairs: Array<[number, number]> = [
      [0.3, 0.3],
      [1.0, 1.0],
      [1.5, 1.2],
      [2.5, 2.0],
      [4.0, 4.0],
    ];
    for (const [lh, la] of lambdaPairs) {
      const { result } = buildRawAndDerive(lh, la);
      expect(result.tail_mass_raw).toBeGreaterThanOrEqual(0);
    }
  });

  it('over_2_5 and under_2_5 are each in [0, 1] for raw distribution', () => {
    // §19.2: each derived probability must be in [0, 1].
    const { derivedRaw } = buildRawAndDerive(1.5, 1.2);
    expect(derivedRaw.over_2_5).toBeGreaterThanOrEqual(0);
    expect(derivedRaw.over_2_5).toBeLessThanOrEqual(1);
    expect(derivedRaw.under_2_5).toBeGreaterThanOrEqual(0);
    expect(derivedRaw.under_2_5).toBeLessThanOrEqual(1);
  });
});

// ── Test suite: renormalized distribution ─────────────────────────────────

describe('Renormalized totals split invariant — over_2_5 + under_2_5 = 1.0 (§16.5, §19.3)', () => {
  it('typical game renormalized: over+under = 1.0 (within ε)', () => {
    // §19.3: "abs((over_2_5 + under_2_5) - 1) <= epsilon_probability"
    // This invariant holds strictly for renormalized distributions.
    const { result } = buildRawAndDerive(1.5, 1.2);
    const renorm = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derivedRenorm = computeDerivedRaw(renorm, result.matrix_max_goal);
    expect(Math.abs(derivedRenorm.over_2_5 + derivedRenorm.under_2_5 - 1.0)).toBeLessThanOrEqual(ε);
  });

  it('high-scoring game renormalized: over+under = 1.0 (within ε)', () => {
    const { result } = buildRawAndDerive(3.0, 2.5);
    const renorm = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derivedRenorm = computeDerivedRaw(renorm, result.matrix_max_goal);
    expect(Math.abs(derivedRenorm.over_2_5 + derivedRenorm.under_2_5 - 1.0)).toBeLessThanOrEqual(ε);
  });

  it('low-scoring game renormalized: over+under = 1.0 (within ε)', () => {
    const { result } = buildRawAndDerive(0.5, 0.4);
    const renorm = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derivedRenorm = computeDerivedRaw(renorm, result.matrix_max_goal);
    expect(Math.abs(derivedRenorm.over_2_5 + derivedRenorm.under_2_5 - 1.0)).toBeLessThanOrEqual(ε);
  });

  it('renormalized distribution has strictly smaller tail: renorm gives = 1.0 while raw gives < 1.0', () => {
    // This test distinguishes between raw and renormalized behavior explicitly.
    // raw: over + under < 1.0 when tail_mass_raw > 0
    // renorm: over + under = 1.0 exactly
    const { result, derivedRaw } = buildRawAndDerive(2.0, 1.8);
    const renorm = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derivedRenorm = computeDerivedRaw(renorm, result.matrix_max_goal);

    // Raw: equals 1 - tail_mass_raw (strictly < 1 when tail > 0)
    if (result.tail_mass_raw > 0) {
      expect(derivedRaw.over_2_5 + derivedRaw.under_2_5).toBeLessThan(1.0);
    }

    // Renormalized: equals 1.0
    expect(Math.abs(derivedRenorm.over_2_5 + derivedRenorm.under_2_5 - 1.0)).toBeLessThanOrEqual(ε);
  });
});

// ── Family separation guard ────────────────────────────────────────────────

describe('Family separation — raw totals are NOT asserted against calibrated invariants (§19.7)', () => {
  it('does NOT assert over_2_5 + under_2_5 = 1 against a raw distribution (would be wrong)', () => {
    // §19.7: "queda prohibido validar mercados de goles usando invariantes
    //         algebraicos propios del vector calibrado 1X2."
    // This test documents the correct interpretation: for a raw distribution
    // with nonzero tail, the sum is NOT 1 — and that is expected and correct.
    const { result, derivedRaw } = buildRawAndDerive(2.0, 1.8);

    if (result.tail_mass_raw > ε) {
      // The RAW invariant holds: sum = 1 - tail_mass_raw, which is NOT 1.
      const rawSum = derivedRaw.over_2_5 + derivedRaw.under_2_5;
      const expectedRawSum = 1 - result.tail_mass_raw;
      expect(Math.abs(rawSum - expectedRawSum)).toBeLessThanOrEqual(ε);
      // The calibrated-family invariant (sum = 1) would FAIL on raw distribution.
      // We do NOT assert it. The spec explicitly forbids this cross-family check.
    }
  });
});

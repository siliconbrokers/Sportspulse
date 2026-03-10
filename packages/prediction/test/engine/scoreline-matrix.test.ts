/**
 * Scoreline Matrix — Unit Tests
 *
 * Spec authority: §14.2, §19.2, §4.3
 * Invariants tested:
 *   - Matrix is 8×8 (64 cells for maxGoal=7)
 *   - All cells ∈ [0, 1] (§19.2)
 *   - sum(cells) + tail_mass_raw ≈ 1.0
 *   - tail_mass_raw ≥ 0
 *   - tailMassExceeded = (tail_mass_raw > MAX_TAIL_MASS_RAW)
 *   - NO silent renormalization when tail_mass_raw > MAX_TAIL_MASS_RAW
 *   - Determinism: same lambdas → same matrix
 *   - Poisson PMF correctness
 *   - Boundary: lambda → 0, goals = 0
 *   - §15.4: lambda_home and lambda_away persisted in result
 */

import { describe, it, expect } from 'vitest';
import {
  poissonPmf,
  buildRawMatchDistribution,
  renormalizeDistribution,
  validateDistributionCells,
} from '../../src/engine/scoreline-matrix.js';
import {
  MATRIX_MAX_GOAL_DEFAULT,
  MAX_TAIL_MASS_RAW,
  EPSILON_PROBABILITY,
} from '../../src/contracts/index.js';

// ── poissonPmf ────────────────────────────────────────────────────────────

describe('poissonPmf', () => {
  it('P(X=0) = e^(-lambda) for any lambda', () => {
    expect(poissonPmf(1.5, 0)).toBeCloseTo(Math.exp(-1.5), 10);
    expect(poissonPmf(2.7, 0)).toBeCloseTo(Math.exp(-2.7), 10);
  });

  it('returns 0 for negative k', () => {
    expect(poissonPmf(1.5, -1)).toBe(0);
  });

  it('returns 0 for non-integer k', () => {
    expect(poissonPmf(1.5, 1.5)).toBe(0);
  });

  it('sums to approximately 1 over large enough range', () => {
    const lambda = 1.5;
    let sum = 0;
    for (let k = 0; k <= 30; k++) {
      sum += poissonPmf(lambda, k);
    }
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('handles lambda = 0 (degenerate case)', () => {
    expect(poissonPmf(0, 0)).toBe(1);
    expect(poissonPmf(0, 1)).toBe(0);
  });

  it('is deterministic', () => {
    expect(poissonPmf(1.35, 2)).toBe(poissonPmf(1.35, 2));
  });
});

// ── buildRawMatchDistribution ─────────────────────────────────────────────

describe('buildRawMatchDistribution', () => {
  it('produces exactly (maxGoal+1)^2 cells (default = 64)', () => {
    const result = buildRawMatchDistribution(1.35, 1.35);
    const cellCount = Object.keys(result.distribution).length;
    expect(cellCount).toBe((MATRIX_MAX_GOAL_DEFAULT + 1) ** 2);
    expect(cellCount).toBe(64);
  });

  it('all cells are in [0, 1] (§19.2)', () => {
    const result = buildRawMatchDistribution(1.35, 1.35);
    const invalid = validateDistributionCells(result.distribution, MATRIX_MAX_GOAL_DEFAULT);
    expect(invalid).toHaveLength(0);
  });

  it('sum(cells) + tail_mass_raw ≈ 1.0', () => {
    const result = buildRawMatchDistribution(1.35, 1.35);
    const { distribution, tail_mass_raw } = result;

    let matrixSum = 0;
    for (let i = 0; i <= MATRIX_MAX_GOAL_DEFAULT; i++) {
      for (let j = 0; j <= MATRIX_MAX_GOAL_DEFAULT; j++) {
        const key = `${i}-${j}`;
        matrixSum += (distribution as Record<string, number>)[key] ?? 0;
      }
    }
    expect(matrixSum + tail_mass_raw).toBeCloseTo(1.0, 8);
  });

  it('tail_mass_raw is non-negative', () => {
    const result = buildRawMatchDistribution(1.35, 1.35);
    expect(result.tail_mass_raw).toBeGreaterThanOrEqual(0);
  });

  it('tailMassExceeded is true when tail_mass_raw > MAX_TAIL_MASS_RAW', () => {
    // Use very high lambdas to force high tail mass
    const result = buildRawMatchDistribution(10.0, 10.0);
    expect(result.tail_mass_raw).toBeGreaterThan(MAX_TAIL_MASS_RAW);
    expect(result.tailMassExceeded).toBe(true);
  });

  it('tailMassExceeded is false for typical lambdas', () => {
    const result = buildRawMatchDistribution(1.35, 1.35);
    // Typical football lambdas should be within bounds
    expect(result.tailMassExceeded).toBe(false);
  });

  it('persists lambda_home and lambda_away in result (§14.3)', () => {
    const result = buildRawMatchDistribution(1.4, 1.2);
    expect(result.lambda_home).toBe(1.4);
    expect(result.lambda_away).toBe(1.2);
  });

  it('persists matrix_max_goal in result (§14.3)', () => {
    const result = buildRawMatchDistribution(1.35, 1.35);
    expect(result.matrix_max_goal).toBe(MATRIX_MAX_GOAL_DEFAULT);
  });

  it('is deterministic — same lambdas → identical matrix', () => {
    const r1 = buildRawMatchDistribution(1.5, 1.2);
    const r2 = buildRawMatchDistribution(1.5, 1.2);

    for (let i = 0; i <= MATRIX_MAX_GOAL_DEFAULT; i++) {
      for (let j = 0; j <= MATRIX_MAX_GOAL_DEFAULT; j++) {
        const key = `${i}-${j}`;
        const p1 = (r1.distribution as Record<string, number>)[key];
        const p2 = (r2.distribution as Record<string, number>)[key];
        expect(p1).toBe(p2);
      }
    }
    expect(r1.tail_mass_raw).toBe(r2.tail_mass_raw);
  });

  it('respects custom maxGoal', () => {
    const result = buildRawMatchDistribution(1.35, 1.35, 5);
    const cellCount = Object.keys(result.distribution).length;
    expect(cellCount).toBe(36); // (5+1)^2
    expect(result.matrix_max_goal).toBe(5);
  });

  it('does NOT silently renormalize when tail_mass_raw > MAX_TAIL_MASS_RAW', () => {
    // High lambdas → high tail mass
    const result = buildRawMatchDistribution(8.0, 8.0);
    expect(result.tailMassExceeded).toBe(true);

    // The raw distribution should NOT sum to 1 — tail mass is omitted
    let matrixSum = 0;
    for (let i = 0; i <= MATRIX_MAX_GOAL_DEFAULT; i++) {
      for (let j = 0; j <= MATRIX_MAX_GOAL_DEFAULT; j++) {
        matrixSum += (result.distribution as Record<string, number>)[`${i}-${j}`] ?? 0;
      }
    }
    // Sum should be significantly less than 1 (tail is excluded)
    expect(matrixSum).toBeLessThan(1 - MAX_TAIL_MASS_RAW);
    // No silent renormalization occurred
    expect(matrixSum + result.tail_mass_raw).toBeCloseTo(1.0, 6);
  });

  it('boundary: asymmetric lambdas produce asymmetric matrix', () => {
    const result = buildRawMatchDistribution(3.0, 0.5);
    // Home team (lambda=3.0) should have higher probability of scoring more
    // P(1-0) should be higher than P(0-1)
    const p10 = (result.distribution as Record<string, number>)['1-0'] ?? 0;
    const p01 = (result.distribution as Record<string, number>)['0-1'] ?? 0;
    expect(p10).toBeGreaterThan(p01);
  });

  it('boundary: symmetric lambdas produce near-symmetric matrix', () => {
    const result = buildRawMatchDistribution(1.5, 1.5);
    // P(2-1) ≈ P(1-2) for symmetric lambdas
    const p21 = (result.distribution as Record<string, number>)['2-1'] ?? 0;
    const p12 = (result.distribution as Record<string, number>)['1-2'] ?? 0;
    expect(Math.abs(p21 - p12)).toBeLessThan(EPSILON_PROBABILITY);
  });
});

// ── renormalizeDistribution ────────────────────────────────────────────────

describe('renormalizeDistribution', () => {
  it('produces a distribution summing to 1.0 ± epsilon', () => {
    const raw = buildRawMatchDistribution(1.35, 1.35);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);

    let sum = 0;
    for (let i = 0; i <= MATRIX_MAX_GOAL_DEFAULT; i++) {
      for (let j = 0; j <= MATRIX_MAX_GOAL_DEFAULT; j++) {
        sum += (normalized as Record<string, number>)[`${i}-${j}`] ?? 0;
      }
    }
    expect(sum).toBeCloseTo(1.0, 8);
  });

  it('preserves relative ordering of cells', () => {
    const raw = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);

    // P_norm(1-1) > P_norm(3-3) should hold if P_raw(1-1) > P_raw(3-3)
    const rawP11 = (raw.distribution as Record<string, number>)['1-1'] ?? 0;
    const rawP33 = (raw.distribution as Record<string, number>)['3-3'] ?? 0;
    const normP11 = (normalized as Record<string, number>)['1-1'] ?? 0;
    const normP33 = (normalized as Record<string, number>)['3-3'] ?? 0;

    if (rawP11 > rawP33) {
      expect(normP11).toBeGreaterThan(normP33);
    }
  });

  it('is deterministic', () => {
    const raw = buildRawMatchDistribution(1.4, 1.1);
    const n1 = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const n2 = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);

    for (let i = 0; i <= MATRIX_MAX_GOAL_DEFAULT; i++) {
      for (let j = 0; j <= MATRIX_MAX_GOAL_DEFAULT; j++) {
        const key = `${i}-${j}`;
        expect((n1 as Record<string, number>)[key]).toBe((n2 as Record<string, number>)[key]);
      }
    }
  });
});

// ── Reconstruction test (§20 / §25.4) ────────────────────────────────────

describe('reconstruction from persisted state (§14.3, §25.4)', () => {
  it('can reconstruct identical matrix from persisted lambda and maxGoal', () => {
    // Simulate persisting
    const original = buildRawMatchDistribution(1.6, 1.1, 7);
    const persisted = {
      lambda_home: original.lambda_home,
      lambda_away: original.lambda_away,
      matrix_max_goal: original.matrix_max_goal,
      tail_mass_raw: original.tail_mass_raw,
    };

    // Reconstruct
    const reconstructed = buildRawMatchDistribution(
      persisted.lambda_home,
      persisted.lambda_away,
      persisted.matrix_max_goal,
    );

    // Must be bit-identical
    expect(reconstructed.tail_mass_raw).toBe(persisted.tail_mass_raw);

    for (let i = 0; i <= persisted.matrix_max_goal; i++) {
      for (let j = 0; j <= persisted.matrix_max_goal; j++) {
        const key = `${i}-${j}`;
        const orig = (original.distribution as Record<string, number>)[key];
        const recon = (reconstructed.distribution as Record<string, number>)[key];
        expect(orig).toBe(recon);
      }
    }
  });
});

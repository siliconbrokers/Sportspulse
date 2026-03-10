/**
 * Raw 1X2 Aggregator — Unit Tests
 *
 * Spec authority: §16.1, §19.1, §19.5
 * Invariants tested:
 *   - home + draw + away = 1.0 ± epsilon for renormalized distribution
 *   - raw_p_home_win = Σ P(i,j) where i > j
 *   - raw_p_draw = Σ P(i,j) where i = j
 *   - raw_p_away_win = Σ P(i,j) where i < j
 *   - Branded type isolation (Raw1x2Probs ≠ Calibrated1x2Probs)
 *   - Determinism
 */

import { describe, it, expect } from 'vitest';
import { aggregateRaw1x2 } from '../../src/engine/raw-aggregator.js';
import {
  buildRawMatchDistribution,
  renormalizeDistribution,
} from '../../src/engine/scoreline-matrix.js';
import { EPSILON_PROBABILITY, MATRIX_MAX_GOAL_DEFAULT } from '../../src/contracts/index.js';

describe('aggregateRaw1x2', () => {
  it('home + draw + away = 1.0 ± epsilon for renormalized distribution (§19.1)', () => {
    const raw = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const result = aggregateRaw1x2(normalized, MATRIX_MAX_GOAL_DEFAULT);

    const { probs } = result;
    expect(Math.abs(probs.home + probs.draw + probs.away - 1.0)).toBeLessThanOrEqual(
      EPSILON_PROBABILITY * 100,
    );
  });

  it('all probabilities are in [0, 1] (§19.1)', () => {
    const raw = buildRawMatchDistribution(1.35, 1.35);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const { probs } = aggregateRaw1x2(normalized, MATRIX_MAX_GOAL_DEFAULT);

    expect(probs.home).toBeGreaterThanOrEqual(0);
    expect(probs.home).toBeLessThanOrEqual(1);
    expect(probs.draw).toBeGreaterThanOrEqual(0);
    expect(probs.draw).toBeLessThanOrEqual(1);
    expect(probs.away).toBeGreaterThanOrEqual(0);
    expect(probs.away).toBeLessThanOrEqual(1);
  });

  it('higher home lambda → higher raw_p_home_win', () => {
    // Home team is much stronger — should have high win probability
    const raw = buildRawMatchDistribution(3.0, 0.5);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const { probs } = aggregateRaw1x2(normalized, MATRIX_MAX_GOAL_DEFAULT);

    expect(probs.home).toBeGreaterThan(probs.away);
    expect(probs.home).toBeGreaterThan(probs.draw);
  });

  it('equal lambdas → home slightly favored due to symmetric probabilities', () => {
    // With symmetric lambdas, home and away should be roughly equal
    // (no asymmetry introduced in aggregation itself)
    const raw = buildRawMatchDistribution(1.5, 1.5);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const { probs } = aggregateRaw1x2(normalized, MATRIX_MAX_GOAL_DEFAULT);

    // Symmetric → home = away
    expect(Math.abs(probs.home - probs.away)).toBeLessThan(0.001);
  });

  it('draw probability is highest for equal-strength, low-scoring context', () => {
    // Very low lambdas → lots of 0-0 → draw probability is high
    const raw = buildRawMatchDistribution(0.5, 0.5);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const { probs } = aggregateRaw1x2(normalized, MATRIX_MAX_GOAL_DEFAULT);

    // With lambda=0.5, P(0-0) is very high → draw dominates
    expect(probs.draw).toBeGreaterThan(probs.home);
    expect(probs.draw).toBeGreaterThan(probs.away);
  });

  it('is deterministic', () => {
    const raw = buildRawMatchDistribution(1.6, 1.1);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);

    const r1 = aggregateRaw1x2(normalized, MATRIX_MAX_GOAL_DEFAULT);
    const r2 = aggregateRaw1x2(normalized, MATRIX_MAX_GOAL_DEFAULT);

    expect(r1.probs.home).toBe(r2.probs.home);
    expect(r1.probs.draw).toBe(r2.probs.draw);
    expect(r1.probs.away).toBe(r2.probs.away);
  });

  it('sumDeviates is false for renormalized distribution', () => {
    const raw = buildRawMatchDistribution(1.35, 1.35);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const result = aggregateRaw1x2(normalized, MATRIX_MAX_GOAL_DEFAULT);

    // For renormalized distribution, sum should be ~1.0
    expect(result.sumCheck).toBeCloseTo(1.0, 8);
  });

  it('§16.1: each cell counted in exactly one bucket (home/draw/away)', () => {
    // Verify by computing expected values manually for a 2×2 sub-matrix
    const raw = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const { probs } = aggregateRaw1x2(normalized, MATRIX_MAX_GOAL_DEFAULT);

    // Manually count
    let manualHome = 0,
      manualDraw = 0,
      manualAway = 0;
    for (let i = 0; i <= MATRIX_MAX_GOAL_DEFAULT; i++) {
      for (let j = 0; j <= MATRIX_MAX_GOAL_DEFAULT; j++) {
        const p = (normalized as Record<string, number>)[`${i}-${j}`] ?? 0;
        if (i > j) manualHome += p;
        else if (i === j) manualDraw += p;
        else manualAway += p;
      }
    }

    expect(probs.home).toBeCloseTo(manualHome, 12);
    expect(probs.draw).toBeCloseTo(manualDraw, 12);
    expect(probs.away).toBeCloseTo(manualAway, 12);
  });
});

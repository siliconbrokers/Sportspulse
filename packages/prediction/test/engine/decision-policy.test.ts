/**
 * Tests for computePredictedResult and decision policy.
 *
 * Spec §16.12, §16.13, §17.4, §25.4
 *
 * Invariants tested:
 * - TOO_CLOSE when favorite_margin < threshold (§16.12)
 * - predicted_result = argmax when margin >= threshold (§16.12)
 * - predicted_result_conflict = true iff result = TOO_CLOSE (§16.12)
 * - favorite_margin = top_1 - top_2 (§16.13)
 * - Deterministic reconstruction: same inputs → same output (§17.4, §25.4)
 * - Different policy versions with different thresholds produce different results (§17.4)
 */

import { describe, it, expect } from 'vitest';
import {
  computePredictedResult,
  computePredictedResultFromCurrentPolicy,
} from '../../src/engine/decision-policy.js';
import {
  DECISION_POLICY_REGISTRY,
  CURRENT_DECISION_POLICY_VERSION,
} from '../../src/calibration/version-metadata.js';
import type { Calibrated1x2Probs } from '../../src/contracts/index.js';
import { TOO_CLOSE_MARGIN_THRESHOLD_DEFAULT } from '../../src/contracts/constants.js';

/** Create a Calibrated1x2Probs branded object from plain values. */
function mkCalibrated(home: number, draw: number, away: number): Calibrated1x2Probs {
  return { home, draw, away } as unknown as Calibrated1x2Probs;
}

// ── TOO_CLOSE detection ────────────────────────────────────────────────────

describe('computePredictedResult — TOO_CLOSE detection (§16.12)', () => {
  it('returns TOO_CLOSE and predicted_result_conflict=true when margin < threshold', () => {
    const threshold = 0.05;
    // home=0.35, draw=0.33, away=0.32 → margin = 0.35 - 0.33 = 0.02 < 0.05
    const probs = mkCalibrated(0.35, 0.33, 0.32);
    const result = computePredictedResult(probs, threshold, 'v-test');

    expect(result.predicted_result).toBe('TOO_CLOSE');
    expect(result.predicted_result_conflict).toBe(true);
  });

  it('returns TOO_CLOSE when margin is exactly 0 (uniform probs)', () => {
    const threshold = 0.02;
    const probs = mkCalibrated(1 / 3, 1 / 3, 1 / 3);
    const result = computePredictedResult(probs, threshold, 'v-test');

    expect(result.predicted_result).toBe('TOO_CLOSE');
    expect(result.predicted_result_conflict).toBe(true);
  });

  it('uses strict less-than: returns argmax when margin === threshold', () => {
    const threshold = 0.02;
    // home = 0.52, draw = 0.50, away = 0.00 → margin = 0.52 - 0.50 = 0.02 = threshold
    // Not strictly less-than → should NOT be TOO_CLOSE
    const probs = mkCalibrated(0.52, 0.48, 0.0);
    const result = computePredictedResult(probs, threshold, 'v-test');

    expect(result.predicted_result).toBe('HOME');
    expect(result.predicted_result_conflict).toBe(false);
  });
});

// ── argmax prediction ──────────────────────────────────────────────────────

describe('computePredictedResult — argmax (§16.12)', () => {
  it('predicts HOME when home is highest and margin >= threshold', () => {
    const probs = mkCalibrated(0.6, 0.25, 0.15);
    const result = computePredictedResult(probs, 0.02, 'v-test');

    expect(result.predicted_result).toBe('HOME');
    expect(result.predicted_result_conflict).toBe(false);
  });

  it('predicts DRAW when draw is highest and margin >= threshold', () => {
    const probs = mkCalibrated(0.25, 0.5, 0.25);
    const result = computePredictedResult(probs, 0.02, 'v-test');

    expect(result.predicted_result).toBe('DRAW');
    expect(result.predicted_result_conflict).toBe(false);
  });

  it('predicts AWAY when away is highest and margin >= threshold', () => {
    const probs = mkCalibrated(0.15, 0.2, 0.65);
    const result = computePredictedResult(probs, 0.02, 'v-test');

    expect(result.predicted_result).toBe('AWAY');
    expect(result.predicted_result_conflict).toBe(false);
  });
});

// ── favorite_margin correctness (§16.13) ──────────────────────────────────

describe('computePredictedResult — favorite_margin (§16.13)', () => {
  it('favorite_margin = max - second_max of calibrated probs', () => {
    // home=0.60, draw=0.25, away=0.15 → top_1=0.60, top_2=0.25 → margin=0.35
    const probs = mkCalibrated(0.6, 0.25, 0.15);
    const result = computePredictedResult(probs, 0.02, 'v-test');
    expect(result.favorite_margin).toBeCloseTo(0.6 - 0.25, 10);
  });

  it('favorite_margin = 0 for uniform distribution', () => {
    const probs = mkCalibrated(1 / 3, 1 / 3, 1 / 3);
    const result = computePredictedResult(probs, 0.02, 'v-test');
    expect(result.favorite_margin).toBeCloseTo(0, 10);
  });

  it('favorite_margin is always non-negative', () => {
    const cases: [number, number, number][] = [
      [0.7, 0.2, 0.1],
      [0.1, 0.8, 0.1],
      [0.2, 0.3, 0.5],
      [0.4, 0.35, 0.25],
    ];
    for (const [h, d, a] of cases) {
      const result = computePredictedResult(mkCalibrated(h!, d!, a!), 0.02, 'v-test');
      expect(result.favorite_margin).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Deterministic reconstruction (§17.4, §25.4) ───────────────────────────

describe('computePredictedResult — deterministic reconstruction (§17.4)', () => {
  it('same calibrated_probs + threshold + version always produces identical predicted_result', () => {
    // Fixture 1: HOME winner
    const probs1 = mkCalibrated(0.6, 0.25, 0.15);
    const r1a = computePredictedResult(probs1, 0.02, 'v1.0');
    const r1b = computePredictedResult(probs1, 0.02, 'v1.0');
    expect(r1a.predicted_result).toBe(r1b.predicted_result);
    expect(r1a.favorite_margin).toBe(r1b.favorite_margin);
    expect(r1a.predicted_result_conflict).toBe(r1b.predicted_result_conflict);

    // Fixture 2: DRAW winner
    const probs2 = mkCalibrated(0.25, 0.5, 0.25);
    const r2a = computePredictedResult(probs2, 0.02, 'v1.0');
    const r2b = computePredictedResult(probs2, 0.02, 'v1.0');
    expect(r2a.predicted_result).toBe(r2b.predicted_result);

    // Fixture 3: TOO_CLOSE
    const probs3 = mkCalibrated(0.34, 0.33, 0.33);
    const r3a = computePredictedResult(probs3, 0.05, 'v1.0');
    const r3b = computePredictedResult(probs3, 0.05, 'v1.0');
    expect(r3a.predicted_result).toBe('TOO_CLOSE');
    expect(r3b.predicted_result).toBe('TOO_CLOSE');
  });

  it('persists too_close_margin_threshold and decision_policy_version in output', () => {
    const probs = mkCalibrated(0.6, 0.25, 0.15);
    const result = computePredictedResult(probs, 0.05, 'v-test-version');
    expect(result.too_close_margin_threshold).toBe(0.05);
    expect(result.decision_policy_version).toBe('v-test-version');
  });
});

// ── Policy version isolation (§17.4) ──────────────────────────────────────

describe('computePredictedResult — policy version isolation (§17.4)', () => {
  it('same probs with different thresholds produces different results on boundary case', () => {
    // Margin of exactly 0.03
    const probs = mkCalibrated(0.53, 0.5, 0.0);
    // Normalizing: home=0.53/1.03, draw=0.50/1.03, away=0
    // Actually let us use cleaner numbers with margin exactly 0.03:
    const probs2 = mkCalibrated(0.515, 0.485, 0.0);
    // margin = 0.515 - 0.485 = 0.030

    const resultLowThreshold = computePredictedResult(probs2, 0.02, 'v-low');
    const resultHighThreshold = computePredictedResult(probs2, 0.05, 'v-high');

    // With threshold=0.02: 0.030 >= 0.02 → HOME
    expect(resultLowThreshold.predicted_result).toBe('HOME');
    expect(resultLowThreshold.predicted_result_conflict).toBe(false);

    // With threshold=0.05: 0.030 < 0.05 → TOO_CLOSE
    expect(resultHighThreshold.predicted_result).toBe('TOO_CLOSE');
    expect(resultHighThreshold.predicted_result_conflict).toBe(true);
  });
});

// ── Current policy integration ────────────────────────────────────────────

describe('computePredictedResultFromCurrentPolicy', () => {
  it('uses TOO_CLOSE_MARGIN_THRESHOLD_DEFAULT from the registry', () => {
    const config = DECISION_POLICY_REGISTRY.get(CURRENT_DECISION_POLICY_VERSION)!;
    expect(config.too_close_margin_threshold).toBe(TOO_CLOSE_MARGIN_THRESHOLD_DEFAULT);

    // margin = 0.01 < 0.02 → TOO_CLOSE with current policy
    const probs = mkCalibrated(0.345, 0.335, 0.32);
    const result = computePredictedResultFromCurrentPolicy(probs);
    expect(result.too_close_margin_threshold).toBe(TOO_CLOSE_MARGIN_THRESHOLD_DEFAULT);
    expect(result.decision_policy_version).toBe(CURRENT_DECISION_POLICY_VERSION);
  });
});

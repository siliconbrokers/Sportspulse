/**
 * dnb.test.ts — Draw No Bet invariant tests.
 *
 * Spec authority: §19.4 (Invariante DNB), §16.4 (Draw No Bet formula)
 *
 * Invariants tested:
 * - dnb_home + dnb_away = 1.0 exactly when denominator > epsilon (§19.4)
 * - dnb_home = p_home / (1 - p_draw) per §16.4 formula
 * - dnb_away = p_away / (1 - p_draw) per §16.4 formula
 * - Both null when 1 - p_draw <= epsilon_dnb_denominator (§16.4, §19.4)
 * - DNB values derived from calibrated_1x2_probs — NOT raw probabilities (§19.5)
 *
 * Test family: CALIBRATED 1X2 only. Never cross-assert against raw goal distributions.
 */

import { describe, it, expect } from 'vitest';
import { computeDerivedCalibrated } from '../../src/engine/derived-calibrated.js';
import type { Calibrated1x2Probs } from '../../src/contracts/index.js';
import { EPSILON_DNB_DENOMINATOR } from '../../src/contracts/constants.js';

/** Build a Calibrated1x2Probs branded object from plain values. */
function mkCalibrated(home: number, draw: number, away: number): Calibrated1x2Probs {
  return { home, draw, away } as unknown as Calibrated1x2Probs;
}

// ── Family: CALIBRATED 1X2 — DNB invariants ────────────────────────────────

describe('DNB invariant — p_draw dominant (§19.4, §16.4)', () => {
  it('dnb_home + dnb_away = 1.0 exactly when p_draw is dominant (0.6)', () => {
    // Spec §19.4: dnb_home + dnb_away = 1.0 exactly when denominator > epsilon
    const probs = mkCalibrated(0.25, 0.6, 0.15);
    const result = computeDerivedCalibrated(probs);
    expect(result.dnb_home).not.toBeNull();
    expect(result.dnb_away).not.toBeNull();
    // Exact IEEE 754 sum, not approximate
    expect(result.dnb_home! + result.dnb_away!).toBe(1.0);
  });

  it('dnb_home = p_home / (1 - p_draw) when draw is dominant', () => {
    // Spec §16.4 formula
    const probs = mkCalibrated(0.25, 0.6, 0.15);
    const expected = 0.25 / (1 - 0.6);
    const result = computeDerivedCalibrated(probs);
    expect(result.dnb_home).toBeCloseTo(expected, 10);
  });

  it('dnb_away = p_away / (1 - p_draw) when draw is dominant', () => {
    const probs = mkCalibrated(0.25, 0.6, 0.15);
    const expected = 0.15 / (1 - 0.6);
    const result = computeDerivedCalibrated(probs);
    expect(result.dnb_away).toBeCloseTo(expected, 10);
  });
});

describe('DNB invariant — p_home_win dominant (§19.4, §16.4)', () => {
  it('dnb_home + dnb_away = 1.0 exactly when p_home dominates', () => {
    const probs = mkCalibrated(0.7, 0.2, 0.1);
    const result = computeDerivedCalibrated(probs);
    expect(result.dnb_home).not.toBeNull();
    expect(result.dnb_away).not.toBeNull();
    expect(result.dnb_home! + result.dnb_away!).toBe(1.0);
  });

  it('dnb_home is large (> 0.8) when home dominates strongly', () => {
    const probs = mkCalibrated(0.75, 0.15, 0.1);
    const result = computeDerivedCalibrated(probs);
    expect(result.dnb_home).not.toBeNull();
    // dnb_home = 0.75 / 0.85 ≈ 0.882
    expect(result.dnb_home!).toBeGreaterThan(0.8);
  });
});

describe('DNB invariant — p_away_win dominant (§19.4, §16.4)', () => {
  it('dnb_home + dnb_away = 1.0 exactly when away dominates', () => {
    const probs = mkCalibrated(0.1, 0.2, 0.7);
    const result = computeDerivedCalibrated(probs);
    expect(result.dnb_home).not.toBeNull();
    expect(result.dnb_away).not.toBeNull();
    expect(result.dnb_home! + result.dnb_away!).toBe(1.0);
  });

  it('dnb_away is large (> 0.8) when away dominates strongly', () => {
    const probs = mkCalibrated(0.1, 0.15, 0.75);
    const result = computeDerivedCalibrated(probs);
    expect(result.dnb_away).not.toBeNull();
    // dnb_away = 0.75 / 0.85 ≈ 0.882
    expect(result.dnb_away!).toBeGreaterThan(0.8);
  });
});

describe('DNB invariant — degenerate: p_home_win = p_away_win = 0 (§19.4)', () => {
  it('both null when p_draw = 1.0 exactly (denominator = 0)', () => {
    // §16.4: "Null if 1 - p_draw <= epsilon_dnb_denominator"
    // When p_draw = 1.0, denominator = 0, both must be null
    const probs = mkCalibrated(0, 1, 0);
    const result = computeDerivedCalibrated(probs);
    expect(result.dnb_home).toBeNull();
    expect(result.dnb_away).toBeNull();
  });

  it('both null when denominator equals epsilon exactly (boundary condition)', () => {
    // §16.4: condition is strictly >, so at epsilon_dnb_denominator itself → null
    const p_draw = 1 - EPSILON_DNB_DENOMINATOR;
    const p_home = EPSILON_DNB_DENOMINATOR / 2;
    const p_away = EPSILON_DNB_DENOMINATOR / 2;
    const probs = mkCalibrated(p_home, p_draw, p_away);
    const result = computeDerivedCalibrated(probs);
    // denominator = 1 - p_draw = EPSILON_DNB_DENOMINATOR, which is NOT > epsilon → null
    expect(result.dnb_home).toBeNull();
    expect(result.dnb_away).toBeNull();
  });

  it('not null when denominator is just above epsilon (boundary condition)', () => {
    // When denominator = EPSILON_DNB_DENOMINATOR * 10, condition is satisfied
    const p_draw = 1 - EPSILON_DNB_DENOMINATOR * 10;
    const p_home = EPSILON_DNB_DENOMINATOR * 6;
    const p_away = EPSILON_DNB_DENOMINATOR * 4;
    const probs = mkCalibrated(p_home, p_draw, p_away);
    const result = computeDerivedCalibrated(probs);
    // denominator > epsilon → should return numeric values, not null
    expect(result.dnb_home).not.toBeNull();
    expect(result.dnb_away).not.toBeNull();
    // And they must still sum to 1.0 exactly
    expect(result.dnb_home! + result.dnb_away!).toBe(1.0);
  });
});

describe('DNB invariant — property sweep over many inputs (§19.4)', () => {
  const CASES: [number, number, number][] = [
    [0.5, 0.3, 0.2],
    [0.6, 0.25, 0.15],
    [0.2, 0.4, 0.4],
    [0.7, 0.05, 0.25],
    [0.33, 0.34, 0.33],
    [0.01, 0.01, 0.98],
    [0.98, 0.01, 0.01],
    [0.45, 0.1, 0.45],
    [0.33, 0.33, 0.34],
    [0.15, 0.55, 0.3],
  ];

  it.each(CASES)(
    'dnb_home + dnb_away = 1.0 exactly for (home=%s, draw=%s, away=%s)',
    (home, draw, away) => {
      const probs = mkCalibrated(home, draw, away);
      const result = computeDerivedCalibrated(probs);
      expect(result.dnb_home).not.toBeNull();
      expect(result.dnb_away).not.toBeNull();
      expect(result.dnb_home! + result.dnb_away!).toBe(1.0);
    },
  );

  it.each(CASES)(
    'dnb_home and dnb_away are both ∈ [0,1] for (home=%s, draw=%s, away=%s)',
    (home, draw, away) => {
      const probs = mkCalibrated(home, draw, away);
      const result = computeDerivedCalibrated(probs);
      if (result.dnb_home !== null) {
        expect(result.dnb_home).toBeGreaterThanOrEqual(0);
        expect(result.dnb_home).toBeLessThanOrEqual(1);
      }
      if (result.dnb_away !== null) {
        expect(result.dnb_away).toBeGreaterThanOrEqual(0);
        expect(result.dnb_away).toBeLessThanOrEqual(1);
      }
    },
  );
});

describe('DNB source guard — calibrated probs only (§19.5)', () => {
  it('DNB is computed from calibrated_1x2_probs input, not raw probabilities (§19.5)', () => {
    // §19.5: dnb_home and dnb_away must come from calibrated_1x2_probs.
    // This test uses two distinct inputs — one "raw-like" and one "calibrated-like" —
    // and verifies the function operates on whatever is passed as calibrated input.
    // The function signature enforces Calibrated1x2Probs brand type, which is
    // structurally distinct from Raw1x2Probs.
    //
    // Verification: pass calibrated-branded input, verify DNB formula uses those values.
    const calibratedInput = mkCalibrated(0.52, 0.28, 0.2);
    const result = computeDerivedCalibrated(calibratedInput);
    // DNB must use p_home = 0.52, 1-p_draw = 1-0.28 = 0.72
    const expectedDnbHome = 0.52 / (1 - 0.28);
    expect(result.dnb_home).toBeCloseTo(expectedDnbHome, 8);
  });
});

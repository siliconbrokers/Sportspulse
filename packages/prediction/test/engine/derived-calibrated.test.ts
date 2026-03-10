/**
 * Tests for computeDerivedCalibrated.
 *
 * Spec §16.3 (double-chance), §16.4 (DNB), §19.3, §19.4
 *
 * Invariants tested:
 * - home_or_draw = p_home + p_draw (§16.3, §19.3)
 * - draw_or_away = p_draw + p_away (§16.3, §19.3)
 * - home_or_away = p_home + p_away (§16.3, §19.3)
 * - dnb_home + dnb_away = 1.0 exactly when denominator > epsilon (§19.4)
 * - dnb_home = null, dnb_away = null when 1 - p_draw <= epsilon (§16.4, §19.4)
 * - DNB denominator formula = (1 - p_draw), not (p_home + p_away)
 */

import { describe, it, expect } from 'vitest';
import { computeDerivedCalibrated } from '../../src/engine/derived-calibrated.js';
import type { Calibrated1x2Probs } from '../../src/contracts/index.js';
import { EPSILON_DNB_DENOMINATOR } from '../../src/contracts/constants.js';

/** Create a Calibrated1x2Probs branded object from plain values. */
function mkCalibrated(home: number, draw: number, away: number): Calibrated1x2Probs {
  return { home, draw, away } as unknown as Calibrated1x2Probs;
}

// ── Double-chance invariants ───────────────────────────────────────────────

describe('computeDerivedCalibrated — double-chance (§16.3, §19.3)', () => {
  it('home_or_draw = p_home + p_draw', () => {
    const probs = mkCalibrated(0.5, 0.3, 0.2);
    const result = computeDerivedCalibrated(probs);
    expect(result.home_or_draw).toBeCloseTo(0.5 + 0.3, 10);
  });

  it('draw_or_away = p_draw + p_away', () => {
    const probs = mkCalibrated(0.5, 0.3, 0.2);
    const result = computeDerivedCalibrated(probs);
    expect(result.draw_or_away).toBeCloseTo(0.3 + 0.2, 10);
  });

  it('home_or_away = p_home + p_away (= 1 - p_draw when probs sum to 1)', () => {
    const probs = mkCalibrated(0.5, 0.3, 0.2);
    const result = computeDerivedCalibrated(probs);
    expect(result.home_or_away).toBeCloseTo(0.5 + 0.2, 10);
    // Also verify consistency: home_or_away = 1 - p_draw (since probs sum to 1)
    expect(result.home_or_away).toBeCloseTo(1 - 0.3, 10);
  });

  it('works with extreme probability distributions', () => {
    const probs = mkCalibrated(0.95, 0.03, 0.02);
    const result = computeDerivedCalibrated(probs);
    expect(result.home_or_draw).toBeCloseTo(0.98, 10);
    expect(result.draw_or_away).toBeCloseTo(0.05, 10);
    expect(result.home_or_away).toBeCloseTo(0.97, 10);
  });

  it('double-chance values are in [0, 1]', () => {
    const cases: [number, number, number][] = [
      [0.33, 0.33, 0.34],
      [0.7, 0.2, 0.1],
      [0.1, 0.1, 0.8],
      [0.5, 0.5, 0.0],
    ];
    for (const [h, d, a] of cases) {
      const result = computeDerivedCalibrated(mkCalibrated(h!, d!, a!));
      expect(result.home_or_draw).toBeGreaterThanOrEqual(0);
      expect(result.home_or_draw).toBeLessThanOrEqual(1 + 1e-10);
      expect(result.draw_or_away).toBeGreaterThanOrEqual(0);
      expect(result.draw_or_away).toBeLessThanOrEqual(1 + 1e-10);
      expect(result.home_or_away).toBeGreaterThanOrEqual(0);
      expect(result.home_or_away).toBeLessThanOrEqual(1 + 1e-10);
    }
  });
});

// ── DNB invariant §19.4 ────────────────────────────────────────────────────

describe('computeDerivedCalibrated — DNB invariant (§16.4, §19.4)', () => {
  it('dnb_home + dnb_away = 1.0 exactly for normal draw probability', () => {
    const probs = mkCalibrated(0.5, 0.3, 0.2);
    const result = computeDerivedCalibrated(probs);

    expect(result.dnb_home).not.toBeNull();
    expect(result.dnb_away).not.toBeNull();

    // Must sum to EXACTLY 1.0 (not approximately)
    const sum = result.dnb_home! + result.dnb_away!;
    expect(sum).toBe(1.0);
  });

  it('dnb invariant holds for various probability distributions', () => {
    const cases: [number, number, number][] = [
      [0.6, 0.25, 0.15],
      [0.2, 0.4, 0.4],
      [0.7, 0.05, 0.25],
      [0.333, 0.334, 0.333],
      [0.01, 0.01, 0.98],
    ];

    for (const [h, d, a] of cases) {
      const result = computeDerivedCalibrated(mkCalibrated(h!, d!, a!));
      expect(result.dnb_home).not.toBeNull();
      expect(result.dnb_away).not.toBeNull();
      const sum = result.dnb_home! + result.dnb_away!;
      // Exactly 1.0 — this is the core DNB invariant
      expect(sum).toBe(1.0);
    }
  });

  it('dnb_home = p_home / (1 - p_draw) per §16.4 formula', () => {
    const probs = mkCalibrated(0.5, 0.3, 0.2);
    const result = computeDerivedCalibrated(probs);
    // dnb_home = 0.5 / (1 - 0.3) = 0.5 / 0.7 ≈ 0.7143
    const expected_dnb_home = 0.5 / (1 - 0.3);
    expect(result.dnb_home).toBeCloseTo(expected_dnb_home, 10);
  });

  it('dnb_away = p_away / (1 - p_draw) per §16.4 formula', () => {
    const probs = mkCalibrated(0.5, 0.3, 0.2);
    const result = computeDerivedCalibrated(probs);
    // dnb_away = 0.2 / (1 - 0.3) = 0.2 / 0.7 ≈ 0.2857
    const expected_dnb_away = 0.2 / (1 - 0.3);
    expect(result.dnb_away).toBeCloseTo(expected_dnb_away, 10);
  });

  it('dnb_home = null and dnb_away = null when 1 - p_draw <= epsilon (§16.4)', () => {
    // p_draw ≈ 1.0 → denominator approaches 0
    const probs = mkCalibrated(0, 1, 0); // p_draw = 1
    const result = computeDerivedCalibrated(probs);
    expect(result.dnb_home).toBeNull();
    expect(result.dnb_away).toBeNull();
  });

  it('dnb_home = null when 1 - p_draw equals epsilon exactly', () => {
    // Denominator exactly at the epsilon boundary
    const p_draw = 1 - EPSILON_DNB_DENOMINATOR;
    const p_home = EPSILON_DNB_DENOMINATOR / 2;
    const p_away = EPSILON_DNB_DENOMINATOR / 2;
    const probs = mkCalibrated(p_home, p_draw, p_away);
    const result = computeDerivedCalibrated(probs);
    // 1 - p_draw = EPSILON_DNB_DENOMINATOR which is NOT > epsilon, so null
    expect(result.dnb_home).toBeNull();
    expect(result.dnb_away).toBeNull();
  });
});

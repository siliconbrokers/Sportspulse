/**
 * Tests for the DRAW_FLOOR rule in computePredictedResult (predicted-result.ts).
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §18 — Predicted Result
 *
 * SP-DRAW-13: 4 unit tests covering DRAW_FLOOR activation, floor miss,
 * margin-exceeded miss, and TOO_CLOSE precedence.
 *
 * All tests pass explicit overrides so they are independent of the current
 * production constant values (DRAW_FLOOR, DRAW_MARGIN, DRAW_FLOOR_ENABLED).
 * This ensures the rule logic is tested regardless of which experiment state
 * the feature flag is in.
 */

import { describe, it, expect } from 'vitest';
import { computePredictedResult } from '../../src/engine/v3/predicted-result.js';

// ── DRAW_FLOOR rule tests (SP-DRAW-13) ────────────────────────────────────────

describe('computePredictedResult — DRAW_FLOOR rule (SP-DRAW-13, §18)', () => {
  it('SP-DRAW-13-01: DRAW_FLOOR activates when p_draw >= floor AND max_other - p_draw <= margin', () => {
    // Spec §18 DRAW_FLOOR rule:
    //   probDraw=0.33 >= DRAW_FLOOR=0.26  ✓
    //   max(probHome, probAway) - probDraw = 0.40 - 0.33 = 0.07 <= DRAW_MARGIN=0.15  ✓
    //   → DRAW even though argmax would be HOME_WIN
    //
    // TOO_CLOSE check: margin = 0.40 - 0.33 = 0.07 — NOT strictly < 0.05, so no TOO_CLOSE.
    // NOTE: inputs are chosen to avoid the IEEE 754 boundary where 0.38-0.33=0.04999...
    // which would cause a spurious TOO_CLOSE false positive at exactly the threshold.
    const result = computePredictedResult(
      0.4, // probHome
      0.33, // probDraw
      0.27, // probAway
      {
        DRAW_FLOOR_ENABLED: true,
        DRAW_FLOOR: 0.26,
        DRAW_MARGIN: 0.15,
        TOO_CLOSE_THRESHOLD: 0.05,
      },
    );

    expect(result.predicted_result).toBe('DRAW');
    expect(result.favorite_margin).toBeCloseTo(0.07, 6); // maxOther - probDraw
  });

  it('SP-DRAW-13-02: DRAW_FLOOR does NOT activate when p_draw is below the floor', () => {
    // probDraw=0.25 < DRAW_FLOOR=0.26 → floor condition fails → argmax normal
    // argmax: HOME_WIN (0.50 > 0.25 > 0.25)
    // favorite_margin: max=0.50, second=0.25 → 0.25
    const result = computePredictedResult(
      0.5, // probHome
      0.25, // probDraw
      0.25, // probAway
      {
        DRAW_FLOOR_ENABLED: true,
        DRAW_FLOOR: 0.26,
        DRAW_MARGIN: 0.15,
        TOO_CLOSE_THRESHOLD: 0.05,
      },
    );

    expect(result.predicted_result).toBe('HOME_WIN');
    expect(result.favorite_margin).toBeCloseTo(0.25, 6);
  });

  it('SP-DRAW-13-03: DRAW_FLOOR does NOT activate when max_other - p_draw exceeds DRAW_MARGIN', () => {
    // probDraw=0.28 >= DRAW_FLOOR=0.26  ✓
    // max(probHome, probAway) - probDraw = 0.50 - 0.28 = 0.22 > DRAW_MARGIN=0.15  → rule skipped
    // argmax normal: HOME_WIN
    // favorite_margin: max=0.50, second=0.28 → 0.22
    const result = computePredictedResult(
      0.5, // probHome
      0.28, // probDraw
      0.22, // probAway
      {
        DRAW_FLOOR_ENABLED: true,
        DRAW_FLOOR: 0.26,
        DRAW_MARGIN: 0.15,
        TOO_CLOSE_THRESHOLD: 0.05,
      },
    );

    expect(result.predicted_result).toBe('HOME_WIN');
    expect(result.favorite_margin).toBeCloseTo(0.22, 6);
  });

  it('SP-DRAW-13-04: TOO_CLOSE takes precedence over DRAW_FLOOR — predicted_result is argmax (not null)', () => {
    // margin = max(0.34,0.33,0.33) - second = 0.34 - 0.33 = 0.01 < TOO_CLOSE_THRESHOLD=0.05
    // → TOO_CLOSE fires first, DRAW_FLOOR is never reached
    // p_draw=0.33 >= DRAW_FLOOR=0.26 would have qualified, but precedence prevents it
    // predicted_result = argmax = HOME_WIN (cercanía señalada por favorite_margin < threshold)
    const result = computePredictedResult(
      0.34, // probHome
      0.33, // probDraw
      0.33, // probAway
      {
        DRAW_FLOOR_ENABLED: true,
        DRAW_FLOOR: 0.26,
        DRAW_MARGIN: 0.15,
        TOO_CLOSE_THRESHOLD: 0.05,
      },
    );

    expect(result.predicted_result).toBe('HOME_WIN');
    expect(result.favorite_margin).toBeCloseTo(0.01, 6);
  });
});

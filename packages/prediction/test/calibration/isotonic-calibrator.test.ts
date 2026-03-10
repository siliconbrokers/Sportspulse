/**
 * Tests for IsotonicCalibrator and one-vs-rest calibration.
 *
 * Spec §17.1, §17.2, §17.3
 * Invariants tested:
 * - Output monotonicity (isotonic property)
 * - Calibrated probs sum to 1.0 (renormalization §16.3)
 * - Identity calibrator acts as pass-through
 * - Temporal leakage guard throws TemporalLeakageError (§17.3)
 * - Segment fallback when count < 300 (§17.2)
 */

import { describe, it, expect } from 'vitest';
import {
  IsotonicCalibrator,
  TemporalLeakageError,
  fitOneVsRestCalibrators,
  applyOneVsRestCalibration,
} from '../../src/calibration/isotonic-calibrator.js';
import {
  selectCalibrator,
  MIN_SAMPLES_FOR_SEGMENTED_CALIBRATION,
  MIN_SAMPLES_FOR_INTERMEDIATE_CALIBRATION,
} from '../../src/calibration/calibration-selector.js';
import type {
  CalibrationRegistry,
  CalibrationSegmentRecord,
} from '../../src/calibration/calibration-selector.js';
import { EPSILON_PROBABILITY } from '../../src/contracts/constants.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a simple identity calibrator record with a given sample count. */
function makeIdentityRecord(segmentId: string, sampleCount: number): CalibrationSegmentRecord {
  return {
    segment_id: segmentId,
    calibrators: {
      home: IsotonicCalibrator.createIdentity(),
      draw: IsotonicCalibrator.createIdentity(),
      away: IsotonicCalibrator.createIdentity(),
    },
    sample_count: sampleCount,
  };
}

// ── test: identity calibrator acts as pass-through ─────────────────────────

describe('IsotonicCalibrator — identity mode', () => {
  it('returns raw_prob unchanged for values in [0, 1]', () => {
    const cal = IsotonicCalibrator.createIdentity();
    expect(cal.is_identity_calibration).toBe(true);
    expect(cal.predict(0.3)).toBe(0.3);
    expect(cal.predict(0.0)).toBe(0.0);
    expect(cal.predict(1.0)).toBe(1.0);
    expect(cal.predict(0.7654)).toBeCloseTo(0.7654, 10);
  });

  it('clamps values outside [0, 1]', () => {
    const cal = IsotonicCalibrator.createIdentity();
    expect(cal.predict(-0.1)).toBe(0);
    expect(cal.predict(1.1)).toBe(1);
  });
});

// ── test: isotonic monotonicity ────────────────────────────────────────────

describe('IsotonicCalibrator — monotonicity invariant', () => {
  it('calibrated output is non-decreasing in raw input', () => {
    const cutoff = Date.now() + 1_000_000;

    // Training: perfectly calibrated sigmoid-like distribution
    const samples = [
      { raw_prob: 0.1, outcome: 0 as const, match_timestamp_ms: 1000, match_id: 'm1' },
      { raw_prob: 0.2, outcome: 0 as const, match_timestamp_ms: 1001, match_id: 'm2' },
      { raw_prob: 0.3, outcome: 0 as const, match_timestamp_ms: 1002, match_id: 'm3' },
      { raw_prob: 0.4, outcome: 1 as const, match_timestamp_ms: 1003, match_id: 'm4' },
      { raw_prob: 0.5, outcome: 0 as const, match_timestamp_ms: 1004, match_id: 'm5' },
      { raw_prob: 0.6, outcome: 1 as const, match_timestamp_ms: 1005, match_id: 'm6' },
      { raw_prob: 0.7, outcome: 1 as const, match_timestamp_ms: 1006, match_id: 'm7' },
      { raw_prob: 0.8, outcome: 1 as const, match_timestamp_ms: 1007, match_id: 'm8' },
      { raw_prob: 0.9, outcome: 1 as const, match_timestamp_ms: 1008, match_id: 'm9' },
    ];

    const cal = IsotonicCalibrator.fit(samples, cutoff);
    expect(cal.is_identity_calibration).toBe(false);

    // Test monotonicity across a grid of input values
    const rawInputs = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
    let prev = -Infinity;
    for (const raw of rawInputs) {
      const calibrated = cal.predict(raw);
      expect(calibrated).toBeGreaterThanOrEqual(prev - EPSILON_PROBABILITY);
      prev = calibrated;
    }
  });

  it('handles all-same outcomes without crashing', () => {
    const cutoff = Date.now() + 1_000_000;
    const samples = [
      { raw_prob: 0.3, outcome: 1 as const, match_timestamp_ms: 1000, match_id: 'm1' },
      { raw_prob: 0.5, outcome: 1 as const, match_timestamp_ms: 1001, match_id: 'm2' },
      { raw_prob: 0.7, outcome: 1 as const, match_timestamp_ms: 1002, match_id: 'm3' },
    ];
    const cal = IsotonicCalibrator.fit(samples, cutoff);
    // All outputs should be 1 (all outcomes are 1)
    expect(cal.predict(0.1)).toBeCloseTo(1.0);
    expect(cal.predict(0.9)).toBeCloseTo(1.0);
  });
});

// ── test: calibrated probs sum to 1.0 ─────────────────────────────────────

describe('applyOneVsRestCalibration — renormalization', () => {
  it('output sums to 1.0 for identity calibrators (§16.3)', () => {
    const identitySet = {
      home: IsotonicCalibrator.createIdentity(),
      draw: IsotonicCalibrator.createIdentity(),
      away: IsotonicCalibrator.createIdentity(),
    };
    const raw_inputs: [number, number, number][] = [
      [0.5, 0.3, 0.2],
      [0.1, 0.1, 0.8],
      [0.4, 0.4, 0.2],
      [0.333, 0.333, 0.334],
      [0.01, 0.98, 0.01],
    ];

    for (const [h, d, a] of raw_inputs) {
      const result = applyOneVsRestCalibration(h!, d!, a!, identitySet);
      const sum = result.home + result.draw + result.away;
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-10);
    }
  });

  it('output sums to 1.0 after fitting on training data (§16.3)', () => {
    const cutoff = Date.now() + 1_000_000;

    const trainingSamples = [
      {
        raw_home: 0.6,
        raw_draw: 0.25,
        raw_away: 0.15,
        actual_outcome: 'HOME' as const,
        match_timestamp_ms: 1000,
        match_id: 'm1',
      },
      {
        raw_home: 0.4,
        raw_draw: 0.35,
        raw_away: 0.25,
        actual_outcome: 'DRAW' as const,
        match_timestamp_ms: 1001,
        match_id: 'm2',
      },
      {
        raw_home: 0.2,
        raw_draw: 0.3,
        raw_away: 0.5,
        actual_outcome: 'AWAY' as const,
        match_timestamp_ms: 1002,
        match_id: 'm3',
      },
      {
        raw_home: 0.55,
        raw_draw: 0.25,
        raw_away: 0.2,
        actual_outcome: 'HOME' as const,
        match_timestamp_ms: 1003,
        match_id: 'm4',
      },
      {
        raw_home: 0.35,
        raw_draw: 0.4,
        raw_away: 0.25,
        actual_outcome: 'DRAW' as const,
        match_timestamp_ms: 1004,
        match_id: 'm5',
      },
    ];

    const calibrators = fitOneVsRestCalibrators(trainingSamples, cutoff);

    const testInputs: [number, number, number][] = [
      [0.5, 0.3, 0.2],
      [0.7, 0.2, 0.1],
      [0.15, 0.35, 0.5],
    ];

    for (const [h, d, a] of testInputs) {
      const result = applyOneVsRestCalibration(h!, d!, a!, calibrators);
      const sum = result.home + result.draw + result.away;
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-10);
    }
  });
});

// ── test: temporal leakage guard (§17.3) ──────────────────────────────────

describe('IsotonicCalibrator.fit — temporal leakage guard (§17.3)', () => {
  it('throws TemporalLeakageError when a sample is after prediction_cutoff', () => {
    const cutoff = 1_000_000; // ms

    const samples = [
      { raw_prob: 0.4, outcome: 1 as const, match_timestamp_ms: 500_000, match_id: 'before' },
      { raw_prob: 0.6, outcome: 0 as const, match_timestamp_ms: 1_500_000, match_id: 'after' }, // violates cutoff
    ];

    expect(() => IsotonicCalibrator.fit(samples, cutoff)).toThrow(TemporalLeakageError);
  });

  it('throws with the correct match_id and timestamps in the error', () => {
    const cutoff = 1_000_000;
    const samples = [
      { raw_prob: 0.5, outcome: 1 as const, match_timestamp_ms: 2_000_000, match_id: 'leak-match' },
    ];

    let caughtError: TemporalLeakageError | null = null;
    try {
      IsotonicCalibrator.fit(samples, cutoff);
    } catch (e) {
      caughtError = e as TemporalLeakageError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.matchId).toBe('leak-match');
    expect(caughtError?.matchTimestamp).toBe(2_000_000);
    expect(caughtError?.predictionCutoff).toBe(1_000_000);
  });

  it('does NOT throw when sample timestamp exactly equals cutoff', () => {
    const cutoff = 1_000_000;
    const samples = [
      { raw_prob: 0.5, outcome: 1 as const, match_timestamp_ms: 1_000_000, match_id: 'at-cutoff' },
    ];
    // Should not throw — equal is not after
    expect(() => IsotonicCalibrator.fit(samples, cutoff)).not.toThrow();
  });

  it('succeeds when all samples are before prediction_cutoff', () => {
    const cutoff = 1_000_000;
    const samples = [
      { raw_prob: 0.3, outcome: 0 as const, match_timestamp_ms: 100_000, match_id: 'm1' },
      { raw_prob: 0.6, outcome: 1 as const, match_timestamp_ms: 500_000, match_id: 'm2' },
    ];
    expect(() => IsotonicCalibrator.fit(samples, cutoff)).not.toThrow();
  });
});

// ── test: segment fallback when count < threshold (§17.2) ─────────────────

describe('selectCalibrator — segment fallback (§17.2)', () => {
  const globalRecord = makeIdentityRecord('global', 5000);

  it('uses global calibrator and sets fallback_used=true when segment count < 300', () => {
    const smallRecord = makeIdentityRecord('CLUB:DOMESTIC_LEAGUE', 150);
    const registry: CalibrationRegistry = {
      segments: new Map([['CLUB:DOMESTIC_LEAGUE', smallRecord]]),
      global: globalRecord,
    };

    const result = selectCalibrator('CLUB', 'DOMESTIC_LEAGUE', registry);

    expect(result.calibration_fallback_used).toBe(true);
    expect(result.calibration_segment_id).toBe('global');
    expect(result.calibration_tier).toBe('global');
  });

  it('uses global calibrator when segment is not found', () => {
    const registry: CalibrationRegistry = {
      segments: new Map(),
      global: globalRecord,
    };

    const result = selectCalibrator('NATIONAL_TEAM', 'NATIONAL_TEAM_TOURNAMENT', registry);

    expect(result.calibration_fallback_used).toBe(true);
    expect(result.calibration_segment_id).toBe('global');
    expect(result.calibration_tier).toBe('global');
  });

  it('uses segment calibrator when count >= 1000 and sets fallback_used=false', () => {
    const largeRecord = makeIdentityRecord('CLUB:DOMESTIC_LEAGUE', 1500);
    const registry: CalibrationRegistry = {
      segments: new Map([['CLUB:DOMESTIC_LEAGUE', largeRecord]]),
      global: globalRecord,
    };

    const result = selectCalibrator('CLUB', 'DOMESTIC_LEAGUE', registry);

    expect(result.calibration_fallback_used).toBe(false);
    expect(result.calibration_segment_id).toBe('CLUB:DOMESTIC_LEAGUE');
    expect(result.calibration_tier).toBe('segmented');
  });

  it('uses intermediate tier when count is in [300, 1000)', () => {
    const midRecord = makeIdentityRecord('CLUB:DOMESTIC_CUP', 500);
    const registry: CalibrationRegistry = {
      segments: new Map([['CLUB:DOMESTIC_CUP', midRecord]]),
      global: globalRecord,
    };

    const result = selectCalibrator('CLUB', 'DOMESTIC_CUP', registry);

    expect(result.calibration_fallback_used).toBe(false);
    expect(result.calibration_segment_id).toBe('CLUB:DOMESTIC_CUP');
    expect(result.calibration_tier).toBe('intermediate');
  });

  it('boundary: count = 999 is intermediate', () => {
    const record = makeIdentityRecord(
      'CLUB:DOMESTIC_LEAGUE',
      MIN_SAMPLES_FOR_SEGMENTED_CALIBRATION - 1,
    );
    const registry: CalibrationRegistry = {
      segments: new Map([['CLUB:DOMESTIC_LEAGUE', record]]),
      global: globalRecord,
    };
    const result = selectCalibrator('CLUB', 'DOMESTIC_LEAGUE', registry);
    expect(result.calibration_tier).toBe('intermediate');
  });

  it('boundary: count = 1000 is segmented', () => {
    const record = makeIdentityRecord(
      'CLUB:DOMESTIC_LEAGUE',
      MIN_SAMPLES_FOR_SEGMENTED_CALIBRATION,
    );
    const registry: CalibrationRegistry = {
      segments: new Map([['CLUB:DOMESTIC_LEAGUE', record]]),
      global: globalRecord,
    };
    const result = selectCalibrator('CLUB', 'DOMESTIC_LEAGUE', registry);
    expect(result.calibration_tier).toBe('segmented');
  });

  it('boundary: count = 299 falls back to global', () => {
    const record = makeIdentityRecord(
      'CLUB:DOMESTIC_LEAGUE',
      MIN_SAMPLES_FOR_INTERMEDIATE_CALIBRATION - 1,
    );
    const registry: CalibrationRegistry = {
      segments: new Map([['CLUB:DOMESTIC_LEAGUE', record]]),
      global: globalRecord,
    };
    const result = selectCalibrator('CLUB', 'DOMESTIC_LEAGUE', registry);
    expect(result.calibration_tier).toBe('global');
    expect(result.calibration_fallback_used).toBe(true);
  });
});

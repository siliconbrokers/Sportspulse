/**
 * anti-leakage.test.ts — Temporal anti-leakage invariant tests.
 *
 * Spec authority: §17.3 (Corte temporal), §3.6 (Política anti-leakage obligatoria)
 *
 * Invariants tested:
 * - fitOneVsRestCalibrators throws TemporalLeakageError when any sample has
 *   match_timestamp_ms > prediction_cutoff_ms (§17.3)
 * - IsotonicCalibrator.fit throws TemporalLeakageError for future timestamps (§17.3)
 * - Training with samples all at or before cutoff succeeds without error
 * - Cutoff equal to kickoff date rejects samples with timestamp > kickoff
 * - Error message includes match_id and timestamp information
 * - All three class calibrators are guarded individually
 *
 * §17.3: "La calibración debe entrenarse solo con datos anteriores
 *         al bloque de validación / inferencia."
 */

import { describe, it, expect } from 'vitest';
import {
  IsotonicCalibrator,
  fitOneVsRestCalibrators,
  TemporalLeakageError,
} from '../../src/calibration/isotonic-calibrator.js';
import type {
  CalibrationSample,
  OneVsRestTrainingSample,
} from '../../src/calibration/isotonic-calibrator.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

const KICKOFF_UTC = new Date('2025-06-01T18:00:00Z').getTime();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Sample with timestamp safely before cutoff. */
function safeSample(i: number): CalibrationSample {
  return {
    raw_prob: 0.3 + i * 0.05,
    outcome: i % 2 === 0 ? 1 : 0,
    match_timestamp_ms: KICKOFF_UTC - (30 - i) * ONE_DAY_MS, // 1-30 days before kickoff
    match_id: `safe-match-${i}`,
  };
}

/** Sample with timestamp AFTER the cutoff — must be rejected. */
function futureSample(): CalibrationSample {
  return {
    raw_prob: 0.55,
    outcome: 1,
    match_timestamp_ms: KICKOFF_UTC + ONE_DAY_MS, // 1 day after cutoff
    match_id: 'future-match-001',
  };
}

// ── IsotonicCalibrator.fit — temporal guard ────────────────────────────────

describe('IsotonicCalibrator.fit — temporal leakage guard (§17.3)', () => {
  it('throws TemporalLeakageError when a single sample has timestamp > cutoff', () => {
    const samples: CalibrationSample[] = [
      safeSample(0),
      safeSample(1),
      futureSample(),
      safeSample(2),
    ];
    expect(() => {
      IsotonicCalibrator.fit(samples, KICKOFF_UTC);
    }).toThrow(TemporalLeakageError);
  });

  it('error is specifically a TemporalLeakageError instance (§17.3)', () => {
    const samples = [safeSample(0), futureSample()];
    try {
      IsotonicCalibrator.fit(samples, KICKOFF_UTC);
      expect.fail('Expected TemporalLeakageError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemporalLeakageError);
    }
  });

  it('error message includes the offending match_id', () => {
    const future = futureSample();
    try {
      IsotonicCalibrator.fit([future], KICKOFF_UTC);
      expect.fail('Expected TemporalLeakageError');
    } catch (err) {
      expect(err).toBeInstanceOf(TemporalLeakageError);
      expect((err as TemporalLeakageError).message).toContain('future-match-001');
    }
  });

  it('error contains the offending timestamp and cutoff (§17.3 audit trail)', () => {
    const future = futureSample();
    try {
      IsotonicCalibrator.fit([future], KICKOFF_UTC);
      expect.fail('Expected TemporalLeakageError');
    } catch (err) {
      const leakageError = err as TemporalLeakageError;
      expect(leakageError.matchId).toBe('future-match-001');
      expect(leakageError.matchTimestamp).toBeGreaterThan(KICKOFF_UTC);
      expect(leakageError.predictionCutoff).toBe(KICKOFF_UTC);
    }
  });

  it('sample with timestamp exactly at cutoff is accepted (boundary: <=)', () => {
    // §17.3: cutoff check is strict >. timestamp === cutoff is permitted.
    const atCutoff: CalibrationSample = {
      raw_prob: 0.45,
      outcome: 1,
      match_timestamp_ms: KICKOFF_UTC, // exactly at cutoff — must NOT throw
      match_id: 'at-cutoff-match',
    };
    // Should not throw
    expect(() => {
      IsotonicCalibrator.fit([atCutoff], KICKOFF_UTC);
    }).not.toThrow();
  });

  it('sample with timestamp 1ms before cutoff is accepted', () => {
    const justBefore: CalibrationSample = {
      raw_prob: 0.4,
      outcome: 0,
      match_timestamp_ms: KICKOFF_UTC - 1,
      match_id: 'just-before-cutoff',
    };
    expect(() => {
      IsotonicCalibrator.fit([justBefore], KICKOFF_UTC);
    }).not.toThrow();
  });

  it('sample with timestamp 1ms after cutoff throws', () => {
    const justAfter: CalibrationSample = {
      raw_prob: 0.4,
      outcome: 0,
      match_timestamp_ms: KICKOFF_UTC + 1,
      match_id: 'just-after-cutoff',
    };
    expect(() => {
      IsotonicCalibrator.fit([justAfter], KICKOFF_UTC);
    }).toThrow(TemporalLeakageError);
  });

  it('fits successfully when all samples are before cutoff', () => {
    const samples = Array.from({ length: 10 }, (_, i) => safeSample(i));
    // Should not throw — all samples are before cutoff
    let calibrator: IsotonicCalibrator | null = null;
    expect(() => {
      calibrator = IsotonicCalibrator.fit(samples, KICKOFF_UTC);
    }).not.toThrow();
    expect(calibrator).not.toBeNull();
  });

  it('empty sample list produces identity calibrator without throwing', () => {
    // §17.3: empty samples → identity calibrator (bootstrapping mode)
    const calibrator = IsotonicCalibrator.fit([], KICKOFF_UTC);
    expect(calibrator.is_identity_calibration).toBe(true);
  });
});

// ── fitOneVsRestCalibrators — temporal guard on all three classes ──────────

describe('fitOneVsRestCalibrators — temporal guard (§17.3)', () => {
  function mkOvrSamples(
    count: number,
    options: { includeFuture?: boolean; futureClass?: 'HOME' | 'DRAW' | 'AWAY' } = {},
  ): OneVsRestTrainingSample[] {
    const samples: OneVsRestTrainingSample[] = Array.from({ length: count }, (_, i) => ({
      raw_home: 0.3 + i * 0.02,
      raw_draw: 0.25,
      raw_away: 0.45 - i * 0.02,
      actual_outcome: (['HOME', 'DRAW', 'AWAY'] as const)[i % 3]!,
      match_timestamp_ms: KICKOFF_UTC - (count - i) * ONE_DAY_MS,
      match_id: `ovr-sample-${i}`,
    }));

    if (options.includeFuture) {
      samples.push({
        raw_home: 0.5,
        raw_draw: 0.25,
        raw_away: 0.25,
        actual_outcome: 'HOME',
        match_timestamp_ms: KICKOFF_UTC + ONE_DAY_MS,
        match_id: 'future-ovr-sample',
      });
    }

    return samples;
  }

  it('throws TemporalLeakageError when any OVR sample has future timestamp', () => {
    const samples = mkOvrSamples(10, { includeFuture: true });
    expect(() => {
      fitOneVsRestCalibrators(samples, KICKOFF_UTC);
    }).toThrow(TemporalLeakageError);
  });

  it('succeeds when all OVR samples are before cutoff', () => {
    const samples = mkOvrSamples(10);
    expect(() => {
      fitOneVsRestCalibrators(samples, KICKOFF_UTC);
    }).not.toThrow();
  });

  it('cutoff set to match kickoff date rejects future samples', () => {
    // §17.3: "prediction_cutoff_ms" is the match kickoff date in this context
    const kickoff = new Date('2025-06-15T15:00:00Z').getTime();
    const samples: OneVsRestTrainingSample[] = [
      {
        raw_home: 0.45,
        raw_draw: 0.3,
        raw_away: 0.25,
        actual_outcome: 'HOME',
        match_timestamp_ms: kickoff - ONE_DAY_MS, // day before — safe
        match_id: 'before-kickoff',
      },
      {
        raw_home: 0.4,
        raw_draw: 0.35,
        raw_away: 0.25,
        actual_outcome: 'DRAW',
        match_timestamp_ms: kickoff + ONE_DAY_MS, // after kickoff — leakage
        match_id: 'after-kickoff',
      },
    ];
    expect(() => {
      fitOneVsRestCalibrators(samples, kickoff);
    }).toThrow(TemporalLeakageError);
  });
});

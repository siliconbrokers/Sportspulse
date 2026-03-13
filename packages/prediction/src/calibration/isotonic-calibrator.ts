/**
 * IsotonicCalibrator — isotonic regression one-vs-rest calibration.
 *
 * Spec authority: §17.1 (Método obligatorio v1), §17.2 (Segmentación),
 *                 §17.3 (Corte temporal), §16.2 (Outputs visibles 1X2),
 *                 §16.3 (Renormalización)
 *
 * Design decisions:
 * - One IsotonicCalibrator instance is trained per class (HOME, DRAW, AWAY).
 * - Training uses the pool-adjacent violators (PAVA) algorithm, which is the
 *   standard isotonic regression (non-decreasing constraint).
 * - After per-class calibration, outputs are renormalized so they sum to 1.
 * - Identity mode is provided for bootstrapping (no training data available).
 * - Temporal guard enforces §17.3: no training point may have a timestamp
 *   after the prediction_cutoff timestamp.
 *
 * SPEC_NOTE §17.3: "La calibración debe entrenarse solo con datos anteriores
 * al bloque de validación / inferencia." Enforced via TemporalLeakageError.
 */

import { EPSILON_PROBABILITY } from '../contracts/constants.js';

// ── Error types ────────────────────────────────────────────────────────────

/**
 * Thrown when a training data point has a timestamp after prediction_cutoff.
 * This enforces the anti-leakage invariant from §17.3.
 */
export class TemporalLeakageError extends Error {
  constructor(
    public readonly matchId: string,
    public readonly matchTimestamp: number,
    public readonly predictionCutoff: number,
  ) {
    super(
      `TemporalLeakageError: match ${matchId} has timestamp ${matchTimestamp} ` +
        `which is after prediction_cutoff ${predictionCutoff}. §17.3 violation.`,
    );
    this.name = 'TemporalLeakageError';
  }
}

// ── Training data types ────────────────────────────────────────────────────

/**
 * A single training sample for calibration.
 * - raw_prob: the raw (uncalibrated) probability for the target class
 * - outcome: 1 if the target class was the actual outcome, 0 otherwise
 * - match_timestamp_ms: Unix epoch milliseconds for the match (for leakage guard)
 * - match_id: for error reporting
 */
export interface CalibrationSample {
  readonly raw_prob: number;
  readonly outcome: 0 | 1;
  readonly match_timestamp_ms: number;
  readonly match_id: string;
}

// ── PAVA (Pool Adjacent Violators Algorithm) ───────────────────────────────

/**
 * Runs isotonic regression on (x, y) pairs assuming non-decreasing order.
 *
 * Input: arrays of (x, y) sorted by x ascending.
 * Output: isotonic-fitted y values — same length, non-decreasing, averaged
 * within blocks that violate monotonicity.
 *
 * This is the standard PAVA algorithm. It guarantees the output is
 * monotone non-decreasing, which is the required property for calibration
 * (higher raw probability should map to higher calibrated probability).
 *
 * Spec: §17.1 "Isotonic calibration one-vs-rest".
 */
function pava(y: number[]): number[] {
  const n = y.length;
  if (n === 0) return [];
  if (n === 1) return [y[0]!];

  // Each block: { sum, count, value = sum/count }
  interface Block {
    sum: number;
    count: number;
  }

  const blocks: Block[] = [];

  for (let i = 0; i < n; i++) {
    blocks.push({ sum: y[i]!, count: 1 });

    // Pool adjacent violators: merge last two blocks while non-decreasing
    // invariant is violated
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1]!;
      const prev = blocks[blocks.length - 2]!;
      if (prev.sum / prev.count > last.sum / last.count) {
        // Merge
        prev.sum += last.sum;
        prev.count += last.count;
        blocks.pop();
      } else {
        break;
      }
    }
  }

  // Expand blocks back to per-sample values
  const result: number[] = [];
  for (const block of blocks) {
    const val = block.sum / block.count;
    for (let k = 0; k < block.count; k++) {
      result.push(val);
    }
  }

  return result;
}

// ── Serialization types ───────────────────────────────────────────────────

export interface SerializedIsotonicCalibrator {
  is_identity: boolean;
  x_breakpoints: number[];
  y_fitted: number[];
}

export interface SerializedOneVsRestCalibrators {
  home: SerializedIsotonicCalibrator;
  draw: SerializedIsotonicCalibrator;
  away: SerializedIsotonicCalibrator;
}

// ── IsotonicCalibrator ─────────────────────────────────────────────────────

/**
 * Isotonic calibrator for a single class (one-vs-rest).
 *
 * Stores (x_sorted, y_fitted) lookup table after fitting.
 * Prediction uses linear interpolation between the nearest breakpoints.
 *
 * Spec §17.1: "Isotonic calibration one-vs-rest por clase (HOME, DRAW, AWAY)"
 */
export class IsotonicCalibrator {
  /** Sorted raw probability breakpoints after fitting. */
  private xBreakpoints: number[] = [];
  /** Fitted isotonic values at each breakpoint. */
  private yFitted: number[] = [];
  /** Whether this calibrator is the identity (bootstrapping mode). */
  public readonly is_identity_calibration: boolean;

  private constructor(isIdentity: boolean) {
    this.is_identity_calibration = isIdentity;
  }

  /**
   * Create an identity calibrator for bootstrapping.
   * Output equals input — no calibration applied.
   * Flag `is_identity_calibration = true`.
   *
   * Spec: bootstrapping mode when no historical data is available.
   */
  static createIdentity(): IsotonicCalibrator {
    return new IsotonicCalibrator(true);
  }

  /**
   * Fit an isotonic calibrator from training samples.
   *
   * Enforces temporal guard: if any sample has match_timestamp_ms >
   * prediction_cutoff_ms, throws TemporalLeakageError. §17.3
   *
   * @param samples Training samples (raw_prob, outcome pairs)
   * @param prediction_cutoff_ms Unix ms — no sample timestamp may exceed this
   */
  static fit(
    samples: readonly CalibrationSample[],
    prediction_cutoff_ms: number,
  ): IsotonicCalibrator {
    // ── Temporal leakage guard (§17.3) ────────────────────────────────────
    for (const s of samples) {
      if (s.match_timestamp_ms > prediction_cutoff_ms) {
        throw new TemporalLeakageError(s.match_id, s.match_timestamp_ms, prediction_cutoff_ms);
      }
    }

    if (samples.length === 0) {
      return IsotonicCalibrator.createIdentity();
    }

    // Sort by raw_prob ascending
    const sorted = [...samples].sort((a, b) => a.raw_prob - b.raw_prob);

    const x = sorted.map((s) => s.raw_prob);
    const y = sorted.map((s) => s.outcome as number);

    // Run PAVA on the y values (outcomes) sorted by x
    const yIso = pava(y);

    const cal = new IsotonicCalibrator(false);
    cal.xBreakpoints = x;
    cal.yFitted = yIso;

    return cal;
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /** Serialized form for disk persistence. */
  serialize(): SerializedIsotonicCalibrator {
    return {
      is_identity: this.is_identity_calibration,
      x_breakpoints: this.xBreakpoints,
      y_fitted: this.yFitted,
    };
  }

  /** Reconstruct a calibrator from its serialized form. */
  static fromSerialized(data: SerializedIsotonicCalibrator): IsotonicCalibrator {
    const cal = new IsotonicCalibrator(data.is_identity);
    cal.xBreakpoints = data.x_breakpoints;
    cal.yFitted = data.y_fitted;
    return cal;
  }

  /**
   * Predict calibrated probability for a raw probability value.
   *
   * Uses linear interpolation between the nearest breakpoints.
   * Clamps output to [0, 1].
   *
   * For identity calibrator: returns raw_prob unchanged.
   */
  predict(raw_prob: number): number {
    if (this.is_identity_calibration) {
      return Math.max(0, Math.min(1, raw_prob));
    }

    const x = this.xBreakpoints;
    const y = this.yFitted;

    if (x.length === 0) {
      return Math.max(0, Math.min(1, raw_prob));
    }

    // Below first breakpoint: return first fitted value
    if (raw_prob <= x[0]!) return Math.max(0, Math.min(1, y[0]!));
    // Above last breakpoint: return last fitted value
    if (raw_prob >= x[x.length - 1]!) return Math.max(0, Math.min(1, y[y.length - 1]!));

    // Binary search for surrounding breakpoints
    let lo = 0;
    let hi = x.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (x[mid]! <= raw_prob) lo = mid;
      else hi = mid;
    }

    // Linear interpolation
    const x0 = x[lo]!;
    const x1 = x[hi]!;
    const y0 = y[lo]!;
    const y1 = y[hi]!;

    const t = x1 - x0 < EPSILON_PROBABILITY ? 0 : (raw_prob - x0) / (x1 - x0);
    const result = y0 + t * (y1 - y0);

    return Math.max(0, Math.min(1, result));
  }
}

// ── One-vs-rest calibration set ────────────────────────────────────────────

/**
 * Triple of per-class isotonic calibrators (one-vs-rest for 1X2).
 */
export interface OneVsRestCalibrators {
  readonly home: IsotonicCalibrator;
  readonly draw: IsotonicCalibrator;
  readonly away: IsotonicCalibrator;
}

/**
 * Training samples for one-vs-rest calibration.
 * Each sample carries raw probabilities for all three classes and the
 * actual outcome.
 */
export interface OneVsRestTrainingSample {
  readonly raw_home: number;
  readonly raw_draw: number;
  readonly raw_away: number;
  /** Actual outcome of the match. */
  readonly actual_outcome: 'HOME' | 'DRAW' | 'AWAY';
  readonly match_timestamp_ms: number;
  readonly match_id: string;
}

/**
 * Fit a one-vs-rest isotonic calibrator set from training samples.
 *
 * Creates three separate CalibrationSample arrays, one per class, with
 * binary outcomes. Temporal guard is applied in each IsotonicCalibrator.fit().
 *
 * Spec §17.1: "Isotonic calibration one-vs-rest por clase (HOME, DRAW, AWAY)"
 *
 * @param samples Training data
 * @param prediction_cutoff_ms Hard cut-off for temporal leakage guard
 */
export function fitOneVsRestCalibrators(
  samples: readonly OneVsRestTrainingSample[],
  prediction_cutoff_ms: number,
): OneVsRestCalibrators {
  const homeSamples: CalibrationSample[] = samples.map((s) => ({
    raw_prob: s.raw_home,
    outcome: s.actual_outcome === 'HOME' ? 1 : 0,
    match_timestamp_ms: s.match_timestamp_ms,
    match_id: s.match_id,
  }));

  const drawSamples: CalibrationSample[] = samples.map((s) => ({
    raw_prob: s.raw_draw,
    outcome: s.actual_outcome === 'DRAW' ? 1 : 0,
    match_timestamp_ms: s.match_timestamp_ms,
    match_id: s.match_id,
  }));

  const awaySamples: CalibrationSample[] = samples.map((s) => ({
    raw_prob: s.raw_away,
    outcome: s.actual_outcome === 'AWAY' ? 1 : 0,
    match_timestamp_ms: s.match_timestamp_ms,
    match_id: s.match_id,
  }));

  return {
    home: IsotonicCalibrator.fit(homeSamples, prediction_cutoff_ms),
    draw: IsotonicCalibrator.fit(drawSamples, prediction_cutoff_ms),
    away: IsotonicCalibrator.fit(awaySamples, prediction_cutoff_ms),
  };
}

/**
 * Apply one-vs-rest calibration to raw 1X2 probabilities.
 *
 * Steps per §17.1:
 * 1. Apply each class calibrator to its respective raw probability.
 * 2. Renormalize so the three values sum to 1. §16.3
 *
 * Returns a plain object with { home, draw, away } — caller is responsible
 * for wrapping in the Calibrated1x2Probs branded type.
 */
export function applyOneVsRestCalibration(
  raw_home: number,
  raw_draw: number,
  raw_away: number,
  calibrators: OneVsRestCalibrators,
): { home: number; draw: number; away: number } {
  const cal_home = calibrators.home.predict(raw_home);
  const cal_draw = calibrators.draw.predict(raw_draw);
  const cal_away = calibrators.away.predict(raw_away);

  // Renormalize (§16.3)
  const total = cal_home + cal_draw + cal_away;

  // Guard against degenerate case (should not occur with valid probabilities)
  if (total <= EPSILON_PROBABILITY) {
    // Uniform fallback — each class gets equal weight
    return {
      home: 1 / 3,
      draw: 1 / 3,
      away: 1 / 3,
    };
  }

  return {
    home: cal_home / total,
    draw: cal_draw / total,
    away: cal_away / total,
  };
}

// ── One-vs-rest serialization helpers ─────────────────────────────────────

/** Serialize a fitted OneVsRestCalibrators set to a plain object for disk storage. */
export function serializeOneVsRestCalibrators(
  calibrators: OneVsRestCalibrators,
): SerializedOneVsRestCalibrators {
  return {
    home: calibrators.home.serialize(),
    draw: calibrators.draw.serialize(),
    away: calibrators.away.serialize(),
  };
}

/** Reconstruct OneVsRestCalibrators from its serialized form. */
export function deserializeOneVsRestCalibrators(
  data: SerializedOneVsRestCalibrators,
): OneVsRestCalibrators {
  return {
    home: IsotonicCalibrator.fromSerialized(data.home),
    draw: IsotonicCalibrator.fromSerialized(data.draw),
    away: IsotonicCalibrator.fromSerialized(data.away),
  };
}

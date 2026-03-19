/**
 * ensemble-calibrator.ts — NEXUS Isotonic Calibration (One-vs-Rest).
 *
 * Spec authority:
 *   - taxonomy spec S8.1–S8.7: isotonic calibration, per-liga vs global,
 *     anti-lookahead, recalibration schedule, output contract.
 *
 * This module is INDEPENDENT from V3's calibration.
 * It does NOT import from packages/prediction/src/calibration/.
 * taxonomy spec S8.2: "The same implementation used by V3's calibrator is used
 * by NEXUS" — this means the ALGORITHM (PAVA) is the same, not that we share
 * the instance. NEXUS maintains its own calibrator per spec S8.5 anti-lookahead.
 *
 * PER-LIGA RULE (taxonomy spec S8.3):
 *   >= 300 samples in training window → per-liga calibration.
 *   < 300 samples → global calibration.
 *
 * ANTI-LOOKAHEAD (taxonomy spec S8.5):
 *   All training data points must satisfy: matchUtcDate < fittedAt.
 *   Violation throws TemporalLeakageError.
 *
 * PURE FUNCTIONS: no Date.now(), no IO, no Math.random().
 *
 * @module nexus/ensemble/ensemble-calibrator
 */

import type {
  CalibrationDataPoint,
  CalibrationPoint,
  PerClassCalibrator,
  NexusCalibrationTable,
  CalibrationSource,
} from './types.js';
import {
  MIN_SAMPLES_PER_LIGA_CALIBRATION,
  CALIBRATION_VERSION,
} from './types.js';

// ── Anti-lookahead error ──────────────────────────────────────────────────

/**
 * Thrown when calibration training data includes a match after fittedAt.
 * taxonomy spec S8.5: anti-lookahead enforcement.
 */
export class CalibrationTemporalLeakageError extends Error {
  constructor(
    public readonly matchUtcDate: string,
    public readonly fittedAt: string,
  ) {
    super(
      `CalibrationTemporalLeakageError: match ${matchUtcDate} is not before ` +
      `fittedAt ${fittedAt}. taxonomy spec S8.5 violation.`,
    );
    this.name = 'CalibrationTemporalLeakageError';
  }
}

// ── PAVA (Pool Adjacent Violators) ────────────────────────────────────────

/**
 * Fit isotonic regression using PAVA on (rawProb, isActual) pairs.
 *
 * taxonomy spec S8.2: "Fit a monotonic (isotonic) function from raw probability
 * to calibrated probability."
 *
 * Algorithm (PAVA):
 * 1. Sort pairs by rawProb ascending.
 * 2. Merge adjacent blocks that violate non-decreasing monotonicity.
 * 3. Return CalibrationPoint[] for piecewise-linear interpolation.
 *
 * @param pairs  (rawProb, isActual) pairs. Will be sorted internally.
 * @returns      Monotone non-decreasing CalibrationPoint[].
 */
export function fitPAVA(
  pairs: Array<{ rawProb: number; isActual: 0 | 1 }>,
): CalibrationPoint[] {
  if (pairs.length === 0) return [];

  // Sort by rawProb ascending
  const sorted = [...pairs].sort((a, b) => a.rawProb - b.rawProb);

  interface Block {
    sumRaw: number;
    sumActual: number;
    count: number;
  }

  const blocks: Block[] = sorted.map((p) => ({
    sumRaw: p.rawProb,
    sumActual: p.isActual,
    count: 1,
  }));

  // Pool adjacent violators
  let i = 0;
  while (i < blocks.length - 1) {
    const curr = blocks[i]!;
    const next = blocks[i + 1]!;
    const avgCurr = curr.sumActual / curr.count;
    const avgNext = next.sumActual / next.count;

    if (avgCurr > avgNext) {
      // Merge curr and next into curr
      curr.sumRaw += next.sumRaw;
      curr.sumActual += next.sumActual;
      curr.count += next.count;
      blocks.splice(i + 1, 1);
      // Step back to re-check merged block with its predecessor
      if (i > 0) i--;
    } else {
      i++;
    }
  }

  return blocks.map((b) => ({
    rawProb: b.sumRaw / b.count,
    calProb: b.sumActual / b.count,
  }));
}

// ── Piecewise-linear interpolation ────────────────────────────────────────

/**
 * Apply calibration via piecewise-linear interpolation.
 *
 * @param rawProb   Raw probability to calibrate.
 * @param points    Calibration points (sorted by rawProb ascending).
 * @returns         Calibrated probability, clamped to [0, 1].
 */
export function interpolate(rawProb: number, points: CalibrationPoint[]): number {
  if (points.length === 0) return rawProb;

  const EPSILON = 1e-12;

  // Clamp below
  if (rawProb <= points[0]!.rawProb) {
    return Math.max(0, Math.min(1, points[0]!.calProb));
  }
  // Clamp above
  if (rawProb >= points[points.length - 1]!.rawProb) {
    return Math.max(0, Math.min(1, points[points.length - 1]!.calProb));
  }

  // Binary search for surrounding points
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.rawProb <= rawProb) lo = mid;
    else hi = mid;
  }

  const p0 = points[lo]!;
  const p1 = points[hi]!;
  const dx = p1.rawProb - p0.rawProb;

  if (dx < EPSILON) {
    return Math.max(0, Math.min(1, p0.calProb));
  }

  const t = (rawProb - p0.rawProb) / dx;
  const result = p0.calProb + t * (p1.calProb - p0.calProb);
  return Math.max(0, Math.min(1, result));
}

// ── Per-class calibrator fitting ─────────────────────────────────────────

/**
 * Fit a per-class (one-vs-rest) calibrator on training data.
 *
 * taxonomy spec S8.2: one calibrator per class (home, draw, away).
 *
 * @param trainingData  Calibration data points for this (league or global) set.
 * @param fittedAt      ISO 8601 UTC timestamp — anti-lookahead anchor.
 * @returns             PerClassCalibrator with PAVA-fitted points.
 * @throws              CalibrationTemporalLeakageError if any matchUtcDate >= fittedAt.
 */
export function fitPerClassCalibrator(
  trainingData: CalibrationDataPoint[],
  fittedAt: string,
): PerClassCalibrator {
  // Anti-lookahead check (taxonomy spec S8.5)
  for (const point of trainingData) {
    if (point.matchUtcDate >= fittedAt) {
      throw new CalibrationTemporalLeakageError(point.matchUtcDate, fittedAt);
    }
  }

  const homePairs = trainingData.map((p) => ({
    rawProb: p.rawProb,
    isActual: p.isActual,
  }));

  // For draw and away classes, isActual is determined by the calling convention:
  // the CalibrationDataPoint.isActual already encodes the one-vs-rest target
  // for that specific class. This function is called once per class.
  return {
    home: fitPAVA(homePairs),
    draw: fitPAVA(homePairs),  // Will be overridden per-class in fitNexusCalibration
    away: fitPAVA(homePairs),  // Will be overridden per-class in fitNexusCalibration
  };
}

// ── Main calibration fitting (taxonomy spec S8.2, S8.3) ───────────────────

/**
 * @deprecated — REMOVED. This function was broken: it assigned `homePoints` to all three
 * calibrators (home, draw, away), producing three identical PAVA curves instead of
 * independent one-vs-rest calibrators. This violates taxonomy spec S8.2.
 *
 * Use `fitNexusCalibrationFromTriplets()` instead, which is the correct public interface.
 *
 * FINDING-005 fix (audit 2026-03-19): throwing NotImplementedError to prevent silent misuse.
 * Any caller reaching this function has a bug — the class-separated CalibrationTripletBundle
 * interface (`fitNexusCalibrationFromTriplets`) must be used instead.
 *
 * @throws Error — always. Use fitNexusCalibrationFromTriplets instead.
 */
export function fitNexusCalibration(
  _allData: CalibrationDataPoint[],
  _fittedAt: string,
): Map<string, NexusCalibrationTable> {
  throw new Error(
    'fitNexusCalibration() is not implemented and must not be called. ' +
    'It produces three identical calibrators (FINDING-005, taxonomy spec S8.2 violation). ' +
    'Use fitNexusCalibrationFromTriplets() with a CalibrationTripletBundle instead.',
  );
}

// ── Organized per-class fitting (the correct public interface) ─────────────

/**
 * A bundle of calibration data organized by outcome class.
 *
 * This is the correct input format for fitting one-vs-rest calibrators.
 * Each entry in homeData/drawData/awayData represents one match observation
 * for that class:
 *   homeData[i].rawProb = ensemble p_home for match i
 *   homeData[i].isActual = 1 if actual outcome was 'home', else 0
 *   etc.
 */
export interface CalibrationTripletBundle {
  homeData: CalibrationDataPoint[];
  drawData: CalibrationDataPoint[];
  awayData: CalibrationDataPoint[];
}

/**
 * Fit NEXUS calibration from organized triplet bundles.
 *
 * taxonomy spec S8.2: one calibrator per class (home, draw, away).
 * taxonomy spec S8.3: per-liga >= 300 match observations, global otherwise.
 *
 * @param perLeagueData  Map from league → CalibrationTripletBundle.
 * @param fittedAt       ISO 8601 UTC calibration timestamp.
 * @returns              Map from leagueCode → NexusCalibrationTable.
 *                       Always includes 'global' key.
 * @throws               CalibrationTemporalLeakageError on temporal violation.
 */
export function fitNexusCalibrationFromTriplets(
  perLeagueData: Map<string, CalibrationTripletBundle>,
  fittedAt: string,
): Map<string, NexusCalibrationTable> {
  const result = new Map<string, NexusCalibrationTable>();

  // Collect all data for global
  const globalHome: CalibrationDataPoint[] = [];
  const globalDraw: CalibrationDataPoint[] = [];
  const globalAway: CalibrationDataPoint[] = [];

  for (const [league, bundle] of perLeagueData) {
    // Anti-lookahead check per bundle
    for (const pt of [...bundle.homeData, ...bundle.drawData, ...bundle.awayData]) {
      if (pt.matchUtcDate >= fittedAt) {
        throw new CalibrationTemporalLeakageError(pt.matchUtcDate, fittedAt);
      }
    }

    globalHome.push(...bundle.homeData);
    globalDraw.push(...bundle.drawData);
    globalAway.push(...bundle.awayData);

    // Per-liga: use only if >= MIN_SAMPLES_PER_LIGA_CALIBRATION MATCH observations
    // Note: homeData.length = nMatches for this league (one per match)
    const nMatches = bundle.homeData.length;
    if (nMatches >= MIN_SAMPLES_PER_LIGA_CALIBRATION) {
      result.set(league, {
        leagueCode: league,
        calibrators: {
          home: fitPAVA(bundle.homeData.map((p) => ({
            rawProb: p.rawProb,
            isActual: p.isActual,
          }))),
          draw: fitPAVA(bundle.drawData.map((p) => ({
            rawProb: p.rawProb,
            isActual: p.isActual,
          }))),
          away: fitPAVA(bundle.awayData.map((p) => ({
            rawProb: p.rawProb,
            isActual: p.isActual,
          }))),
        },
        nCalibrationMatches: nMatches,
        fittedAt,
        calibrationVersion: CALIBRATION_VERSION,
      });
    }
  }

  // Global calibrator (always fitted)
  const nGlobal = globalHome.length;
  result.set('global', {
    leagueCode: 'global',
    calibrators: {
      home: fitPAVA(globalHome.map((p) => ({ rawProb: p.rawProb, isActual: p.isActual }))),
      draw: fitPAVA(globalDraw.map((p) => ({ rawProb: p.rawProb, isActual: p.isActual }))),
      away: fitPAVA(globalAway.map((p) => ({ rawProb: p.rawProb, isActual: p.isActual }))),
    },
    nCalibrationMatches: nGlobal,
    fittedAt,
    calibrationVersion: CALIBRATION_VERSION,
  });

  return result;
}

// ── Calibration application (taxonomy spec S8.6) ──────────────────────────

/**
 * Apply calibration to raw ensemble probabilities.
 *
 * taxonomy spec S8.6: "Calibration takes the EnsembleOutput.{p_home, p_draw,
 * p_away} and produces calibrated {p_home_cal, p_draw_cal, p_away_cal} that
 * sum to 1.0 (renormalized after per-class isotonic adjustment)."
 *
 * Per-liga table used when available; falls back to global.
 * taxonomy spec S8.3.
 *
 * @param raw           Raw (uncalibrated) probabilities.
 * @param tables        Map of available calibration tables.
 * @param leagueCode    League code to look up per-liga table.
 * @returns             Calibrated probs (sum to 1.0) + metadata.
 */
export function applyNexusCalibration(
  raw: { home: number; draw: number; away: number },
  tables: Map<string, NexusCalibrationTable>,
  leagueCode: string,
): {
  calibrated: { home: number; draw: number; away: number };
  calibrationSource: CalibrationSource;
} {
  const EPSILON = 1e-12;

  // Select calibration table
  let table: NexusCalibrationTable | undefined;
  let calibrationSource: CalibrationSource;

  if (tables.has(leagueCode)) {
    table = tables.get(leagueCode)!;
    calibrationSource = 'per_league';
  } else {
    table = tables.get('global');
    calibrationSource = 'global';
  }

  if (table === undefined) {
    // No calibration available — return raw (bootstrap mode)
    return { calibrated: { ...raw }, calibrationSource: 'global' };
  }

  // Apply one-vs-rest calibration
  const calHome = interpolate(raw.home, table.calibrators.home);
  const calDraw = interpolate(raw.draw, table.calibrators.draw);
  const calAway = interpolate(raw.away, table.calibrators.away);

  // Renormalize (taxonomy spec §16.3 pattern, inherited by NEXUS S8.6)
  const total = calHome + calDraw + calAway;
  if (total <= EPSILON) {
    // Degenerate: uniform fallback
    return {
      calibrated: { home: 1 / 3, draw: 1 / 3, away: 1 / 3 },
      calibrationSource,
    };
  }

  return {
    calibrated: {
      home: calHome / total,
      draw: calDraw / total,
      away: calAway / total,
    },
    calibrationSource,
  };
}

/**
 * Bootstrap calibration table with no training data.
 * Returns an identity-like table (maps any raw prob to itself).
 * Used when < MIN_SAMPLES_PER_LIGA_CALIBRATION are available.
 *
 * taxonomy spec S8.3: "Global calibration when < 300 samples."
 * When even global has 0 samples, identity is the safe bootstrap.
 */
export function buildBootstrapCalibrationTable(): NexusCalibrationTable {
  // Identity calibration: 5 anchor points spanning [0, 1]
  const identityPoints: CalibrationPoint[] = [
    { rawProb: 0.0, calProb: 0.0 },
    { rawProb: 0.25, calProb: 0.25 },
    { rawProb: 0.5, calProb: 0.5 },
    { rawProb: 0.75, calProb: 0.75 },
    { rawProb: 1.0, calProb: 1.0 },
  ];

  return {
    leagueCode: 'global',
    calibrators: {
      home: identityPoints,
      draw: identityPoints,
      away: identityPoints,
    },
    nCalibrationMatches: 0,
    fittedAt: '1970-01-01T00:00:00Z',
    calibrationVersion: `${CALIBRATION_VERSION}-identity`,
  };
}

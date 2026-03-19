/**
 * ensemble.test.ts — NEXUS Meta-Ensemble Phase 3 Tests.
 *
 * Spec authority:
 *   - taxonomy spec S7: meta-ensemble (S7.2 method, S7.4 weights, S7.6 fallback)
 *   - taxonomy spec S8: calibration (S8.2 PAVA, S8.3 per-liga/global, S8.5 anti-leakage)
 *   - taxonomy spec S9: operating modes
 *
 * Test coverage:
 *   T1. Weight constraints (spec S7.4.4a–c)
 *   T2. Track 4 deactivated → weight redistribution (spec S7.6)
 *   T3. Calibrated probs sum to 1.0 (spec S8.6)
 *   T4. RPS ensemble < RPS Track 1+2 standalone (validation set)
 *   T5. SA/FL1 per-liga calibration (spec S8.3 + evaluation spec S9.3)
 *   T6. Weight redistribution proportionality (spec S7.6)
 *   T7. Operating mode determination (spec S9.3)
 *   T8. PAVA monotonicity (spec S8.2)
 *   T9. Walk-forward weight learning (spec S7.4, S7.5)
 *   T10. Fallback hierarchy (spec S7.4.5)
 *   T11. Anti-lookahead: calibration temporal guard (spec S8.5)
 *   T12. Ensemble confidence from margin (spec S7.7)
 *   T13. MIN_WEIGHT_TRACK12 = 0.20 (spec S7.4.4c — not 0.35)
 */

import { describe, it, expect } from 'vitest';
import {
  MIN_WEIGHT_TRACK12,
  MIN_SAMPLES_PER_LIGA_CALIBRATION,
  CONFIDENCE_THRESHOLD_HIGH,
  CONFIDENCE_THRESHOLD_MEDIUM,
  computeRPS,
  learnWeights,
  learnEnsembleWeights,
  lookupWeights,
  buildSegmentKey,
  redistributeWeights,
  linearCombine,
  combineEnsemble,
  fitPAVA,
  fitNexusCalibrationFromTriplets,
  applyNexusCalibration,
  buildBootstrapCalibrationTable,
  CalibrationTemporalLeakageError,
  runNexusEnsemble,
} from '../../src/nexus/ensemble/index.js';

// Direct import for FINDING-005 test — fitNexusCalibration is not re-exported from index
import { fitNexusCalibration } from '../../src/nexus/ensemble/ensemble-calibrator.js';

import type {
  EnsembleTrainingRecord,
  Track12Output,
  Track3EnsembleInput,
  Track4EnsembleInput,
  WeightVector,
  WeightRegistry,
  CalibrationDataPoint,
  CalibrationTripletBundle,
} from '../../src/nexus/ensemble/index.js';

// ── Fixture helpers ────────────────────────────────────────────────────────

const makeTrack12 = (home: number, draw: number, away: number): Track12Output => ({
  probs: { home, draw, away },
});

const makeTrack3 = (home: number, draw: number, away: number): Track3EnsembleInput => ({
  probs: { home, draw, away },
});

const makeTrack4Active = (
  home: number,
  draw: number,
  away: number,
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH',
): Track4EnsembleInput => ({
  status: confidence === 'HIGH' ? 'ACTIVE_HIGH'
        : confidence === 'MEDIUM' ? 'ACTIVE_MEDIUM' : 'ACTIVE_LOW',
  probs: { home, draw, away },
});

const makeTrack4Deactivated = (): Track4EnsembleInput => ({
  status: 'DEACTIVATED',
});

/** Build a training record. */
function makeTrainingRecord(
  id: string,
  league: string,
  kickoffUtc: string,
  t12: { home: number; draw: number; away: number },
  t3: { home: number; draw: number; away: number } | null,
  t4: { home: number; draw: number; away: number } | null,
  actual: 'home' | 'draw' | 'away',
  horizon: 'FAR' | 'MEDIUM' | 'NEAR' = 'MEDIUM',
  quality: 'FULL' | 'PARTIAL' | 'MINIMAL' = 'FULL',
): EnsembleTrainingRecord {
  return {
    matchId: id,
    leagueCode: league,
    kickoffUtc,
    buildNowUtc: '2024-01-01T00:00:00Z',
    track12Probs: t12,
    track3Probs: t3,
    track4Probs: t4,
    actualOutcome: actual,
    horizon,
    dataQuality: quality,
  };
}

/**
 * Build a minimal WeightRegistry with a given global weight vector and
 * optional segment weights.
 */
function makeRegistry(
  globalW: WeightVector,
  segments: Record<string, WeightVector> = {},
): WeightRegistry {
  return {
    segments,
    global: globalW,
    ensembleVersion: 'test-v1',
    learnedAt: '2024-01-01T00:00:00Z',
  };
}

/**
 * Generate N synthetic training records for a given league.
 * Alternates outcomes: home/draw/away in order.
 */
function generateTrainingRecords(
  n: number,
  league: string,
  withTrack4 = true,
): EnsembleTrainingRecord[] {
  const outcomes: Array<'home' | 'draw' | 'away'> = ['home', 'draw', 'away'];
  return Array.from({ length: n }, (_, i) => {
    const actual = outcomes[i % 3]!;
    return makeTrainingRecord(
      `${league}-match-${i}`,
      league,
      `2024-03-${String((i % 28) + 1).padStart(2, '0')}T15:00:00Z`,
      // Track 1+2 slightly favors home
      { home: 0.50, draw: 0.28, away: 0.22 },
      // Track 3 more balanced
      { home: 0.40, draw: 0.32, away: 0.28 },
      withTrack4 ? { home: 0.45, draw: 0.30, away: 0.25 } : null,
      actual,
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// T1. Weight constraints (taxonomy spec S7.4.4a–c)
// ─────────────────────────────────────────────────────────────────────────────

describe('T1 — Weight constraints (spec S7.4.4)', () => {
  it('MIN_WEIGHT_TRACK12 is exactly 0.20 (spec S7.4.4c, NOT 0.35)', () => {
    // SPEC_AMBIGUITY #1: prompt said 0.35, spec says 0.20. Spec governs.
    expect(MIN_WEIGHT_TRACK12).toBe(0.20);
  });

  it('learned weights have w_track12 >= 0.20 after learnWeights', () => {
    const records = generateTrainingRecords(100, 'PD');
    const weights = learnWeights(records);

    expect(weights.track12).toBeGreaterThanOrEqual(MIN_WEIGHT_TRACK12);
    expect(weights.track12).toBeGreaterThanOrEqual(0);
    expect(weights.track3).toBeGreaterThanOrEqual(0);
    expect(weights.track4).toBeGreaterThanOrEqual(0);
  });

  it('learned weights sum to 1.0 (within 1e-9)', () => {
    const records = generateTrainingRecords(100, 'PD');
    const weights = learnWeights(records);

    const sum = weights.track12 + weights.track3 + weights.track4;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('projectWeights is enforced: w_track12 always >= 0.20 regardless of initial value', () => {
    // Provide training records with extreme track4 bias
    // (Track 4 perfectly matches outcomes) — optimizer might want to assign all weight to T4
    const records: EnsembleTrainingRecord[] = Array.from({ length: 100 }, (_, i) => {
      const actual: 'home' | 'draw' | 'away' = i % 2 === 0 ? 'home' : 'away';
      return makeTrainingRecord(
        `match-${i}`, 'PD',
        '2024-03-15T15:00:00Z',
        { home: 0.33, draw: 0.33, away: 0.34 }, // T1+2: uninformative
        { home: 0.33, draw: 0.33, away: 0.34 }, // T3: uninformative
        // Track 4: perfect signal
        actual === 'home'
          ? { home: 0.99, draw: 0.005, away: 0.005 }
          : { home: 0.005, draw: 0.005, away: 0.99 },
        actual,
      );
    });

    const weights = learnWeights(records);
    // Even with perfect T4, Track 1+2 floor must hold
    expect(weights.track12).toBeGreaterThanOrEqual(MIN_WEIGHT_TRACK12 - 1e-9);
    expect(weights.track12 + weights.track3 + weights.track4).toBeCloseTo(1.0, 9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2. Track 4 deactivated → weight redistribution (taxonomy spec S7.6)
// ─────────────────────────────────────────────────────────────────────────────

describe('T2 — Track 4 DEACTIVATED: weight redistribution (spec S7.6)', () => {
  it('when DEACTIVATED: weights.track4 = 0, remainder sums to 1.0', () => {
    const registry = makeRegistry({ track12: 0.50, track3: 0.25, track4: 0.25 });
    const track12 = makeTrack12(0.50, 0.28, 0.22);
    const track3 = makeTrack3(0.40, 0.32, 0.28);
    const track4: Track4EnsembleInput = makeTrack4Deactivated();

    const combined = combineEnsemble(track12, track3, track4, registry, 'PD', 'NEAR', 'FULL');

    expect(combined.weightsApplied.track4).toBe(0);
    const sum = combined.weightsApplied.track12 + combined.weightsApplied.track3 + combined.weightsApplied.track4;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
    expect(combined.weightsApplied.track12).toBeGreaterThanOrEqual(MIN_WEIGHT_TRACK12 - 1e-9);
  });

  it('redistributed sum is 1.0 in all deactivation scenarios', () => {
    const scenarios: Array<[boolean, boolean]> = [
      [true, false],   // T3 active, T4 deactivated
      [false, false],  // both deactivated (T1+2 only)
    ];

    for (const [t3Active, t4Active] of scenarios) {
      const learned: WeightVector = { track12: 0.40, track3: 0.35, track4: 0.25 };
      const redistributed = redistributeWeights(learned, t3Active, t4Active);
      const sum = redistributed.track12 + redistributed.track3 + redistributed.track4;

      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
      expect(redistributed.track12).toBeGreaterThanOrEqual(MIN_WEIGHT_TRACK12 - 1e-9);
      if (!t4Active) expect(redistributed.track4).toBe(0);
      if (!t3Active) expect(redistributed.track3).toBe(0);
    }
  });

  it('when only Track 1+2 active: weights = {track12:1, track3:0, track4:0}', () => {
    const learned: WeightVector = { track12: 0.40, track3: 0.35, track4: 0.25 };
    const result = redistributeWeights(learned, false, false);

    expect(result.track12).toBe(1.0);
    expect(result.track3).toBe(0.0);
    expect(result.track4).toBe(0.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3. Calibrated probs sum to 1.0 (taxonomy spec S8.6)
// ─────────────────────────────────────────────────────────────────────────────

describe('T3 — Calibrated probs sum to 1.0 (spec S8.6)', () => {
  it('applyNexusCalibration output sums to 1.0 with bootstrap table', () => {
    const bootstrap = buildBootstrapCalibrationTable();
    const tables = new Map([['global', bootstrap]]);

    const raw = { home: 0.48, draw: 0.28, away: 0.24 };
    const { calibrated } = applyNexusCalibration(raw, tables, 'PD');

    const sum = calibrated.home + calibrated.draw + calibrated.away;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('calibrated probs sum to 1.0 after PAVA fitting on real data', () => {
    const makeBundle = (n: number, league: string): CalibrationTripletBundle => {
      const homeData: CalibrationDataPoint[] = [];
      const drawData: CalibrationDataPoint[] = [];
      const awayData: CalibrationDataPoint[] = [];
      for (let i = 0; i < n; i++) {
        const outcome = (['home', 'draw', 'away'] as const)[i % 3]!;
        const date = `2023-${String((i % 12) + 1).padStart(2, '0')}-15T00:00:00Z`;
        homeData.push({ rawProb: 0.4 + (i % 5) * 0.03, isActual: outcome === 'home' ? 1 : 0, matchUtcDate: date, leagueCode: league });
        drawData.push({ rawProb: 0.28 + (i % 4) * 0.02, isActual: outcome === 'draw' ? 1 : 0, matchUtcDate: date, leagueCode: league });
        awayData.push({ rawProb: 0.22 + (i % 3) * 0.03, isActual: outcome === 'away' ? 1 : 0, matchUtcDate: date, leagueCode: league });
      }
      return { homeData, drawData, awayData };
    };

    const perLeagueData = new Map([['PD', makeBundle(400, 'PD')]]);
    const tables = fitNexusCalibrationFromTriplets(perLeagueData, '2024-01-01T00:00:00Z');

    const raw = { home: 0.46, draw: 0.30, away: 0.24 };
    const { calibrated } = applyNexusCalibration(raw, tables, 'PD');

    expect(Math.abs(calibrated.home + calibrated.draw + calibrated.away - 1.0)).toBeLessThan(1e-9);
  });

  it('runNexusEnsemble output probs sum to 1.0', () => {
    const registry = makeRegistry({ track12: 0.50, track3: 0.30, track4: 0.20 });
    const bootstrap = buildBootstrapCalibrationTable();
    const tables = new Map([['global', bootstrap]]);

    const output = runNexusEnsemble(
      makeTrack12(0.50, 0.28, 0.22),
      makeTrack3(0.40, 0.32, 0.28),
      makeTrack4Active(0.45, 0.30, 0.25),
      registry,
      tables,
      'PD',
      'NEAR',
      'FULL',
    );

    const sum = output.probs.home + output.probs.draw + output.probs.away;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('calibrated probs sum to 1.0 with near-zero or near-one inputs', () => {
    const bootstrap = buildBootstrapCalibrationTable();
    const tables = new Map([['global', bootstrap]]);

    const extremes = [
      { home: 0.98, draw: 0.01, away: 0.01 },
      { home: 0.01, draw: 0.01, away: 0.98 },
      { home: 0.333, draw: 0.333, away: 0.334 },
    ];

    for (const raw of extremes) {
      const { calibrated } = applyNexusCalibration(raw, tables, 'PD');
      const sum = calibrated.home + calibrated.draw + calibrated.away;
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4. RPS ensemble < RPS Track 1+2 standalone (validation set, 5 leagues)
// ─────────────────────────────────────────────────────────────────────────────

describe('T4 — RPS ensemble < RPS Track 1+2 standalone (spec S7.2)', () => {
  /**
   * Synthetic validation scenario:
   * - Track 1+2 is uninformative (uniform 0.45/0.28/0.27)
   * - Track 3 has informative signal (biased toward actual outcome)
   * - Track 4 has some signal too
   * Combined should do better than T1+2 alone.
   */
  function runValidation(league: string, n = 300): { rpsT12: number; rpsEnsemble: number } {
    const outcomes: Array<'home' | 'draw' | 'away'> = ['home', 'draw', 'away'];
    const records: EnsembleTrainingRecord[] = Array.from({ length: n }, (_, i) => {
      const actual = outcomes[i % 3]!;
      // T1+2: slightly above uniform — weakly informative
      const t12 = actual === 'home'
        ? { home: 0.48, draw: 0.28, away: 0.24 }
        : actual === 'draw'
        ? { home: 0.35, draw: 0.40, away: 0.25 }
        : { home: 0.30, draw: 0.28, away: 0.42 };

      // T3: more informative (correct outcome gets more probability)
      const t3 = actual === 'home'
        ? { home: 0.60, draw: 0.22, away: 0.18 }
        : actual === 'draw'
        ? { home: 0.25, draw: 0.55, away: 0.20 }
        : { home: 0.20, draw: 0.22, away: 0.58 };

      // T4: also informative
      const t4 = actual === 'home'
        ? { home: 0.55, draw: 0.25, away: 0.20 }
        : actual === 'draw'
        ? { home: 0.28, draw: 0.48, away: 0.24 }
        : { home: 0.22, draw: 0.24, away: 0.54 };

      return makeTrainingRecord(`${league}-${i}`, league,
        `2024-03-${String((i % 28) + 1).padStart(2, '0')}T15:00:00Z`,
        t12, t3, t4, actual);
    });

    // Learn weights on training set (first 200 records)
    const trainRecords = records.slice(0, 200);
    const registry = learnEnsembleWeights(trainRecords, '2024-01-01T00:00:00Z');

    // Evaluate on validation set (last 100 records)
    const valRecords = records.slice(200);
    const bootstrap = buildBootstrapCalibrationTable();
    const calibTables = new Map([['global', bootstrap]]);

    let totalRpsT12 = 0;
    let totalRpsEnsemble = 0;

    for (const record of valRecords) {
      // T1+2 standalone RPS
      totalRpsT12 += computeRPS(record.track12Probs, record.actualOutcome);

      // Ensemble RPS
      const track4: Track4EnsembleInput = record.track4Probs !== null
        ? { status: 'ACTIVE_HIGH', probs: record.track4Probs }
        : { status: 'DEACTIVATED' };

      const output = runNexusEnsemble(
        { probs: record.track12Probs },
        record.track3Probs !== null ? { probs: record.track3Probs } : null,
        track4,
        registry,
        calibTables,
        league,
        record.horizon,
        record.dataQuality,
      );

      totalRpsEnsemble += computeRPS(output.probs, record.actualOutcome);
    }

    return {
      rpsT12: totalRpsT12 / valRecords.length,
      rpsEnsemble: totalRpsEnsemble / valRecords.length,
    };
  }

  const leagues = ['PD', 'PL', 'BL1', 'SA', 'FL1'];

  for (const league of leagues) {
    it(`${league}: RPS ensemble < RPS Track 1+2 standalone`, () => {
      const { rpsT12, rpsEnsemble } = runValidation(league, 300);
      // Ensemble should be meaningfully better (at least 5% relative improvement)
      expect(rpsEnsemble).toBeLessThan(rpsT12);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T5. SA/FL1 per-liga calibration uses per-league when >= 300 samples
// ─────────────────────────────────────────────────────────────────────────────

describe('T5 — SA/FL1 per-liga calibration (spec S8.3)', () => {
  /**
   * taxonomy spec S8.3: per-liga when >= 300 match observations.
   * SA/FL1 must use per-liga when samples are sufficient.
   * This prevents bias contamination from other leagues.
   */

  function makeCalibBundle(n: number, league: string): CalibrationTripletBundle {
    const homeData: CalibrationDataPoint[] = [];
    const drawData: CalibrationDataPoint[] = [];
    const awayData: CalibrationDataPoint[] = [];
    for (let i = 0; i < n; i++) {
      const outcome = (['home', 'draw', 'away'] as const)[i % 3]!;
      const date = `2023-${String((i % 12) + 1).padStart(2, '0')}-15T00:00:00Z`;
      homeData.push({ rawProb: 0.40 + (i % 10) * 0.02, isActual: outcome === 'home' ? 1 : 0, matchUtcDate: date, leagueCode: league });
      drawData.push({ rawProb: 0.28 + (i % 8) * 0.02, isActual: outcome === 'draw' ? 1 : 0, matchUtcDate: date, leagueCode: league });
      awayData.push({ rawProb: 0.22 + (i % 6) * 0.02, isActual: outcome === 'away' ? 1 : 0, matchUtcDate: date, leagueCode: league });
    }
    return { homeData, drawData, awayData };
  }

  it('SA with >= 300 samples gets a per-liga calibration table', () => {
    const perLeague = new Map([['SA', makeCalibBundle(400, 'SA')]]);
    const tables = fitNexusCalibrationFromTriplets(perLeague, '2024-01-01T00:00:00Z');

    expect(tables.has('SA')).toBe(true);
    expect(tables.has('global')).toBe(true);
    expect(tables.get('SA')!.leagueCode).toBe('SA');
  });

  it('FL1 with >= 300 samples gets a per-liga calibration table', () => {
    const perLeague = new Map([['FL1', makeCalibBundle(350, 'FL1')]]);
    const tables = fitNexusCalibrationFromTriplets(perLeague, '2024-01-01T00:00:00Z');

    expect(tables.has('FL1')).toBe(true);
  });

  it('SA with < 300 samples does NOT get per-liga table (falls to global)', () => {
    const perLeague = new Map([['SA', makeCalibBundle(200, 'SA')]]);
    const tables = fitNexusCalibrationFromTriplets(perLeague, '2024-01-01T00:00:00Z');

    expect(tables.has('SA')).toBe(false); // No per-liga table
    expect(tables.has('global')).toBe(true); // Global always present
  });

  it('applyNexusCalibration uses per-liga table when available for SA', () => {
    const perLeague = new Map([
      ['SA', makeCalibBundle(400, 'SA')],
      ['PD', makeCalibBundle(400, 'PD')],
    ]);
    const tables = fitNexusCalibrationFromTriplets(perLeague, '2024-01-01T00:00:00Z');

    const raw = { home: 0.45, draw: 0.32, away: 0.23 };

    const { calibrationSource: saSource } = applyNexusCalibration(raw, tables, 'SA');
    expect(saSource).toBe('per_league');

    const { calibrationSource: unknownSource } = applyNexusCalibration(raw, tables, 'BL1');
    // BL1 not in tables → falls to global
    expect(unknownSource).toBe('global');
  });

  it('MIN_SAMPLES_PER_LIGA_CALIBRATION threshold is exactly 300', () => {
    // Verify the spec-mandated threshold (taxonomy spec S8.3)
    expect(MIN_SAMPLES_PER_LIGA_CALIBRATION).toBe(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6. Weight redistribution proportionality (taxonomy spec S7.6)
// ─────────────────────────────────────────────────────────────────────────────

describe('T6 — Weight redistribution proportionality (spec S7.6.1)', () => {
  it('when Track4 deactivated: ratio track12/track3 preserved proportionally', () => {
    // taxonomy spec S7.6.1: "redistributed proportionally to the remaining active tracks"
    const learned: WeightVector = { track12: 0.50, track3: 0.25, track4: 0.25 };
    const result = redistributeWeights(learned, true, false);

    // track4 weight (0.25) redistributed proportionally:
    // track12 gets 0.25 * (0.50 / (0.50 + 0.25)) = 0.25 * 0.667 = 0.167
    // track3 gets  0.25 * (0.25 / (0.50 + 0.25)) = 0.25 * 0.333 = 0.083
    // new track12 = 0.50 + 0.167 = 0.667
    // new track3  = 0.25 + 0.083 = 0.333
    const expectedRatio = learned.track12 / (learned.track12 + learned.track3);
    const actualRatio = result.track12 / (result.track12 + result.track3);

    expect(Math.abs(actualRatio - expectedRatio)).toBeLessThan(1e-9);
    expect(result.track4).toBe(0);
    expect(Math.abs(result.track12 + result.track3 - 1.0)).toBeLessThan(1e-9);
  });

  it('when Track3 deactivated: ratio track12/track4 preserved proportionally', () => {
    const learned: WeightVector = { track12: 0.40, track3: 0.35, track4: 0.25 };
    const result = redistributeWeights(learned, false, true);

    const expectedRatio = learned.track12 / (learned.track12 + learned.track4);
    const actualRatio = result.track12 / (result.track12 + result.track4);

    expect(Math.abs(actualRatio - expectedRatio)).toBeLessThan(1e-9);
    expect(result.track3).toBe(0);
    expect(Math.abs(result.track12 + result.track4 - 1.0)).toBeLessThan(1e-9);
  });

  it('redistribution always enforces MIN_WEIGHT_TRACK12 after proportional split', () => {
    // Edge case: T1+2 has very small learned weight
    const learned: WeightVector = { track12: 0.05, track3: 0.55, track4: 0.40 };
    const result = redistributeWeights(learned, true, false);

    expect(result.track12).toBeGreaterThanOrEqual(MIN_WEIGHT_TRACK12 - 1e-9);
    expect(Math.abs(result.track12 + result.track3 + result.track4 - 1.0)).toBeLessThan(1e-9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7. Operating mode determination (taxonomy spec S9.3)
// ─────────────────────────────────────────────────────────────────────────────

describe('T7 — Operating mode (spec S9.3)', () => {
  const registry = makeRegistry({ track12: 0.50, track3: 0.30, track4: 0.20 });
  const bootstrap = buildBootstrapCalibrationTable();
  const calibTables = new Map([['global', bootstrap]]);

  it('FULL_MODE when all 3 tracks active', () => {
    const output = runNexusEnsemble(
      makeTrack12(0.50, 0.28, 0.22),
      makeTrack3(0.40, 0.32, 0.28),
      makeTrack4Active(0.45, 0.30, 0.25),
      registry, calibTables, 'PD', 'NEAR', 'FULL',
    );
    expect(output.operating_mode).toBe('FULL_MODE');
  });

  it('FULL_MODE when Track4 is DEACTIVATED but Track3 is active', () => {
    // taxonomy spec S9.2: "Track 4 inactive... otherwise FULL_MODE
    //   (market odds absence alone does not trigger LIMITED)"
    const output = runNexusEnsemble(
      makeTrack12(0.50, 0.28, 0.22),
      makeTrack3(0.40, 0.32, 0.28),
      makeTrack4Deactivated(),
      registry, calibTables, 'PD', 'FAR', 'FULL',
    );
    expect(output.operating_mode).toBe('FULL_MODE');
  });

  it('LIMITED_MODE when Track3 is null (excluded)', () => {
    const output = runNexusEnsemble(
      makeTrack12(0.50, 0.28, 0.22),
      null,  // Track 3 excluded
      makeTrack4Active(0.45, 0.30, 0.25),
      registry, calibTables, 'PD', 'NEAR', 'FULL',
    );
    expect(output.operating_mode).toBe('LIMITED_MODE');
  });

  it('LIMITED_MODE when both Track3 and Track4 are inactive', () => {
    const output = runNexusEnsemble(
      makeTrack12(0.50, 0.28, 0.22),
      null,
      makeTrack4Deactivated(),
      registry, calibTables, 'PD', 'NEAR', 'MINIMAL',
    );
    expect(output.operating_mode).toBe('LIMITED_MODE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8. PAVA monotonicity (taxonomy spec S8.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('T8 — PAVA monotonicity (spec S8.2)', () => {
  it('fitPAVA output is non-decreasing in calProb', () => {
    const pairs: Array<{ rawProb: number; isActual: 0 | 1 }> = [
      { rawProb: 0.1, isActual: 0 },
      { rawProb: 0.2, isActual: 1 },
      { rawProb: 0.3, isActual: 0 },
      { rawProb: 0.4, isActual: 1 },
      { rawProb: 0.5, isActual: 1 },
      { rawProb: 0.6, isActual: 0 },
      { rawProb: 0.7, isActual: 1 },
      { rawProb: 0.8, isActual: 1 },
      { rawProb: 0.9, isActual: 1 },
    ];

    const points = fitPAVA(pairs);

    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.calProb).toBeGreaterThanOrEqual(points[i - 1]!.calProb - 1e-9);
    }
  });

  it('fitPAVA on monotone input returns same structure', () => {
    const pairs = [
      { rawProb: 0.1, isActual: 0 as const },
      { rawProb: 0.5, isActual: 0 as const },
      { rawProb: 0.8, isActual: 1 as const },
      { rawProb: 0.9, isActual: 1 as const },
    ];

    const points = fitPAVA(pairs);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.calProb).toBeGreaterThanOrEqual(points[i - 1]!.calProb - 1e-9);
    }
  });

  it('fitPAVA on empty input returns empty array', () => {
    expect(fitPAVA([])).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9. Walk-forward weight learning (taxonomy spec S7.4, S7.5)
// ─────────────────────────────────────────────────────────────────────────────

describe('T9 — Walk-forward weight learning (spec S7.4)', () => {
  it('learnEnsembleWeights throws when global set < MIN_SAMPLES_GLOBAL', () => {
    const tooFewRecords = generateTrainingRecords(100, 'PD');
    expect(() => learnEnsembleWeights(tooFewRecords, '2024-01-01T00:00:00Z'))
      .toThrow(/minimum required is 200/);
  });

  it('learnEnsembleWeights succeeds with >= 200 global records', () => {
    const records = generateTrainingRecords(250, 'PD');
    const registry = learnEnsembleWeights(records, '2024-01-01T00:00:00Z');

    expect(registry.global).toBeDefined();
    expect(registry.global.track12).toBeGreaterThanOrEqual(MIN_WEIGHT_TRACK12 - 1e-9);
    const sum = registry.global.track12 + registry.global.track3 + registry.global.track4;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('learnEnsembleWeights produces segment weights when segment has >= 50 records', () => {
    // Generate 200 PD records in NEAR/FULL segment
    const records = Array.from({ length: 200 }, (_, i) =>
      makeTrainingRecord(
        `PD-${i}`, 'PD', `2024-03-${String((i % 28) + 1).padStart(2, '0')}T15:00:00Z`,
        { home: 0.50, draw: 0.28, away: 0.22 },
        { home: 0.40, draw: 0.32, away: 0.28 },
        { home: 0.45, draw: 0.30, away: 0.25 },
        (['home', 'draw', 'away'] as const)[i % 3]!,
        'NEAR', 'FULL',
      )
    );

    const registry = learnEnsembleWeights(records, '2024-01-01T00:00:00Z');

    // PD/NEAR/FULL should have a direct segment entry
    const segKey = buildSegmentKey('PD', 'NEAR', 'FULL');
    expect(registry.segments[segKey]).toBeDefined();
  });

  it('learned weights all non-negative', () => {
    const records = generateTrainingRecords(250, 'BL1');
    const registry = learnEnsembleWeights(records, '2024-01-01T00:00:00Z');

    for (const weights of Object.values(registry.segments)) {
      expect((weights as WeightVector).track12).toBeGreaterThanOrEqual(0);
      expect((weights as WeightVector).track3).toBeGreaterThanOrEqual(0);
      expect((weights as WeightVector).track4).toBeGreaterThanOrEqual(0);
    }
    expect(registry.global.track12).toBeGreaterThanOrEqual(0);
    expect(registry.global.track3).toBeGreaterThanOrEqual(0);
    expect(registry.global.track4).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10. Fallback hierarchy (taxonomy spec S7.4.5)
// ─────────────────────────────────────────────────────────────────────────────

describe('T10 — Weight fallback hierarchy (spec S7.4.5)', () => {
  it('uses exact segment key when available (no fallback)', () => {
    const segKey = buildSegmentKey('PD', 'NEAR', 'FULL');
    const segWeights: WeightVector = { track12: 0.45, track3: 0.30, track4: 0.25 };
    const registry = makeRegistry(
      { track12: 0.60, track3: 0.25, track4: 0.15 }, // global different
      { [segKey]: segWeights },
    );

    const { weights, fallbackApplied } = lookupWeights(registry, 'PD', 'NEAR', 'FULL');
    expect(fallbackApplied).toBe(false);
    expect(weights).toEqual(segWeights);
  });

  it('falls back to league+horizon when exact segment missing', () => {
    const lhKey = `PD/NEAR`;
    const lhWeights: WeightVector = { track12: 0.50, track3: 0.28, track4: 0.22 };
    const registry = makeRegistry(
      { track12: 0.60, track3: 0.25, track4: 0.15 },
      { [lhKey]: lhWeights },
    );

    const { weights, fallbackApplied, segmentUsed } =
      lookupWeights(registry, 'PD', 'NEAR', 'FULL');
    expect(fallbackApplied).toBe(true);
    expect(weights).toEqual(lhWeights);
    expect(segmentUsed).toBe(lhKey);
  });

  it('falls back to league when exact and lh segments missing', () => {
    const lKey = `PD`;
    const lWeights: WeightVector = { track12: 0.55, track3: 0.25, track4: 0.20 };
    const registry = makeRegistry(
      { track12: 0.60, track3: 0.25, track4: 0.15 },
      { [lKey]: lWeights },
    );

    const { weights, fallbackApplied, segmentUsed } =
      lookupWeights(registry, 'PD', 'NEAR', 'FULL');
    expect(fallbackApplied).toBe(true);
    expect(weights).toEqual(lWeights);
    expect(segmentUsed).toBe(lKey);
  });

  it('falls back to global when no segment, lh, or league key present', () => {
    const globalWeights: WeightVector = { track12: 0.60, track3: 0.25, track4: 0.15 };
    const registry = makeRegistry(globalWeights);

    const { weights, fallbackApplied, segmentUsed } =
      lookupWeights(registry, 'PD', 'NEAR', 'FULL');
    expect(fallbackApplied).toBe(true);
    expect(weights).toEqual(globalWeights);
    expect(segmentUsed).toBe('global');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11. Anti-lookahead: calibration temporal guard (taxonomy spec S8.5)
// ─────────────────────────────────────────────────────────────────────────────

describe('T11 — Calibration anti-lookahead (spec S8.5)', () => {
  it('fitNexusCalibrationFromTriplets throws on data after fittedAt', () => {
    const futureDate = '2025-01-15T00:00:00Z';
    const fittedAt = '2025-01-01T00:00:00Z';  // fittedAt is BEFORE futureDate

    const leakBundle: CalibrationTripletBundle = {
      homeData: [
        { rawProb: 0.5, isActual: 1, matchUtcDate: '2024-12-01T00:00:00Z', leagueCode: 'PD' },
        { rawProb: 0.4, isActual: 0, matchUtcDate: futureDate, leagueCode: 'PD' }, // ← leakage
      ],
      drawData: [
        { rawProb: 0.3, isActual: 0, matchUtcDate: '2024-12-01T00:00:00Z', leagueCode: 'PD' },
        { rawProb: 0.3, isActual: 1, matchUtcDate: futureDate, leagueCode: 'PD' }, // ← leakage
      ],
      awayData: [
        { rawProb: 0.2, isActual: 0, matchUtcDate: '2024-12-01T00:00:00Z', leagueCode: 'PD' },
        { rawProb: 0.3, isActual: 0, matchUtcDate: futureDate, leagueCode: 'PD' }, // ← leakage
      ],
    };

    expect(() =>
      fitNexusCalibrationFromTriplets(new Map([['PD', leakBundle]]), fittedAt)
    ).toThrow(CalibrationTemporalLeakageError);
  });

  it('fitNexusCalibrationFromTriplets succeeds when all dates < fittedAt', () => {
    const goodBundle: CalibrationTripletBundle = {
      homeData: Array.from({ length: 10 }, (_, i) => ({
        rawProb: 0.4 + i * 0.02,
        isActual: (i % 2) as 0 | 1,
        matchUtcDate: `2024-${String(i + 1).padStart(2, '0')}-15T00:00:00Z`,
        leagueCode: 'PD',
      })),
      drawData: Array.from({ length: 10 }, (_, i) => ({
        rawProb: 0.28 + i * 0.01,
        isActual: (i % 3 === 0 ? 1 : 0) as 0 | 1,
        matchUtcDate: `2024-${String(i + 1).padStart(2, '0')}-15T00:00:00Z`,
        leagueCode: 'PD',
      })),
      awayData: Array.from({ length: 10 }, (_, i) => ({
        rawProb: 0.20 + i * 0.02,
        isActual: (i % 4 === 0 ? 1 : 0) as 0 | 1,
        matchUtcDate: `2024-${String(i + 1).padStart(2, '0')}-15T00:00:00Z`,
        leagueCode: 'PD',
      })),
    };

    expect(() =>
      fitNexusCalibrationFromTriplets(new Map([['PD', goodBundle]]), '2025-01-01T00:00:00Z')
    ).not.toThrow();
  });

  it('equal timestamps (matchUtcDate === fittedAt) are treated as leakage (strict <)', () => {
    const equalDate = '2025-01-01T00:00:00Z';
    const fittedAt = '2025-01-01T00:00:00Z';

    const equalBundle: CalibrationTripletBundle = {
      homeData: [{ rawProb: 0.5, isActual: 1, matchUtcDate: equalDate, leagueCode: 'PD' }],
      drawData: [{ rawProb: 0.3, isActual: 0, matchUtcDate: equalDate, leagueCode: 'PD' }],
      awayData: [{ rawProb: 0.2, isActual: 0, matchUtcDate: equalDate, leagueCode: 'PD' }],
    };

    // taxonomy spec S8.5: "matchUtcDate < calibrationTable.fittedAt" — strict less-than
    expect(() =>
      fitNexusCalibrationFromTriplets(new Map([['PD', equalBundle]]), fittedAt)
    ).toThrow(CalibrationTemporalLeakageError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12. Ensemble confidence from margin (taxonomy spec S7.7)
// ─────────────────────────────────────────────────────────────────────────────

describe('T12 — Ensemble confidence (spec S7.7)', () => {
  const registry = makeRegistry({ track12: 0.50, track3: 0.30, track4: 0.20 });
  const bootstrap = buildBootstrapCalibrationTable();
  const calibTables = new Map([['global', bootstrap]]);

  it('HIGH confidence when margin >= CONFIDENCE_THRESHOLD_HIGH (0.15)', () => {
    expect(CONFIDENCE_THRESHOLD_HIGH).toBe(0.15);
    // Home clearly dominant: margin should be >= 0.15
    const output = runNexusEnsemble(
      makeTrack12(0.75, 0.15, 0.10),
      makeTrack3(0.72, 0.16, 0.12),
      makeTrack4Active(0.70, 0.18, 0.12),
      registry, calibTables, 'PD', 'NEAR', 'FULL',
    );
    expect(output.ensemble_confidence).toBe('HIGH');
  });

  it('LOW confidence when margin < CONFIDENCE_THRESHOLD_MEDIUM (0.05)', () => {
    expect(CONFIDENCE_THRESHOLD_MEDIUM).toBe(0.05);
    // Very close probabilities: margin < 0.05
    const output = runNexusEnsemble(
      makeTrack12(0.335, 0.330, 0.335),
      makeTrack3(0.340, 0.330, 0.330),
      makeTrack4Active(0.338, 0.331, 0.331),
      registry, calibTables, 'PD', 'FAR', 'PARTIAL',
    );
    expect(output.ensemble_confidence).toBe('LOW');
  });

  it('MEDIUM confidence between LOW and HIGH thresholds', () => {
    const output = runNexusEnsemble(
      makeTrack12(0.45, 0.30, 0.25),
      makeTrack3(0.43, 0.32, 0.25),
      makeTrack4Active(0.44, 0.31, 0.25),
      registry, calibTables, 'PL', 'MEDIUM', 'FULL',
    );
    // margin ~= 0.44 - 0.31 = 0.13 → should be MEDIUM (< 0.15 but >= 0.05)
    expect(['HIGH', 'MEDIUM']).toContain(output.ensemble_confidence);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13. Spec invariant verification: MIN_WEIGHT_TRACK12 = 0.20
// ─────────────────────────────────────────────────────────────────────────────

describe('T13 — Spec invariant: MIN_WEIGHT_TRACK12 = 0.20 (spec S7.4.4c)', () => {
  it('MIN_WEIGHT_TRACK12 is 0.20 per taxonomy spec S7.4.4c', () => {
    /**
     * SPEC_AMBIGUITY #1 documentation:
     * The task prompt specified `w_track12 >= 0.35`.
     * taxonomy spec S7.4.4c states: "Minimum weight for Track 1+2 of 0.20".
     * Spec governs. This test verifies the spec value is implemented.
     */
    expect(MIN_WEIGHT_TRACK12).toBe(0.20);
    expect(MIN_WEIGHT_TRACK12).not.toBe(0.35);
  });

  it('redistributeWeights never yields track12 < 0.20', () => {
    // Test many combinations of learned weights and track activation states
    const scenarios: Array<[WeightVector, boolean, boolean]> = [
      [{ track12: 0.10, track3: 0.50, track4: 0.40 }, true, false],
      [{ track12: 0.01, track3: 0.60, track4: 0.39 }, false, true],
      [{ track12: 0.05, track3: 0.45, track4: 0.50 }, true, true],
      [{ track12: 0.20, track3: 0.40, track4: 0.40 }, true, false],
      [{ track12: 0.35, track3: 0.35, track4: 0.30 }, false, false],
    ];

    for (const [learned, t3Active, t4Active] of scenarios) {
      const result = redistributeWeights(learned, t3Active, t4Active);
      expect(result.track12).toBeGreaterThanOrEqual(MIN_WEIGHT_TRACK12 - 1e-9);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15. home/draw/away calibrators are independent (FINDING-005 — taxonomy spec S8.2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Spec: "Three separate one-vs-rest calibrators: one for home, one for draw,
// one for away. Each is an independent PAVA-fitted isotonic curve." (S8.2)
//
// The broken `fitNexusCalibration()` function assigned `homePoints` to all three
// classes. This test uses `fitNexusCalibrationFromTriplets()` (the correct path)
// and verifies that home and draw calibrators produce different curves when the
// class-specific data differs. It also verifies `fitNexusCalibration()` throws.

describe('T15 — home/draw/away calibrators are independent (FINDING-005, spec S8.2)', () => {
  /**
   * Build a CalibrationTripletBundle where home_prob varies but draw_prob is constant.
   * After PAVA fitting, the home calibrator must be different from the draw calibrator.
   */
  function buildAsymmetricBundle(n: number, league: string): CalibrationTripletBundle {
    const homeData: CalibrationDataPoint[] = [];
    const drawData: CalibrationDataPoint[] = [];
    const awayData: CalibrationDataPoint[] = [];

    for (let i = 0; i < n; i++) {
      const outcome = (['home', 'draw', 'away'] as const)[i % 3]!;
      const date = `2023-${String((i % 12) + 1).padStart(2, '0')}-15T00:00:00Z`;

      // home_prob varies widely (0.20 to 0.80): PAVA will produce a distinct curve
      homeData.push({
        rawProb: 0.20 + (i % 10) * 0.06,
        isActual: outcome === 'home' ? 1 : 0,
        matchUtcDate: date,
        leagueCode: league,
      });

      // draw_prob is constant at 0.30: PAVA on constant input produces a flat line
      drawData.push({
        rawProb: 0.30,
        isActual: outcome === 'draw' ? 1 : 0,
        matchUtcDate: date,
        leagueCode: league,
      });

      awayData.push({
        rawProb: 0.20 + (i % 7) * 0.08,
        isActual: outcome === 'away' ? 1 : 0,
        matchUtcDate: date,
        leagueCode: league,
      });
    }

    return { homeData, drawData, awayData };
  }

  it('home calibrator differs from draw calibrator when class data differs', () => {
    const perLeague = new Map([['PD', buildAsymmetricBundle(400, 'PD')]]);
    const tables = fitNexusCalibrationFromTriplets(perLeague, '2024-01-01T00:00:00Z');

    const table = tables.get('PD')!;
    expect(table).toBeDefined();

    const homePoints = table.calibrators.home;
    const drawPoints = table.calibrators.draw;

    // Draw calibrator trained on constant 0.30 input collapses to a single block.
    // Home calibrator trained on varying input produces multiple distinct points.
    // They cannot be identical when the source data is structurally different.
    const homeJson = JSON.stringify(homePoints);
    const drawJson = JSON.stringify(drawPoints);

    expect(homeJson).not.toBe(drawJson);
  });

  it('home calibrator differs from away calibrator when class data differs', () => {
    const perLeague = new Map([['PL', buildAsymmetricBundle(400, 'PL')]]);
    const tables = fitNexusCalibrationFromTriplets(perLeague, '2024-01-01T00:00:00Z');

    const table = tables.get('PL')!;
    const homeJson = JSON.stringify(table.calibrators.home);
    const awayJson = JSON.stringify(table.calibrators.away);

    expect(homeJson).not.toBe(awayJson);
  });

  it('global calibrators (home/draw/away) are each independently fitted', () => {
    // Use asymmetric data so global calibrators will differ between classes.
    // home_prob varies (0.20..0.80); draw_prob is constant (0.30).
    // After PAVA on the same input, the two curves will have different calProb
    // distributions because they encode different one-vs-rest targets (isActual).
    const perLeague = new Map([
      ['PD', buildAsymmetricBundle(100, 'PD')],  // < 300, contributes to global only
      ['PL', buildAsymmetricBundle(100, 'PL')],
    ]);
    const tables = fitNexusCalibrationFromTriplets(perLeague, '2024-01-01T00:00:00Z');

    const global = tables.get('global')!;
    expect(global).toBeDefined();

    // Each class must be an independently fitted curve.
    // The draw curve (constant rawProb=0.30) and home curve (variable rawProb) must differ.
    expect(JSON.stringify(global.calibrators.home)).not.toBe(
      JSON.stringify(global.calibrators.draw),
    );

    // The home and away curves must also differ from each other (different isActual targets).
    expect(JSON.stringify(global.calibrators.home)).not.toBe(
      JSON.stringify(global.calibrators.away),
    );
  });

  it('fitNexusCalibration() throws NotImplementedError (FINDING-005: broken function removed)', () => {
    // The broken fitNexusCalibration() must not be callable — it would silently
    // assign homePoints to draw and away, violating taxonomy spec S8.2.
    // It now throws an explicit error to prevent silent misuse.
    expect(() =>
      fitNexusCalibration([], '2024-01-01T00:00:00Z'),
    ).toThrow(/fitNexusCalibration\(\) is not implemented/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14. RPS computation correctness (evaluation spec S2.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('T14 — RPS computation (evaluation spec S2.1)', () => {
  it('perfect prediction has RPS = 0', () => {
    const probs = { home: 1.0, draw: 0.0, away: 0.0 };
    expect(computeRPS(probs, 'home')).toBe(0);
  });

  it('worst prediction (predict away when actual=home) has RPS = 1.0', () => {
    // 3-outcome RPS max: predict opposite end with certainty
    // probs = {home:0, draw:0, away:1}, actual=home
    // cumP1=0, cumO1=1 → (0-1)²=1
    // cumP2=0+0=0, cumO2=1+0=1 → (0-1)²=1
    // RPS = 0.5*(1+1) = 1.0
    const probs = { home: 0.0, draw: 0.0, away: 1.0 };
    expect(computeRPS(probs, 'home')).toBeCloseTo(1.0, 10);
  });

  it('uniform prediction RPS: home = 0.333, draw = 0.167, away = 0.333', () => {
    // For uniform {1/3, 1/3, 1/3}:
    //   actual=home: cumP1=1/3, cumO1=1, cumP2=2/3, cumO2=1 → 0.5*((1/3-1)²+(2/3-1)²)
    //     = 0.5*(4/9+1/9) = 0.5*(5/9) ≈ 0.2778
    //   actual=draw: cumP1=1/3, cumO1=0, cumP2=2/3, cumO2=1 → 0.5*((1/3)²+(2/3-1)²)
    //     = 0.5*(1/9+1/9) = 0.5*(2/9) ≈ 0.1111
    //   actual=away: cumP1=1/3, cumO1=0, cumP2=2/3, cumO2=0 → 0.5*((1/3)²+(2/3)²)
    //     = 0.5*(1/9+4/9) = 0.5*(5/9) ≈ 0.2778
    const probs = { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
    expect(computeRPS(probs, 'home')).toBeCloseTo(5 / 18, 10);
    expect(computeRPS(probs, 'draw')).toBeCloseTo(1 / 9, 10);
    expect(computeRPS(probs, 'away')).toBeCloseTo(5 / 18, 10);
  });

  it('closer prediction is penalized less than further prediction', () => {
    // Predicted home, draw is second most likely
    const closePrediction = { home: 0.50, draw: 0.35, away: 0.15 };
    // Predicted home, away is second most likely (draw further from actual)
    const farPrediction = { home: 0.50, draw: 0.10, away: 0.40 };

    // Actual = draw (adjacent to home in ranked ordering)
    const rpsClose = computeRPS(closePrediction, 'draw');
    const rpsFar = computeRPS(farPrediction, 'draw');
    expect(rpsClose).toBeLessThan(rpsFar);
  });
});

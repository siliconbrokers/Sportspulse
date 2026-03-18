/**
 * NEXUS Feature Store — Unit Tests
 *
 * Spec authority: NEXUS-0 S3.2, S5.1, S6, S8, S11
 *
 * Test coverage:
 * - Anti-lookahead guard: features with effectiveAt >= buildNowUtc are filtered
 * - Strict less-than boundary: effectiveAt === buildNowUtc is also filtered
 * - Provenance completeness: all 5 fields present on every feature
 * - MISSING sentinel: absent xG returns MISSING, not 0.0 or null
 * - Freshness computation: buildNowUtc - ingestedAt in seconds
 * - applyAntiLookaheadGuard: non-mutating, returns cleaned snapshot
 * - assertNoLookahead: throws TemporalLeakageError on violation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  MISSING,
  applyAntiLookaheadGuard,
  assertNoLookahead,
  collectViolations,
  TemporalLeakageError,
  loadXgFeature,
  computeXgCoverage,
  extractTeamXg,
  AF_LEAGUE_IDS,
} from '../../src/nexus/feature-store/index.js';
import type {
  FeatureSnapshot,
  FeatureValue,
  FeatureProvenance,
  XgMatchData,
} from '../../src/nexus/feature-store/index.js';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeProvenance(effectiveAt: string, ingestedAt: string, buildNowUtc: string): FeatureProvenance {
  const freshness = Math.max(
    0,
    (Date.parse(buildNowUtc) - Date.parse(ingestedAt)) / 1000,
  );
  return {
    source: 'api-football',
    ingestedAt,
    effectiveAt,
    confidence: 'HIGH',
    freshness,
  };
}

function makeSnapshot(
  buildNowUtc: string,
  features: Record<string, FeatureValue<unknown>>,
): FeatureSnapshot {
  return {
    matchId: 'match:test:001',
    buildNowUtc,
    featureSnapshotId: 'test-snapshot-id',
    features,
  };
}

// ── Anti-lookahead guard ───────────────────────────────────────────────────

describe('applyAntiLookaheadGuard', () => {
  const BUILD_NOW = '2025-01-15T10:00:00Z';

  it('passes features with effectiveAt strictly before buildNowUtc', () => {
    const snapshot = makeSnapshot(BUILD_NOW, {
      xg_home: {
        value: 1.5,
        provenance: makeProvenance('2025-01-10T15:00:00Z', '2025-01-10T20:00:00Z', BUILD_NOW),
      },
    });

    const result = applyAntiLookaheadGuard(snapshot);

    expect(result.hadViolations).toBe(false);
    expect(result.violatingKeys).toHaveLength(0);
    expect(result.cleanedSnapshot.features['xg_home']?.value).toBe(1.5);
  });

  it('CRITICAL: filters feature with effectiveAt > buildNowUtc (future date)', () => {
    // Spec S3.2: effectiveAt >= buildNowUtc → excluded
    // This is the core anti-lookahead test from the task requirements
    const futureEffectiveAt = '2025-01-16T10:00:00Z'; // one day after BUILD_NOW

    const snapshot = makeSnapshot(BUILD_NOW, {
      future_feature: {
        value: 42.0,
        provenance: makeProvenance(futureEffectiveAt, '2025-01-14T08:00:00Z', BUILD_NOW),
      },
      past_feature: {
        value: 1.0,
        provenance: makeProvenance('2025-01-14T08:00:00Z', '2025-01-14T09:00:00Z', BUILD_NOW),
      },
    });

    const result = applyAntiLookaheadGuard(snapshot);

    expect(result.hadViolations).toBe(true);
    expect(result.violatingKeys).toContain('future_feature');
    expect(result.violatingKeys).not.toContain('past_feature');

    // The future feature must be replaced with MISSING
    expect(result.cleanedSnapshot.features['future_feature']?.value).toBe(MISSING);
    // The past feature must be preserved
    expect(result.cleanedSnapshot.features['past_feature']?.value).toBe(1.0);
  });

  it('CRITICAL: filters feature with effectiveAt === buildNowUtc (strict less-than per S3.2)', () => {
    // S3.2: "A feature whose effectiveAt equals buildNowUtc exactly is excluded."
    const snapshot = makeSnapshot(BUILD_NOW, {
      simultaneous_feature: {
        value: 99.0,
        provenance: makeProvenance(BUILD_NOW, '2025-01-14T08:00:00Z', BUILD_NOW),
      },
    });

    const result = applyAntiLookaheadGuard(snapshot);

    expect(result.hadViolations).toBe(true);
    expect(result.violatingKeys).toContain('simultaneous_feature');
    expect(result.cleanedSnapshot.features['simultaneous_feature']?.value).toBe(MISSING);
  });

  it('does NOT mutate the original snapshot (immutability per S11.7)', () => {
    const snapshot = makeSnapshot(BUILD_NOW, {
      future_feature: {
        value: 42.0,
        provenance: makeProvenance('2025-01-20T00:00:00Z', '2025-01-14T08:00:00Z', BUILD_NOW),
      },
    });

    applyAntiLookaheadGuard(snapshot);

    // Original snapshot must be untouched
    expect(snapshot.features['future_feature']?.value).toBe(42.0);
  });

  it('preserves provenance on filtered features (for auditing)', () => {
    const provenance = makeProvenance('2025-01-20T00:00:00Z', '2025-01-14T08:00:00Z', BUILD_NOW);
    const snapshot = makeSnapshot(BUILD_NOW, {
      future_feature: {
        value: 42.0,
        provenance,
      },
    });

    const result = applyAntiLookaheadGuard(snapshot);
    const filteredFeature = result.cleanedSnapshot.features['future_feature'];

    expect(filteredFeature?.provenance.source).toBe(provenance.source);
    expect(filteredFeature?.provenance.effectiveAt).toBe(provenance.effectiveAt);
  });

  it('handles empty feature snapshot without error', () => {
    const snapshot = makeSnapshot(BUILD_NOW, {});
    const result = applyAntiLookaheadGuard(snapshot);

    expect(result.hadViolations).toBe(false);
    expect(result.violatingKeys).toHaveLength(0);
  });

  it('processes multiple features, filtering only violators', () => {
    const snapshot = makeSnapshot(BUILD_NOW, {
      f1_past:   { value: 1, provenance: makeProvenance('2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z', BUILD_NOW) },
      f2_past:   { value: 2, provenance: makeProvenance('2025-01-10T00:00:00Z', '2025-01-10T01:00:00Z', BUILD_NOW) },
      f3_future: { value: 3, provenance: makeProvenance('2025-01-16T00:00:00Z', '2025-01-14T01:00:00Z', BUILD_NOW) },
      f4_future: { value: 4, provenance: makeProvenance('2025-12-31T00:00:00Z', '2025-01-14T01:00:00Z', BUILD_NOW) },
    });

    const result = applyAntiLookaheadGuard(snapshot);

    expect(result.violatingKeys).toHaveLength(2);
    expect(result.violatingKeys).toContain('f3_future');
    expect(result.violatingKeys).toContain('f4_future');
    expect(result.cleanedSnapshot.features['f1_past']?.value).toBe(1);
    expect(result.cleanedSnapshot.features['f2_past']?.value).toBe(2);
    expect(result.cleanedSnapshot.features['f3_future']?.value).toBe(MISSING);
    expect(result.cleanedSnapshot.features['f4_future']?.value).toBe(MISSING);
  });
});

// ── assertNoLookahead ─────────────────────────────────────────────────────

describe('assertNoLookahead', () => {
  const BUILD_NOW = '2025-06-01T12:00:00Z';

  it('does not throw for a clean snapshot', () => {
    const snapshot = makeSnapshot(BUILD_NOW, {
      xg: {
        value: 1.2,
        provenance: makeProvenance('2025-05-30T20:00:00Z', '2025-05-30T22:00:00Z', BUILD_NOW),
      },
    });

    expect(() => assertNoLookahead(snapshot)).not.toThrow();
  });

  it('throws TemporalLeakageError for contaminated snapshot', () => {
    const snapshot = makeSnapshot(BUILD_NOW, {
      leaked_feature: {
        value: 99,
        provenance: makeProvenance('2025-06-02T12:00:00Z', '2025-05-31T10:00:00Z', BUILD_NOW),
      },
    });

    expect(() => assertNoLookahead(snapshot)).toThrow(TemporalLeakageError);
  });

  it('TemporalLeakageError has correct name property', () => {
    const snapshot = makeSnapshot(BUILD_NOW, {
      leaked: {
        value: 1,
        provenance: makeProvenance('2026-01-01T00:00:00Z', '2025-05-31T10:00:00Z', BUILD_NOW),
      },
    });

    try {
      assertNoLookahead(snapshot);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemporalLeakageError);
      expect((err as TemporalLeakageError).name).toBe('TemporalLeakageError');
    }
  });
});

// ── Provenance completeness (S11.1) ───────────────────────────────────────

describe('feature provenance completeness', () => {
  it('every feature carries all 5 required provenance fields (S11.1)', () => {
    const BUILD_NOW = '2025-03-15T08:00:00Z';
    const provenance = makeProvenance('2025-03-14T20:00:00Z', '2025-03-14T22:00:00Z', BUILD_NOW);

    const feature: FeatureValue<number> = {
      value: 2.43,
      provenance,
    };

    // All 5 fields must be present and non-null
    expect(feature.provenance.source).toBeDefined();
    expect(feature.provenance.ingestedAt).toBeDefined();
    expect(feature.provenance.effectiveAt).toBeDefined();
    expect(feature.provenance.confidence).toBeDefined();
    expect(typeof feature.provenance.freshness).toBe('number');

    // No field is undefined or null
    expect(feature.provenance.source).not.toBeNull();
    expect(feature.provenance.ingestedAt).not.toBeNull();
    expect(feature.provenance.effectiveAt).not.toBeNull();
    expect(feature.provenance.confidence).not.toBeNull();
  });

  it('freshness is computed as buildNowUtc - ingestedAt in seconds', () => {
    const ingestedAt = '2025-01-15T08:00:00Z';
    const buildNowUtc = '2025-01-15T10:00:00Z'; // 2 hours later
    const expectedFreshness = 2 * 60 * 60; // 7200 seconds

    const provenance = makeProvenance('2025-01-14T20:00:00Z', ingestedAt, buildNowUtc);

    expect(provenance.freshness).toBe(expectedFreshness);
  });

  it('freshness is 0 when ingestedAt equals buildNowUtc', () => {
    const ts = '2025-01-15T10:00:00Z';
    const provenance = makeProvenance('2025-01-14T20:00:00Z', ts, ts);
    expect(provenance.freshness).toBe(0);
  });
});

// ── MISSING sentinel ───────────────────────────────────────────────────────

describe('MISSING sentinel', () => {
  it('MISSING is a Symbol, not null, undefined, or 0', () => {
    expect(typeof MISSING).toBe('symbol');
    expect(MISSING).not.toBe(null);
    expect(MISSING).not.toBe(undefined);
    expect(MISSING).not.toBe(0);
    expect(MISSING).not.toBe(0.0);
    expect(MISSING).not.toBe(false);
  });

  it('MISSING is the same symbol across multiple imports (singleton)', () => {
    // Both imports reference the same exported symbol
    const a = MISSING;
    const b = MISSING;
    expect(a).toBe(b);
  });

  it('can distinguish MISSING from a valid value using === comparison', () => {
    const value: number | typeof MISSING = MISSING;
    expect(value === MISSING).toBe(true);

    const validValue: number | typeof MISSING = 1.5;
    expect(validValue === MISSING).toBe(false);
  });
});

// ── xG feature loading ────────────────────────────────────────────────────

describe('loadXgFeature', () => {
  let tmpCacheRoot: string;

  // Set up a temporary directory with a fake xG cache file
  function setupXgCache(
    afLeagueId: number,
    year: number,
    fixtureId: number,
    data: object,
  ): void {
    const dir = join(tmpCacheRoot, 'xg', String(afLeagueId), String(year));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${fixtureId}.json`), JSON.stringify(data), 'utf-8');
  }

  beforeAll(() => {
    tmpCacheRoot = join(tmpdir(), `nexus-test-${Date.now()}`);
    mkdirSync(tmpCacheRoot, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpCacheRoot, { recursive: true, force: true });
  });

  it('returns MISSING when xG cache file does not exist', () => {
    const BUILD_NOW = '2025-03-15T10:00:00Z';
    const result = loadXgFeature(99999999, 39, 2024, BUILD_NOW, tmpCacheRoot);

    expect(result.value).toBe(MISSING);
  });

  it('returns MISSING — never 0.0 — for absent xG (S6.2.2)', () => {
    const BUILD_NOW = '2025-03-15T10:00:00Z';
    const result = loadXgFeature(99999998, 140, 2024, BUILD_NOW, tmpCacheRoot);

    // The critical missingness invariant: absent xG is MISSING, not 0.0
    expect(result.value).toBe(MISSING);
    expect(result.value).not.toBe(0);
    expect(result.value).not.toBe(0.0);
  });

  it('returns xG data with correct values when cache file exists', () => {
    const fixtureId = 1208021;
    const afLeagueId = 39; // Premier League
    const year = 2024;
    const BUILD_NOW = '2025-03-15T10:00:00Z';

    setupXgCache(afLeagueId, year, fixtureId, {
      fixtureId,
      utcDate: '2024-08-16T19:00:00+00:00',
      homeTeamId: 'team:football-data:66',
      awayTeamId: 'team:football-data:63',
      xgHome: 2.43,
      xgAway: 0.44,
      cachedAt: '2026-03-18T03:30:32.524Z',
    });

    const result = loadXgFeature(fixtureId, afLeagueId, year, BUILD_NOW, tmpCacheRoot);

    expect(result.value).not.toBe(MISSING);
    const data = result.value as XgMatchData;
    expect(data.xgHome).toBe(2.43);
    expect(data.xgAway).toBe(0.44);
    expect(data.xgDataAvailable).toBe(true);
    expect(data.fixtureId).toBe(fixtureId);
  });

  it('provenance has source=api-football and all required fields', () => {
    const fixtureId = 1208022;
    const BUILD_NOW = '2025-03-15T10:00:00Z';

    setupXgCache(39, 2024, fixtureId, {
      fixtureId,
      utcDate: '2024-08-17T14:00:00Z',
      homeTeamId: 'team:football-data:57',
      awayTeamId: 'team:football-data:68',
      xgHome: 1.1,
      xgAway: 0.8,
      cachedAt: '2026-03-18T05:00:00Z',
    });

    const result = loadXgFeature(fixtureId, 39, 2024, BUILD_NOW, tmpCacheRoot);

    expect(result.provenance.source).toBe('api-football');
    expect(result.provenance.ingestedAt).toBeDefined();
    expect(result.provenance.effectiveAt).toBeDefined();
    expect(result.provenance.confidence).toBeDefined();
    expect(typeof result.provenance.freshness).toBe('number');
  });

  it('confidence is HIGH for API-Football backfill data (S5.2)', () => {
    const fixtureId = 1208023;
    const BUILD_NOW = '2025-03-15T10:00:00Z';

    setupXgCache(39, 2024, fixtureId, {
      fixtureId,
      utcDate: '2024-08-18T14:00:00Z',
      homeTeamId: 'team:football-data:57',
      awayTeamId: 'team:football-data:68',
      xgHome: 0.9,
      xgAway: 1.3,
      cachedAt: '2026-03-18T06:00:00Z',
    });

    const result = loadXgFeature(fixtureId, 39, 2024, BUILD_NOW, tmpCacheRoot);

    expect(result.provenance.confidence).toBe('HIGH');
  });

  it('xgDataAvailable is false and values are MISSING when xgHome/Away are null in cache', () => {
    const fixtureId = 1208024;
    const BUILD_NOW = '2025-03-15T10:00:00Z';

    setupXgCache(39, 2024, fixtureId, {
      fixtureId,
      utcDate: '2024-08-19T14:00:00Z',
      homeTeamId: 'team:football-data:57',
      awayTeamId: 'team:football-data:68',
      xgHome: null,
      xgAway: null,
      cachedAt: '2026-03-18T07:00:00Z',
    });

    const result = loadXgFeature(fixtureId, 39, 2024, BUILD_NOW, tmpCacheRoot);

    expect(result.value).not.toBe(MISSING);
    const data = result.value as XgMatchData;
    expect(data.xgDataAvailable).toBe(false);
    expect(data.xgHome).toBe(MISSING);
    expect(data.xgAway).toBe(MISSING);
  });
});

// ── AF League IDs ──────────────────────────────────────────────────────────

describe('AF_LEAGUE_IDS', () => {
  it('maps all required competition codes', () => {
    expect(AF_LEAGUE_IDS['PD']).toBe(140);
    expect(AF_LEAGUE_IDS['PL']).toBe(39);
    expect(AF_LEAGUE_IDS['BL1']).toBe(78);
    expect(AF_LEAGUE_IDS['SA']).toBe(135);
    expect(AF_LEAGUE_IDS['FL1']).toBe(61);
  });
});

// ── computeXgCoverage ─────────────────────────────────────────────────────

describe('computeXgCoverage', () => {
  it('returns 0 for empty array', () => {
    expect(computeXgCoverage([])).toBe(0);
  });

  it('returns 1.0 when all features have xG data', () => {
    const features: FeatureValue<XgMatchData>[] = [
      {
        value: {
          fixtureId: 1,
          utcDate: '2024-01-01T15:00:00Z',
          homeTeamId: 'team:fd:1',
          awayTeamId: 'team:fd:2',
          xgHome: 1.5,
          xgAway: 0.8,
          xgDataAvailable: true,
        },
        provenance: makeProvenance('2024-01-01T15:00:00Z', '2024-01-01T20:00:00Z', '2024-03-15T10:00:00Z'),
      },
    ];
    expect(computeXgCoverage(features)).toBe(1.0);
  });

  it('returns 0.5 when half of features have xG data', () => {
    const BUILD_NOW = '2025-01-01T10:00:00Z';
    const features: FeatureValue<XgMatchData>[] = [
      {
        value: {
          fixtureId: 1,
          utcDate: '2024-01-01T15:00:00Z',
          homeTeamId: 'team:fd:1',
          awayTeamId: 'team:fd:2',
          xgHome: 1.5,
          xgAway: 0.8,
          xgDataAvailable: true,
        },
        provenance: makeProvenance('2024-01-01T15:00:00Z', '2024-01-01T20:00:00Z', BUILD_NOW),
      },
      {
        value: MISSING,
        provenance: makeProvenance(BUILD_NOW, BUILD_NOW, BUILD_NOW),
      },
    ];
    expect(computeXgCoverage(features)).toBe(0.5);
  });
});

// ── extractTeamXg ─────────────────────────────────────────────────────────

describe('extractTeamXg', () => {
  const BUILD_NOW = '2025-03-15T10:00:00Z';
  const validFeature: FeatureValue<XgMatchData> = {
    value: {
      fixtureId: 1,
      utcDate: '2024-01-01T15:00:00Z',
      homeTeamId: 'team:fd:1',
      awayTeamId: 'team:fd:2',
      xgHome: 2.1,
      xgAway: 0.7,
      xgDataAvailable: true,
    },
    provenance: makeProvenance('2024-01-01T15:00:00Z', '2024-01-01T20:00:00Z', BUILD_NOW),
  };

  it('extracts home xG when available', () => {
    expect(extractTeamXg(validFeature, 'home')).toBe(2.1);
  });

  it('extracts away xG when available', () => {
    expect(extractTeamXg(validFeature, 'away')).toBe(0.7);
  });

  it('returns MISSING when feature value is MISSING', () => {
    const missingFeature: FeatureValue<XgMatchData> = {
      value: MISSING,
      provenance: makeProvenance(BUILD_NOW, BUILD_NOW, BUILD_NOW),
    };
    expect(extractTeamXg(missingFeature, 'home')).toBe(MISSING);
    expect(extractTeamXg(missingFeature, 'away')).toBe(MISSING);
  });
});

// ── collectViolations ─────────────────────────────────────────────────────

describe('collectViolations', () => {
  it('returns empty array for clean snapshot', () => {
    const BUILD_NOW = '2025-06-01T12:00:00Z';
    const snapshot = makeSnapshot(BUILD_NOW, {
      f: {
        value: 1,
        provenance: makeProvenance('2025-05-30T10:00:00Z', '2025-05-30T11:00:00Z', BUILD_NOW),
      },
    });
    expect(collectViolations(snapshot)).toHaveLength(0);
  });

  it('returns violation records with featureKey, effectiveAt, buildNowUtc, source', () => {
    const BUILD_NOW = '2025-06-01T12:00:00Z';
    const snapshot = makeSnapshot(BUILD_NOW, {
      leaked: {
        value: 99,
        provenance: makeProvenance('2025-06-02T00:00:00Z', '2025-05-31T10:00:00Z', BUILD_NOW),
      },
    });

    const violations = collectViolations(snapshot);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.featureKey).toBe('leaked');
    expect(violations[0]?.effectiveAt).toBe('2025-06-02T00:00:00Z');
    expect(violations[0]?.buildNowUtc).toBe(BUILD_NOW);
    expect(violations[0]?.source).toBe('api-football');
  });
});

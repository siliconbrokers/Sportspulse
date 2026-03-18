/**
 * NEXUS Odds Store + Canonical Serving View — Tests
 *
 * Spec authority:
 *   market-signal-policy S2.2 (confidence thresholds)
 *   market-signal-policy S3.1 (source precedence)
 *   market-signal-policy S4.2 (benchmark = Pinnacle ONLY)
 *   market-signal-policy S6.1 (as-of semantics: snapshot_utc < buildNowUtc)
 *   market-signal-policy S6.3 (no interpolation — use most recent snapshot)
 *   market-signal-policy S7.2 (proportional de-vigging)
 *
 * Test IDs:
 *   ODS-01: Append-only idempotency — same snapshot_utc does not overwrite
 *   ODS-02: Two distinct snapshots accumulate to two records
 *   ODS-03: De-vig implied probs sum exactly to 1.0
 *   ODS-04: Overround > 1.0 in real market odds
 *   ODS-05: As-of guard — snapshot AFTER buildNowUtc is ignored
 *   ODS-06: Benchmark ignores Bet365 (Pinnacle ONLY)
 *   ODS-07: Feature prefers Pinnacle over Bet365
 *   ODS-08: Confidence thresholds — HIGH / MEDIUM / LOW / DEACTIVATED
 *   ODS-09: Feature fallback — no Pinnacle → uses Bet365
 *   ODS-10: Benchmark with no Pinnacle → null (DEACTIVATED)
 *   ODS-11: loadOddsRecords returns records sorted ASC by snapshot_utc
 *   ODS-12: loadOddsRecords for non-existent match returns []
 *   ODS-13: getCanonicalOddsSnapshot includes raw_record in output
 *   ODS-14: de-vig overround stored is the pre-normalization sum
 */

import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import {
  appendOddsRecord,
  loadOddsRecords,
  loadOddsRecordsForProvider,
  deVigProportional,
  computeOddsConfidence,
  selectFeatureProvider,
  selectBenchmarkProvider,
  getCanonicalOddsSnapshot,
} from '../../src/nexus/odds/index.js';
import type { OddsRecord, OddsProvider } from '../../src/nexus/odds/index.js';

// ── Test helpers ───────────────────────────────────────────────────────────

/** Build a minimal valid OddsRecord. */
function makeRecord(
  matchId: string,
  provider: OddsProvider,
  snapshotUtc: string,
  odds: [number, number, number],
): OddsRecord {
  return {
    match_id: matchId,
    provider,
    market: '1x2',
    odds_home: odds[0],
    odds_draw: odds[1],
    odds_away: odds[2],
    snapshot_utc: snapshotUtc,
    retrieved_at_utc: '2025-01-15T12:00:00Z',
  };
}

// ── Tmp directory lifecycle ────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-odds-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Raw Odds Store ─────────────────────────────────────────────────────────

describe('Raw Odds Store', () => {
  // ODS-01: Append-only idempotency
  test('ODS-01: same snapshot_utc does not overwrite existing record', async () => {
    const record = makeRecord('match1', 'pinnacle', '2025-01-15T10:00:00Z', [2.5, 3.2, 2.8]);

    await appendOddsRecord(record, tmpDir);
    // Attempt to overwrite with different odds_home — must be ignored.
    await appendOddsRecord({ ...record, odds_home: 99.9 }, tmpDir);

    const loaded = await loadOddsRecordsForProvider('match1', 'pinnacle', tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].odds_home).toBe(2.5); // First write preserved.
  });

  // ODS-02: Two distinct snapshots accumulate
  test('ODS-02: two different snapshot_utc values produce two records', async () => {
    const r1 = makeRecord('match2', 'pinnacle', '2025-01-15T10:00:00Z', [2.5, 3.2, 2.8]);
    const r2 = makeRecord('match2', 'pinnacle', '2025-01-15T18:00:00Z', [2.3, 3.1, 3.0]);

    await appendOddsRecord(r1, tmpDir);
    await appendOddsRecord(r2, tmpDir);

    const loaded = await loadOddsRecordsForProvider('match2', 'pinnacle', tmpDir);
    expect(loaded).toHaveLength(2);
  });

  // ODS-11: loadOddsRecords returns records sorted ASC
  test('ODS-11: loadOddsRecords returns records sorted by snapshot_utc ASC', async () => {
    const r1 = makeRecord('match11', 'pinnacle', '2025-01-15T10:00:00Z', [2.5, 3.2, 2.8]);
    const r2 = makeRecord('match11', 'bet365', '2025-01-14T08:00:00Z', [2.4, 3.1, 2.9]);
    const r3 = makeRecord('match11', 'pinnacle', '2025-01-16T06:00:00Z', [2.6, 3.3, 2.7]);

    await appendOddsRecord(r2, tmpDir); // Write out of order intentionally.
    await appendOddsRecord(r1, tmpDir);
    await appendOddsRecord(r3, tmpDir);

    const loaded = await loadOddsRecords('match11', tmpDir);
    expect(loaded).toHaveLength(3);
    expect(loaded[0].snapshot_utc).toBe('2025-01-14T08:00:00Z');
    expect(loaded[1].snapshot_utc).toBe('2025-01-15T10:00:00Z');
    expect(loaded[2].snapshot_utc).toBe('2025-01-16T06:00:00Z');
  });

  // ODS-12: Non-existent match returns []
  test('ODS-12: loadOddsRecords for non-existent matchId returns empty array', async () => {
    const loaded = await loadOddsRecords('no-such-match', tmpDir);
    expect(loaded).toEqual([]);
  });
});

// ── De-vig proporcional ────────────────────────────────────────────────────

describe('De-vig proporcional (MSP S7.2)', () => {
  // ODS-03: Probs sum to 1.0
  test('ODS-03: implied probs sum to exactly 1.0 (within 1e-10)', () => {
    const result = deVigProportional(2.5, 3.2, 2.8);
    expect(result.home + result.draw + result.away).toBeCloseTo(1.0, 10);
  });

  // ODS-04: Overround > 1.0
  test('ODS-04: overround > 1.0 for real market odds with margin', () => {
    const result = deVigProportional(2.0, 3.4, 3.8);
    expect(result.overround).toBeGreaterThan(1.0);
  });

  // ODS-14: overround is the pre-normalization sum of raw implied probs
  test('ODS-14: overround equals sum of (1/odds_i) before normalization', () => {
    const h = 2.5;
    const d = 3.2;
    const a = 2.8;
    const expectedOverround = 1 / h + 1 / d + 1 / a;
    const result = deVigProportional(h, d, a);
    expect(result.overround).toBeCloseTo(expectedOverround, 12);
  });

  test('all de-vigged probabilities are between 0 and 1', () => {
    const result = deVigProportional(1.5, 4.5, 5.0);
    expect(result.home).toBeGreaterThanOrEqual(0);
    expect(result.home).toBeLessThanOrEqual(1);
    expect(result.draw).toBeGreaterThanOrEqual(0);
    expect(result.draw).toBeLessThanOrEqual(1);
    expect(result.away).toBeGreaterThanOrEqual(0);
    expect(result.away).toBeLessThanOrEqual(1);
  });

  test('even odds produce equal probabilities', () => {
    const result = deVigProportional(3.0, 3.0, 3.0);
    expect(result.home).toBeCloseTo(1 / 3, 10);
    expect(result.draw).toBeCloseTo(1 / 3, 10);
    expect(result.away).toBeCloseTo(1 / 3, 10);
  });
});

// ── Canonical Serving View ─────────────────────────────────────────────────

describe('Canonical Serving View', () => {
  // ODS-05: As-of guard
  test('ODS-05: snapshot_utc AFTER buildNowUtc is excluded (anti-lookahead)', () => {
    const records = [
      makeRecord('m1', 'pinnacle', '2025-01-16T10:00:00Z', [2.5, 3.2, 2.8]), // future
    ];
    const result = getCanonicalOddsSnapshot(records, '2025-01-15T10:00:00Z', 'feature');
    expect(result).toBeNull();
  });

  // ODS-05b: snapshot_utc === buildNowUtc is also excluded (strict <)
  test('ODS-05b: snapshot_utc equal to buildNowUtc is also excluded (strict less-than)', () => {
    const buildNow = '2025-01-15T10:00:00Z';
    const records = [
      makeRecord('m1b', 'pinnacle', buildNow, [2.5, 3.2, 2.8]),
    ];
    const result = getCanonicalOddsSnapshot(records, buildNow, 'feature');
    expect(result).toBeNull();
  });

  // ODS-06: Benchmark uses only Pinnacle
  test('ODS-06: benchmark role ignores Bet365 even when it is more recent than Pinnacle', () => {
    const records = [
      makeRecord('m2', 'pinnacle', '2025-01-14T10:00:00Z', [2.5, 3.2, 2.8]),
      makeRecord('m2', 'bet365', '2025-01-15T10:00:00Z', [2.4, 3.1, 2.9]), // more recent
    ];
    const result = getCanonicalOddsSnapshot(records, '2025-01-16T10:00:00Z', 'benchmark');
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('pinnacle');
    expect(result!.provider).not.toBe('bet365');
  });

  // ODS-07: Feature prefers Pinnacle
  test('ODS-07: feature role prefers Pinnacle over Bet365', () => {
    const records = [
      makeRecord('m3', 'pinnacle', '2025-01-15T08:00:00Z', [2.5, 3.2, 2.8]),
      makeRecord('m3', 'bet365', '2025-01-15T09:00:00Z', [2.4, 3.1, 2.9]),
    ];
    const result = getCanonicalOddsSnapshot(records, '2025-01-16T10:00:00Z', 'feature');
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('pinnacle');
  });

  // ODS-08: Confidence thresholds
  test('ODS-08: confidence thresholds — HIGH / MEDIUM / LOW / DEACTIVATED', () => {
    expect(computeOddsConfidence(12)).toBe('HIGH');       // < 24h
    expect(computeOddsConfidence(23.9)).toBe('HIGH');
    expect(computeOddsConfidence(24)).toBe('MEDIUM');     // exactly 24h → MEDIUM
    expect(computeOddsConfidence(36)).toBe('MEDIUM');     // 24-72h
    expect(computeOddsConfidence(71.9)).toBe('MEDIUM');
    expect(computeOddsConfidence(72)).toBe('LOW');        // exactly 72h → LOW
    expect(computeOddsConfidence(96)).toBe('LOW');        // > 72h
    expect(computeOddsConfidence(Infinity)).toBe('DEACTIVATED');
  });

  // ODS-09: Feature falls back to Bet365 when no Pinnacle
  test('ODS-09: feature role falls back to Bet365 when Pinnacle is unavailable', () => {
    const records = [
      makeRecord('m4', 'bet365', '2025-01-15T10:00:00Z', [2.4, 3.1, 2.9]),
    ];
    const result = getCanonicalOddsSnapshot(records, '2025-01-16T10:00:00Z', 'feature');
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('bet365');
  });

  // ODS-10: Benchmark with no Pinnacle → null
  test('ODS-10: benchmark returns null when no Pinnacle snapshot exists', () => {
    const records = [
      makeRecord('m5', 'bet365', '2025-01-15T10:00:00Z', [2.4, 3.1, 2.9]),
    ];
    const result = getCanonicalOddsSnapshot(records, '2025-01-16T10:00:00Z', 'benchmark');
    expect(result).toBeNull();
  });

  // ODS-13: raw_record is included in output
  test('ODS-13: canonical snapshot includes raw_record for audit', () => {
    const records = [
      makeRecord('m6', 'pinnacle', '2025-01-15T10:00:00Z', [2.5, 3.2, 2.8]),
    ];
    const result = getCanonicalOddsSnapshot(records, '2025-01-16T10:00:00Z', 'feature');
    expect(result).not.toBeNull();
    expect(result!.raw_record.match_id).toBe('m6');
    expect(result!.raw_record.snapshot_utc).toBe('2025-01-15T10:00:00Z');
  });

  test('canonical snapshot has positive snapshot_age_hours', () => {
    const records = [
      makeRecord('m7', 'pinnacle', '2025-01-15T10:00:00Z', [2.5, 3.2, 2.8]),
    ];
    const result = getCanonicalOddsSnapshot(records, '2025-01-16T10:00:00Z', 'feature');
    expect(result).not.toBeNull();
    expect(result!.snapshot_age_hours).toBeGreaterThan(0);
    // 24h gap: 2025-01-15T10 → 2025-01-16T10
    expect(result!.snapshot_age_hours).toBeCloseTo(24, 5);
  });

  test('feature selects most recent Pinnacle when multiple Pinnacle snapshots exist', () => {
    const records = [
      makeRecord('m8', 'pinnacle', '2025-01-13T10:00:00Z', [2.5, 3.2, 2.8]),
      makeRecord('m8', 'pinnacle', '2025-01-15T10:00:00Z', [2.3, 3.0, 3.1]), // newer
    ];
    const result = getCanonicalOddsSnapshot(records, '2025-01-16T10:00:00Z', 'feature');
    expect(result).not.toBeNull();
    expect(result!.raw_record.snapshot_utc).toBe('2025-01-15T10:00:00Z');
  });

  test('empty records array returns null for both roles', () => {
    expect(getCanonicalOddsSnapshot([], '2025-01-16T10:00:00Z', 'feature')).toBeNull();
    expect(getCanonicalOddsSnapshot([], '2025-01-16T10:00:00Z', 'benchmark')).toBeNull();
  });

  test('selectFeatureProvider uses market_avg as last resort', () => {
    const records = [
      makeRecord('m9', 'market_avg', '2025-01-15T10:00:00Z', [2.4, 3.2, 2.9]),
    ];
    const selected = selectFeatureProvider(records, '2025-01-16T10:00:00Z');
    expect(selected).not.toBeNull();
    expect(selected!.provider).toBe('market_avg');
  });

  test('selectBenchmarkProvider ignores market_max and market_avg', () => {
    const records = [
      makeRecord('m10', 'market_max', '2025-01-15T10:00:00Z', [2.4, 3.2, 2.9]),
      makeRecord('m10', 'market_avg', '2025-01-15T11:00:00Z', [2.3, 3.1, 2.8]),
    ];
    const selected = selectBenchmarkProvider(records, '2025-01-16T10:00:00Z');
    expect(selected).toBeNull();
  });
});

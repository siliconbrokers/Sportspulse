import { describe, it, expect } from 'vitest';
import {
  buildSnapshotKey,
  buildNowUtcFromDate,
  assembleHeader,
  SNAPSHOT_SCHEMA_VERSION,
} from '../src/index.js';

describe('buildSnapshotKey', () => {
  it('produces deterministic key from identity tuple', () => {
    const key = buildSnapshotKey(
      'comp:football-data:PD',
      'season:football-data:2025',
      '2026-03-04T11:00:00Z',
      'sportpulse.mvp.form-agenda',
      1,
    );
    expect(key).toBe(
      'comp:football-data:PD|season:football-data:2025|2026-03-04T11:00:00Z|sportpulse.mvp.form-agenda@1',
    );
  });

  it('same inputs produce same key', () => {
    const args = ['c1', 's1', '2026-01-01T12:00:00Z', 'policy', 2] as const;
    expect(buildSnapshotKey(...args)).toBe(buildSnapshotKey(...args));
  });

  it('different inputs produce different keys', () => {
    const k1 = buildSnapshotKey('c1', 's1', '2026-01-01T12:00:00Z', 'p', 1);
    const k2 = buildSnapshotKey('c1', 's1', '2026-01-01T12:00:00Z', 'p', 2);
    expect(k1).not.toBe(k2);
  });
});

describe('buildNowUtcFromDate', () => {
  it('computes UTC noon for Europe/Madrid (CET = UTC+1 in winter)', () => {
    // 2026-01-15 noon in Madrid (CET, UTC+1) = 11:00 UTC
    const result = buildNowUtcFromDate('2026-01-15', 'Europe/Madrid');
    expect(result).toBe('2026-01-15T11:00:00Z');
  });

  it('computes UTC noon for Europe/Madrid (CEST = UTC+2 in summer)', () => {
    // 2026-07-15 noon in Madrid (CEST, UTC+2) = 10:00 UTC
    const result = buildNowUtcFromDate('2026-07-15', 'Europe/Madrid');
    expect(result).toBe('2026-07-15T10:00:00Z');
  });

  it('computes UTC noon for UTC timezone', () => {
    const result = buildNowUtcFromDate('2026-03-04', 'UTC');
    expect(result).toBe('2026-03-04T12:00:00Z');
  });

  it('is deterministic', () => {
    const r1 = buildNowUtcFromDate('2026-03-04', 'Europe/Madrid');
    const r2 = buildNowUtcFromDate('2026-03-04', 'Europe/Madrid');
    expect(r1).toBe(r2);
  });
});

describe('assembleHeader', () => {
  it('produces header with all required fields', () => {
    const header = assembleHeader({
      competitionId: 'comp:football-data:PD',
      seasonId: 'season:football-data:2025',
      buildNowUtc: '2026-03-04T11:00:00Z',
      timezone: 'Europe/Madrid',
      policyKey: 'sportpulse.mvp.form-agenda',
      policyVersion: 1,
      freshnessUtc: '2026-03-04T10:55:00Z',
    });

    expect(header.snapshotSchemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(header.competitionId).toBe('comp:football-data:PD');
    expect(header.seasonId).toBe('season:football-data:2025');
    expect(header.buildNowUtc).toBe('2026-03-04T11:00:00Z');
    expect(header.timezone).toBe('Europe/Madrid');
    expect(header.policyKey).toBe('sportpulse.mvp.form-agenda');
    expect(header.policyVersion).toBe(1);
    expect(header.freshnessUtc).toBe('2026-03-04T10:55:00Z');
    expect(header.snapshotKey).toContain('comp:football-data:PD');
    expect(header.snapshotKey).toContain('sportpulse.mvp.form-agenda@1');
  });

  it('computedAtUtc is a valid ISO8601 string', () => {
    const header = assembleHeader({
      competitionId: 'c1',
      seasonId: 's1',
      buildNowUtc: '2026-01-01T12:00:00Z',
      timezone: 'UTC',
      policyKey: 'p',
      policyVersion: 1,
    });

    expect(header.computedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('computedAtUtc differs from buildNowUtc', () => {
    const header = assembleHeader({
      competitionId: 'c1',
      seasonId: 's1',
      buildNowUtc: '2020-01-01T12:00:00Z',
      timezone: 'UTC',
      policyKey: 'p',
      policyVersion: 1,
    });

    // buildNowUtc is in the past, computedAtUtc is now
    expect(header.computedAtUtc).not.toBe(header.buildNowUtc);
  });

  it('freshnessUtc is undefined when not provided', () => {
    const header = assembleHeader({
      competitionId: 'c1',
      seasonId: 's1',
      buildNowUtc: '2026-01-01T12:00:00Z',
      timezone: 'UTC',
      policyKey: 'p',
      policyVersion: 1,
    });

    expect(header.freshnessUtc).toBeUndefined();
  });
});

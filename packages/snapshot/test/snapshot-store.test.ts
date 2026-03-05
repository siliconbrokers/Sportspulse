import { describe, it, expect } from 'vitest';
import { InMemorySnapshotStore } from '../src/index.js';
import type { DashboardSnapshotDTO } from '../src/dto/dashboard-snapshot.js';

function makeFakeSnapshot(key: string): DashboardSnapshotDTO {
  return {
    header: {
      snapshotSchemaVersion: 1,
      snapshotKey: key,
      competitionId: 'comp:test',
      seasonId: 'season:test',
      buildNowUtc: '2026-03-04T11:00:00Z',
      timezone: 'UTC',
      policyKey: 'test-policy',
      policyVersion: 1,
      computedAtUtc: '2026-03-04T11:00:00Z',
    },
    layout: {
      algorithmKey: 'treemap.squarified',
      algorithmVersion: 1,
      container: { width: 1200, height: 700, outerPadding: 8, innerGutter: 6 },
    },
    warnings: [],
    teams: [],
  };
}

describe('InMemorySnapshotStore', () => {
  it('returns undefined for a missing key', () => {
    const store = new InMemorySnapshotStore();
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('has() returns false for a missing key', () => {
    const store = new InMemorySnapshotStore();
    expect(store.has('nonexistent')).toBe(false);
  });

  it('set + get round-trips a snapshot', () => {
    const store = new InMemorySnapshotStore();
    const snap = makeFakeSnapshot('key-1');
    store.set('key-1', snap);
    expect(store.get('key-1')).toBe(snap);
  });

  it('has() returns true after set', () => {
    const store = new InMemorySnapshotStore();
    store.set('key-1', makeFakeSnapshot('key-1'));
    expect(store.has('key-1')).toBe(true);
  });

  it('overwrites an existing entry', () => {
    const store = new InMemorySnapshotStore();
    const snap1 = makeFakeSnapshot('key-1');
    const snap2 = makeFakeSnapshot('key-1-v2');
    store.set('key-1', snap1);
    store.set('key-1', snap2);
    expect(store.get('key-1')).toBe(snap2);
  });
});

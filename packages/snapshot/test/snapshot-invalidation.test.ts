/**
 * SP-0512 — Per-competition snapshot invalidation
 * Acceptance criteria: F-01, F-02, G-01
 */
import { describe, it, expect } from 'vitest';
import { InMemorySnapshotStore } from '../src/index.js';
import type { DashboardSnapshotDTO } from '../src/dto/dashboard-snapshot.js';

function makeSnap(competitionId: string, suffix = ''): DashboardSnapshotDTO {
  const key = `${competitionId}|season:test|2026-01-01T12:00:00Z|policy@1${suffix}`;
  return {
    header: {
      snapshotSchemaVersion: 1,
      snapshotKey: key,
      competitionId,
      seasonId: 'season:test',
      buildNowUtc: '2026-01-01T12:00:00Z',
      timezone: 'UTC',
      policyKey: 'policy',
      policyVersion: 1,
      computedAtUtc: '2026-01-01T12:00:00Z',
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

function storeKey(competitionId: string, suffix = ''): string {
  return `${competitionId}|season:test|2026-01-01T12:00:00Z|policy@1${suffix}`;
}

describe('InMemorySnapshotStore — per-competition invalidation (SP-0512)', () => {
  it('invalidate(comp-A) removes all entries for comp-A; comp-B entries remain untouched', () => {
    const store = new InMemorySnapshotStore();

    const snapA1 = makeSnap('comp:a');
    const snapA2 = makeSnap('comp:a', '|jornada:2');
    const snapB = makeSnap('comp:b');

    store.set(storeKey('comp:a'), snapA1);
    store.set(storeKey('comp:a', '|jornada:2'), snapA2);
    store.set(storeKey('comp:b'), snapB);

    store.invalidate('comp:a');

    expect(store.get(storeKey('comp:a'))).toBeUndefined();
    expect(store.get(storeKey('comp:a', '|jornada:2'))).toBeUndefined();
    expect(store.get(storeKey('comp:b'))).toBe(snapB);
  });

  it('invalidate returns the count of removed entries', () => {
    const store = new InMemorySnapshotStore();

    store.set(storeKey('comp:a'), makeSnap('comp:a'));
    store.set(storeKey('comp:a', '|jornada:2'), makeSnap('comp:a', '|jornada:2'));
    store.set(storeKey('comp:b'), makeSnap('comp:b'));

    const removed = store.invalidate('comp:a');
    expect(removed).toBe(2);
  });

  it('invalidate returns 0 when no entries match the competition', () => {
    const store = new InMemorySnapshotStore();
    store.set(storeKey('comp:b'), makeSnap('comp:b'));

    const removed = store.invalidate('comp:a');
    expect(removed).toBe(0);
    // comp:b is untouched
    expect(store.get(storeKey('comp:b'))).toBeDefined();
  });

  it('after invalidate, get() returns undefined for that competition', () => {
    const store = new InMemorySnapshotStore();
    store.set(storeKey('comp:a'), makeSnap('comp:a'));

    store.invalidate('comp:a');

    expect(store.get(storeKey('comp:a'))).toBeUndefined();
  });

  it('after invalidate, getStale() returns undefined for that competition', () => {
    const store = new InMemorySnapshotStore(1); // 1ms TTL so entry is stale immediately
    store.set(storeKey('comp:a'), makeSnap('comp:a'));

    return new Promise<void>((resolve) =>
      setTimeout(() => {
        // Entry is stale but still in the store
        expect(store.getStale(storeKey('comp:a'))).toBeDefined();

        store.invalidate('comp:a');

        // Now it is gone even from stale access
        expect(store.getStale(storeKey('comp:a'))).toBeUndefined();
        resolve();
      }, 5),
    );
  });

  it('invalidateAll() still clears everything', () => {
    const store = new InMemorySnapshotStore();
    store.set(storeKey('comp:a'), makeSnap('comp:a'));
    store.set(storeKey('comp:b'), makeSnap('comp:b'));

    store.invalidateAll();

    expect(store.get(storeKey('comp:a'))).toBeUndefined();
    expect(store.get(storeKey('comp:b'))).toBeUndefined();
  });

  it('prefix-of-another safety: comp:a does not invalidate comp:a:b (separator ensures exactness)', () => {
    const store = new InMemorySnapshotStore();

    // comp:a:b is a different competition whose ID starts with "comp:a"
    // The key separator `|` ensures `comp:a|...` does NOT match `comp:a:b|...`
    const snapA = makeSnap('comp:a');
    const snapAB = makeSnap('comp:a:b');

    store.set(storeKey('comp:a'), snapA);
    store.set(storeKey('comp:a:b'), snapAB);

    store.invalidate('comp:a');

    // comp:a:b must NOT be removed — `comp:a|` is not a prefix of `comp:a:b|...`
    expect(store.get(storeKey('comp:a:b'))).toBe(snapAB);
    // comp:a IS removed
    expect(store.get(storeKey('comp:a'))).toBeUndefined();
  });
});

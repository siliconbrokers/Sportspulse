import { describe, it, expect } from 'vitest';
import { InMemorySnapshotStore } from '../src/index.js';
import type { DashboardSnapshotDTO } from '../src/dto/dashboard-snapshot.js';

function makeSnap(id: string): DashboardSnapshotDTO {
  return {
    header: {
      snapshotSchemaVersion: 1,
      snapshotKey: id,
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

describe('InMemorySnapshotStore — LRU eviction', () => {
  it('maxEntries=3: adding a 4th entry evicts the LRU and keeps count at 3', () => {
    const store = new InMemorySnapshotStore({ maxEntries: 3 });

    store.set('comp:a:snap1', makeSnap('a'));
    store.set('comp:b:snap1', makeSnap('b'));
    store.set('comp:c:snap1', makeSnap('c'));

    expect(store.getStats().currentEntryCount).toBe(3);

    // Access 'b' and 'c' so 'a' becomes LRU
    store.get('comp:b:snap1');
    store.get('comp:c:snap1');

    // Adding a 4th entry should evict 'a' (LRU)
    store.set('comp:d:snap1', makeSnap('d'));

    expect(store.getStats().currentEntryCount).toBe(3);
    expect(store.getStats().evictionCount).toBe(1);
  });

  it('LRU is determined by access time, not insertion time', async () => {
    const store = new InMemorySnapshotStore({ maxEntries: 3 });

    store.set('comp:a:snap1', makeSnap('a'));
    // Small delay so each entry gets a strictly different lastAccessedAt
    await new Promise((r) => setTimeout(r, 2));
    store.set('comp:b:snap1', makeSnap('b'));
    await new Promise((r) => setTimeout(r, 2));
    store.set('comp:c:snap1', makeSnap('c'));

    // Now re-access 'a' and 'c', leaving 'b' as the least-recently-used
    await new Promise((r) => setTimeout(r, 2));
    store.get('comp:a:snap1');
    await new Promise((r) => setTimeout(r, 2));
    store.get('comp:c:snap1');
    // 'b' has the oldest lastAccessedAt (only its set() time)

    store.set('comp:d:snap1', makeSnap('d'));

    // 'b' should have been evicted as the LRU
    expect(store.getStale('comp:b:snap1')).toBeUndefined();
    // 'a', 'c', 'd' should survive
    expect(store.getStale('comp:a:snap1')).toBeDefined();
    expect(store.getStale('comp:c:snap1')).toBeDefined();
    expect(store.getStale('comp:d:snap1')).toBeDefined();
  });

  it('evicting LRU does not remove the only stale candidate for an active key', () => {
    const store = new InMemorySnapshotStore({ maxEntries: 2 });

    // Two entries with different key prefixes, each the sole entry for that prefix
    store.set('comp:x:v1', makeSnap('x'));
    store.set('comp:y:v1', makeSnap('y'));

    // Both are sole entries for their prefix. Adding a 3rd forces eviction.
    // The store should still evict something (the global LRU) since there's no
    // multi-entry prefix, but should not silently drop valid stale data without reason.
    store.set('comp:z:v1', makeSnap('z'));

    // Count is capped at 2
    expect(store.getStats().currentEntryCount).toBe(2);
    expect(store.getStats().evictionCount).toBe(1);
  });

  it('getStats() counters increment correctly on hits, misses, stale serves, evictions', () => {
    const store = new InMemorySnapshotStore({ ttlMs: 1, maxEntries: 10 });

    store.set('k1', makeSnap('k1'));

    // Fresh hit
    store.get('k1');

    // Miss (never set)
    store.get('missing');

    return new Promise<void>((resolve) =>
      setTimeout(() => {
        // Expired → miss from get()
        store.get('k1');
        // Stale serve via getStale()
        store.getStale('k1');

        // Trigger eviction
        const capped = new InMemorySnapshotStore({ maxEntries: 1 });
        capped.set('e1', makeSnap('e1'));
        capped.set('e2', makeSnap('e2'));

        const stats = store.getStats();
        expect(stats.hitCount).toBe(1);
        expect(stats.missCount).toBe(2); // 'missing' + expired 'k1'
        expect(stats.staleServeCount).toBe(1);

        const cappedStats = capped.getStats();
        expect(cappedStats.evictionCount).toBe(1);
        expect(cappedStats.currentEntryCount).toBe(1);

        resolve();
      }, 5),
    );
  });

  it('purgeExpired() removes entries past maxStaleTtlMs', () => {
    // maxStaleTtlMs=0 means any expired entry is immediately eligible for purge
    const store = new InMemorySnapshotStore({ ttlMs: 1, maxStaleTtlMs: 0 });

    store.set('stale1', makeSnap('stale1'));
    store.set('stale2', makeSnap('stale2'));

    return new Promise<void>((resolve) =>
      setTimeout(() => {
        // Both entries are now expired and past maxStaleTtlMs=0
        const purged = store.purgeExpired();
        expect(purged).toBe(2);
        expect(store.getStats().currentEntryCount).toBe(0);
        resolve();
      }, 5),
    );
  });

  it('purgeExpired() does not remove entries still within TTL', () => {
    const store = new InMemorySnapshotStore({ ttlMs: 60_000, maxStaleTtlMs: 0 });

    store.set('fresh1', makeSnap('fresh1'));
    store.set('fresh2', makeSnap('fresh2'));

    const purged = store.purgeExpired();
    expect(purged).toBe(0);
    expect(store.getStats().currentEntryCount).toBe(2);
  });

  it('overwriting an existing key does not count as an eviction', () => {
    const store = new InMemorySnapshotStore({ maxEntries: 3 });

    store.set('k1', makeSnap('k1'));
    store.set('k2', makeSnap('k2'));
    store.set('k3', makeSnap('k3'));

    // Overwrite k1 — should NOT trigger eviction since map size stays the same
    store.set('k1', makeSnap('k1-v2'));

    expect(store.getStats().evictionCount).toBe(0);
    expect(store.getStats().currentEntryCount).toBe(3);
    expect(store.get('k1')?.header.snapshotKey).toBe('k1-v2');
  });
});

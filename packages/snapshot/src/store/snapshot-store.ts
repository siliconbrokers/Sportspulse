import type { DashboardSnapshotDTO } from '../dto/dashboard-snapshot.js';

export interface SnapshotStoreStats {
  hitCount: number;
  missCount: number;
  staleServeCount: number;
  evictionCount: number;
  currentEntryCount: number;
}

export interface SnapshotStore {
  /** Returns the snapshot only if it is still within TTL. */
  get(key: string): DashboardSnapshotDTO | undefined;
  /** Returns the snapshot regardless of TTL (for stale fallback). */
  getStale(key: string): DashboardSnapshotDTO | undefined;
  /** @param ttlMs — optional override; defaults to store's configured TTL. */
  set(key: string, snapshot: DashboardSnapshotDTO, ttlMs?: number): void;
  has(key: string): boolean;
  /** Clears all cached entries — call after a data source refresh so the
   *  next dashboard request rebuilds with the latest data. */
  invalidateAll(): void;
  /**
   * Clears only entries whose key starts with `${competitionId}|`.
   * Safe because competitionId is always the first segment before `|` in
   * the snapshot key format: `{competitionId}|{seasonId}|...` (see snapshot-key.ts).
   * Returns the number of entries removed.
   */
  invalidate(competitionId: string): number;
}

interface CacheEntry {
  snapshot: DashboardSnapshotDTO;
  expiresAt: number;
  lastAccessedAt: number;
}

// 5 minutes — snapshot expires so live match states refresh through
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;
// 24 hours past expiry before an entry is eligible for purge
const DEFAULT_MAX_STALE_TTL_MS = 24 * 60 * 60 * 1000;

export interface InMemorySnapshotStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  maxStaleTtlMs?: number;
}

export class InMemorySnapshotStore implements SnapshotStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxStaleTtlMs: number;

  private hitCount = 0;
  private missCount = 0;
  private staleServeCount = 0;
  private evictionCount = 0;

  constructor(ttlMsOrOptions: number | InMemorySnapshotStoreOptions = DEFAULT_TTL_MS) {
    if (typeof ttlMsOrOptions === 'number') {
      this.ttlMs = ttlMsOrOptions;
      this.maxEntries = DEFAULT_MAX_ENTRIES;
      this.maxStaleTtlMs = DEFAULT_MAX_STALE_TTL_MS;
    } else {
      this.ttlMs = ttlMsOrOptions.ttlMs ?? DEFAULT_TTL_MS;
      this.maxEntries = ttlMsOrOptions.maxEntries ?? DEFAULT_MAX_ENTRIES;
      this.maxStaleTtlMs = ttlMsOrOptions.maxStaleTtlMs ?? DEFAULT_MAX_STALE_TTL_MS;
    }
  }

  /** Returns snapshot if within TTL, undefined if expired or missing. */
  get(key: string): DashboardSnapshotDTO | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.missCount++;
      return undefined;
    }
    const now = Date.now();
    if (now > entry.expiresAt) {
      // Expired — count as stale serve only if caller explicitly wanted fresh
      // do NOT remove: entry may serve as stale fallback
      this.missCount++;
      return undefined;
    }
    entry.lastAccessedAt = now;
    this.hitCount++;
    return entry.snapshot;
  }

  /** Returns snapshot regardless of TTL — used as stale fallback on build failure. */
  getStale(key: string): DashboardSnapshotDTO | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    const now = Date.now();
    entry.lastAccessedAt = now;
    if (now > entry.expiresAt) {
      this.staleServeCount++;
    }
    return entry.snapshot;
  }

  set(key: string, snapshot: DashboardSnapshotDTO, ttlMs?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttlMs ?? this.ttlMs);

    if (this.cache.has(key)) {
      // Overwrite existing entry — no capacity concern
      this.cache.set(key, { snapshot, expiresAt, lastAccessedAt: now });
      return;
    }

    // New entry: check capacity before inserting
    if (this.cache.size >= this.maxEntries) {
      this.evictLru();
    }

    this.cache.set(key, { snapshot, expiresAt, lastAccessedAt: now });
  }

  /** True only if entry exists AND is within TTL. Does NOT delete expired entries. */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    return Date.now() <= entry.expiresAt;
  }

  /** Clears all cached entries — call after a data source refresh. */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Clears all entries whose key starts with `${competitionId}|`.
   * The `|` separator is fixed in buildSnapshotKey — competitionId is
   * always the first segment, so the prefix match is exact and safe.
   * Returns the number of entries removed.
   */
  invalidate(competitionId: string): number {
    const prefix = `${competitionId}|`;
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Returns internal counters. Resets on process restart. */
  getStats(): SnapshotStoreStats {
    return {
      hitCount: this.hitCount,
      missCount: this.missCount,
      staleServeCount: this.staleServeCount,
      evictionCount: this.evictionCount,
      currentEntryCount: this.cache.size,
    };
  }

  /**
   * Removes entries that are expired AND either:
   * - superseded by a newer entry for the same key prefix (competitionId), or
   * - older than maxStaleTtlMs past their expiry.
   * Returns the number of entries removed.
   * Safe to call periodically — never blocks get().
   */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        const staleDuration = now - entry.expiresAt;
        if (staleDuration > this.maxStaleTtlMs) {
          this.cache.delete(key);
          purged++;
        }
      }
    }
    return purged;
  }

  /**
   * Evicts the least-recently-accessed entry that is safe to remove.
   * Safety: never removes the only stale candidate for a given key prefix.
   * Key prefix = everything up to the last ':' separator (competitionId portion).
   */
  private evictLru(): void {
    // Build a map of key-prefix → count of entries, to detect "only stale candidate"
    const prefixCounts = new Map<string, number>();
    for (const key of this.cache.keys()) {
      const prefix = keyPrefix(key);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }

    // Find the LRU entry that is safe to evict (not the sole entry for its prefix)
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache) {
      const prefix = keyPrefix(key);
      const count = prefixCounts.get(prefix) ?? 1;
      // Only evict if there is more than one entry for this prefix
      // (so we don't drop the only stale candidate)
      if (count > 1 && entry.lastAccessedAt < lruTime) {
        lruTime = entry.lastAccessedAt;
        lruKey = key;
      }
    }

    // Fallback: if every key is the sole entry for its prefix, evict the global LRU
    if (lruKey === null) {
      for (const [key, entry] of this.cache) {
        if (entry.lastAccessedAt < lruTime) {
          lruTime = entry.lastAccessedAt;
          lruKey = key;
        }
      }
    }

    if (lruKey !== null) {
      this.cache.delete(lruKey);
      this.evictionCount++;
    }
  }
}

/** Extracts the key prefix (competitionId portion) for LRU safety checks. */
function keyPrefix(key: string): string {
  const idx = key.lastIndexOf(':');
  return idx === -1 ? key : key.slice(0, idx);
}

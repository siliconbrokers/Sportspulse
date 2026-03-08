import type { DashboardSnapshotDTO } from '../dto/dashboard-snapshot.js';

export interface SnapshotStore {
  /** Returns the snapshot only if it is still within TTL. */
  get(key: string): DashboardSnapshotDTO | undefined;
  /** Returns the snapshot regardless of TTL (for stale fallback). */
  getStale(key: string): DashboardSnapshotDTO | undefined;
  /** @param ttlMs — optional override; defaults to store's configured TTL. */
  set(key: string, snapshot: DashboardSnapshotDTO, ttlMs?: number): void;
  has(key: string): boolean;
}

interface CacheEntry {
  snapshot: DashboardSnapshotDTO;
  expiresAt: number;
}

// 5 minutes — snapshot expires so live match states refresh through
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class InMemorySnapshotStore implements SnapshotStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Returns snapshot if within TTL, undefined if expired or missing. */
  get(key: string): DashboardSnapshotDTO | undefined {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) return undefined;
    return entry.snapshot;
  }

  /** Returns snapshot regardless of TTL — used as stale fallback on build failure. */
  getStale(key: string): DashboardSnapshotDTO | undefined {
    return this.cache.get(key)?.snapshot;
  }

  set(key: string, snapshot: DashboardSnapshotDTO, ttlMs?: number): void {
    this.cache.set(key, { snapshot, expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
  }

  /** True only if entry exists AND is within TTL. Does NOT delete expired entries. */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    return Date.now() <= entry.expiresAt;
  }
}

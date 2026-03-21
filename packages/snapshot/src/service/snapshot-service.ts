import type { Team, Match } from '@sportpulse/canonical';
import type { PolicyDefinition } from '@sportpulse/scoring';
import type { TreemapContainer } from '@sportpulse/layout';
import type { DashboardSnapshotDTO } from '../dto/dashboard-snapshot.js';
import type { SnapshotStore } from '../store/snapshot-store.js';
import { buildSnapshot } from '../build/build-snapshot.js';
import { buildSnapshotKey, buildNowUtcFromDate } from '../identity/snapshot-key.js';
import { persistSeed, loadSeeds } from '../persistence/snapshot-seed-store.js';

export interface SnapshotServiceConfig {
  store: SnapshotStore;
  defaultPolicy: PolicyDefinition;
  defaultContainer: TreemapContainer;
  /** Directory for disk-persisted seed files. Defaults to "cache/snapshots". */
  seedDir?: string;
  /**
   * If set, enables periodic stats logging every `statsIntervalMs` milliseconds.
   * Default: disabled (no periodic logging).
   */
  statsIntervalMs?: number;
}

export interface SnapshotServiceStats {
  entries: number;
  hitCount: number;
  missCount: number;
  staleServeCount: number;
  evictionCount: number;
  buildCount: number;
  totalBuildMs: number;
  avgBuildMs: number;
}

export interface ServeSnapshotInput {
  competitionId: string;
  seasonId: string;
  dateLocal: string;
  timezone: string;
  teams: readonly Team[];
  matches: readonly Match[];
  freshnessUtc?: string;
  matchday?: number;
  subTournamentKey?: string;
}

export interface ServeResult {
  snapshot: DashboardSnapshotDTO;
  source: 'cache' | 'fresh' | 'stale_fallback';
}

export class SnapshotBuildFailed extends Error {
  readonly code = 'SNAPSHOT_BUILD_FAILED';
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SnapshotBuildFailed';
  }
}

export class SnapshotService {
  private readonly store: SnapshotStore;
  private readonly policy: PolicyDefinition;
  private readonly container: TreemapContainer;
  private readonly seedDir: string;

  private buildCount = 0;
  private totalBuildMs = 0;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SnapshotServiceConfig) {
    this.store = config.store;
    this.policy = config.defaultPolicy;
    this.container = config.defaultContainer;
    this.seedDir = config.seedDir ?? 'cache/snapshots';

    if (config.statsIntervalMs != null && config.statsIntervalMs > 0) {
      this.statsTimer = setInterval(() => {
        this.logStats();
      }, config.statsIntervalMs);
      // Do not prevent process exit when this is the only remaining timer.
      if (typeof this.statsTimer.unref === 'function') {
        this.statsTimer.unref();
      }
    }
  }

  /** Reads store-level counters safely — getStats() is optional on SnapshotStore. */
  private readStoreStats() {
    return (
      this.store as {
        getStats?: () => {
          hitCount: number;
          missCount: number;
          staleServeCount: number;
          evictionCount: number;
          currentEntryCount: number;
        };
      }
    ).getStats?.();
  }

  /** Logs a summary of store counters and build metrics. */
  logStats(): void {
    const s = this.readStoreStats();
    console.log(
      `[SnapshotService] Stats: entries=${s?.currentEntryCount ?? 0} hits=${s?.hitCount ?? 0} misses=${s?.missCount ?? 0} staleServes=${s?.staleServeCount ?? 0} evictions=${s?.evictionCount ?? 0} builds=${this.buildCount} totalBuildMs=${this.totalBuildMs}`,
    );
  }

  /** Returns the current in-memory stats snapshot. */
  getStats(): SnapshotServiceStats {
    const s = this.readStoreStats();
    return {
      entries: s?.currentEntryCount ?? 0,
      hitCount: s?.hitCount ?? 0,
      missCount: s?.missCount ?? 0,
      staleServeCount: s?.staleServeCount ?? 0,
      evictionCount: s?.evictionCount ?? 0,
      buildCount: this.buildCount,
      totalBuildMs: this.totalBuildMs,
      avgBuildMs: this.buildCount > 0 ? Math.round(this.totalBuildMs / this.buildCount) : 0,
    };
  }

  /** Stops the periodic stats timer, if running. */
  stopStatsTimer(): void {
    if (this.statsTimer !== null) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  serve(input: ServeSnapshotInput): ServeResult {
    const buildNowUtc = buildNowUtcFromDate(input.dateLocal, input.timezone);
    const key = buildSnapshotKey(
      input.competitionId,
      input.seasonId,
      buildNowUtc,
      this.policy.policyKey,
      this.policy.policyVersion,
      input.matchday,
      input.subTournamentKey,
    );

    // 1. Cache hit — snapshot within TTL, return immediately
    const cached = this.store.get(key);
    if (cached) {
      return { snapshot: cached, source: 'cache' };
    }

    // Capture any existing snapshot (even expired) BEFORE the build attempt.
    // This is the stale fallback available if the fresh build fails.
    const staleSnapshot = this.store.getStale(key);

    // 2. Try fresh build
    try {
      const buildStart = Date.now();
      const snapshot = buildSnapshot({
        competitionId: input.competitionId,
        seasonId: input.seasonId,
        buildNowUtc,
        timezone: input.timezone,
        teams: input.teams,
        matches: input.matches,
        policy: this.policy,
        container: this.container,
        freshnessUtc: input.freshnessUtc,
        matchday: input.matchday,
      });
      const buildMs = Date.now() - buildStart;

      this.buildCount++;
      this.totalBuildMs += buildMs;

      // Use a short TTL when there's a live match so scores update quickly.
      // Zombie-aware: also treat any match within 180 min of kickoff as live
      // even if the DTO status hasn't been updated yet (API lag, stale cache).
      const nowMs = Date.now();
      const hasLive = snapshot.matchCards?.some((c) => {
        if (c.status === 'LIVE') return true;
        if (c.status === 'FINISHED') return false;
        if (c.kickoffUtc) {
          const elapsedMin = (nowMs - new Date(c.kickoffUtc).getTime()) / 60_000;
          return elapsedMin >= 0 && elapsedMin < 180;
        }
        return false;
      });
      const ttlMs = hasLive ? 60_000 : 5 * 60_000;
      this.store.set(key, snapshot, ttlMs);

      console.log(
        `[SnapshotService] served source=fresh competition=${input.competitionId} buildMs=${buildMs}`,
      );

      // Persist last-good snapshot to disk asynchronously — never blocks the response path.
      persistSeed(input.competitionId, snapshot, this.seedDir).catch((err) => {
        console.error('[SnapshotService] Unexpected error in persistSeed:', err);
      });

      return { snapshot, source: 'fresh' };
    } catch (err) {
      // 3. Stale fallback — serve the expired snapshot with a warning rather than a 503
      if (staleSnapshot) {
        console.warn(
          `[SnapshotService] served source=stale_fallback competition=${input.competitionId} key=${key}`,
        );
        const withWarning: DashboardSnapshotDTO = {
          ...staleSnapshot,
          warnings: [
            ...staleSnapshot.warnings,
            {
              code: 'STALE_DATA',
              severity: 'WARN',
              message: 'Serving cached snapshot due to build failure',
            },
          ],
        };
        return { snapshot: withWarning, source: 'stale_fallback' };
      }

      // 4. No data at all — throw 503
      throw new SnapshotBuildFailed('Snapshot build failed and no cached version available', err);
    }
  }

  /**
   * Loads all valid seed files from disk and inserts them into the in-memory store
   * as stale (TTL = 0, already expired). They will serve as stale fallback if a
   * fresh build fails immediately after startup.
   *
   * Call once at startup, before the server accepts requests.
   * Never throws — missing or corrupt seeds are skipped with a warning.
   */
  async loadAndSeedFromDisk(seedDir?: string): Promise<void> {
    const dir = seedDir ?? this.seedDir;
    const seeds = await loadSeeds(dir, this.policy.policyKey, this.policy.policyVersion);
    for (const { snapshot } of seeds) {
      const key = buildSnapshotKey(
        snapshot.header.competitionId,
        snapshot.header.seasonId ?? '',
        snapshot.header.buildNowUtc,
        snapshot.header.policyKey,
        snapshot.header.policyVersion,
      );
      // Insert with TTL = 0 so it is immediately expired.
      // getStale() will still return it for stale fallback purposes.
      this.store.set(key, snapshot, 0);
    }
    if (seeds.length > 0) {
      console.log(
        `[SnapshotService] Seeded ${seeds.length} snapshot(s) from disk as stale fallback`,
      );
    }
  }

  /**
   * Clears all cached snapshots.
   * Call after each data source refresh so the next dashboard request rebuilds
   * with the latest canonical data, keeping MatchCardList and PronosticoCard
   * (which reads live from DataSource) consistent.
   */
  invalidateAll(): void {
    this.store.invalidateAll();
  }

  /**
   * Clears only cached snapshots for the given competition.
   * Use this when a single competition's data was refreshed — it avoids
   * evicting valid cache entries for unaffected competitions.
   * Returns the number of entries removed.
   */
  invalidateCompetition(competitionId: string): number {
    const n = this.store.invalidate(competitionId);
    console.log(`[SnapshotService] Invalidated ${n} entries for ${competitionId}`);
    return n;
  }
}

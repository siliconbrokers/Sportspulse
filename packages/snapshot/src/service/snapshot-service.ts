import type { Team, Match } from '@sportpulse/canonical';
import type { PolicyDefinition } from '@sportpulse/scoring';
import type { TreemapContainer } from '@sportpulse/layout';
import type { DashboardSnapshotDTO } from '../dto/dashboard-snapshot.js';
import type { SnapshotStore } from '../store/snapshot-store.js';
import { buildSnapshot } from '../build/build-snapshot.js';
import { buildSnapshotKey, buildNowUtcFromDate } from '../identity/snapshot-key.js';

export interface SnapshotServiceConfig {
  store: SnapshotStore;
  defaultPolicy: PolicyDefinition;
  defaultContainer: TreemapContainer;
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

  constructor(config: SnapshotServiceConfig) {
    this.store = config.store;
    this.policy = config.defaultPolicy;
    this.container = config.defaultContainer;
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

      // Use a short TTL when there's a live match so scores update quickly.
      const hasLive = snapshot.matchCards?.some((c) => c.status === 'LIVE');
      const ttlMs = hasLive ? 60_000 : 5 * 60_000;
      this.store.set(key, snapshot, ttlMs);
      return { snapshot, source: 'fresh' };
    } catch (err) {
      // 3. Stale fallback — serve the expired snapshot with a warning rather than a 503
      if (staleSnapshot) {
        console.warn(`[SnapshotService] Build failed, serving stale snapshot for key=${key}`);
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
   * Clears all cached snapshots.
   * Call after each data source refresh so the next dashboard request rebuilds
   * with the latest canonical data, keeping MatchCardList and PronosticoCard
   * (which reads live from DataSource) consistent.
   */
  invalidateAll(): void {
    this.store.invalidateAll();
  }
}

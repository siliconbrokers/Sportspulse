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
    );

    // 1. Cache hit
    if (this.store.has(key)) {
      return { snapshot: this.store.get(key)!, source: 'cache' };
    }

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

      this.store.set(key, snapshot);
      return { snapshot, source: 'fresh' };
    } catch (err) {
      // 3. Stale fallback
      if (this.store.has(key)) {
        const stale = this.store.get(key)!;
        // Inject STALE_DATA warning
        const withWarning: DashboardSnapshotDTO = {
          ...stale,
          warnings: [
            ...stale.warnings,
            {
              code: 'STALE_DATA',
              severity: 'WARN',
              message: 'Serving cached snapshot due to build failure',
            },
          ],
        };
        return { snapshot: withWarning, source: 'stale_fallback' };
      }

      // 4. No cache, no build -> throw
      throw new SnapshotBuildFailed('Snapshot build failed and no cached version available', err);
    }
  }
}

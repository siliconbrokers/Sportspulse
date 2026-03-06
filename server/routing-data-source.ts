import type { Team, Match } from '@sportpulse/canonical';
import type { DataSource, StandingEntry } from '@sportpulse/snapshot';

/**
 * Composite DataSource that routes each call to the appropriate provider
 * based on the competitionId (for competition-scoped methods) or the
 * providerKey embedded in the seasonId (for season-scoped methods).
 *
 * This is the single point of provider resolution for the entire system.
 * No "if (league === 'uruguay')" conditionals exist anywhere else.
 *
 * Routing rules:
 * - Competition-scoped calls  → resolved by competitionId lookup
 * - Season-scoped calls       → resolved by providerKey extracted from seasonId
 * - Unknown competitionId     → falls through to the default DataSource
 *
 * SeasonId format: "season:{providerKey}:{providerSeasonId}"
 * This encoding is guaranteed by `canonicalId()` in @sportpulse/canonical.
 */
export class RoutingDataSource implements DataSource {
  private readonly byCompetitionId: Map<string, DataSource>;
  private readonly byProviderKey: Map<string, DataSource>;
  private readonly fallback: DataSource;

  constructor(
    fallback: DataSource,
    routes: Array<{ competitionId: string; providerKey: string; source: DataSource }>,
  ) {
    this.fallback = fallback;
    this.byCompetitionId = new Map(routes.map((r) => [r.competitionId, r.source]));
    this.byProviderKey = new Map(routes.map((r) => [r.providerKey, r.source]));
  }

  getTeams(competitionId: string): Team[] {
    return this.resolveByComp(competitionId).getTeams(competitionId);
  }

  getMatches(seasonId: string): Match[] {
    return this.resolveBySeasonId(seasonId).getMatches(seasonId);
  }

  getSeasonId(competitionId: string): string | undefined {
    return this.resolveByComp(competitionId).getSeasonId(competitionId);
  }

  getStandings(competitionId: string): StandingEntry[] {
    return this.resolveByComp(competitionId).getStandings?.(competitionId) ?? [];
  }

  getCurrentMatchday(competitionId: string): number | undefined {
    return this.resolveByComp(competitionId).getCurrentMatchday?.(competitionId);
  }

  getLastPlayedMatchday(competitionId: string): number | undefined {
    return this.resolveByComp(competitionId).getLastPlayedMatchday?.(competitionId);
  }

  getTotalMatchdays(competitionId: string): number {
    return this.resolveByComp(competitionId).getTotalMatchdays?.(competitionId) ?? 38;
  }

  // ── Internal resolution ────────────────────────────────────────────────────

  private resolveByComp(competitionId: string): DataSource {
    return this.byCompetitionId.get(competitionId) ?? this.fallback;
  }

  /** Extracts providerKey from "season:{providerKey}:{...}" format. */
  private resolveBySeasonId(seasonId: string): DataSource {
    const providerKey = seasonId.split(':')[1];
    return this.byProviderKey.get(providerKey) ?? this.fallback;
  }
}

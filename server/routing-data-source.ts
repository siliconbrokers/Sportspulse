import type { Team, Match } from '@sportpulse/canonical';
import type { DataSource, StandingEntry, MatchGoalEventDTO, SubTournamentInfo } from '@sportpulse/snapshot';

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

  getMatches(seasonId: string, subTournamentKey?: string): Match[] {
    return this.resolveBySeasonId(seasonId).getMatches(seasonId, subTournamentKey);
  }

  getSeasonId(competitionId: string): string | undefined {
    return this.resolveByComp(competitionId).getSeasonId(competitionId);
  }

  getStandings(competitionId: string, subTournamentKey?: string): StandingEntry[] {
    return this.resolveByComp(competitionId).getStandings?.(competitionId, subTournamentKey) ?? [];
  }

  getSubTournaments(competitionId: string): SubTournamentInfo[] {
    return this.resolveByComp(competitionId).getSubTournaments?.(competitionId) ?? [];
  }

  getActiveSubTournament(competitionId: string): string | undefined {
    return this.resolveByComp(competitionId).getActiveSubTournament?.(competitionId);
  }

  getCurrentMatchday(competitionId: string, subTournamentKey?: string): number | undefined {
    return this.resolveByComp(competitionId).getCurrentMatchday?.(competitionId, subTournamentKey);
  }

  getLastPlayedMatchday(competitionId: string, subTournamentKey?: string): number | undefined {
    return this.resolveByComp(competitionId).getLastPlayedMatchday?.(competitionId, subTournamentKey);
  }

  getNextMatchday(competitionId: string, subTournamentKey?: string): number | undefined {
    const source = this.resolveByComp(competitionId);
    // Use the source's own implementation when available
    if (source.getNextMatchday) return source.getNextMatchday(competitionId, subTournamentKey);
    // Generic fallback: compute from canonical matches so new sources get this for free
    const seasonId = source.getSeasonId(competitionId);
    if (!seasonId) return undefined;
    const nowUtc = new Date().toISOString();
    let next: number | undefined = undefined;
    for (const m of source.getMatches(seasonId)) {
      if (
        m.matchday === undefined ||
        m.status !== 'SCHEDULED' ||
        !m.startTimeUtc ||
        m.startTimeUtc <= nowUtc
      )
        continue;
      if (next === undefined || m.matchday < next) next = m.matchday;
    }
    return next;
  }

  getTotalMatchdays(competitionId: string, subTournamentKey?: string): number {
    return this.resolveByComp(competitionId).getTotalMatchdays?.(competitionId, subTournamentKey) ?? 38;
  }

  async getMatchGoals(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> {
    // Only football-data.org matches have goal events
    // Canonical matchId format: "match:{providerKey}:..."
    const providerKey = canonicalMatchId.split(':')[1];
    const source = this.byProviderKey.get(providerKey) ?? this.fallback;
    return source.getMatchGoals?.(canonicalMatchId) ?? [];
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

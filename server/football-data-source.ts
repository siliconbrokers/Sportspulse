import type { Team, Match } from '@sportpulse/canonical';
import {
  normalizeIngestion,
  competitionId as canonicalCompId,
  teamId as canonicalTeamId,
  PROVIDER_KEY,
} from '@sportpulse/canonical';
import type {
  FDCompetitionResponse,
  FDTeamResponse,
  FDMatchResponse,
} from '@sportpulse/canonical';
import type { DataSource, StandingEntry } from '@sportpulse/snapshot';

interface FDStandingsResponse {
  standings: Array<{
    type: string;
    table: Array<{
      position: number;
      team: { id: number; name: string; shortName: string; crest: string };
      playedGames: number;
      won: number;
      draw: number;
      lost: number;
      goalsFor: number;
      goalsAgainst: number;
      goalDifference: number;
      points: number;
    }>;
  }>;
}

interface CachedData {
  teams: Team[];
  matches: Match[];
  standings: StandingEntry[];
  seasonId: string | undefined;
  currentMatchday: number | undefined;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * DataSource implementation backed by football-data.org API v4.
 *
 * Fetches competition, teams, and matches, normalizes through the
 * canonical pipeline, and caches results in memory.
 */
export class FootballDataSource implements DataSource {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private cache = new Map<string, CachedData>();

  constructor(apiToken: string, baseUrl = 'https://api.football-data.org/v4') {
    this.apiToken = apiToken;
    this.baseUrl = baseUrl;
  }

  getTeams(compId: string): Team[] {
    const cached = this.getCached(compId);
    return cached?.teams ?? [];
  }

  getMatches(seasId: string): Match[] {
    for (const entry of this.cache.values()) {
      if (entry.seasonId === seasId) {
        return entry.matches;
      }
    }
    return [];
  }

  getSeasonId(compId: string): string | undefined {
    const cached = this.getCached(compId);
    return cached?.seasonId;
  }

  getStandings(compId: string): StandingEntry[] {
    const cached = this.getCached(compId);
    return cached?.standings ?? [];
  }

  getCurrentMatchday(compId: string): number | undefined {
    const cached = this.getCached(compId);
    return cached?.currentMatchday;
  }

  getTotalMatchdays(compId: string): number {
    const cached = this.getCached(compId);
    if (!cached) return 38;
    const matchdays = new Set<number>();
    for (const m of cached.matches) {
      if (m.matchday) matchdays.add(m.matchday);
    }
    return matchdays.size || 38;
  }

  /**
   * Pre-fetches and caches data for a competition code (e.g., 'PD' for La Liga).
   * Must be called before getTeams/getMatches/getSeasonId will return data.
   */
  async fetchCompetition(competitionCode: string): Promise<void> {
    const compId = canonicalCompId(PROVIDER_KEY, competitionCode);
    const nowUtc = new Date().toISOString();

    const [fdComp, fdTeams, fdMatchesResp, fdStandings] = await Promise.all([
      this.apiGet<FDCompetitionResponse>(`/competitions/${competitionCode}`),
      this.apiGet<{ teams: FDTeamResponse[] }>(`/competitions/${competitionCode}/teams`),
      this.apiGet<{ matches: FDMatchResponse[]; resultSet?: { count: number } }>(`/competitions/${competitionCode}/matches`),
      this.apiGet<FDStandingsResponse>(`/competitions/${competitionCode}/standings`).catch(() => null),
    ]);

    const fdMatches = fdMatchesResp.matches;
    const result = normalizeIngestion(fdComp, fdTeams.teams, fdMatches, nowUtc);

    // Extract currentMatchday from the first match's season data
    const currentMatchday = (fdMatches[0] as { season?: { currentMatchday?: number } })?.season?.currentMatchday;

    if (result.skippedMatchIds.length > 0) {
      console.warn(`[FootballDataSource] Skipped ${result.skippedMatchIds.length} unresolvable matches`);
    }

    // Map standings
    const totalTable = fdStandings?.standings?.find((s) => s.type === 'TOTAL');
    const standings: StandingEntry[] = (totalTable?.table ?? []).map((row) => ({
      position: row.position,
      teamId: canonicalTeamId(PROVIDER_KEY, String(row.team.id)),
      teamName: row.team.name,
      crestUrl: row.team.crest || undefined,
      playedGames: row.playedGames,
      won: row.won,
      draw: row.draw,
      lost: row.lost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      goalDifference: row.goalDifference,
      points: row.points,
    }));

    this.cache.set(compId, {
      teams: result.teams,
      matches: result.matches,
      standings,
      seasonId: result.season?.seasonId,
      currentMatchday,
      fetchedAt: Date.now(),
    });

    console.log(
      `[FootballDataSource] Fetched ${competitionCode}: ${result.teams.length} teams, ${result.matches.length} matches`,
    );
  }

  private getCached(compId: string): CachedData | undefined {
    const cached = this.cache.get(compId);
    if (!cached) return undefined;
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return undefined;
    return cached;
  }

  private async apiGet<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { 'X-Auth-Token': this.apiToken },
    });

    if (!res.ok) {
      throw new Error(`football-data.org ${res.status}: ${url}`);
    }

    return res.json() as Promise<T>;
  }
}

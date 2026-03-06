import type { Team, Match } from '@sportpulse/canonical';
import {
  normalizeIngestion,
  competitionId as canonicalCompId,
  PROVIDER_KEY,
} from '@sportpulse/canonical';
import type {
  FDCompetitionResponse,
  FDTeamResponse,
  FDMatchResponse,
} from '@sportpulse/canonical';
import type { DataSource } from '@sportpulse/snapshot';

interface CachedData {
  teams: Team[];
  matches: Match[];
  seasonId: string | undefined;
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

  /**
   * Pre-fetches and caches data for a competition code (e.g., 'PD' for La Liga).
   * Must be called before getTeams/getMatches/getSeasonId will return data.
   */
  async fetchCompetition(competitionCode: string): Promise<void> {
    const compId = canonicalCompId(PROVIDER_KEY, competitionCode);
    const nowUtc = new Date().toISOString();

    const [fdComp, fdTeams, fdMatches] = await Promise.all([
      this.apiGet<FDCompetitionResponse>(`/competitions/${competitionCode}`),
      this.apiGet<{ teams: FDTeamResponse[] }>(`/competitions/${competitionCode}/teams`),
      this.apiGet<{ matches: FDMatchResponse[] }>(`/competitions/${competitionCode}/matches`),
    ]);

    const result = normalizeIngestion(fdComp, fdTeams.teams, fdMatches.matches, nowUtc);

    if (result.skippedMatchIds.length > 0) {
      console.warn(`[FootballDataSource] Skipped ${result.skippedMatchIds.length} unresolvable matches`);
    }

    this.cache.set(compId, {
      teams: result.teams,
      matches: result.matches,
      seasonId: result.season?.seasonId,
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

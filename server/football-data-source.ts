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
import { checkMatchdayCache, persistMatchdayCache, logCache, buildCachePath } from './matchday-cache.js';

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
  /** Count of FINISHED matches when standings were last fetched from the API.
   *  Standings are only re-fetched when this count increases (i.e. a new match finished). */
  standingsFinishedCount: number;
  seasonId: string | undefined;
  season: string | undefined; // raw season string for file cache paths (e.g. "2025-26")
  currentMatchday: number | undefined;
  fetchedAt: number;
}

/** Derives a human-readable season string from start/end dates. */
function deriveSeason(startDate: string, endDate?: string): string {
  const sy = parseInt(startDate.slice(0, 4), 10);
  if (!endDate) return String(sy);
  const ey = parseInt(endDate.slice(0, 4), 10);
  return ey > sy ? `${sy}-${String(ey).slice(2)}` : String(sy);
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

  getLastPlayedMatchday(compId: string): number | undefined {
    const cached = this.getCached(compId);
    if (!cached) return undefined;

    // Build stats per matchday: total matches and finished matches
    const stats = new Map<number, { total: number; finished: number }>();
    for (const m of cached.matches) {
      if (m.matchday === undefined) continue;
      const s = stats.get(m.matchday) ?? { total: 0, finished: 0 };
      s.total++;
      if (m.status === 'FINISHED') s.finished++;
      stats.set(m.matchday, s);
    }

    // Highest matchday where ALL matches are finished
    let last: number | undefined = undefined;
    for (const [md, s] of stats) {
      if (s.total > 0 && s.finished === s.total) {
        if (last === undefined || md > last) last = md;
      }
    }
    return last;
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
    const prevCache = this.cache.get(compId);
    const nowUtc = new Date().toISOString();

    // §15.1 – log API fetch intent
    const logCtxBase = {
      provider: PROVIDER_KEY,
      competitionId: competitionCode,
      season: prevCache?.season ?? '?',
      matchday: prevCache?.currentMatchday ?? 0,
      cachePath: prevCache?.season && prevCache?.currentMatchday !== undefined
        ? buildCachePath(PROVIDER_KEY, competitionCode, prevCache.season, prevCache.currentMatchday)
        : buildCachePath(PROVIDER_KEY, competitionCode, '?', 0),
    };
    logCache({ event: 'CACHE_API_FETCH', ...logCtxBase });

    // Phase 1: fetch competition metadata, teams and matches (always needed)
    let fdComp: FDCompetitionResponse;
    let fdTeams: { teams: FDTeamResponse[] };
    let fdMatchesResp: { matches: FDMatchResponse[]; resultSet?: { count: number } };

    try {
      [fdComp, fdTeams, fdMatchesResp] = await Promise.all([
        this.apiGet<FDCompetitionResponse>(`/competitions/${competitionCode}`),
        this.apiGet<{ teams: FDTeamResponse[] }>(`/competitions/${competitionCode}/teams`),
        this.apiGet<{ matches: FDMatchResponse[]; resultSet?: { count: number } }>(`/competitions/${competitionCode}/matches`),
      ]);
    } catch (err) {
      logCache({ event: 'CACHE_API_ERROR', ...logCtxBase });
      throw err;
    }

    const fdMatches = fdMatchesResp.matches;
    const result = normalizeIngestion(fdComp, fdTeams.teams, fdMatches, nowUtc);

    // Extract currentMatchday from the first match's season data
    const currentMatchday = (fdMatches[0] as { season?: { currentMatchday?: number } })?.season?.currentMatchday;
    const season = deriveSeason(
      fdComp.currentSeason?.startDate ?? String(new Date().getFullYear()),
      fdComp.currentSeason?.endDate,
    );

    if (result.skippedMatchIds.length > 0) {
      console.warn(`[FootballDataSource] Skipped ${result.skippedMatchIds.length} unresolvable matches`);
    }

    // §15.1 – per-matchday cache flow: check → validate → reuse if valid → otherwise persist
    const matchesByMatchday = new Map<number, Match[]>();
    for (const m of result.matches) {
      if (m.matchday === undefined) continue;
      const group = matchesByMatchday.get(m.matchday) ?? [];
      group.push(m);
      matchesByMatchday.set(m.matchday, group);
    }

    const allMatches: Match[] = [];
    for (const [md, apiMatches] of matchesByMatchday) {
      const cached = checkMatchdayCache(PROVIDER_KEY, competitionCode, season, md);
      if (cached.hit) {
        allMatches.push(...cached.matches);
      } else {
        allMatches.push(...apiMatches);
        persistMatchdayCache(PROVIDER_KEY, competitionCode, season, md, apiMatches);
      }
    }
    // Matches without a matchday number are not cached per-matchday
    for (const m of result.matches) {
      if (m.matchday === undefined) allMatches.push(m);
    }

    // Phase 2: standings — only re-fetch from API when new matches have finished.
    // The table only changes when a match reaches FINISHED status, so tracking
    // the count of finished matches is sufficient to know when a refresh is needed.
    const finishedCount = allMatches.filter((m) => m.status === 'FINISHED').length;
    const prevFinishedCount = prevCache?.standingsFinishedCount ?? -1;

    let standings: StandingEntry[] = prevCache?.standings ?? [];
    if (finishedCount !== prevFinishedCount || standings.length === 0) {
      console.log(
        `[FootballDataSource] Standings refresh ${competitionCode}: finished ${prevFinishedCount}→${finishedCount}`,
      );
      const fdStandings = await this.apiGet<FDStandingsResponse>(
        `/competitions/${competitionCode}/standings`,
      ).catch(() => null);
      const totalTable = fdStandings?.standings?.find((s) => s.type === 'TOTAL');
      standings = (totalTable?.table ?? []).map((row) => ({
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
    } else {
      console.log(
        `[FootballDataSource] Standings SKIP ${competitionCode}: no new finished matches (${finishedCount})`,
      );
    }

    this.cache.set(compId, {
      teams: result.teams,
      matches: allMatches,
      standings,
      standingsFinishedCount: finishedCount,
      seasonId: result.season?.seasonId,
      season,
      currentMatchday,
      fetchedAt: Date.now(),
    });

    console.log(
      `[FootballDataSource] Fetched ${competitionCode}: ${result.teams.length} teams, ${allMatches.length} matches`,
    );
  }

  private getCached(compId: string): CachedData | undefined {
    // Always return cached data even if stale — the periodic setInterval
    // handles refreshes. Returning undefined (→ empty arrays) would cause
    // the snapshot to be built with no teams when the TTL happens to expire
    // between refresh cycles.
    return this.cache.get(compId);
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

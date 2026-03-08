import type { Team, Match } from '@sportpulse/canonical';
import {
  normalizeIngestion,
  competitionId as canonicalCompId,
  seasonId as canonicalSeasonId,
  teamId as canonicalTeamId,
  matchId as canonicalMatchId,
  mapMatch as mapFDMatch,
  PROVIDER_KEY,
} from '@sportpulse/canonical';
import type {
  FDCompetitionResponse,
  FDTeamResponse,
  FDMatchResponse,
} from '@sportpulse/canonical';
import type { DataSource, StandingEntry } from '@sportpulse/snapshot';
import { checkMatchdayCache, persistMatchdayCache, persistTeamsCache, loadTeamsCache, persistStandingsCache, loadStandingsCache, logCache, buildCachePath } from './matchday-cache.js';

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
  /** Timestamp of last competition metadata fetch (TTL: 7 days). */
  compInfoFetchedAt: number;
  /** Timestamp of last teams fetch (TTL: 7 days). */
  teamsFetchedAt: number;
  /** Whether a full-season matches fetch has been performed at least once. */
  fullSeasonFetched: boolean;
}

/** Derives a human-readable season string from start/end dates. */
function deriveSeason(startDate: string, endDate?: string): string {
  const sy = parseInt(startDate.slice(0, 4), 10);
  if (!endDate) return String(sy);
  const ey = parseInt(endDate.slice(0, 4), 10);
  return ey > sy ? `${sy}-${String(ey).slice(2)}` : String(sy);
}

/** TTL for competition metadata and teams (7 days — essentially immutable within a season). */
const COMP_INFO_TTL_MS = 7 * 24 * 3600_000;
const TEAMS_TTL_MS     = 7 * 24 * 3600_000;

/** Window for incremental match refresh: past 2 days + next 7 days. */
const WINDOW_PAST_DAYS   = 2;
const WINDOW_FUTURE_DAYS = 7;

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
   *
   * Optimization strategy (per spec §6, §9, §10):
   *   - Competition info + teams: TTL 7 days (nearly immutable within a season)
   *   - Matches: full-season fetch on first load, then incremental date-range window
   *     (last 2 days + next 7 days) merged into the existing in-memory map
   *   - Standings: only re-fetched when finishedCount increases
   */
  async fetchCompetition(competitionCode: string): Promise<void> {
    const compId = canonicalCompId(PROVIDER_KEY, competitionCode);
    const prevCache = this.cache.get(compId);
    const nowMs = Date.now();
    const nowUtc = new Date(nowMs).toISOString();

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

    // ── Phase 1A: competition metadata (TTL 7 days) ───────────────────────────
    const compInfoStale = !prevCache || (nowMs - prevCache.compInfoFetchedAt) > COMP_INFO_TTL_MS;
    let fdComp: FDCompetitionResponse | null = null;
    if (compInfoStale) {
      try {
        fdComp = await this.apiGet<FDCompetitionResponse>(`/competitions/${competitionCode}`);
        console.log(`[FootballDataSource] comp-info fetched ${competitionCode}`);
      } catch (err) {
        logCache({ event: 'CACHE_API_ERROR', ...logCtxBase });
        if (!prevCache) throw err; // no fallback on first load
        console.warn(`[FootballDataSource] comp-info fetch failed for ${competitionCode}, reusing cached`);
      }
    } else {
      console.log(`[FootballDataSource] comp-info SKIP ${competitionCode}: within 7-day TTL`);
    }

    // ── Phase 1B: teams (TTL 7 days) ─────────────────────────────────────────
    // Resolution priority:
    //   1. In-memory cache within TTL  → skip API
    //   2. Disk file cache within TTL  → skip API (avoids rate limit on restart)
    //   3. API call
    //   4. In-memory stale / disk stale → warn, continue
    const teamsInMemoryFresh = prevCache && (nowMs - prevCache.teamsFetchedAt) <= TEAMS_TTL_MS;
    let fdTeams: { teams: FDTeamResponse[] } | null = null;
    let diskFallbackTeams: Team[] | null = null;

    if (teamsInMemoryFresh) {
      console.log(`[FootballDataSource] teams SKIP ${competitionCode}: within 7-day in-memory TTL`);
    } else {
      // Check disk cache first — if fresh, skip API call entirely (saves rate limit budget)
      const diskTeams = loadTeamsCache(PROVIDER_KEY, competitionCode);
      if (diskTeams) {
        diskFallbackTeams = diskTeams;
        console.log(`[FootballDataSource] teams SKIP ${competitionCode}: loaded from disk cache (${diskTeams.length} teams)`);
      } else {
        // Disk stale or absent — must call API
        try {
          fdTeams = await this.apiGet<{ teams: FDTeamResponse[] }>(`/competitions/${competitionCode}/teams`);
          console.log(`[FootballDataSource] teams fetched ${competitionCode}: ${fdTeams.teams.length}`);
        } catch (err) {
          logCache({ event: 'CACHE_API_ERROR', ...logCtxBase });
          if (!prevCache) {
            console.warn(`[FootballDataSource] teams API failed ${competitionCode}, no fallback — aborting`);
            throw err;
          }
          console.warn(`[FootballDataSource] teams fetch failed for ${competitionCode}, reusing in-memory cached`);
        }
      }
    }

    // We need at least competition metadata to derive season string.
    // On the very first load, fdComp must be non-null (thrown above if it fails).
    // On subsequent refreshes where TTL hasn't expired, derive season from prevCache.
    const season = fdComp
      ? deriveSeason(
          fdComp.currentSeason?.startDate ?? String(new Date().getFullYear()),
          fdComp.currentSeason?.endDate,
        )
      : prevCache!.season!;

    // ── Phase 2: matches ──────────────────────────────────────────────────────
    // First load → full season fetch. Subsequent refreshes → date-range window only,
    // then merge into the existing in-memory map.
    const isFirstLoad = !prevCache?.fullSeasonFetched;

    let fdMatchesResp: { matches: FDMatchResponse[]; resultSet?: { count: number } };
    try {
      if (isFirstLoad) {
        fdMatchesResp = await this.apiGet<{ matches: FDMatchResponse[]; resultSet?: { count: number } }>(
          `/competitions/${competitionCode}/matches`,
        );
        console.log(`[FootballDataSource] full-season fetch ${competitionCode}: ${fdMatchesResp.matches.length} matches`);
      } else {
        // Incremental: only the mutable window
        const dateFrom = new Date(nowMs - WINDOW_PAST_DAYS   * 86400_000).toISOString().slice(0, 10);
        const dateTo   = new Date(nowMs + WINDOW_FUTURE_DAYS * 86400_000).toISOString().slice(0, 10);
        fdMatchesResp = await this.apiGet<{ matches: FDMatchResponse[]; resultSet?: { count: number } }>(
          `/competitions/${competitionCode}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
        );
        console.log(`[FootballDataSource] window fetch ${competitionCode} [${dateFrom}..${dateTo}]: ${fdMatchesResp.matches.length} matches`);
      }
    } catch (err) {
      logCache({ event: 'CACHE_API_ERROR', ...logCtxBase });
      if (!prevCache) throw err;
      console.warn(`[FootballDataSource] matches fetch failed for ${competitionCode}, reusing cached`);
      // Use prevCache data entirely — nothing to merge
      const prevFinishedCount = prevCache.standingsFinishedCount;
      this.cache.set(compId, { ...prevCache, fetchedAt: nowMs });
      console.log(`[FootballDataSource] ${competitionCode}: serving cached data (fetch error)`);
      void prevFinishedCount; // suppress unused warning
      return;
    }

    const fdMatches = fdMatchesResp.matches;

    // Extract currentMatchday from the first match's season data
    const currentMatchday = (fdMatches[0] as { season?: { currentMatchday?: number } })?.season?.currentMatchday
      ?? prevCache?.currentMatchday;

    // Normalize matches.
    // If we have fresh teams from the API, use the full normalizeIngestion pipeline.
    // If teams are from cache (TTL not expired), build the team ID map from the cached
    // canonical teams and call mapMatch directly — no need for raw FDTeamResponse.
    let normalizedMatches: Match[];
    let normalizedTeams: Team[];
    let normalizedSeasonId: string | undefined;
    const skippedIds: string[] = [];

    if (fdTeams && fdComp) {
      // Full normalization path: fresh comp + fresh teams from API
      const result = normalizeIngestion(fdComp, fdTeams.teams, fdMatches, nowUtc);
      normalizedMatches = result.matches;
      normalizedTeams = result.teams;
      normalizedSeasonId = result.season?.seasonId;
      if (result.skippedMatchIds.length > 0) {
        console.warn(`[FootballDataSource] Skipped ${result.skippedMatchIds.length} unresolvable matches`);
      }
      skippedIds.push(...result.skippedMatchIds);
      // Persist teams to disk for future recovery after rate-limit restarts
      persistTeamsCache(PROVIDER_KEY, competitionCode, normalizedTeams);
    } else {
      // Incremental / fallback path: teams from in-memory cache or disk fallback
      // Reconstruct team ID map from canonical teams (providerTeamId → canonicalTeamId)
      const cachedTeams = prevCache?.teams ?? diskFallbackTeams ?? [];
      const teamIdMap = new Map<string, string>(
        cachedTeams.filter((t) => t.providerTeamId).map((t) => [t.providerTeamId!, t.teamId]),
      );
      // seasonId: use prevCache if available, otherwise derive from fdComp (disk fallback on first load)
      const seasId = prevCache?.seasonId
        ?? (fdComp?.currentSeason ? canonicalSeasonId(PROVIDER_KEY, String(fdComp.currentSeason.id)) : undefined)
        ?? '';
      normalizedMatches = [];
      for (const fd of fdMatches) {
        const mId = canonicalMatchId(PROVIDER_KEY, String(fd.id));
        const m = mapFDMatch(fd, mId, seasId, teamIdMap, nowUtc);
        if (m) {
          normalizedMatches.push(m);
        } else {
          skippedIds.push(String(fd.id));
        }
      }
      normalizedTeams = cachedTeams; // unchanged
      normalizedSeasonId = seasId || prevCache?.seasonId;
      if (skippedIds.length > 0) {
        console.warn(`[FootballDataSource] Skipped ${skippedIds.length} unresolvable matches (incremental)`);
      }
    }

    // §15.1 – per-matchday cache flow: check → validate → reuse if valid → otherwise persist
    const matchesByMatchday = new Map<number, Match[]>();
    for (const m of normalizedMatches) {
      if (m.matchday === undefined) continue;
      const group = matchesByMatchday.get(m.matchday) ?? [];
      group.push(m);
      matchesByMatchday.set(m.matchday, group);
    }

    const windowMatches: Match[] = [];
    for (const [md, apiMatches] of matchesByMatchday) {
      const cached = checkMatchdayCache(PROVIDER_KEY, competitionCode, season, md);
      if (cached.hit) {
        windowMatches.push(...cached.matches);
      } else {
        windowMatches.push(...apiMatches);
        persistMatchdayCache(PROVIDER_KEY, competitionCode, season, md, apiMatches);
      }
    }
    for (const m of normalizedMatches) {
      if (m.matchday === undefined) windowMatches.push(m);
    }

    // Merge window results into existing in-memory map.
    // Historical matches (outside the window) stay intact from prevCache.
    let allMatches: Match[];
    if (isFirstLoad) {
      allMatches = windowMatches;
    } else {
      // Build a map from the existing matches, overwrite with fresh window data
      const matchMap = new Map<string, Match>(
        (prevCache?.matches ?? []).map((m) => [m.matchId, m]),
      );
      for (const m of windowMatches) {
        matchMap.set(m.matchId, m);
      }
      allMatches = [...matchMap.values()];
    }

    // ── Standings: only re-fetch when finishedCount increases ────────────────
    const finishedCount = allMatches.filter((m) => m.status === 'FINISHED').length;
    const prevFinishedCount = prevCache?.standingsFinishedCount ?? -1;

    let standings: StandingEntry[] = prevCache?.standings ?? [];
    const standingsNeedRefresh = finishedCount !== prevFinishedCount || standings.length === 0;
    if (standingsNeedRefresh) {
      console.log(
        `[FootballDataSource] Standings refresh ${competitionCode}: finished ${prevFinishedCount}→${finishedCount}`,
      );
      // Load disk cache — if fresh enough (1 day) AND we have no major finishedCount change,
      // we can skip the API call. On major change (new finished matches), always refetch.
      const finishedCountChanged = finishedCount !== prevFinishedCount && prevFinishedCount !== -1;
      const diskStandings = finishedCountChanged ? null : loadStandingsCache(PROVIDER_KEY, competitionCode);
      if (diskStandings && standings.length === 0) {
        // First load: disk cache is fresh enough, skip API call
        standings = diskStandings;
        console.log(`[FootballDataSource] Standings loaded from disk cache ${competitionCode} (${standings.length} rows, skipping API)`);
      } else {
        let fdStandings: FDStandingsResponse | null = null;
        try {
          fdStandings = await this.apiGet<FDStandingsResponse>(`/competitions/${competitionCode}/standings`);
        } catch (err) {
          console.warn(`[FootballDataSource] Standings API failed for ${competitionCode}:`, (err as Error).message);
          // API failed: try disk cache as fallback
          const fallback = loadStandingsCache(PROVIDER_KEY, competitionCode);
          if (fallback) {
            standings = fallback;
            console.warn(`[FootballDataSource] Standings loaded from disk fallback ${competitionCode} (${standings.length} rows)`);
          }
        }
        if (fdStandings) {
          const totalTable = fdStandings.standings?.find((s) => s.type === 'TOTAL');
          const fetched = (totalTable?.table ?? []).map((row) => ({
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
          if (fetched.length > 0) {
            standings = fetched;
            persistStandingsCache(PROVIDER_KEY, competitionCode, standings);
          }
        }
      }
    } else {
      console.log(
        `[FootballDataSource] Standings SKIP ${competitionCode}: no new finished matches (${finishedCount})`,
      );
    }

    this.cache.set(compId, {
      teams: normalizedTeams,
      matches: allMatches,
      standings,
      standingsFinishedCount: finishedCount,
      seasonId: normalizedSeasonId ?? prevCache?.seasonId,
      season,
      currentMatchday,
      fetchedAt: nowMs,
      compInfoFetchedAt: fdComp ? nowMs : (prevCache?.compInfoFetchedAt ?? 0),
      teamsFetchedAt: fdTeams ? nowMs : (prevCache?.teamsFetchedAt ?? 0),
      fullSeasonFetched: true,
    });

    console.log(
      `[FootballDataSource] Fetched ${competitionCode}: ${allMatches.length} matches total` +
      ` (window=${windowMatches.length}, teams=${fdTeams ? normalizedTeams.length : 'cached'})`,
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

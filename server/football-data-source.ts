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
import { CrestCache } from './crest-cache.js';
import type {
  FDCompetitionResponse,
  FDTeamResponse,
  FDMatchResponse,
} from '@sportpulse/canonical';
import type { DataSource, StandingEntry, MatchGoalEventDTO, TopScorerEntry } from '@sportpulse/snapshot';
import { checkMatchdayCache, persistMatchdayCache, persistTeamsCache, loadTeamsCache, persistStandingsCache, loadStandingsCache, logCache, buildCachePath, persistCompInfoCache, loadCompInfoCache, hasMatchdayCacheForSeason, loadAllMatchdaysForSeason } from './matchday-cache.js';

interface FDStandingsResponse {
  standings: Array<{
    type: string;
    table: Array<{
      position: number;
      team: { id: number; name: string; shortName: string; tla?: string; crest: string };
      playedGames: number;
      won: number;
      draw: number;
      lost: number;
      goalsFor: number;
      goalsAgainst: number;
      goalDifference: number;
      points: number;
      form?: string | null;
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
interface FDScorersResponse {
  scorers: Array<{
    player: { id: number; name: string };
    team: { id: number; name: string; crest: string };
    playedMatches: number;
    goals: number;
    assists: number | null;
    penalties: number | null;
  }>;
}

export class FootballDataSource implements DataSource {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private cache = new Map<string, CachedData>();
  private readonly goalsCache = new Map<string, MatchGoalEventDTO[]>();
  private readonly scorersCache = new Map<string, { data: TopScorerEntry[]; fetchedAt: number }>();
  private static readonly SCORERS_TTL_MS = 60 * 60_000; // 1 hora
  private readonly crestCache = new CrestCache();

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

  getNextMatchday(compId: string): number | undefined {
    const cached = this.getCached(compId);
    if (!cached) return undefined;

    const nowUtc = new Date().toISOString();
    // Find the lowest matchday that has at least one SCHEDULED match in the future
    let next: number | undefined = undefined;
    for (const m of cached.matches) {
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

    // ── Phase 1A: comp-info → season + seasonId ───────────────────────────────
    // Priority: in-memory (7d TTL) → disk cache (7d TTL) → API call
    const compInfoInMemoryFresh = prevCache && (nowMs - prevCache.compInfoFetchedAt) <= COMP_INFO_TTL_MS;
    let fdComp: FDCompetitionResponse | null = null;
    let season: string;
    let resolvedSeasonId: string;
    let compInfoFetchedAt: number;

    if (compInfoInMemoryFresh) {
      season = prevCache!.season!;
      resolvedSeasonId = prevCache!.seasonId ?? '';
      compInfoFetchedAt = prevCache!.compInfoFetchedAt;
      console.log(`[FootballDataSource] comp-info SKIP ${competitionCode}: in-memory TTL`);
    } else {
      const diskCompInfo = loadCompInfoCache(PROVIDER_KEY, competitionCode);
      if (diskCompInfo) {
        season = diskCompInfo.season;
        resolvedSeasonId = diskCompInfo.seasonId;
        compInfoFetchedAt = nowMs; // reset in-memory TTL from disk load
        console.log(`[FootballDataSource] comp-info SKIP ${competitionCode}: disk cache (season=${season})`);
      } else {
        // Must call API
        try {
          fdComp = await this.apiGet<FDCompetitionResponse>(`/competitions/${competitionCode}`);
          season = deriveSeason(
            fdComp.currentSeason?.startDate ?? String(new Date().getFullYear()),
            fdComp.currentSeason?.endDate,
          );
          resolvedSeasonId = fdComp.currentSeason
            ? canonicalSeasonId(PROVIDER_KEY, String(fdComp.currentSeason.id))
            : '';
          compInfoFetchedAt = nowMs;
          persistCompInfoCache(PROVIDER_KEY, competitionCode, { season, seasonId: resolvedSeasonId });
          console.log(`[FootballDataSource] comp-info fetched ${competitionCode} → season=${season}`);
        } catch (err) {
          const logCtxErr = {
            provider: PROVIDER_KEY, competitionId: competitionCode,
            season: prevCache?.season ?? '?', matchday: 0,
            cachePath: buildCachePath(PROVIDER_KEY, competitionCode, prevCache?.season ?? '?', 0),
          };
          logCache({ event: 'CACHE_API_ERROR', ...logCtxErr });
          if (!prevCache) throw err;
          console.warn(`[FootballDataSource] comp-info fetch failed for ${competitionCode}, reusing cached`);
          season = prevCache.season!;
          resolvedSeasonId = prevCache.seasonId ?? '';
          compInfoFetchedAt = prevCache.compInfoFetchedAt;
        }
      }
    }

    const logCtxBase = {
      provider: PROVIDER_KEY,
      competitionId: competitionCode,
      season,
      matchday: prevCache?.currentMatchday ?? 0,
      cachePath: prevCache?.currentMatchday !== undefined
        ? buildCachePath(PROVIDER_KEY, competitionCode, season, prevCache.currentMatchday)
        : buildCachePath(PROVIDER_KEY, competitionCode, season, 0),
    };
    logCache({ event: 'CACHE_API_FETCH', ...logCtxBase });

    // ── Phase 1B: teams (TTL 7 days) ─────────────────────────────────────────
    const teamsInMemoryFresh = prevCache && (nowMs - prevCache.teamsFetchedAt) <= TEAMS_TTL_MS;
    let fdTeams: { teams: FDTeamResponse[] } | null = null;
    let diskFallbackTeams: Team[] | null = null;

    if (teamsInMemoryFresh) {
      console.log(`[FootballDataSource] teams SKIP ${competitionCode}: within 7-day in-memory TTL`);
    } else {
      const diskTeams = loadTeamsCache(PROVIDER_KEY, competitionCode);
      if (diskTeams) {
        diskFallbackTeams = diskTeams;
        console.log(`[FootballDataSource] teams SKIP ${competitionCode}: loaded from disk cache (${diskTeams.length} teams)`);
      } else {
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

    // ── Phase 2: matches ──────────────────────────────────────────────────────
    // isFirstLoad: true only if we have no matchday files on disk AND no in-memory history.
    // On restart with warm disk cache: isFirstLoad=false → use incremental window.
    const isFirstLoad = !prevCache?.fullSeasonFetched && !hasMatchdayCacheForSeason(PROVIDER_KEY, competitionCode, season);

    // Base matches: in-memory → disk matchday files → empty (first load)
    const baseMatches: Match[] = prevCache?.matches ??
      (isFirstLoad ? [] : loadAllMatchdaysForSeason(PROVIDER_KEY, competitionCode, season));

    let fdMatchesResp: { matches: FDMatchResponse[]; resultSet?: { count: number } };
    try {
      if (isFirstLoad) {
        fdMatchesResp = await this.apiGet<{ matches: FDMatchResponse[]; resultSet?: { count: number } }>(
          `/competitions/${competitionCode}/matches`,
        );
        console.log(`[FootballDataSource] full-season fetch ${competitionCode}: ${fdMatchesResp.matches.length} matches`);
      } else {
        const dateFrom = new Date(nowMs - WINDOW_PAST_DAYS   * 86400_000).toISOString().slice(0, 10);
        const dateTo   = new Date(nowMs + WINDOW_FUTURE_DAYS * 86400_000).toISOString().slice(0, 10);
        fdMatchesResp = await this.apiGet<{ matches: FDMatchResponse[]; resultSet?: { count: number } }>(
          `/competitions/${competitionCode}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
        );
        console.log(`[FootballDataSource] window fetch ${competitionCode} [${dateFrom}..${dateTo}]: ${fdMatchesResp.matches.length} matches`);
      }
    } catch (err) {
      logCache({ event: 'CACHE_API_ERROR', ...logCtxBase });
      if (!prevCache && baseMatches.length === 0) throw err;
      console.warn(`[FootballDataSource] matches fetch failed for ${competitionCode}, reusing cached`);
      this.cache.set(compId, { ...prevCache!, fetchedAt: nowMs });
      return;
    }

    const fdMatches = fdMatchesResp.matches;

    // Extract currentMatchday from match season metadata
    const currentMatchday = (fdMatches[0] as { season?: { currentMatchday?: number } })?.season?.currentMatchday
      ?? prevCache?.currentMatchday;

    // Normalize matches
    let normalizedMatches: Match[];
    let normalizedTeams: Team[];
    const skippedIds: string[] = [];

    if (fdTeams && fdComp) {
      // Full normalization: fresh comp + fresh teams from API
      const result = normalizeIngestion(fdComp, fdTeams.teams, fdMatches, nowUtc);
      normalizedMatches = result.matches;
      normalizedTeams = result.teams;
      if (result.skippedMatchIds.length > 0) {
        console.warn(`[FootballDataSource] Skipped ${result.skippedMatchIds.length} unresolvable matches`);
      }
      skippedIds.push(...result.skippedMatchIds);
      persistTeamsCache(PROVIDER_KEY, competitionCode, normalizedTeams);
    } else {
      // Incremental / fallback: teams from in-memory or disk cache
      const cachedTeams = prevCache?.teams ?? diskFallbackTeams ?? [];
      const teamIdMap = new Map<string, string>(
        cachedTeams.filter((t) => t.providerTeamId).map((t) => [t.providerTeamId!, t.teamId]),
      );
      const seasId = resolvedSeasonId || prevCache?.seasonId || '';
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
      normalizedTeams = cachedTeams;
      if (skippedIds.length > 0) {
        console.warn(`[FootballDataSource] Skipped ${skippedIds.length} unresolvable matches (incremental)`);
      }
    }

    // Per-matchday cache flow
    const matchesByMatchday = new Map<number, Match[]>();
    for (const m of normalizedMatches) {
      if (m.matchday === undefined) continue;
      const group = matchesByMatchday.get(m.matchday) ?? [];
      group.push(m);
      matchesByMatchday.set(m.matchday, group);
    }

    const windowMatches: Match[] = [];
    for (const [md, apiMatches] of matchesByMatchday) {
      // Optimization: skip processing if the matchday is already cached as fully
      // FINISHED (immutable data, 1-year TTL). Avoids unnecessary disk writes and
      // merge work for data that cannot change. Only applies on incremental fetches
      // (isFirstLoad=false) since on first load there is no prior cache to trust.
      if (!isFirstLoad) {
        const cached = checkMatchdayCache(PROVIDER_KEY, competitionCode, season, md);
        if (cached.hit && cached.matches.length > 0 && cached.matches.every((m) => m.status === 'FINISHED')) {
          // All matches confirmed finished and cache is fresh — reuse, skip persist.
          windowMatches.push(...cached.matches);
          continue;
        }
      }

      // Merge API results with base matches for this matchday.
      // This preserves matches from earlier dates that fall outside the current
      // fetch window (e.g. a jornada split across two weekends: day 1 matches
      // are outside the window when day 2 matches are fetched, but must not be lost).
      // Fresh API data always wins for matches present in both sets.
      const baseForMd = isFirstLoad ? [] : baseMatches.filter((m) => m.matchday === md);
      const mergedMap = new Map<string, Match>(baseForMd.map((m) => [m.matchId, m]));
      for (const m of apiMatches) mergedMap.set(m.matchId, m);
      const mergedForMd = [...mergedMap.values()];
      windowMatches.push(...mergedForMd);
      persistMatchdayCache(PROVIDER_KEY, competitionCode, season, md, mergedForMd);
    }
    for (const m of normalizedMatches) {
      if (m.matchday === undefined) windowMatches.push(m);
    }

    // Merge window results into base matches
    let allMatches: Match[];
    if (isFirstLoad) {
      allMatches = windowMatches;
    } else {
      const matchMap = new Map<string, Match>(baseMatches.map((m) => [m.matchId, m]));
      for (const m of windowMatches) {
        matchMap.set(m.matchId, m);
      }
      allMatches = [...matchMap.values()];
    }

    // Standings: only re-fetch when finishedCount increases
    const finishedCount = allMatches.filter((m) => m.status === 'FINISHED').length;
    const prevFinishedCount = prevCache?.standingsFinishedCount ?? -1;

    let standings: StandingEntry[] = prevCache?.standings ?? [];
    const standingsNeedRefresh = finishedCount !== prevFinishedCount || standings.length === 0;
    if (standingsNeedRefresh) {
      console.log(
        `[FootballDataSource] Standings refresh ${competitionCode}: finished ${prevFinishedCount}→${finishedCount}`,
      );
      const finishedCountChanged = finishedCount !== prevFinishedCount && prevFinishedCount !== -1;
      const diskStandings = finishedCountChanged ? null : loadStandingsCache(PROVIDER_KEY, competitionCode);
      if (diskStandings && standings.length === 0) {
        standings = diskStandings;
        console.log(`[FootballDataSource] Standings loaded from disk cache ${competitionCode} (${standings.length} rows, skipping API)`);
      } else {
        let fdStandings: FDStandingsResponse | null = null;
        try {
          fdStandings = await this.apiGet<FDStandingsResponse>(`/competitions/${competitionCode}/standings`);
        } catch (err) {
          console.warn(`[FootballDataSource] Standings API failed for ${competitionCode}:`, (err as Error).message);
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
            tla: row.team.tla || undefined,
            crestUrl: row.team.crest || undefined,
            playedGames: row.playedGames,
            won: row.won,
            draw: row.draw,
            lost: row.lost,
            goalsFor: row.goalsFor,
            goalsAgainst: row.goalsAgainst,
            goalDifference: row.goalDifference,
            points: row.points,
            form: row.form ?? null,
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
      seasonId: resolvedSeasonId || prevCache?.seasonId,
      season,
      currentMatchday,
      fetchedAt: nowMs,
      compInfoFetchedAt,
      teamsFetchedAt: fdTeams ? nowMs : (prevCache?.teamsFetchedAt ?? 0),
      fullSeasonFetched: true,
    });

    console.log(
      `[FootballDataSource] Fetched ${competitionCode}: ${allMatches.length} matches total` +
      ` (window=${windowMatches.length}, teams=${fdTeams ? normalizedTeams.length : 'cached'})`,
    );

    // Fire-and-forget: download and cache crest images locally.
    // Always runs (whether teams came from API or disk cache) — CrestCache handles already-cached files safely.
    this.crestCache.warmup(
      normalizedTeams
        .filter((t) => t.providerTeamId)
        .map((t) => ({ providerTeamId: t.providerTeamId!, crestUrl: t.crestUrl })),
      PROVIDER_KEY,
    ).then((urlMap) => {
      const cached = this.cache.get(compId);
      if (!cached) return;
      this.cache.set(compId, {
        ...cached,
        teams: cached.teams.map((t) => ({
          ...t,
          crestUrl: t.providerTeamId ? (urlMap.get(t.providerTeamId) ?? t.crestUrl) : t.crestUrl,
        })),
        standings: cached.standings.map((s) => {
          const teamProvId = s.teamId.split(':')[2];
          return teamProvId ? { ...s, crestUrl: urlMap.get(teamProvId) ?? s.crestUrl } : s;
        }),
      });
      console.log(`[FootballDataSource] crest cache warm ${competitionCode} (${urlMap.size} teams)`);
    }).catch((err) => {
      console.warn(`[FootballDataSource] crest warmup error ${competitionCode}:`, err);
    });
  }

  async getMatchGoals(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> {
    // Extract providerMatchId from "match:football-data:12345"
    const parts = canonicalMatchId.split(':');
    if (parts[1] !== PROVIDER_KEY) return [];
    const providerMatchId = parts[2];
    if (!providerMatchId) return [];

    // FINISHED matches are immutable — cache indefinitely
    if (this.goalsCache.has(providerMatchId)) {
      return this.goalsCache.get(providerMatchId)!;
    }

    interface FDGoal {
      minute: number;
      injuryTime: number | null;
      type: string;
      team: { id: number };
      scorer?: { name: string } | null;
    }
    interface FDMatchDetail {
      homeTeam: { id: number };
      awayTeam: { id: number };
      goals: FDGoal[] | null;
    }

    let detail: FDMatchDetail;
    try {
      detail = await this.apiGet<FDMatchDetail>(`/matches/${providerMatchId}`);
    } catch (err) {
      console.warn(`[FootballDataSource] getMatchGoals: failed to fetch match ${providerMatchId}:`, err);
      return [];
    }

    const goals: MatchGoalEventDTO[] = (detail.goals ?? []).map((g) => ({
      minute: g.minute,
      ...(g.injuryTime != null ? { injuryTime: g.injuryTime } : {}),
      type: g.type === 'OWN_GOAL' ? 'OWN_GOAL' : g.type === 'PENALTY' ? 'PENALTY' : 'GOAL',
      team: g.team.id === detail.homeTeam.id ? ('HOME' as const) : ('AWAY' as const),
      ...(g.scorer?.name ? { scorerName: g.scorer.name } : {}),
    }));

    this.goalsCache.set(providerMatchId, goals);
    console.log(`[FootballDataSource] getMatchGoals: match ${providerMatchId} → ${goals.length} goals cached`);
    return goals;
  }

  async getTopScorers(compId: string): Promise<TopScorerEntry[]> {
    const cached = this.scorersCache.get(compId);
    if (cached && Date.now() - cached.fetchedAt < FootballDataSource.SCORERS_TTL_MS) {
      return cached.data;
    }
    // Extract competition code from canonical compId: "comp:football-data:PD" → "PD"
    const parts = compId.split(':');
    const code = parts[parts.length - 1];
    try {
      const res = await this.apiGet<FDScorersResponse>(`/competitions/${code}/scorers?limit=10`);
      const data: TopScorerEntry[] = (res.scorers ?? []).slice(0, 5).map((s, i) => ({
        rank: i + 1,
        playerName: s.player.name,
        teamName: s.team.name,
        teamCrestUrl: s.team.crest ?? null,
        goals: s.goals ?? 0,
        assists: s.assists ?? 0,
        penalties: s.penalties ?? 0,
      }));
      this.scorersCache.set(compId, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      console.warn(`[FootballDataSource] scorers fetch failed for ${code}:`, (err as Error).message);
      return this.scorersCache.get(compId)?.data ?? [];
    }
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

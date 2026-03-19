/**
 * ApiFootballCanonicalSource — DataSource implementation backed by API-Football v3.
 *
 * Provider key: 'apifootball'
 * Base URL: https://v3.football.api-sports.io
 * Auth: x-apisports-key header
 *
 * Canonical IDs:
 *   competition:  comp:apifootball:{leagueId}     e.g. comp:apifootball:140
 *   season:       season:apifootball:{leagueId}:{year}
 *   team:         team:apifootball:{teamId}
 *   match:        match:apifootball:{fixtureId}
 *
 * Season year resolver:
 *   - European (PD/PL/BL1): month < 7 → year-1 (e.g. Mar 2026 → season 2025)
 *   - URU/ARG: calendar year
 *
 * Caching strategy (same pattern as FootballDataSource):
 *   - Teams + comp info: TTL 7 days
 *   - Fixtures: full-season fetch on first load, then incremental window (±2/+7 days)
 *   - Standings: only re-fetch when finished-match count increases
 *
 * Sub-tournaments (URU/ARG):
 *   - Round name from AF typically contains "Apertura" or "Clausura"
 *   - Falls back to date-based detection (H1=Apertura Apr-Jun, H2=Clausura Aug-Nov)
 *
 * AF quota notes: 100 requests/day shared across all consumers.
 * Initial full-season fetch: ~2 requests per competition (teams + fixtures).
 * Incremental: 1 request per competition per refresh cycle.
 */

import type { Team, Match } from '@sportpulse/canonical';
import { classifyStatus, classifyPeriod } from '@sportpulse/canonical';
import { COMPETITION_REGISTRY, resolveAfSeason } from './competition-registry.js';
import type { DataSource, StandingEntry, MatchGoalEventDTO, TopScorerEntry, SubTournamentInfo } from '@sportpulse/snapshot';
import {
  isQuotaExhausted as isAfQuotaExhausted,
  consumeRequest as consumeAfRequest,
  markQuotaExhausted as markAfQuotaExhausted,
  getGlobalProviderClient,
  QuotaExhaustedError,
} from '@sportpulse/canonical';
import {
  checkMatchdayCache,
  listAvailableSeasons,
  persistMatchdayCache,
  persistTeamsCache,
  loadTeamsCache,
  persistStandingsCache,
  loadStandingsCache,
  logCache,
  buildCachePath,
  persistCompInfoCache,
  loadCompInfoCache,
  cleanupOrphanedTmpFiles,
  pruneOldSeasons,
  loadAllMatchdaysForSeason,
} from './matchday-cache.js';
import { CrestCache } from './crest-cache.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const AF_PROVIDER_KEY = 'apifootball';
const BASE_URL = 'https://v3.football.api-sports.io';

const COMP_INFO_TTL_MS = 7 * 24 * 3600_000;
const TEAMS_TTL_MS     = 7 * 24 * 3600_000;

const WINDOW_PAST_DAYS   = 2;
const WINDOW_FUTURE_DAYS = 7;

// ── AF API response types ─────────────────────────────────────────────────────

interface AfFixture {
  fixture: {
    id:     number;
    date:   string;  // ISO 8601 UTC
    status: { short: string; long: string; elapsed: number | null };
  };
  league: {
    id:     number;
    season: number;
    round:  string;  // e.g. "Regular Season - 1", "Clausura - 3"
  };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
  score: {
    halftime:  { home: number | null; away: number | null };
    fulltime:  { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty:   { home: number | null; away: number | null };
  };
}

interface AfTeamEntry {
  team: {
    id:      number;
    name:    string;
    code:    string | null;
    logo:    string;
    country: string;
  };
  venue: {
    name: string | null;
  };
}

interface AfStandingRow {
  rank:        number;
  team:        { id: number; name: string; logo: string };
  points:      number;
  goalsDiff:   number;
  form:        string | null;
  description: string | null;
  group?:      string;
  all: {
    played: number; win: number; draw: number; lose: number;
    goals:  { for: number; against: number };
  };
}

interface AfResponse<T> {
  results: number;
  response: T[];
  errors?: Record<string, unknown>;
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface AfCompetitionConfig {
  /** AF league ID (e.g. 140 for LaLiga) */
  leagueId:    number;
  /** Human-readable display name */
  displayName: string;
  /**
   * Season year resolver: 'european' (month < 7 → year-1) | 'calendar' (exact year).
   * European: PD, PL, BL1. Calendar: URU, ARG.
   */
  seasonKind: 'european' | 'calendar';
  /** Whether this competition has named sub-tournaments (Apertura/Clausura). */
  hasSubTournaments?: boolean;
  /**
   * Which calendar half maps to "Apertura".
   * H1 = Apertura runs Jan–Jun (Argentina, default).
   * H2 = Apertura runs Jul–Dec (Liga MX style).
   */
  aperturaSeason?: 'H1' | 'H2';
  /** Known total matchdays (fallback for getTotalMatchdays). */
  totalMatchdays?: number;
}

/** Canonical competition ID → AF league config — derived from COMPETITION_REGISTRY */
export const AF_COMPETITION_CONFIGS: Record<string, AfCompetitionConfig> = Object.fromEntries(
  COMPETITION_REGISTRY.map((e) => [
    e.id,
    {
      leagueId:          e.leagueId,
      displayName:       e.displayName,
      seasonKind:        e.seasonKind,
      totalMatchdays:    e.totalMatchdays,
      hasSubTournaments: e.hasSubTournaments,
      aperturaSeason:    e.aperturaSeason,
    } satisfies AfCompetitionConfig,
  ]),
);

// ── Canonical ID helpers ──────────────────────────────────────────────────────

function afCompetitionId(leagueId: number): string {
  return `comp:${AF_PROVIDER_KEY}:${leagueId}`;
}

function afSeasonId(leagueId: number, year: number): string {
  return `season:${AF_PROVIDER_KEY}:${leagueId}:${year}`;
}

function afTeamId(teamId: number): string {
  return `team:${AF_PROVIDER_KEY}:${teamId}`;
}

function afMatchId(fixtureId: number): string {
  return `match:${AF_PROVIDER_KEY}:${fixtureId}`;
}

/** Derives current season year from current date given a seasonKind. */
function resolveSeasonYear(kind: 'european' | 'calendar'): number {
  const now = new Date();
  const year  = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based
  if (kind === 'european') {
    return month < 6 ? year - 1 : year; // before July → previous season
  }
  return year;
}

/** Produces a human-readable season label (e.g. "2025-26" or "2026"). */
function seasonLabel(kind: 'european' | 'calendar', year: number): string {
  if (kind === 'european') {
    return `${year}-${String(year + 1).slice(2)}`;
  }
  return String(year);
}

// ── Sub-tournament detection ──────────────────────────────────────────────────

/**
 * Detects the sub-tournament key from AF round string or match date.
 * AF round strings often contain "Apertura" or "Clausura" explicitly.
 * Falls back to date heuristic using aperturaSeason convention:
 *   H1 (default/AR): Apertura = Jan-Jun, Clausura = Jul-Dec
 *   H2 (MX):         Clausura = Jan-May, Apertura = Jul-Dec
 */
function detectSubTournament(
  round: string,
  utcDate: string,
  aperturaSeason: 'H1' | 'H2' = 'H1',
): string | null {
  const r = round.toUpperCase();
  if (r.includes('APERTURA')) return 'APERTURA';
  if (r.includes('CLAUSURA')) return 'CLAUSURA';
  if (r.includes('INTERMEDIO')) return 'INTERMEDIO';
  const isFirstHalf = new Date(utcDate).getUTCMonth() < 6; // 0-based
  return (aperturaSeason === 'H1') === isFirstHalf ? 'APERTURA' : 'CLAUSURA';
}

/** Returns the active sub-tournament key based on today's UTC date and the league's calendar convention. */
function activeSubTournamentByDate(aperturaSeason: 'H1' | 'H2' = 'H1'): string {
  const isFirstHalf = new Date().getUTCMonth() < 6;
  return (aperturaSeason === 'H1') === isFirstHalf ? 'APERTURA' : 'CLAUSURA';
}

/** Extracts the matchday number from an AF round string like "Regular Season - 5" or "Clausura - 3". */
function parseRoundNumber(round: string): number | undefined {
  const m = round.match(/[-–]\s*(\d+)$/);
  return m ? parseInt(m[1], 10) : undefined;
}

// ── CachedData ────────────────────────────────────────────────────────────────

interface CachedData {
  teams:                  Team[];
  matches:                Match[];
  standings:              StandingEntry[];
  standingsFinishedCount: number;
  seasonId:               string | undefined;
  seasonYear:             number | undefined;
  season:                 string | undefined;  // human label e.g. "2025-26"
  currentMatchday:        number | undefined;
  fetchedAt:              number;
  compInfoFetchedAt:      number;
  teamsFetchedAt:         number;
  fullSeasonFetched:      boolean;
}

// ── Main class ────────────────────────────────────────────────────────────────

export class ApiFootballCanonicalSource implements DataSource {
  private readonly apiKey: string;
  private readonly crestCache: CrestCache | null;
  private cache = new Map<string, CachedData>();
  private readonly goalsCache = new Map<string, MatchGoalEventDTO[]>();
  private readonly scorersCache = new Map<string, { data: TopScorerEntry[]; fetchedAt: number }>();
  private static readonly SCORERS_TTL_MS = 60 * 60_000; // 1 hour

  constructor(apiKey: string, crestCache?: CrestCache) {
    this.apiKey = apiKey;
    this.crestCache = crestCache ?? null;
  }

  // ── DataSource interface ───────────────────────────────────────────────────

  getTeams(compId: string): Team[] {
    return this.getCached(compId)?.teams ?? [];
  }

  getMatches(seasId: string, subTournamentKey?: string): Match[] {
    for (const [compId, entry] of this.cache.entries()) {
      if (entry.seasonId !== seasId) continue;
      const hasSubT = AF_COMPETITION_CONFIGS[compId]?.hasSubTournaments ?? false;
      if (!hasSubT) return entry.matches;
      const key = subTournamentKey ?? this.resolveActiveSubTournament(compId);
      return entry.matches.filter((m) => m.subTournamentKey === key);
    }
    return [];
  }

  getSubTournaments(compId: string): SubTournamentInfo[] {
    const entry = this.getCached(compId);
    const cfg = AF_COMPETITION_CONFIGS[compId];
    if (!entry || !cfg?.hasSubTournaments) return [];
    const now = Date.now();
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    const active = this.resolveActiveSubTournament(compId);
    // Active tournament first, then the other
    const keys: Array<{ key: string; label: string }> = active === 'APERTURA'
      ? [{ key: 'APERTURA', label: 'Apertura' }, { key: 'CLAUSURA', label: 'Clausura' }]
      : [{ key: 'CLAUSURA', label: 'Clausura' }, { key: 'APERTURA', label: 'Apertura' }];
    return keys
      .map(({ key, label }) => {
        const matches = entry.matches.filter((m) => m.subTournamentKey === key);
        const hasFinished = matches.some((m) => m.status === 'FINISHED');
        const hasSoon = matches.some(
          (m) => m.startTimeUtc && new Date(m.startTimeUtc).getTime() - now < sixtyDaysMs,
        );
        return { key, label, isActive: key === active, hasData: hasFinished || hasSoon };
      })
      .filter((s) => s.hasData || s.isActive);
  }

  getActiveSubTournament(compId: string): string | undefined {
    const cfg = AF_COMPETITION_CONFIGS[compId];
    if (!cfg?.hasSubTournaments) return undefined;
    return this.resolveActiveSubTournament(compId);
  }

  /** Returns matches filtered to the relevant sub-tournament (if any). */
  private getSubTournamentMatches(compId: string, subTournamentKey?: string): Match[] {
    const cached = this.getCached(compId);
    if (!cached) return [];
    const cfg = AF_COMPETITION_CONFIGS[compId];
    if (!cfg?.hasSubTournaments) return cached.matches;
    const key = subTournamentKey ?? this.resolveActiveSubTournament(compId);
    return cached.matches.filter((m) => m.subTournamentKey === key);
  }

  /**
   * Derives the currently active sub-tournament from match data.
   *
   * Counts matches per subTournamentKey in a ±90-day window around today.
   * The key with the most matches in that window is the active tournament.
   * Falls back to the static date heuristic (aperturaSeason) when no match
   * data is available (cold start / empty cache).
   *
   * This is data-driven: it works for any league regardless of naming convention
   * or calendar layout (Argentina, Liga MX, future leagues).
   */
  private resolveActiveSubTournament(compId: string): string {
    const cfg = AF_COMPETITION_CONFIGS[compId];
    const aperturaSeason = cfg?.aperturaSeason ?? 'H1';
    const cached = this.getCached(compId);
    if (!cached || cached.matches.length === 0) {
      return activeSubTournamentByDate(aperturaSeason); // cold-start fallback
    }
    const now = Date.now();
    const PAST_MS   = 30 * 24 * 60 * 60 * 1000; // 30 days back
    const FUTURE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days ahead
    const counts = new Map<string, number>();
    for (const m of cached.matches) {
      if (!m.subTournamentKey || !m.startTimeUtc) continue;
      const t = new Date(m.startTimeUtc).getTime();
      if (t < now - PAST_MS || t > now + FUTURE_MS) continue;
      counts.set(m.subTournamentKey, (counts.get(m.subTournamentKey) ?? 0) + 1);
    }
    if (counts.size === 0) {
      return activeSubTournamentByDate(aperturaSeason); // no matches in window
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  getSeasonId(compId: string): string | undefined {
    return this.getCached(compId)?.seasonId;
  }

  /** Returns the matches currently held in the in-memory cache without making any API calls. */
  getMatchesCached(compId: string): Match[] {
    return this.getCached(compId)?.matches ?? [];
  }

  getStandings(compId: string, subTournamentKey?: string): StandingEntry[] {
    const cfg = AF_COMPETITION_CONFIGS[compId];
    if (cfg?.hasSubTournaments) {
      // Compute standings from match results so each sub-tournament has its own table.
      // Relying on AF's /standings endpoint returns the same table regardless of sub-tournament.
      const matches = this.getSubTournamentMatches(compId, subTournamentKey);
      return this.computeStandingsFromMatches(compId, matches);
    }
    return this.getCached(compId)?.standings ?? [];
  }

  /**
   * Computes a standings table from finished match results.
   * Used for leagues with sub-tournaments (Apertura/Clausura) where the AF
   * standings endpoint does not distinguish between them.
   */
  private computeStandingsFromMatches(compId: string, matches: Match[]): StandingEntry[] {
    const teams = this.getCached(compId)?.teams ?? [];
    const teamMap = new Map(teams.map((t) => [t.teamId, t]));

    const stats = new Map<string, {
      teamId: string; pj: number; w: number; d: number; l: number; gf: number; ga: number;
    }>();
    const getOrCreate = (teamId: string) => {
      if (!stats.has(teamId)) stats.set(teamId, { teamId, pj: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
      return stats.get(teamId)!;
    };

    // Initialize all teams that participate (so 0-result teams still appear)
    for (const m of matches) {
      getOrCreate(m.homeTeamId);
      getOrCreate(m.awayTeamId);
    }

    // Accumulate results from FINISHED matches only
    for (const m of matches) {
      if (m.status !== 'FINISHED' || m.scoreHome == null || m.scoreAway == null) continue;
      const hg = m.scoreHome;
      const ag = m.scoreAway;
      const home = getOrCreate(m.homeTeamId);
      const away = getOrCreate(m.awayTeamId);
      home.pj++; away.pj++;
      home.gf += hg; home.ga += ag;
      away.gf += ag; away.ga += hg;
      if (hg > ag) { home.w++; away.l++; }
      else if (hg < ag) { away.w++; home.l++; }
      else { home.d++; away.d++; }
    }

    const entries = [...stats.values()].map((s) => {
      const team = teamMap.get(s.teamId);
      return {
        teamId:         s.teamId,
        teamName:       team?.name ?? s.teamId,
        crestUrl:       team?.crestUrl,
        playedGames:    s.pj,
        won:            s.w,
        draw:           s.d,
        lost:           s.l,
        goalsFor:       s.gf,
        goalsAgainst:   s.ga,
        goalDifference: s.gf - s.ga,
        points:         s.w * 3 + s.d,
        position:       0,
      };
    });

    // Sort: points desc → goal diff desc → goals for desc → name asc (stable tiebreak)
    entries.sort((a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.teamName.localeCompare(b.teamName),
    );
    entries.forEach((e, i) => { e.position = i + 1; });
    return entries;
  }

  getCurrentMatchday(compId: string, subTournamentKey?: string): number | undefined {
    if (!this.getCached(compId)) return undefined;
    return this.getBestDisplayMatchday(compId, subTournamentKey) ?? this.getCached(compId)?.currentMatchday;
  }

  getLastPlayedMatchday(compId: string, subTournamentKey?: string): number | undefined {
    const matches = this.getSubTournamentMatches(compId, subTournamentKey);
    const stats = new Map<number, { total: number; finished: number }>();
    for (const m of matches) {
      if (m.matchday === undefined) continue;
      const s = stats.get(m.matchday) ?? { total: 0, finished: 0 };
      s.total++;
      if (m.status === 'FINISHED') s.finished++;
      stats.set(m.matchday, s);
    }
    let last: number | undefined;
    for (const [md, s] of stats) {
      if (s.total > 0 && s.finished === s.total) {
        if (last === undefined || md > last) last = md;
      }
    }
    return last;
  }

  getNextMatchday(compId: string, subTournamentKey?: string): number | undefined {
    const matches = this.getSubTournamentMatches(compId, subTournamentKey);
    const nowUtc = new Date().toISOString();
    let next: number | undefined;
    for (const m of matches) {
      if (!m.matchday || m.status !== 'SCHEDULED' || !m.startTimeUtc || m.startTimeUtc <= nowUtc) continue;
      if (next === undefined || m.matchday < next) next = m.matchday;
    }
    return next;
  }

  getTotalMatchdays(compId: string, subTournamentKey?: string): number {
    const cfg = AF_COMPETITION_CONFIGS[compId];
    const fallback = cfg?.totalMatchdays ?? 38;
    const matches = this.getSubTournamentMatches(compId, subTournamentKey);
    const matchdays = new Set<number>();
    for (const m of matches) {
      if (m.matchday) matchdays.add(m.matchday);
    }
    return matchdays.size || fallback;
  }

  getBestDisplayMatchday(compId: string, subTournamentKey?: string): number | undefined {
    const matches = this.getSubTournamentMatches(compId, subTournamentKey);
    const cached = this.getCached(compId);
    const nowMs = Date.now();
    let liveMd:              number | undefined;
    let earliestUpcomingMs = Infinity;
    let earliestUpcomingMd: number | undefined;
    let highestFinished:    number | undefined;

    for (const m of matches) {
      if (m.matchday === undefined) continue;
      const t = m.startTimeUtc ? new Date(m.startTimeUtc).getTime() : 0;
      if (m.status === 'IN_PROGRESS') {
        liveMd = m.matchday;
      } else if (m.status === 'FINISHED') {
        if (highestFinished === undefined || m.matchday > highestFinished) highestFinished = m.matchday;
      } else if (m.status === 'SCHEDULED' && t > nowMs) {
        if (t < earliestUpcomingMs) { earliestUpcomingMs = t; earliestUpcomingMd = m.matchday; }
      }
    }
    if (liveMd !== undefined) return liveMd;
    if (earliestUpcomingMd !== undefined) return earliestUpcomingMd;
    return highestFinished ?? cached?.currentMatchday;
  }

  // ── fetchCompetition ──────────────────────────────────────────────────────

  /**
   * Pre-fetches and caches data for a competition by competitionId.
   * Must be called before getTeams/getMatches etc. will return data.
   */
  async fetchCompetition(compId: string): Promise<void> {
    const cfg = AF_COMPETITION_CONFIGS[compId];
    if (!cfg) {
      console.warn(`[AfCanonical] Unknown competition ID: ${compId}`);
      return;
    }

    const { leagueId, seasonKind, hasSubTournaments, aperturaSeason = 'H1' } = cfg;
    const prevCache = this.cache.get(compId);
    const nowMs     = Date.now();
    const nowUtc    = new Date(nowMs).toISOString();

    // Derive season year
    const seasonYear = resolveSeasonYear(seasonKind);
    const season     = seasonLabel(seasonKind, seasonYear);
    const resolvedSeasonId = afSeasonId(leagueId, seasonYear);

    // Fix: remove orphaned .tmp + prune old seasons.
    // IMPORTANT: pruneOldSeasons is skipped when quota is exhausted to avoid destroying
    // previous-season data before new data can be written. Without this guard, a season
    // rollover during quota exhaustion leaves the disk permanently empty.
    cleanupOrphanedTmpFiles(AF_PROVIDER_KEY, String(leagueId), season);
    if (!isAfQuotaExhausted()) {
      pruneOldSeasons(AF_PROVIDER_KEY, String(leagueId), season);
    }

    const logCtxBase = {
      provider: AF_PROVIDER_KEY,
      competitionId: String(leagueId),
      season,
      matchday: prevCache?.currentMatchday ?? 0,
      cachePath: buildCachePath(AF_PROVIDER_KEY, String(leagueId), season, 0),
    };
    logCache({ event: 'CACHE_API_FETCH', ...logCtxBase });

    // ── Phase 1A: comp-info (TTL 7 days) — AF doesn't need a separate call;
    //    season is derived deterministically from the date. We only call /leagues
    //    if we need to validate the season is active. Skip for now — season derivation
    //    is deterministic and correct for all supported competitions.
    const compInfoFetchedAt = prevCache?.compInfoFetchedAt ?? nowMs;

    // ── Phase 1B: teams (TTL 7 days) ─────────────────────────────────────────
    const teamsInMemoryFresh = prevCache && (nowMs - prevCache.teamsFetchedAt) <= TEAMS_TTL_MS;
    let teams: Team[] = prevCache?.teams ?? [];
    let teamsFetchedAt = prevCache?.teamsFetchedAt ?? 0;

    if (!teamsInMemoryFresh) {
      // Try disk cache first
      const diskTeams = loadTeamsCache(AF_PROVIDER_KEY, String(leagueId));
      if (diskTeams && diskTeams.length > 0) {
        teams = diskTeams;
        teamsFetchedAt = nowMs;
        console.log(`[AfCanonical] teams SKIP league=${leagueId}: disk cache (${teams.length} teams)`);
      } else {
        // Fetch from API
        try {
          const raw = await this.apiGet<AfTeamEntry>(`/teams?league=${leagueId}&season=${seasonYear}`, 'teams-by-league');
          teams = raw.map((entry) => this.mapTeam(entry));
          teamsFetchedAt = nowMs;
          persistTeamsCache(AF_PROVIDER_KEY, String(leagueId), teams);
          console.log(`[AfCanonical] teams fetched league=${leagueId}: ${teams.length} teams`);
        } catch (err) {
          console.warn(`[AfCanonical] teams fetch failed league=${leagueId}:`, err);
          teams = prevCache?.teams ?? [];
          teamsFetchedAt = prevCache?.teamsFetchedAt ?? 0;
        }
      }
    } else {
      console.log(`[AfCanonical] teams SKIP league=${leagueId}: in-memory TTL`);
    }

    // Warm up crest cache for newly loaded teams (fire-and-forget)
    if (!teamsInMemoryFresh && teams.length > 0 && this.crestCache) {
      void this.crestCache.warmup(
        teams.map((t) => ({ providerTeamId: t.providerTeamId, crestUrl: t.crestUrl })),
        AF_PROVIDER_KEY,
      );
    }

    // Build team lookup: AF team ID → canonical team ID (for fixture mapping)
    const teamLookup = new Map<number, string>();
    for (const t of teams) {
      teamLookup.set(parseInt(t.providerTeamId, 10), t.teamId);
    }

    // ── Phase 2: matches ──────────────────────────────────────────────────────
    let matches: Match[] = prevCache?.matches ?? [];
    const fullSeasonFetched = prevCache?.fullSeasonFetched ?? false;

    if (!fullSeasonFetched || matches.length === 0) {
      // Full-season fetch: all fixtures for the league/season
      try {
        const rawFixtures = await this.apiGet<AfFixture>(`/fixtures?league=${leagueId}&season=${seasonYear}`, 'fixtures-full-season');
        matches = this.mapFixtures(rawFixtures, resolvedSeasonId, teamLookup, hasSubTournaments, aperturaSeason);
        console.log(`[AfCanonical] full-season fetch league=${leagueId}: ${matches.length} fixtures`);

        // Persist by matchday
        await this.persistMatchesByMatchday(matches, String(leagueId), season);
      } catch (err) {
        console.warn(`[AfCanonical] full-season fetch failed league=${leagueId}:`, err);
        // Try loading from disk if available
        const diskMatches = await this.loadMatchesFromDisk(String(leagueId), season, resolvedSeasonId, teamLookup, hasSubTournaments);
        if (diskMatches.length > 0) matches = diskMatches;
      }
    } else {
      // Incremental window fetch: past 2 days + next 7 days
      const pastDate   = new Date(nowMs - WINDOW_PAST_DAYS * 86400_000).toISOString().slice(0, 10);
      const futureDate = new Date(nowMs + WINDOW_FUTURE_DAYS * 86400_000).toISOString().slice(0, 10);

      // Check if all matchdays in the window are cache-fresh — skip API call if so.
      // TTLs: SCHEDULED=6h, FINISHED=1y, LIVE=60s — checkMatchdayCache applies them.
      // Only skip if there are matchdays to check AND all are fresh.
      const windowMatchdays = [...new Set(
        matches
          .filter((m) => {
            const d = m.startTimeUtc?.slice(0, 10) ?? '';
            return d >= pastDate && d <= futureDate;
          })
          .map((m) => m.matchday ?? 0)
          .filter((md) => md > 0),
      )];

      const allWindowFresh =
        windowMatchdays.length > 0 &&
        windowMatchdays.every((md) => {
          // For sub-tournament leagues, use the sub-tournament key from in-memory matches
          const stKey = hasSubTournaments
            ? (matches.find((m) => m.matchday === md)?.subTournamentKey ?? undefined)
            : undefined;
          return checkMatchdayCache(AF_PROVIDER_KEY, String(leagueId), season, md, stKey ?? undefined).hit;
        });

      if (allWindowFresh) {
        console.log(
          `[AfCanonical] window fetch SKIP league=${leagueId}: ` +
          `${windowMatchdays.length} matchdays cache-fresh`,
        );
      } else {
        try {
          const rawWindow = await this.apiGet<AfFixture>(
            `/fixtures?league=${leagueId}&season=${seasonYear}&from=${pastDate}&to=${futureDate}`,
            'fixtures-window',
          );
          if (rawWindow.length > 0) {
            const windowMatches = this.mapFixtures(rawWindow, resolvedSeasonId, teamLookup, hasSubTournaments, aperturaSeason);
            // Merge: update existing entries, add new ones
            const matchMap = new Map(matches.map((m) => [m.matchId, m]));
            for (const wm of windowMatches) {
              matchMap.set(wm.matchId, wm);
            }
            matches = [...matchMap.values()];

            // Persist updated matchdays
            await this.persistMatchesByMatchday(windowMatches, String(leagueId), season);
            console.log(`[AfCanonical] window fetch league=${leagueId}: ${windowMatches.length} updated`);
          }
        } catch (err) {
          console.warn(`[AfCanonical] window fetch failed league=${leagueId}:`, err);
        }
      }
    }

    // ── Phase 3: standings ────────────────────────────────────────────────────
    const finishedCount = matches.filter((m) => m.status === 'FINISHED').length;
    const standingsNeedRefresh = finishedCount > (prevCache?.standingsFinishedCount ?? -1);
    let standings: StandingEntry[] = prevCache?.standings ?? [];
    let standingsFinishedCount = prevCache?.standingsFinishedCount ?? -1;

    if (standings.length === 0) {
      // Try disk first
      const diskStandings = loadStandingsCache(AF_PROVIDER_KEY, String(leagueId));
      if (diskStandings && diskStandings.length > 0) {
        standings = diskStandings;
      }
    }

    if (standingsNeedRefresh || standings.length === 0) {
      try {
        const rawStandings = await this.apiGet<{ league: { standings: AfStandingRow[][] } }>(
          `/standings?league=${leagueId}&season=${seasonYear}`,
          'standings-by-league',
        );
        const allGroups = rawStandings[0]?.league?.standings ?? [];
        const selectedGroup = this.selectStandingsGroup(allGroups);
        if (selectedGroup.length > 0) {
          standings = this.mapStandings(selectedGroup);
          standingsFinishedCount = finishedCount;
          persistStandingsCache(AF_PROVIDER_KEY, String(leagueId), standings);
          console.log(`[AfCanonical] standings fetched league=${leagueId}: ${standings.length} entries`);
        }
      } catch (err) {
        console.warn(`[AfCanonical] standings fetch failed league=${leagueId}:`, err);
      }
    }

    // ── Derive current matchday ───────────────────────────────────────────────
    const currentMatchday = this.deriveCurrentMatchday(matches);

    // ── Store in cache ────────────────────────────────────────────────────────
    this.cache.set(compId, {
      teams,
      matches,
      standings,
      standingsFinishedCount,
      seasonId:        resolvedSeasonId,
      seasonYear,
      season,
      currentMatchday,
      fetchedAt:       nowMs,
      compInfoFetchedAt,
      teamsFetchedAt,
      fullSeasonFetched: true,
    });
  }

  // ── Top scorers ───────────────────────────────────────────────────────────

  async getTopScorers(compId: string): Promise<TopScorerEntry[]> {
    const now = Date.now();
    const cached = this.scorersCache.get(compId);
    if (cached && (now - cached.fetchedAt) < ApiFootballCanonicalSource.SCORERS_TTL_MS) {
      return cached.data;
    }

    const cfg = AF_COMPETITION_CONFIGS[compId];
    if (!cfg) return [];

    const { leagueId, seasonKind } = cfg;
    const seasonYear = resolveSeasonYear(seasonKind);

    try {
      interface AfScorerEntry {
        player:     { id: number; name: string };
        statistics: Array<{
          team:   { id: number; name: string; logo: string };
          goals:  { total: number | null; assists: number | null; penalty: number | null };
          games:  { appearences: number | null };
        }>;
      }
      const raw = await this.apiGet<AfScorerEntry>(
        `/players/topscorers?league=${leagueId}&season=${seasonYear}`,
        'top-scorers',
      );
      const data: TopScorerEntry[] = raw.slice(0, 20).map((entry, idx) => {
        const stats = entry.statistics[0];
        return {
          rank:         idx + 1,
          playerName:   entry.player.name,
          teamName:     stats?.team.name ?? '',
          teamCrestUrl: stats?.team.logo ?? null,
          goals:        stats?.goals.total ?? 0,
          assists:      stats?.goals.assists ?? 0,
          penalties:    stats?.goals.penalty ?? 0,
        };
      });

      this.scorersCache.set(compId, { data, fetchedAt: now });
      return data;
    } catch (err) {
      console.warn(`[AfCanonical] topscorers fetch failed league=${leagueId}:`, err);
      return cached?.data ?? [];
    }
  }

  // ── Match goal events (stub — AF doesn't expose goal events in same format) ──

  async getMatchGoals(matchId: string): Promise<MatchGoalEventDTO[]> {
    return this.goalsCache.get(matchId) ?? [];
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private getCached(compId: string): CachedData | undefined {
    return this.cache.get(compId);
  }

  private async apiGet<T>(path: string, operationKey = 'unknown'): Promise<T[]> {
    // Budget guard — never call provider if quota is exhausted
    if (isAfQuotaExhausted()) {
      throw new Error(`[AfCanonical] Quota exhausted — skipping ${path}`);
    }

    const url = `${BASE_URL}${path}`;
    let res: Response;

    const client = getGlobalProviderClient();
    if (client) {
      try {
        res = await client.fetch(url, {
          headers: { 'x-apisports-key': this.apiKey },
          signal: AbortSignal.timeout(15_000),
          providerKey: 'api-football',
          consumerType: 'CANONICAL_INGESTION',
          priorityTier: 'deferrable',
          moduleKey: 'af-canonical-source',
          operationKey,
          metadata: { endpointTemplate: path.split('?')[0] },
        });
      } catch (err) {
        if (err instanceof QuotaExhaustedError) {
          markAfQuotaExhausted();
          throw new Error(`[AfCanonical] Quota exhausted ${path}`);
        }
        throw err;
      }
    } else {
      res = await fetch(url, {
        headers: { 'x-apisports-key': this.apiKey },
        signal: AbortSignal.timeout(15_000),
      });
    }

    if (!res.ok) {
      throw new Error(`[AfCanonical] HTTP ${res.status} for ${url}`);
    }
    const body = (await res.json()) as AfResponse<T>;

    // Detect quota exhaustion — only for actual quota limit errors (errors.requests)
    // Other API errors (auth, params, etc.) should NOT mark quota as exhausted
    if (body.errors && Object.keys(body.errors).length > 0) {
      const errorsObj = body.errors as Record<string, unknown>;
      if (errorsObj['requests']) {
        markAfQuotaExhausted();
        throw new Error(`[AfCanonical] Quota limit for ${url}: ${JSON.stringify(body.errors)}`);
      }
      throw new Error(`[AfCanonical] API error for ${url}: ${JSON.stringify(body.errors)}`);
    }

    if (!client) consumeAfRequest();

    if (!body.response) {
      throw new Error(`[AfCanonical] No response field for ${url}`);
    }
    return body.response;
  }

  private mapTeam(entry: AfTeamEntry): Team {
    return {
      teamId:        afTeamId(entry.team.id),
      sportId:       'FOOTBALL' as const,
      name:          entry.team.name,
      shortName:     entry.team.code ?? undefined,
      tla:           entry.team.code ?? undefined,
      crestUrl:      entry.team.logo,
      venueName:     entry.venue.name ?? undefined,
      providerKey:   AF_PROVIDER_KEY,
      providerTeamId: String(entry.team.id),
    };
  }

  private mapFixtures(
    fixtures:          AfFixture[],
    seasonId:          string,
    teamLookup:        Map<number, string>,
    hasSubTournaments: boolean | undefined,
    aperturaSeason:    'H1' | 'H2' = 'H1',
  ): Match[] {
    return fixtures.map((f): Match => {
      const statusShort = f.fixture.status.short;
      const status      = classifyStatus(statusShort);
      const period      = classifyPeriod(statusShort);
      const utcDate     = f.fixture.date;

      // Home/away IDs — use canonical lookup if available, else build from provider
      const homeTeamId = teamLookup.get(f.teams.home.id) ?? afTeamId(f.teams.home.id);
      const awayTeamId = teamLookup.get(f.teams.away.id) ?? afTeamId(f.teams.away.id);

      // Matchday from round string
      const matchday = parseRoundNumber(f.league.round);

      // Sub-tournament
      const subTournamentKey = hasSubTournaments
        ? detectSubTournament(f.league.round, utcDate, aperturaSeason)
        : null;

      // Winner (for tournament bracket use)
      const winnerTeamId = f.teams.home.winner === true
        ? homeTeamId
        : f.teams.away.winner === true
          ? awayTeamId
          : null;

      return {
        matchId:        afMatchId(f.fixture.id),
        seasonId,
        matchday,
        startTimeUtc:   utcDate,
        status,
        ...(period !== undefined ? { matchPeriod: period } : {}),
        ...(status === 'IN_PROGRESS' && f.fixture.status.elapsed != null
          ? { elapsedMinutes: f.fixture.status.elapsed }
          : {}),
        homeTeamId,
        awayTeamId,
        scoreHome:      f.goals.home,
        scoreAway:      f.goals.away,
        scoreHomeExtraTime: f.score.extratime.home,
        scoreAwayExtraTime: f.score.extratime.away,
        scoreHomePenalties: f.score.penalty.home,
        scoreAwayPenalties: f.score.penalty.away,
        winnerTeamId,
        subTournamentKey,
        providerKey:    AF_PROVIDER_KEY,
        providerMatchId: String(f.fixture.id),
        lastSeenUtc:    new Date().toISOString(),
      };
    });
  }

  /**
   * Selects the best standings group from the list returned by AF.
   *
   * AF returns multiple groups for some leagues:
   *  - "Promedios"/"Averages": cumulative historical averages — ALWAYS skip.
   *  - "Group A"/"Group B": sub-group tables (e.g. ARG Apertura).
   *  - "Anual"/"General"/"Overall": combined single table with all teams — PREFERRED.
   *  - Single group: return as-is.
   *
   * Strategy:
   *  1. Remove "Promedios/Averages/Relegation" groups (corrupted with historical data).
   *  2. Among remaining, prefer the group with the MOST teams (the combined/annual table).
   *  3. Tie-break: prefer group with most homogeneous playedGames (smallest variance).
   */
  private selectStandingsGroup(groups: AfStandingRow[][]): AfStandingRow[] {
    if (groups.length === 0) return [];
    if (groups.length === 1) return groups[0];

    const SKIP_KEYWORDS = /promedio|average|relegat/i;

    const eligible = groups.filter((g) => {
      if (g.length === 0) return false;
      const groupName = g[0]?.group ?? '';
      return !SKIP_KEYWORDS.test(groupName);
    });

    if (eligible.length === 0) return groups[0]; // fallback: no eligible groups
    if (eligible.length === 1) return eligible[0];

    // Prefer largest group (combined table)
    const maxSize = Math.max(...eligible.map((g) => g.length));
    const largest = eligible.filter((g) => g.length === maxSize);
    if (largest.length === 1) return largest[0];

    // Tie-break: smallest variance in playedGames
    function variance(g: AfStandingRow[]): number {
      const vals = g.map((r) => r.all.played);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    }
    return largest.reduce((best, g) => variance(g) < variance(best) ? g : best);
  }

  private mapStandings(rows: AfStandingRow[]): StandingEntry[] {
    return rows.map((row) => ({
      teamId:        afTeamId(row.team.id),
      teamName:      row.team.name,
      crestUrl:      row.team.logo,
      position:      row.rank,
      playedGames:   row.all.played,
      won:           row.all.win,
      draw:          row.all.draw,
      lost:          row.all.lose,
      goalsFor:      row.all.goals.for,
      goalsAgainst:  row.all.goals.against,
      goalDifference: row.goalsDiff,
      points:        row.points,
      form:          row.form ?? undefined,
    }));
  }

  private deriveCurrentMatchday(matches: Match[]): number | undefined {
    const todayUtc = new Date().toISOString().slice(0, 10);
    let minStarted:   number | undefined;
    let minFuture:    number | undefined;
    let maxFinished:  number | undefined;

    for (const m of matches) {
      if (m.matchday === undefined) continue;
      const isTerminal = m.status === 'FINISHED' || m.status === 'POSTPONED' || m.status === 'CANCELED';
      if (isTerminal) {
        if (maxFinished === undefined || m.matchday > maxFinished) maxFinished = m.matchday;
      } else {
        const matchDate = m.startTimeUtc?.slice(0, 10);
        if (matchDate && matchDate <= todayUtc) {
          if (minStarted === undefined || m.matchday < minStarted) minStarted = m.matchday;
        } else {
          if (minFuture === undefined || m.matchday < minFuture) minFuture = m.matchday;
        }
      }
    }
    return minStarted ?? maxFinished ?? minFuture;
  }

  /** Persists matches grouped by matchday to disk cache. */
  private async persistMatchesByMatchday(matches: Match[], leagueId: string, season: string): Promise<void> {
    // Group by (matchday, subTournamentKey) pair — each sub-tournament gets its own cache file
    const byKey = new Map<string, { md: number; stKey: string | undefined; mdMatches: Match[] }>();
    for (const m of matches) {
      const md = m.matchday ?? 0;
      const stKey = m.subTournamentKey ?? undefined;
      const key = `${md}:${stKey ?? ''}`;
      const existing = byKey.get(key) ?? { md, stKey, mdMatches: [] };
      existing.mdMatches.push(m);
      byKey.set(key, existing);
    }
    for (const { md, stKey, mdMatches } of byKey.values()) {
      try {
        const existing = checkMatchdayCache(AF_PROVIDER_KEY, leagueId, season, md, stKey);
        const base: Match[] = existing.hit ? existing.matches : [];

        // Merge: existing + new (new wins on duplicate matchId)
        const merged = new Map(base.map((m) => [m.matchId, m]));
        for (const m of mdMatches) merged.set(m.matchId, m);

        persistMatchdayCache(AF_PROVIDER_KEY, leagueId, season, md, [...merged.values()], undefined, stKey);
      } catch {
        // Non-fatal — memory cache is still up to date
      }
    }
  }

  /**
   * Returns the numeric API-Football home team ID for a given canonical matchId.
   * Used by IncidentSource to skip the /fixtures?id= API call.
   * matchId format: match:apifootball:{fixtureId}
   * homeTeamId format: team:apifootball:{numericId}
   */
  getHomeAfTeamId(matchId: string): number | null {
    for (const entry of this.cache.values()) {
      const match = entry.matches.find((m) => m.matchId === matchId);
      if (match) {
        const numericStr = match.homeTeamId.split(':').pop() ?? '';
        const numeric = parseInt(numericStr, 10);
        return isNaN(numeric) ? null : numeric;
      }
    }
    return null;
  }

  /** Loads matches from disk cache for all matchdays in a season. */
  private async loadMatchesFromDisk(
    leagueId:          string,
    season:            string,
    seasonId:          string,
    teamLookup:        Map<number, string>,
    hasSubTournaments: boolean | undefined,
  ): Promise<Match[]> {
    // loadAllMatchdaysForSeason reads every matchday-NN.json in the season directory
    // without applying TTL checks — freshness is handled by the subsequent window fetch merge.
    // This avoids two bugs in the previous manual loop:
    //   1. checkMatchdayCache() returning hit:false on stale/invalid files (valid data lost)
    //   2. break on first miss treating non-contiguous matchday files as end-of-season
    return loadAllMatchdaysForSeason(AF_PROVIDER_KEY, leagueId, season);
  }

  /**
   * Preloads all known competitions from disk into the in-memory cache.
   *
   * Called once at server startup BEFORE the first fetchCompetition() cycle.
   * This ensures that if the API-Football quota is exhausted on startup,
   * the server still serves stale-but-valid data from disk rather than
   * returning empty responses.
   *
   * Data loaded here is treated as a cold-start baseline:
   * - fullSeasonFetched is set to true when matches exist on disk, so the
   *   subsequent fetchCompetition() takes the cheaper window-fetch path
   *   rather than burning a quota request on a redundant full-season fetch.
   * - TTLs are NOT enforced here — freshness is the responsibility of
   *   fetchCompetition(), which runs immediately after preload.
   */
  async preloadAllCompetitions(): Promise<void> {
    const nowMs = Date.now();

    for (const [compId, cfg] of Object.entries(AF_COMPETITION_CONFIGS)) {
      const { leagueId, seasonKind } = cfg;
      const seasonYear    = resolveSeasonYear(seasonKind);
      const season        = seasonLabel(seasonKind, seasonYear);
      const resolvedSeasonId = afSeasonId(leagueId, seasonYear);

      // Skip if already populated in memory (e.g. constructor pre-seeded it)
      if (this.cache.has(compId)) continue;

      // ── Teams from disk ───────────────────────────────────────────────────
      const diskTeams = loadTeamsCache(AF_PROVIDER_KEY, String(leagueId)) ?? [];

      // ── Matches from disk (no TTL check — stale data beats empty data) ───
      // Fallback: if current season dir is empty, try other available seasons on disk.
      // This handles season-rollover during quota exhaustion: pruneOldSeasons is now
      // skipped when quota is exhausted, so old season data survives for this fallback.
      let diskMatches = loadAllMatchdaysForSeason(AF_PROVIDER_KEY, String(leagueId), season);
      if (diskMatches.length === 0) {
        const otherSeasons = listAvailableSeasons(AF_PROVIDER_KEY, String(leagueId))
          .filter((s) => s !== season)
          .sort()
          .reverse(); // most recent first
        for (const altSeason of otherSeasons) {
          const altMatches = loadAllMatchdaysForSeason(AF_PROVIDER_KEY, String(leagueId), altSeason);
          if (altMatches.length > 0) {
            console.log(`[AfCanonical] preload league=${leagueId}: fallback a season ${altSeason} (${altMatches.length} matches)`);
            diskMatches = altMatches;
            break;
          }
        }
      }

      // ── Standings from disk ───────────────────────────────────────────────
      // ignoreTtl=true: stale standings from disk are better than no standings at all.
      // TTL enforcement happens during normal fetchCompetition() cycles.
      const diskStandings = loadStandingsCache(AF_PROVIDER_KEY, String(leagueId), { ignoreTtl: true }) ?? [];

      if (diskTeams.length === 0 && diskMatches.length === 0) {
        // No disk data at all — leave cache empty, fetchCompetition() will handle
        continue;
      }

      const currentMatchday = this.deriveCurrentMatchday(diskMatches);

      this.cache.set(compId, {
        teams:                  diskTeams,
        matches:                diskMatches,
        standings:              diskStandings,
        standingsFinishedCount: diskStandings.length > 0
          ? diskMatches.filter((m) => m.status === 'FINISHED').length
          : -1,
        seasonId:        resolvedSeasonId,
        seasonYear,
        season,
        currentMatchday,
        fetchedAt:       0,          // marks as stale so fetchCompetition() re-fetches
        compInfoFetchedAt: 0,
        teamsFetchedAt:  diskTeams.length > 0 ? nowMs : 0,
        // fullSeasonFetched=true: tells fetchCompetition() to take the cheaper
        // incremental window path instead of burning quota on a full-season fetch
        fullSeasonFetched: diskMatches.length > 0,
      });

      console.log(
        `[AfCanonical] preload league=${leagueId} season=${season}: ` +
        `${diskTeams.length} teams, ${diskMatches.length} matches, ` +
        `${diskStandings.length} standings rows`,
      );
    }
  }
}

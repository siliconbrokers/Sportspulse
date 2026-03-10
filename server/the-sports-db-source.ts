import type { Team, Match } from '@sportpulse/canonical';
import {
  classifyStatus,
  Sport,
  competitionId as canonicalCompId,
  seasonId as canonicalSeasonId,
  teamId as canonicalTeamId,
  matchId as canonicalMatchId,
} from '@sportpulse/canonical';
import type { DataSource, StandingEntry } from '@sportpulse/snapshot';
import { persistTeamsCache, loadTeamsCache } from './matchday-cache.js';
import { resolveTla } from './tla-overrides.js';

// ── Provider key ─────────────────────────────────────────────────────────────

export const SPORTSDB_PROVIDER_KEY = 'thesportsdb';

// ── TheSportsDB raw response types ───────────────────────────────────────────

interface SDBEvent {
  idEvent: string;
  idHomeTeam: string;
  idAwayTeam: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strHomeTeamBadge?: string;
  strAwayTeamBadge?: string;
  dateEvent: string;  // "YYYY-MM-DD"
  strTime: string;    // "HH:MM:SS" UTC
  intHomeScore: string | null;
  intAwayScore: string | null;
  strStatus: string;
  intRound: string;
  strSeason: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CachedData {
  teams: Team[];
  matches: Match[];
  seasonId: string;
  currentMatchday: number | undefined;
  fetchedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;

// ── DataSource implementation ─────────────────────────────────────────────────

/**
 * DataSource backed by TheSportsDB API v1 (free tier).
 *
 * Fetches teams and season events for a given league, normalizes them to the
 * canonical model, and caches results in memory.
 *
 * All logging includes: provider name, league ID, endpoint, elapsed time,
 * cache hit/miss, and error details.
 */
export class TheSportsDbSource implements DataSource {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly leagueId: string;
  private readonly leagueName: string;
  private readonly _competitionId: string;
  private cache: CachedData | null = null;

  constructor(
    apiKey: string,
    leagueId: string,
    leagueName: string,
    baseUrl = 'https://www.thesportsdb.com/api/v1/json',
  ) {
    this.apiKey = apiKey;
    this.leagueId = leagueId;
    this.leagueName = leagueName;
    this.baseUrl = baseUrl;
    this._competitionId = canonicalCompId(SPORTSDB_PROVIDER_KEY, leagueId);
  }

  getTeams(compId: string): Team[] {
    if (!this.owns(compId)) return [];
    const hit = this.getCached();
    console.log(`[TheSportsDbSource] getTeams(${compId}) cache=${hit ? 'HIT' : 'MISS'}`);
    return hit?.teams ?? [];
  }

  getMatches(seasId: string): Match[] {
    const hit = this.getCached();
    if (!hit || hit.seasonId !== seasId) return [];
    return hit.matches;
  }

  getSeasonId(compId: string): string | undefined {
    if (!this.owns(compId)) return undefined;
    return this.getCached()?.seasonId;
  }

  getStandings(compId: string): StandingEntry[] {
    if (!this.owns(compId)) return [];
    const hit = this.getCached();
    if (!hit) return [];
    return computeStandings(hit.matches, hit.teams);
  }

  getCurrentMatchday(compId: string): number | undefined {
    if (!this.owns(compId)) return undefined;
    return this.getCached()?.currentMatchday;
  }

  getLastPlayedMatchday(compId: string): number | undefined {
    if (!this.owns(compId)) return undefined;
    const hit = this.getCached();
    if (!hit) return undefined;
    return computeLastPlayedMatchday(hit.matches);
  }

  getTotalMatchdays(compId: string): number {
    if (!this.owns(compId)) return 15;
    const hit = this.getCached();
    if (!hit) return 15;
    const rounds = new Set(
      hit.matches.map((m) => m.matchday).filter((m): m is number => m != null),
    );
    return rounds.size || 15;
  }

  /**
   * Fetches and caches all data for the given season (defaults to current year).
   * Must be called before getTeams/getMatches will return data.
   */
  async fetchSeason(season?: string): Promise<void> {
    const s = season ?? String(new Date().getFullYear());
    const seasId = canonicalSeasonId(SPORTSDB_PROVIDER_KEY, `${this.leagueId}-${s}`);
    const nowUtc = new Date().toISOString();
    const t0 = Date.now();

    console.log(
      `[TheSportsDbSource] Fetching league=${this.leagueId} (${this.leagueName}) season=${s}...`,
    );

    // Phase 1: fetch season events + extra rounds in parallel
    // TheSportsDB's eventsseason endpoint lags behind — fetch extra rounds explicitly.
    const eventsResp = await this.apiGet<{ events: SDBEvent[] | null }>(
      `/eventsseason.php?id=${this.leagueId}&s=${s}`,
    );
    const seasonEvents = eventsResp.events ?? [];

    const maxSeasonRound = seasonEvents.reduce(
      (max, e) => Math.max(max, parseInt(e.intRound, 10) || 0),
      0,
    );

    // Fetch 6 extra rounds ahead. eventsseason.php is unreliable — it sometimes
    // only returns already-played rounds, missing scheduled ones. 6 rounds ensures
    // we cover upcoming fixtures even when the season endpoint lags significantly.
    const extraRoundNumbers = Array.from({ length: 6 }, (_, i) => maxSeasonRound + 1 + i);
    const extraRoundResults = await Promise.all(
      extraRoundNumbers.map((r) =>
        this.apiGet<{ events: SDBEvent[] | null }>(
          `/eventsround.php?id=${this.leagueId}&r=${r}&s=${s}`,
        ).catch(() => ({ events: null })),
      ),
    );
    const extraEvents = extraRoundResults.flatMap((r) => r.events ?? []);

    // Merge all events: deduplicate by idEvent and filter to the expected season
    // (eventsround.php can return events from previous seasons if the round doesn't exist yet)
    const seenEvents = new Set(seasonEvents.map((e) => e.idEvent));
    const rawEvents = [
      ...seasonEvents,
      ...extraEvents.filter(
        (e) =>
          e.strSeason === s && !seenEvents.has(e.idEvent) && !!seenEvents.add(e.idEvent),
      ),
    ];

    // Phase 2: build team registry directly from event data.
    // Each event carries strHomeTeamBadge / strAwayTeamBadge, so we don't need
    // lookupteam.php (which returns wrong data for non-featured leagues on the free tier).
    // Use the last-seen badge URL per team ID (all events for the same team share the same URL).
    const teamIdMap = new Map<string, string>(); // providerTeamId → canonicalTeamId
    const teams: Team[] = [];

    const upsertTeam = (id: string, name: string, badgeUrl?: string) => {
      if (!teamIdMap.has(id)) {
        const canonId = canonicalTeamId(SPORTSDB_PROVIDER_KEY, id);
        teams.push({
          teamId: canonId,
          sportId: Sport.FOOTBALL,
          name,
          tla: resolveTla(name),
          crestUrl: badgeUrl || undefined,
          providerKey: SPORTSDB_PROVIDER_KEY,
          providerTeamId: id,
        });
        teamIdMap.set(id, canonId);
      } else if (badgeUrl) {
        // Update badge if we now have one and previously didn't
        const entry = teams.find((t) => t.providerTeamId === id);
        if (entry && !entry.crestUrl) entry.crestUrl = badgeUrl;
      }
    };

    for (const e of rawEvents) {
      upsertTeam(e.idHomeTeam, e.strHomeTeam, e.strHomeTeamBadge);
      upsertTeam(e.idAwayTeam, e.strAwayTeam, e.strAwayTeamBadge);
    }

    // Map events → canonical matches
    const matches: Match[] = [];
    for (const e of rawEvents) {
      const homeTeamId = teamIdMap.get(e.idHomeTeam);
      const awayTeamId = teamIdMap.get(e.idAwayTeam);
      if (!homeTeamId || !awayTeamId) {
        console.warn(`[TheSportsDbSource] Unresolvable teams for event ${e.idEvent}, skipping`);
        continue;
      }

      const startTimeUtc =
        e.dateEvent && e.strTime ? `${e.dateEvent}T${e.strTime}Z` : null;

      matches.push({
        matchId: canonicalMatchId(SPORTSDB_PROVIDER_KEY, e.idEvent),
        seasonId: seasId,
        matchday: parseInt(e.intRound, 10) || undefined,
        startTimeUtc,
        status: classifyStatus(e.strStatus),
        homeTeamId,
        awayTeamId,
        scoreHome:
          e.intHomeScore !== null && e.intHomeScore !== ''
            ? Number(e.intHomeScore)
            : null,
        scoreAway:
          e.intAwayScore !== null && e.intAwayScore !== ''
            ? Number(e.intAwayScore)
            : null,
        providerKey: SPORTSDB_PROVIDER_KEY,
        providerMatchId: e.idEvent,
        lastSeenUtc: nowUtc,
      });
    }

    const currentMatchday = deriveCurrentMatchday(matches);
    const elapsed = Date.now() - t0;

    console.log(
      `[TheSportsDbSource] Done league=${this.leagueId} season=${s}: ` +
        `teams=${teams.length}, matches=${matches.length}, ` +
        `currentMatchday=${currentMatchday ?? 'none'} (${elapsed}ms)`,
    );

    // Persist teams to disk for recovery after rate-limit restarts
    persistTeamsCache(SPORTSDB_PROVIDER_KEY, this.leagueId, teams);

    this.cache = {
      teams,
      matches,
      seasonId: seasId,
      currentMatchday,
      fetchedAt: Date.now(),
    };
  }

  private owns(compId: string): boolean {
    return compId === this._competitionId;
  }

  private getCached(): CachedData | null {
    if (!this.cache) return null;
    // Always return cached data even if stale — the periodic setInterval handles
    // refreshes. Stale data is far better than returning null → empty arrays.
    return this.cache;
  }

  private async apiGet<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}/${this.apiKey}${path}`;
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.error(
        `[TheSportsDbSource] Network error for ${path} (${elapsed}ms):`,
        err,
      );
      throw err;
    }
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      console.error(
        `[TheSportsDbSource] HTTP ${res.status} for ${path} (${elapsed}ms)`,
      );
      throw new Error(`thesportsdb HTTP ${res.status}: ${path}`);
    }
    console.log(`[TheSportsDbSource] GET ${path} → ${res.status} (${elapsed}ms)`);
    return res.json() as Promise<T>;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the lowest round that has at least one non-FINISHED match
 * (i.e., the active or next upcoming round).
 * Falls back to the highest finished round if all matches are done.
 */
function deriveCurrentMatchday(matches: Match[]): number | undefined {
  let minFuture: number | undefined;
  let maxFinished: number | undefined;

  for (const m of matches) {
    if (m.matchday === undefined) continue;
    if (m.status !== 'FINISHED') {
      if (minFuture === undefined || m.matchday < minFuture) minFuture = m.matchday;
    } else {
      if (maxFinished === undefined || m.matchday > maxFinished) maxFinished = m.matchday;
    }
  }

  return minFuture ?? maxFinished;
}

/** Compute standings from FINISHED matches (used when provider doesn't supply a table). */
function computeStandings(matches: Match[], teams: Team[]): StandingEntry[] {
  const teamMap = new Map<string, Team>(teams.map((t) => [t.teamId, t]));

  interface Row {
    teamId: string;
    played: number;
    won: number;
    draw: number;
    lost: number;
    gf: number;
    ga: number;
  }

  const rows = new Map<string, Row>();

  const getRow = (teamId: string): Row => {
    if (!rows.has(teamId)) {
      rows.set(teamId, { teamId, played: 0, won: 0, draw: 0, lost: 0, gf: 0, ga: 0 });
    }
    return rows.get(teamId)!;
  };

  for (const m of matches) {
    if (m.status !== 'FINISHED') continue;
    if (m.scoreHome === null || m.scoreAway === null) continue;

    const home = getRow(m.homeTeamId);
    const away = getRow(m.awayTeamId);

    home.played++;
    away.played++;
    home.gf += m.scoreHome;
    home.ga += m.scoreAway;
    away.gf += m.scoreAway;
    away.ga += m.scoreHome;

    if (m.scoreHome > m.scoreAway) {
      home.won++;
      away.lost++;
    } else if (m.scoreHome < m.scoreAway) {
      away.won++;
      home.lost++;
    } else {
      home.draw++;
      away.draw++;
    }
  }

  const sorted = [...rows.values()].sort((a, b) => {
    const ptsDiff = (b.won * 3 + b.draw) - (a.won * 3 + a.draw);
    if (ptsDiff !== 0) return ptsDiff;
    const gdDiff = (b.gf - b.ga) - (a.gf - a.ga);
    if (gdDiff !== 0) return gdDiff;
    const gfDiff = b.gf - a.gf;
    if (gfDiff !== 0) return gfDiff;
    return a.teamId.localeCompare(b.teamId);
  });

  return sorted.map((r, i) => {
    const team = teamMap.get(r.teamId);
    const gd = r.gf - r.ga;
    return {
      position: i + 1,
      teamId: r.teamId,
      teamName: team?.name ?? r.teamId,
      tla: team?.tla ?? resolveTla(team?.name ?? r.teamId),
      crestUrl: team?.crestUrl,
      playedGames: r.played,
      won: r.won,
      draw: r.draw,
      lost: r.lost,
      goalsFor: r.gf,
      goalsAgainst: r.ga,
      goalDifference: gd,
      points: r.won * 3 + r.draw,
    };
  });
}

/** Highest matchday where ALL matches have status FINISHED. */
function computeLastPlayedMatchday(matches: Match[]): number | undefined {
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

import type { Team, Match } from '@sportpulse/canonical';
import { CrestCache } from './crest-cache.js';
import {
  classifyStatus,
  Sport,
  competitionId as canonicalCompId,
  seasonId as canonicalSeasonId,
  teamId as canonicalTeamId,
  matchId as canonicalMatchId,
} from '@sportpulse/canonical';
import type { DataSource, MatchGoalEventDTO, StandingEntry } from '@sportpulse/snapshot';
import { resolveTla } from './tla-overrides.js';

// ── Provider key ─────────────────────────────────────────────────────────────

export const OPENLIGADB_PROVIDER_KEY = 'openligadb';

const BASE_URL = 'https://api.openligadb.de';

// ── Crest overrides ───────────────────────────────────────────────────────────
// OpenLigaDB uses Wikipedia /thumb/ URLs and unreliable 3rd-party hosts.
// These overrides replace broken URLs with stable direct SVG links.

const CREST_OVERRIDES: Record<number, string> = {
  7:   'https://upload.wikimedia.org/wikipedia/commons/6/67/Borussia_Dortmund_logo.svg',
  6:   'https://tmssl.akamaized.net/images/wappen/head/15.png',  // Bayer 04 Leverkusen
  65:  'https://tmssl.akamaized.net/images/wappen/head/3.png',   // 1. FC Köln
  81:  'https://upload.wikimedia.org/wikipedia/commons/9/9e/Logo_Mainz_05.svg',
  134: 'https://upload.wikimedia.org/wikipedia/commons/b/be/SV-Werder-Bremen-Logo.svg',
  131: 'https://upload.wikimedia.org/wikipedia/commons/f/f3/Logo-VfL-Wolfsburg.svg',
  199: 'https://upload.wikimedia.org/wikipedia/commons/9/9d/1._FC_Heidenheim_1846.svg',
};

// ── OpenLigaDB raw response types ─────────────────────────────────────────────

interface OLGTeam {
  teamId: number;
  teamName: string;
  shortName: string;
  teamIconUrl: string;
}

interface OLGMatchTeam {
  teamId: number;
  teamName: string;
  shortName: string;
  teamIconUrl: string;
}

interface OLGGoal {
  goalID: number;
  scoreTeam1: number;
  scoreTeam2: number;
  matchMinute: number | null;
  goalGetterName: string;
  isPenalty: boolean;
  isOwnGoal: boolean;
  isOvertime: boolean;
}

interface OLGMatch {
  matchID: number;
  matchDateTimeUTC: string; // ISO 8601 UTC
  group: { groupOrderID: number };
  team1: OLGMatchTeam;
  team2: OLGMatchTeam;
  matchIsFinished: boolean;
  matchResults: Array<{ resultTypeID: number; pointsTeam1: number; pointsTeam2: number }>;
  goals?: OLGGoal[];
}

interface OLGTableEntry {
  teamInfoId: number;
  teamName: string;
  shortName: string;
  teamIconUrl: string;
  points: number;
  goals: number;
  opponentGoals: number;
  goalDiff: number;
  matches: number;
  won: number;
  draw: number;
  lost: number;
}

interface OLGCurrentGroup {
  groupOrderID: number;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CachedData {
  teams: Team[];
  matches: Match[];
  seasonId: string;
  currentMatchday: number | undefined;
  standings: StandingEntry[];
  fetchedAt: number;
}

// ── DataSource implementation ─────────────────────────────────────────────────

/**
 * DataSource backed by OpenLigaDB (no auth required).
 *
 * Implements the full DataSource interface for Bundesliga (BL1).
 * OpenLigaDB provides teams, matches (bulk, no goals), standings,
 * and individual match data including goal events.
 *
 * Goal events are fetched on-demand via getMatchGoals() and cached
 * indefinitely (FINISHED matches are immutable).
 */
export class OpenLigaDBSource implements DataSource {
  private readonly league: string;
  private readonly leagueName: string;
  private readonly _competitionId: string;
  private cache: CachedData | null = null;
  private readonly goalsCache = new Map<string, MatchGoalEventDTO[]>();
  private readonly crestCache = new CrestCache();

  constructor(league: string, leagueName: string) {
    this.league = league;
    this.leagueName = leagueName;
    this._competitionId = canonicalCompId(OPENLIGADB_PROVIDER_KEY, league);
  }

  getTeams(compId: string): Team[] {
    if (!this.owns(compId)) return [];
    const hit = this.getCached();
    console.log(`[OpenLigaDBSource] getTeams(${compId}) cache=${hit ? 'HIT' : 'MISS'}`);
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
    return this.getCached()?.standings ?? [];
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
    if (!this.owns(compId)) return 34; // Bundesliga has 34 matchdays
    const hit = this.getCached();
    if (!hit) return 34;
    const rounds = new Set(
      hit.matches.map((m) => m.matchday).filter((m): m is number => m != null),
    );
    return rounds.size || 34;
  }

  /**
   * Fetches goals for a finished match via the individual match endpoint.
   * Results are cached indefinitely (FINISHED matches are immutable).
   */
  async getMatchGoals(canonicalId: string): Promise<MatchGoalEventDTO[]> {
    if (this.goalsCache.has(canonicalId)) {
      return this.goalsCache.get(canonicalId)!;
    }

    const parts = canonicalId.split(':'); // ['match', 'openligadb', providerMatchId]
    const providerMatchId = parts[2];
    if (!providerMatchId) return [];

    try {
      const match = await this.apiGet<OLGMatch>(`/getmatchdata/${providerMatchId}`);
      const goals = mapGoals(match.goals ?? []);
      this.goalsCache.set(canonicalId, goals);
      console.log(
        `[OpenLigaDBSource] getMatchGoals(${canonicalId}) → ${goals.length} goal(s) cached`,
      );
      return goals;
    } catch (err) {
      console.warn(`[OpenLigaDBSource] getMatchGoals failed for ${canonicalId}:`, err);
      return [];
    }
  }

  /**
   * Fetches and caches all data for the current season.
   * Must be called before getTeams/getMatches will return data.
   */
  async fetchSeason(): Promise<void> {
    // European football seasons span two calendar years (e.g. 2025-26).
    // OpenLigaDB indexes them by the starting year. If we're in Jan-Jun,
    // the current season started in the previous year.
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-based
    const season = String(month < 7 ? year - 1 : year);
    const seasId = canonicalSeasonId(OPENLIGADB_PROVIDER_KEY, `${this.league}-${season}`);
    const nowUtc = new Date().toISOString();
    const t0 = Date.now();

    console.log(
      `[OpenLigaDBSource] Fetching league=${this.league} (${this.leagueName}) season=${season}...`,
    );

    // Fetch in parallel: all matches + standings + current group
    const [rawMatches, rawTable, currentGroup] = await Promise.all([
      this.apiGet<OLGMatch[]>(`/getmatchdata/${this.league}/${season}`),
      this.apiGet<OLGTableEntry[]>(`/getbltable/${this.league}/${season}`),
      this.apiGet<OLGCurrentGroup>(`/getcurrentgroup/${this.league}`),
    ]);

    // Build team registry from match data
    const teamIdMap = new Map<number, string>(); // providerTeamId → canonicalTeamId
    const teams: Team[] = [];

    const upsertTeam = (t: OLGMatchTeam) => {
      if (!teamIdMap.has(t.teamId)) {
        const canonId = canonicalTeamId(OPENLIGADB_PROVIDER_KEY, String(t.teamId));
        teams.push({
          teamId: canonId,
          sportId: Sport.FOOTBALL,
          name: t.teamName,
          tla: resolveTla(t.teamName, t.shortName ? t.shortName.slice(0, 3).toUpperCase() : undefined),
          crestUrl: CREST_OVERRIDES[t.teamId] ?? (t.teamIconUrl || undefined),
          providerKey: OPENLIGADB_PROVIDER_KEY,
          providerTeamId: String(t.teamId),
        });
        teamIdMap.set(t.teamId, canonId);
      }
    };

    for (const m of rawMatches) {
      upsertTeam(m.team1);
      upsertTeam(m.team2);
    }

    // Map matches → canonical model
    const matches: Match[] = rawMatches.map((m) => {
      const homeTeamId = teamIdMap.get(m.team1.teamId) ?? canonicalTeamId(OPENLIGADB_PROVIDER_KEY, String(m.team1.teamId));
      const awayTeamId = teamIdMap.get(m.team2.teamId) ?? canonicalTeamId(OPENLIGADB_PROVIDER_KEY, String(m.team2.teamId));

      // Extract final score from matchResults (resultTypeID === 2 = final result)
      const finalResult = m.matchResults?.find((r) => r.resultTypeID === 2)
        ?? m.matchResults?.find((r) => r.resultTypeID === 1); // fallback to half-time if no final

      const scoreHome = m.matchIsFinished && finalResult ? finalResult.pointsTeam1 : null;
      const scoreAway = m.matchIsFinished && finalResult ? finalResult.pointsTeam2 : null;

      // matchIsFinished: true → FINISHED, false → SCHEDULED
      // The live-detection heuristic in match-card-builder will handle in-progress matches
      const status = classifyStatus(m.matchIsFinished ? 'Finished' : 'Timed');

      return {
        matchId: canonicalMatchId(OPENLIGADB_PROVIDER_KEY, String(m.matchID)),
        seasonId: seasId,
        matchday: m.group?.groupOrderID ?? undefined,
        startTimeUtc: m.matchDateTimeUTC ?? null,
        status,
        homeTeamId,
        awayTeamId,
        scoreHome,
        scoreAway,
        providerKey: OPENLIGADB_PROVIDER_KEY,
        providerMatchId: String(m.matchID),
        lastSeenUtc: nowUtc,
      };
    });

    // Build standings from official table
    const standings: StandingEntry[] = rawTable.map((entry, i) => {
      const canonId = canonicalTeamId(OPENLIGADB_PROVIDER_KEY, String(entry.teamInfoId));
      return {
        position: i + 1,
        teamId: canonId,
        teamName: entry.teamName,
        tla: resolveTla(entry.teamName),
        crestUrl: CREST_OVERRIDES[entry.teamInfoId] ?? (entry.teamIconUrl || undefined),
        playedGames: entry.matches,
        won: entry.won,
        draw: entry.draw,
        lost: entry.lost,
        goalsFor: entry.goals,
        goalsAgainst: entry.opponentGoals,
        goalDifference: entry.goalDiff,
        points: entry.points,
      };
    });

    const currentMatchday = currentGroup?.groupOrderID;
    const elapsed = Date.now() - t0;

    console.log(
      `[OpenLigaDBSource] Done league=${this.league} season=${season}: ` +
        `teams=${teams.length}, matches=${matches.length}, ` +
        `currentMatchday=${currentMatchday ?? 'none'} (${elapsed}ms)`,
    );

    this.cache = {
      teams,
      matches,
      seasonId: seasId,
      currentMatchday,
      standings,
      fetchedAt: Date.now(),
    };

    // Asynchronously download and cache crest images to disk.
    // On first run this fetches from external URLs; subsequent starts use local files.
    this.crestCache.warmup(
      teams.map((t) => ({ providerTeamId: t.providerTeamId, crestUrl: t.crestUrl })),
      OPENLIGADB_PROVIDER_KEY,
    ).then((urlMap) => {
      if (!this.cache) return;
      // Update teams and standings with local cached URLs
      this.cache = {
        ...this.cache,
        teams: this.cache.teams.map((t) => ({
          ...t,
          crestUrl: urlMap.get(t.providerTeamId) ?? t.crestUrl,
        })),
        standings: this.cache.standings.map((s) => {
          const teamProvId = s.teamId.split(':')[2];
          return teamProvId
            ? { ...s, crestUrl: urlMap.get(teamProvId) ?? s.crestUrl }
            : s;
        }),
      };
      console.log(`[OpenLigaDBSource] crest cache warm (${urlMap.size} teams)`);
    }).catch((err) => {
      console.warn('[OpenLigaDBSource] crest warmup error:', err);
    });
  }

  private owns(compId: string): boolean {
    return compId === this._competitionId;
  }

  private getCached(): CachedData | null {
    // Always return cached data even if stale — the periodic setInterval handles refreshes.
    return this.cache;
  }

  private async apiGet<T>(path: string): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.error(`[OpenLigaDBSource] Network error for ${path} (${elapsed}ms):`, err);
      throw err;
    }
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      console.error(`[OpenLigaDBSource] HTTP ${res.status} for ${path} (${elapsed}ms)`);
      throw new Error(`openligadb HTTP ${res.status}: ${path}`);
    }
    console.log(`[OpenLigaDBSource] GET ${path} → ${res.status} (${elapsed}ms)`);
    return res.json() as Promise<T>;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps OpenLigaDB goals to MatchGoalEventDTO[].
 *
 * HOME/AWAY determination: sort by goalID ascending, compare each goal's
 * running score to the previous state (starting at 0-0). If scoreTeam1
 * increased → HOME scored; if scoreTeam2 increased → AWAY scored.
 */
function mapGoals(goals: OLGGoal[]): MatchGoalEventDTO[] {
  const sorted = [...goals].sort((a, b) => a.goalID - b.goalID);

  let prevScore1 = 0;
  let prevScore2 = 0;

  const result: MatchGoalEventDTO[] = [];

  for (const g of sorted) {
    let team: 'HOME' | 'AWAY';
    if (g.scoreTeam1 > prevScore1) {
      team = 'HOME';
    } else if (g.scoreTeam2 > prevScore2) {
      team = 'AWAY';
    } else {
      // Fallback: use best guess from score delta
      team = 'HOME';
    }

    prevScore1 = g.scoreTeam1;
    prevScore2 = g.scoreTeam2;

    const type: 'GOAL' | 'OWN_GOAL' | 'PENALTY' = g.isOwnGoal
      ? 'OWN_GOAL'
      : g.isPenalty
        ? 'PENALTY'
        : 'GOAL';

    const minute = g.matchMinute ?? 0;

    result.push({
      minute,
      type,
      team,
      scorerName: g.goalGetterName || undefined,
    });
  }

  return result;
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

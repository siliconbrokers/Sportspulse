/**
 * ApiFootballSource — fetches post-match goal events via API-Football (RapidAPI).
 *
 * Strategy (post-match ONLY):
 *   1. Check disk cache (/cache/events/) — HIT: return immediately, no API call
 *   2. MISS: find fixture by date + league + score, fetch events
 *   3. Persist to disk permanently (FINISHED matches are immutable)
 *
 * Budget: 1 request per match × N matches per matchday. Well within 100 req/day free tier.
 * Covers: PD (LaLiga), PL (Premier League), URU (Liga Uruguaya).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DataSource, MatchGoalEventDTO } from '@sportpulse/snapshot';

const CACHE_DIR = path.resolve(process.cwd(), 'cache', 'events');
const BASE_URL = 'https://v3.football.api-sports.io';

// API-Football league IDs + season resolver per competition
const FD_LEAGUE_CONFIG: Record<string, { id: number; season: (d: Date) => number }> = {
  PD:  { id: 140, season: (d) => d.getUTCMonth() < 6 ? d.getUTCFullYear() - 1 : d.getUTCFullYear() },
  PL:  { id: 39,  season: (d) => d.getUTCMonth() < 6 ? d.getUTCFullYear() - 1 : d.getUTCFullYear() },
};

const SDB_LEAGUE_CONFIG: Record<string, { id: number; season: (d: Date) => number }> = {
  '4432': { id: 268, season: (d) => d.getUTCFullYear() }, // Liga Uruguaya (calendar year)
};

// ── API-Football raw types ─────────────────────────────────────────────────────

interface AfFixture {
  fixture: { id: number };
  teams:   { home: { id: number }; away: { id: number } };
  goals:   { home: number | null; away: number | null };
}

interface AfEvent {
  time:   { elapsed: number; extra: number | null };
  team:   { id: number };
  player: { name: string | null };
  type:   string;
  detail: string;
}

// ── Source implementation ──────────────────────────────────────────────────────

export class ApiFootballSource {
  constructor(
    private readonly apiKey: string,
    private readonly dataSource: DataSource,
  ) {}

  async getMatchGoals(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> {
    // Disk cache first — FINISHED matches are immutable, never re-fetch
    const cached = await this.readCache(canonicalMatchId);
    if (cached !== null) {
      console.log(`[ApiFootballSource] cache HIT for ${canonicalMatchId} (${cached.length} goals)`);
      return cached;
    }

    const parts = canonicalMatchId.split(':'); // ['match', providerKey, providerMatchId]
    const providerKey = parts[1];

    try {
      let goals: MatchGoalEventDTO[];

      if (providerKey === 'football-data') {
        goals = await this.fetchViaFdMatch(canonicalMatchId);
      } else if (providerKey === 'thesportsdb') {
        goals = await this.fetchViaSdbMatch(canonicalMatchId);
      } else {
        return [];
      }

      await this.writeCache(canonicalMatchId, goals);
      console.log(`[ApiFootballSource] ${canonicalMatchId} → ${goals.length} goal(s) cached to disk`);
      return goals;
    } catch (err) {
      console.warn(`[ApiFootballSource] failed for ${canonicalMatchId}:`, err);
      return [];
    }
  }

  // ── Lookup helpers ─────────────────────────────────────────────────────────

  private async fetchViaFdMatch(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> {
    for (const [code, config] of Object.entries(FD_LEAGUE_CONFIG)) {
      const compId = `comp:football-data:${code}`;
      const seasonId = this.dataSource.getSeasonId(compId);
      if (!seasonId) continue;
      const match = this.dataSource.getMatches(seasonId).find((m) => m.matchId === canonicalMatchId);
      if (!match?.startTimeUtc) continue;

      const d = new Date(match.startTimeUtc);
      return this.findFixtureAndFetchGoals(
        config.id,
        config.season(d),
        match.startTimeUtc.slice(0, 10),
        match.scoreHome,
        match.scoreAway,
      );
    }
    return [];
  }

  private async fetchViaSdbMatch(canonicalMatchId: string): Promise<MatchGoalEventDTO[]> {
    for (const [leagueKey, config] of Object.entries(SDB_LEAGUE_CONFIG)) {
      const compId = `comp:thesportsdb:${leagueKey}`;
      const seasonId = this.dataSource.getSeasonId(compId);
      if (!seasonId) continue;
      const match = this.dataSource.getMatches(seasonId).find((m) => m.matchId === canonicalMatchId);
      if (!match?.startTimeUtc) continue;

      const d = new Date(match.startTimeUtc);
      return this.findFixtureAndFetchGoals(
        config.id,
        config.season(d),
        match.startTimeUtc.slice(0, 10),
        match.scoreHome,
        match.scoreAway,
      );
    }
    return [];
  }

  private async findFixtureAndFetchGoals(
    leagueId: number,
    season: number,
    date: string,
    scoreHome: number | null,
    scoreAway: number | null,
  ): Promise<MatchGoalEventDTO[]> {
    const fixturesData = await this.apiGet<{ response: AfFixture[] }>(
      `/fixtures?date=${date}&league=${leagueId}&season=${season}`,
    );

    const list = fixturesData.response ?? [];
    console.log(`[ApiFootballSource] /fixtures date=${date} league=${leagueId} → ${list.length} fixtures`);

    // Disambiguate by final score (definitive for finished matches)
    const fixture = list.length === 1
      ? list[0]
      : list.find((f) => f.goals.home === scoreHome && f.goals.away === scoreAway)
        ?? list[0];

    if (!fixture) return [];

    const eventsData = await this.apiGet<{ response: AfEvent[] }>(
      `/fixtures/events?fixture=${fixture.fixture.id}`,
    );

    const homeTeamId = fixture.teams.home.id;

    return (eventsData.response ?? [])
      .filter((e) => e.type === 'Goal' && e.detail !== 'Missed Penalty')
      .map((e) => ({
        minute: e.time.elapsed + (e.time.extra ?? 0),
        type: e.detail === 'Own Goal' ? 'OWN_GOAL' as const
            : e.detail === 'Penalty'  ? 'PENALTY'  as const
            : 'GOAL' as const,
        team: e.team.id === homeTeamId ? 'HOME' as const : 'AWAY' as const,
        scorerName: e.player.name || undefined,
      }));
  }

  // ── Disk cache ─────────────────────────────────────────────────────────────

  private cachePath(canonicalMatchId: string): string {
    const safe = canonicalMatchId.replace(/[:/]/g, '_');
    return path.join(CACHE_DIR, `${safe}.json`);
  }

  private async readCache(canonicalMatchId: string): Promise<MatchGoalEventDTO[] | null> {
    try {
      const raw = await fs.readFile(this.cachePath(canonicalMatchId), 'utf8');
      return JSON.parse(raw) as MatchGoalEventDTO[];
    } catch {
      return null;
    }
  }

  private async writeCache(canonicalMatchId: string, goals: MatchGoalEventDTO[]): Promise<void> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const filePath = this.cachePath(canonicalMatchId);
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(goals));
    await fs.rename(tmp, filePath);
  }

  private async apiGet<T>(path: string): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-key': this.apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io',
      },
      signal: AbortSignal.timeout(10_000),
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}: ${path}`);
    console.log(`[ApiFootballSource] GET ${path} → ${res.status} (${elapsed}ms)`);
    return res.json() as Promise<T>;
  }
}

/**
 * ApiFootballIncidentSource — fetches match incidents via api-sports.io.
 *
 * Replaces the Flashscore scraper (which failed: Flashscore is JS-rendered).
 * API-Football returns structured JSON for goals, cards, substitutions, VAR.
 *
 * Flow:
 *   1. Check fixture cache (/cache/incidents/af-fixture-map.json) for AF fixture ID + homeTeamId
 *   2. MISS → /fixtures?live=all&league= (primary, no season restriction)
 *          → /fixtures?date=&league=&season= (fallback, free plan: 2022-2024 only)
 *   3. Fetch /fixtures/events?fixture={id} → map to IncidentEvent[]
 *
 * Covered competitions:
 *   comp:football-data:PD   → League 140 (LaLiga)
 *   comp:football-data:PL   → League 39  (Premier League)
 *   comp:openligadb:bl1     → League 78  (Bundesliga)
 *   comp:thesportsdb:4432   → League 268 (Liga Uruguaya)
 *   comp:football-data-wc:WC → League 1  (World Cup 2026)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MatchCoreInput, IncidentEvent } from './types.js';

const BASE_URL    = 'https://v3.football.api-sports.io';
const ID_MAP_PATH = path.resolve(process.cwd(), 'cache', 'incidents', 'af-fixture-map.json');

// ── Competition → API-Football league config ───────────────────────────────────

interface LeagueConfig {
  id:     number;
  season: (kickoffUtc: string) => number;
}

const COMP_LEAGUE_MAP: Record<string, LeagueConfig> = {
  'comp:football-data:PD':      { id: 140, season: europeanSeason },
  'comp:football-data:PL':      { id: 39,  season: europeanSeason },
  'comp:openligadb:bl1':        { id: 78,  season: europeanSeason },
  'comp:thesportsdb:4432':      { id: 268, season: (k) => new Date(k).getUTCFullYear() },
  'comp:football-data-wc:WC':   { id: 1,   season: (k) => new Date(k).getUTCFullYear() },
  'comp:football-data-cli:CLI': { id: 13,  season: (k) => new Date(k).getUTCFullYear() },
};

function europeanSeason(kickoffUtc: string): number {
  const d = new Date(kickoffUtc);
  return d.getUTCMonth() < 6 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

// ── Fixture cache ──────────────────────────────────────────────────────────────

interface FixtureEntry { fixtureId: number; homeTeamId: number }
type FixtureMap = Record<string, FixtureEntry>;

let _cache: FixtureMap | null = null;

async function loadMap(): Promise<FixtureMap> {
  if (_cache !== null) return _cache;
  try {
    _cache = JSON.parse(await fs.readFile(ID_MAP_PATH, 'utf8')) as FixtureMap;
  } catch {
    _cache = {};
  }
  return _cache;
}

async function persistEntry(matchId: string, entry: FixtureEntry): Promise<void> {
  const map = await loadMap();
  map[matchId] = entry;
  await fs.mkdir(path.dirname(ID_MAP_PATH), { recursive: true });
  const tmp = `${ID_MAP_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2));
  await fs.rename(tmp, ID_MAP_PATH);
}

// ── Name normalization for fuzzy matching ──────────────────────────────────────

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|cf|sc|ac|as|bv|sv|fk|rc|rcd|cd|ud|sd|ue|afc)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalize(a), nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ── Event type mapping ─────────────────────────────────────────────────────────

function mapType(afType: string, afDetail: string): IncidentEvent['type'] | null {
  const t = afType.toLowerCase();
  const d = afDetail.toLowerCase();
  if (t === 'goal') {
    if (d.includes('own goal'))       return 'OWN_GOAL';
    if (d.includes('missed penalty')) return 'PENALTY_MISSED';
    if (d.includes('penalty'))        return 'PENALTY_GOAL';
    return 'GOAL';
  }
  if (t === 'card') {
    if (d.includes('yellow red'))     return 'YELLOW_RED_CARD';
    if (d.includes('red card'))       return 'RED_CARD';
    if (d.includes('yellow card'))    return 'YELLOW_CARD';
    return null;
  }
  if (t === 'subst') return 'SUBSTITUTION';
  if (t === 'var')   return 'VAR';
  return null;
}

// ── Raw API-Football types ─────────────────────────────────────────────────────

interface AfFixtureItem {
  fixture: { id: number };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
}

interface AfEvent {
  time:   { elapsed: number; extra: number | null };
  team:   { id: number };
  player: { name: string | null };
  assist: { name: string | null };
  type:   string;
  detail: string;
}

// ── Main class ─────────────────────────────────────────────────────────────────

export class ApiFootballIncidentSource {
  constructor(private readonly apiKey: string) {}

  async getIncidents(matchCore: MatchCoreInput): Promise<IncidentEvent[]> {
    const config = COMP_LEAGUE_MAP[matchCore.competitionId];
    if (!config) return []; // Bundesliga or unknown → skip

    const map = await loadMap();
    let entry = map[matchCore.matchId] ?? null;

    if (!entry) {
      entry = await this.resolveFixture(matchCore, config);
      if (!entry) {
        console.warn(`[AfIncidents] No fixture found for ${matchCore.matchId} (${matchCore.homeTeamName} vs ${matchCore.awayTeamName})`);
        return [];
      }
      await persistEntry(matchCore.matchId, entry);
      console.log(`[AfIncidents] Resolved ${matchCore.matchId} → AF fixture ${entry.fixtureId}`);
    }

    return this.fetchEvents(entry.fixtureId, entry.homeTeamId);
  }

  private async resolveFixture(
    matchCore: MatchCoreInput,
    config: LeagueConfig,
  ): Promise<FixtureEntry | null> {
    // Strategy: API-Football free plan restricts date+season queries to 2022-2024.
    // Instead, use the live endpoint (works without season restriction) to resolve
    // the fixture ID while the match is in progress. Once cached, it's reused for
    // the final fetch after the match ends.
    const found = await this.resolveViaLive(matchCore, config.id)
      ?? await this.resolveViaDate(matchCore, config);
    return found;
  }

  private async resolveViaLive(
    matchCore: MatchCoreInput,
    leagueId: number,
  ): Promise<FixtureEntry | null> {
    try {
      const data = await this.apiGet<{ response: AfFixtureItem[] }>(
        `/fixtures?live=all&league=${leagueId}`,
      );
      const fixtures = data.response ?? [];
      console.log(`[AfIncidents] /fixtures?live=all league=${leagueId} → ${fixtures.length} live fixtures`);
      const match = fixtures.find((f) =>
        nameMatches(f.teams.home.name, matchCore.homeTeamName ?? '') &&
        nameMatches(f.teams.away.name, matchCore.awayTeamName ?? ''),
      );
      if (!match) return null;
      return { fixtureId: match.fixture.id, homeTeamId: match.teams.home.id };
    } catch {
      return null;
    }
  }

  private async resolveViaDate(
    matchCore: MatchCoreInput,
    config: LeagueConfig,
  ): Promise<FixtureEntry | null> {
    if (!matchCore.kickoffUtc) return null;
    const date   = matchCore.kickoffUtc.slice(0, 10);
    const season = config.season(matchCore.kickoffUtc);
    try {
      const data = await this.apiGet<{ response: AfFixtureItem[] }>(
        `/fixtures?date=${date}&league=${config.id}&season=${season}`,
      );
      const fixtures = data.response ?? [];
      console.log(`[AfIncidents] /fixtures date=${date} league=${config.id} → ${fixtures.length} items`);
      const match = fixtures.find((f) =>
        nameMatches(f.teams.home.name, matchCore.homeTeamName ?? '') &&
        nameMatches(f.teams.away.name, matchCore.awayTeamName ?? ''),
      );
      if (!match) return null;
      return { fixtureId: match.fixture.id, homeTeamId: match.teams.home.id };
    } catch {
      return null;
    }
  }

  private async fetchEvents(fixtureId: number, homeTeamId: number): Promise<IncidentEvent[]> {
    let events: AfEvent[];
    try {
      const data = await this.apiGet<{ response: AfEvent[] }>(
        `/fixtures/events?fixture=${fixtureId}`,
      );
      events = data.response ?? [];
      console.log(`[AfIncidents] fixture ${fixtureId} → ${events.length} events`);
    } catch (err) {
      console.warn(`[AfIncidents] /fixtures/events failed for fixture ${fixtureId}:`, err);
      return [];
    }

    const results: IncidentEvent[] = [];
    for (const e of events) {
      const type = mapType(e.type, e.detail);
      if (!type) continue;

      const teamSide: 'HOME' | 'AWAY' = e.team.id === homeTeamId ? 'HOME' : 'AWAY';
      const minute      = e.time.elapsed;
      const minuteExtra = e.time.extra ?? undefined;
      const playerName  = e.player.name ?? undefined;

      if (type === 'SUBSTITUTION') {
        results.push({
          type,
          minute,
          minuteExtra,
          teamSide,
          playerName,                            // player coming in
          playerOutName: e.assist.name ?? undefined, // player going out
        });
      } else if (type === 'GOAL' || type === 'PENALTY_GOAL') {
        results.push({
          type,
          minute,
          minuteExtra,
          teamSide,
          playerName,
          assistName: e.assist.name ?? undefined,
        });
      } else {
        results.push({ type, minute, minuteExtra, teamSide, playerName });
      }
    }

    return results;
  }

  private async apiGet<T>(endpoint: string): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-key': this.apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}: ${endpoint}`);
    return res.json() as Promise<T>;
  }
}

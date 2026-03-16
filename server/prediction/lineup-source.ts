/**
 * lineup-source.ts — Fetcher de alineaciones confirmadas desde API-Football v3.
 *
 * Endpoints:
 *   GET https://v3.football.api-sports.io/fixtures?league={id}&season={year}&date={YYYY-MM-DD}
 *   GET https://v3.football.api-sports.io/fixtures/lineups?fixture={fixtureId}
 *
 * Cuándo están disponibles: las alineaciones se publican ~60 minutos antes del kickoff.
 * El servicio no fetchea si minutesToKickoff > 90 (sin requests innecesarios).
 *
 * Budget: usa af-budget.ts para coordinar con los demás consumidores de APIFOOTBALL_KEY.
 * Cache: en memoria — fixtures list TTL 1h por (leagueId+date), lineups TTL 2h por fixtureId.
 * Fault isolation: cualquier error retorna [] silenciosamente.
 *
 * MKT-T3-04
 */

import {
  isQuotaExhausted,
  consumeRequest,
  markQuotaExhausted,
} from '../af-budget.js';
import type { ConfirmedLineupRecord, PlayerPosition } from '@sportpulse/prediction';
import { normTeamName } from './injury-source.js';

// ── League ID mapping (same as injury-source.ts) ──────────────────────────────

const AF_LEAGUE_IDS: Record<string, number> = {
  'comp:football-data:PD':  140,  // LaLiga
  'comp:football-data:PL':   39,  // Premier League
  'comp:football-data:BL1':  78,  // Bundesliga
  'comp:thesportsdb:4432':  268,  // Liga Uruguaya
};

// ── Cache ─────────────────────────────────────────────────────────────────────

const FIXTURES_CACHE_TTL_MS = 1 * 60 * 60 * 1000;   // 1 hour
const LINEUPS_CACHE_TTL_MS  = 2 * 60 * 60 * 1000;   // 2 hours

interface FixturesCacheEntry {
  fixtures: AfFixture[];
  fetchedAt: number;
}

interface LineupsCacheEntry {
  lineups: ConfirmedLineupRecord[];
  fetchedAt: number;
}

// Key: `${leagueId}:${date}`
const _fixturesCache = new Map<string, FixturesCacheEntry>();
// Key: `${fixtureId}`
const _lineupsCache  = new Map<number, LineupsCacheEntry>();

function fixturesCacheKey(leagueId: number, date: string): string {
  return `${leagueId}:${date}`;
}

function getCachedFixtures(leagueId: number, date: string): AfFixture[] | null {
  const key   = fixturesCacheKey(leagueId, date);
  const entry = _fixturesCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > FIXTURES_CACHE_TTL_MS) {
    _fixturesCache.delete(key);
    return null;
  }
  return entry.fixtures;
}

function setCachedFixtures(leagueId: number, date: string, fixtures: AfFixture[]): void {
  _fixturesCache.set(fixturesCacheKey(leagueId, date), { fixtures, fetchedAt: Date.now() });
}

function getCachedLineups(fixtureId: number): ConfirmedLineupRecord[] | null {
  const entry = _lineupsCache.get(fixtureId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > LINEUPS_CACHE_TTL_MS) {
    _lineupsCache.delete(fixtureId);
    return null;
  }
  return entry.lineups;
}

function setCachedLineups(fixtureId: number, lineups: ConfirmedLineupRecord[]): void {
  _lineupsCache.set(fixtureId, { lineups, fetchedAt: Date.now() });
}

// ── Position mapping ──────────────────────────────────────────────────────────

function mapPosition(pos: string): PlayerPosition {
  if (pos === 'G') return 'GK';
  if (pos === 'D') return 'DEF';
  if (pos === 'M') return 'MID';
  if (pos === 'F') return 'FWD';
  return 'MID'; // safe default
}

// ── Raw API response types ────────────────────────────────────────────────────

interface AfFixture {
  fixture: { id: number };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
}

interface AfFixturesResponse {
  errors?: Record<string, string>;
  response?: AfFixture[];
}

interface AfLineupPlayer {
  player: {
    id:     number;
    name:   string;
    number: number;
    pos:    string;
    grid:   string | null;
  };
}

interface AfLineupEntry {
  team:       { id: number; name: string };
  formation:  string;
  startXI:    AfLineupPlayer[];
  substitutes: AfLineupPlayer[];
}

interface AfLineupsResponse {
  errors?: Record<string, string>;
  response?: AfLineupEntry[];
}

// ── Quota-guard helper ────────────────────────────────────────────────────────

/**
 * Checks for quota exhaustion errors in API body and marks if found.
 * Returns true if quota was exhausted.
 */
function checkAndMarkQuota(errors: Record<string, string> | undefined): boolean {
  if (!errors || typeof errors !== 'object') return false;
  const vals = Object.values(errors);
  if (vals.some((v) => typeof v === 'string' && v.toLowerCase().includes('limit'))) {
    markQuotaExhausted();
    return true;
  }
  return false;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchFixturesForDate(
  leagueId: number,
  season: number,
  date: string,
): Promise<AfFixture[]> {
  const cached = getCachedFixtures(leagueId, date);
  if (cached !== null) return cached;

  if (isQuotaExhausted()) {
    console.log(`[LineupSource] Quota exhausted — skipping fixtures fetch for league ${leagueId} ${date}`);
    return [];
  }

  const apiKey = process.env.APIFOOTBALL_KEY ?? '';
  if (!apiKey) return [];

  const url = `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&date=${date}`;

  let data: AfFixturesResponse;
  try {
    const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    consumeRequest();

    if (!res.ok) {
      console.warn(`[LineupSource] HTTP ${res.status} fetching fixtures for league ${leagueId} ${date}`);
      setCachedFixtures(leagueId, date, []);
      return [];
    }

    data = await res.json() as AfFixturesResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[LineupSource] fetch error (fixtures): ${msg}`);
    setCachedFixtures(leagueId, date, []);
    return [];
  }

  if (checkAndMarkQuota(data.errors)) {
    setCachedFixtures(leagueId, date, []);
    return [];
  }

  const fixtures = data.response ?? [];
  setCachedFixtures(leagueId, date, fixtures);
  return fixtures;
}

async function fetchLineupsForFixture(fixtureId: number): Promise<ConfirmedLineupRecord[]> {
  const cached = getCachedLineups(fixtureId);
  if (cached !== null) return cached;

  if (isQuotaExhausted()) {
    console.log(`[LineupSource] Quota exhausted — skipping lineups fetch for fixture ${fixtureId}`);
    return [];
  }

  const apiKey = process.env.APIFOOTBALL_KEY ?? '';
  if (!apiKey) return [];

  const url = `https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixtureId}`;

  let data: AfLineupsResponse;
  try {
    const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    consumeRequest();

    if (!res.ok) {
      console.warn(`[LineupSource] HTTP ${res.status} fetching lineups for fixture ${fixtureId}`);
      setCachedLineups(fixtureId, []);
      return [];
    }

    data = await res.json() as AfLineupsResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[LineupSource] fetch error (lineups): ${msg}`);
    setCachedLineups(fixtureId, []);
    return [];
  }

  if (checkAndMarkQuota(data.errors)) {
    setCachedLineups(fixtureId, []);
    return [];
  }

  const entries = data.response ?? [];
  const records: ConfirmedLineupRecord[] = [];

  for (const entry of entries) {
    if (!entry.team || !Array.isArray(entry.startXI)) continue;

    const players = entry.startXI
      .filter((p) => p?.player?.name)
      .map((p) => ({
        playerName:      p.player.name,
        position:        mapPosition(p.player.pos ?? ''),
        isRegularStarter: true, // all confirmed XI members are treated as regular starters
      }));

    if (players.length === 0) continue;

    records.push({
      teamId:  '', // will be resolved in getConfirmedLineups via teamNameToId
      players,
      _afTeamName: entry.team.name, // temporary field for name resolution
    } as unknown as ConfirmedLineupRecord & { _afTeamName: string });
  }

  // Note: _afTeamName is stripped after resolution — not part of the contract type.
  setCachedLineups(fixtureId, records);
  return records;
}

// ── LineupSource class ────────────────────────────────────────────────────────

export class LineupSource {
  /**
   * Returns ConfirmedLineupRecord[] for the home and away teams of a specific match.
   * Returns [] when:
   *   - minutesToKickoff > 90 (too early — lineups not published yet)
   *   - competition not mapped to an AF league ID
   *   - fixture not found via name matching
   *   - quota exhausted
   *   - any fetch error
   *
   * Budget: max 2 requests per match (1 for fixtures list, 1 for lineups).
   * The fixtures list is shared across same-league same-day calls (cache key: leagueId+date).
   *
   * @param competitionId  Canonical competition ID (e.g. 'comp:football-data:PD')
   * @param kickoffUtc     ISO-8601 UTC kickoff
   * @param homeTeamId     Canonical home team ID
   * @param awayTeamId     Canonical away team ID
   * @param teamNameToId   Map of normTeamName(teamName) → canonicalTeamId
   */
  async getConfirmedLineups(
    competitionId: string,
    kickoffUtc: string,
    homeTeamId: string,
    awayTeamId: string,
    teamNameToId: Map<string, string>,
  ): Promise<ConfirmedLineupRecord[]> {
    try {
      if (!process.env.APIFOOTBALL_KEY) return [];

      const leagueId = AF_LEAGUE_IDS[competitionId];
      if (leagueId === undefined) return [];

      // Guard: only fetch if kickoff is within 90 minutes
      const minutesToKickoff = (new Date(kickoffUtc).getTime() - Date.now()) / 60_000;
      if (minutesToKickoff > 90) return [];

      // Derive date (UTC — matches the API's date param)
      const dateIso = kickoffUtc.slice(0, 10);

      // Derive season year from kickoff date (before July = previous year start)
      const kickoffYear  = new Date(kickoffUtc).getUTCFullYear();
      const kickoffMonth = new Date(kickoffUtc).getUTCMonth(); // 0-indexed
      const season       = kickoffMonth < 6 ? kickoffYear - 1 : kickoffYear;

      // Step 1: get fixture list for this league+date (shared cache)
      const fixtures = await fetchFixturesForDate(leagueId, season, dateIso);
      if (fixtures.length === 0) return [];

      // Step 2: find the fixture matching this match via normalized team names
      const homeNormed = normTeamName(teamNameToId.has(homeTeamId)
        // reverse-lookup: prefer the name used in the canonical map
        ? [...teamNameToId.entries()].find(([, id]) => id === homeTeamId)?.[0] ?? homeTeamId
        : homeTeamId);
      const awayNormed = normTeamName(teamNameToId.has(awayTeamId)
        ? [...teamNameToId.entries()].find(([, id]) => id === awayTeamId)?.[0] ?? awayTeamId
        : awayTeamId);

      // Match by AF team names in fixture list
      const matchedFixture = fixtures.find((f) => {
        const afHome = normTeamName(f.teams.home.name);
        const afAway = normTeamName(f.teams.away.name);
        // Accept if both sides match (in canonical order)
        return afHome === homeNormed && afAway === awayNormed;
      }) ?? fixtures.find((f) => {
        // Fallback: try substring match for team names in case of translation differences
        const afHome = normTeamName(f.teams.home.name);
        const afAway = normTeamName(f.teams.away.name);
        return (
          (afHome.includes(homeNormed) || homeNormed.includes(afHome)) &&
          (afAway.includes(awayNormed) || awayNormed.includes(afAway))
        );
      });

      if (!matchedFixture) {
        console.log(
          `[LineupSource] fixture not found for ${homeTeamId} vs ${awayTeamId} ` +
          `(league=${leagueId}, date=${dateIso}). Candidates: ${
            fixtures.slice(0, 3).map((f) => `${f.teams.home.name} vs ${f.teams.away.name}`).join(', ')
          }`,
        );
        return [];
      }

      const fixtureId = matchedFixture.fixture.id;

      // Step 3: fetch lineups for this fixture (TTL 2h)
      const rawLineups = await fetchLineupsForFixture(fixtureId);
      if (rawLineups.length === 0) return [];

      // Step 4: resolve canonical teamId for each lineup entry using AF team name
      const resolved: ConfirmedLineupRecord[] = [];
      for (const entry of rawLineups) {
        const afTeamName = (entry as unknown as { _afTeamName?: string })._afTeamName;
        if (!afTeamName) continue;

        const normedAfName = normTeamName(afTeamName);
        const teamId =
          teamNameToId.get(normedAfName) ??
          [...teamNameToId.entries()].find(([k]) => k.includes(normedAfName) || normedAfName.includes(k))?.[1];

        // Only include if teamId resolves to one of the two match teams
        if (!teamId || (teamId !== homeTeamId && teamId !== awayTeamId)) continue;

        resolved.push({
          teamId,
          players: entry.players,
        });
      }

      if (resolved.length > 0) {
        console.log(
          `[LineupSource] ${competitionId} fixture=${fixtureId}: ` +
          `${resolved.length} team lineups resolved (${resolved.map((r) => r.teamId).join(', ')})`,
        );
      }

      return resolved;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[LineupSource] getConfirmedLineups error (${competitionId}): ${msg}`);
      return [];
    }
  }
}

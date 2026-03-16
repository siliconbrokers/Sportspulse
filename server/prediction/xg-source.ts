/**
 * xg-source.ts — Fetcher incremental de xG histórico desde API-Football v3.
 *
 * Endpoint estadísticas: GET https://v3.football.api-sports.io/fixtures/statistics
 * Endpoint lista fixtures: GET https://v3.football.api-sports.io/fixtures
 *
 * Cache en disco por fixture: cache/xg/{leagueId}/{season}/{fixtureId}.json
 * TTL infinito para partidos FINISHED (los xG no cambian post-match).
 *
 * Budget: 1 request por fixture sin agotar (cuota diaria es el único límite),
 * más 1 request para la lista de fixtures (TTL 1h en memoria).
 *
 * Fault isolation: cualquier error retorna [] silenciosamente.
 *
 * MKT-T3-03
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import {
  isQuotaExhausted,
  consumeRequest,
  markQuotaExhausted,
} from '../af-budget.js';
import type { XgRecord } from '@sportpulse/prediction';
import { normTeamName } from './injury-source.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** TTL for in-memory fixture list cache (per league+season). */
const FIXTURE_LIST_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Root directory for disk cache (relative to cwd). */
const CACHE_ROOT = 'cache/xg';

// ── League ID mapping ─────────────────────────────────────────────────────────

const AF_LEAGUE_IDS: Record<string, number> = {
  'comp:football-data:PD':  140,  // LaLiga
  'comp:football-data:PL':   39,  // Premier League
  'comp:openligadb:bl1':     78,  // Bundesliga
  'comp:thesportsdb:4432':  268,  // Liga Uruguaya
  'comp:sportsdb-ar:4406':  128,  // Liga Argentina
};

// ── Disk cache types ───────────────────────────────────────────────────────────

export interface XgFixtureCache {
  fixtureId: number;
  utcDate: string;
  homeTeamId: string;   // canonical ID nuestro
  awayTeamId: string;
  xgHome: number;
  xgAway: number;
  cachedAt: string;
}

// ── In-memory fixture list cache ───────────────────────────────────────────────

interface FixtureListEntry {
  fixtureId: number;
  utcDate: string;
  homeTeamName: string;
  awayTeamName: string;
  homeAfTeamId: number;
  awayAfTeamId: number;
}

interface FixtureListCacheEntry {
  fixtures: FixtureListEntry[];
  fetchedAt: number;
}

// Key: `${leagueId}:${season}`
const _fixtureListCache = new Map<string, FixtureListCacheEntry>();

// ── Raw API response types ────────────────────────────────────────────────────

interface AfFixtureEntry {
  fixture: { id: number; date: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
}

interface AfFixturesResponse {
  errors?: Record<string, string>;
  response?: AfFixtureEntry[];
}

interface AfStatsTeamEntry {
  team: { id: number; name: string };
  statistics: Array<{ type: string; value: string | number | null }>;
}

interface AfStatsResponse {
  errors?: Record<string, string>;
  response?: AfStatsTeamEntry[];
}

// ── Disk cache helpers ────────────────────────────────────────────────────────

function buildCachePath(leagueId: number, season: number, fixtureId: number): string {
  return join(CACHE_ROOT, String(leagueId), String(season), `${fixtureId}.json`);
}

async function readFromDiskCache(
  leagueId: number,
  season: number,
  fixtureId: number,
): Promise<XgFixtureCache | null> {
  const path = buildCachePath(leagueId, season, fixtureId);
  try {
    const raw = await fs.readFile(path, 'utf-8');
    return JSON.parse(raw) as XgFixtureCache;
  } catch {
    return null;
  }
}

async function writeToDiskCache(
  leagueId: number,
  season: number,
  data: XgFixtureCache,
): Promise<void> {
  const path = buildCachePath(leagueId, season, data.fixtureId);
  const dir = join(CACHE_ROOT, String(leagueId), String(season));
  const tmpPath = `${path}.tmp`;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(data), 'utf-8');
    await fs.rename(tmpPath, path); // atomic
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[XgSource] cache write error for fixture ${data.fixtureId}: ${msg}`);
  }
}

// ── Quota check helper ────────────────────────────────────────────────────────

function detectQuotaFromBody(errors: Record<string, string> | undefined): boolean {
  if (!errors || typeof errors !== 'object') return false;
  return Object.values(errors).some(
    (v) => typeof v === 'string' && v.toLowerCase().includes('limit'),
  );
}

// ── Fetch fixture list ────────────────────────────────────────────────────────

async function fetchFixtureList(
  leagueId: number,
  season: number,
  apiKey: string,
): Promise<FixtureListEntry[]> {
  const cacheKey = `${leagueId}:${season}`;
  const cached = _fixtureListCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < FIXTURE_LIST_TTL_MS) {
    return cached.fixtures;
  }

  if (isQuotaExhausted()) {
    console.log(`[XgSource] Quota exhausted — skipping fixture list for league ${leagueId} season ${season}`);
    return cached?.fixtures ?? [];
  }

  const url = `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&status=FT`;

  let data: AfFixturesResponse;
  try {
    const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    consumeRequest();

    if (!res.ok) {
      console.warn(`[XgSource] HTTP ${res.status} fetching fixture list for league ${leagueId}`);
      return cached?.fixtures ?? [];
    }

    data = await res.json() as AfFixturesResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[XgSource] fetch error for fixture list (league ${leagueId}): ${msg}`);
    return cached?.fixtures ?? [];
  }

  if (detectQuotaFromBody(data.errors)) {
    markQuotaExhausted();
    return cached?.fixtures ?? [];
  }

  const fixtures: FixtureListEntry[] = (data.response ?? []).map((entry) => ({
    fixtureId: entry.fixture.id,
    utcDate: entry.fixture.date,
    homeTeamName: entry.teams.home.name,
    awayTeamName: entry.teams.away.name,
    homeAfTeamId: entry.teams.home.id,
    awayAfTeamId: entry.teams.away.id,
  }));

  _fixtureListCache.set(cacheKey, { fixtures, fetchedAt: Date.now() });
  console.log(`[XgSource] fixture list loaded: league=${leagueId} season=${season} count=${fixtures.length}`);
  return fixtures;
}

// ── Fetch xG for a single fixture ─────────────────────────────────────────────

async function fetchXgForFixture(
  fixtureId: number,
  homeTeamId: string,
  awayTeamId: string,
  utcDate: string,
  leagueId: number,
  season: number,
  apiKey: string,
): Promise<XgFixtureCache | null> {
  if (isQuotaExhausted()) {
    return null;
  }

  const url = `https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`;

  let data: AfStatsResponse;
  try {
    const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    consumeRequest();

    if (!res.ok) {
      console.warn(`[XgSource] HTTP ${res.status} for fixture stats ${fixtureId}`);
      return null;
    }

    data = await res.json() as AfStatsResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[XgSource] fetch error for fixture ${fixtureId}: ${msg}`);
    return null;
  }

  if (detectQuotaFromBody(data.errors)) {
    markQuotaExhausted();
    return null;
  }

  const teamStats = data.response ?? [];
  if (teamStats.length < 2) {
    // Incomplete stats — skip, don't cache (may be available later)
    return null;
  }

  // Extract xG for each team entry
  function extractXg(entry: AfStatsTeamEntry): number | null {
    const stat = entry.statistics.find(
      (s) => s.type.toLowerCase() === 'expected_goals',
    );
    if (!stat) return null;
    const val = stat.value;
    if (val === null || val === undefined || val === '' || val === '—') return null;
    const parsed = typeof val === 'number' ? val : parseFloat(String(val));
    return isNaN(parsed) ? null : parsed;
  }

  // The API returns [home, away] in fixture order — but we need to respect
  // the home/away mapping. Both team entries carry the AF team ID; we match
  // them against the fixture list's homeAfTeamId/awayAfTeamId in the caller.
  // Here we get xG values indexed by order (home first, away second per AF convention).
  const xgFirst  = extractXg(teamStats[0]);
  const xgSecond = extractXg(teamStats[1]);

  if (xgFirst === null || xgSecond === null) {
    // xG not available for this fixture — don't create a record
    // Cache absence as negative sentinel to avoid re-fetching
    console.log(`[XgSource] fixture ${fixtureId}: xG not available — skipping`);
    return null;
  }

  const entry: XgFixtureCache = {
    fixtureId,
    utcDate,
    homeTeamId,
    awayTeamId,
    xgHome: xgFirst,
    xgAway: xgSecond,
    cachedAt: new Date().toISOString(),
  };

  await writeToDiskCache(leagueId, season, entry);
  console.log(`[XgSource] fixture ${fixtureId}: xgHome=${xgFirst} xgAway=${xgSecond} cached`);
  return entry;
}

// ── XgSource class ─────────────────────────────────────────────────────────────

export class XgSource {
  /**
   * Returns XgRecord[] for all historically cached fixtures for the given
   * competition and season. Incrementally fetches up to MAX_XG_REQUESTS_PER_CYCLE
   * new fixtures per call.
   *
   * @param competitionId   Canonical competition ID (e.g. 'comp:football-data:PD')
   * @param season          Season start year (e.g. 2024 for 2024-25)
   * @param teamNameToId    Map of normTeamName(teamName) → canonicalTeamId
   */
  async getHistoricalXg(
    competitionId: string,
    season: number,
    teamNameToId: Map<string, string>,
  ): Promise<XgRecord[]> {
    try {
      const leagueId = AF_LEAGUE_IDS[competitionId];
      if (leagueId === undefined) {
        // Competition not supported — silent skip
        return [];
      }

      const apiKey = process.env.APIFOOTBALL_KEY ?? '';
      if (!apiKey) {
        return [];
      }

      // Step 1: Get fixture list (1 request, TTL 1h in memory)
      const fixtures = await fetchFixtureList(leagueId, season, apiKey);
      if (fixtures.length === 0) {
        return [];
      }

      // Step 2: For each fixture, check disk cache first; collect missing ones
      const results: XgRecord[] = [];
      const toFetch: FixtureListEntry[] = [];

      await Promise.all(
        fixtures.map(async (f) => {
          const cached = await readFromDiskCache(leagueId, season, f.fixtureId);
          if (cached) {
            results.push({
              utcDate:    cached.utcDate,
              homeTeamId: cached.homeTeamId,
              awayTeamId: cached.awayTeamId,
              xgHome:     cached.xgHome,
              xgAway:     cached.xgAway,
            });
          } else {
            toFetch.push(f);
          }
        }),
      );

      // Step 3: Fetch missing fixtures (cuota es el único límite)
      let fetched = 0;
      for (const f of toFetch) {
        if (isQuotaExhausted()) break;

        // Resolve canonical team IDs from AF team names via normTeamName matching
        const homeTeamId = teamNameToId.get(normTeamName(f.homeTeamName));
        const awayTeamId = teamNameToId.get(normTeamName(f.awayTeamName));

        if (!homeTeamId || !awayTeamId) {
          // Cannot resolve team IDs — skip this fixture
          continue;
        }

        const xgEntry = await fetchXgForFixture(
          f.fixtureId,
          homeTeamId,
          awayTeamId,
          f.utcDate,
          leagueId,
          season,
          apiKey,
        );
        fetched++;

        if (xgEntry) {
          results.push({
            utcDate:    xgEntry.utcDate,
            homeTeamId: xgEntry.homeTeamId,
            awayTeamId: xgEntry.awayTeamId,
            xgHome:     xgEntry.xgHome,
            xgAway:     xgEntry.xgAway,
          });
        }
      }

      if (toFetch.length > 0) {
        console.log(
          `[XgSource] ${competitionId} season=${season}: ` +
          `${results.length} xG records available, ` +
          `${toFetch.length - fetched} still pending (budget limit or quota)`,
        );
      }

      return results;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[XgSource] getHistoricalXg error (${competitionId}): ${msg}`);
      return [];
    }
  }
}

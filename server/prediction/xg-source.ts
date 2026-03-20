/**
 * xg-source.ts — Fetcher incremental de xG histórico desde API-Football v3.
 *
 * Endpoint estadísticas: GET https://v3.football.api-sports.io/fixtures/statistics
 * Endpoint lista fixtures: GET https://v3.football.api-sports.io/fixtures
 *
 * Cache en disco por fixture: cache/xg/{leagueId}/{season}/{fixtureId}.json
 * TTL infinito para partidos FINISHED (los xG no cambian post-match).
 *
 * Budget: máximo MAX_NEW_XG_FETCHES_PER_CYCLE requests nuevos por ciclo (previene
 * backfill storm en deploys con cache limpia). Los fixtures pendientes se procesan
 * en ciclos sucesivos. La lista de fixtures tiene TTL 1h en memoria y 24h en disco.
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
  getGlobalProviderClient,
  QuotaExhaustedError,
} from '@sportpulse/canonical';
import type { XgRecord } from '@sportpulse/prediction';
import { normTeamName } from './injury-source.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** TTL for in-memory fixture list cache (per league+season). */
const FIXTURE_LIST_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Max new fixture stats requests per getHistoricalXg call. Prevents backfill storm on fresh deploys. */
const MAX_NEW_XG_FETCHES_PER_CYCLE = 20;

/** Root directory for disk cache (relative to cwd). */
const CACHE_ROOT = 'cache/xg';

// ── League ID mapping ─────────────────────────────────────────────────────────

const AF_LEAGUE_IDS: Record<string, number> = {
  // Legacy IDs
  'comp:football-data:PD':  140,  // LaLiga
  'comp:football-data:PL':   39,  // Premier League
  'comp:openligadb:bl1':     78,  // Bundesliga
  'comp:thesportsdb:4432':  268,  // Liga Uruguaya
  'comp:sportsdb-ar:4406':  128,  // Liga Argentina
  // API-Football canonical IDs (AF_CANONICAL_ENABLED=true)
  'comp:apifootball:140':   140,
  'comp:apifootball:39':     39,
  'comp:apifootball:78':     78,
  'comp:apifootball:268':   268,
  'comp:apifootball:128':   128,
  'comp:apifootball:262':   262,  // Liga MX
  'comp:apifootball:71':     71,  // Brasileirão Série A
  'comp:apifootball:135':   135,  // Serie A (Italy)
  'comp:apifootball:94':     94,  // Primeira Liga (Portugal)
  'comp:apifootball:265':   265,  // Primera División (Chile)
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

// Fixture list disk cache — survives server restarts
const FIXTURE_LIST_DISK_TTL_CURRENT_MS = 24 * 60 * 60_000;      // 24h — current season
const FIXTURE_LIST_DISK_TTL_PAST_MS    = 365 * 24 * 60 * 60_000; // 1 year — past seasons immutable

function currentSeasonYear(): number {
  const now   = new Date();
  const year  = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return month < 6 ? year - 1 : year;
}

interface FixtureListDiskDoc {
  version: 1;
  leagueId: number;
  season: number;
  savedAt: string;
  fixtures: FixtureListEntry[];
}

function fixtureListDiskPath(leagueId: number, season: number): string {
  return join(CACHE_ROOT, String(leagueId), String(season), 'fixture-list.json');
}

async function readFixtureListFromDisk(leagueId: number, season: number): Promise<FixtureListEntry[] | null> {
  const p = fixtureListDiskPath(leagueId, season);
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const doc = JSON.parse(raw) as FixtureListDiskDoc;
    if (doc.version !== 1 || doc.leagueId !== leagueId || doc.season !== season) return null;
    const ttl = season < currentSeasonYear() ? FIXTURE_LIST_DISK_TTL_PAST_MS : FIXTURE_LIST_DISK_TTL_CURRENT_MS;
    if (Date.now() - new Date(doc.savedAt).getTime() > ttl) return null;
    return doc.fixtures;
  } catch {
    return null;
  }
}

async function writeFixtureListToDisk(leagueId: number, season: number, fixtures: FixtureListEntry[]): Promise<void> {
  const p = fixtureListDiskPath(leagueId, season);
  const tmp = `${p}.tmp`;
  const doc: FixtureListDiskDoc = {
    version: 1,
    leagueId,
    season,
    savedAt: new Date().toISOString(),
    fixtures,
  };
  try {
    await fs.mkdir(join(CACHE_ROOT, String(leagueId), String(season)), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(doc), 'utf-8');
    await fs.rename(tmp, p);
  } catch { /* non-fatal */ }
}

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

  // Level 1: in-memory (fastest)
  const mem = _fixtureListCache.get(cacheKey);
  if (mem && Date.now() - mem.fetchedAt < FIXTURE_LIST_TTL_MS) {
    return mem.fixtures;
  }

  // Level 2: disk (survives restarts)
  const disk = await readFixtureListFromDisk(leagueId, season);
  if (disk) {
    _fixtureListCache.set(cacheKey, { fixtures: disk, fetchedAt: Date.now() });
    console.log(`[XgSource] fixture list DISK HIT league=${leagueId} season=${season} count=${disk.length}`);
    return disk;
  }

  // Level 3: API fetch
  if (isQuotaExhausted()) {
    console.log(`[XgSource] Quota exhausted — skipping fixture list for league ${leagueId} season ${season}`);
    return mem?.fixtures ?? [];
  }

  const url = `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&status=FT`;

  let data: AfFixturesResponse;
  try {
    const client = getGlobalProviderClient();
    let res: Response;
    if (client) {
      res = await client.fetch(url, {
        headers: { 'x-apisports-key': apiKey },
        providerKey: 'api-football',
        consumerType: 'PREDICTION_TRAINING',
        priorityTier: 'deferrable',
        moduleKey: 'xg-source',
        operationKey: 'fixtures-list-by-league',
        metadata: { endpointTemplate: '/fixtures' },
      });
    } else {
      res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
      consumeRequest();
    }

    if (!res.ok) {
      console.warn(`[XgSource] HTTP ${res.status} fetching fixture list for league ${leagueId}`);
      return mem?.fixtures ?? [];
    }

    data = await res.json() as AfFixturesResponse;
  } catch (err: unknown) {
    if (err instanceof QuotaExhaustedError) {
      markQuotaExhausted();
      return mem?.fixtures ?? [];
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[XgSource] fetch error for fixture list (league ${leagueId}): ${msg}`);
    return mem?.fixtures ?? [];
  }

  if (detectQuotaFromBody(data.errors)) {
    markQuotaExhausted();
    return mem?.fixtures ?? [];
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
  void writeFixtureListToDisk(leagueId, season, fixtures); // fire-and-forget
  console.log(`[XgSource] fixture list API FETCH: league=${leagueId} season=${season} count=${fixtures.length}`);
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
    const client = getGlobalProviderClient();
    let res: Response;
    if (client) {
      res = await client.fetch(url, {
        headers: { 'x-apisports-key': apiKey },
        providerKey: 'api-football',
        consumerType: 'PREDICTION_TRAINING',
        priorityTier: 'deferrable',
        moduleKey: 'xg-source',
        operationKey: 'fixtures-statistics',
        metadata: { endpointTemplate: '/fixtures/statistics' },
      });
    } else {
      res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
      consumeRequest();
    }

    if (!res.ok) {
      console.warn(`[XgSource] HTTP ${res.status} for fixture stats ${fixtureId}`);
      return null;
    }

    data = await res.json() as AfStatsResponse;
  } catch (err: unknown) {
    if (err instanceof QuotaExhaustedError) {
      markQuotaExhausted();
      return null;
    }
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

      // Step 3: Fetch missing fixtures — capped at MAX_NEW_XG_FETCHES_PER_CYCLE to
      // prevent backfill storms on fresh deploys (Render wipes ephemeral FS on redeploy).
      // Remaining fixtures are picked up in subsequent cycles.
      let fetched = 0;
      for (const f of toFetch) {
        if (isQuotaExhausted()) break;
        if (fetched >= MAX_NEW_XG_FETCHES_PER_CYCLE) break;

        // Resolve canonical team IDs from AF team names via normTeamName matching
        const homeTeamId = teamNameToId.get(normTeamName(f.homeTeamName));
        const awayTeamId = teamNameToId.get(normTeamName(f.awayTeamName));

        if (!homeTeamId || !awayTeamId) {
          // Cannot resolve team IDs — skip this fixture (does not count toward cap)
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
        const remaining = toFetch.length - fetched;
        console.log(
          `[XgSource] ${competitionId} season=${season}: ` +
          `${results.length} xG records available, ` +
          `${remaining} still pending (cap/budget/quota)`,
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

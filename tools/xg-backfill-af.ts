/**
 * xg-backfill-af.ts — Backfill de xG histórico para temporadas pasadas via API-Football Pro.
 *
 * Flujo por temporada/liga:
 *  1. Carga datos históricos FD: cache/historical/football-data/{league}/{year}.json
 *  2. Llama AF fixtures?league={id}&season={year}&status=FT → obtiene lista de fixtures AF
 *  3. Por cada fixture AF, llama AF fixtures/statistics?fixture={id} → obtiene xG
 *  4. Hace score-based matching entre AF fixtures y FD matches (greedy por distancia)
 *  5. Guarda en cache/xg/{leagueId}/{season}/{fixtureId}.json (mismo formato que xg-source.ts)
 *
 * Requiere: APIFOOTBALL_KEY (plan Pro: 7500 req/día)
 *
 * Budget tracking:
 *   Integrado con server/af-budget.ts — cada request exitosa llama consumeRequest(),
 *   cada error de cuota llama markQuotaExhausted(), y cada stats call verifica
 *   isQuotaExhausted() antes de proceder. Esto garantiza que el contador en
 *   cache/af-budget.json refleje el consumo REAL incluyendo los runs de backfill,
 *   no solo el consumo del servidor en runtime.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-af.ts
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-af.ts --dry-run
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-af.ts --season 2024
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-af.ts --comp 140 --delay 300
 *
 * Flags:
 *   --dry-run     Muestra plan sin hacer requests de stats.
 *   --season Y    Solo procesar este año inicio (e.g. "2024" para 2024-25, "2023" para 2023-24).
 *   --comp ID     Solo procesar esta liga AF (e.g. "140", "39", "78").
 *   --delay N     Delay entre requests de statistics en ms (default 200).
 *   --limit N     Máximo total de partidos a procesar.
 *   --resume      Saltar fixtures ya cacheados (default: siempre activado).
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import {
  consumeRequest,
  isQuotaExhausted,
  markQuotaExhausted,
} from '../server/af-budget.js';

config();

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN      = args.includes('--dry-run');
const seasonIdx    = args.indexOf('--season');
const SEASON_FILTER = seasonIdx !== -1 ? parseInt(args[seasonIdx + 1] ?? '0', 10) : 0;
const compIdx      = args.indexOf('--comp');
const COMP_FILTER: number | null = compIdx !== -1 ? parseInt(args[compIdx + 1] ?? '0', 10) : null;
const delayIdx     = args.indexOf('--delay');
const DELAY_MS     = delayIdx !== -1 ? parseInt(args[delayIdx + 1] ?? '200', 10) : 200;
const limitIdx     = args.indexOf('--limit');
const LIMIT        = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '0', 10) : 0;

if (DRY_RUN)          console.log('[XgBackfillAF] DRY RUN — no stats API calls');
if (SEASON_FILTER)    console.log(`[XgBackfillAF] Season filter: ${SEASON_FILTER}`);
if (COMP_FILTER)      console.log(`[XgBackfillAF] League filter: ${COMP_FILTER}`);

// ── Config ────────────────────────────────────────────────────────────────────

interface LeagueSeasonConfig {
  afLeagueId: number;
  fdCode: string;
  competitionId: string;  // FD canonical
  seasonYear: number;     // AF season parameter (e.g. 2024 = 2024-25)
  seasonStr: string;      // FD historical file key + dir name
}

const ALL_CONFIGS: LeagueSeasonConfig[] = [
  // 2024-25
  { afLeagueId: 140, fdCode: 'PD',  competitionId: 'comp:football-data:PD',  seasonYear: 2024, seasonStr: '2024-25' },
  { afLeagueId: 39,  fdCode: 'PL',  competitionId: 'comp:football-data:PL',  seasonYear: 2024, seasonStr: '2024-25' },
  { afLeagueId: 78,  fdCode: 'BL1', competitionId: 'comp:football-data:BL1', seasonYear: 2024, seasonStr: '2024-25' },
  { afLeagueId: 135, fdCode: 'SA',  competitionId: 'comp:football-data:SA',  seasonYear: 2024, seasonStr: '2024-25' },
  { afLeagueId: 61,  fdCode: 'FL1', competitionId: 'comp:football-data:FL1', seasonYear: 2024, seasonStr: '2024-25' },
  // 2023-24
  { afLeagueId: 140, fdCode: 'PD',  competitionId: 'comp:football-data:PD',  seasonYear: 2023, seasonStr: '2023-24' },
  { afLeagueId: 39,  fdCode: 'PL',  competitionId: 'comp:football-data:PL',  seasonYear: 2023, seasonStr: '2023-24' },
  { afLeagueId: 78,  fdCode: 'BL1', competitionId: 'comp:football-data:BL1', seasonYear: 2023, seasonStr: '2023-24' },
  { afLeagueId: 135, fdCode: 'SA',  competitionId: 'comp:football-data:SA',  seasonYear: 2023, seasonStr: '2023-24' },
  { afLeagueId: 61,  fdCode: 'FL1', competitionId: 'comp:football-data:FL1', seasonYear: 2023, seasonStr: '2023-24' },
];

const HIST_BASE  = path.join(process.cwd(), 'cache', 'historical', 'football-data');
const XG_BASE    = path.join(process.cwd(), 'cache', 'xg');
const AF_API_KEY = process.env.APIFOOTBALL_KEY ?? '';

// ── AF API types ──────────────────────────────────────────────────────────────

interface AfFixture {
  id: number;
  date: string; // ISO-8601
}

interface AfTeam {
  id: number;
  name: string;
}

interface AfFixtureEntry {
  fixture: AfFixture;
  teams: { home: AfTeam; away: AfTeam };
  goals: { home: number | null; away: number | null };
}

interface AfFixturesResponse {
  errors?: unknown;
  response?: AfFixtureEntry[];
}

interface AfStatEntry {
  type: string;
  value: string | number | null;
}

interface AfTeamStats {
  team: { id: number };
  statistics: AfStatEntry[];
}

interface AfStatsResponse {
  errors?: unknown;
  response?: AfTeamStats[];
}

// ── FD historical match ───────────────────────────────────────────────────────

interface FdHistMatch {
  homeTeamId: string;
  awayTeamId: string;
  utcDate: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

// ── AF xG disk cache format ───────────────────────────────────────────────────

interface XgCacheEntry {
  fixtureId: number;
  utcDate: string;
  homeTeamId: string;  // FD canonical (team:football-data:N)
  awayTeamId: string;
  xgHome: number;
  xgAway: number;
  cachedAt: string;
}

// ── Sleep ─────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── AF fetch helpers ──────────────────────────────────────────────────────────

const AF_BASE = 'https://v3.football.api-sports.io';

async function afFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'x-apisports-key': AF_API_KEY },
    });
    if (!res.ok) {
      console.warn(`[XgBackfillAF] HTTP ${res.status} for ${url}`);
      return null;
    }
    const body = (await res.json()) as T & { errors?: Record<string, unknown> };
    // Detect API-level quota exhaustion (HTTP 200 con errors en body)
    if (body.errors && Object.keys(body.errors).length > 0) {
      markQuotaExhausted();
      console.warn(`[XgBackfillAF] API quota error for ${url}:`, body.errors);
      return null;
    }
    consumeRequest();
    return body;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[XgBackfillAF] fetch error: ${msg}`);
    return null;
  }
}

// Fixture list disk cache (1yr TTL for past seasons)
function fixtureListPath(leagueId: number, seasonYear: number): string {
  return path.join(XG_BASE, String(leagueId), String(seasonYear), 'fixture-list.json');
}

function loadFixtureListCache(leagueId: number, seasonYear: number): AfFixtureEntry[] | null {
  const p = fixtureListPath(leagueId, seasonYear);
  if (!fs.existsSync(p)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf-8')) as { fixtures: AfFixtureEntry[] };
    return d.fixtures ?? null;
  } catch { return null; }
}

function saveFixtureListCache(leagueId: number, seasonYear: number, fixtures: AfFixtureEntry[]): void {
  const p = fixtureListPath(leagueId, seasonYear);
  const tmp = `${p}.tmp`;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ fixtures, savedAt: new Date().toISOString() }));
    fs.renameSync(tmp, p);
  } catch { /* non-fatal */ }
}

async function fetchFixtureList(leagueId: number, seasonYear: number): Promise<AfFixtureEntry[]> {
  // Check disk cache
  const cached = loadFixtureListCache(leagueId, seasonYear);
  if (cached) {
    console.log(`[XgBackfillAF] fixture list CACHE HIT league=${leagueId} season=${seasonYear} (${cached.length} fixtures)`);
    return cached;
  }
  const url = `${AF_BASE}/fixtures?league=${leagueId}&season=${seasonYear}&status=FT`;
  console.log(`[XgBackfillAF] fetching fixture list: league=${leagueId} season=${seasonYear}`);
  const data = await afFetch<AfFixturesResponse>(url);
  const fixtures = data?.response ?? [];
  console.log(`[XgBackfillAF] fixture list: ${fixtures.length} finished fixtures`);
  if (fixtures.length > 0) saveFixtureListCache(leagueId, seasonYear, fixtures);
  return fixtures;
}

function extractXg(teamStats: AfTeamStats): number | null {
  const stat = teamStats.statistics.find(
    (s) => s.type.toLowerCase() === 'expected_goals',
  );
  if (!stat) return null;
  const val = stat.value;
  if (val === null || val === undefined || val === '' || val === '—') return null;
  const parsed = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(parsed) ? null : parsed;
}

async function fetchXgForFixture(fixtureId: number): Promise<{ xgHome: number; xgAway: number } | null> {
  const url = `${AF_BASE}/fixtures/statistics?fixture=${fixtureId}`;
  const data = await afFetch<AfStatsResponse>(url);
  if (!data?.response || data.response.length < 2) return null;
  const xgH = extractXg(data.response[0]);
  const xgA = extractXg(data.response[1]);
  if (xgH === null || xgA === null) return null;
  return { xgHome: xgH, xgAway: xgA };
}

// ── Score-based matching (AF fixture → FD historical match) ───────────────────

/**
 * Matches AF fixtures (by date + score) to FD historical matches.
 * Uses greedy cost minimization: |xgHome - fdGoalsHome| + |xgAway - fdGoalsAway|.
 * Since we're using actual goals (not xG) for matching, this is exact when scores
 * on the same day are unique, and greedy-optimal otherwise.
 *
 * Returns a map: AF fixtureId → FdHistMatch
 */
function buildAfToFdMatchMap(
  afFixtures: AfFixtureEntry[],
  fdMatches: FdHistMatch[],
): Map<number, FdHistMatch> {
  // Group AF fixtures by date
  const afByDate = new Map<string, AfFixtureEntry[]>();
  for (const af of afFixtures) {
    const day = new Date(af.fixture.date).toISOString().slice(0, 10);
    if (!afByDate.has(day)) afByDate.set(day, []);
    afByDate.get(day)!.push(af);
  }

  // Group FD matches by date
  const fdByDate = new Map<string, FdHistMatch[]>();
  for (const m of fdMatches) {
    const day = m.utcDate.slice(0, 10);
    if (!fdByDate.has(day)) fdByDate.set(day, []);
    fdByDate.get(day)!.push(m);
  }

  const result = new Map<number, FdHistMatch>();

  for (const [day, afList] of afByDate) {
    const fdList = fdByDate.get(day);
    if (!fdList || fdList.length === 0) continue;

    const usedAf = new Set<number>();
    const usedFd = new Set<number>();

    // Build cost matrix
    const pairs: { cost: number; ai: number; fi: number }[] = [];
    for (let ai = 0; ai < afList.length; ai++) {
      const af = afList[ai];
      const aHome = af.goals.home ?? 0;
      const aAway = af.goals.away ?? 0;
      for (let fi = 0; fi < fdList.length; fi++) {
        const fd = fdList[fi];
        const fHome = fd.homeGoals ?? 0;
        const fAway = fd.awayGoals ?? 0;
        const cost = Math.abs(aHome - fHome) + Math.abs(aAway - fAway);
        pairs.push({ cost, ai, fi });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);

    for (const { ai, fi, cost } of pairs) {
      if (usedAf.has(ai) || usedFd.has(fi)) continue;
      // Only accept if exact score match (cost=0) or cost=0 on same day
      // Allow cost>0 only if no better match exists
      if (cost > 1) break; // Greedy: stop if all remaining pairs have cost>1

      usedAf.add(ai);
      usedFd.add(fi);
      result.set(afList[ai].fixture.id, fdList[fi]);
    }
  }

  return result;
}

// ── Disk cache for individual xG records ──────────────────────────────────────

function xgCachePath(leagueId: number, seasonYear: number, fixtureId: number): string {
  return path.join(XG_BASE, String(leagueId), String(seasonYear), `${fixtureId}.json`);
}

function isXgCached(leagueId: number, seasonYear: number, fixtureId: number): boolean {
  return fs.existsSync(xgCachePath(leagueId, seasonYear, fixtureId));
}

function saveXgCache(entry: XgCacheEntry, leagueId: number, seasonYear: number): void {
  const p = xgCachePath(leagueId, seasonYear, entry.fixtureId);
  const tmp = `${p}.tmp`;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, p);
  } catch { /* non-fatal */ }
}

// ── Load FD historical data ───────────────────────────────────────────────────

function loadFdHistorical(fdCode: string, fdYear: number): FdHistMatch[] {
  const p = path.join(HIST_BASE, fdCode, `${fdYear}.json`);
  if (!fs.existsSync(p)) {
    console.warn(`[XgBackfillAF] FD historical not found: ${p}`);
    return [];
  }
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf-8')) as { matches?: FdHistMatch[] } | FdHistMatch[];
    const matches = Array.isArray(d) ? d : (d.matches ?? []);
    return matches.filter((m) => m.homeGoals !== null && m.awayGoals !== null);
  } catch (err) {
    console.warn('[XgBackfillAF] Error loading FD historical:', err);
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!AF_API_KEY) {
    console.error('[XgBackfillAF] APIFOOTBALL_KEY not set — aborting');
    process.exit(1);
  }

  // Check budget first
  const statusResp = await afFetch<{ response: { requests: { current: number; limit_day: number } } }>(
    `${AF_BASE}/status`,
  );
  const reqs = statusResp?.response?.requests;
  if (reqs) {
    const remaining = reqs.limit_day - reqs.current;
    console.log(`[XgBackfillAF] AF budget: ${reqs.current}/${reqs.limit_day} used, ${remaining} remaining`);
    if (remaining < 50) {
      console.error('[XgBackfillAF] Budget too low — aborting');
      process.exit(1);
    }
  }

  // Filter configs
  let configs = ALL_CONFIGS;
  if (SEASON_FILTER) configs = configs.filter((c) => c.seasonYear === SEASON_FILTER);
  if (COMP_FILTER)   configs = configs.filter((c) => c.afLeagueId === COMP_FILTER);

  let totalFd      = 0;
  let totalAf      = 0;
  let totalMatched = 0;
  let totalCached  = 0;
  let totalFetched = 0;
  let totalXg      = 0;
  let processed    = 0;

  for (const cfg of configs) {
    console.log(`\n[XgBackfillAF] ── ${cfg.fdCode} ${cfg.seasonStr} (AF league=${cfg.afLeagueId}) ─────`);

    // 1. Load FD historical data
    const fdMatches = loadFdHistorical(cfg.fdCode, cfg.seasonYear);
    if (fdMatches.length === 0) { console.log('[XgBackfillAF] No FD data — skip'); continue; }
    totalFd += fdMatches.length;
    console.log(`[XgBackfillAF] FD historical: ${fdMatches.length} finished matches`);

    // 2. Fetch AF fixture list (cached to disk)
    if (isQuotaExhausted()) {
      console.error('[XgBackfillAF] Quota exhausted — abortando configs restantes');
      break;
    }
    const afFixtures = await fetchFixtureList(cfg.afLeagueId, cfg.seasonYear);
    if (afFixtures.length === 0) { console.log('[XgBackfillAF] No AF fixtures — skip'); continue; }
    totalAf += afFixtures.length;

    // 3. Match AF fixtures to FD matches
    const afToFd = buildAfToFdMatchMap(afFixtures, fdMatches);
    totalMatched += afToFd.size;
    console.log(`[XgBackfillAF] Matched: ${afToFd.size}/${afFixtures.length} AF fixtures → FD matches`);

    // 4. Filter already-cached
    const toFetch = afFixtures.filter(
      (af) => afToFd.has(af.fixture.id) && !isXgCached(cfg.afLeagueId, cfg.seasonYear, af.fixture.id),
    );
    const alreadyCached = afFixtures.filter(
      (af) => isXgCached(cfg.afLeagueId, cfg.seasonYear, af.fixture.id),
    ).length;
    totalCached += alreadyCached;
    console.log(`[XgBackfillAF] Already cached: ${alreadyCached}, to fetch: ${toFetch.length}`);

    if (DRY_RUN) {
      const preview = toFetch.slice(0, 5);
      for (const af of preview) {
        const fd = afToFd.get(af.fixture.id)!;
        console.log(`  fixture=${af.fixture.id}: ${af.teams.home.name} vs ${af.teams.away.name} | score ${af.goals.home}-${af.goals.away} → ${fd.homeTeamId} vs ${fd.awayTeamId}`);
      }
      if (toFetch.length > 5) console.log(`  ... and ${toFetch.length - 5} more`);
      continue;
    }

    // 5. Fetch xG for each unresolved fixture
    let batchFetched = 0;
    let batchXg      = 0;

    let limitHit = false;
    for (const af of toFetch) {
      if (LIMIT > 0 && processed >= LIMIT) {
        console.log(`[XgBackfillAF] Limit ${LIMIT} reached`);
        limitHit = true;
        break;
      }

      if (isQuotaExhausted()) {
        console.error('[XgBackfillAF] Quota exhausted — deteniendo stats fetch');
        limitHit = true;
        break;
      }

      await sleep(DELAY_MS);
      const xg = await fetchXgForFixture(af.fixture.id);
      processed++;
      batchFetched++;
      totalFetched++;

      if (xg) {
        const fd = afToFd.get(af.fixture.id)!;
        const entry: XgCacheEntry = {
          fixtureId:  af.fixture.id,
          utcDate:    af.fixture.date,
          homeTeamId: fd.homeTeamId,
          awayTeamId: fd.awayTeamId,
          xgHome:     xg.xgHome,
          xgAway:     xg.xgAway,
          cachedAt:   new Date().toISOString(),
        };
        saveXgCache(entry, cfg.afLeagueId, cfg.seasonYear);
        batchXg++;
        totalXg++;
      }
    }

    const pct = batchFetched > 0 ? ((batchXg / batchFetched) * 100).toFixed(1) : '0';
    console.log(`[XgBackfillAF] ${cfg.fdCode} ${cfg.seasonStr}: ${batchXg}/${batchFetched} xG obtained (${pct}%)`);

    if (limitHit) break;
  }

  // Summary
  console.log('\n[XgBackfillAF] ── Summary ──────────────────────────────────────────');
  console.log(`FD matches loaded:          ${totalFd}`);
  console.log(`AF fixtures fetched:        ${totalAf}`);
  console.log(`Matched AF↔FD:             ${totalMatched}`);
  console.log(`Already cached (skip):      ${totalCached}`);
  console.log(`Stats API calls made:       ${totalFetched}`);
  console.log(`xG records saved:           ${totalXg}`);
  const pct = totalFetched > 0 ? ((totalXg / totalFetched) * 100).toFixed(1) : 'N/A';
  console.log(`xG coverage on fetched:     ${pct}%`);
  console.log(`Cache location:             cache/xg/{leagueId}/{seasonYear}/`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[XgBackfillAF] Fatal error: ${msg}`);
  process.exit(1);
});

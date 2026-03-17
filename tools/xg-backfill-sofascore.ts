/**
 * xg-backfill-sofascore.ts — Backfill de xG histórico desde SofaScore.
 *
 * Itera sobre los matchday caches existentes (PD, PL, BL1, temporada 2025-26),
 * extrae partidos FINISHED, resuelve nombres de equipos via football-data.org
 * (1 req por liga, TTL en disco 24h), y llama a SofaScoreXgSource para obtener
 * xG de cada partido via SofaScore RapidAPI.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-sofascore.ts
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-sofascore.ts --dry-run
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-sofascore.ts --dry-run --limit 5
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-sofascore.ts --limit 20
 *
 * Flags:
 *   --dry-run   Muestra qué haría sin escribir al disco ni llamar a la API de estadísticas.
 *               Resuelve nombres y muestra el plan, sin hacer requests de xG a SofaScore.
 *   --limit N   Limita el total de partidos procesados (útil para prueba).
 *   --delay N   Delay en ms entre requests de estadísticas (default 150ms).
 *   --comp X    Procesar solo esta liga (e.g. "PD", "PL", "BL1").
 *
 * Requiere:
 *   FOOTBALL_DATA_TOKEN — para resolver nombres de equipos (1 req/liga)
 *   RAPIDAPI_KEY        — para SofaScore stats (1 req/partido)
 *
 * Estimación de requests:
 *   Ver comentario en server/prediction/xg-source-sofascore.ts para detalles completos.
 *   Resumen: ~630-660 requests SofaScore para backfill completo de PD+PL+BL1 2025-26.
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import {
  SofaScoreXgSource,
  normSofaTeamName,
} from '../server/prediction/xg-source-sofascore.js';
import type { CanonicalMatchRef } from '../server/prediction/xg-source-sofascore.js';

config();

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '0', 10) : 0;
const delayIdx = args.indexOf('--delay');
const DELAY_MS = delayIdx !== -1 ? parseInt(args[delayIdx + 1] ?? '150', 10) : 150;
const compIdx = args.indexOf('--comp');
const COMP_FILTER: string | null = compIdx !== -1 ? (args[compIdx + 1] ?? null) : null;

if (DRY_RUN) {
  console.log('[Backfill] DRY RUN mode — no stats API calls, no disk writes for xG');
}
if (LIMIT > 0) {
  console.log(`[Backfill] Limit: ${LIMIT} matches`);
}
if (COMP_FILTER) {
  console.log(`[Backfill] Competition filter: ${COMP_FILTER}`);
}

// ── League config ─────────────────────────────────────────────────────────────

interface LeagueBackfillConfig {
  code: string;           // FD competition code, e.g. "PD"
  competitionId: string;  // canonical competition ID
  season: string;         // e.g. "2025-26"
  fdSeason: number;       // FD season start year, e.g. 2025
  cacheDir: string;       // matchday cache directory (relative to cwd)
}

const CACHE_BASE = path.join(process.cwd(), 'cache');

const LEAGUES: LeagueBackfillConfig[] = [
  {
    code: 'PD',
    competitionId: 'comp:football-data:PD',
    season: '2025-26',
    fdSeason: 2025,
    cacheDir: path.join(CACHE_BASE, 'football-data', 'PD', '2025-26'),
  },
  {
    code: 'PL',
    competitionId: 'comp:football-data:PL',
    season: '2025-26',
    fdSeason: 2025,
    cacheDir: path.join(CACHE_BASE, 'football-data', 'PL', '2025-26'),
  },
  {
    code: 'BL1',
    competitionId: 'comp:football-data:BL1',
    season: '2025-26',
    fdSeason: 2025,
    cacheDir: path.join(CACHE_BASE, 'football-data', 'BL1', '2025-26'),
  },
];

// ── Football-data.org team name lookup ────────────────────────────────────────
// Fetches team list for a league (1 req per league).
// Maps canonical team ID (team:football-data:N) → team name.
// Results are cached on disk for 24h.

const TEAM_NAME_CACHE_DIR = path.join(CACHE_BASE, 'backfill-meta', 'team-names');
const TEAM_NAME_CACHE_TTL_MS = 24 * 60 * 60_000; // 24h

interface TeamNameDiskDoc {
  version: 1;
  code: string;
  savedAt: string;
  teams: Array<{ id: string; name: string; shortName: string }>;
}

function teamNameCachePath(code: string): string {
  return path.join(TEAM_NAME_CACHE_DIR, `${code}.json`);
}

function readTeamNameCache(code: string): Map<string, string> | null {
  const p = teamNameCachePath(code);
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const doc = JSON.parse(raw) as TeamNameDiskDoc;
    if (doc.version !== 1 || doc.code !== code) return null;
    if (Date.now() - new Date(doc.savedAt).getTime() > TEAM_NAME_CACHE_TTL_MS) return null;
    const map = new Map<string, string>();
    for (const t of doc.teams) {
      map.set(t.id, t.name);
    }
    return map;
  } catch {
    return null;
  }
}

function writeTeamNameCache(code: string, teams: Map<string, string>): void {
  const p = teamNameCachePath(code);
  const tmp = `${p}.tmp`;
  const doc: TeamNameDiskDoc = {
    version: 1,
    code,
    savedAt: new Date().toISOString(),
    teams: Array.from(teams.entries()).map(([id, name]) => ({ id, name, shortName: '' })),
  };
  try {
    fs.mkdirSync(TEAM_NAME_CACHE_DIR, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(doc), 'utf-8');
    fs.renameSync(tmp, p);
  } catch { /* non-fatal */ }
}

interface FDTeamEntry {
  id: number;
  name: string;
  shortName: string;
}

interface FDTeamsResponse {
  teams?: FDTeamEntry[];
}

async function fetchTeamNames(
  code: string,
  fdSeason: number,
  token: string,
): Promise<Map<string, string>> {
  // Check disk cache
  const cached = readTeamNameCache(code);
  if (cached) {
    console.log(`[Backfill] team names CACHE HIT for ${code} (${cached.size} teams)`);
    return cached;
  }

  console.log(`[Backfill] fetching team names from football-data.org for ${code}...`);
  const url = `https://api.football-data.org/v4/competitions/${code}/teams?season=${fdSeason}`;
  try {
    const res = await fetch(url, { headers: { 'X-Auth-Token': token } });
    if (!res.ok) {
      console.warn(`[Backfill] HTTP ${res.status} fetching teams for ${code}`);
      return new Map();
    }
    const data = await res.json() as FDTeamsResponse;
    const map = new Map<string, string>();
    for (const t of data.teams ?? []) {
      const id = `team:football-data:${t.id}`;
      map.set(id, t.name ?? t.shortName ?? String(t.id));
    }
    console.log(`[Backfill] team names API FETCH for ${code}: ${map.size} teams`);
    writeTeamNameCache(code, map);
    return map;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Backfill] fetch error for team names (${code}): ${msg}`);
    return new Map();
  }
}

// ── Matchday cache types ──────────────────────────────────────────────────────

interface CachedMatchEntry {
  matchId: string;
  startTimeUtc: string | null;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
}

interface MatchdayCacheDoc {
  data?: {
    matches?: CachedMatchEntry[];
  };
}

// ── Load finished matches from matchday cache files ───────────────────────────

function loadFinishedMatchesFromCache(leagueDir: string): CachedMatchEntry[] {
  if (!fs.existsSync(leagueDir)) {
    console.warn(`[Backfill] cache dir not found: ${leagueDir}`);
    return [];
  }

  const files = fs.readdirSync(leagueDir)
    .filter((f) => /^matchday-\d+\.json$/.test(f))
    .sort();

  const matches: CachedMatchEntry[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    let doc: MatchdayCacheDoc;
    try {
      doc = JSON.parse(
        fs.readFileSync(path.join(leagueDir, file), 'utf-8'),
      ) as MatchdayCacheDoc;
    } catch {
      console.warn(`[Backfill] skipping corrupt cache file: ${file}`);
      continue;
    }

    for (const m of doc.data?.matches ?? []) {
      if (m.status !== 'FINISHED') continue;
      if (!m.startTimeUtc || !m.matchId) continue;
      if (seenIds.has(m.matchId)) continue;
      seenIds.add(m.matchId);
      matches.push(m);
    }
  }

  return matches;
}

// ── Check existing xG disk cache ──────────────────────────────────────────────

function countCachedXgMatches(
  competitionId: string,
  season: string,
  matchIds: string[],
): number {
  const safeComp = competitionId.replace(/:/g, '_');
  const dir = path.join(CACHE_BASE, 'xg-sofascore', safeComp, season);
  if (!fs.existsSync(dir)) return 0;
  return matchIds.reduce((acc, id) => {
    return acc + (fs.existsSync(path.join(dir, `${id}.json`)) ? 1 : 0);
  }, 0);
}

function isXgCached(competitionId: string, season: string, matchId: string): boolean {
  const safeComp = competitionId.replace(/:/g, '_');
  const p = path.join(CACHE_BASE, 'xg-sofascore', safeComp, season, `${matchId}.json`);
  return fs.existsSync(p);
}

// ── Main backfill ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env.RAPIDAPI_KEY ?? '';
  if (!apiKey) {
    console.error('[Backfill] RAPIDAPI_KEY not set in .env — aborting');
    process.exit(1);
  }

  const fdToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!fdToken) {
    console.warn('[Backfill] FOOTBALL_DATA_TOKEN not set — team names will not be resolved from API');
    console.warn('[Backfill] Fuzzy matching may have lower coverage without proper team names');
  }

  const source = new SofaScoreXgSource();

  let totalMatches = 0;
  let totalFound = 0;
  let totalAlreadyCached = 0;
  let processedCount = 0;

  const leaguesToProcess = COMP_FILTER
    ? LEAGUES.filter((l) => l.code === COMP_FILTER)
    : LEAGUES;

  if (leaguesToProcess.length === 0) {
    console.error(`[Backfill] No leagues found for filter: ${COMP_FILTER}`);
    process.exit(1);
  }

  for (const league of leaguesToProcess) {
    console.log(`\n[Backfill] ── ${league.code} (${league.season}) ────────────────`);

    // Step 1: Load matchday cache entries
    const rawMatches = loadFinishedMatchesFromCache(league.cacheDir);
    if (rawMatches.length === 0) {
      console.log(`[Backfill] No FINISHED matches found in matchday cache for ${league.code}`);
      continue;
    }

    // Step 2: Resolve team names (1 API call, TTL 24h on disk)
    const teamNameMap = fdToken
      ? await fetchTeamNames(league.code, league.fdSeason, fdToken)
      : new Map<string, string>();

    // Step 3: Build CanonicalMatchRef with resolved names
    const matchRefs: CanonicalMatchRef[] = rawMatches.map((m) => ({
      matchId: m.matchId,
      utcDate: m.startTimeUtc!,
      homeTeamName: teamNameMap.get(m.homeTeamId) ?? m.homeTeamId,
      awayTeamName: teamNameMap.get(m.awayTeamId) ?? m.awayTeamId,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
    }));

    // Step 4: Filter out already-cached matches
    const alreadyCached = countCachedXgMatches(
      league.competitionId,
      league.season,
      matchRefs.map((m) => m.matchId),
    );
    const toFetch = matchRefs.filter(
      (m) => !isXgCached(league.competitionId, league.season, m.matchId),
    );

    console.log(
      `[Backfill] ${league.code}: ${matchRefs.length} finished matches, ` +
      `${alreadyCached} already cached, ${toFetch.length} to fetch`,
    );

    totalMatches += matchRefs.length;
    totalAlreadyCached += alreadyCached;

    if (DRY_RUN) {
      console.log(`[Backfill] DRY RUN — would fetch xG for ${toFetch.length} matches:`);
      const preview = toFetch.slice(0, 10);
      for (const m of preview) {
        console.log(
          `  ${m.matchId}: "${m.homeTeamName}" vs "${m.awayTeamName}" ` +
          `| norm: "${normSofaTeamName(m.homeTeamName)}" vs "${normSofaTeamName(m.awayTeamName)}" ` +
          `| date: ${m.utcDate.slice(0, 10)}`,
        );
      }
      if (toFetch.length > 10) {
        console.log(`  ... and ${toFetch.length - 10} more`);
      }
      continue;
    }

    // Apply global limit
    let batchToFetch = toFetch;
    if (LIMIT > 0) {
      const remaining = LIMIT - processedCount;
      if (remaining <= 0) {
        console.log(`[Backfill] Reached limit of ${LIMIT} matches — stopping`);
        break;
      }
      batchToFetch = toFetch.slice(0, remaining);
    }

    if (batchToFetch.length === 0) {
      console.log(`[Backfill] ${league.code}: nothing to fetch (all cached)`);
      continue;
    }

    console.log(
      `[Backfill] ${league.code}: fetching xG for ${batchToFetch.length} matches (delay=${DELAY_MS}ms)`,
    );

    const xgRecords = await source.getXgForMatches(
      batchToFetch,
      league.competitionId,
      league.season,
      DELAY_MS,
    );

    totalFound += xgRecords.length;
    processedCount += batchToFetch.length;

    const coverage =
      batchToFetch.length > 0
        ? ((xgRecords.length / batchToFetch.length) * 100).toFixed(1)
        : '0';
    console.log(
      `[Backfill] ${league.code}: ${xgRecords.length}/${batchToFetch.length} xG records obtained ` +
      `(${coverage}% coverage on batch)`,
    );

    if (LIMIT > 0 && processedCount >= LIMIT) {
      console.log(`[Backfill] Reached limit of ${LIMIT} matches — stopping`);
      break;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────

  console.log('\n[Backfill] ── Summary ──────────────────────────────────────────────');
  if (DRY_RUN) {
    console.log(
      `[Backfill] DRY RUN completed — ${totalMatches} finished matches found across all leagues`,
    );
    console.log(
      `[Backfill] ${totalAlreadyCached} already cached, ` +
      `${totalMatches - totalAlreadyCached} would be fetched`,
    );
  } else {
    console.log(`[Backfill] Total matches scanned:     ${totalMatches}`);
    console.log(`[Backfill] Already cached (skipped):  ${totalAlreadyCached}`);
    console.log(`[Backfill] Newly fetched:             ${processedCount}`);
    console.log(`[Backfill] New xG records obtained:   ${totalFound}`);
    const overallCoverage =
      processedCount > 0
        ? ((totalFound / processedCount) * 100).toFixed(1)
        : 'N/A';
    console.log(`[Backfill] Coverage on fetched batch: ${overallCoverage}%`);
    console.log(`[Backfill] xG cache location:         cache/xg-sofascore/`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[Backfill] Fatal error: ${msg}`);
  process.exit(1);
});

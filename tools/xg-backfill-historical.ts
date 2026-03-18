/**
 * xg-backfill-historical.ts — Backfill de xG desde SofaScore para temporadas históricas.
 *
 * Lee los archivos históricos de football-data.org (cache/historical/football-data/)
 * y obtiene xG de SofaScore para cada partido FINISHED.
 *
 * Seasons soportadas: 2023-24, 2024-25
 * Ligas: PD (LaLiga), PL (Premier League), BL1 (Bundesliga)
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-historical.ts
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-historical.ts --dry-run
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-historical.ts --season 2024-25
 *   npx tsx --tsconfig tsconfig.server.json tools/xg-backfill-historical.ts --comp PD --delay 200
 *
 * Flags:
 *   --dry-run      Muestra plan sin llamar a la API de estadísticas.
 *   --season X     Solo procesar esta temporada (e.g. "2024-25" o "2023-24").
 *   --comp X       Solo procesar esta liga (e.g. "PD", "PL", "BL1").
 *   --delay N      Delay entre requests de estadísticas en ms (default 150).
 *   --limit N      Máximo total de partidos a procesar.
 *
 * Requiere: FOOTBALL_DATA_TOKEN, RAPIDAPI_KEY
 *
 * Los xG se guardan en:
 *   cache/xg-sofascore/{competitionId}/{season}/{matchId}.json
 * donde matchId = hist:{leagueCode}:{homeId}:{awayId}:{date}
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
const DRY_RUN     = args.includes('--dry-run');
const seasonIdx   = args.indexOf('--season');
const SEASON_FILTER: string | null = seasonIdx !== -1 ? (args[seasonIdx + 1] ?? null) : null;
const compIdx     = args.indexOf('--comp');
const COMP_FILTER: string | null = compIdx !== -1 ? (args[compIdx + 1] ?? null) : null;
const delayIdx    = args.indexOf('--delay');
const DELAY_MS    = delayIdx !== -1 ? parseInt(args[delayIdx + 1] ?? '150', 10) : 150;
const limitIdx    = args.indexOf('--limit');
const LIMIT       = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '0', 10) : 0;

if (DRY_RUN) console.log('[Backfill-Hist] DRY RUN — no API stats calls, no disk writes');
if (SEASON_FILTER) console.log(`[Backfill-Hist] Season filter: ${SEASON_FILTER}`);
if (COMP_FILTER)   console.log(`[Backfill-Hist] Competition filter: ${COMP_FILTER}`);

// ── League/Season config ──────────────────────────────────────────────────────

interface HistSeasonConfig {
  code: string;
  competitionId: string;
  season: string;        // e.g. "2024-25"
  fdYear: number;        // historical JSON filename year, e.g. 2024
  fdSeasonParam: number; // for FD team names API call, same as fdYear
}

const ALL_SEASONS: HistSeasonConfig[] = [
  // 2024-25
  { code: 'PD',  competitionId: 'comp:football-data:PD',  season: '2024-25', fdYear: 2024, fdSeasonParam: 2024 },
  { code: 'PL',  competitionId: 'comp:football-data:PL',  season: '2024-25', fdYear: 2024, fdSeasonParam: 2024 },
  { code: 'BL1', competitionId: 'comp:football-data:BL1', season: '2024-25', fdYear: 2024, fdSeasonParam: 2024 },
  // 2023-24
  { code: 'PD',  competitionId: 'comp:football-data:PD',  season: '2023-24', fdYear: 2023, fdSeasonParam: 2023 },
  { code: 'PL',  competitionId: 'comp:football-data:PL',  season: '2023-24', fdYear: 2023, fdSeasonParam: 2023 },
  { code: 'BL1', competitionId: 'comp:football-data:BL1', season: '2023-24', fdYear: 2023, fdSeasonParam: 2023 },
];

const HIST_BASE  = path.join(process.cwd(), 'cache', 'historical', 'football-data');
const CACHE_BASE = path.join(process.cwd(), 'cache');
const TEAM_NAME_CACHE_DIR = path.join(CACHE_BASE, 'backfill-meta', 'team-names-hist');

// ── Historical match type ─────────────────────────────────────────────────────

interface HistMatch {
  homeTeamId: string;
  awayTeamId: string;
  utcDate: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

function loadHistoricalMatches(code: string, fdYear: number): HistMatch[] {
  const p = path.join(HIST_BASE, code, `${fdYear}.json`);
  if (!fs.existsSync(p)) {
    console.warn(`[Backfill-Hist] Historical data not found: ${p}`);
    return [];
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const d = JSON.parse(raw) as { matches?: HistMatch[] } | HistMatch[];
    const matches: HistMatch[] = Array.isArray(d) ? d : (d.matches ?? []);
    // Only include completed matches
    return matches.filter(
      (m) => m.homeGoals !== null && m.awayGoals !== null && m.utcDate,
    );
  } catch (err) {
    console.warn(`[Backfill-Hist] Error reading ${p}:`, err);
    return [];
  }
}

/**
 * Generates a stable synthetic matchId for historical matches that have no matchId.
 * Format: hist:{leagueCode}:{homeNumId}:{awayNumId}:{YYYY-MM-DD}
 */
function syntheticMatchId(code: string, homeTeamId: string, awayTeamId: string, utcDate: string): string {
  const homeNum = homeTeamId.split(':').pop() ?? homeTeamId;
  const awayNum = awayTeamId.split(':').pop() ?? awayTeamId;
  const date = utcDate.slice(0, 10);
  return `hist:${code}:${homeNum}:${awayNum}:${date}`;
}

// ── Team name resolution (FD API, 1 req/league/season, TTL 7d) ────────────────

const TEAM_NAME_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days

interface TeamNameDiskDoc {
  version: 1;
  code: string;
  fdYear: number;
  savedAt: string;
  teams: Array<{ id: string; name: string }>;
}

function teamNameCachePath(code: string, fdYear: number): string {
  return path.join(TEAM_NAME_CACHE_DIR, `${code}-${fdYear}.json`);
}

function readTeamNameCache(code: string, fdYear: number): Map<string, string> | null {
  try {
    const raw = fs.readFileSync(teamNameCachePath(code, fdYear), 'utf-8');
    const doc = JSON.parse(raw) as TeamNameDiskDoc;
    if (doc.version !== 1) return null;
    if (Date.now() - new Date(doc.savedAt).getTime() > TEAM_NAME_TTL_MS) return null;
    const map = new Map<string, string>();
    for (const t of doc.teams) map.set(t.id, t.name);
    return map;
  } catch { return null; }
}

function writeTeamNameCache(code: string, fdYear: number, map: Map<string, string>): void {
  const p = teamNameCachePath(code, fdYear);
  try {
    fs.mkdirSync(TEAM_NAME_CACHE_DIR, { recursive: true });
    const tmp = `${p}.tmp`;
    const doc: TeamNameDiskDoc = {
      version: 1, code, fdYear,
      savedAt: new Date().toISOString(),
      teams: Array.from(map.entries()).map(([id, name]) => ({ id, name })),
    };
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, p);
  } catch { /* non-fatal */ }
}

interface FDTeamsResponse {
  teams?: Array<{ id: number; name: string; shortName: string }>;
}

async function fetchTeamNames(code: string, fdYear: number, token: string): Promise<Map<string, string>> {
  const cached = readTeamNameCache(code, fdYear);
  if (cached) {
    console.log(`[Backfill-Hist] team names CACHE HIT ${code} ${fdYear} (${cached.size} teams)`);
    return cached;
  }
  if (!token) {
    console.warn(`[Backfill-Hist] FOOTBALL_DATA_TOKEN missing — team names unavailable for ${code} ${fdYear}`);
    return new Map();
  }
  console.log(`[Backfill-Hist] fetching team names FD ${code} season=${fdYear}...`);
  const url = `https://api.football-data.org/v4/competitions/${code}/teams?season=${fdYear}`;
  try {
    const res = await fetch(url, { headers: { 'X-Auth-Token': token } });
    if (!res.ok) {
      console.warn(`[Backfill-Hist] HTTP ${res.status} for team names ${code} ${fdYear}`);
      return new Map();
    }
    const data = await res.json() as FDTeamsResponse;
    const map = new Map<string, string>();
    for (const t of data.teams ?? []) {
      map.set(`team:football-data:${t.id}`, t.name ?? t.shortName ?? String(t.id));
    }
    console.log(`[Backfill-Hist] fetched ${map.size} team names for ${code} ${fdYear}`);
    writeTeamNameCache(code, fdYear, map);
    return map;
  } catch (err) {
    console.warn(`[Backfill-Hist] error fetching team names:`, err);
    return new Map();
  }
}

// ── Check if xG already cached ────────────────────────────────────────────────

function isXgCached(competitionId: string, season: string, matchId: string): boolean {
  const safeComp = competitionId.replace(/:/g, '_');
  const p = path.join(CACHE_BASE, 'xg-sofascore', safeComp, season, `${matchId}.json`);
  return fs.existsSync(p);
}

function countCached(competitionId: string, season: string, matchIds: string[]): number {
  return matchIds.filter((id) => isXgCached(competitionId, season, id)).length;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const fdToken    = process.env.FOOTBALL_DATA_TOKEN ?? '';
  const rapidKey   = process.env.RAPIDAPI_KEY ?? '';

  if (!rapidKey) {
    console.error('[Backfill-Hist] RAPIDAPI_KEY not set — aborting');
    process.exit(1);
  }

  const source = new SofaScoreXgSource();

  // Filter seasons
  let seasons = ALL_SEASONS;
  if (SEASON_FILTER) seasons = seasons.filter((s) => s.season === SEASON_FILTER);
  if (COMP_FILTER)   seasons = seasons.filter((s) => s.code === COMP_FILTER);

  if (seasons.length === 0) {
    console.error('[Backfill-Hist] No matching season/comp configs');
    process.exit(1);
  }

  let totalProcessed = 0;
  let totalFound     = 0;
  let grandTotal     = 0;
  let grandCached    = 0;

  for (const cfg of seasons) {
    console.log(`\n[Backfill-Hist] ── ${cfg.code} ${cfg.season} ─────────────────────`);

    // 1. Load historical matches
    const rawMatches = loadHistoricalMatches(cfg.code, cfg.fdYear);
    if (rawMatches.length === 0) {
      console.log(`[Backfill-Hist] No historical data for ${cfg.code} ${cfg.fdYear}`);
      continue;
    }
    console.log(`[Backfill-Hist] ${rawMatches.length} finished matches in historical data`);

    // 2. Resolve team names (for SofaScore fuzzy matching)
    const teamNames = await fetchTeamNames(cfg.code, cfg.fdSeasonParam, fdToken);

    // 3. Build CanonicalMatchRef[]
    const matchRefs: CanonicalMatchRef[] = rawMatches.map((m) => {
      const matchId = syntheticMatchId(cfg.code, m.homeTeamId, m.awayTeamId, m.utcDate);
      return {
        matchId,
        utcDate:       m.utcDate,
        homeTeamName:  teamNames.get(m.homeTeamId) ?? m.homeTeamId,
        awayTeamName:  teamNames.get(m.awayTeamId) ?? m.awayTeamId,
        homeTeamId:    m.homeTeamId,
        awayTeamId:    m.awayTeamId,
      };
    });

    // 4. Filter already-cached
    const allIds    = matchRefs.map((m) => m.matchId);
    const nCached   = countCached(cfg.competitionId, cfg.season, allIds);
    const toFetch   = matchRefs.filter((m) => !isXgCached(cfg.competitionId, cfg.season, m.matchId));

    console.log(`[Backfill-Hist] ${nCached} already cached, ${toFetch.length} to fetch`);
    grandTotal  += rawMatches.length;
    grandCached += nCached;

    if (DRY_RUN) {
      console.log(`[Backfill-Hist] DRY RUN — would fetch ${toFetch.length} matches`);
      const preview = toFetch.slice(0, 5);
      for (const m of preview) {
        const hNorm = normSofaTeamName(m.homeTeamName);
        const aNorm = normSofaTeamName(m.awayTeamName);
        console.log(`  ${m.matchId}: "${m.homeTeamName}" (${hNorm}) vs "${m.awayTeamName}" (${aNorm}) @ ${m.utcDate.slice(0, 10)}`);
      }
      if (toFetch.length > 5) console.log(`  ... and ${toFetch.length - 5} more`);
      continue;
    }

    if (toFetch.length === 0) {
      console.log(`[Backfill-Hist] Nothing to fetch — all cached`);
      continue;
    }

    // Apply limit
    let batch = toFetch;
    if (LIMIT > 0) {
      const rem = LIMIT - totalProcessed;
      if (rem <= 0) { console.log(`[Backfill-Hist] Limit reached — stopping`); break; }
      batch = toFetch.slice(0, rem);
    }

    console.log(`[Backfill-Hist] Fetching ${batch.length} xG records (delay=${DELAY_MS}ms)...`);

    const records = await source.getXgForMatches(
      batch,
      cfg.competitionId,
      cfg.season,
      DELAY_MS,
    );

    totalFound     += records.length;
    totalProcessed += batch.length;

    const pct = batch.length > 0 ? ((records.length / batch.length) * 100).toFixed(1) : '0';
    console.log(`[Backfill-Hist] ${records.length}/${batch.length} xG obtained (${pct}% coverage)`);

    if (LIMIT > 0 && totalProcessed >= LIMIT) {
      console.log(`[Backfill-Hist] Limit reached — stopping`);
      break;
    }
  }

  // Summary
  console.log('\n[Backfill-Hist] ── Summary ─────────────────────────────────────────');
  if (DRY_RUN) {
    console.log(`Total matches in historical data:  ${grandTotal}`);
    console.log(`Already cached:                    ${grandCached}`);
    console.log(`Would fetch:                       ${grandTotal - grandCached}`);
  } else {
    console.log(`Total scanned:                     ${grandTotal}`);
    console.log(`Already cached:                    ${grandCached}`);
    console.log(`Newly fetched:                     ${totalProcessed}`);
    console.log(`xG records obtained:               ${totalFound}`);
    const pct = totalProcessed > 0 ? ((totalFound / totalProcessed) * 100).toFixed(1) : 'N/A';
    console.log(`Coverage on fetched batch:         ${pct}%`);
    console.log(`xG cache location:                 cache/xg-sofascore/`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[Backfill-Hist] Fatal error: ${msg}`);
  process.exit(1);
});

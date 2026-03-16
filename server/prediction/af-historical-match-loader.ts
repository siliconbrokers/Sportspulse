/**
 * af-historical-match-loader.ts — Carga partidos FINISHED históricos desde API-Football v3.
 *
 * Complementa historical-match-loader.ts (football-data.org) como fuente alternativa.
 * Usado por shadow-validator.ts para comparar cobertura y scores antes del cutover.
 *
 * Endpoint: GET https://v3.football.api-sports.io/fixtures?league={id}&season={year}&status=FT
 *
 * Cache: /cache/historical/af/{leagueId}/{season}.json
 *   - Temporadas pasadas: TTL 1 año (inmutable)
 *   - Temporada actual: TTL 6 horas
 *
 * Budget: usa af-budget.ts para coordinar con demás consumidores.
 * Fault isolation: cualquier error retorna [] silenciosamente.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  isQuotaExhausted,
  consumeRequest,
  markQuotaExhausted,
} from '../af-budget.js';
import type { FinishedMatchRecord } from '@sportpulse/prediction';

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_ROOT            = path.resolve(process.cwd(), 'cache/historical/af');
const CURRENT_SEASON_TTL_MS = 6 * 3600_000;        // 6 hours
const PAST_SEASON_TTL_MS    = 365 * 24 * 3600_000; // 1 year

// ── Cache types ───────────────────────────────────────────────────────────────

interface AfHistoricalCacheDoc {
  version:   1;
  leagueId:  number;
  season:    number;
  fetchedAt: string;
  matches:   FinishedMatchRecord[];
}

// ── Cache I/O ─────────────────────────────────────────────────────────────────

function cachePath(leagueId: number, season: number): string {
  return path.join(CACHE_ROOT, String(leagueId), `${season}.json`);
}

async function readCache(
  leagueId: number,
  season:   number,
): Promise<AfHistoricalCacheDoc | null> {
  try {
    const raw = await fs.readFile(cachePath(leagueId, season), 'utf-8');
    const doc = JSON.parse(raw) as AfHistoricalCacheDoc;
    if (doc.version !== 1 || !Array.isArray(doc.matches)) return null;
    return doc;
  } catch {
    return null;
  }
}

async function writeCache(
  leagueId: number,
  season:   number,
  matches:  FinishedMatchRecord[],
): Promise<void> {
  const p       = cachePath(leagueId, season);
  const tmpPath = `${p}.tmp`;
  const doc: AfHistoricalCacheDoc = {
    version: 1,
    leagueId,
    season,
    fetchedAt: new Date().toISOString(),
    matches,
  };
  try {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
    await fs.rename(tmpPath, p);
  } catch (err) {
    console.warn(`[AfHistoricalLoader] cache write error league=${leagueId} season=${season}: ${err}`);
  }
}

function isCacheFresh(
  doc:           AfHistoricalCacheDoc,
  season:        number,
  currentSeason: number,
): boolean {
  const ttl = season < currentSeason ? PAST_SEASON_TTL_MS : CURRENT_SEASON_TTL_MS;
  return Date.now() - new Date(doc.fetchedAt).getTime() < ttl;
}

// ── Raw API types ─────────────────────────────────────────────────────────────

interface AfFixtureItem {
  fixture: { id: number; date: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
}

interface AfFixturesResponse {
  errors?:   Record<string, string>;
  response?: AfFixtureItem[];
}

// ── Fetch from API-Football ────────────────────────────────────────────────────

async function fetchFromApi(
  leagueId: number,
  season:   number,
  apiKey:   string,
  bridge:   Map<number, string>, // AF team ID → canonical team ID
): Promise<FinishedMatchRecord[]> {
  if (isQuotaExhausted()) {
    console.log(`[AfHistoricalLoader] Quota exhausted — skipping fetch league=${leagueId} season=${season}`);
    return [];
  }

  const url  = `https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${season}&status=FT`;
  let   data: AfFixturesResponse;

  try {
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-key':  apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io',
      },
      signal: AbortSignal.timeout(20_000),
    });
    consumeRequest();

    if (!res.ok) {
      console.warn(`[AfHistoricalLoader] HTTP ${res.status} league=${leagueId} season=${season}`);
      return [];
    }

    data = await res.json() as AfFixturesResponse;
  } catch (err) {
    console.warn(`[AfHistoricalLoader] fetch error: ${err}`);
    return [];
  }

  // Detect quota exhaustion in body
  if (data.errors && Object.values(data.errors).some(
    (v) => typeof v === 'string' && v.toLowerCase().includes('limit'),
  )) {
    markQuotaExhausted();
    return [];
  }

  const fixtures = data.response ?? [];
  const records:  FinishedMatchRecord[] = [];
  let   bridgeMisses = 0;

  for (const f of fixtures) {
    if (f.goals.home === null || f.goals.away === null) continue;

    const homeCanonical = bridge.get(f.teams.home.id);
    const awayCanonical = bridge.get(f.teams.away.id);

    if (!homeCanonical || !awayCanonical) {
      bridgeMisses++;
      continue;
    }

    records.push({
      homeTeamId: homeCanonical,
      awayTeamId: awayCanonical,
      utcDate:    f.fixture.date,
      homeGoals:  f.goals.home,
      awayGoals:  f.goals.away,
    });
  }

  if (bridgeMisses > 0) {
    console.warn(
      `[AfHistoricalLoader] league=${leagueId} season=${season}: ` +
      `${bridgeMisses}/${fixtures.length} fixtures skipped (bridge miss)`,
    );
  }

  console.log(
    `[AfHistoricalLoader] league=${leagueId} season=${season}: ` +
    `${records.length} records from ${fixtures.length} AF fixtures`,
  );

  return records;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Carga partidos FINISHED históricos desde API-Football para una liga y un rango de temporadas.
 *
 * @param leagueId            AF league ID (e.g. 140 para LaLiga)
 * @param currentSeason       Año de inicio de la temporada actual (e.g. 2024)
 * @param pastSeasonsCount    Cuántas temporadas anteriores incluir (default: 2)
 * @param bridge              Map<afTeamId, canonicalTeamId> — construido desde buildTeamBridge
 * @param apiKey              APIFOOTBALL_KEY
 */
export async function loadAfHistoricalMatches(
  leagueId:         number,
  currentSeason:    number,
  bridge:           Map<number, string>,
  apiKey:           string,
  pastSeasonsCount: number = 2,
): Promise<FinishedMatchRecord[]> {
  const seasons    = Array.from(
    { length: pastSeasonsCount + 1 },
    (_, i) => currentSeason - i,
  );
  const allRecords: FinishedMatchRecord[] = [];

  for (const season of seasons) {
    const cached = await readCache(leagueId, season);

    if (cached && isCacheFresh(cached, season, currentSeason)) {
      console.log(
        `[AfHistoricalLoader] CACHE HIT league=${leagueId} season=${season}: ${cached.matches.length} matches`,
      );
      allRecords.push(...cached.matches);
      continue;
    }

    if (!apiKey) {
      if (cached) {
        console.warn(`[AfHistoricalLoader] No API key — using stale cache league=${leagueId} season=${season}`);
        allRecords.push(...cached.matches);
      }
      continue;
    }

    const fetched = await fetchFromApi(leagueId, season, apiKey, bridge);

    if (fetched.length > 0) {
      await writeCache(leagueId, season, fetched);
      allRecords.push(...fetched);
    } else if (cached) {
      // Fallback a stale cache si el fetch falla
      console.warn(`[AfHistoricalLoader] Using stale cache league=${leagueId} season=${season}`);
      allRecords.push(...cached.matches);
    }
  }

  // Ordenar cronológicamente — output determinístico
  allRecords.sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  return allRecords;
}

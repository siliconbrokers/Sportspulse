/**
 * historical-match-loader-af.ts — Carga partidos históricos FINISHED desde API-Football.
 *
 * Endpoint: GET https://v3.football.api-sports.io/fixtures?league={leagueId}&season={year}
 * Filtro:   fixture.fixture.status.short === 'FT' (Full Time)
 * ID format: team:apifootball:{numericId}  — consistente con ApiFootballCanonicalSource
 *
 * Cache: cache/historical/apifootball/{leagueId}/{year}.json
 *   - Temporada corriente (año actual): TTL 6 horas
 *   - Temporadas pasadas:               TTL 1 año (inmutables)
 *
 * Retorna V3MatchRecord[] listo para pasarse a runV3Engine como prevSeasonMatches.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { V3MatchRecord } from '@sportpulse/prediction';

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = 'https://v3.football.api-sports.io';
const CACHE_DIR = path.resolve(process.cwd(), 'cache/historical/apifootball');
const TTL_CURRENT_MS  = 6 * 3600_000;   // 6 h — current season (matches still being played)
const TTL_PAST_MS     = 365 * 24 * 3600_000; // 1 year — past seasons (immutable)

// ── Types ─────────────────────────────────────────────────────────────────────

interface AfFixtureLite {
  fixture: { id: number; date: string; status: { short: string } };
  teams:   { home: { id: number }; away: { id: number } };
  goals:   { home: number | null; away: number | null };
}

interface AfResponse<T> {
  response: T[];
}

interface CacheDoc {
  version: 1;
  leagueId: number;
  year: number;
  savedAt: string;
  records: V3MatchRecord[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function afTeamId(numericId: number): string {
  return `team:apifootball:${numericId}`;
}

function cachePath(leagueId: number, year: number): string {
  return path.join(CACHE_DIR, String(leagueId), `${year}.json`);
}

function currentSeasonYear(): number {
  const now   = new Date();
  const year  = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed
  // European convention: before July → previous year start
  // Also works for calendar-year leagues where current = same year
  return month < 6 ? year - 1 : year;
}

function isCacheFresh(savedAt: string, leagueId: number, year: number): boolean {
  const ttl    = year < currentSeasonYear() ? TTL_PAST_MS : TTL_CURRENT_MS;
  const ageMs  = Date.now() - new Date(savedAt).getTime();
  return ageMs < ttl;
}

function readCache(leagueId: number, year: number): V3MatchRecord[] | null {
  const p = cachePath(leagueId, year);
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const doc = JSON.parse(raw) as CacheDoc;
    if (doc.version !== 1 || doc.leagueId !== leagueId || doc.year !== year) return null;
    if (!isCacheFresh(doc.savedAt, leagueId, year)) return null;
    console.log(`[AfHistoricalLoader] CACHE HIT ${leagueId}/${year}: ${doc.records.length} matches`);
    return doc.records;
  } catch {
    return null;
  }
}

function writeCache(leagueId: number, year: number, records: V3MatchRecord[]): void {
  const p = cachePath(leagueId, year);
  const tmp = p + '.tmp';
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const doc: CacheDoc = {
      version: 1,
      leagueId,
      year,
      savedAt: new Date().toISOString(),
      records,
    };
    fs.writeFileSync(tmp, JSON.stringify(doc), 'utf-8');
    fs.renameSync(tmp, p);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[AfHistoricalLoader] CACHE WRITE ERROR ${leagueId}/${year}: ${msg}`);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Carga los partidos FINISHED de una liga y temporada desde API-Football.
 * Usa caché de disco para minimizar requests (100 req/día de cuota compartida).
 *
 * @param leagueId   ID numérico de la liga en API-Football (ej: 140 = LaLiga)
 * @param year       Año de temporada (ej: 2024 = temporada 2024-25 para ligas europeas)
 * @param apiKey     API-Football key (x-apisports-key)
 */
export async function loadAfHistoricalMatches(
  leagueId: number,
  year: number,
  apiKey: string,
): Promise<V3MatchRecord[]> {
  // Cache hit
  const cached = readCache(leagueId, year);
  if (cached !== null) return cached;

  // Fetch from API
  const url = `${BASE_URL}/fixtures?league=${leagueId}&season=${year}`;
  console.log(`[AfHistoricalLoader] API FETCH ${leagueId}/${year}`);

  let fixtures: AfFixtureLite[];
  try {
    const res = await fetch(url, {
      headers: { 'x-apisports-key': apiKey },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as AfResponse<AfFixtureLite>;
    fixtures = body.response ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[AfHistoricalLoader] API FETCH FAILED ${leagueId}/${year}: ${msg}`);
    return [];
  }

  // Filter only full-time finished matches with valid scores
  const records: V3MatchRecord[] = fixtures
    .filter(
      (f) =>
        f.fixture.status.short === 'FT' &&
        f.goals.home !== null &&
        f.goals.away !== null,
    )
    .map((f) => ({
      homeTeamId: afTeamId(f.teams.home.id),
      awayTeamId: afTeamId(f.teams.away.id),
      utcDate:    f.fixture.date,
      homeGoals:  f.goals.home as number,
      awayGoals:  f.goals.away as number,
    }));

  console.log(`[AfHistoricalLoader] ${leagueId}/${year}: ${records.length} finished matches fetched`);
  writeCache(leagueId, year, records);
  return records;
}

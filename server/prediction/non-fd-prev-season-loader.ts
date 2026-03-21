/**
 * non-fd-prev-season-loader.ts — Carga temporada anterior para competencias no-FD.
 *
 * Provee `V3MatchRecord[]` de la temporada anterior para BL1 (OpenLigaDB),
 * URU y ARG (TheSportsDB). Estos datos se pasan como `prevSeasonMatches` al V3 engine,
 * mejorando la calidad del prior desde LEAGUE_BASELINE → PREV_SEASON/PARTIAL.
 *
 * Cache strategy:
 *   - Temporadas anteriores son inmutables → TTL 1 año
 *   - Escritura atómica (.tmp → rename), consistente con el resto del sistema
 *   - Directorio: cache/historical/{provider}/{competitionCode}/{year}.json
 *
 * APIs:
 *   - OpenLigaDB: GET https://api.openligadb.de/getmatchdata/{league}/{year}
 *   - TheSportsDB: GET https://www.thesportsdb.com/api/v1/json/{key}/eventsseason.php?id={id}&s={year}
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { teamId as canonicalTeamId } from '@sportpulse/canonical';
import type { V3MatchRecord } from '@sportpulse/prediction';

// ── Constants ─────────────────────────────────────────────────────────────────

const PREV_SEASON_TTL_MS = 365 * 24 * 3600_000; // 1 año — temporada anterior es inmutable
const CACHE_BASE = path.resolve(process.cwd(), 'cache/historical');

const OLG_BASE_URL = 'https://api.openligadb.de';
const SDB_BASE_URL = 'https://www.thesportsdb.com/api/v1/json';

// ── Cache helpers ─────────────────────────────────────────────────────────────

interface CacheDoc {
  version: 1;
  fetchedAt: string;
  matches: V3MatchRecord[];
}

function cachePath(provider: string, code: string, year: number): string {
  return path.join(CACHE_BASE, provider, code, `${year}.json`);
}

function readCache(provider: string, code: string, year: number): V3MatchRecord[] | null {
  const p = cachePath(provider, code, year);
  try {
    if (!fs.existsSync(p)) return null;
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown;
    if (
      doc !== null &&
      typeof doc === 'object' &&
      (doc as Record<string, unknown>)['version'] === 1 &&
      Array.isArray((doc as Record<string, unknown>)['matches'])
    ) {
      const cachedAt = new Date((doc as CacheDoc).fetchedAt).getTime();
      if (Date.now() - cachedAt < PREV_SEASON_TTL_MS) {
        return (doc as CacheDoc).matches;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(provider: string, code: string, year: number, matches: V3MatchRecord[]): void {
  const p = cachePath(provider, code, year);
  const tmp = p.replace(/\.json$/, '.tmp');
  const doc: CacheDoc = { version: 1, fetchedAt: new Date().toISOString(), matches };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
    fs.renameSync(tmp, p);
  } catch (err) {
    console.warn(`[NonFdLoader] writeCache failed for ${provider}/${code}/${year}:`, err);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ── OpenLigaDB ────────────────────────────────────────────────────────────────

interface OLGMatchTeam { teamId: number }
interface OLGMatchResult { resultTypeID: number; pointsTeam1: number; pointsTeam2: number }
interface OLGMatch {
  matchID: number;
  matchDateTimeUTC: string;
  matchIsFinished: boolean;
  team1: OLGMatchTeam;
  team2: OLGMatchTeam;
  matchResults?: OLGMatchResult[];
}

/**
 * Carga partidos FINISHED de la temporada anterior de BL1 desde OpenLigaDB.
 * @param league   Liga OLG (e.g. 'bl1')
 * @param prevYear Año de inicio de la temporada anterior (e.g. 2024 para 2024-25)
 */
export async function loadOLGPrevSeason(
  league: string,
  prevYear: number,
): Promise<V3MatchRecord[]> {
  const PROVIDER = 'openligadb';

  const cached = readCache(PROVIDER, league, prevYear);
  if (cached) {
    console.log(`[NonFdLoader] OLG cache hit: ${league}/${prevYear} (${cached.length} matches)`);
    return cached;
  }

  try {
    const url = `${OLG_BASE_URL}/getmatchdata/${league}/${prevYear}`;
    console.log(`[NonFdLoader] Fetching OLG prev season: ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as OLGMatch[];

    const matches: V3MatchRecord[] = [];
    for (const m of raw) {
      if (!m.matchIsFinished || !m.matchDateTimeUTC) continue;
      const finalResult =
        m.matchResults?.find((r) => r.resultTypeID === 2) ??
        m.matchResults?.find((r) => r.resultTypeID === 1);
      if (!finalResult) continue;

      matches.push({
        homeTeamId: canonicalTeamId(PROVIDER, String(m.team1.teamId)),
        awayTeamId: canonicalTeamId(PROVIDER, String(m.team2.teamId)),
        utcDate: m.matchDateTimeUTC,
        homeGoals: finalResult.pointsTeam1,
        awayGoals: finalResult.pointsTeam2,
      });
    }

    writeCache(PROVIDER, league, prevYear, matches);
    console.log(`[NonFdLoader] OLG ${league}/${prevYear}: ${matches.length} finished matches cached`);
    return matches;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[NonFdLoader] OLG prev season failed for ${league}/${prevYear}: ${msg}`);
    return [];
  }
}

// ── TheSportsDB ───────────────────────────────────────────────────────────────

interface SDBEvent {
  idEvent: string;
  idHomeTeam: string;
  idAwayTeam: string;
  dateEvent: string;
  strTime: string | null;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strStatus: string;
}

const SDB_TERMINAL_STATUSES = new Set([
  'FT', 'FINAL', 'FINISHED', 'AWARDED', 'MATCH FINISHED', 'Match Finished',
]);

/**
 * Carga partidos FINISHED de la temporada anterior desde TheSportsDB.
 * @param leagueId    ID de liga en TheSportsDB (e.g. '4432' para URU, '4406' para ARG)
 * @param providerKey Clave canónica del provider (e.g. 'thesportsdb', 'sportsdb-ar')
 * @param apiKey      API key de TheSportsDB
 * @param prevYear    Año de la temporada anterior (e.g. 2024)
 */
export async function loadSDBPrevSeason(
  leagueId: string,
  providerKey: string,
  apiKey: string,
  prevYear: number,
): Promise<V3MatchRecord[]> {
  const cached = readCache(providerKey, leagueId, prevYear);
  if (cached) {
    console.log(`[NonFdLoader] SDB cache hit: ${providerKey}/${leagueId}/${prevYear} (${cached.length} matches)`);
    return cached;
  }

  try {
    const url = `${SDB_BASE_URL}/${apiKey}/eventsseason.php?id=${leagueId}&s=${prevYear}`;
    console.log(`[NonFdLoader] Fetching SDB prev season: ${providerKey}/${leagueId}/${prevYear}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { events: SDBEvent[] | null };
    const raw = data.events ?? [];

    const matches: V3MatchRecord[] = [];
    for (const e of raw) {
      if (!SDB_TERMINAL_STATUSES.has(e.strStatus)) continue;
      if (e.intHomeScore === null || e.intAwayScore === null) continue;
      if (!e.dateEvent) continue;

      const homeGoals = parseInt(e.intHomeScore, 10);
      const awayGoals = parseInt(e.intAwayScore, 10);
      if (isNaN(homeGoals) || isNaN(awayGoals)) continue;

      const utcDate = e.strTime
        ? `${e.dateEvent}T${e.strTime}Z`
        : `${e.dateEvent}T00:00:00Z`;

      matches.push({
        homeTeamId: canonicalTeamId(providerKey, e.idHomeTeam),
        awayTeamId: canonicalTeamId(providerKey, e.idAwayTeam),
        utcDate,
        homeGoals,
        awayGoals,
      });
    }

    writeCache(providerKey, leagueId, prevYear, matches);
    console.log(`[NonFdLoader] SDB ${providerKey}/${leagueId}/${prevYear}: ${matches.length} finished matches cached`);
    return matches;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[NonFdLoader] SDB prev season failed for ${providerKey}/${leagueId}/${prevYear}: ${msg}`);
    return [];
  }
}

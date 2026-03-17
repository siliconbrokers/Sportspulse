/**
 * xg-source-sofascore.ts — Adaptador de xG histórico usando SofaScore (vía RapidAPI MCP).
 *
 * Alternativa presupuestaria a xg-source.ts (API-Football, 100 req/día compartido).
 * SofaScore no comparte el budget de APIFOOTBALL_KEY — opera de forma independiente.
 *
 * ── Flujo por llamada a getXgForMatches() ─────────────────────────────────────
 *
 *   1. Agrupar los partidos por fecha (utcDate → YYYY-MM-DD local UY).
 *   2. Por cada fecha única: llamar Get_matches_by_date (1 request).
 *   3. Para cada partido canónico en esa fecha:
 *      a. Buscar el match_id de SofaScore via fuzzy matching de nombres de equipo.
 *      b. Si hay match: llamar Get_match_statistics (1 request).
 *      c. Extraer expectedGoals del período ALL; si no → omitir (no lanzar error).
 *   4. Retornar XgRecord[] con los partidos encontrados.
 *
 * ── Estimación de requests MCP para un backfill completo (2025-26) ────────────
 *
 *   PD (LaLiga):       ~38 jornadas × 10 partidos = ~380 partidos
 *   PL (Premier):      ~38 jornadas × 10 partidos = ~380 partidos
 *   BL1 (Bundesliga):  ~34 jornadas × 9 partidos  = ~306 partidos
 *   Total partidos:    ~1066 (a mitad de temporada ~530 ya jugados)
 *
 *   Requests por backfill parcial (a fecha 2026-03):
 *     - Get_matches_by_date: ~80-100 días con partidos × 3 ligas × 1 = ~100-130 req
 *       (varios partidos por fecha, 1 sola req por fecha — muy eficiente)
 *     - Get_match_statistics: 1 req por partido → ~530 req
 *   Total estimado: ~630-660 requests MCP para backfill 2025-26 hasta la fecha.
 *
 * ── Cobertura esperada ────────────────────────────────────────────────────────
 *
 *   SofaScore provee xG para: LaLiga, Premier League, Bundesliga, Champions League,
 *   Europa League, Serie A, Ligue 1, y torneos top. NO disponible para: Liga Uruguaya
 *   (TheSportsDB:4432) y Liga Argentina (sportsdb-ar:4406).
 *
 *   Cobertura esperada (partidos con xG disponible / partidos totales):
 *     PD: ~95%  | PL: ~95%  | BL1: ~90%
 *
 * ── Fault isolation ──────────────────────────────────────────────────────────
 *
 *   Cualquier error retorna [] silenciosamente. Cobertura parcial es OK —
 *   el engine usa goles reales para partidos sin xG.
 *
 * MKT-T3-03 (fuente alternativa SofaScore)
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import type { XgRecord } from '@sportpulse/prediction';

// ── Public interfaces ─────────────────────────────────────────────────────────

/** Referencia canónica mínima de un partido para búsqueda de xG. */
export interface CanonicalMatchRef {
  /** Canonical match ID (from our system) */
  matchId: string;
  /** ISO-8601 UTC kickoff timestamp */
  utcDate: string;
  /** Home team name as stored in canonical data (for fuzzy matching) */
  homeTeamName: string;
  /** Away team name as stored in canonical data (for fuzzy matching) */
  awayTeamName: string;
  /** Canonical home team ID (carried through to XgRecord) */
  homeTeamId: string;
  /** Canonical away team ID (carried through to XgRecord) */
  awayTeamId: string;
}

// ── Disk cache ────────────────────────────────────────────────────────────────

const CACHE_ROOT = 'cache/xg-sofascore';

interface SofaScoreXgDiskDoc {
  version: 1;
  matchId: string;
  savedAt: string;
  xgHome: number;
  xgAway: number;
  sofaMatchId: number;
}

function buildDiskCachePath(competitionId: string, season: string, matchId: string): string {
  // Sanitize competitionId (contains ":") for use as directory name
  const safeComp = competitionId.replace(/:/g, '_');
  return join(CACHE_ROOT, safeComp, season, `${matchId}.json`);
}

async function readXgFromDisk(
  competitionId: string,
  season: string,
  matchId: string,
): Promise<{ xgHome: number; xgAway: number } | null> {
  const p = buildDiskCachePath(competitionId, season, matchId);
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const doc = JSON.parse(raw) as SofaScoreXgDiskDoc;
    if (doc.version !== 1 || doc.matchId !== matchId) return null;
    return { xgHome: doc.xgHome, xgAway: doc.xgAway };
  } catch {
    return null;
  }
}

async function writeXgToDisk(
  competitionId: string,
  season: string,
  matchId: string,
  xgHome: number,
  xgAway: number,
  sofaMatchId: number,
): Promise<void> {
  const p = buildDiskCachePath(competitionId, season, matchId);
  const tmp = `${p}.tmp`;
  const doc: SofaScoreXgDiskDoc = {
    version: 1,
    matchId,
    savedAt: new Date().toISOString(),
    xgHome,
    xgAway,
    sofaMatchId,
  };
  try {
    await fs.mkdir(join(p, '..'), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(doc), 'utf-8');
    await fs.rename(tmp, p);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[XgSofaScore] cache write error for match ${matchId}: ${msg}`);
  }
}

// ── Name normalization ────────────────────────────────────────────────────────

// Words to strip when normalizing team names for fuzzy matching.
// NOTE: "united", "city", "town" intentionally excluded — they disambiguate
// teams like Manchester United vs Manchester City.
const STRIP_WORDS = new Set([
  'fc', 'cf', 'afc', 'sc', 'rc', 'cd', 'sd', 'ac', 'as', 'sk', 'bk',
  'de', 'del', 'los', 'la', 'el', 'las', 'le', 'les',
]);

/**
 * Normalizes a team name for fuzzy comparison.
 * Lowercase → strip accents → remove punctuation → remove common affixes → trim.
 */
export function normSofaTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics (accents)
    .replace(/[^\w\s]/g, ' ')          // punctuation → space
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STRIP_WORDS.has(w))
    .join(' ')
    .trim();
}

/**
 * Returns true if two normalized team names are considered a match.
 * Strategy: one must contain the other as a substring, or they share
 * the leading token (first meaningful word).
 */
function teamNamesMatch(normA: string, normB: string): boolean {
  if (normA === normB) return true;
  if (normA.length === 0 || normB.length === 0) return false;
  // Containment check (bi-directional)
  if (normA.includes(normB) || normB.includes(normA)) return true;
  // Leading-token check (e.g. "real madrid" vs "real")
  const tokA = normA.split(' ');
  const tokB = normB.split(' ');
  if (tokA[0] === tokB[0] && tokA[0].length >= 3) return true;
  return false;
}

// ── SofaScore raw API types ───────────────────────────────────────────────────

interface SofaTeam {
  id: number;
  name: string;
  shortName?: string;
}

interface SofaMatch {
  id: number;
  homeTeam: SofaTeam;
  awayTeam: SofaTeam;
  tournament?: { id: number; name: string };
  /** Match status (e.g. "finished", "notstarted") */
  status?: { description?: string; type?: string };
}

interface SofaMatchListResponse {
  events?: SofaMatch[];
}

interface SofaStatGroup {
  groupName?: string;   // e.g. "ALL", "1ST", "2ND"
  statisticsItems?: Array<{
    name?: string;      // e.g. "Expected Goals", "Ball Possession"
    homeValue?: number | string | null;
    awayValue?: number | string | null;
    homeTotal?: number | string | null;
    awayTotal?: number | string | null;
  }>;
}

interface SofaStatisticsResponse {
  statistics?: SofaStatGroup[];
}

// ── MCP caller shim ──────────────────────────────────────────────────────────
//
// The MCP tools are called via the agent runtime at design time.
// At runtime (Node.js server / CLI script), we need a concrete HTTP caller.
// This shim replicates what the MCP tool does: it calls the RapidAPI endpoint
// using the RAPIDAPI_KEY env var (same key used by all RapidAPI hub integrations).
//
// If RAPIDAPI_KEY is not set, all calls return null silently (fault isolation).

const RAPIDAPI_HOST = 'sofascore.p.rapidapi.com';
const BASE_URL = 'https://sofascore.p.rapidapi.com';

async function sofaGetMatchesByDate(
  date: string,   // YYYY-MM-DD
  apiKey: string,
): Promise<SofaMatchListResponse | null> {
  const url = `${BASE_URL}/api/sofascore/v1/match/list?date=${date}&sport_slug=football`;
  try {
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': apiKey,
      },
    });
    if (!res.ok) {
      console.warn(`[XgSofaScore] HTTP ${res.status} for match list date=${date}`);
      return null;
    }
    return (await res.json()) as SofaMatchListResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[XgSofaScore] fetch error for match list date=${date}: ${msg}`);
    return null;
  }
}

async function sofaGetMatchStatistics(
  matchId: number,
  apiKey: string,
): Promise<SofaStatisticsResponse | null> {
  const url = `${BASE_URL}/api/sofascore/v1/match/statistics?match_id=${matchId}`;
  try {
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': apiKey,
      },
    });
    if (!res.ok) {
      console.warn(`[XgSofaScore] HTTP ${res.status} for statistics match_id=${matchId}`);
      return null;
    }
    return (await res.json()) as SofaStatisticsResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[XgSofaScore] fetch error for statistics match_id=${matchId}: ${msg}`);
    return null;
  }
}

// ── xG extraction ─────────────────────────────────────────────────────────────

/**
 * Finds the "ALL" period stats group and extracts expectedGoals for home/away.
 * Returns null if not available.
 */
function extractXgFromStatistics(
  stats: SofaStatisticsResponse,
): { xgHome: number; xgAway: number } | null {
  const groups = stats.statistics ?? [];

  // Prefer the "ALL" period group; fall back to the first available
  const allGroup =
    groups.find((g) => g.groupName?.toUpperCase() === 'ALL') ??
    groups.find((g) => g.groupName?.toUpperCase() !== '1ST' && g.groupName?.toUpperCase() !== '2ND') ??
    groups[0];

  if (!allGroup?.statisticsItems) return null;

  // SofaScore field name varies slightly between API versions
  const xgItem = allGroup.statisticsItems.find((item) => {
    const n = (item.name ?? '').toLowerCase();
    return n === 'expected goals' || n === 'expectedgoals' || n === 'xg';
  });

  if (!xgItem) return null;

  // homeValue / homeTotal both possible depending on API version
  const rawHome = xgItem.homeValue ?? xgItem.homeTotal;
  const rawAway = xgItem.awayValue ?? xgItem.awayTotal;

  if (rawHome === null || rawHome === undefined || rawAway === null || rawAway === undefined) {
    return null;
  }

  const xgHome = typeof rawHome === 'number' ? rawHome : parseFloat(String(rawHome));
  const xgAway = typeof rawAway === 'number' ? rawAway : parseFloat(String(rawAway));

  if (isNaN(xgHome) || isNaN(xgAway) || xgHome < 0 || xgAway < 0) return null;

  return { xgHome, xgAway };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Converts a UTC ISO timestamp to a local date string (YYYY-MM-DD) in the
 * America/Montevideo timezone (UTC-3, portal timezone).
 * Using 'en-CA' locale to get ISO format output (YYYY-MM-DD).
 */
function utcToLocalDate(utcIso: string): string {
  return new Date(utcIso).toLocaleDateString('en-CA', {
    timeZone: 'America/Montevideo',
  });
}

// ── SofaScoreXgSource ─────────────────────────────────────────────────────────

export class SofaScoreXgSource {
  /**
   * Fetches xG for a list of canonical matches from SofaScore.
   *
   * Matches without xG data are silently omitted from the result.
   * Partial coverage is OK — the V3 engine falls back to real goals for missing matches.
   *
   * @param matches       Canonical match references with team names.
   * @param competitionId Used for disk cache path organization.
   * @param season        Season string (e.g. "2025-26") for disk cache path.
   * @param delayMs       Delay between statistics requests (default 100ms). Used by
   *                      backfill scripts to avoid rate limiting.
   */
  async getXgForMatches(
    matches: CanonicalMatchRef[],
    competitionId: string,
    season: string,
    delayMs = 100,
  ): Promise<XgRecord[]> {
    const apiKey = process.env.RAPIDAPI_KEY ?? '';
    if (!apiKey) {
      console.warn('[XgSofaScore] RAPIDAPI_KEY not set — skipping xG fetch');
      return [];
    }

    if (matches.length === 0) return [];

    const results: XgRecord[] = [];
    let found = 0;
    let fromCache = 0;

    // Step 1: Check disk cache for all matches — avoid API calls for already cached
    const toFetch: CanonicalMatchRef[] = [];
    for (const match of matches) {
      const cached = await readXgFromDisk(competitionId, season, match.matchId);
      if (cached) {
        results.push({
          utcDate:    match.utcDate,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          xgHome:     cached.xgHome,
          xgAway:     cached.xgAway,
        });
        found++;
        fromCache++;
      } else {
        toFetch.push(match);
      }
    }

    if (toFetch.length === 0) {
      console.log(
        `[XgSofaScore] ${competitionId}: ${found}/${matches.length} xG from disk cache (no API calls needed)`,
      );
      return results;
    }

    // Step 2: Group remaining matches by local date (1 Get_matches_by_date per date)
    const byDate = new Map<string, CanonicalMatchRef[]>();
    for (const match of toFetch) {
      const dateLocal = utcToLocalDate(match.utcDate);
      const list = byDate.get(dateLocal) ?? [];
      list.push(match);
      byDate.set(dateLocal, list);
    }

    // Step 3: For each date, fetch the SofaScore match list and find candidates
    for (const [dateLocal, dateMatches] of byDate.entries()) {
      const listResponse = await sofaGetMatchesByDate(dateLocal, apiKey);
      if (!listResponse?.events) {
        console.warn(`[XgSofaScore] no events for date=${dateLocal}`);
        continue;
      }

      const sofaEvents = listResponse.events;

      for (const match of dateMatches) {
        // Find the SofaScore event via fuzzy team name matching
        const normHome = normSofaTeamName(match.homeTeamName);
        const normAway = normSofaTeamName(match.awayTeamName);

        const sofaMatch = sofaEvents.find((ev) => {
          const sHome = normSofaTeamName(ev.homeTeam?.name ?? '');
          const sAway = normSofaTeamName(ev.awayTeam?.name ?? '');
          return teamNamesMatch(normHome, sHome) && teamNamesMatch(normAway, sAway);
        });

        if (!sofaMatch) {
          console.log(
            `[XgSofaScore] no SofaScore match found for ${match.homeTeamName} vs ${match.awayTeamName} on ${dateLocal}`,
          );
          continue;
        }

        // Delay to avoid rate limiting (only between stats calls, not list calls)
        if (delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }

        // Fetch statistics for the found SofaScore match
        const statsResponse = await sofaGetMatchStatistics(sofaMatch.id, apiKey);
        if (!statsResponse) continue;

        const xg = extractXgFromStatistics(statsResponse);
        if (!xg) {
          console.log(
            `[XgSofaScore] xG not available in stats for match_id=${sofaMatch.id} ` +
            `(${match.homeTeamName} vs ${match.awayTeamName})`,
          );
          continue;
        }

        // Persist to disk cache (atomic write)
        void writeXgToDisk(
          competitionId,
          season,
          match.matchId,
          xg.xgHome,
          xg.xgAway,
          sofaMatch.id,
        );

        results.push({
          utcDate:    match.utcDate,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          xgHome:     xg.xgHome,
          xgAway:     xg.xgAway,
        });
        found++;
      }
    }

    const apiFound = found - fromCache;
    console.log(
      `[XgSofaScore] ${competitionId}: ${found}/${matches.length} xG records ` +
      `(${fromCache} from cache, ${apiFound} from API)`,
    );

    return results;
  }
}

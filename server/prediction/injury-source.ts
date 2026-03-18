/**
 * injury-source.ts — Fetcher de bajas/lesionados desde API-Football v3.
 *
 * Endpoint: GET https://v3.football.api-sports.io/injuries
 * Params:   league={leagueId}&season={season}&date={YYYY-MM-DD}
 *
 * Budget: usa af-budget.ts para coordinar con los demás consumidores de APIFOOTBALL_KEY.
 * Cache (injuries): en memoria por (leagueId, season, date) — TTL 6 horas. También en disco (12h).
 * Cache (player stats): en disco por (playerId, season) — TTL 30 días (§SP-V4-12).
 * Fault isolation: cualquier error retorna [] silenciosamente.
 *
 * MKT-T3-01
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isQuotaExhausted,
  consumeRequest,
  markQuotaExhausted,
} from '@sportpulse/canonical';
import type { InjuryRecord, AbsenceType, PlayerPosition } from '@sportpulse/prediction';

// SP-V4-12: Same value as packages/prediction/src/engine/v3/constants.ts MIN_IMPORTANCE_THRESHOLD
// Players with importance < 0.3 are squad depth and excluded from the absence model.
const MIN_IMPORTANCE_THRESHOLD = 0.3;

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
};

// ── Cache ─────────────────────────────────────────────────────────────────────

const MEM_CACHE_TTL_MS  = 6 * 60 * 60 * 1000;  // 6 hours — in-memory
const DISK_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — disk (injuries don't change intra-day)
const CACHE_DIR = path.join(process.cwd(), 'cache', 'injuries');

// §SP-V4-12: Player stats cache — 30 days (stats stable during season)
const PLAYER_STATS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLAYER_STATS_CACHE_DIR = path.join(process.cwd(), 'cache', 'player-stats');

interface CacheEntry {
  records: InjuryRecord[];
  fetchedAt: number;
}

interface DiskCacheDoc {
  version: 1;
  leagueId: number;
  season: number;
  date: string;
  savedAt: string;
  records: InjuryRecord[];
}

// Key: `${leagueId}:${season}:${date}`
const _cache = new Map<string, CacheEntry>();

function cacheKey(leagueId: number, season: number, date: string): string {
  return `${leagueId}:${season}:${date}`;
}

function getCached(leagueId: number, season: number, date: string): InjuryRecord[] | null {
  const key = cacheKey(leagueId, season, date);
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > MEM_CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.records;
}

function setCache(leagueId: number, season: number, date: string, records: InjuryRecord[]): void {
  _cache.set(cacheKey(leagueId, season, date), { records, fetchedAt: Date.now() });
}

function diskCachePath(leagueId: number, season: number, date: string): string {
  return path.join(CACHE_DIR, String(leagueId), String(season), `${date}.json`);
}

function readDiskCache(leagueId: number, season: number, date: string): InjuryRecord[] | null {
  const p = diskCachePath(leagueId, season, date);
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const doc = JSON.parse(raw) as DiskCacheDoc;
    if (doc.version !== 1 || doc.leagueId !== leagueId || doc.season !== season || doc.date !== date) return null;
    if (Date.now() - new Date(doc.savedAt).getTime() > DISK_CACHE_TTL_MS) return null;
    return doc.records;
  } catch {
    return null;
  }
}

function writeDiskCache(leagueId: number, season: number, date: string, records: InjuryRecord[]): void {
  const p = diskCachePath(leagueId, season, date);
  const tmp = `${p}.tmp`;
  const doc: DiskCacheDoc = {
    version: 1,
    leagueId,
    season,
    date,
    savedAt: new Date().toISOString(),
    records,
  };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(doc), 'utf-8');
    fs.renameSync(tmp, p);
  } catch { /* non-fatal */ }
}

// ── Normalization helpers ──────────────────────────────────────────────────────

export function normTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accents
    .replace(/\s+/g, ' ')
    .trim();
}

function mapAbsenceType(type: string, reason: string): AbsenceType {
  const t = type.toLowerCase();
  const r = reason.toLowerCase();
  if (t === 'questionable') return 'DOUBTFUL';
  if (t === 'missing out' || r.includes('suspension')) return 'SUSPENSION';
  return 'INJURY';
}

/**
 * Maps API-Football player position string to PlayerPosition enum.
 * API-Football positions: "Goalkeeper", "Defender", "Midfielder", "Attacker".
 * Fallback: 'MID' when position is unknown or absent.
 */
function mapPositionFromApi(apiPosition: string | undefined): PlayerPosition {
  if (!apiPosition) return 'MID';
  const p = apiPosition.toLowerCase();
  if (p.startsWith('g')) return 'GK';
  if (p.startsWith('d')) return 'DEF';
  if (p.startsWith('a') || p.startsWith('f')) return 'FWD';
  return 'MID';
}

/**
 * Legacy position mapping from reason text (fallback when API doesn't provide position).
 */
function mapPositionFromReason(reason: string): PlayerPosition {
  const r = reason.toLowerCase();
  if (r.includes('goalkeeper') || r.includes(' gk') || r.startsWith('gk')) {
    return 'GK';
  }
  return 'MID';
}

// ── Raw API response types ────────────────────────────────────────────────────

interface AfInjuryEntry {
  player: { id: number; name: string; type?: string };
  team: { id: number; name: string };
  reason: string;
  type: string;
}

interface AfInjuryResponse {
  errors?: Record<string, string>;
  response?: AfInjuryEntry[];
}

// ── Player stats API types (§SP-V4-12) ────────────────────────────────────────

interface AfPlayerStatEntry {
  games?: {
    minutes?: number | null;
    appearences?: number | null;
  };
}

interface AfPlayerStatsResponse {
  errors?: Record<string, string>;
  response?: Array<{
    statistics?: AfPlayerStatEntry[];
  }>;
}

interface PlayerStatsDiskDoc {
  version: 1;
  playerId: number;
  season: number;
  leagueId: number;
  savedAt: string;
  minutesPlayed: number | null;
  gamesPlayed: number | null;
}

// ── Player stats cache functions (§SP-V4-12) ──────────────────────────────────

function playerStatsCachePath(playerId: number, season: number): string {
  return path.join(PLAYER_STATS_CACHE_DIR, String(season), `${playerId}.json`);
}

function readPlayerStatsCache(playerId: number, season: number): PlayerStatsDiskDoc | null {
  const p = playerStatsCachePath(playerId, season);
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const doc = JSON.parse(raw) as PlayerStatsDiskDoc;
    if (doc.version !== 1 || doc.playerId !== playerId || doc.season !== season) return null;
    if (Date.now() - new Date(doc.savedAt).getTime() > PLAYER_STATS_CACHE_TTL_MS) return null;
    return doc;
  } catch {
    return null;
  }
}

function writePlayerStatsCache(playerId: number, season: number, leagueId: number, minutesPlayed: number | null, gamesPlayed: number | null): void {
  const p = playerStatsCachePath(playerId, season);
  const tmp = `${p}.tmp`;
  const doc: PlayerStatsDiskDoc = {
    version: 1,
    playerId,
    season,
    leagueId,
    savedAt: new Date().toISOString(),
    minutesPlayed,
    gamesPlayed,
  };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(doc), 'utf-8');
    fs.renameSync(tmp, p);
  } catch { /* non-fatal */ }
}

/**
 * Fetch player stats from API-Football to derive minutes played.
 * Uses disk cache with 30-day TTL.
 * Returns null on any error (fault isolation).
 * §SP-V4-12
 */
async function fetchPlayerMinutes(
  playerId: number,
  season: number,
  leagueId: number,
  apiKey: string,
): Promise<{ minutesPlayed: number | null; gamesPlayed: number | null }> {
  // Check disk cache first
  const cached = readPlayerStatsCache(playerId, season);
  if (cached !== null) {
    return { minutesPlayed: cached.minutesPlayed, gamesPlayed: cached.gamesPlayed };
  }

  // Budget check before API call
  if (isQuotaExhausted()) {
    return { minutesPlayed: null, gamesPlayed: null };
  }

  const url = `https://v3.football.api-sports.io/players?id=${playerId}&season=${season}&league=${leagueId}`;
  try {
    const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    consumeRequest();
    if (!res.ok) {
      writePlayerStatsCache(playerId, season, leagueId, null, null);
      return { minutesPlayed: null, gamesPlayed: null };
    }
    const data = await res.json() as AfPlayerStatsResponse;

    if (data.errors && Object.keys(data.errors).length > 0) {
      const errVals = Object.values(data.errors);
      if (errVals.some((v) => typeof v === 'string' && v.toLowerCase().includes('limit'))) {
        markQuotaExhausted();
      }
      writePlayerStatsCache(playerId, season, leagueId, null, null);
      return { minutesPlayed: null, gamesPlayed: null };
    }

    const stats = data.response?.[0]?.statistics?.[0];
    const minutesPlayed = stats?.games?.minutes ?? null;
    const gamesPlayed = stats?.games?.appearences ?? null;
    writePlayerStatsCache(playerId, season, leagueId, minutesPlayed, gamesPlayed);
    return { minutesPlayed, gamesPlayed };
  } catch {
    writePlayerStatsCache(playerId, season, leagueId, null, null);
    return { minutesPlayed: null, gamesPlayed: null };
  }
}

/**
 * Derives importance from minutes played.
 * importance = minutesPlayed / (teamGamesPlayed * 90)
 * Returns null if inputs are insufficient.
 * §SP-V4-12
 */
function deriveImportanceFromMinutes(minutesPlayed: number | null, gamesPlayed: number | null): number | null {
  if (minutesPlayed === null || gamesPlayed === null || gamesPlayed <= 0) return null;
  const maxMinutes = gamesPlayed * 90;
  if (maxMinutes <= 0) return null;
  return Math.min(1.0, minutesPlayed / maxMinutes);
}

// ── Main fetch function ───────────────────────────────────────────────────────

async function fetchInjuriesForDate(
  competitionId: string,
  season: number,
  dateIso: string,
  teamNameToId: Map<string, string>,
): Promise<InjuryRecord[]> {
  const leagueId = AF_LEAGUE_IDS[competitionId];
  if (leagueId === undefined) {
    // Competition not mapped — skip silently
    return [];
  }

  // Level 1: in-memory cache
  const cached = getCached(leagueId, season, dateIso);
  if (cached !== null) return cached;

  // Level 2: disk cache (survives restarts)
  const fromDisk = readDiskCache(leagueId, season, dateIso);
  if (fromDisk !== null) {
    setCache(leagueId, season, dateIso, fromDisk);
    return fromDisk;
  }

  // Budget check before hitting API
  if (isQuotaExhausted()) {
    console.log(`[InjurySource] Quota exhausted — skipping fetch for ${competitionId} ${dateIso}`);
    return [];
  }

  const apiKey = process.env.APIFOOTBALL_KEY ?? '';
  if (!apiKey) {
    return [];
  }

  const url = `https://v3.football.api-sports.io/injuries?league=${leagueId}&season=${season}&date=${dateIso}`;

  let data: AfInjuryResponse;
  try {
    const res = await fetch(url, {
      headers: { 'x-apisports-key': apiKey },
    });
    consumeRequest();

    if (!res.ok) {
      console.warn(`[InjurySource] HTTP ${res.status} for ${competitionId} ${dateIso}`);
      setCache(leagueId, season, dateIso, []);
      return [];
    }

    data = await res.json() as AfInjuryResponse;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[InjurySource] fetch error for ${competitionId} ${dateIso}: ${msg}`);
    setCache(leagueId, season, dateIso, []);
    return [];
  }

  // Detect quota exhaustion from API body
  if (data.errors && typeof data.errors === 'object') {
    const errVals = Object.values(data.errors);
    if (errVals.some((v) => typeof v === 'string' && v.toLowerCase().includes('limit'))) {
      markQuotaExhausted();
      setCache(leagueId, season, dateIso, []);
      return [];
    }
  }

  const entries = data.response ?? [];
  const records: InjuryRecord[] = [];

  for (const entry of entries) {
    const normedTeam = normTeamName(entry.team?.name ?? '');
    const teamId = teamNameToId.get(normedTeam);
    if (!teamId) continue; // no match — skip

    const reason = entry.reason ?? '';
    const absenceType = mapAbsenceType(entry.type ?? '', reason);

    // §SP-V4-13: get position from API response if available, else fall back to reason text
    const apiPosition = entry.player?.type;  // API-Football: player.type = "Goalkeeper", "Defender", etc.
    const position: PlayerPosition = apiPosition
      ? mapPositionFromApi(apiPosition)
      : mapPositionFromReason(reason);

    // §SP-V4-12: Fetch player stats to derive importance from real minutes played
    let importance: number;
    let minutesPlayed: number | undefined;

    const playerId = entry.player?.id;
    if (playerId && apiKey) {
      const statsResult = await fetchPlayerMinutes(playerId, season, leagueId, apiKey);
      const derivedImportance = deriveImportanceFromMinutes(statsResult.minutesPlayed, statsResult.gamesPlayed);
      if (derivedImportance !== null) {
        // Skip players below the importance threshold (squad depth)
        if (derivedImportance < MIN_IMPORTANCE_THRESHOLD) {
          continue;
        }
        importance = derivedImportance;
        minutesPlayed = statsResult.minutesPlayed ?? undefined;
      } else {
        // Fallback to position-based static importance
        importance = position === 'GK' ? 0.75 : 0.6;
      }
    } else {
      // No player ID or no API key — use static fallback
      importance = position === 'GK' ? 0.75 : 0.6;
    }

    records.push({
      teamId,
      playerName: entry.player?.name ?? 'Unknown',
      position,
      absenceType,
      importance,
      minutesPlayed,
    });
  }

  console.log(`[InjurySource] ${competitionId} ${dateIso}: ${records.length} injuries fetched (${entries.length} raw entries)`);
  setCache(leagueId, season, dateIso, records);
  writeDiskCache(leagueId, season, dateIso, records);
  return records;
}

// ── InjurySource class ────────────────────────────────────────────────────────

export class InjurySource {
  /**
   * Returns InjuryRecord[] for the home and away teams of a specific match.
   * Always returns [] on any error or missing configuration — never propagates.
   *
   * @param competitionId  Canonical competition ID (e.g. 'comp:football-data:PD')
   * @param kickoffUtc     ISO-8601 UTC kickoff — date part is extracted as YYYY-MM-DD
   * @param homeTeamId     Canonical home team ID
   * @param awayTeamId     Canonical away team ID
   * @param teamNameToId   Map of normTeamName(teamName) → canonicalTeamId
   */
  async getInjuriesForMatch(
    competitionId: string,
    kickoffUtc: string,
    homeTeamId: string,
    awayTeamId: string,
    teamNameToId: Map<string, string>,
  ): Promise<InjuryRecord[]> {
    try {
      if (!process.env.APIFOOTBALL_KEY) return [];

      // Extract YYYY-MM-DD from kickoffUtc (UTC date — matches the API's date param)
      const dateIso = kickoffUtc.slice(0, 10);

      // Derive season year from kickoff date (before July = previous year start)
      const kickoffYear = new Date(kickoffUtc).getUTCFullYear();
      const kickoffMonth = new Date(kickoffUtc).getUTCMonth(); // 0-indexed
      const season = kickoffMonth < 6 ? kickoffYear - 1 : kickoffYear;

      const all = await fetchInjuriesForDate(competitionId, season, dateIso, teamNameToId);

      // Filter to only the two teams in this match
      return all.filter((r) => r.teamId === homeTeamId || r.teamId === awayTeamId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[InjurySource] getInjuriesForMatch error (${competitionId}): ${msg}`);
      return [];
    }
  }
}

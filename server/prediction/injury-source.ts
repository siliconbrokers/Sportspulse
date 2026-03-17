/**
 * injury-source.ts — Fetcher de bajas/lesionados desde API-Football v3.
 *
 * Endpoint: GET https://v3.football.api-sports.io/injuries
 * Params:   league={leagueId}&season={season}&date={YYYY-MM-DD}
 *
 * Budget: usa af-budget.ts para coordinar con los demás consumidores de APIFOOTBALL_KEY.
 * Cache: en memoria por (leagueId, season, date) — TTL 6 horas. Nunca en disco.
 * Fault isolation: cualquier error retorna [] silenciosamente.
 *
 * MKT-T3-01
 */

import {
  isQuotaExhausted,
  consumeRequest,
  markQuotaExhausted,
} from '../af-budget.js';
import type { InjuryRecord, AbsenceType, PlayerPosition } from '@sportpulse/prediction';

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

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry {
  records: InjuryRecord[];
  fetchedAt: number;
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
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.records;
}

function setCache(leagueId: number, season: number, date: string, records: InjuryRecord[]): void {
  _cache.set(cacheKey(leagueId, season, date), { records, fetchedAt: Date.now() });
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

function mapPosition(reason: string): { position: PlayerPosition; importance: number } {
  const r = reason.toLowerCase();
  if (r.includes('goalkeeper') || r.includes(' gk') || r.startsWith('gk')) {
    return { position: 'GK', importance: 0.75 };
  }
  return { position: 'MID', importance: 0.6 };
}

// ── Raw API response types ────────────────────────────────────────────────────

interface AfInjuryEntry {
  player: { id: number; name: string };
  team: { id: number; name: string };
  reason: string;
  type: string;
}

interface AfInjuryResponse {
  errors?: Record<string, string>;
  response?: AfInjuryEntry[];
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

  // Check in-memory cache
  const cached = getCached(leagueId, season, dateIso);
  if (cached !== null) {
    return cached;
  }

  // Budget check
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
    const { position, importance } = mapPosition(reason);

    records.push({
      teamId,
      playerName: entry.player?.name ?? 'Unknown',
      position,
      absenceType,
      importance,
    });
  }

  console.log(`[InjurySource] ${competitionId} ${dateIso}: ${records.length} injuries fetched (${entries.length} raw entries)`);
  setCache(leagueId, season, dateIso, records);
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

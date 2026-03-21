/**
 * historical-match-loader-sportsdb.ts — disk-cached loader for TheSportsDB historical matches.
 *
 * Fetches FINISHED matches from TheSportsDB API v1 for a given league and
 * normalizes them into FinishedMatchRecord objects for Elo replay.
 *
 * Used for Liga Uruguaya (leagueId=4432) which uses TheSportsDB as provider
 * instead of football-data.org.
 *
 * Season format: calendar year (2024 = season 2024). Boundary: Jan 1.
 *
 * Cache: cache/historical/thesportsdb/{leagueId}/{year}.json
 * Atomic write: .tmp → rename (consistent with matchday-cache pattern)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { teamId as canonicalTeamId } from '@sportpulse/canonical';
import type { FinishedMatchRecord } from '@sportpulse/prediction';
import { CACHE_BASE } from '../cache-dir.js';

// ── Provider ─────────────────────────────────────────────────────────────────

export const SPORTSDB_PROVIDER_KEY = 'thesportsdb';

// ── Raw API types ─────────────────────────────────────────────────────────────

interface SDBEvent {
  idEvent: string;
  idHomeTeam: string;
  idAwayTeam: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
  dateEvent: string;   // "YYYY-MM-DD"
  strTime: string;     // "HH:MM:SS" UTC
  strStatus: string;   // "Match Finished" | "Not Started" | etc.
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheDoc {
  version: 1;
  leagueId: string;
  year: number;
  fetchedAt: string;
  matches: FinishedMatchRecord[];
}

const PAST_SEASON_TTL_MS    = 365 * 24 * 3600_000;
const CURRENT_SEASON_TTL_MS = 6 * 3600_000;

const HISTORICAL_CACHE_BASE = path.join(CACHE_BASE, 'historical', SPORTSDB_PROVIDER_KEY);

function cachePath(leagueId: string, year: number): string {
  return path.join(HISTORICAL_CACHE_BASE, leagueId, `${year}.json`);
}

function readCache(leagueId: string, year: number): CacheDoc | null {
  const p = cachePath(leagueId, year);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    const doc = JSON.parse(raw) as unknown;
    if (
      doc !== null &&
      typeof doc === 'object' &&
      (doc as Record<string, unknown>)['version'] === 1 &&
      Array.isArray((doc as Record<string, unknown>)['matches'])
    ) {
      return doc as CacheDoc;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(leagueId: string, year: number, matches: FinishedMatchRecord[]): void {
  const p = cachePath(leagueId, year);
  const tmpPath = p.replace(/\.json$/, '.tmp');
  const doc: CacheDoc = {
    version: 1,
    leagueId,
    year,
    fetchedAt: new Date().toISOString(),
    matches,
  };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
    fs.renameSync(tmpPath, p);
  } catch (err) {
    console.error(`[SportsDBLoader] cache write failed for ${leagueId}/${year}:`, err);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

function isCacheFresh(doc: CacheDoc, year: number, currentYear: number): boolean {
  const ttl = year < currentYear ? PAST_SEASON_TTL_MS : CURRENT_SEASON_TTL_MS;
  const age = Date.now() - new Date(doc.fetchedAt).getTime();
  return age < ttl;
}

// ── API fetch ─────────────────────────────────────────────────────────────────

async function fetchFinishedMatchesFromApi(
  apiKey: string,
  baseUrl: string,
  leagueId: string,
  year: number,
): Promise<FinishedMatchRecord[]> {
  const url = `${baseUrl}/${apiKey}/eventsseason.php?id=${leagueId}&s=${year}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TheSportsDB ${res.status}: ${url}`);
  }

  const body = (await res.json()) as { events: SDBEvent[] | null };
  const events: SDBEvent[] = body.events ?? [];

  const records: FinishedMatchRecord[] = [];
  for (const e of events) {
    if (e.intHomeScore === null || e.intAwayScore === null) continue;
    if (!e.strStatus.toLowerCase().includes('finished')) continue;
    if (!e.dateEvent || !e.strTime) continue;

    const homeGoals = parseInt(e.intHomeScore, 10);
    const awayGoals = parseInt(e.intAwayScore, 10);
    if (isNaN(homeGoals) || isNaN(awayGoals)) continue;

    records.push({
      homeTeamId: canonicalTeamId(SPORTSDB_PROVIDER_KEY, e.idHomeTeam),
      awayTeamId: canonicalTeamId(SPORTSDB_PROVIDER_KEY, e.idAwayTeam),
      utcDate: `${e.dateEvent}T${e.strTime}Z`,
      homeGoals,
      awayGoals,
    });
  }

  return records;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SportsDBLoaderOptions {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Loads historical FINISHED matches for a TheSportsDB league across multiple seasons.
 *
 * @param leagueId            TheSportsDB league ID, e.g. '4432' for Liga Uruguaya
 * @param currentSeasonYear   Calendar year of the current season (e.g. 2024)
 * @param options             API credentials
 */
export async function loadHistoricalMatchesSportsDB(
  leagueId: string,
  currentSeasonYear: number,
  options: SportsDBLoaderOptions,
): Promise<FinishedMatchRecord[]> {
  const baseUrl = options.baseUrl ?? 'https://www.thesportsdb.com/api/v1/json';
  const allRecords: FinishedMatchRecord[] = [];

  // Load current year + 2 past years for Elo history
  const years = [currentSeasonYear, currentSeasonYear - 1, currentSeasonYear - 2];

  for (const year of years) {
    const cached = readCache(leagueId, year);

    if (cached && isCacheFresh(cached, year, currentSeasonYear)) {
      console.log(
        `[SportsDBLoader] CACHE HIT ${leagueId}/${year}: ${cached.matches.length} matches`,
      );
      allRecords.push(...cached.matches);
      continue;
    }

    try {
      const fetched = await fetchFinishedMatchesFromApi(options.apiKey, baseUrl, leagueId, year);
      console.log(
        `[SportsDBLoader] API FETCH ${leagueId}/${year}: ${fetched.length} matches`,
      );
      writeCache(leagueId, year, fetched);
      allRecords.push(...fetched);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SportsDBLoader] API failed ${leagueId}/${year}: ${msg}`);

      if (cached) {
        console.warn(`[SportsDBLoader] Using stale cache ${leagueId}/${year}`);
        allRecords.push(...cached.matches);
      }
    }
  }

  allRecords.sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  return allRecords;
}

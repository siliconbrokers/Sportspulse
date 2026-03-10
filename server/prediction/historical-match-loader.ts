/**
 * historical-match-loader.ts — disk-cached loader for historical finished matches.
 *
 * Fetches FINISHED matches from football-data.org for past seasons and
 * normalizes them into FinishedMatchRecord objects for Elo replay.
 *
 * Cache strategy:
 * - Past seasons (year < current): immutable → 1-year TTL (never re-fetched in practice)
 * - Current season: re-fetched periodically (TTL 6 hours) — finished matches accumulate
 * - Cache location: cache/historical/football-data/{competitionCode}/{year}.json
 * - Atomic write: .tmp → rename (consistent with matchday-cache pattern)
 *
 * Seasons loaded: current year + previous 2 years (≈ 3 seasons ≈ 36–38*3 matches/comp)
 *
 * H2 — Historical Team State Backbone
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { teamId as canonicalTeamId, PROVIDER_KEY } from '@sportpulse/canonical';
import type { FDMatchResponse } from '@sportpulse/canonical';
import type { FinishedMatchRecord } from '@sportpulse/prediction';

// ── Types ──────────────────────────────────────────────────────────────────

interface CacheDoc {
  version: 1;
  competitionCode: string;
  year: number;
  fetchedAt: string;
  matches: FinishedMatchRecord[];
}

// ── Constants ──────────────────────────────────────────────────────────────

/** How many past seasons to load in addition to the current. */
const PAST_SEASONS_COUNT = 2;

/** TTL for current season data (6 hours — new matches finish regularly). */
const CURRENT_SEASON_TTL_MS = 6 * 3600_000;

/** TTL for past season data (1 year — data is immutable once season ends). */
const PAST_SEASON_TTL_MS = 365 * 24 * 3600_000;

const CACHE_BASE = path.resolve(process.cwd(), 'cache/historical', PROVIDER_KEY);

// ── Cache I/O helpers ──────────────────────────────────────────────────────

function cachePath(competitionCode: string, year: number): string {
  return path.join(CACHE_BASE, competitionCode, `${year}.json`);
}

function readCache(competitionCode: string, year: number): CacheDoc | null {
  const p = cachePath(competitionCode, year);
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

function writeCache(competitionCode: string, year: number, matches: FinishedMatchRecord[]): void {
  const p = cachePath(competitionCode, year);
  const tmpPath = p.replace(/\.json$/, '.tmp');
  const doc: CacheDoc = {
    version: 1,
    competitionCode,
    year,
    fetchedAt: new Date().toISOString(),
    matches,
  };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
    fs.renameSync(tmpPath, p);
  } catch (err) {
    console.error(`[HistoricalLoader] cache write failed for ${competitionCode}/${year}:`, err);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

function isCacheFresh(doc: CacheDoc, year: number, currentYear: number): boolean {
  const ttl = year < currentYear ? PAST_SEASON_TTL_MS : CURRENT_SEASON_TTL_MS;
  const age = Date.now() - new Date(doc.fetchedAt).getTime();
  return age < ttl;
}

// ── FD API fetch ───────────────────────────────────────────────────────────

async function fetchFinishedMatchesFromApi(
  apiToken: string,
  baseUrl: string,
  competitionCode: string,
  year: number,
): Promise<FinishedMatchRecord[]> {
  const url = `${baseUrl}/competitions/${competitionCode}/matches?season=${year}&status=FINISHED`;

  const res = await fetch(url, {
    headers: { 'X-Auth-Token': apiToken },
  });

  if (!res.ok) {
    throw new Error(`football-data.org ${res.status}: ${url}`);
  }

  const body = (await res.json()) as { matches: FDMatchResponse[] };
  const fdMatches: FDMatchResponse[] = body.matches ?? [];

  const records: FinishedMatchRecord[] = [];
  for (const fd of fdMatches) {
    // Only include matches with valid scores
    if (
      fd.score.fullTime.home === null ||
      fd.score.fullTime.away === null
    ) {
      continue;
    }
    records.push({
      homeTeamId: canonicalTeamId(PROVIDER_KEY, String(fd.homeTeam.id)),
      awayTeamId: canonicalTeamId(PROVIDER_KEY, String(fd.awayTeam.id)),
      utcDate: fd.utcDate,
      homeGoals: fd.score.fullTime.home,
      awayGoals: fd.score.fullTime.away,
    });
  }

  return records;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface HistoricalLoaderOptions {
  apiToken: string;
  baseUrl?: string;
}

/**
 * Loads historical FINISHED matches for a competition across multiple seasons.
 *
 * Returns a flat array of FinishedMatchRecord sorted chronologically.
 * Uses disk cache to avoid redundant API calls.
 *
 * @param competitionCode  FD competition code, e.g. 'PD', 'PL', 'BL1'
 * @param currentSeasonStartYear  Start year of the current season (e.g. 2025 for 2025-26)
 * @param options  API credentials
 */
export async function loadHistoricalMatches(
  competitionCode: string,
  currentSeasonStartYear: number,
  options: HistoricalLoaderOptions,
): Promise<FinishedMatchRecord[]> {
  const baseUrl = options.baseUrl ?? 'https://api.football-data.org/v4';
  const allRecords: FinishedMatchRecord[] = [];

  const years = Array.from(
    { length: PAST_SEASONS_COUNT + 1 },
    (_, i) => currentSeasonStartYear - i,
  );

  for (const year of years) {
    const cached = readCache(competitionCode, year);

    if (cached && isCacheFresh(cached, year, currentSeasonStartYear)) {
      console.log(
        `[HistoricalLoader] CACHE HIT ${competitionCode}/${year}: ${cached.matches.length} matches`,
      );
      allRecords.push(...cached.matches);
      continue;
    }

    try {
      const fetched = await fetchFinishedMatchesFromApi(
        options.apiToken,
        baseUrl,
        competitionCode,
        year,
      );
      console.log(
        `[HistoricalLoader] API FETCH ${competitionCode}/${year}: ${fetched.length} matches`,
      );
      writeCache(competitionCode, year, fetched);
      allRecords.push(...fetched);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[HistoricalLoader] API failed ${competitionCode}/${year}: ${msg}`);

      // Fall back to stale cache if available
      if (cached) {
        console.warn(`[HistoricalLoader] Using stale cache ${competitionCode}/${year}`);
        allRecords.push(...cached.matches);
      }
    }
  }

  // Sort chronologically — deterministic output regardless of fetch order
  allRecords.sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  return allRecords;
}

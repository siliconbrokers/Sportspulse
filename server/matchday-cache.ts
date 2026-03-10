/**
 * Matchday Local File Cache
 * Implements: matchday-cache-technical-spec.md v1.0
 *
 * File format: /cache/{provider}/{competitionId}/{season}/matchday-{NN}.json
 * Each file is atomic-written (tmp → rename) and validated on read.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Match, Team } from '@sportpulse/canonical';

// ── Types (§9) ────────────────────────────────────────────────────────────────

export type MatchdayStatus = 'scheduled' | 'live' | 'finished' | 'mixed' | 'unknown';

export interface MatchdayCacheMeta {
  cacheVersion: 1;
  provider: string;
  competitionId: string;
  season: string;
  matchday: number;
  retrievedAt: string; // ISO UTC
  status: MatchdayStatus;
  ttlSeconds: number;
  matchesCount: number;
  isComplete: boolean;
  sourceChecksum: string | null;
  lastValidationAt: string | null;
}

export interface MatchdayCacheDoc {
  meta: MatchdayCacheMeta;
  data: { matches: Match[] };
}

// ── Constants (§12.1) ─────────────────────────────────────────────────────────

const TTL_SECONDS: Record<MatchdayStatus, number> = {
  finished: 31_536_000,
  scheduled:  21_600,
  live:           60,
  mixed:         300,
  unknown:       120,
};

const CACHE_BASE = path.join(process.cwd(), 'cache');

// ── Path (§7) ─────────────────────────────────────────────────────────────────

/** Builds the deterministic cache file path for a given matchday. */
export function buildCachePath(
  provider: string,
  competitionId: string,
  season: string,
  matchday: number,
): string {
  const md = String(matchday).padStart(2, '0');
  return path.join(CACHE_BASE, provider, competitionId, season, `matchday-${md}.json`);
}

// ── Status resolution (§11) ───────────────────────────────────────────────────

// Canonical Match.status values that represent an in-progress match.
// classifyStatus() maps all provider live variants to IN_PROGRESS.
const LIVE_STATUSES = new Set(['IN_PROGRESS']);

/** Derives the global matchday status from the set of match statuses. §11.1 */
export function resolveGlobalStatus(matches: Match[]): MatchdayStatus {
  if (matches.length === 0) return 'unknown';

  const hasLive      = matches.some(m => LIVE_STATUSES.has(m.status));
  const hasFinished  = matches.some(m => m.status === 'FINISHED');
  const hasScheduled = matches.some(m => m.status === 'SCHEDULED');

  if (!hasLive && !hasScheduled && matches.every(m => m.status === 'FINISHED')) {
    // All matches finished, but if any lack scores the provider hasn't populated them yet.
    // Treat as 'mixed' (5 min TTL) until all scores arrive — prevents permanent caching
    // of incomplete data (e.g. TheSportsDB reports FINISHED before populating scores).
    const hasNullScore = matches.some(m => m.scoreHome === null || m.scoreAway === null);
    return hasNullScore ? 'mixed' : 'finished';
  }
  if (!hasLive && !hasFinished  && matches.every(m => m.status === 'SCHEDULED')) return 'scheduled';
  // Any live match → use live TTL regardless of other statuses in the matchday.
  // Previously this fell into 'mixed' (5min TTL) which caused stale scores during live matches.
  if (hasLive) return 'live';
  if (hasFinished || hasScheduled) return 'mixed';
  return 'unknown';
}

/** Returns the mandatory TTL for the given global status. §12.1 */
export function resolveTTL(status: MatchdayStatus): number {
  return TTL_SECONDS[status];
}

// ── Read / validate (§13, §14, §15) ──────────────────────────────────────────

/** Reads and JSON-parses a cache file. Returns null if missing or unparseable. */
export function readCacheFile(cachePath: string): unknown {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Validates structure, identity, and completeness. §13.1
 * Returns true only if all conditions in §13.1 pass.
 */
export function isValidCacheDoc(
  doc: unknown,
  provider: string,
  competitionId: string,
  season: string,
  matchday: number,
): doc is MatchdayCacheDoc {
  if (!doc || typeof doc !== 'object') return false;
  const { meta, data } = doc as Record<string, unknown>;
  if (!meta || typeof meta !== 'object') return false;
  if (!data || typeof data !== 'object') return false;

  const m = meta as Record<string, unknown>;
  if (m['provider'] !== provider) return false;
  if (m['competitionId'] !== competitionId) return false;
  if (m['season'] !== season) return false;
  if (m['matchday'] !== matchday) return false;
  if (m['isComplete'] !== true) return false;

  const d = data as Record<string, unknown>;
  if (!Array.isArray(d['matches'])) return false;
  const arr = d['matches'] as unknown[];
  if (typeof m['matchesCount'] !== 'number' || m['matchesCount'] !== arr.length) return false;

  // Minimum required fields per match (§13.1 last bullet)
  for (const item of arr) {
    if (!item || typeof item !== 'object') return false;
    const match = item as Record<string, unknown>;
    if (typeof match['matchId'] !== 'string') return false;
    if (typeof match['status'] !== 'string') return false;
    if (typeof match['homeTeamId'] !== 'string') return false;
    if (typeof match['awayTeamId'] !== 'string') return false;
  }

  return true;
}

/** Returns true if the cache file is still within its TTL. §14 */
export function isCacheFresh(meta: MatchdayCacheMeta): boolean {
  const retrievedAt = new Date(meta.retrievedAt).getTime();
  return Date.now() < retrievedAt + meta.ttlSeconds * 1000;
}

// ── Atomic write (§16) ────────────────────────────────────────────────────────

/**
 * Writes a matchday cache file atomically: serialize → .tmp → rename.
 * §16.1: Never writes directly into the final file path.
 */
export function writeCacheFile(
  cachePath: string,
  provider: string,
  competitionId: string,
  season: string,
  matchday: number,
  matches: Match[],
): void {
  const status = resolveGlobalStatus(matches);
  const ttl = resolveTTL(status);

  const doc: MatchdayCacheDoc = {
    meta: {
      cacheVersion: 1,
      provider,
      competitionId,
      season,
      matchday,
      retrievedAt: new Date().toISOString(),
      status,
      ttlSeconds: ttl,
      matchesCount: matches.length,
      isComplete: true,
      sourceChecksum: null,
      lastValidationAt: null,
    },
    data: { matches },
  };

  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = cachePath.replace(/\.json$/, '.tmp');
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
    fs.renameSync(tmpPath, cachePath);
  } catch (err) {
    // §18.3: final file must remain untouched on temp-write failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// ── Logging (§17) ─────────────────────────────────────────────────────────────

export type CacheLogEvent =
  | 'CACHE_HIT'
  | 'CACHE_MISS'
  | 'CACHE_INVALID'
  | 'CACHE_STALE'
  | 'CACHE_WRITE_SUCCESS'
  | 'CACHE_WRITE_ERROR'
  | 'CACHE_API_FETCH'
  | 'CACHE_API_ERROR'
  | 'CACHE_STALE_FALLBACK';

export interface CacheLogCtx {
  event: CacheLogEvent;
  provider: string;
  competitionId: string;
  season: string;
  matchday: number;
  cachePath: string;
  status?: string;
  retrievedAt?: string;
}

/** Emits a structured cache log entry. §17.1 + §17.2 */
export function logCache(ctx: CacheLogCtx): void {
  const parts: string[] = [
    `[MatchdayCache] ${ctx.event}`,
    `provider=${ctx.provider}`,
    `comp=${ctx.competitionId}`,
    `season=${ctx.season}`,
    `md=${ctx.matchday}`,
    `path=${ctx.cachePath}`,
  ];
  if (ctx.status) parts.push(`status=${ctx.status}`);
  if (ctx.retrievedAt) parts.push(`retrievedAt=${ctx.retrievedAt}`);
  console.log(parts.join(' '));
}

// ── Per-matchday cache flow (§15.1 adapted) ───────────────────────────────────

/**
 * Runs the mandatory read flow for a single matchday (§15.1).
 *
 * Returns:
 *   - { hit: true, matches } if a valid, complete, fresh cache exists
 *   - { hit: false }         otherwise (caller must use API data + call writeMatchdayCache)
 */
export function checkMatchdayCache(
  provider: string,
  competitionId: string,
  season: string,
  matchday: number,
): { hit: true; matches: Match[] } | { hit: false } {
  const cachePath = buildCachePath(provider, competitionId, season, matchday);

  const raw = readCacheFile(cachePath);

  if (raw === null) {
    logCache({ event: 'CACHE_MISS', provider, competitionId, season, matchday, cachePath });
    return { hit: false };
  }

  if (!isValidCacheDoc(raw, provider, competitionId, season, matchday)) {
    logCache({ event: 'CACHE_INVALID', provider, competitionId, season, matchday, cachePath });
    return { hit: false };
  }

  const meta = raw.meta;

  if (!isCacheFresh(meta)) {
    logCache({ event: 'CACHE_STALE', provider, competitionId, season, matchday, cachePath, status: meta.status, retrievedAt: meta.retrievedAt });
    return { hit: false };
  }

  logCache({ event: 'CACHE_HIT', provider, competitionId, season, matchday, cachePath, status: meta.status, retrievedAt: meta.retrievedAt });
  return { hit: true, matches: raw.data.matches };
}

// ── Teams file cache ──────────────────────────────────────────────────────────
// Stores canonical Team[] on disk so server restarts can recover team data
// without needing a fresh API call (TTL matches in-memory TTL: 7 days).

const TEAMS_CACHE_TTL_S = 7 * 24 * 3600; // 7 days

function teamsFilePath(provider: string, competitionId: string): string {
  return path.join(CACHE_BASE, provider, competitionId, 'teams.json');
}

// ── Standings file cache ──────────────────────────────────────────────────────

import type { StandingEntry } from '@sportpulse/snapshot';

const STANDINGS_CACHE_TTL_S = 24 * 3600; // 1 day (standings change with matches)

function standingsFilePath(provider: string, competitionId: string): string {
  return path.join(CACHE_BASE, provider, competitionId, 'standings.json');
}

export function persistStandingsCache(provider: string, competitionId: string, standings: StandingEntry[]): void {
  if (standings.length === 0) return; // never persist empty standings
  const filePath = standingsFilePath(provider, competitionId);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ retrievedAt: new Date().toISOString(), standings }, null, 0));
    fs.renameSync(tmp, filePath);
  } catch {
    // Non-fatal
  }
}

export function loadStandingsCache(provider: string, competitionId: string): StandingEntry[] | null {
  const filePath = standingsFilePath(provider, competitionId);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { retrievedAt: string; standings: StandingEntry[] };
    const ageS = (Date.now() - new Date(raw.retrievedAt).getTime()) / 1000;
    if (ageS > STANDINGS_CACHE_TTL_S) return null; // stale
    return raw.standings;
  } catch {
    return null;
  }
}

export function persistTeamsCache(provider: string, competitionId: string, teams: Team[]): void {
  const filePath = teamsFilePath(provider, competitionId);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ retrievedAt: new Date().toISOString(), teams }, null, 0));
    fs.renameSync(tmp, filePath);
  } catch {
    // Non-fatal — next successful API call will overwrite
  }
}

export function loadTeamsCache(provider: string, competitionId: string): Team[] | null {
  const filePath = teamsFilePath(provider, competitionId);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { retrievedAt: string; teams: Team[] };
    const ageS = (Date.now() - new Date(raw.retrievedAt).getTime()) / 1000;
    if (ageS > TEAMS_CACHE_TTL_S) return null; // stale
    return raw.teams;
  } catch {
    return null;
  }
}

// ── Comp-info file cache ───────────────────────────────────────────────────────
// Stores season string and seasonId so comp-info API is not called on every restart.

export interface CompInfoCacheDoc {
  retrievedAt: string;
  season: string;   // human-readable, e.g. "2025-26"
  seasonId: string; // canonical, e.g. "season:football-data:2341"
}

const COMP_INFO_CACHE_TTL_S = 7 * 24 * 3600; // matches in-memory COMP_INFO_TTL_MS

function compInfoFilePath(provider: string, competitionId: string): string {
  return path.join(CACHE_BASE, provider, competitionId, 'comp-info.json');
}

export function persistCompInfoCache(
  provider: string,
  competitionId: string,
  info: Omit<CompInfoCacheDoc, 'retrievedAt'>,
): void {
  const filePath = compInfoFilePath(provider, competitionId);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ retrievedAt: new Date().toISOString(), ...info }, null, 0));
    fs.renameSync(tmp, filePath);
  } catch {
    // Non-fatal
  }
}

export function loadCompInfoCache(
  provider: string,
  competitionId: string,
): CompInfoCacheDoc | null {
  const filePath = compInfoFilePath(provider, competitionId);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CompInfoCacheDoc;
    const ageS = (Date.now() - new Date(raw.retrievedAt).getTime()) / 1000;
    if (ageS > COMP_INFO_CACHE_TTL_S) return null; // stale
    if (!raw.season || !raw.seasonId) return null;  // invalid
    return raw;
  } catch {
    return null;
  }
}

/** Returns true if at least one matchday JSON file exists for the given season directory. */
export function hasMatchdayCacheForSeason(
  provider: string,
  competitionId: string,
  season: string,
): boolean {
  const seasonDir = path.join(CACHE_BASE, provider, competitionId, season);
  try {
    const files = fs.readdirSync(seasonDir);
    return files.some((f) => f.startsWith('matchday-') && f.endsWith('.json'));
  } catch {
    return false;
  }
}

/**
 * Loads all matches from every matchday JSON file for a given season.
 * Used to reconstruct the in-memory match history after a server restart,
 * avoiding a full-season API fetch when files already exist on disk.
 * No TTL check — freshness is handled by the subsequent window fetch merge.
 */
export function loadAllMatchdaysForSeason(
  provider: string,
  competitionId: string,
  season: string,
): Match[] {
  const seasonDir = path.join(CACHE_BASE, provider, competitionId, season);
  const result: Match[] = [];
  try {
    const files = fs.readdirSync(seasonDir);
    for (const file of files) {
      if (!file.startsWith('matchday-') || !file.endsWith('.json')) continue;
      const filePath = path.join(seasonDir, file);
      const raw = readCacheFile(filePath) as Record<string, unknown> | null;
      if (!raw) continue;
      const data = raw['data'] as Record<string, unknown> | undefined;
      if (!data) continue;
      const matches = data['matches'];
      if (!Array.isArray(matches)) continue;
      result.push(...(matches as Match[]));
    }
  } catch {
    // Directory doesn't exist or unreadable — return empty
  }
  return result;
}

/**
 * Writes a matchday cache file and logs the result.
 * Call after a successful API fetch + normalization.
 */
export function persistMatchdayCache(
  provider: string,
  competitionId: string,
  season: string,
  matchday: number,
  matches: Match[],
): void {
  const cachePath = buildCachePath(provider, competitionId, season, matchday);
  const status = resolveGlobalStatus(matches);
  try {
    writeCacheFile(cachePath, provider, competitionId, season, matchday, matches);
    logCache({ event: 'CACHE_WRITE_SUCCESS', provider, competitionId, season, matchday, cachePath, status });
  } catch (err) {
    logCache({ event: 'CACHE_WRITE_ERROR', provider, competitionId, season, matchday, cachePath });
    console.error('[MatchdayCache] Write failed:', err);
  }
}

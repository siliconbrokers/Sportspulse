/**
 * NEXUS Temporal Feature Store — xG Feature Integration
 *
 * Spec authority: NEXUS-0 S4.2, S6.2.2, S5.2 (confidence assignment)
 *
 * SOURCE HIERARCHY FOR xG (S4.2):
 *   1. API-Football backfill (PRIMARY)  → confidence: HIGH
 *   2. SofaScore MCP (SECONDARY)        → confidence: MEDIUM
 *   3. Poisson estimate (FALLBACK)      → NOT a real measurement, confidence: LOW
 *
 * This module handles source #1: loading xG from the backfill cache at
 * cache/xg/{afLeagueId}/{year}/{fixtureId}.json
 *
 * xG MISSINGNESS RULES (S6.2.2):
 *   - If no xG file exists for a fixture → value = MISSING (never 0.0)
 *   - If xG file exists but a specific team value is null/absent → MISSING
 *   - xgDataAvailable boolean flag signals presence/absence for consumers
 *   - XG_FALLBACK_ACTUAL_GOALS is logged when xG absent (not imputed with league avg)
 *
 * PROVENANCE:
 *   - source_id: 'api-football'
 *   - effectiveAt: the match utcDate (historical fact — xG is a match result)
 *   - confidence: HIGH for backfill data (cross-validated, S5.2)
 *   - freshness: computed at query time (buildNowUtc - ingestedAt)
 *
 * IMPORTANT: This module does NOT perform anti-lookahead filtering. The caller
 * is responsible for applying applyAntiLookaheadGuard() after building the
 * FeatureSnapshot. xG for historical matches always has effectiveAt < buildNowUtc
 * for pre-match predictions, but the guard must still be applied.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { MISSING } from './types.js';
import type { FeatureValue, FeatureProvenance, XgMatchData, MissingValue } from './types.js';

// ── AF League ID mapping (per MEMORY.md, tools/xg-backfill-af.ts) ────────

/**
 * Maps SportPulse competition codes to API-Football league IDs.
 * Used to build the cache path: cache/xg/{afLeagueId}/{year}/{fixtureId}.json
 */
export const AF_LEAGUE_IDS: Readonly<Record<string, number>> = {
  PD: 140, // LaLiga
  PL: 39, // Premier League
  BL1: 78, // Bundesliga
  SA: 135, // Serie A
  FL1: 61, // Ligue 1
  // AF-canonical leagues registered in portal (competition-registry.ts)
  URU: 268, // Fútbol Uruguayo
  ARG: 128, // Liga Argentina
  MX: 262, // Liga MX
  BR: 71, // Brasileirão Série A
  CL: 265, // Primera División Chile
  PT: 94, // Primeira Liga (Portugal)
} as const;

/**
 * Reverse map: AF league ID → competition code.
 */
export const AF_LEAGUE_ID_TO_CODE: Readonly<Record<number, string>> = {
  140: 'PD',
  39: 'PL',
  78: 'BL1',
  135: 'SA',
  61: 'FL1',
  // AF-canonical leagues registered in portal (competition-registry.ts)
  268: 'URU',
  128: 'ARG',
  262: 'MX',
  71: 'BR',
  265: 'CL',
  94: 'PT',
} as const;

// ── Cache file shape ──────────────────────────────────────────────────────

/**
 * Shape of a xG cache JSON file as written by tools/xg-backfill-af.ts.
 */
interface XgCacheFile {
  readonly fixtureId: number;
  readonly utcDate: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly xgHome: number | null;
  readonly xgAway: number | null;
  readonly cachedAt: string;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Load xG data for a fixture from the API-Football backfill cache.
 *
 * Returns a FeatureValue<XgMatchData>:
 * - If the cache file exists and contains valid xG values: value = XgMatchData
 *   with xgDataAvailable=true and individual team xG values present.
 * - If the cache file does not exist: value = MISSING.
 * - Individual team values (xgHome, xgAway) may be MISSING even if the file
 *   exists (e.g., a team value was null in the source data).
 *
 * @param fixtureId  The API-Football fixture ID.
 * @param afLeagueId The API-Football league ID (use AF_LEAGUE_IDS map).
 * @param matchYear  The calendar year of the match (e.g. 2024).
 * @param buildNowUtc The temporal anchor for freshness computation.
 * @param cacheRoot  Base directory for the cache. Defaults to process.cwd()/cache.
 */
export function loadXgFeature(
  fixtureId: number,
  afLeagueId: number,
  matchYear: number,
  buildNowUtc: string,
  cacheRoot: string = join(process.cwd(), 'cache'),
): FeatureValue<XgMatchData> {
  const filePath = join(
    cacheRoot,
    'xg',
    String(afLeagueId),
    String(matchYear),
    `${fixtureId}.json`,
  );

  let cached: XgCacheFile;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    cached = JSON.parse(raw) as XgCacheFile;
  } catch {
    // File does not exist or is not parseable — xG is MISSING (S6.2.2)
    return buildMissingXgFeature(buildNowUtc, 'api-football', buildNowUtc);
  }

  // Validate the parsed data minimally
  if (typeof cached.fixtureId !== 'number' || typeof cached.utcDate !== 'string') {
    return buildMissingXgFeature(buildNowUtc, 'api-football', cached.cachedAt ?? buildNowUtc);
  }

  const xgHome: number | MissingValue = cached.xgHome != null ? cached.xgHome : MISSING;
  const xgAway: number | MissingValue = cached.xgAway != null ? cached.xgAway : MISSING;

  const xgDataAvailable = xgHome !== MISSING && xgAway !== MISSING;

  const freshness = computeFreshnessSeconds(cached.cachedAt, buildNowUtc);

  const provenance: FeatureProvenance = {
    source: 'api-football',
    ingestedAt: cached.cachedAt,
    // effectiveAt = match utcDate: xG is a historical fact that describes
    // what happened during the match. S7.2: "xG is a historical fact that
    // does not change" — effectiveAt is the match date, not cache date.
    effectiveAt: cached.utcDate,
    // Backfill xG from API-Football = HIGH confidence (S5.2)
    confidence: 'HIGH',
    freshness,
  };

  const xgData: XgMatchData = {
    fixtureId: cached.fixtureId,
    utcDate: cached.utcDate,
    homeTeamId: cached.homeTeamId,
    awayTeamId: cached.awayTeamId,
    xgHome,
    xgAway,
    xgDataAvailable,
  };

  return { value: xgData, provenance };
}

/**
 * Compute xG coverage fraction for a list of feature values.
 *
 * Per S6.2.2: if coverage is below XG_PARTIAL_COVERAGE_THRESHOLD (50%),
 * emit warning XG_PARTIAL_COVERAGE. This helper computes the metric;
 * the caller decides whether to emit the warning.
 *
 * @returns A number in [0, 1]. Returns 0 if the list is empty.
 */
export function computeXgCoverage(featureValues: ReadonlyArray<FeatureValue<XgMatchData>>): number {
  if (featureValues.length === 0) return 0;

  const available = featureValues.filter(
    (fv) => fv.value !== MISSING && (fv.value as XgMatchData).xgDataAvailable,
  ).length;

  return available / featureValues.length;
}

/**
 * Extract a xG feature value as a plain number for model consumption.
 *
 * Returns MISSING if the FeatureValue itself is MISSING or if xgDataAvailable
 * is false. Returns the team-side value (home or away).
 *
 * This is a convenience extractor for downstream model code. The full
 * FeatureValue<XgMatchData> should be used when provenance tracking matters.
 */
export function extractTeamXg(
  featureValue: FeatureValue<XgMatchData>,
  side: 'home' | 'away',
): number | MissingValue {
  if (featureValue.value === MISSING) return MISSING;
  const data = featureValue.value as XgMatchData;
  if (!data.xgDataAvailable) return MISSING;
  return side === 'home' ? data.xgHome : data.xgAway;
}

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Build a MISSING FeatureValue for xG absence.
 * Provenance is still populated — the store records that a lookup occurred.
 */
function buildMissingXgFeature(
  buildNowUtc: string,
  source: 'api-football',
  ingestedAt: string,
): FeatureValue<XgMatchData> {
  const freshness = computeFreshnessSeconds(ingestedAt, buildNowUtc);

  const provenance: FeatureProvenance = {
    source,
    ingestedAt,
    effectiveAt: ingestedAt, // No effectiveAt known when file is absent
    confidence: 'UNKNOWN', // No data → UNKNOWN → excluded from model (S7.1)
    freshness,
  };

  return { value: MISSING, provenance };
}

/**
 * Compute freshness in seconds: buildNowUtc - ingestedAt.
 * Returns 0 if timestamps are invalid or ingestedAt > buildNowUtc.
 */
function computeFreshnessSeconds(ingestedAt: string, buildNowUtc: string): number {
  const ingestedMs = Date.parse(ingestedAt);
  const buildNowMs = Date.parse(buildNowUtc);

  if (isNaN(ingestedMs) || isNaN(buildNowMs)) return 0;

  const diffSeconds = (buildNowMs - ingestedMs) / 1000;
  return Math.max(0, diffSeconds);
}

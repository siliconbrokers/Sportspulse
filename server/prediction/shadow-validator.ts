/**
 * shadow-validator.ts — Validación sombra FD vs API-Football para datos históricos.
 *
 * Compara FinishedMatchRecord[] producidos por football-data.org (fuente actual)
 * contra los producidos por API-Football (fuente candidata) para la misma liga.
 *
 * Emite un ShadowReport con:
 *   - match count comparison
 *   - % coverage (cuántos partidos de FD aparecen en AF)
 *   - goal mismatches (mismo partido, diferente score)
 *   - partidos en AF sin correspondencia en FD
 *
 * Orquestación completa por liga:
 *   1. buildTeamBridge — mapea AF team IDs → canonical IDs de FD
 *   2. loadAfHistoricalMatches — carga historial AF usando el bridge
 *   3. compare — compara ambas fuentes
 *   4. Persistir ShadowReport en /cache/shadow/{leagueId}/{season}.json
 *
 * Activación: SHADOW_VALIDATION_ENABLED=true en .env
 */

import { promises as fs }          from 'node:fs';
import path                         from 'node:path';
import { buildTeamBridge }          from './af-team-id-bridge.js';
import { loadAfHistoricalMatches }  from './af-historical-match-loader.js';
import type { FinishedMatchRecord } from '@sportpulse/prediction';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShadowMatchDiff {
  utcDate:    string;
  homeTeamId: string;
  awayTeamId: string;
  fdGoals:    string;   // e.g. "2-1"
  afGoals:    string;   // e.g. "2-1" or "NOT_FOUND"
  status:     'MATCH' | 'GOAL_MISMATCH' | 'MISSING_IN_AF' | 'EXTRA_IN_AF';
}

export interface ShadowReport {
  leagueId:      number;
  season:        number;
  generatedAt:   string;
  fdCount:       number;
  afCount:       number;
  bridgeCoverage: number; // % [0..1] AF teams mapped to canonical
  matchedCount:   number; // FD fixtures found in AF
  goalMismatches: number;
  missingInAf:    number;
  extraInAf:      number;
  coveragePct:    number; // matchedCount / fdCount [0..1]
  diffs:          ShadowMatchDiff[];
  verdict:        'PASS' | 'WARN' | 'FAIL';
  verdictReason:  string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_ROOT       = path.resolve(process.cwd(), 'cache/shadow');
const DATE_WINDOW_MS   = 2 * 24 * 3600_000; // ±2 days tolerance for UTC/local edge cases

/** Thresholds para verdict */
const COVERAGE_WARN    = 0.90; // < 90% → WARN
const COVERAGE_FAIL    = 0.75; // < 75% → FAIL
const MISMATCH_WARN    = 0.02; // > 2% mismatches → WARN
const MISMATCH_FAIL    = 0.05; // > 5% mismatches → FAIL

// ── Cache I/O ─────────────────────────────────────────────────────────────────

async function persistReport(report: ShadowReport): Promise<void> {
  const p   = path.join(CACHE_ROOT, String(report.leagueId), `${report.season}.json`);
  const tmp = `${p}.tmp`;
  try {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(report, null, 2), 'utf-8');
    await fs.rename(tmp, p);
  } catch (err) {
    console.warn(`[ShadowValidator] report persist error: ${err}`);
  }
}

// ── Match key helpers ─────────────────────────────────────────────────────────

function matchKey(homeTeamId: string, awayTeamId: string): string {
  return `${homeTeamId}::${awayTeamId}`;
}

function goalsStr(home: number, away: number): string {
  return `${home}-${away}`;
}

// ── Compare logic ─────────────────────────────────────────────────────────────

function compare(
  fdRecords: FinishedMatchRecord[],
  afRecords: FinishedMatchRecord[],
  leagueId:  number,
  season:    number,
  bridgeCoverage: number,
): ShadowReport {
  // Build AF lookup: matchKey → FinishedMatchRecord
  // Allow date tolerance of ±2 days to handle UTC/local edge cases across APIs
  const afMap = new Map<string, FinishedMatchRecord>();
  for (const af of afRecords) {
    afMap.set(matchKey(af.homeTeamId, af.awayTeamId), af);
  }

  // Track which AF records were consumed
  const consumed = new Set<string>();
  const diffs:    ShadowMatchDiff[] = [];

  let matched        = 0;
  let goalMismatches = 0;
  let missingInAf    = 0;

  for (const fd of fdRecords) {
    const key = matchKey(fd.homeTeamId, fd.awayTeamId);
    const af  = afMap.get(key);

    if (!af) {
      missingInAf++;
      diffs.push({
        utcDate:    fd.utcDate,
        homeTeamId: fd.homeTeamId,
        awayTeamId: fd.awayTeamId,
        fdGoals:    goalsStr(fd.homeGoals, fd.awayGoals),
        afGoals:    'NOT_FOUND',
        status:     'MISSING_IN_AF',
      });
      continue;
    }

    consumed.add(key);

    // Verify date is within window (sanity check)
    const fdTime = new Date(fd.utcDate).getTime();
    const afTime = new Date(af.utcDate).getTime();
    const withinWindow = Math.abs(fdTime - afTime) <= DATE_WINDOW_MS;

    const fdGoals = goalsStr(fd.homeGoals, fd.awayGoals);
    const afGoals = goalsStr(af.homeGoals, af.awayGoals);

    if (!withinWindow || fdGoals !== afGoals) {
      goalMismatches++;
      diffs.push({
        utcDate:    fd.utcDate,
        homeTeamId: fd.homeTeamId,
        awayTeamId: fd.awayTeamId,
        fdGoals,
        afGoals:    withinWindow ? afGoals : `DATE_MISMATCH(${af.utcDate})`,
        status:     'GOAL_MISMATCH',
      });
    } else {
      matched++;
      // Only log MATCH diffs if there are issues; skip clean matches to keep report small
    }
  }

  // Extra in AF (not in FD)
  const extraInAf = afRecords.filter(
    (af) => !consumed.has(matchKey(af.homeTeamId, af.awayTeamId)),
  );
  for (const af of extraInAf) {
    diffs.push({
      utcDate:    af.utcDate,
      homeTeamId: af.homeTeamId,
      awayTeamId: af.awayTeamId,
      fdGoals:    'NOT_IN_FD',
      afGoals:    goalsStr(af.homeGoals, af.awayGoals),
      status:     'EXTRA_IN_AF',
    });
  }

  const fdCount      = fdRecords.length;
  const afCount      = afRecords.length;
  const coveragePct  = fdCount > 0 ? (matched + goalMismatches) / fdCount : 1;
  const mismatchRate = (matched + goalMismatches) > 0
    ? goalMismatches / (matched + goalMismatches)
    : 0;

  // Determine verdict
  let verdict:       ShadowReport['verdict'];
  let verdictReason: string;

  if (coveragePct < COVERAGE_FAIL || mismatchRate > MISMATCH_FAIL) {
    verdict       = 'FAIL';
    verdictReason = coveragePct < COVERAGE_FAIL
      ? `Coverage ${(coveragePct * 100).toFixed(1)}% < ${COVERAGE_FAIL * 100}% threshold`
      : `Mismatch rate ${(mismatchRate * 100).toFixed(1)}% > ${MISMATCH_FAIL * 100}% threshold`;
  } else if (coveragePct < COVERAGE_WARN || mismatchRate > MISMATCH_WARN || bridgeCoverage < 0.95) {
    verdict       = 'WARN';
    verdictReason = coveragePct < COVERAGE_WARN
      ? `Coverage ${(coveragePct * 100).toFixed(1)}% < ${COVERAGE_WARN * 100}% threshold`
      : mismatchRate > MISMATCH_WARN
        ? `Mismatch rate ${(mismatchRate * 100).toFixed(1)}% > ${MISMATCH_WARN * 100}% threshold`
        : `Bridge coverage ${(bridgeCoverage * 100).toFixed(1)}% < 95%`;
  } else {
    verdict       = 'PASS';
    verdictReason = `Coverage ${(coveragePct * 100).toFixed(1)}%, mismatches ${(mismatchRate * 100).toFixed(1)}%, bridge ${(bridgeCoverage * 100).toFixed(1)}%`;
  }

  return {
    leagueId,
    season,
    generatedAt:    new Date().toISOString(),
    fdCount,
    afCount,
    bridgeCoverage,
    matchedCount:   matched,
    goalMismatches,
    missingInAf,
    extraInAf:      extraInAf.length,
    coveragePct,
    diffs,
    verdict,
    verdictReason,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ShadowValidatorConfig {
  /** AF league ID (e.g. 140 para LaLiga) */
  leagueId: number;
  /** Año de inicio de temporada actual (e.g. 2024) */
  currentSeason: number;
  /** Cuántas temporadas pasadas validar (default: 2) */
  pastSeasonsCount?: number;
  /** APIFOOTBALL_KEY */
  apiKey: string;
  /**
   * Mapa normalizedName → canonicalTeamId construido desde los equipos de FD.
   * Se usa para la resolución del bridge AF team ID → canonical ID.
   */
  canonicalNameMap: Map<string, string>;
  /** Registros de FD para comparación (ya cargados por historical-match-loader) */
  fdRecords: FinishedMatchRecord[];
}

/**
 * Ejecuta validación sombra completa para una liga.
 *
 * Flujo:
 *   1. buildTeamBridge → AF team IDs → canonical IDs
 *   2. loadAfHistoricalMatches → FinishedMatchRecord[] con IDs canónicos
 *   3. compare → ShadowReport
 *   4. persist → /cache/shadow/{leagueId}/{currentSeason}.json
 *
 * Retorna null en cualquier error (fault isolation).
 */
export async function runShadowValidation(
  config: ShadowValidatorConfig,
): Promise<ShadowReport | null> {
  const { leagueId, currentSeason, apiKey, canonicalNameMap, fdRecords } = config;
  const pastSeasonsCount = config.pastSeasonsCount ?? 2;

  try {
    // Step 1: build bridge
    const { bridge, coverage: bridgeCoverage, unmatchedAfTeams } = await buildTeamBridge(
      leagueId,
      currentSeason,
      canonicalNameMap,
      apiKey,
    );

    if (bridge.size === 0) {
      console.warn(`[ShadowValidator] league=${leagueId}: bridge empty — skipping validation`);
      return null;
    }

    if (unmatchedAfTeams.length > 0) {
      console.warn(
        `[ShadowValidator] league=${leagueId}: ${unmatchedAfTeams.length} unmatched AF teams: ` +
        unmatchedAfTeams.slice(0, 5).join(', '),
      );
    }

    // Step 2: load AF historical
    const afRecords = await loadAfHistoricalMatches(
      leagueId,
      currentSeason,
      bridge,
      apiKey,
      pastSeasonsCount,
    );

    // Step 3: compare
    const report = compare(fdRecords, afRecords, leagueId, currentSeason, bridgeCoverage);

    // Step 4: persist
    await persistReport(report);

    console.log(
      `[ShadowValidator] league=${leagueId} season=${currentSeason} — ` +
      `${report.verdict}: ${report.verdictReason} ` +
      `(FD=${report.fdCount} AF=${report.afCount} matched=${report.matchedCount} ` +
      `mismatches=${report.goalMismatches} missing=${report.missingInAf})`,
    );

    return report;
  } catch (err) {
    console.error(`[ShadowValidator] Unexpected error league=${leagueId}:`, err);
    return null;
  }
}

/**
 * sweep-sos-sensitivity.ts — SP-V4-05: SoS Sensitivity sweep.
 *
 * Grid search de SOS_SENSITIVITY via backtest walk-forward completo
 * (con calibración isotónica, market odds, per-league rho).
 *
 * Grid: [0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]
 *
 * Métricas por valor:
 *   acc       — accuracy global sobre partidos evaluables
 *   dr        — DRAW recall (hit/real draws)
 *   dp        — DRAW precision (hit/predicted draws)
 *   ar        — AWAY recall (hit/real away wins)
 *   coverage  — fracción predichos / total (excl. NOT_ELIGIBLE)
 *   composite — 0.4*acc + 0.3*DR + 0.3*DP
 *
 * Output:
 *   - Tabla en stdout ordenada por accuracy
 *   - JSON en cache/sos-sweep.json
 *
 * Baseline: SOS_SENSITIVITY=0.00 (acc ≈ 54.9%)
 *
 * Criterio de activación:
 *   Si óptimo mejora accuracy ≥ +0.2pp sobre 54.9% sin degradar
 *   DRAW recall > -5pp ni AWAY recall > -5pp → recomendar activar.
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/sweep-sos-sensitivity.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput, CalibrationTable } from '../packages/prediction/src/engine/v3/types.js';
import { buildOddsIndex, lookupOdds, type OddsIndex } from './odds-lookup.js';

// ── Grid ──────────────────────────────────────────────────────────────────────

const SOS_VALUES = [0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30];

// ── Config ────────────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');
const HIST_BASE  = path.join(process.cwd(), 'cache', 'historical', 'football-data');

const LEAGUES = [
  { code: 'PD',  name: 'LaLiga (PD)',         expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PD',  '2024-25', 'prev-season.json') },
  { code: 'PL',  name: 'Premier League (PL)', expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PL',  '2024-25', 'prev-season.json') },
  { code: 'BL1', name: 'Bundesliga (BL1)',    expectedSeasonGames: 34, prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json') },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface CachedMatch {
  matchId: string;
  matchday: number;
  startTimeUtc: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  scoreHome: number | null;
  scoreAway: number | null;
}

interface SweepResult {
  sosSensitivity: number;
  acc: number;
  dr: number;
  dp: number;
  ar: number;
  coverage: number;
  composite: number;
  nEval: number;
  nTotal: number;
}

// ── Calibration loader ────────────────────────────────────────────────────────

function loadCalibrationTable(filePath: string): CalibrationTable | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CalibrationTable;
  } catch {
    return undefined;
  }
}

/** Estrategia MIXTA: PD=per-liga, PL=global, BL1=global (igual que backtest-v3.ts). */
function getCalibrationTable(leagueCode: string): CalibrationTable | undefined {
  const calDir = path.join(process.cwd(), 'cache', 'calibration');
  const MIXED_STRATEGY: Record<string, 'perLg' | 'global'> = { PD: 'perLg', PL: 'global', BL1: 'global' };
  const strategy = MIXED_STRATEGY[leagueCode] ?? 'global';
  if (strategy === 'perLg') {
    const perLgFile = path.join(calDir, `v3-iso-calibration-${leagueCode}.json`);
    const tbl = loadCalibrationTable(perLgFile);
    if (tbl) return tbl;
  }
  return loadCalibrationTable(path.join(calDir, 'v3-iso-calibration.json'));
}

// ── Cache loaders ─────────────────────────────────────────────────────────────

function loadMatchdays(dir: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  if (!fs.existsSync(dir)) return result;
  fs.readdirSync(dir)
    .filter(f => /^matchday-\d+\.json$/.test(f))
    .sort()
    .forEach(f => {
      const num = parseInt(f.match(/(\d+)/)?.[1] ?? '0', 10);
      if (!num) return;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        result.set(num, raw?.data?.matches ?? raw?.matches ?? []);
      } catch {}
    });
  return result;
}

function loadPrevSeason(file: string): V3MatchRecord[] {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw?.matches ?? [];
  } catch { return []; }
}

function loadHistoricalCache(code: string, year: number): V3MatchRecord[] {
  const file = path.join(HIST_BASE, code, `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw?.matches ?? [];
  } catch { return []; }
}

/** Combina 2023-24 y 2024-25 — replica comportamiento de producción. */
function buildPrevSeasonMatches(code: string, prevSeasonFile: string): V3MatchRecord[] {
  const fromFetch = loadPrevSeason(prevSeasonFile);
  const from2024  = loadHistoricalCache(code, 2024);
  const from2023  = loadHistoricalCache(code, 2023);
  const prev2425  = from2024.length > 0 ? from2024 : fromFetch;
  return [...from2023, ...prev2425];
}

function toV3(m: CachedMatch): V3MatchRecord | null {
  if (m.scoreHome === null || m.scoreAway === null || !m.startTimeUtc) return null;
  return { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, utcDate: m.startTimeUtc, homeGoals: m.scoreHome, awayGoals: m.scoreAway };
}

function actualOutcome(m: CachedMatch): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway) return 'HOME_WIN';
  if (m.scoreAway > m.scoreHome) return 'AWAY_WIN';
  return 'DRAW';
}

// ── Backtest core ─────────────────────────────────────────────────────────────

function runBacktest(sosSens: number, oddsIndex: OddsIndex): SweepResult {
  let totalEv = 0, totalHits = 0;
  let totalDrawReal = 0, totalPredDraw = 0, totalHitDraw = 0;
  let totalAwayReal = 0, totalHitAway = 0;
  let totalMatches = 0;

  for (const lg of LEAGUES) {
    const mds = loadMatchdays(path.join(CACHE_BASE, lg.code, '2025-26'));
    const prev = buildPrevSeasonMatches(lg.code, lg.prevSeasonFile);
    const calibrationTable = getCalibrationTable(lg.code);
    if (mds.size === 0) continue;

    const sorted = [...mds.keys()].sort((a, b) => a - b);

    for (const md of sorted) {
      const test = (mds.get(md) ?? [])
        .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.startTimeUtc);
      if (test.length === 0) continue;

      // Walk-forward: training = all matchdays before current
      const training: V3MatchRecord[] = [];
      for (const p of sorted) {
        if (p >= md) break;
        for (const m of (mds.get(p) ?? [])) {
          const r = toV3(m);
          if (r) training.push(r);
        }
      }

      for (const match of test) {
        const actual = actualOutcome(match);
        if (!actual) continue;

        totalMatches++;

        // Market odds lookup (same as backtest-v3.ts)
        const oddsHit = lookupOdds(oddsIndex, lg.code, match.startTimeUtc, match.scoreHome!, match.scoreAway!);
        const marketOdds = oddsHit
          ? { probHome: oddsHit.impliedProbHome, probDraw: oddsHit.impliedProbDraw, probAway: oddsHit.impliedProbAway, capturedAtUtc: match.startTimeUtc }
          : undefined;

        const input: V3EngineInput = {
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          kickoffUtc: match.startTimeUtc,
          buildNowUtc: match.startTimeUtc,
          currentSeasonMatches: training,
          prevSeasonMatches: prev,
          expectedSeasonGames: lg.expectedSeasonGames,
          leagueCode: lg.code,
          ...(marketOdds ? { marketOdds } : {}),
          ...(calibrationTable ? { calibrationTable } : {}),
          _overrideConstants: { SOS_SENSITIVITY: sosSens },
        };

        try {
          const out = runV3Engine(input);
          if (out.eligibility === 'NOT_ELIGIBLE' || out.predicted_result == null) continue;

          totalEv++;
          if (out.predicted_result === actual) totalHits++;

          if (actual === 'DRAW') totalDrawReal++;
          if (actual === 'AWAY_WIN') totalAwayReal++;

          if (out.predicted_result === 'DRAW') {
            totalPredDraw++;
            if (actual === 'DRAW') totalHitDraw++;
          }
          if (out.predicted_result === 'AWAY_WIN') {
            if (actual === 'AWAY_WIN') totalHitAway++;
          }
        } catch {
          // skip individual errors
        }
      }
    }
  }

  const acc      = totalEv > 0 ? totalHits    / totalEv         : 0;
  const dr       = totalDrawReal > 0 ? totalHitDraw / totalDrawReal : 0;
  const dp       = totalPredDraw > 0 ? totalHitDraw / totalPredDraw : 0;
  const ar       = totalAwayReal > 0 ? totalHitAway / totalAwayReal : 0;
  const coverage = totalMatches > 0  ? totalEv      / totalMatches  : 0;
  // Composite: 0.4*acc + 0.3*DR + 0.3*DP
  const composite = 0.4 * acc + 0.3 * dr + 0.3 * dp;

  return { sosSensitivity: sosSens, acc, dr, dp, ar, coverage, composite, nEval: totalEv, nTotal: totalMatches };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\nSP-V4-05 — SoS Sensitivity Sweep');
console.log('Walk-forward backtest: PD+PL+BL1 2025-26 | Calibración + Market Odds + per-liga rho');
console.log('composite = 0.4*acc + 0.3*DR + 0.3*DP');
console.log('Baseline: SOS_SENSITIVITY=0.00 (acc ≈ 54.9%)');
console.log('');
console.log('SoS    | acc%    | DR%    | DP%    | AR%    | cov%   | composite | n_eval');
console.log('-------|---------|--------|--------|--------|--------|-----------|-------');

// Load odds index once (shared across all sweep runs)
const oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
console.log(`[INFO] Odds index: ${oddsIndex.size} registros\n`);

const results: SweepResult[] = [];
let baseline: SweepResult | undefined;

for (const sos of SOS_VALUES) {
  process.stdout.write(`Running SoS=${sos.toFixed(2)}...`);
  const r = runBacktest(sos, oddsIndex);
  results.push(r);
  if (sos === 0.00) baseline = r;

  const line = [
    String(sos.toFixed(2)).padEnd(6),
    (r.acc      * 100).toFixed(2).padStart(7),
    (r.dr       * 100).toFixed(2).padStart(6),
    (r.dp       * 100).toFixed(2).padStart(6),
    (r.ar       * 100).toFixed(2).padStart(6),
    (r.coverage * 100).toFixed(1).padStart(6),
    r.composite.toFixed(4).padStart(9),
    String(r.nEval).padStart(7),
  ].join(' | ');

  process.stdout.write('\r' + line + '\n');
}

// ── Analysis ──────────────────────────────────────────────────────────────────

const byAcc       = [...results].sort((a, b) => b.acc - a.acc);
const byComposite = [...results].sort((a, b) => b.composite - a.composite);

const bestAcc       = byAcc[0];
const bestComposite = byComposite[0];

console.log('');
console.log('── Results by accuracy ──────────────────────────────────────────────────');
for (const r of byAcc) {
  const delta = baseline ? (r.acc - baseline.acc) * 100 : 0;
  const sign  = delta >= 0 ? '+' : '';
  console.log(`  SoS=${r.sosSensitivity.toFixed(2)} → acc=${(r.acc*100).toFixed(2)}% (${sign}${delta.toFixed(2)}pp vs baseline) | DR=${(r.dr*100).toFixed(1)}% | AR=${(r.ar*100).toFixed(1)}%`);
}

console.log('');
console.log('── Results by composite ─────────────────────────────────────────────────');
for (const r of byComposite) {
  const delta = baseline ? (r.composite - baseline.composite) : 0;
  const sign  = delta >= 0 ? '+' : '';
  console.log(`  SoS=${r.sosSensitivity.toFixed(2)} → composite=${r.composite.toFixed(4)} (${sign}${delta.toFixed(4)} vs baseline) | acc=${(r.acc*100).toFixed(2)}%`);
}

console.log('');
console.log('── Recommendation ───────────────────────────────────────────────────────');
const accGain    = baseline ? (bestAcc.acc - baseline.acc) * 100 : 0;
const drDelta    = baseline ? (bestAcc.dr  - baseline.dr)  * 100 : 0;
const arDelta    = baseline ? (bestAcc.ar  - baseline.ar)  * 100 : 0;

const activationCriteria = accGain >= 0.2 && drDelta > -5.0 && arDelta > -5.0;

console.log(`  Best accuracy:  SOS_SENSITIVITY=${bestAcc.sosSensitivity.toFixed(2)} → acc=${(bestAcc.acc*100).toFixed(2)}% (+${accGain.toFixed(2)}pp)`);
console.log(`    DRAW recall delta: ${drDelta.toFixed(2)}pp  (threshold: > -5pp)`);
console.log(`    AWAY recall delta: ${arDelta.toFixed(2)}pp  (threshold: > -5pp)`);
console.log('');
if (activationCriteria) {
  console.log(`  RECOMMENDATION: ACTIVATE SOS_SENSITIVITY=${bestAcc.sosSensitivity.toFixed(2)}`);
  console.log(`    → Criteria met: acc gain ≥ +0.2pp, DR/AR degradation within tolerance`);
} else {
  console.log(`  RECOMMENDATION: LEAVE SOS_SENSITIVITY=0.0`);
  if (accGain < 0.2) {
    console.log(`    → acc gain too small: ${accGain.toFixed(2)}pp < 0.2pp threshold`);
  }
  if (drDelta <= -5.0) {
    console.log(`    → DRAW recall degradation too large: ${drDelta.toFixed(2)}pp`);
  }
  if (arDelta <= -5.0) {
    console.log(`    → AWAY recall degradation too large: ${arDelta.toFixed(2)}pp`);
  }
}

// ── Persist JSON ──────────────────────────────────────────────────────────────

const cacheDir = path.join(process.cwd(), 'cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

const output = {
  generatedAt: new Date().toISOString(),
  description: 'SP-V4-05 SoS Sensitivity sweep — walk-forward PD+PL+BL1 2025-26 with calibration + market odds',
  compositeFormula: '0.4*acc + 0.3*DR + 0.3*DP',
  baselineSosSensitivity: 0.00,
  baselineAcc: baseline ? parseFloat((baseline.acc * 100).toFixed(2)) : null,
  activationCriteria: {
    minAccGainPp: 0.2,
    maxDrDegradationPp: -5.0,
    maxArDegradationPp: -5.0,
    met: activationCriteria,
  },
  bestByAccuracy: {
    sosSensitivity: bestAcc.sosSensitivity,
    acc: parseFloat((bestAcc.acc * 100).toFixed(2)),
    dr:  parseFloat((bestAcc.dr  * 100).toFixed(2)),
    dp:  parseFloat((bestAcc.dp  * 100).toFixed(2)),
    ar:  parseFloat((bestAcc.ar  * 100).toFixed(2)),
    composite: parseFloat(bestAcc.composite.toFixed(4)),
  },
  bestByComposite: {
    sosSensitivity: bestComposite.sosSensitivity,
    acc: parseFloat((bestComposite.acc * 100).toFixed(2)),
    dr:  parseFloat((bestComposite.dr  * 100).toFixed(2)),
    dp:  parseFloat((bestComposite.dp  * 100).toFixed(2)),
    ar:  parseFloat((bestComposite.ar  * 100).toFixed(2)),
    composite: parseFloat(bestComposite.composite.toFixed(4)),
  },
  recommendation: activationCriteria
    ? { action: 'ACTIVATE', value: bestAcc.sosSensitivity }
    : { action: 'LEAVE_AT_ZERO', value: 0.0 },
  results: results.map(r => ({
    sosSensitivity: r.sosSensitivity,
    acc:       parseFloat((r.acc       * 100).toFixed(4)),
    dr:        parseFloat((r.dr        * 100).toFixed(4)),
    dp:        parseFloat((r.dp        * 100).toFixed(4)),
    ar:        parseFloat((r.ar        * 100).toFixed(4)),
    coverage:  parseFloat((r.coverage  * 100).toFixed(2)),
    composite: parseFloat(r.composite.toFixed(6)),
    nEval:     r.nEval,
    nTotal:    r.nTotal,
  })),
};

const outFile = path.join(cacheDir, 'sos-sweep.json');
fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
console.log(`\n[OK] Resultados persistidos en ${outFile}`);

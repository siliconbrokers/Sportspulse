/**
 * sweep-home-advantage.ts — SP-V4-34: Sweep de HOME_ADVANTAGE_MULT por liga.
 *
 * Metodología: para cada liga, barre valores de HOME_ADV_MULT_OVERRIDE en [1.00..1.30]
 * usando el backtest walk-forward. Compara cada valor contra el baseline dinámico
 * (el ratio league_home_goals/league_away_goals que ya computa el motor).
 *
 * El sweep es per-liga independiente (no joint), por lo que son 13 valores × 3 ligas = 39 runs.
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/sweep-home-advantage.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput } from '../packages/prediction/src/engine/v3/types.js';
import type { CalibrationTable } from '../packages/prediction/src/engine/v3/types.js';
import { buildOddsIndex, lookupOdds, type OddsIndex } from './odds-lookup.js';

// ── Grid ──────────────────────────────────────────────────────────────────────

/** Valores de HOME_ADV_MULT_OVERRIDE a barrer. undefined = baseline dinámico. */
const MULT_GRID: (number | undefined)[] = [
  undefined,          // baseline: ratio dinámico (comportamiento actual)
  1.00, 1.025, 1.05,
  1.075, 1.10, 1.125,
  1.15, 1.175, 1.20,
  1.225, 1.25, 1.275, 1.30,
];

// ── Tipos de cache ─────────────────────────────────────────────────────────────

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

interface LeagueConfigFull {
  name: string;
  code: string;
  dir: string;
  expectedSeasonGames: number;
  prevSeasonFile: string;
}

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

const LEAGUES: LeagueConfigFull[] = [
  { name: 'LaLiga (PD)',         code: 'PD',  dir: path.join(CACHE_BASE, 'PD',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PD',  '2024-25', 'prev-season.json') },
  { name: 'Premier League (PL)', code: 'PL',  dir: path.join(CACHE_BASE, 'PL',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PL',  '2024-25', 'prev-season.json') },
  { name: 'Bundesliga (BL1)',    code: 'BL1', dir: path.join(CACHE_BASE, 'BL1', '2025-26'), expectedSeasonGames: 34, prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json') },
];

// ── Helpers de carga ───────────────────────────────────────────────────────────

function loadCalibrationTable(filePath: string): CalibrationTable | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CalibrationTable; }
  catch { return undefined; }
}

function getCalibrationTable(code: string): CalibrationTable | undefined {
  const calDir = path.join(process.cwd(), 'cache', 'calibration');
  const MIXED: Record<string, 'perLg' | 'global'> = { PD: 'perLg', PL: 'global', BL1: 'global' };
  if ((MIXED[code] ?? 'global') === 'perLg') {
    const t = loadCalibrationTable(path.join(calDir, `v3-iso-calibration-${code}.json`));
    if (t) return t;
  }
  return loadCalibrationTable(path.join(calDir, 'v3-iso-calibration.json'));
}

function loadMatchdayFiles(dir: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  if (!fs.existsSync(dir)) return result;
  for (const file of fs.readdirSync(dir).filter(f => /^matchday-\d+\.json$/.test(f)).sort()) {
    const num = parseInt(file.match(/(\d+)/)?.[1] ?? '0', 10);
    if (!num) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      result.set(num, raw?.data?.matches ?? []);
    } catch { /* skip */ }
  }
  return result;
}

function loadHistoricalCache(code: string, year: number): V3MatchRecord[] {
  const file = path.join(process.cwd(), 'cache', 'historical', 'football-data', code, `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try { return (JSON.parse(fs.readFileSync(file, 'utf-8'))?.matches ?? []) as V3MatchRecord[]; }
  catch { return []; }
}

function buildPrevSeason(code: string, prevFile: string): V3MatchRecord[] {
  const fromFetch = fs.existsSync(prevFile)
    ? (() => { try { return JSON.parse(fs.readFileSync(prevFile, 'utf-8'))?.matches ?? []; } catch { return []; } })()
    : [];
  const from2024 = loadHistoricalCache(code, 2024);
  const from2023 = loadHistoricalCache(code, 2023);
  const prev2425 = from2024.length > 0 ? from2024 : fromFetch;
  return [...from2023, ...prev2425];
}

function toV3Record(m: CachedMatch): V3MatchRecord | null {
  if (m.scoreHome === null || m.scoreAway === null || !m.startTimeUtc) return null;
  return { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, utcDate: m.startTimeUtc, homeGoals: m.scoreHome, awayGoals: m.scoreAway };
}

function actualOutcome(m: CachedMatch): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway) return 'HOME_WIN';
  if (m.scoreAway > m.scoreHome) return 'AWAY_WIN';
  return 'DRAW';
}

// ── Métricas ───────────────────────────────────────────────────────────────────

interface SweeepResult {
  mult: number | undefined;
  acc: number;
  drawRecall: number;
  drawPrecision: number;
  awayRecall: number;
  pctDraw: number;
  coverage: number;
  n: number;
}

function composite(r: SweeepResult): number {
  return 0.4 * r.acc + 0.3 * r.drawRecall + 0.3 * r.drawPrecision;
}

// ── Backtest para un league + un valor de mult ─────────────────────────────────

function runLeague(
  league: LeagueConfigFull,
  oddsIndex: OddsIndex,
  multOverride: number | undefined,
): SweeepResult {
  const allMatchdays = loadMatchdayFiles(league.dir);
  const prevSeason = buildPrevSeason(league.code, league.prevSeasonFile);
  const calibrationTable = getCalibrationTable(league.code);
  if (allMatchdays.size === 0) return { mult: multOverride, acc: 0, drawRecall: 0, drawPrecision: 0, awayRecall: 0, pctDraw: 0, coverage: 0, n: 0 };

  const sortedMd = [...allMatchdays.keys()].sort((a, b) => a - b);

  let total = 0, evaluable = 0, hits = 0;
  let actualDraws = 0, predictedDraws = 0, trueDraws = 0;
  let actualAways = 0, trueAways = 0;

  for (const md of sortedMd) {
    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);
    if (testMatches.length === 0) continue;

    const training: V3MatchRecord[] = [];
    for (const prevMd of sortedMd) {
      if (prevMd >= md) break;
      for (const m of (allMatchdays.get(prevMd) ?? [])) {
        const r = toV3Record(m);
        if (r) training.push(r);
      }
    }

    for (const match of testMatches) {
      const actual = actualOutcome(match);
      if (!actual) continue;
      total++;
      if (actual === 'DRAW') actualDraws++;
      if (actual === 'AWAY_WIN') actualAways++;

      const oddsHit = lookupOdds(oddsIndex, league.code, match.startTimeUtc, match.scoreHome!, match.scoreAway!);
      const marketOdds = oddsHit
        ? { probHome: oddsHit.impliedProbHome, probDraw: oddsHit.impliedProbDraw, probAway: oddsHit.impliedProbAway, capturedAtUtc: match.startTimeUtc }
        : undefined;

      const input: V3EngineInput = {
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        kickoffUtc: match.startTimeUtc,
        buildNowUtc: match.startTimeUtc,
        currentSeasonMatches: training,
        prevSeasonMatches: prevSeason,
        expectedSeasonGames: league.expectedSeasonGames,
        leagueCode: league.code,
        marketOdds,
        ...(calibrationTable ? { calibrationTable } : {}),
        _overrideConstants: {
          ...(multOverride !== undefined ? { HOME_ADV_MULT_OVERRIDE: multOverride } : {}),
        },
      };

      try {
        const out = runV3Engine(input);
        if (out.eligibility === 'NOT_ELIGIBLE') continue;
        const predicted = out.predicted_result;
        if (predicted === null || predicted === undefined) continue;
        if (predicted === 'TOO_CLOSE') continue;

        evaluable++;
        if (predicted === actual) hits++;
        if (predicted === 'DRAW') predictedDraws++;
        if (actual === 'DRAW' && predicted === 'DRAW') trueDraws++;
        if (actual === 'AWAY_WIN' && predicted === 'AWAY_WIN') trueAways++;
      } catch { /* skip */ }
    }
  }

  const acc        = evaluable > 0 ? hits / evaluable : 0;
  const drawRecall = actualDraws > 0 ? trueDraws / actualDraws : 0;
  const drawPrec   = predictedDraws > 0 ? trueDraws / predictedDraws : 0;
  const awayRecall = actualAways > 0 ? trueAways / actualAways : 0;
  const pctDraw    = evaluable > 0 ? predictedDraws / evaluable : 0;
  const coverage   = total > 0 ? evaluable / total : 0;

  return { mult: multOverride, acc, drawRecall, drawPrecision: drawPrec, awayRecall, pctDraw, coverage, n: evaluable };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const oddsDir = path.join(process.cwd(), 'cache', 'odds');
  const oddsIndex = buildOddsIndex(oddsDir);
  const LINE = '─'.repeat(80);

  console.log('\nSP-V4-34 — Sweep HOME_ADVANTAGE_MULT por liga');
  console.log('Valores: dynamic(baseline) + [1.00..1.30 step 0.025]');
  console.log('Composite = 0.4×acc + 0.3×DR + 0.3×DP\n');

  const summary: Record<string, { bestMult: number | undefined; bestAcc: number; baselineAcc: number; delta: number }> = {};

  for (const league of LEAGUES) {
    console.log(`\n${LINE}`);
    console.log(`  ${league.name} (${league.code})`);
    console.log(LINE);
    console.log('  Mult       Acc     DR      DP      AR      %Draw  Coverage  Composite');
    console.log('  ' + '─'.repeat(76));

    const results: SweeepResult[] = [];

    for (const mult of MULT_GRID) {
      const r = runLeague(league, oddsIndex, mult);
      results.push(r);
      const label = mult === undefined ? 'dynamic ' : mult.toFixed(3);
      const comp = composite(r);
      console.log(
        `  ${label.padEnd(9)} ` +
        `${(r.acc * 100).toFixed(1).padStart(5)}%  ` +
        `${(r.drawRecall * 100).toFixed(1).padStart(5)}%  ` +
        `${(r.drawPrecision * 100).toFixed(1).padStart(5)}%  ` +
        `${(r.awayRecall * 100).toFixed(1).padStart(5)}%  ` +
        `${(r.pctDraw * 100).toFixed(1).padStart(5)}%  ` +
        `${(r.coverage * 100).toFixed(1).padStart(7)}%  ` +
        `${comp.toFixed(4)}`
      );
    }

    const baseline = results.find(r => r.mult === undefined)!;
    const best = results.reduce((a, b) => composite(a) > composite(b) ? a : b);
    const delta = best.acc - baseline.acc;

    console.log(`\n  Baseline (dynamic):  acc=${(baseline.acc * 100).toFixed(1)}%  composite=${composite(baseline).toFixed(4)}`);
    console.log(`  Mejor: mult=${best.mult === undefined ? 'dynamic' : best.mult.toFixed(3)}  acc=${(best.acc * 100).toFixed(1)}%  composite=${composite(best).toFixed(4)}  delta=${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(2)}pp`);

    summary[league.code] = {
      bestMult: best.mult,
      bestAcc: best.acc,
      baselineAcc: baseline.acc,
      delta,
    };
  }

  // Resumen final
  console.log(`\n${'═'.repeat(80)}`);
  console.log('  RESUMEN FINAL — SP-V4-34');
  console.log('═'.repeat(80));
  console.log('  Liga   Baseline   Mejor mult    Acc mejor   Delta');
  console.log('  ' + '─'.repeat(54));

  let totalDelta = 0;
  let improved = 0;

  for (const [code, s] of Object.entries(summary)) {
    const multLabel = s.bestMult === undefined ? 'dynamic' : s.bestMult.toFixed(3);
    const delta = s.delta;
    totalDelta += delta;
    if (delta > 0.002) improved++;
    console.log(
      `  ${code.padEnd(6)} ${(s.baselineAcc * 100).toFixed(1).padStart(8)}%   ` +
      `${multLabel.padEnd(10)}   ${(s.bestAcc * 100).toFixed(1).padStart(7)}%   ` +
      `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(2)}pp`
    );
  }

  console.log(`\n  Ligas con mejora >0.2pp: ${improved}/3`);

  if (improved >= 2) {
    console.log('\n  DECISIÓN: Implementar HOME_ADV_MULT_PER_LEAGUE con los valores óptimos.');
    console.log('  Actualizar constants.ts con los mults por liga y engine_version → 4.5');
    console.log('\n  Agregar a constants.ts:');
    console.log('  export const HOME_ADV_MULT_PER_LEAGUE: Record<string, number> = {');
    for (const [code, s] of Object.entries(summary)) {
      if (s.bestMult !== undefined) {
        console.log(`    '${code}': ${s.bestMult.toFixed(3)},  // +${(s.delta * 100).toFixed(2)}pp vs dynamic`);
      }
    }
    console.log('  };');
  } else {
    console.log('\n  DECISIÓN: No implementar — el baseline dinámico ya es óptimo o la mejora es marginal.');
    console.log('  SP-V4-34 CERRADO. HOME_ADVANTAGE_MULT_PER_LEAGUE no se agrega al motor.');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

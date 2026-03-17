/**
 * gen-calibration.ts — Genera y valida tabla de calibración isotónica para PE v3.
 *
 * PASO 1: Walk-forward sobre 2023-24 + 2024-25 (2 temporadas completas)
 *         → tuplas (p_home, p_draw, p_away, actual)
 *         - 2023-24: sin prevSeason (no hay 2022-23 cacheado) → LIMITED mode
 *         - 2024-25: prevSeason = 2023-24 → ELIGIBLE mode
 *
 * PASO 2: Fit isotonic regression por clase (one-vs-rest, PAVA)
 *
 * PASO 3: Guardar tabla en cache/calibration/v3-iso-calibration.json
 *
 * PASO 4: Backtest 2025-26 SIN y CON calibración → medir delta accuracy
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/gen-calibration.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput, CalibrationTable, CalibrationPoint } from '../packages/prediction/src/engine/v3/types.js';
import { fitIsotonicRegression, applyIsoCalibration } from '../packages/prediction/src/calibration/iso-calibrator.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface CachedMatchday {
  data?: { matches?: CachedMatch[] };
  matches?: CachedMatch[];
}

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

interface CalibrationTuple {
  p_home: number;
  p_draw: number;
  p_away: number;
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  season: string;
}

interface BacktestEval {
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  predicted: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | 'TOO_CLOSE' | null;
  eligibility: string;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_BASE  = path.join(process.cwd(), 'cache', 'football-data');
const HIST_BASE   = path.join(process.cwd(), 'cache', 'historical', 'football-data');
const CAL_OUT_DIR = path.join(process.cwd(), 'cache', 'calibration');
const CAL_OUT_FILE = path.join(CAL_OUT_DIR, 'v3-iso-calibration.json');

interface LeagueConfig {
  name: string;
  code: string;
  expectedSeasonGames: number;
}

const LEAGUES: LeagueConfig[] = [
  { name: 'LaLiga (PD)',         code: 'PD',  expectedSeasonGames: 38 },
  { name: 'Premier League (PL)', code: 'PL',  expectedSeasonGames: 38 },
  { name: 'Bundesliga (BL1)',    code: 'BL1', expectedSeasonGames: 34 },
];

// ── Data loading ──────────────────────────────────────────────────────────────

function loadHistorical(code: string, year: number): V3MatchRecord[] {
  const file = path.join(HIST_BASE, code, `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return (raw?.matches as V3MatchRecord[]) ?? [];
  } catch { return []; }
}

/** Load matchday files for a given season directory. */
function loadMatchdayFiles(seasonDir: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  if (!fs.existsSync(seasonDir)) return result;
  const files = fs.readdirSync(seasonDir)
    .filter((f) => /^matchday-\d+\.json$/.test(f))
    .sort();
  for (const file of files) {
    const num = parseInt(file.match(/(\d+)/)?.[1] ?? '0', 10);
    if (!num) continue;
    try {
      const raw: CachedMatchday = JSON.parse(
        fs.readFileSync(path.join(seasonDir, file), 'utf-8'),
      );
      const matches: CachedMatch[] = raw?.data?.matches ?? raw?.matches ?? [];
      result.set(num, matches);
    } catch { /* skip corrupt files */ }
  }
  return result;
}

function toV3Record(m: CachedMatch): V3MatchRecord | null {
  if (m.scoreHome === null || m.scoreAway === null || !m.startTimeUtc) return null;
  return {
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    utcDate: m.startTimeUtc,
    homeGoals: m.scoreHome,
    awayGoals: m.scoreAway,
  };
}

function actualOutcome(scoreHome: number, scoreAway: number): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (scoreHome > scoreAway) return 'HOME_WIN';
  if (scoreAway > scoreHome) return 'AWAY_WIN';
  return 'DRAW';
}

// ── PASO 1: Walk-forward sobre temporada histórica ────────────────────────────

/**
 * Genera tuplas de calibración walk-forward sobre una temporada completa.
 *
 * Para cada partido, usa solo los partidos ANTERIORES en esa temporada
 * como training (anti-lookahead estricto).
 *
 * @param seasonMatches  Todos los partidos de la temporada a evaluar
 * @param prevSeasonMatches  Temporada anterior (puede ser vacío si no hay datos)
 * @param league  Config de la liga
 * @param seasonLabel  Label para logging (ej: "2023-24")
 */
function generateCalibrationTuplesForSeason(
  seasonMatches: V3MatchRecord[],
  prevSeasonMatches: V3MatchRecord[],
  league: LeagueConfig,
  seasonLabel: string,
): CalibrationTuple[] {
  if (seasonMatches.length === 0) {
    console.log(`    [WARN] Sin datos para ${league.code} ${seasonLabel}`);
    return [];
  }

  // Filtrar solo partidos con resultado (homeGoals y awayGoals definidos)
  const withResult = seasonMatches.filter(
    (m) => m.homeGoals !== undefined && m.homeGoals !== null &&
            m.awayGoals !== undefined && m.awayGoals !== null,
  );

  // Ordenar cronológicamente para walk-forward correcto
  const sorted = [...withResult].sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  const tuples: CalibrationTuple[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const match = sorted[i]!;
    const actual = actualOutcome(match.homeGoals!, match.awayGoals!);

    // Training = partidos anteriores en esta temporada (anti-lookahead)
    const currentSeasonMatches = sorted.slice(0, i);

    const engineInput: V3EngineInput = {
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      kickoffUtc: match.utcDate,
      buildNowUtc: match.utcDate,
      currentSeasonMatches,
      prevSeasonMatches,
      expectedSeasonGames: league.expectedSeasonGames,
    };

    try {
      const out = runV3Engine(engineInput);
      if (
        out.eligibility !== 'NOT_ELIGIBLE' &&
        out.prob_home_win !== null &&
        out.prob_draw !== null &&
        out.prob_away_win !== null
      ) {
        tuples.push({
          p_home: out.prob_home_win,
          p_draw: out.prob_draw,
          p_away: out.prob_away_win,
          actual,
          season: seasonLabel,
        });
      }
    } catch {
      // Skip engine errors silently
    }
  }

  return tuples;
}

// ── PASO 2: Fit isotonic regression one-vs-rest ──────────────────────────────

function fitCalibrationTable(tuples: CalibrationTuple[], fittedAt: string): CalibrationTable {
  const sortedByHome = [...tuples].sort((a, b) => a.p_home - b.p_home);
  const sortedByDraw = [...tuples].sort((a, b) => a.p_draw - b.p_draw);
  const sortedByAway = [...tuples].sort((a, b) => a.p_away - b.p_away);

  const homePoints: CalibrationPoint[] = fitIsotonicRegression(
    sortedByHome.map((t) => ({ rawProb: t.p_home, isActual: t.actual === 'HOME_WIN' ? 1 : 0 })),
  );

  const drawPoints: CalibrationPoint[] = fitIsotonicRegression(
    sortedByDraw.map((t) => ({ rawProb: t.p_draw, isActual: t.actual === 'DRAW' ? 1 : 0 })),
  );

  const awayPoints: CalibrationPoint[] = fitIsotonicRegression(
    sortedByAway.map((t) => ({ rawProb: t.p_away, isActual: t.actual === 'AWAY_WIN' ? 1 : 0 })),
  );

  return {
    home: homePoints,
    draw: drawPoints,
    away: awayPoints,
    nCalibrationMatches: tuples.length,
    fittedAt,
  };
}

// ── PASO 4: Backtest 2025-26 ──────────────────────────────────────────────────

function backtestLeague2526(
  league: LeagueConfig,
  calibrationTable?: CalibrationTable,
): BacktestEval[] {
  const seasonDir = path.join(CACHE_BASE, league.code, '2025-26');
  const allMatchdays = loadMatchdayFiles(seasonDir);
  if (allMatchdays.size === 0) return [];

  // prevSeason para 2025-26 = 2023-24 + 2024-25
  const prevSeasonMatches = [
    ...loadHistorical(league.code, 2023),
    ...loadHistorical(league.code, 2024),
  ];

  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);
  const evals: BacktestEval[] = [];

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? []).filter(
      (m) => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc,
    );
    if (testMatches.length === 0) continue;

    // Training: todos los partidos de jornadas anteriores
    const trainingRecords: V3MatchRecord[] = [];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of allMatchdays.get(prevMd) ?? []) {
        const rec = toV3Record(m);
        if (rec) trainingRecords.push(rec);
      }
    }

    for (const match of testMatches) {
      const actual = actualOutcome(match.scoreHome!, match.scoreAway!);

      const input: V3EngineInput = {
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        kickoffUtc: match.startTimeUtc,
        buildNowUtc: match.startTimeUtc,
        currentSeasonMatches: trainingRecords,
        prevSeasonMatches,
        expectedSeasonGames: league.expectedSeasonGames,
        calibrationTable,
      };

      let predicted: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | 'TOO_CLOSE' | null = null;
      let eligibility = 'NOT_ELIGIBLE';
      let p_home: number | null = null;
      let p_draw: number | null = null;
      let p_away: number | null = null;

      try {
        const out = runV3Engine(input);
        eligibility = out.eligibility;
        p_home = out.prob_home_win;
        p_draw = out.prob_draw;
        p_away = out.prob_away_win;
        if (out.predicted_result !== null && out.predicted_result !== undefined) {
          predicted = out.predicted_result as typeof predicted;
        } else if (out.eligibility !== 'NOT_ELIGIBLE') {
          predicted = 'TOO_CLOSE';
        }
      } catch {
        eligibility = 'ERROR';
      }

      evals.push({ actual, predicted, eligibility, p_home, p_draw, p_away });
    }
  }

  return evals;
}

// ── Reporting ─────────────────────────────────────────────────────────────────

const pct = (n: number, total: number) =>
  total > 0 ? `${((n / total) * 100).toFixed(1)}%` : 'N/A';
const LINE = '─'.repeat(68);

interface AccuracyReport {
  total: number;
  evaluable: number;
  accuracy: number;
  drawRecall: number;
  drawPrecision: number;
  predictedDrawCount: number;
  actualDrawCount: number;
  homeRecall: number;
  awayRecall: number;
}

function computeAccuracy(evals: BacktestEval[]): AccuracyReport {
  const evaluable = evals.filter(
    (e) =>
      e.eligibility !== 'NOT_ELIGIBLE' &&
      e.eligibility !== 'ERROR' &&
      e.predicted !== null &&
      e.predicted !== 'TOO_CLOSE',
  );

  const hits      = evaluable.filter((e) => e.predicted === e.actual).length;
  const actualDraw  = evaluable.filter((e) => e.actual === 'DRAW').length;
  const predictedDraw = evaluable.filter((e) => e.predicted === 'DRAW').length;
  const hitDraw   = evaluable.filter((e) => e.predicted === 'DRAW' && e.actual === 'DRAW').length;
  const actualHome  = evaluable.filter((e) => e.actual === 'HOME_WIN').length;
  const hitHome   = evaluable.filter((e) => e.predicted === 'HOME_WIN' && e.actual === 'HOME_WIN').length;
  const actualAway  = evaluable.filter((e) => e.actual === 'AWAY_WIN').length;
  const hitAway   = evaluable.filter((e) => e.predicted === 'AWAY_WIN' && e.actual === 'AWAY_WIN').length;

  return {
    total: evals.length,
    evaluable: evaluable.length,
    accuracy:      evaluable.length > 0 ? hits / evaluable.length : 0,
    drawRecall:    actualDraw > 0    ? hitDraw / actualDraw : 0,
    drawPrecision: predictedDraw > 0 ? hitDraw / predictedDraw : 0,
    predictedDrawCount: predictedDraw,
    actualDrawCount: actualDraw,
    homeRecall: actualHome > 0 ? hitHome / actualHome : 0,
    awayRecall: actualAway > 0 ? hitAway / actualAway : 0,
  };
}

function printCompactReport(label: string, r: AccuracyReport): void {
  const acc  = pct(Math.round(r.accuracy * r.evaluable), r.evaluable);
  const draw = `${(r.drawRecall * 100).toFixed(1)}%`;
  const prec = `${(r.drawPrecision * 100).toFixed(1)}%`;
  const away = `${(r.awayRecall * 100).toFixed(1)}%`;
  console.log(
    `  ${label.padEnd(22)} acc=${acc.padStart(6)}  ` +
    `DRAW recall=${draw.padStart(6)}  prec=${prec.padStart(6)}  AWAY recall=${away.padStart(6)}`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nSportPulse — Calibración Isotónica PE v3 (2 temporadas)\n');
  console.log('='.repeat(68));

  // ── PASO 1: Walk-forward 2 temporadas ────────────────────────────────────
  console.log('\nPASO 1: Generando tuplas de calibración (walk-forward)...\n');

  const allTuples: CalibrationTuple[] = [];

  for (const league of LEAGUES) {
    console.log(`  ${league.name}`);

    // Temporada 2023-24: sin prevSeason (no hay 2022-23 cacheado)
    const season2324 = loadHistorical(league.code, 2023);
    const tuples2324 = generateCalibrationTuplesForSeason(
      season2324, [], league, '2023-24',
    );
    console.log(`    2023-24 (sin prevSeason): ${tuples2324.length} tuplas`);

    // Temporada 2024-25: prevSeason = 2023-24
    const season2425 = loadHistorical(league.code, 2024);
    const prevSeason2425 = loadHistorical(league.code, 2023);
    const tuples2425 = generateCalibrationTuplesForSeason(
      season2425, prevSeason2425, league, '2024-25',
    );
    console.log(`    2024-25 (prevSeason=2023-24): ${tuples2425.length} tuplas`);

    allTuples.push(...tuples2324, ...tuples2425);
  }

  console.log(`\n  Total tuplas de calibración : ${allTuples.length}`);

  const byClass = {
    HOME: allTuples.filter((t) => t.actual === 'HOME_WIN').length,
    DRAW: allTuples.filter((t) => t.actual === 'DRAW').length,
    AWAY: allTuples.filter((t) => t.actual === 'AWAY_WIN').length,
  };
  console.log(`  Por clase  →  HOME: ${byClass.HOME}  DRAW: ${byClass.DRAW}  AWAY: ${byClass.AWAY}`);

  if (allTuples.length < 500) {
    console.log('\n  ERROR: Pocas tuplas para calibración confiable (mínimo ~500).');
    process.exit(1);
  }

  // ── PASO 2: Fit isotonic regression ──────────────────────────────────────
  console.log('\nPASO 2: Fitting isotonic regression (PAVA, one-vs-rest)...\n');

  const fittedAt = new Date().toISOString();
  const table = fitCalibrationTable(allTuples, fittedAt);

  console.log(`  Clase HOME : ${table.home.length} puntos de calibración`);
  console.log(`  Clase DRAW : ${table.draw.length} puntos de calibración`);
  console.log(`  Clase AWAY : ${table.away.length} puntos de calibración`);

  // Diagnóstico: sesgo sistemático que la calibración corrige
  const homeRaw = allTuples.map((t) => t.p_home);
  const drawRaw = allTuples.map((t) => t.p_draw);
  const awayRaw = allTuples.map((t) => t.p_away);
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const avgPredHome = avg(homeRaw);
  const avgPredDraw = avg(drawRaw);
  const avgPredAway = avg(awayRaw);
  const actualRateHome = byClass.HOME / allTuples.length;
  const actualRateDraw = byClass.DRAW / allTuples.length;
  const actualRateAway = byClass.AWAY / allTuples.length;

  console.log(`\n  Diagnóstico sesgo (raw_pred vs real):`);
  console.log(`    HOME : pred_avg=${avgPredHome.toFixed(3)}  real=${actualRateHome.toFixed(3)}  bias=${(avgPredHome - actualRateHome).toFixed(3)}`);
  console.log(`    DRAW : pred_avg=${avgPredDraw.toFixed(3)}  real=${actualRateDraw.toFixed(3)}  bias=${(avgPredDraw - actualRateDraw).toFixed(3)}`);
  console.log(`    AWAY : pred_avg=${avgPredAway.toFixed(3)}  real=${actualRateAway.toFixed(3)}  bias=${(avgPredAway - actualRateAway).toFixed(3)}`);

  // Muestreo tabla DRAW para verificar dirección de la corrección
  if (table.draw.length > 0) {
    console.log(`\n  Muestreo tabla DRAW (8 puntos):`);
    const step = Math.max(1, Math.floor(table.draw.length / 8));
    for (let i = 0; i < table.draw.length; i += step) {
      const pt = table.draw[i]!;
      const dir = pt.calProb > pt.rawProb ? '↑' : pt.calProb < pt.rawProb ? '↓' : '=';
      console.log(`    raw=${pt.rawProb.toFixed(3)} → cal=${pt.calProb.toFixed(3)} ${dir}`);
    }
  }

  // ── PASO 3: Guardar tabla ─────────────────────────────────────────────────
  console.log(`\nPASO 3: Guardando tabla en ${CAL_OUT_FILE}...\n`);

  fs.mkdirSync(CAL_OUT_DIR, { recursive: true });
  fs.writeFileSync(CAL_OUT_FILE, JSON.stringify(table, null, 2));
  const sizekb = (fs.statSync(CAL_OUT_FILE).size / 1024).toFixed(1);
  console.log(`  Guardado: ${CAL_OUT_FILE} (${sizekb} KB)`);

  // ── PASO 4: Backtest 2025-26 SIN y CON calibración ───────────────────────
  console.log(`\nPASO 4: Backtest 2025-26 (SIN calibración vs CON calibración)...\n`);
  console.log(LINE);

  const allEvalsRaw: BacktestEval[] = [];
  const allEvalsCal: BacktestEval[] = [];

  for (const league of LEAGUES) {
    process.stdout.write(`  ${league.name.padEnd(25)} ... `);
    const evalsRaw = backtestLeague2526(league, undefined);
    const evalsCal = backtestLeague2526(league, table);
    allEvalsRaw.push(...evalsRaw);
    allEvalsCal.push(...evalsCal);

    const rRaw = computeAccuracy(evalsRaw);
    const rCal = computeAccuracy(evalsCal);
    console.log(`${evalsRaw.length} partidos`);
    printCompactReport('  SIN calibración', rRaw);
    printCompactReport('  CON calibración', rCal);
    console.log('');
  }

  // ── Resultado global ──────────────────────────────────────────────────────
  const rRawAll = computeAccuracy(allEvalsRaw);
  const rCalAll = computeAccuracy(allEvalsCal);

  console.log('='.repeat(68));
  console.log('  TOTAL (3 ligas, 2025-26)');
  console.log('='.repeat(68));
  console.log(`  Nº tuplas calibración : ${allTuples.length} (2023-24 + 2024-25)`);
  console.log('');
  printCompactReport('SIN calibración', rRawAll);
  printCompactReport('CON calibración', rCalAll);
  console.log('');

  const accDiff      = (rCalAll.accuracy - rRawAll.accuracy) * 100;
  const drawRecallDiff = (rCalAll.drawRecall - rRawAll.drawRecall) * 100;
  const drawPrecDiff = (rCalAll.drawPrecision - rRawAll.drawPrecision) * 100;
  const awayRecallDiff = (rCalAll.awayRecall - rRawAll.awayRecall) * 100;

  console.log(`  Delta accuracy    : ${accDiff >= 0 ? '+' : ''}${accDiff.toFixed(1)}pp`);
  console.log(`  Delta DRAW recall : ${drawRecallDiff >= 0 ? '+' : ''}${drawRecallDiff.toFixed(1)}pp`);
  console.log(`  Delta DRAW prec   : ${drawPrecDiff >= 0 ? '+' : ''}${drawPrecDiff.toFixed(1)}pp`);
  console.log(`  Delta AWAY recall : ${awayRecallDiff >= 0 ? '+' : ''}${awayRecallDiff.toFixed(1)}pp`);
  console.log('='.repeat(68));
  console.log();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});

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
 * Flags:
 *   --ensemble   Activar ENSEMBLE_ENABLED=true durante generación de tuplas.
 *                Carga coeficientes logísticos desde cache/logistic-coefficients.json.
 *                Las tablas se guardan con sufijo -ensemble.json.
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/gen-calibration.ts [--ensemble]
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput, CalibrationTable, CalibrationPoint } from '../packages/prediction/src/engine/v3/types.js';
import type { LogisticCoefficients } from '../packages/prediction/src/engine/v3/logistic-model.js';
import { fitIsotonicRegression, applyIsoCalibration } from '../packages/prediction/src/calibration/iso-calibrator.js';

// ── CLI flags ─────────────────────────────────────────────────────────────────

const USE_ENSEMBLE = process.argv.includes('--ensemble');

/** Carga coeficientes logísticos desde cache/logistic-coefficients.json. */
function loadLogisticCoefficients(): LogisticCoefficients | undefined {
  const file = path.join(process.cwd(), 'cache', 'logistic-coefficients.json');
  if (!fs.existsSync(file)) {
    console.warn('  [WARN] cache/logistic-coefficients.json no encontrado — usando DEFAULT_LOGISTIC_COEFFICIENTS');
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as LogisticCoefficients;
  } catch (err) {
    console.warn('  [WARN] Error leyendo logistic-coefficients.json:', err);
    return undefined;
  }
}

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
  leagueCode: string;
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

const CACHE_BASE   = path.join(process.cwd(), 'cache', 'football-data');
const HIST_BASE    = path.join(process.cwd(), 'cache', 'historical', 'football-data');
const CAL_OUT_DIR  = path.join(process.cwd(), 'cache', 'calibration');
// With --ensemble flag: save to separate files so baseline tables are preserved.
const CAL_SUFFIX   = USE_ENSEMBLE ? '-ensemble' : '';
const CAL_OUT_FILE = path.join(CAL_OUT_DIR, `v3-iso-calibration${CAL_SUFFIX}.json`);

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

interface EnsembleOverride {
  enabled: boolean;
  logisticCoefficients?: LogisticCoefficients;
}

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
 * @param ensembleOverride  Si se debe activar ENSEMBLE_ENABLED y con qué coeficientes
 */
function generateCalibrationTuplesForSeason(
  seasonMatches: V3MatchRecord[],
  prevSeasonMatches: V3MatchRecord[],
  league: LeagueConfig,
  seasonLabel: string,
  ensembleOverride?: EnsembleOverride,
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
      // Calibration tuples must use pre-DrawAffinity probabilities so the
      // calibration is trained on the same space it is applied to at inference.
      _skipDrawAffinity: true,
      ...(ensembleOverride?.enabled === true
        ? {
            _overrideConstants: { ENSEMBLE_ENABLED: true },
            logisticCoefficients: ensembleOverride.logisticCoefficients,
          }
        : {}),
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
          leagueCode: league.code,
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
  ensembleOverride?: EnsembleOverride,
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
        leagueCode: league.code,
        ...(ensembleOverride?.enabled === true
          ? {
              _overrideConstants: { ENSEMBLE_ENABLED: true },
              logisticCoefficients: ensembleOverride.logisticCoefficients,
            }
          : {}),
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
  const modeLabel = USE_ENSEMBLE ? 'ENSEMBLE activo (w_poisson=0.95, w_logistic=0.05)' : 'Poisson puro (ENSEMBLE_ENABLED=false)';
  console.log(`\nSportPulse — Calibración Isotónica PE v3 (2 temporadas) — ${modeLabel}\n`);
  console.log('='.repeat(68));

  // Preparar ensemble override si aplica
  let ensembleOverride: EnsembleOverride | undefined;
  if (USE_ENSEMBLE) {
    const coefficients = loadLogisticCoefficients();
    ensembleOverride = { enabled: true, logisticCoefficients: coefficients };
    const trainedOn = (coefficients as { trained_on_matches?: number })?.trained_on_matches ?? '?';
    console.log(`  [ENSEMBLE] Coeficientes logísticos cargados (trained_on_matches=${trainedOn})`);
    console.log(`  [ENSEMBLE] Tablas se guardarán con sufijo '-ensemble'\n`);
  }

  // ── PASO 1: Walk-forward 2 temporadas ────────────────────────────────────
  console.log('\nPASO 1: Generando tuplas de calibración (walk-forward)...\n');

  const allTuples: CalibrationTuple[] = [];

  for (const league of LEAGUES) {
    console.log(`  ${league.name}`);

    // Temporada 2023-24: sin prevSeason (no hay 2022-23 cacheado)
    const season2324 = loadHistorical(league.code, 2023);
    const tuples2324 = generateCalibrationTuplesForSeason(
      season2324, [], league, '2023-24', ensembleOverride,
    );
    console.log(`    2023-24 (sin prevSeason): ${tuples2324.length} tuplas`);

    // Temporada 2024-25: prevSeason = 2023-24
    const season2425 = loadHistorical(league.code, 2024);
    const prevSeason2425 = loadHistorical(league.code, 2023);
    const tuples2425 = generateCalibrationTuplesForSeason(
      season2425, prevSeason2425, league, '2024-25', ensembleOverride,
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

  console.log(`  [GLOBAL]  HOME:${table.home.length}pts  DRAW:${table.draw.length}pts  AWAY:${table.away.length}pts`);

  // Per-league tables
  const perLeagueTables = new Map<string, CalibrationTable>();
  for (const lg of LEAGUES) {
    const lgTuples = allTuples.filter((t) => t.leagueCode === lg.code);
    if (lgTuples.length < 100) {
      console.log(`  [${lg.code}]  SKIP — insufficient tuples (${lgTuples.length} < 100)`);
      continue;
    }
    const lgTable = fitCalibrationTable(lgTuples, fittedAt);
    perLeagueTables.set(lg.code, lgTable);
    console.log(`  [${lg.code}]   HOME:${lgTable.home.length}pts  DRAW:${lgTable.draw.length}pts  AWAY:${lgTable.away.length}pts  (${lgTuples.length} tuples)`);
  }

  // Diagnóstico: sesgo sistemático que la calibración corrige
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  function printBias(label: string, tuples: typeof allTuples): void {
    const n = tuples.length;
    if (n === 0) return;
    const avgH = avg(tuples.map((t) => t.p_home));
    const avgD = avg(tuples.map((t) => t.p_draw));
    const avgA = avg(tuples.map((t) => t.p_away));
    const rH = tuples.filter((t) => t.actual === 'HOME_WIN').length / n;
    const rD = tuples.filter((t) => t.actual === 'DRAW').length / n;
    const rA = tuples.filter((t) => t.actual === 'AWAY_WIN').length / n;
    const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(3);
    console.log(`  ${label.padEnd(8)}  HOME:${fmt(avgH-rH)}  DRAW:${fmt(avgD-rD)}  AWAY:${fmt(avgA-rA)}`);
  }

  console.log(`\n  Bias (pred_avg - real_rate):`);
  printBias('GLOBAL', allTuples);
  for (const lg of LEAGUES) {
    printBias(lg.code, allTuples.filter((t) => t.leagueCode === lg.code));
  }

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

  // ── PASO 3: Guardar tablas ────────────────────────────────────────────────
  console.log(`\nPASO 3: Guardando tablas...\n`);

  fs.mkdirSync(CAL_OUT_DIR, { recursive: true });

  // Global
  fs.writeFileSync(CAL_OUT_FILE, JSON.stringify(table, null, 2));
  console.log(`  [GLOBAL] ${CAL_OUT_FILE} (${(fs.statSync(CAL_OUT_FILE).size / 1024).toFixed(1)} KB)`);

  // Per-league
  for (const [code, lgTable] of perLeagueTables) {
    const lgFile = path.join(CAL_OUT_DIR, `v3-iso-calibration-${code}${CAL_SUFFIX}.json`);
    fs.writeFileSync(lgFile, JSON.stringify(lgTable, null, 2));
    console.log(`  [${code}]    ${lgFile} (${(fs.statSync(lgFile).size / 1024).toFixed(1)} KB)`);
  }

  // ── PASO 4: Backtest 2025-26 — 3 variantes ───────────────────────────────
  console.log(`\nPASO 4: Backtest 2025-26 (SIN / global / per-liga)...\n`);
  console.log(LINE);

  const allEvalsRaw: BacktestEval[] = [];
  const allEvalsGlobal: BacktestEval[] = [];
  const allEvalsPerLeague: BacktestEval[] = [];
  // Per-league eval sets (needed to build mixed strategy)
  const evalsByLeague = new Map<string, { raw: BacktestEval[]; global: BacktestEval[]; perLg: BacktestEval[] }>();

  for (const league of LEAGUES) {
    process.stdout.write(`  ${league.name.padEnd(25)} ... `);
    const evalsRaw      = backtestLeague2526(league, undefined, ensembleOverride);
    const evalsGlobal   = backtestLeague2526(league, table, ensembleOverride);
    const lgTable       = perLeagueTables.get(league.code);
    const evalsPerLeague = backtestLeague2526(league, lgTable, ensembleOverride);

    allEvalsRaw.push(...evalsRaw);
    allEvalsGlobal.push(...evalsGlobal);
    allEvalsPerLeague.push(...evalsPerLeague);
    evalsByLeague.set(league.code, { raw: evalsRaw, global: evalsGlobal, perLg: evalsPerLeague });

    const rRaw = computeAccuracy(evalsRaw);
    const rGlb = computeAccuracy(evalsGlobal);
    const rPL  = computeAccuracy(evalsPerLeague);
    console.log(`${evalsRaw.length} partidos`);
    printCompactReport('  SIN cal', rRaw);
    printCompactReport('  CON cal global', rGlb);
    printCompactReport(`  CON cal ${league.code}`, rPL);
    console.log('');
  }

  // ── Estrategia mixta: elegir la mejor tabla por liga ─────────────────────
  // PD: per-league (+4.5pp acc, +6.4pp DRAW recall vs global)
  // PL: global (PL-specific bias is tiny; global cross-league correction helps more)
  // BL1: global (per-league over-corrects → 64% DRAW recall, low precision)
  const MIXED_STRATEGY: Record<string, 'perLg' | 'global'> = {
    PD: 'perLg',
    PL: 'global',
    BL1: 'global',
  };

  const allEvalsMixed: BacktestEval[] = [];
  for (const [code, sets] of evalsByLeague) {
    const strategy = MIXED_STRATEGY[code] ?? 'global';
    allEvalsMixed.push(...(strategy === 'perLg' ? sets.perLg : sets.global));
  }
  const rMixed = computeAccuracy(allEvalsMixed);

  // ── Resultado global ──────────────────────────────────────────────────────
  const rRawAll    = computeAccuracy(allEvalsRaw);
  const rGlobalAll = computeAccuracy(allEvalsGlobal);
  const rPerLgAll  = computeAccuracy(allEvalsPerLeague);

  const d = (a: number, b: number) => (a >= b ? '+' : '') + (a - b).toFixed(1) + 'pp';

  console.log('='.repeat(68));
  console.log('  TOTAL (3 ligas, 2025-26)');
  console.log('='.repeat(68));
  console.log(`  Nº tuplas: ${allTuples.length} global | ${[...LEAGUES].map((lg) => `${lg.code}:${allTuples.filter((t) => t.leagueCode === lg.code).length}`).join(' ')}\n`);
  printCompactReport('SIN calibración', rRawAll);
  printCompactReport('CON cal global', rGlobalAll);
  printCompactReport('CON cal per-liga', rPerLgAll);
  printCompactReport('CON cal MIXTA *', rMixed);
  console.log('  * Mixta: PD=per-liga, PL=global, BL1=global\n');
  console.log(`  Global vs SIN:  acc ${d(rGlobalAll.accuracy*100, rRawAll.accuracy*100)}  DRAW recall ${d(rGlobalAll.drawRecall*100, rRawAll.drawRecall*100)}  prec ${d(rGlobalAll.drawPrecision*100, rRawAll.drawPrecision*100)}`);
  console.log(`  Mixta  vs SIN:  acc ${d(rMixed.accuracy*100, rRawAll.accuracy*100)}  DRAW recall ${d(rMixed.drawRecall*100, rRawAll.drawRecall*100)}  prec ${d(rMixed.drawPrecision*100, rRawAll.drawPrecision*100)}`);
  console.log(`  Mixta  vs Glb:  acc ${d(rMixed.accuracy*100, rGlobalAll.accuracy*100)}  DRAW recall ${d(rMixed.drawRecall*100, rGlobalAll.drawRecall*100)}  prec ${d(rMixed.drawPrecision*100, rGlobalAll.drawPrecision*100)}`);
  console.log('='.repeat(68));

  // Alias for sweep section below (use mixed strategy evals)
  const allEvalsCal = allEvalsMixed;

  // ── SWEEP: encontrar FLOOR/MARGIN óptimo para espacio calibrado ───────────
  console.log('\nSWEEP — DRAW_FLOOR × DRAW_MARGIN con calibración activa\n');
  console.log(`  ${'FLOOR'.padEnd(7)} ${'MARGIN'.padEnd(8)} ${'Accuracy'.padEnd(10)} ${'DRAW recall'.padEnd(13)} ${'DRAW prec'.padEnd(11)} ${'AWAY recall'}`);
  console.log('  ' + '─'.repeat(62));

  // p_draw distribution in calibrated evals
  const calDrawProbs = allEvalsCal
    .filter((e) => e.p_draw !== null)
    .map((e) => e.p_draw as number)
    .sort((a, b) => a - b);
  const p50 = calDrawProbs[Math.floor(calDrawProbs.length * 0.5)] ?? 0;
  const p75 = calDrawProbs[Math.floor(calDrawProbs.length * 0.75)] ?? 0;
  const p90 = calDrawProbs[Math.floor(calDrawProbs.length * 0.9)] ?? 0;
  console.log(`\n  Distribución p_draw calibrado: p50=${p50.toFixed(3)} p75=${p75.toFixed(3)} p90=${p90.toFixed(3)}\n`);

  const FLOORS  = [0.20, 0.22, 0.24, 0.26, 0.28, 0.30, 0.32];
  const MARGINS = [0.06, 0.08, 0.10, 0.12, 0.15];

  // Build a helper that re-scores calibrated evals with different FLOOR/MARGIN
  function rescore(
    evals: BacktestEval[],
    floor: number,
    margin: number,
  ): AccuracyReport {
    const rescored: BacktestEval[] = evals.map((e) => {
      if (
        e.eligibility === 'NOT_ELIGIBLE' ||
        e.eligibility === 'ERROR' ||
        e.p_home === null || e.p_draw === null || e.p_away === null
      ) return e;

      // Apply floor rule on calibrated probs
      let predicted = e.predicted;
      if (e.p_draw >= floor) {
        const maxOther = Math.max(e.p_home, e.p_away);
        // TOO_CLOSE guard: if margin between top-2 is < 0.05 → null (keep as-is)
        const probs = [e.p_home, e.p_draw, e.p_away].sort((a, b) => b - a);
        const topMargin = probs[0]! - probs[1]!;
        if (topMargin >= 0.05 && maxOther - e.p_draw <= margin) {
          predicted = 'DRAW';
        }
      }
      return { ...e, predicted };
    });
    return computeAccuracy(rescored);
  }

  let bestScore = -Infinity;
  let bestConfig = { floor: 0, margin: 0 };

  for (const floor of FLOORS) {
    for (const margin of MARGINS) {
      const r = rescore(allEvalsCal, floor, margin);
      const score = r.accuracy * 0.6 + r.drawRecall * 0.4; // composite metric
      if (score > bestScore) {
        bestScore = score;
        bestConfig = { floor, margin };
      }
      const acc  = pct(Math.round(r.accuracy * r.evaluable), r.evaluable);
      const drec = `${(r.drawRecall * 100).toFixed(1)}%`;
      const dprc = `${(r.drawPrecision * 100).toFixed(1)}%`;
      const arec = `${(r.awayRecall * 100).toFixed(1)}%`;
      console.log(
        `  ${floor.toFixed(2).padEnd(7)} ${margin.toFixed(2).padEnd(8)} ${acc.padStart(8)}   ${drec.padStart(10)}   ${dprc.padStart(9)}   ${arec.padStart(9)}`
      );
    }
  }

  console.log('');
  console.log(`  Mejor config (acc×0.6 + DRAW recall×0.4): FLOOR=${bestConfig.floor} MARGIN=${bestConfig.margin}`);
  const rBest = rescore(allEvalsCal, bestConfig.floor, bestConfig.margin);
  printCompactReport('  Mejor config', rBest);
  console.log('='.repeat(68));
  console.log();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});

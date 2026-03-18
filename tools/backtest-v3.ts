/**
 * BACKTEST-V3: Walk-forward backtest del motor PE v1.3 (runV3Engine).
 *
 * A diferencia de backtest-predictions.ts y backtest-model.ts, este script
 * evalúa el motor real de producción — no el legacy prediction-builder.
 *
 * Metodología: para cada jornada N, usa partidos de jornadas 1..N-1 como
 * training data (sin data leakage), testea sobre partidos FINISHED de jornada N.
 *
 * Flags:
 *   --ensemble              Activar ENSEMBLE_ENABLED=true durante el backtest.
 *                           Carga coeficientes logísticos desde cache/logistic-coefficients.json.
 *                           Las tablas de calibración se cargan desde archivos -ensemble.json.
 *   --market-weight <val>   Override de MARKET_WEIGHT (0.0..0.30) para sweep SP-V4-11.
 *                           Si se omite, usa el valor de constants.ts (actualmente 0.15).
 *   --xg                    Cargar xG desde disco (cache/xg/) e inyectarlo en el engine.
 *                           Matching por proximidad (fecha + score) para resolver la diferencia
 *                           de IDs entre football-data.org (backtest) y API-Football (xG cache).
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/backtest-v3.ts [--ensemble] [--market-weight 0.20] [--xg]
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput, XgRecord } from '../packages/prediction/src/engine/v3/types.js';
import type { LogisticCoefficients } from '../packages/prediction/src/engine/v3/logistic-model.js';
import {
  computeProbabilityMetrics,
  type PredictionRecord,
} from '../packages/prediction/src/metrics/calibration-metrics.js';
import type { CalibrationTable } from '../packages/prediction/src/engine/v3/types.js';
import { buildOddsIndex, lookupOdds, type OddsIndex } from './odds-lookup.js';

// ── CLI flags ─────────────────────────────────────────────────────────────────

const USE_ENSEMBLE = process.argv.includes('--ensemble');
const USE_XG = process.argv.includes('--xg');

/**
 * §SP-V4-11: optional MARKET_WEIGHT override for sweep experiments.
 * Usage: --market-weight 0.20
 * When not provided (NaN), engine uses MARKET_WEIGHT from constants.ts (currently 0.15).
 */
const MARKET_WEIGHT_OVERRIDE: number | undefined = (() => {
  const idx = process.argv.indexOf('--market-weight');
  if (idx !== -1 && process.argv[idx + 1]) {
    const val = parseFloat(process.argv[idx + 1]);
    return isNaN(val) ? undefined : val;
  }
  return undefined;
})();

/** Carga coeficientes logísticos desde cache/logistic-coefficients.json. */
function loadLogisticCoefficients(): LogisticCoefficients | undefined {
  const file = path.join(process.cwd(), 'cache', 'logistic-coefficients.json');
  if (!fs.existsSync(file)) {
    console.warn('[WARN] cache/logistic-coefficients.json no encontrado — usando DEFAULT_LOGISTIC_COEFFICIENTS');
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as LogisticCoefficients;
  } catch (err) {
    console.warn('[WARN] Error leyendo logistic-coefficients.json:', err);
    return undefined;
  }
}

/** Carga una tabla de calibración isotónica desde disco. */
function loadCalibrationTable(filePath: string): CalibrationTable | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CalibrationTable;
  } catch {
    return undefined;
  }
}

/** Devuelve la tabla de calibración apropiada para una liga y modo ensemble. */
function getCalibrationTable(leagueCode: string): CalibrationTable | undefined {
  const calDir = path.join(process.cwd(), 'cache', 'calibration');
  const suffix = USE_ENSEMBLE ? '-ensemble' : '';
  // Estrategia MIXTA: PD=per-liga, PL=global, BL1=global (igual que gen-calibration)
  const MIXED_STRATEGY: Record<string, 'perLg' | 'global'> = { PD: 'perLg', PL: 'global', BL1: 'global' };
  const strategy = MIXED_STRATEGY[leagueCode] ?? 'global';
  if (strategy === 'perLg') {
    const perLgFile = path.join(calDir, `v3-iso-calibration-${leagueCode}${suffix}.json`);
    const tbl = loadCalibrationTable(perLgFile);
    if (tbl) return tbl;
  }
  // Fallback a global
  const globalFile = path.join(calDir, `v3-iso-calibration${suffix}.json`);
  return loadCalibrationTable(globalFile);
}

// ── xG desde disco ──────────────────────────────────────────────────────────

/**
 * Disco de xG raw (formato cache/xg/{leagueId}/{season}/{fixtureId}.json).
 * Los team IDs usan formato API-Football (team:apifootball:*), distintos
 * de los IDs del backtest (team:football-data:*). No son joinables por ID.
 */
interface RawXgFile {
  fixtureId: number;
  utcDate: string;
  homeTeamId: string;
  awayTeamId: string;
  xgHome: number;
  xgAway: number;
  cachedAt: string;
}

/** Mapeo leagueCode → API-Football leagueId para resolver el path de disco. */
const XG_LEAGUE_ID: Record<string, number> = {
  PD: 140,
  PL: 39,
  BL1: 78,
};

/**
 * Carga todos los archivos xG de disco para una liga.
 * Los archivos están en cache/xg/{afLeagueId}/{season}/{fixtureId}.json.
 * Retorna los registros raw — los team IDs son team:apifootball:*.
 */
function loadRawXgFiles(leagueCode: string): RawXgFile[] {
  const afId = XG_LEAGUE_ID[leagueCode];
  if (afId === undefined) return [];

  const xgBase = path.join(process.cwd(), 'cache', 'xg', String(afId));
  if (!fs.existsSync(xgBase)) return [];

  const records: RawXgFile[] = [];
  // Iterar sobre seasons (e.g., 2025/)
  for (const season of fs.readdirSync(xgBase)) {
    const seasonDir = path.join(xgBase, season);
    if (!fs.statSync(seasonDir).isDirectory()) continue;
    for (const file of fs.readdirSync(seasonDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8')) as RawXgFile;
        if (typeof raw.xgHome === 'number' && typeof raw.xgAway === 'number' && raw.utcDate) {
          records.push(raw);
        }
      } catch {
        // skip corrupt files
      }
    }
  }
  return records;
}

/**
 * Construye un XgRecord[] con los IDs correctos (team:football-data:*)
 * usando matching por fecha + proximidad de score.
 *
 * Estrategia:
 *   1. Agrupar los archivos xG por fecha (YYYY-MM-DD).
 *   2. Para cada fecha, agrupar los partidos del backtest (que tienen goals reales).
 *   3. Resolver el matching óptimo entre xG records y backtest records minimizando
 *      la distancia |xgHome - actualGoals_home| + |xgAway - actualGoals_away|.
 *      (Greedy: asignar el par con menor distancia primero, sin repetir.)
 *   4. Construir XgRecord[] con los team IDs del backtest match asignado.
 *
 * @param rawXg  Records crudos (team:apifootball:* IDs)
 * @param allBacktestMatches  Todos los partidos FINISHED del backtest (con goals reales)
 * @returns XgRecord[] con team IDs de football-data, joinables por augmentMatchesWithXg
 */
function resolveXgWithFdIds(
  rawXg: RawXgFile[],
  allBacktestMatches: { utcDate: string; homeTeamId: string; awayTeamId: string; homeGoals: number; awayGoals: number }[],
): { records: XgRecord[]; matchedCount: number; totalXg: number } {
  // Agrupar xG por fecha
  const xgByDate = new Map<string, RawXgFile[]>();
  for (const xg of rawXg) {
    const day = xg.utcDate.slice(0, 10);
    if (!xgByDate.has(day)) xgByDate.set(day, []);
    xgByDate.get(day)!.push(xg);
  }

  // Agrupar partidos del backtest por fecha
  const backtestByDate = new Map<string, typeof allBacktestMatches>();
  for (const m of allBacktestMatches) {
    const day = m.utcDate.slice(0, 10);
    if (!backtestByDate.has(day)) backtestByDate.set(day, []);
    backtestByDate.get(day)!.push(m);
  }

  const result: XgRecord[] = [];
  let matchedCount = 0;

  for (const [day, xgList] of xgByDate) {
    const btList = backtestByDate.get(day);
    if (!btList || btList.length === 0) continue;

    // Matching greedy por distancia mínima: para cada xG record, encontrar
    // el backtest record no asignado con menor costo.
    // Construir matrix de costos: cost[i][j] = dist(xgList[i], btList[j])
    const usedBt = new Set<number>();
    const usedXg = new Set<number>();

    // Ordenar pares por costo ascendente y asignar greedy
    const pairs: { cost: number; xi: number; bi: number }[] = [];
    for (let xi = 0; xi < xgList.length; xi++) {
      for (let bi = 0; bi < btList.length; bi++) {
        const xg = xgList[xi];
        const bt = btList[bi];
        const cost = Math.abs(xg.xgHome - bt.homeGoals) + Math.abs(xg.xgAway - bt.awayGoals);
        pairs.push({ cost, xi, bi });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);

    for (const { xi, bi } of pairs) {
      if (usedXg.has(xi) || usedBt.has(bi)) continue;
      usedXg.add(xi);
      usedBt.add(bi);

      const xg = xgList[xi];
      const bt = btList[bi];

      result.push({
        utcDate: bt.utcDate,       // usar la fecha exacta del backtest (ISO con Z)
        homeTeamId: bt.homeTeamId, // IDs football-data — joinables por augmentMatchesWithXg
        awayTeamId: bt.awayTeamId,
        xgHome: xg.xgHome,
        xgAway: xg.xgAway,
      });
      matchedCount++;
    }
  }

  return { records: result, matchedCount, totalXg: rawXg.length };
}

// ── Tipos de cache ──────────────────────────────────────────────────────────

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

// ── Config de ligas ─────────────────────────────────────────────────────────

interface LeagueConfig {
  name: string;
  dir: string;
  expectedSeasonGames: number;
}

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

interface LeagueConfigFull extends LeagueConfig {
  prevSeasonFile: string;
}

const LEAGUES: LeagueConfigFull[] = [
  { name: 'LaLiga (PD)',         dir: path.join(CACHE_BASE, 'PD',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PD',  '2024-25', 'prev-season.json') },
  { name: 'Premier League (PL)', dir: path.join(CACHE_BASE, 'PL',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PL',  '2024-25', 'prev-season.json') },
  { name: 'Bundesliga (BL1)',    dir: path.join(CACHE_BASE, 'BL1', '2025-26'), expectedSeasonGames: 34, prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json') },
];

function loadPrevSeason(file: string): V3MatchRecord[] {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw?.matches ?? [];
  } catch { return []; }
}

/** Carga datos del cache histórico (formato FinishedMatchRecord, compatible con V3MatchRecord). */
function loadHistoricalCache(code: string, year: number): V3MatchRecord[] {
  const file = path.join(process.cwd(), 'cache', 'historical', 'football-data', code, `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const matches: V3MatchRecord[] = raw?.matches ?? [];
    return matches;
  } catch { return []; }
}

/** Combina 2023-24 y 2024-25 como prevSeason — replica comportamiento de producción. */
function buildPrevSeasonMatches(code: string, prevSeasonFile: string): V3MatchRecord[] {
  const fromFetch = loadPrevSeason(prevSeasonFile);       // 2024-25 (fetched via API)
  const from2024  = loadHistoricalCache(code, 2024);      // 2024-25 del cache histórico
  const from2023  = loadHistoricalCache(code, 2023);      // 2023-24 del cache histórico
  // Preferir datos del cache histórico (formato canónico de producción);
  // si no hay, usar los fetched
  const prev2425 = from2024.length > 0 ? from2024 : fromFetch;
  return [...from2023, ...prev2425];
}

// ── Carga de archivos de cache ──────────────────────────────────────────────

function loadMatchdayFiles(leagueDir: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  if (!fs.existsSync(leagueDir)) return result;

  const files = fs.readdirSync(leagueDir)
    .filter(f => f.match(/^matchday-\d+\.json$/))
    .sort();

  for (const file of files) {
    const num = parseInt(file.match(/(\d+)/)?.[1] ?? '0', 10);
    if (!num) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(leagueDir, file), 'utf-8'));
      const matches: CachedMatch[] = raw?.data?.matches ?? [];
      result.set(num, matches);
    } catch {
      // skip corrupt files
    }
  }
  return result;
}

// ── Mapeo cache → V3MatchRecord ────────────────────────────────────────────

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

// ── Resultado real ──────────────────────────────────────────────────────────

function actualOutcome(m: CachedMatch): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway) return 'HOME_WIN';
  if (m.scoreAway > m.scoreHome) return 'AWAY_WIN';
  return 'DRAW';
}

// ── Resultados de backtest ───────────────────────────────────────────────────

interface MatchEval {
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  predicted: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | 'TOO_CLOSE' | null;
  eligibility: string;
  confidence: string;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
}

// ── Adaptar MatchEval → PredictionRecord para métricas de probabilidad ──────

function toPredictionRecords(evals: MatchEval[]): PredictionRecord[] {
  const records: PredictionRecord[] = [];
  for (const e of evals) {
    // Solo incluir registros con probabilidades disponibles
    if (e.p_home === null || e.p_draw === null || e.p_away === null) continue;
    if (e.predicted === null) continue;

    // Mapear actual: HOME_WIN→HOME, AWAY_WIN→AWAY, DRAW→DRAW
    const actual_outcome =
      e.actual === 'HOME_WIN' ? 'HOME'
      : e.actual === 'AWAY_WIN' ? 'AWAY'
      : 'DRAW';

    // Mapear predicted: HOME_WIN→HOME, AWAY_WIN→AWAY, DRAW→DRAW, TOO_CLOSE→TOO_CLOSE
    const predicted_result =
      e.predicted === 'HOME_WIN' ? 'HOME'
      : e.predicted === 'AWAY_WIN' ? 'AWAY'
      : e.predicted === 'DRAW' ? 'DRAW'
      : 'TOO_CLOSE';  // TOO_CLOSE

    records.push({
      predicted_result,
      actual_outcome,
      calibrated_probs: { home: e.p_home, draw: e.p_draw, away: e.p_away },
    });
  }
  return records;
}

// ── Backtest por liga ───────────────────────────────────────────────────────

function backtestLeague(
  league: LeagueConfigFull,
  oddsIndex: OddsIndex,
  logisticCoefficients?: LogisticCoefficients,
  xgRecords?: XgRecord[],
): MatchEval[] {
  const allMatchdays = loadMatchdayFiles(league.dir);
  const code = path.basename(path.dirname(league.dir)); // 'PD', 'PL', 'BL1'
  const prevSeasonMatches = buildPrevSeasonMatches(code, league.prevSeasonFile);
  // Siempre cargar calibración (igual que producción). Con --ensemble, usa tablas -ensemble.
  const calibrationTable = getCalibrationTable(code);
  if (allMatchdays.size === 0) return [];

  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);
  const evals: MatchEval[] = [];

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);

    if (testMatches.length === 0) continue;

    // Training: todos los partidos de jornadas anteriores
    const trainingRecords: V3MatchRecord[] = [];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of (allMatchdays.get(prevMd) ?? [])) {
        const rec = toV3Record(m);
        if (rec) trainingRecords.push(rec);
      }
    }

    for (const match of testMatches) {
      const actual = actualOutcome(match);
      if (!actual) continue;

      // Look up pre-match market odds (score-based — valid for FINISHED matches)
      const oddsHit = lookupOdds(oddsIndex, code, match.startTimeUtc, match.scoreHome!, match.scoreAway!);
      const marketOdds = oddsHit
        ? { probHome: oddsHit.impliedProbHome, probDraw: oddsHit.impliedProbDraw, probAway: oddsHit.impliedProbAway, capturedAtUtc: match.startTimeUtc }
        : undefined;

      const input: V3EngineInput = {
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        kickoffUtc: match.startTimeUtc,
        buildNowUtc: match.startTimeUtc,
        currentSeasonMatches: trainingRecords,
        prevSeasonMatches: prevSeasonMatches,
        expectedSeasonGames: league.expectedSeasonGames,
        leagueCode: code,
        marketOdds,
        ...(calibrationTable ? { calibrationTable } : {}),
        // §T3-01: xG augmentation — inyectar cuando --xg está activo
        ...(xgRecords !== undefined && xgRecords.length > 0 ? { historicalXg: xgRecords } : {}),
        // §SP-V4-11: inject MARKET_WEIGHT override when provided
        // §SP-V4-23: inject ENSEMBLE_ENABLED when --ensemble flag is set
        _overrideConstants: {
          ...(USE_ENSEMBLE ? { ENSEMBLE_ENABLED: true } : {}),
          ...(MARKET_WEIGHT_OVERRIDE !== undefined ? { MARKET_WEIGHT: MARKET_WEIGHT_OVERRIDE } : {}),
        },
        ...(USE_ENSEMBLE ? { logisticCoefficients } : {}),
      };

      let predicted: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | 'TOO_CLOSE' | null = null;
      let eligibility = 'NOT_ELIGIBLE';
      let confidence = 'INSUFFICIENT';
      let p_home: number | null = null;
      let p_draw: number | null = null;
      let p_away: number | null = null;

      try {
        const out = runV3Engine(input);
        eligibility = out.eligibility;
        confidence = out.confidence;
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

      evals.push({ actual, predicted, eligibility, confidence, p_home, p_draw, p_away });
    }
  }

  return evals;
}

// ── Formateo ────────────────────────────────────────────────────────────────

const LINE = '─'.repeat(72);
const pct = (c: number, t: number) => t > 0 ? `${(c / t * 100).toFixed(1)}%` : 'N/A';
const bar = (ratio: number) => {
  const n = Math.round(ratio * 20);
  return '[' + '█'.repeat(n) + '░'.repeat(20 - n) + ']';
};

function printLeagueReport(name: string, evals: MatchEval[]): void {
  const total = evals.length;
  if (total === 0) {
    console.log(`\n${name}: sin datos`);
    return;
  }

  // Distribución de eligibilidad
  const byMode: Record<string, number> = {};
  for (const e of evals) {
    byMode[e.eligibility] = (byMode[e.eligibility] ?? 0) + 1;
  }

  // Solo evaluables (FULL o LIMITED con predicción)
  const evaluable = evals.filter(e =>
    e.eligibility !== 'NOT_ELIGIBLE' &&
    e.eligibility !== 'ERROR' &&
    e.predicted !== null &&
    e.predicted !== 'TOO_CLOSE'
  );

  const tooClose = evals.filter(e => e.predicted === 'TOO_CLOSE').length;
  const notElig = evals.filter(e => e.eligibility === 'NOT_ELIGIBLE' || e.eligibility === 'ERROR').length;

  const hits = evaluable.filter(e => e.predicted === e.actual).length;
  const ev = evaluable.length;

  console.log(`\n${LINE}`);
  console.log(`  ${name}`);
  console.log(LINE);
  console.log(`  Total partidos     : ${total}`);
  console.log(`  NOT_ELIGIBLE       : ${notElig} (${pct(notElig, total)})`);
  console.log(`  TOO_CLOSE          : ${tooClose}`);
  console.log(`  Evaluables         : ${ev}`);
  console.log(`  Accuracy general   : ${hits}/${ev} = ${pct(hits, ev)}  (baseline naive ≈45%)`);

  // Distribución de eligibilidad
  console.log(`\n  Modo operativo:`);
  for (const [mode, count] of Object.entries(byMode).sort()) {
    console.log(`    ${mode.padEnd(16)} ${count.toString().padStart(3)}  (${pct(count, total)})`);
  }

  // Por resultado real — incluyendo DRAW recall
  console.log(`\n  Por resultado real:`);
  for (const outcome of ['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const) {
    const sub = evaluable.filter(e => e.actual === outcome);
    const subHits = sub.filter(e => e.predicted === outcome).length;
    const label = outcome === 'HOME_WIN' ? 'Local ganó ' : outcome === 'DRAW' ? 'Empate     ' : 'Visitante  ';
    const ratio = sub.length > 0 ? subHits / sub.length : 0;
    console.log(`    ${label} ${subHits}/${sub.length} ${pct(subHits, sub.length)} ${bar(ratio)}`);
  }

  // ¿El motor predice empates? — la pregunta clave
  const predictedDraw = evaluable.filter(e => e.predicted === 'DRAW').length;
  const actualDraw = evaluable.filter(e => e.actual === 'DRAW').length;
  const drawPrecision = predictedDraw > 0
    ? evaluable.filter(e => e.predicted === 'DRAW' && e.actual === 'DRAW').length / predictedDraw
    : 0;
  console.log(`\n  DRAW diagnosis:`);
  console.log(`    Empates reales     : ${actualDraw} (${pct(actualDraw, ev)} del total)`);
  console.log(`    Empates predichos  : ${predictedDraw} (${pct(predictedDraw, ev)} del total)`);
  if (predictedDraw > 0) {
    console.log(`    Precision DRAW     : ${pct(Math.round(drawPrecision * predictedDraw), predictedDraw)}`);
  }

  // Por confianza
  console.log(`\n  Por confianza:`);
  for (const conf of ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'] as const) {
    const sub = evaluable.filter(e => e.confidence === conf);
    if (sub.length === 0) continue;
    const subHits = sub.filter(e => e.predicted === e.actual).length;
    const ratio = sub.length > 0 ? subHits / sub.length : 0;
    const label = conf.padEnd(12);
    console.log(`    ${label} ${subHits}/${sub.length} ${pct(subHits, sub.length)} ${bar(ratio)}`);
  }

  // Distribución de p_draw — ¿el motor tiene señal de empate?
  const withProbs = evals.filter(e => e.p_draw !== null);
  if (withProbs.length > 0) {
    const pDrawValues = withProbs.map(e => e.p_draw!);
    const avg = pDrawValues.reduce((a, b) => a + b, 0) / pDrawValues.length;
    const max = Math.max(...pDrawValues);
    const over30 = pDrawValues.filter(v => v >= 0.30).length;
    const over35 = pDrawValues.filter(v => v >= 0.35).length;
    console.log(`\n  p_draw (distribución):`);
    console.log(`    Promedio           : ${avg.toFixed(3)}`);
    console.log(`    Máximo             : ${max.toFixed(3)}`);
    console.log(`    p_draw ≥ 0.30      : ${over30} partidos`);
    console.log(`    p_draw ≥ 0.35      : ${over35} partidos`);
    console.log(`    (DRAW se predice cuando p_draw es la probabilidad máxima)`);
  }

  // Métricas de probabilidad §23.2: log_loss, Brier score, RPS
  const probRecords = toPredictionRecords(evals);
  if (probRecords.length > 0) {
    const pm = computeProbabilityMetrics(probRecords);
    console.log(`\n  Métricas de probabilidad (§23.2) — n=${probRecords.length}:`);
    console.log(`    log_loss           : ${pm.log_loss.toFixed(4)}  (lower is better)`);
    console.log(`    brier_score        : ${pm.brier_score.toFixed(4)}  (lower is better)`);
    console.log(`    rps                : ${pm.rps.toFixed(4)}  (lower is better; baseline≈0.222)`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const modeLabel = USE_ENSEMBLE
  ? 'ENSEMBLE activo (w_poisson=0.95, w_logistic=0.05) + calibración post-ensemble'
  : 'Poisson puro (ENSEMBLE_ENABLED=false)';
const mwLabel = MARKET_WEIGHT_OVERRIDE !== undefined
  ? ` | MARKET_WEIGHT=${MARKET_WEIGHT_OVERRIDE} (override §SP-V4-11)`
  : ' | MARKET_WEIGHT=0.20 (constants.ts, optimizado §SP-V4-11)';
console.log(`\nSportsPulse — Backtest del motor PE v1.3 (runV3Engine)\n`);
console.log(`Metodología: walk-forward por jornada, sin data leakage`);
console.log(`Motor: runV3Engine — ${modeLabel}${mwLabel}\n`);

// Cargar coeficientes logísticos si --ensemble
let logisticCoefficients: LogisticCoefficients | undefined;
if (USE_ENSEMBLE) {
  logisticCoefficients = loadLogisticCoefficients();
  const trainedOn = (logisticCoefficients as { trained_on_matches?: number } | undefined)?.trained_on_matches ?? '?';
  console.log(`[ENSEMBLE] Coeficientes logísticos: trained_on_matches=${trainedOn}`);
  // Verify calibration tables exist
  const calDir = path.join(process.cwd(), 'cache', 'calibration');
  const ensembleGlobalFile = path.join(calDir, 'v3-iso-calibration-ensemble.json');
  if (!fs.existsSync(ensembleGlobalFile)) {
    console.warn('[WARN] Tabla de calibración ensemble no encontrada:', ensembleGlobalFile);
    console.warn('[WARN] Ejecuta primero: pnpm tsx tools/gen-calibration.ts --ensemble');
    console.warn('[WARN] Continuando SIN calibración (solo ensemble)...\n');
  } else {
    console.log(`[ENSEMBLE] Calibración: v3-iso-calibration-ensemble.json (estrategia MIXTA)\n`);
  }
}

// Cargar índice de odds (football-data.co.uk) para market features
const oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
console.log(`[ODDS] Índice cargado: ${oddsIndex.size} registros\n`);

// ── xG desde disco — carga y matching de IDs ─────────────────────────────
// Los archivos xG usan team:apifootball:* IDs. El backtest usa team:football-data:*.
// Resolver mapping vía fecha + proximidad de score (greedy bipartite assignment).
const xgByLeague = new Map<string, { records: XgRecord[]; matchedCount: number; totalXg: number }>();

if (USE_XG) {
  console.log('[XG] Cargando xG desde disco y resolviendo IDs...');
  for (const league of LEAGUES) {
    const code = path.basename(path.dirname(league.dir)); // 'PD', 'PL', 'BL1'
    const rawXg = loadRawXgFiles(code);

    // Construir lista de todos los partidos FINISHED del backtest (con goals reales)
    // para hacer el matching por fecha + score
    const allMatchdays = loadMatchdayFiles(league.dir);
    const backtestMatchesFlat: { utcDate: string; homeTeamId: string; awayTeamId: string; homeGoals: number; awayGoals: number }[] = [];
    for (const matches of allMatchdays.values()) {
      for (const m of matches) {
        if (m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc) {
          backtestMatchesFlat.push({
            utcDate: m.startTimeUtc,
            homeTeamId: m.homeTeamId,
            awayTeamId: m.awayTeamId,
            homeGoals: m.scoreHome,
            awayGoals: m.scoreAway,
          });
        }
      }
    }

    const resolved = resolveXgWithFdIds(rawXg, backtestMatchesFlat);
    xgByLeague.set(code, resolved);

    const coveragePct = backtestMatchesFlat.length > 0
      ? (resolved.matchedCount / backtestMatchesFlat.length * 100).toFixed(1)
      : '0.0';
    console.log(`  ${code}: ${rawXg.length} archivos xG → ${resolved.matchedCount} matched / ${backtestMatchesFlat.length} partidos (${coveragePct}% cobertura)`);
  }
  console.log();
}

const allEvals: MatchEval[] = [];

for (const league of LEAGUES) {
  const code = path.basename(path.dirname(league.dir));
  const prevExists = fs.existsSync(league.prevSeasonFile) || fs.existsSync(path.join(process.cwd(), 'cache', 'historical', 'football-data', path.basename(path.dirname(path.dirname(league.prevSeasonFile))), '2024.json'));
  process.stdout.write(`Procesando ${league.name}${prevExists ? ' [+2yr prev]' : ''}... `);
  const xgForLeague = USE_XG ? xgByLeague.get(code)?.records : undefined;
  const evals = backtestLeague(league, oddsIndex, logisticCoefficients, xgForLeague);
  allEvals.push(...evals);
  console.log(`${evals.length} partidos cargados`);
  printLeagueReport(league.name, evals);
}

// ── Total global ─────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(72)}`);
console.log('  TOTAL (3 ligas)');
console.log('═'.repeat(72));

const totalEv = allEvals.filter(e =>
  e.eligibility !== 'NOT_ELIGIBLE' &&
  e.eligibility !== 'ERROR' &&
  e.predicted !== null &&
  e.predicted !== 'TOO_CLOSE'
);
const totalHits = totalEv.filter(e => e.predicted === e.actual).length;
const totalNotElig = allEvals.filter(e => e.eligibility === 'NOT_ELIGIBLE' || e.eligibility === 'ERROR').length;
const totalTooClose = allEvals.filter(e => e.predicted === 'TOO_CLOSE').length;

console.log(`  Total partidos     : ${allEvals.length}`);
console.log(`  NOT_ELIGIBLE       : ${totalNotElig} (${pct(totalNotElig, allEvals.length)})`);
console.log(`  TOO_CLOSE          : ${totalTooClose}`);
console.log(`  Accuracy global    : ${totalHits}/${totalEv.length} = ${pct(totalHits, totalEv.length)}`);

const totalDraw = totalEv.filter(e => e.actual === 'DRAW').length;
const totalPredDraw = totalEv.filter(e => e.predicted === 'DRAW').length;
const totalHitDraw = totalEv.filter(e => e.predicted === 'DRAW' && e.actual === 'DRAW').length;
console.log(`  DRAW recall        : ${totalHitDraw}/${totalDraw} = ${pct(totalHitDraw, totalDraw)}`);
console.log(`  DRAW predichos     : ${totalPredDraw} / ${totalEv.length} = ${pct(totalPredDraw, totalEv.length)}`);

// Métricas de probabilidad global §23.2
const globalProbRecords = toPredictionRecords(allEvals);
if (globalProbRecords.length > 0) {
  const gpm = computeProbabilityMetrics(globalProbRecords);
  console.log(`\n  Métricas de probabilidad global (§23.2) — n=${globalProbRecords.length}:`);
  console.log(`    log_loss           : ${gpm.log_loss.toFixed(4)}  (lower is better)`);
  console.log(`    brier_score        : ${gpm.brier_score.toFixed(4)}  (lower is better)`);
  console.log(`    rps                : ${gpm.rps.toFixed(4)}  (lower is better; baseline≈0.222)`);
}
console.log('═'.repeat(72));
console.log();

/**
 * sweep-ensemble-weights.ts — §SP-V4-22: Búsqueda de pesos óptimos del ensemble.
 *
 * Spec: SP-PRED-V4.md §SP-V4-22
 *
 * Busca los pesos óptimos para el ensemble Poisson + Market + Logistic.
 * Ahora que las odds históricas están disponibles (cache/odds-data/), el sweep
 * incluye las 3 fuentes. El grid es 1D: se fija w_market (del resultado de
 * sweep-market-weight.ts o via --market-weight) y se barre w_logistic ∈ [0.00..0.20];
 * el resto va al Poisson: w_poisson = 1 - w_market - w_logistic.
 *
 * Metodología:
 *   1. Correr walk-forward una sola vez con collectIntermediates=true para
 *      obtener probs Poisson, logísticas y de mercado por partido.
 *   2. Cargar coeficientes logísticos de cache/logistic-coefficients.json.
 *   3. Leer w_market óptimo de cache/market-weight-sweep.json; fallback a 0.15.
 *   4. Grid 1D sobre w_logistic ∈ [0.00, 0.05, 0.10, 0.15, 0.20].
 *   5. Para cada punto: mezclar probs en memoria y calcular métricas.
 *   6. Ordenar por Composite DESC = 0.4*acc + 0.3*DR + 0.3*DP.
 *   7. Guardar resultado en cache/ensemble-weights-sweep.json.
 *   8. Actualizar ENSEMBLE_WEIGHTS_DEFAULT en constants.ts si hay mejora.
 *
 * Flags:
 *   --comp PD,PL          Filtrar ligas.
 *   --min-window N        Mínimo de partidos de training (default: 80).
 *   --market-weight 0.15  Override de w_market fijo para el sweep 1D.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/sweep-ensemble-weights.ts
 *   npx tsx --tsconfig tsconfig.server.json tools/sweep-ensemble-weights.ts --comp PD,PL --min-window 60
 *   npx tsx --tsconfig tsconfig.server.json tools/sweep-ensemble-weights.ts --market-weight 0.20
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput } from '../packages/prediction/src/engine/v3/types.js';
import {
  extractLogisticFeatures,
  predictLogistic,
  DEFAULT_LOGISTIC_COEFFICIENTS,
  type LogisticCoefficients,
} from '../packages/prediction/src/engine/v3/logistic-model.js';
import { buildOddsIndex, lookupOdds, type OddsIndex } from './odds-lookup.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface CachedMatch {
  matchId:      string;
  matchday:     number;
  startTimeUtc: string;
  status:       string;
  homeTeamId:   string;
  awayTeamId:   string;
  scoreHome:    number | null;
  scoreAway:    number | null;
}

interface LeagueConfig {
  name:                string;
  code:                string;
  dir:                 string;
  expectedSeasonGames: number;
  prevSeasonFile:      string;
}

/** Una muestra del walk-forward: probs Poisson + probs Logístico + probs Mercado + resultado real. */
interface WalkForwardSample {
  leagueCode:      string;
  actual:          'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  /** Probabilidades del engine Poisson puro (componente Poisson del ensemble). */
  pPoisson:        { home: number; draw: number; away: number };
  /** Probabilidades del modelo logístico aplicado a los intermediates. */
  pLogistic:       { home: number; draw: number; away: number };
  /** Probabilidades implícitas del mercado (de-vigged). null cuando no hay odds. */
  pMarket:         { home: number; draw: number; away: number } | null;
  /** true cuando hay odds de mercado disponibles para este partido. */
  hasMarketOdds:   boolean;
}

interface SweepResult {
  w_poisson:      number;
  w_market:       number;
  w_logistic:     number;
  accuracy:       number;
  draw_recall:    number;
  draw_precision: number;
  rps:            number;
  log_loss:       number;
  composite:      number;
  n:              number;
  n_with_market:  number;
}

interface SweepOutput {
  swept_at:    string;
  n_matches:   number;
  comp_filter: string;
  min_window:  number;
  results:     SweepResult[];
  optimal:     {
    w_poisson:  number;
    w_market:   number;
    w_logistic: number;
    composite:  number;
  };
}

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let compFilter: string[] = ['PD', 'PL', 'BL1'];
let minWindow = 80;
/** CLI override for fixed w_market. If NaN, auto-detect from cache/market-weight-sweep.json. */
let marketWeightCliOverride: number | undefined = undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--comp' && args[i + 1]) {
    compFilter = args[++i].split(',').map(s => s.trim().toUpperCase());
  }
  if (args[i] === '--min-window' && args[i + 1]) {
    minWindow = parseInt(args[++i], 10);
  }
  if (args[i] === '--market-weight' && args[i + 1]) {
    const v = parseFloat(args[++i]);
    if (!isNaN(v)) marketWeightCliOverride = v;
  }
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const CACHE_BASE          = path.join(process.cwd(), 'cache', 'football-data');
const HIST_BASE           = path.join(process.cwd(), 'cache', 'historical', 'football-data');
const COEF_PATH           = path.join(process.cwd(), 'cache', 'logistic-coefficients.json');
const SWEEP_OUT_PATH      = path.join(process.cwd(), 'cache', 'ensemble-weights-sweep.json');
const MKT_SWEEP_PATH      = path.join(process.cwd(), 'cache', 'market-weight-sweep.json');
const CONSTANTS_PATH      = path.join(process.cwd(), 'packages', 'prediction', 'src', 'engine', 'v3', 'constants.ts');

const ALL_LEAGUES: LeagueConfig[] = [
  {
    name: 'LaLiga (PD)', code: 'PD',
    dir:  path.join(CACHE_BASE, 'PD',  '2025-26'),
    expectedSeasonGames: 38,
    prevSeasonFile: path.join(CACHE_BASE, 'PD', '2024-25', 'prev-season.json'),
  },
  {
    name: 'Premier League (PL)', code: 'PL',
    dir:  path.join(CACHE_BASE, 'PL',  '2025-26'),
    expectedSeasonGames: 38,
    prevSeasonFile: path.join(CACHE_BASE, 'PL', '2024-25', 'prev-season.json'),
  },
  {
    name: 'Bundesliga (BL1)', code: 'BL1',
    dir:  path.join(CACHE_BASE, 'BL1', '2025-26'),
    expectedSeasonGames: 34,
    prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json'),
  },
];

const LEAGUES = ALL_LEAGUES.filter(l => compFilter.includes(l.code));

// ── Cache loading helpers ────────────────────────────────────────────────────

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

function buildPrevSeasonMatches(code: string, prevSeasonFile: string): V3MatchRecord[] {
  const fromFetch = loadPrevSeason(prevSeasonFile);
  const from2024  = loadHistoricalCache(code, 2024);
  const from2023  = loadHistoricalCache(code, 2023);
  const prev2425  = from2024.length > 0 ? from2024 : fromFetch;
  return [...from2023, ...prev2425];
}

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
    } catch { /* skip */ }
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

function actualOutcome(m: CachedMatch): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway) return 'HOME_WIN';
  if (m.scoreAway > m.scoreHome) return 'AWAY_WIN';
  return 'DRAW';
}

// ── Logistic coefficient loading ──────────────────────────────────────────────

function loadLogisticCoefficients(): LogisticCoefficients {
  if (!fs.existsSync(COEF_PATH)) {
    console.warn(`  [WARN] No se encontró ${COEF_PATH} — usando coeficientes por defecto (todos ceros).`);
    console.warn('  [WARN] Ejecutar tools/train-logistic.ts primero para mejores resultados.');
    return DEFAULT_LOGISTIC_COEFFICIENTS;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(COEF_PATH, 'utf-8'));
    console.log(`  [INFO] Coeficientes logísticos cargados: entrenados sobre ${raw.trained_on_matches} partidos (${raw.trained_at})`);
    return raw as LogisticCoefficients;
  } catch (err) {
    console.warn(`  [WARN] Error leyendo ${COEF_PATH}: ${err}. Usando defaults.`);
    return DEFAULT_LOGISTIC_COEFFICIENTS;
  }
}

// ── Walk-forward (una sola pasada) ───────────────────────────────────────────

function collectWalkForwardSamples(
  league: LeagueConfig,
  coefficients: LogisticCoefficients,
  oddsIndex: OddsIndex,
): WalkForwardSample[] {
  const allMatchdays = loadMatchdayFiles(league.dir);
  if (allMatchdays.size === 0) return [];

  const prevSeasonMatches = buildPrevSeasonMatches(league.code, league.prevSeasonFile);
  const sortedMatchdays   = [...allMatchdays.keys()].sort((a, b) => a - b);
  const samples: WalkForwardSample[] = [];

  for (const md of sortedMatchdays) {
    // Acumular training: todos los partidos de jornadas anteriores
    const trainingRecords: V3MatchRecord[] = [];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of (allMatchdays.get(prevMd) ?? [])) {
        const rec = toV3Record(m);
        if (rec) trainingRecords.push(rec);
      }
    }

    // Respetar min-window: saltar si hay muy pocos partidos de entrenamiento de la temporada actual
    if (trainingRecords.length < minWindow) continue;

    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);

    for (const match of testMatches) {
      const actual = actualOutcome(match);
      if (!actual) continue;

      // §SP-V4-11: lookup market odds for this match
      const oddsHit = lookupOdds(oddsIndex, league.code, match.startTimeUtc, match.scoreHome!, match.scoreAway!);

      const input: V3EngineInput = {
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        kickoffUtc: match.startTimeUtc,
        buildNowUtc: match.startTimeUtc,
        currentSeasonMatches: trainingRecords,
        prevSeasonMatches,
        expectedSeasonGames: league.expectedSeasonGames,
        leagueCode: league.code,
        collectIntermediates: true,
        // Pass market odds to engine (weight=0 so probs are pure Poisson — market is captured separately)
        marketOdds: oddsHit
          ? { probHome: oddsHit.impliedProbHome, probDraw: oddsHit.impliedProbDraw, probAway: oddsHit.impliedProbAway, capturedAtUtc: match.startTimeUtc }
          : undefined,
        _overrideConstants: {
          // Force MARKET_WEIGHT=0 so pPoisson is free of market influence
          MARKET_WEIGHT: 0,
        },
      };

      try {
        const out = runV3Engine(input);

        // Saltar partidos sin probabilidades (NOT_ELIGIBLE)
        if (
          out.prob_home_win === null ||
          out.prob_draw     === null ||
          out.prob_away_win === null
        ) continue;

        const pPoisson = {
          home: out.prob_home_win,
          draw: out.prob_draw,
          away: out.prob_away_win,
        };

        // Extraer features logísticas desde _intermediates
        if (!out._intermediates) continue;

        const im = out._intermediates;
        const features = extractLogisticFeatures({
          lambdaHome:       im.lambdaHome,
          lambdaAway:       im.lambdaAway,
          restDaysHome:     im.restDaysHome,
          restDaysAway:     im.restDaysAway,
          h2hMultHome:      im.h2hMultHome,
          h2hMultAway:      im.h2hMultAway,
          absenceScoreHome: im.absenceScoreHome,
          absenceScoreAway: im.absenceScoreAway,
          xgCoverage:       im.xgCoverage,
          leagueCode:       league.code,
          // §SP-V4-11: include market features when available
          marketImpHome: oddsHit?.impliedProbHome,
          marketImpDraw: oddsHit?.impliedProbDraw,
          marketImpAway: oddsHit?.impliedProbAway,
        });

        const logRaw = predictLogistic(features, coefficients);
        const pLogistic = {
          home: logRaw.probHome,
          draw: logRaw.probDraw,
          away: logRaw.probAway,
        };

        // §SP-V4-11: capture market probs (de-vigged implied probs)
        const pMarket = oddsHit
          ? { home: oddsHit.impliedProbHome, draw: oddsHit.impliedProbDraw, away: oddsHit.impliedProbAway }
          : null;

        samples.push({
          leagueCode: league.code,
          actual,
          pPoisson,
          pLogistic,
          pMarket,
          hasMarketOdds: oddsHit !== null,
        });

      } catch {
        // skip errores del engine
      }
    }
  }

  return samples;
}

// ── Métricas para un conjunto de muestras y unos pesos dados ─────────────────

function argmax3(home: number, draw: number, away: number): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (home >= draw && home >= away) return 'HOME_WIN';
  if (draw >= home && draw >= away) return 'DRAW';
  return 'AWAY_WIN';
}

/**
 * Ranked Probability Score para una predicción trinomial.
 * RPS = (1/2) * sum_k((F_k - O_k)^2) donde F es la CDF de la predicción y O la CDF del resultado.
 * Las clases están ordenadas: HOME_WIN (0), DRAW (1), AWAY_WIN (2).
 */
function rpsOneSample(
  pH: number, pD: number, pA: number,
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
): number {
  // CDF predicha
  const F1 = pH;        // P(resultado <= HOME_WIN)
  const F2 = pH + pD;   // P(resultado <= DRAW)

  // CDF observada
  const O1 = actual === 'HOME_WIN' ? 1 : 0;
  const O2 = actual === 'HOME_WIN' || actual === 'DRAW' ? 1 : 0;

  return 0.5 * ((F1 - O1) ** 2 + (F2 - O2) ** 2);
}

/**
 * Log loss clipped para evitar log(0).
 */
function logLossOneSample(
  pH: number, pD: number, pA: number,
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
): number {
  const EPS = 1e-15;
  const p = actual === 'HOME_WIN' ? pH : actual === 'DRAW' ? pD : pA;
  return -Math.log(Math.max(p, EPS));
}

/**
 * §SP-V4-11: Compute metrics for a 3-way ensemble blend (Poisson + Market + Logistic).
 *
 * wMarket is fixed (from sweep-market-weight optimal or CLI override).
 * wLogistic is the sweep variable.
 * wPoisson = 1 - wMarket - wLogistic (remainder).
 *
 * For samples without market odds, the market component is redistributed
 * proportionally to Poisson and Logistic (wPoisson' = wPoisson / (1 - wMarket),
 * wLogistic' = wLogistic / (1 - wMarket)).
 */
function computeMetrics(
  samples:   WalkForwardSample[],
  wMarket:   number,
  wLogistic: number,
): SweepResult {
  const wPoisson = Math.max(0, 1.0 - wMarket - wLogistic);
  const n = samples.length;
  const nWithMarket = samples.filter(s => s.hasMarketOdds).length;

  let correct     = 0;
  let drawActual  = 0;
  let drawPredYes = 0;
  let drawTP      = 0;
  let totalRPS    = 0;
  let totalLL     = 0;

  for (const s of samples) {
    let rawH: number;
    let rawD: number;
    let rawA: number;

    if (s.hasMarketOdds && s.pMarket !== null && wMarket > 0) {
      // Full 3-way blend: Poisson + Market + Logistic
      rawH = wPoisson * s.pPoisson.home + wMarket * s.pMarket.home + wLogistic * s.pLogistic.home;
      rawD = wPoisson * s.pPoisson.draw + wMarket * s.pMarket.draw + wLogistic * s.pLogistic.draw;
      rawA = wPoisson * s.pPoisson.away + wMarket * s.pMarket.away + wLogistic * s.pLogistic.away;
    } else {
      // No market odds available: redistribute wMarket to Poisson and Logistic proportionally
      const denominator = wPoisson + wLogistic;
      const wP2 = denominator > 0 ? wPoisson  / denominator : 0.5;
      const wL2 = denominator > 0 ? wLogistic / denominator : 0.5;
      rawH = wP2 * s.pPoisson.home + wL2 * s.pLogistic.home;
      rawD = wP2 * s.pPoisson.draw + wL2 * s.pLogistic.draw;
      rawA = wP2 * s.pPoisson.away + wL2 * s.pLogistic.away;
    }

    // Renormalizar (defensivo)
    const sum = rawH + rawD + rawA;
    const pH  = sum > 0 ? rawH / sum : 1 / 3;
    const pD  = sum > 0 ? rawD / sum : 1 / 3;
    const pA  = sum > 0 ? rawA / sum : 1 / 3;

    const predicted = argmax3(pH, pD, pA);

    if (predicted === s.actual)   correct++;
    if (s.actual   === 'DRAW')    drawActual++;
    if (predicted  === 'DRAW')    drawPredYes++;
    if (predicted  === 'DRAW' && s.actual === 'DRAW') drawTP++;

    totalRPS += rpsOneSample(pH, pD, pA, s.actual);
    totalLL  += logLossOneSample(pH, pD, pA, s.actual);
  }

  const accuracy       = n > 0 ? correct      / n         : 0;
  const draw_recall    = drawActual  > 0 ? drawTP / drawActual  : 0;
  const draw_precision = drawPredYes > 0 ? drawTP / drawPredYes : 0;
  const rps            = n > 0 ? totalRPS / n : 0;
  const log_loss       = n > 0 ? totalLL  / n : 0;
  const composite      = 0.4 * accuracy + 0.3 * draw_recall + 0.3 * draw_precision;

  return {
    w_poisson:      wPoisson,
    w_market:       wMarket,
    w_logistic:     wLogistic,
    accuracy,
    draw_recall,
    draw_precision,
    rps,
    log_loss,
    composite,
    n,
    n_with_market: nWithMarket,
  };
}

// ── Formateo de tabla ─────────────────────────────────────────────────────────

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const f4  = (v: number) => v.toFixed(4);

function printTable(results: SweepResult[], fixedMarketWeight: number): void {
  const LINE = '─'.repeat(96);
  console.log(`\n${LINE}`);
  console.log(
    `  w_pois  w_mkt  w_log  Accuracy  DR       DP       Composite  RPS     LogLoss   n`
  );
  console.log(LINE);
  for (const r of results) {
    const markerBaseline = r.w_logistic === 0 ? '  ← baseline' : '';
    console.log(
      `  ${r.w_poisson.toFixed(2)}    ${r.w_market.toFixed(2)}   ${r.w_logistic.toFixed(2)}   ` +
      `${pct(r.accuracy).padEnd(9)} ${pct(r.draw_recall).padEnd(8)} ` +
      `${pct(r.draw_precision).padEnd(8)} ` +
      `${f4(r.composite).padEnd(10)} ${f4(r.rps).padEnd(8)} ${f4(r.log_loss).padEnd(9)} ` +
      `${r.n}${markerBaseline}`
    );
  }
  console.log(LINE);
}

// ── Resolver w_market fijo desde cache o CLI ──────────────────────────────────

function resolveFixedMarketWeight(): number {
  // CLI override always wins
  if (marketWeightCliOverride !== undefined) {
    console.log(`  [INFO] w_market fijo desde CLI: ${marketWeightCliOverride}`);
    return marketWeightCliOverride;
  }
  // Try to read from market-weight-sweep.json
  if (fs.existsSync(MKT_SWEEP_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(MKT_SWEEP_PATH, 'utf-8'));
      const w = raw?.optimal?.market_weight;
      if (typeof w === 'number' && !isNaN(w)) {
        console.log(`  [INFO] w_market fijo desde cache/market-weight-sweep.json: ${w} (swept_at: ${raw.swept_at})`);
        return w;
      }
    } catch { /* fall through */ }
  }
  // Fallback to current constants.ts value
  console.log(`  [INFO] w_market fijo: 0.15 (default constants.ts — ejecuta sweep-market-weight.ts para optimizar)`);
  return 0.15;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n SportPulse — §SP-V4-22: Ensemble Weight Sweep (Poisson + Market + Logistic)\n');
console.log(`  Ligas:       ${compFilter.join(', ')}`);
console.log(`  Min-window:  ${minWindow} partidos de temporada actual para entrenamiento`);
console.log(`  Grid:        w_logistic ∈ [0.00, 0.05, 0.10, 0.15, 0.20] (1D, w_market fijo)`);
console.log('');

// ── Paso 1: Resolver w_market fijo ───────────────────────────────────────────

console.log('Paso 1: Resolviendo w_market fijo para el sweep...');
const FIXED_MARKET_WEIGHT = resolveFixedMarketWeight();

// ── Paso 2: Cargar coeficientes logísticos ────────────────────────────────────

console.log('\nPaso 2: Cargando coeficientes logísticos...');
const logisticCoefficients = loadLogisticCoefficients();
const isDefaultCoefs = logisticCoefficients.trained_on_matches === 0;
if (isDefaultCoefs) {
  console.log('  [WARN] Usando coeficientes por defecto — logístico producirá probs uniformes (33.3%).');
  console.log('  [WARN] El sweep con coefs=0 es informativo pero no representa el ensemble real.');
}

// ── Paso 3: Cargar índice de odds ─────────────────────────────────────────────

console.log('\nPaso 3: Cargando índice de odds (football-data.co.uk)...');
const oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
console.log(`  ${oddsIndex.size} registros indexados`);

// ── Paso 4: Recolectar muestras walk-forward ──────────────────────────────────

console.log('\nPaso 4: Recolectando muestras walk-forward (collectIntermediates=true)...');
const allSamples: WalkForwardSample[] = [];

for (const league of LEAGUES) {
  process.stdout.write(`  ${league.name}... `);
  if (!fs.existsSync(league.dir)) {
    console.log('directorio no encontrado — omitida.');
    continue;
  }
  const samples = collectWalkForwardSamples(league, logisticCoefficients, oddsIndex);
  allSamples.push(...samples);
  const nOdds = samples.filter(s => s.hasMarketOdds).length;
  const covStr = samples.length > 0 ? ` | odds: ${nOdds}/${samples.length} (${pct(nOdds / samples.length)})` : '';
  console.log(`${samples.length} partidos (ventana >= ${minWindow})${covStr}`);
}

if (allSamples.length === 0) {
  console.error('\nERROR: Sin muestras para el sweep. Verificar cache de datos.');
  process.exit(1);
}
const nWithMarket = allSamples.filter(s => s.hasMarketOdds).length;
console.log(`  Total: ${allSamples.length} partidos | odds: ${nWithMarket}/${allSamples.length} (${pct(allSamples.length > 0 ? nWithMarket / allSamples.length : 0)} cobertura)`);

// ── Paso 5: Grid search 1D sobre w_logistic ───────────────────────────────────

console.log(`\nPaso 5: Grid search sobre w_logistic (w_market=${FIXED_MARKET_WEIGHT} fijo)...`);

const W_LOGISTIC_GRID = [0.00, 0.05, 0.10, 0.15, 0.20];
const sweepResults: SweepResult[] = [];

for (const wL of W_LOGISTIC_GRID) {
  const r = computeMetrics(allSamples, FIXED_MARKET_WEIGHT, wL);
  sweepResults.push(r);
}

// Ordenar por Composite DESC, luego por accuracy DESC como desempate
const sorted = [...sweepResults].sort((a, b) => {
  if (Math.abs(b.composite - a.composite) > 1e-6) return b.composite - a.composite;
  return b.accuracy - a.accuracy;
});

const optimal  = sorted[0];
const baseline = sweepResults.find(r => r.w_logistic === 0) ?? sweepResults[sweepResults.length - 1];

// ── Paso 6: Imprimir tabla ────────────────────────────────────────────────────

console.log('\nResultados (ordenados por Composite DESC = 0.4*acc + 0.3*DR + 0.3*DP):');
printTable(sorted, FIXED_MARKET_WEIGHT);

console.log(`\n  Baseline (w_log=0.00):   composite=${f4(baseline.composite)} | acc=${pct(baseline.accuracy)} | DR=${pct(baseline.draw_recall)} | DP=${pct(baseline.draw_precision)}`);
console.log(`  Óptimo   (w_log=${optimal.w_logistic.toFixed(2)}):   composite=${f4(optimal.composite)} | acc=${pct(optimal.accuracy)} | DR=${pct(optimal.draw_recall)} | DP=${pct(optimal.draw_precision)}`);

const delta = optimal.composite - baseline.composite;
if (delta > 0.001) {
  console.log(`  Mejora sobre baseline: +${f4(delta)} composite`);
} else if (delta > 0) {
  console.log(`  Mejora marginal sobre baseline: +${f4(delta)} composite (< 0.001 — posiblemente ruido)`);
} else {
  console.log(`  Sin mejora sobre baseline (Δ=${f4(delta)}). Mantener w_logistic=0.00.`);
}

// ── Paso 7: Guardar JSON ──────────────────────────────────────────────────────

console.log('\nPaso 7: Guardando resultados...');

const outputData: SweepOutput = {
  swept_at:    new Date().toISOString(),
  n_matches:   allSamples.length,
  comp_filter: compFilter.join(','),
  min_window:  minWindow,
  results:     sorted,
  optimal: {
    w_poisson:  optimal.w_poisson,
    w_market:   optimal.w_market,
    w_logistic: optimal.w_logistic,
    composite:  optimal.composite,
  },
};

const cacheDir = path.join(process.cwd(), 'cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

const tmpPath = `${SWEEP_OUT_PATH}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(outputData, null, 2), 'utf-8');
fs.renameSync(tmpPath, SWEEP_OUT_PATH);
console.log(`  Guardado en: ${SWEEP_OUT_PATH}`);

// ── Paso 8: Actualizar constants.ts si hay mejora ─────────────────────────────

console.log('\nPaso 8: Evaluando actualización de ENSEMBLE_WEIGHTS_DEFAULT...');

// Solo actualizar si hay mejora real (>= 0.001 composite) y los coeficientes no son los de defecto
if (delta >= 0.001 && !isDefaultCoefs) {
  console.log(`  Mejora significativa detectada (Δ=${f4(delta)}). Actualizando constants.ts...`);

  const src = fs.readFileSync(CONSTANTS_PATH, 'utf-8');
  const mktComment = optimal.w_market > 0
    ? `  // odds históricas activas — ${pct(nWithMarket / Math.max(allSamples.length, 1))} cobertura`
    : `  // w_market=0 — sin mejora de mercado o cobertura insuficiente`;
  const newDefault =
    `export const ENSEMBLE_WEIGHTS_DEFAULT = {\n` +
    `  w_poisson:  ${optimal.w_poisson.toFixed(2)},\n` +
    `  w_market:   ${optimal.w_market.toFixed(2)},${mktComment}\n` +
    `  w_logistic: ${optimal.w_logistic.toFixed(2)},\n` +
    `} as const;`;

  // Reemplazar el bloque export const ENSEMBLE_WEIGHTS_DEFAULT = { ... } as const;
  const updated = src.replace(
    /export const ENSEMBLE_WEIGHTS_DEFAULT = \{[\s\S]*?\} as const;/,
    newDefault,
  );

  if (updated === src) {
    console.log('  [WARN] No se pudo localizar ENSEMBLE_WEIGHTS_DEFAULT en constants.ts — actualización manual requerida.');
    console.log(`  [INFO] Valor óptimo: { w_poisson: ${optimal.w_poisson.toFixed(2)}, w_market: ${optimal.w_market.toFixed(2)}, w_logistic: ${optimal.w_logistic.toFixed(2)} }`);
  } else {
    const tmpConst = `${CONSTANTS_PATH}.tmp`;
    fs.writeFileSync(tmpConst, updated, 'utf-8');
    fs.renameSync(tmpConst, CONSTANTS_PATH);
    console.log(`  constants.ts actualizado: w_poisson=${optimal.w_poisson.toFixed(2)}, w_market=${optimal.w_market.toFixed(2)}, w_logistic=${optimal.w_logistic.toFixed(2)}`);
  }
} else {
  if (isDefaultCoefs) {
    console.log('  constants.ts NO actualizado — coeficientes logísticos son defaults (ceros).');
    console.log('  Ejecutar tools/train-logistic.ts y luego re-correr este sweep.');
  } else if (delta < 0.001) {
    console.log(`  constants.ts NO actualizado — mejora insuficiente (Δ=${f4(delta)} < 0.001).`);
    console.log('  Mantener ENSEMBLE_WEIGHTS_DEFAULT actual.');
  }
}

console.log('\n Sweep completo.\n');

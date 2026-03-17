/**
 * sweep-market-weight.ts — §SP-V4-11: Búsqueda del MARKET_WEIGHT óptimo.
 *
 * Spec: SP-PRED-V4.md §SP-V4-11
 *
 * Corre el walk-forward completo (sin ensemble, igual que backtest-v3.ts base)
 * para cada valor de MARKET_WEIGHT en el grid, midiendo el impacto en accuracy,
 * DRAW recall/precision, RPS y composite score.
 *
 * Metodología:
 *   1. Recolectar muestras walk-forward UNA sola vez con market odds.
 *      Cada muestra incluye las probs Poisson puras + las probs de mercado implícitas.
 *   2. Grid search sobre MARKET_WEIGHT ∈ [0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30].
 *   3. Para cada peso: mezclar probs en memoria (sin correr el engine de nuevo).
 *   4. Calcular métricas y reportar cobertura de odds.
 *   5. Guardar resultado en cache/market-weight-sweep.json.
 *   6. Actualizar MARKET_WEIGHT en constants.ts con el valor óptimo.
 *
 * Nota: el sweep opera sobre la mezcla Poisson + Market (sin calibración isotónica
 * ni draw affinity) para aislar el efecto de MARKET_WEIGHT. La calibración y el
 * draw affinity son pasos posteriores que se aplican en el backtest completo.
 * El MARKET_WEIGHT óptimo de este sweep es un proxy; el valor final debe
 * confirmarse con backtest-v3.ts --market-weight <val>.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/sweep-market-weight.ts
 *   npx tsx --tsconfig tsconfig.server.json tools/sweep-market-weight.ts --comp PD,PL
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput } from '../packages/prediction/src/engine/v3/types.js';
import { buildOddsIndex, lookupOdds, type OddsIndex } from './odds-lookup.js';
import { MARKET_WEIGHT_MAX } from '../packages/prediction/src/engine/v3/constants.js';

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

/**
 * Una muestra del walk-forward para el sweep:
 * - pPoisson: probs post-calibración del motor puro (sin market blend)
 * - pMarket:  probs implícitas del mercado (de-vigged), null si no hay odds
 * - actual:   resultado real
 */
interface MarketSweepSample {
  leagueCode:  string;
  actual:      'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  hasOdds:     boolean;
  /** Probs del motor Poisson puro (MARKET_WEIGHT=0). */
  pPoisson: { home: number; draw: number; away: number };
  /** Probs implícitas de mercado (de-vigged). Solo válidas cuando hasOdds=true. */
  pMarket:  { home: number; draw: number; away: number };
}

interface SweepResult {
  market_weight:  number;
  accuracy:       number;
  draw_recall:    number;
  draw_precision: number;
  rps:            number;
  log_loss:       number;
  composite:      number;
  /** Partidos en los que se aplica el blend (tienen odds). */
  n_with_odds:    number;
  /** Total de partidos evaluables. */
  n_total:        number;
  odds_coverage:  number;  // n_with_odds / n_total
}

interface SweepOutput {
  swept_at:     string;
  comp_filter:  string;
  grid:         number[];
  results:      SweepResult[];
  optimal: {
    market_weight: number;
    composite:     number;
    accuracy:      number;
    draw_recall:   number;
    draw_precision: number;
    rps:           number;
  };
  odds_coverage_overall: number;
}

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let compFilter: string[] = ['PD', 'PL', 'BL1'];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--comp' && args[i + 1]) {
    compFilter = args[++i].split(',').map(s => s.trim().toUpperCase());
  }
}

// ── Paths ────────────────────────────────────────────────────────────────────

const CACHE_BASE     = path.join(process.cwd(), 'cache', 'football-data');
const HIST_BASE      = path.join(process.cwd(), 'cache', 'historical', 'football-data');
const SWEEP_OUT_PATH = path.join(process.cwd(), 'cache', 'market-weight-sweep.json');
const CONSTANTS_PATH = path.join(process.cwd(), 'packages', 'prediction', 'src', 'engine', 'v3', 'constants.ts');

const ALL_LEAGUES: LeagueConfig[] = [
  {
    name: 'LaLiga (PD)', code: 'PD',
    dir:  path.join(CACHE_BASE, 'PD', '2025-26'),
    expectedSeasonGames: 38,
    prevSeasonFile: path.join(CACHE_BASE, 'PD', '2024-25', 'prev-season.json'),
  },
  {
    name: 'Premier League (PL)', code: 'PL',
    dir:  path.join(CACHE_BASE, 'PL', '2025-26'),
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

// ── Cache loading helpers ─────────────────────────────────────────────────────

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

// ── Walk-forward sample collection ───────────────────────────────────────────

/**
 * Corre el walk-forward con MARKET_WEIGHT=0 (motor puro Poisson) para obtener
 * las probs de referencia y las probs de mercado por separado.
 * De esta forma el sweep puede mezclar en memoria sin re-ejecutar el engine.
 *
 * NOTA: el motor se corre con MARKET_WEIGHT=0 (via _overrideConstants) para
 * obtener pPoisson sin contaminación de mercado. Las probs de mercado se toman
 * directamente del oddsIndex (de-vigged).
 */
function collectSamples(
  league: LeagueConfig,
  oddsIndex: OddsIndex,
): MarketSweepSample[] {
  const allMatchdays = loadMatchdayFiles(league.dir);
  if (allMatchdays.size === 0) return [];

  const prevSeasonMatches = buildPrevSeasonMatches(league.code, league.prevSeasonFile);
  const sortedMatchdays   = [...allMatchdays.keys()].sort((a, b) => a - b);
  const samples: MarketSweepSample[] = [];

  for (const md of sortedMatchdays) {
    const trainingRecords: V3MatchRecord[] = [];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      for (const m of (allMatchdays.get(prevMd) ?? [])) {
        const rec = toV3Record(m);
        if (rec) trainingRecords.push(rec);
      }
    }

    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);

    for (const match of testMatches) {
      const actual = actualOutcome(match);
      if (!actual) continue;

      // Lookup market odds
      const oddsHit = lookupOdds(oddsIndex, league.code, match.startTimeUtc, match.scoreHome!, match.scoreAway!);

      // Run engine with MARKET_WEIGHT=0 to get pure Poisson probs
      const input: V3EngineInput = {
        homeTeamId:           match.homeTeamId,
        awayTeamId:           match.awayTeamId,
        kickoffUtc:           match.startTimeUtc,
        buildNowUtc:          match.startTimeUtc,
        currentSeasonMatches: trainingRecords,
        prevSeasonMatches,
        expectedSeasonGames:  league.expectedSeasonGames,
        leagueCode:           league.code,
        // Pass market odds to engine (even though weight=0) so odds coverage is realistic
        marketOdds: oddsHit
          ? { probHome: oddsHit.impliedProbHome, probDraw: oddsHit.impliedProbDraw, probAway: oddsHit.impliedProbAway, capturedAtUtc: match.startTimeUtc }
          : undefined,
        _overrideConstants: {
          // Force MARKET_WEIGHT=0 to get pure Poisson probs
          MARKET_WEIGHT: 0,
        },
      };

      try {
        const out = runV3Engine(input);
        if (out.prob_home_win === null || out.prob_draw === null || out.prob_away_win === null) continue;
        if (out.eligibility === 'NOT_ELIGIBLE') continue;

        const pPoisson = { home: out.prob_home_win, draw: out.prob_draw, away: out.prob_away_win };
        const pMarket  = oddsHit
          ? { home: oddsHit.impliedProbHome, draw: oddsHit.impliedProbDraw, away: oddsHit.impliedProbAway }
          : { home: 1/3, draw: 1/3, away: 1/3 };  // dummy, won't be used (hasOdds=false)

        samples.push({
          leagueCode: league.code,
          actual,
          hasOdds: oddsHit !== null,
          pPoisson,
          pMarket,
        });
      } catch {
        // skip engine errors
      }
    }
  }

  return samples;
}

// ── Metrics for a given MARKET_WEIGHT ────────────────────────────────────────

function argmax3(h: number, d: number, a: number): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (h >= d && h >= a) return 'HOME_WIN';
  if (d >= h && d >= a) return 'DRAW';
  return 'AWAY_WIN';
}

function rpsOneSample(pH: number, pD: number, pA: number, actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'): number {
  const F1 = pH;
  const F2 = pH + pD;
  const O1 = actual === 'HOME_WIN' ? 1 : 0;
  const O2 = actual !== 'AWAY_WIN' ? 1 : 0;
  return 0.5 * ((F1 - O1) ** 2 + (F2 - O2) ** 2);
}

function logLossOneSample(pH: number, pD: number, pA: number, actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'): number {
  const EPS = 1e-15;
  const p = actual === 'HOME_WIN' ? pH : actual === 'DRAW' ? pD : pA;
  return -Math.log(Math.max(p, EPS));
}

function computeMetrics(samples: MarketSweepSample[], marketWeight: number): SweepResult {
  // Clamp to [0, MARKET_WEIGHT_MAX]
  const w = Math.min(Math.max(marketWeight, 0), MARKET_WEIGHT_MAX);
  const n = samples.length;
  const nWithOdds = samples.filter(s => s.hasOdds).length;

  let correct = 0;
  let drawActual  = 0;
  let drawPredYes = 0;
  let drawTP      = 0;
  let totalRPS    = 0;
  let totalLL     = 0;

  for (const s of samples) {
    let pH: number;
    let pD: number;
    let pA: number;

    if (w === 0 || !s.hasOdds) {
      // No blend — use pure Poisson probs
      pH = s.pPoisson.home;
      pD = s.pPoisson.draw;
      pA = s.pPoisson.away;
    } else {
      // Linear blend
      const rawH = (1 - w) * s.pPoisson.home + w * s.pMarket.home;
      const rawD = (1 - w) * s.pPoisson.draw + w * s.pMarket.draw;
      const rawA = (1 - w) * s.pPoisson.away + w * s.pMarket.away;
      const sum  = rawH + rawD + rawA;
      pH = sum > 0 ? rawH / sum : 1/3;
      pD = sum > 0 ? rawD / sum : 1/3;
      pA = sum > 0 ? rawA / sum : 1/3;
    }

    const predicted = argmax3(pH, pD, pA);

    if (predicted === s.actual) correct++;
    if (s.actual  === 'DRAW')   drawActual++;
    if (predicted === 'DRAW')   drawPredYes++;
    if (predicted === 'DRAW' && s.actual === 'DRAW') drawTP++;

    totalRPS += rpsOneSample(pH, pD, pA, s.actual);
    totalLL  += logLossOneSample(pH, pD, pA, s.actual);
  }

  const accuracy       = n > 0 ? correct / n : 0;
  const draw_recall    = drawActual  > 0 ? drawTP / drawActual  : 0;
  const draw_precision = drawPredYes > 0 ? drawTP / drawPredYes : 0;
  const rps            = n > 0 ? totalRPS / n : 0;
  const log_loss       = n > 0 ? totalLL  / n : 0;
  const composite      = 0.4 * accuracy + 0.3 * draw_recall + 0.3 * draw_precision;

  return {
    market_weight: marketWeight,
    accuracy,
    draw_recall,
    draw_precision,
    rps,
    log_loss,
    composite,
    n_with_odds: nWithOdds,
    n_total:     n,
    odds_coverage: n > 0 ? nWithOdds / n : 0,
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

const pct  = (v: number) => `${(v * 100).toFixed(1)}%`;
const f4   = (v: number) => v.toFixed(4);

function printTable(results: SweepResult[], baselineWeight: number): void {
  const LINE = '─'.repeat(96);
  console.log(`\n${LINE}`);
  console.log(
    '  w_mkt  Accuracy  DR       DP       Composite  RPS     LogLoss   n_odds/n_total  cov'
  );
  console.log(LINE);
  for (const r of results) {
    const marker = r.market_weight === baselineWeight ? '  ← current' : '';
    console.log(
      `  ${r.market_weight.toFixed(2)}   ` +
      `${pct(r.accuracy).padEnd(9)} ${pct(r.draw_recall).padEnd(8)} ` +
      `${pct(r.draw_precision).padEnd(8)} ` +
      `${f4(r.composite).padEnd(10)} ${f4(r.rps).padEnd(8)} ${f4(r.log_loss).padEnd(9)} ` +
      `${r.n_with_odds}/${r.n_total}   ${pct(r.odds_coverage)}${marker}`
    );
  }
  console.log(LINE);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const MARKET_WEIGHT_GRID = [0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
const CURRENT_MARKET_WEIGHT = 0.15; // valor actual en constants.ts

console.log('\n SportPulse — §SP-V4-11: MARKET_WEIGHT Sweep\n');
console.log(`  Ligas:   ${compFilter.join(', ')}`);
console.log(`  Grid:    MARKET_WEIGHT ∈ [${MARKET_WEIGHT_GRID.join(', ')}]`);
console.log(`  Actual:  MARKET_WEIGHT=${CURRENT_MARKET_WEIGHT} (constants.ts)\n`);

// Paso 1: Cargar índice de odds
console.log('Paso 1: Cargando índice de odds (football-data.co.uk)...');
const oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
console.log(`  ${oddsIndex.size} registros indexados\n`);

// Paso 2: Recolectar muestras walk-forward
console.log('Paso 2: Recolectando muestras walk-forward (MARKET_WEIGHT=0 para probs puras)...');
const allSamples: MarketSweepSample[] = [];

for (const league of LEAGUES) {
  process.stdout.write(`  ${league.name}... `);
  if (!fs.existsSync(league.dir)) {
    console.log('directorio no encontrado — omitida.');
    continue;
  }
  const samples = collectSamples(league, oddsIndex);
  allSamples.push(...samples);
  const nOdds = samples.filter(s => s.hasOdds).length;
  console.log(`${samples.length} partidos (${nOdds} con odds, ${pct(samples.length > 0 ? nOdds / samples.length : 0)} cobertura)`);
}

if (allSamples.length === 0) {
  console.error('\nERROR: Sin muestras para el sweep. Verificar cache de datos.');
  process.exit(1);
}

const totalWithOdds = allSamples.filter(s => s.hasOdds).length;
console.log(`  Total: ${allSamples.length} partidos | ${totalWithOdds} con odds (${pct(totalWithOdds / allSamples.length)} cobertura)\n`);

// Paso 3: Grid search
console.log('Paso 3: Grid search sobre MARKET_WEIGHT...');
const sweepResults: SweepResult[] = [];

for (const w of MARKET_WEIGHT_GRID) {
  const r = computeMetrics(allSamples, w);
  sweepResults.push(r);
}

// Ordenar por Composite DESC, luego accuracy DESC
const sorted = [...sweepResults].sort((a, b) => {
  if (Math.abs(b.composite - a.composite) > 1e-6) return b.composite - a.composite;
  return b.accuracy - a.accuracy;
});

const optimal    = sorted[0];
const baseline   = sweepResults.find(r => r.market_weight === 0)!;
const current    = sweepResults.find(r => r.market_weight === CURRENT_MARKET_WEIGHT)!;

// Paso 4: Imprimir tabla
console.log('\nResultados (ordenados por Composite DESC = 0.4*acc + 0.3*DR + 0.3*DP):');
printTable(sorted, CURRENT_MARKET_WEIGHT);

console.log(`\n  w=0.00 (sin mercado):    composite=${f4(baseline.composite)} | acc=${pct(baseline.accuracy)} | DR=${pct(baseline.draw_recall)} | DP=${pct(baseline.draw_precision)}`);
if (current && current.market_weight !== 0) {
  console.log(`  w=${CURRENT_MARKET_WEIGHT.toFixed(2)} (actual):       composite=${f4(current.composite)} | acc=${pct(current.accuracy)} | DR=${pct(current.draw_recall)} | DP=${pct(current.draw_precision)}`);
}
console.log(`  Óptimo (w=${optimal.market_weight.toFixed(2)}):          composite=${f4(optimal.composite)} | acc=${pct(optimal.accuracy)} | DR=${pct(optimal.draw_recall)} | DP=${pct(optimal.draw_precision)}`);

const deltaVsNoMarket = optimal.composite - baseline.composite;
const deltaVsCurrent  = current ? optimal.composite - current.composite : 0;
if (deltaVsNoMarket > 0.001) {
  console.log(`\n  Mejora vs sin mercado: +${f4(deltaVsNoMarket)} composite`);
} else {
  console.log(`\n  Sin mejora vs sin mercado (Δ=${f4(deltaVsNoMarket)})`);
}
if (current && Math.abs(deltaVsCurrent) > 0.001) {
  const sign = deltaVsCurrent > 0 ? '+' : '';
  console.log(`  Delta vs actual (w=${CURRENT_MARKET_WEIGHT}): ${sign}${f4(deltaVsCurrent)} composite`);
}

// Paso 5: Guardar JSON
console.log('\nPaso 5: Guardando resultados...');

const outputData: SweepOutput = {
  swept_at:     new Date().toISOString(),
  comp_filter:  compFilter.join(','),
  grid:         MARKET_WEIGHT_GRID,
  results:      sweepResults,  // en orden de grid, no de composite
  optimal: {
    market_weight:  optimal.market_weight,
    composite:      optimal.composite,
    accuracy:       optimal.accuracy,
    draw_recall:    optimal.draw_recall,
    draw_precision: optimal.draw_precision,
    rps:            optimal.rps,
  },
  odds_coverage_overall: allSamples.length > 0 ? totalWithOdds / allSamples.length : 0,
};

const cacheDir = path.join(process.cwd(), 'cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
const tmpPath = `${SWEEP_OUT_PATH}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(outputData, null, 2), 'utf-8');
fs.renameSync(tmpPath, SWEEP_OUT_PATH);
console.log(`  Guardado en: ${SWEEP_OUT_PATH}`);

// Paso 6: Actualizar constants.ts si hay mejora
console.log('\nPaso 6: Evaluando actualización de MARKET_WEIGHT en constants.ts...');

if (optimal.market_weight !== CURRENT_MARKET_WEIGHT && deltaVsNoMarket > 0.001) {
  console.log(`  Mejora detectada. Actualizando MARKET_WEIGHT=${CURRENT_MARKET_WEIGHT} → ${optimal.market_weight} en constants.ts...`);
  const src = fs.readFileSync(CONSTANTS_PATH, 'utf-8');
  const updated = src.replace(
    /^(export const MARKET_WEIGHT = )[\d.]+;/m,
    `$1${optimal.market_weight};`,
  );
  if (updated === src) {
    console.log('  [WARN] No se pudo localizar MARKET_WEIGHT en constants.ts — actualización manual requerida.');
    console.log(`  [INFO] Valor óptimo: MARKET_WEIGHT = ${optimal.market_weight}`);
  } else {
    const tmpConst = `${CONSTANTS_PATH}.tmp`;
    fs.writeFileSync(tmpConst, updated, 'utf-8');
    fs.renameSync(tmpConst, CONSTANTS_PATH);
    console.log(`  constants.ts actualizado: MARKET_WEIGHT=${optimal.market_weight}`);
    console.log(`  Ejecutar 'pnpm build' para confirmar que compila correctamente.`);
  }
} else if (deltaVsNoMarket <= 0) {
  console.log(`  Sin mejora sobre w=0. Considerar MARKET_WEIGHT=0 (sin mercado).`);
  console.log(`  constants.ts NO modificado — revisión manual necesaria.`);
} else {
  console.log(`  El valor actual (${CURRENT_MARKET_WEIGHT}) ya es el óptimo o la diferencia es marginal.`);
  console.log(`  constants.ts NO modificado.`);
}

console.log('\n Sweep completo.\n');

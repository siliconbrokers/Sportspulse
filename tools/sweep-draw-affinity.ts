/**
 * sweep-draw-affinity.ts — Grid search multidimensional de parámetros DrawAffinity.
 *
 * Objetivo: corregir sobrepredicción masiva de empates (41.1% predichos vs 26.7% real)
 * y subpredicción de victorias visitante (AWAY_WIN recall = 15.9%).
 *
 * Ejes del grid:
 *   DRAW_AFFINITY_ALPHA ∈ [0.00, 0.10, 0.20, 0.30, 0.40, 0.50]  (intensidad del boost)
 *   DRAW_FLOOR          ∈ [0.27, 0.30, 0.33, 0.36]               (piso mínimo para activar regla)
 *   DRAW_MARGIN         ∈ [0.05, 0.08, 0.10, 0.12]               (margen máximo para forzar DRAW)
 *
 * Total: 6 × 4 × 4 = 96 combinaciones.
 *
 * Metodología: walk-forward completo por liga (mismo que backtest-v3.ts).
 * Para cada combinación, todos los overrides se inyectan via _overrideConstants.
 *
 * Score compuesto: 0.4 * accuracy + 0.3 * draw_recall + 0.3 * draw_precision
 *
 * Criterio de selección del óptimo:
 *   1. accuracy > 49.0%  (baseline)
 *   2. draw_precision > 33.1%  (baseline)
 *   3. away_recall > 15.9%  (baseline)
 *   4. pct_draw_predicted ∈ [20%, 35%]
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/sweep-draw-affinity.ts
 *
 * Guarda: cache/draw-affinity-sweep.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput, CalibrationTable } from '../packages/prediction/src/engine/v3/types.js';
import { buildOddsIndex, lookupOdds, type OddsIndex } from './odds-lookup.js';

// ── Tipos ─────────────────────────────────────────────────────────────────────

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

interface MatchSample {
  actual:      'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  leagueCode:  string;
  kickoffUtc:  string;
  // Engine inputs needed for re-run with different overrides
  homeTeamId:  string;
  awayTeamId:  string;
  trainingSnapshot: V3MatchRecord[];
  prevSeasonMatches: V3MatchRecord[];
  expectedSeasonGames: number;
  marketOdds?: { probHome: number; probDraw: number; probAway: number; capturedAtUtc: string };
  calibrationTable?: CalibrationTable;
}

interface ComboResult {
  alpha:            number;
  floor:            number;
  margin:           number;
  accuracy:         number;
  draw_recall:      number;
  draw_precision:   number;
  away_recall:      number;
  home_recall:      number;
  pct_draw_predicted: number;
  composite:        number;
  n_evaluated:      number;
  n_draw_actual:    number;
  n_draw_predicted: number;
  n_away_actual:    number;
}

// ── Config de ligas ────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

const LEAGUES: LeagueConfig[] = [
  { name: 'LaLiga (PD)',         code: 'PD',  dir: path.join(CACHE_BASE, 'PD',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PD',  '2024-25', 'prev-season.json') },
  { name: 'Premier League (PL)', code: 'PL',  dir: path.join(CACHE_BASE, 'PL',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PL',  '2024-25', 'prev-season.json') },
  { name: 'Bundesliga (BL1)',    code: 'BL1', dir: path.join(CACHE_BASE, 'BL1', '2025-26'), expectedSeasonGames: 34, prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json') },
];

// ── Helpers de carga ──────────────────────────────────────────────────────────

function loadPrevSeason(file: string): V3MatchRecord[] {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw?.matches ?? [];
  } catch { return []; }
}

function loadHistoricalCache(code: string, year: number): V3MatchRecord[] {
  const file = path.join(process.cwd(), 'cache', 'historical', 'football-data', code, `${year}.json`);
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
  const prev2425 = from2024.length > 0 ? from2024 : fromFetch;
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
    } catch { /* skip corrupt */ }
  }
  return result;
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

function loadCalibrationTable(filePath: string): CalibrationTable | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CalibrationTable; }
  catch { return undefined; }
}

function getCalibrationTable(code: string): CalibrationTable | undefined {
  const calDir = path.join(process.cwd(), 'cache', 'calibration');
  const MIXED_STRATEGY: Record<string, 'perLg' | 'global'> = { PD: 'perLg', PL: 'global', BL1: 'global' };
  if ((MIXED_STRATEGY[code] ?? 'global') === 'perLg') {
    const tbl = loadCalibrationTable(path.join(calDir, `v3-iso-calibration-${code}.json`));
    if (tbl) return tbl;
  }
  return loadCalibrationTable(path.join(calDir, 'v3-iso-calibration.json'));
}

// ── Fase 1: Recolectar muestras walk-forward (una sola vez) ──────────────────

function collectSamples(oddsIndex: OddsIndex): MatchSample[] {
  const all: MatchSample[] = [];

  for (const league of LEAGUES) {
    const allMatchdays = loadMatchdayFiles(league.dir);
    if (allMatchdays.size === 0) {
      console.log(`  [${league.code}] sin datos de jornada`);
      continue;
    }
    const prevSeasonMatches = buildPrevSeasonMatches(league.code, league.prevSeasonFile);
    const calibrationTable  = getCalibrationTable(league.code);
    const sortedMatchdays   = [...allMatchdays.keys()].sort((a, b) => a - b);

    for (const md of sortedMatchdays) {
      const testMatches = (allMatchdays.get(md) ?? [])
        .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);
      if (testMatches.length === 0) continue;

      // Training: jornadas anteriores
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

        const oddsHit = lookupOdds(oddsIndex, league.code, match.startTimeUtc, match.scoreHome!, match.scoreAway!);
        const marketOdds = oddsHit
          ? { probHome: oddsHit.impliedProbHome, probDraw: oddsHit.impliedProbDraw, probAway: oddsHit.impliedProbAway, capturedAtUtc: match.startTimeUtc }
          : undefined;

        all.push({
          actual,
          leagueCode: league.code,
          kickoffUtc: match.startTimeUtc,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          trainingSnapshot: [...trainingRecords],
          prevSeasonMatches,
          expectedSeasonGames: league.expectedSeasonGames,
          marketOdds,
          calibrationTable,
        });
      }
    }
    console.log(`  [${league.code}] ${all.filter(s => s.leagueCode === league.code).length} muestras`);
  }
  return all;
}

// ── Fase 2: Evaluar una combinación de parámetros ────────────────────────────

function evalCombo(
  samples: MatchSample[],
  alpha: number,
  floor: number,
  margin: number,
): ComboResult {
  let nEval = 0;
  let nCorrect = 0;
  let nDrawActual = 0;
  let nDrawPredicted = 0;
  let nDrawCorrect = 0;
  let nAwayActual = 0;
  let nAwayCorrect = 0;
  let nHomeActual = 0;
  let nHomeCorrect = 0;

  for (const s of samples) {
    const input: V3EngineInput = {
      homeTeamId:           s.homeTeamId,
      awayTeamId:           s.awayTeamId,
      kickoffUtc:           s.kickoffUtc,
      buildNowUtc:          s.kickoffUtc,
      currentSeasonMatches: s.trainingSnapshot,
      prevSeasonMatches:    s.prevSeasonMatches,
      expectedSeasonGames:  s.expectedSeasonGames,
      leagueCode:           s.leagueCode,
      marketOdds:           s.marketOdds,
      calibrationTable:     s.calibrationTable,
      _overrideConstants: {
        DRAW_AFFINITY_ALPHA: alpha,
        DRAW_FLOOR:          floor,
        DRAW_MARGIN:         margin,
      },
    };

    try {
      const out = runV3Engine(input);
      if (
        out.eligibility === 'NOT_ELIGIBLE' ||
        out.predicted_result === null ||
        out.predicted_result === undefined
      ) continue;

      // 'TOO_CLOSE' / null: no account
      const predicted = out.predicted_result as string;
      if (predicted === 'TOO_CLOSE') continue;

      nEval++;

      const isCorrect = predicted === s.actual;
      if (isCorrect) nCorrect++;

      if (s.actual === 'DRAW') {
        nDrawActual++;
        if (predicted === 'DRAW') nDrawCorrect++;
      }
      if (s.actual === 'AWAY_WIN') {
        nAwayActual++;
        if (predicted === 'AWAY_WIN') nAwayCorrect++;
      }
      if (s.actual === 'HOME_WIN') {
        nHomeActual++;
        if (predicted === 'HOME_WIN') nHomeCorrect++;
      }
      if (predicted === 'DRAW') nDrawPredicted++;
    } catch {
      // skip engine errors
    }
  }

  const accuracy        = nEval > 0 ? nCorrect / nEval : 0;
  const draw_recall     = nDrawActual > 0 ? nDrawCorrect / nDrawActual : 0;
  const draw_precision  = nDrawPredicted > 0 ? nDrawCorrect / nDrawPredicted : 0;
  const away_recall     = nAwayActual > 0 ? nAwayCorrect / nAwayActual : 0;
  const home_recall     = nHomeActual > 0 ? nHomeCorrect / nHomeActual : 0;
  const pct_draw_pred   = nEval > 0 ? nDrawPredicted / nEval : 0;
  const composite       = 0.4 * accuracy + 0.3 * draw_recall + 0.3 * draw_precision;

  return {
    alpha, floor, margin,
    accuracy, draw_recall, draw_precision, away_recall, home_recall,
    pct_draw_predicted: pct_draw_pred,
    composite,
    n_evaluated:      nEval,
    n_draw_actual:    nDrawActual,
    n_draw_predicted: nDrawPredicted,
    n_away_actual:    nAwayActual,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('DrawAffinity Grid Sweep — 96 combinaciones (ALPHA × FLOOR × MARGIN)');
  console.log('='.repeat(72));

  // Cargar odds index (para paridad con backtest-v3.ts)
  let oddsIndex: OddsIndex;
  try {
    oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
    console.log(`[ODDS] Índice cargado: ${oddsIndex.size} registros`);
  } catch {
    console.warn('[WARN] Error building odds index — proceeding without market odds');
    oddsIndex = new Map();
  }

  // Fase 1: recolectar muestras (costoso — solo una vez)
  console.log('\nFase 1: Recolectando muestras walk-forward...');
  const samples = collectSamples(oddsIndex);
  console.log(`  Total muestras: ${samples.length}`);

  if (samples.length === 0) {
    console.error('ERROR: sin muestras — verificar que cache/football-data existe');
    process.exit(1);
  }

  // Fase 2: grid search
  const ALPHAS  = [0.00, 0.10, 0.20, 0.30, 0.40, 0.50];
  const FLOORS  = [0.27, 0.30, 0.33, 0.36];
  const MARGINS = [0.05, 0.08, 0.10, 0.12];

  const totalCombos = ALPHAS.length * FLOORS.length * MARGINS.length;
  console.log(`\nFase 2: Grid search ${totalCombos} combinaciones...`);

  const results: ComboResult[] = [];
  let done = 0;

  for (const alpha of ALPHAS) {
    for (const floor of FLOORS) {
      for (const margin of MARGINS) {
        const result = evalCombo(samples, alpha, floor, margin);
        results.push(result);
        done++;
        if (done % 16 === 0) {
          process.stdout.write(`  ${done}/${totalCombos} combinaciones evaluadas\r`);
        }
      }
    }
  }
  console.log(`  ${totalCombos}/${totalCombos} combinaciones evaluadas   `);

  // Baseline: valores actuales de constants.ts
  const baseline = results.find(r => r.alpha === 0.50 && r.floor === 0.27 && r.margin === 0.12);

  // Ordenar por accuracy DESC
  results.sort((a, b) => b.accuracy - a.accuracy);

  // Selección del óptimo: cumple criterios y max accuracy
  const BASELINE_ACC  = baseline ? baseline.accuracy  : 0;
  const BASELINE_DP   = baseline ? baseline.draw_precision : 0;
  const BASELINE_AR   = baseline ? baseline.away_recall    : 0;

  const eligible = results.filter(r =>
    r.accuracy > BASELINE_ACC &&
    r.draw_precision > BASELINE_DP &&
    r.away_recall > BASELINE_AR &&
    r.pct_draw_predicted >= 0.20 &&
    r.pct_draw_predicted <= 0.35,
  );
  const optimal = eligible.length > 0 ? eligible[0] : null; // ya ordenado por accuracy desc

  // Print top 20
  console.log('\n' + '─'.repeat(100));
  console.log('TOP 20 (por accuracy):');
  console.log('─'.repeat(100));
  const pct = (v: number) => (v * 100).toFixed(1) + '%';
  const hdr = 'ALPHA  FLOOR  MARGIN  Accuracy   DR        DP        AR        %DRAW     Composite  N_eval';
  console.log(hdr);
  console.log('─'.repeat(100));

  for (const r of results.slice(0, 20)) {
    const tag = (optimal && r.alpha === optimal.alpha && r.floor === optimal.floor && r.margin === optimal.margin)
      ? ' *** OPTIMO'
      : (baseline && r.alpha === baseline.alpha && r.floor === baseline.floor && r.margin === baseline.margin)
        ? ' --- BASE'
        : '';
    console.log(
      `${r.alpha.toFixed(2).padStart(5)}  ${r.floor.toFixed(2).padStart(5)}  ${r.margin.toFixed(2).padStart(6)}  ` +
      `${pct(r.accuracy).padStart(8)}  ${pct(r.draw_recall).padStart(8)}  ${pct(r.draw_precision).padStart(8)}  ` +
      `${pct(r.away_recall).padStart(8)}  ${pct(r.pct_draw_predicted).padStart(8)}  ` +
      `${r.composite.toFixed(4).padStart(9)}  ${r.n_evaluated.toString().padStart(6)}${tag}`,
    );
  }
  console.log('─'.repeat(100));

  if (baseline) {
    console.log('\nBaseline (valores actuales ALPHA=0.50 FLOOR=0.27 MARGIN=0.12):');
    console.log(
      `  accuracy=${pct(baseline.accuracy)} DR=${pct(baseline.draw_recall)} DP=${pct(baseline.draw_precision)} ` +
      `AR=${pct(baseline.away_recall)} %DRAW=${pct(baseline.pct_draw_predicted)} composite=${baseline.composite.toFixed(4)}`,
    );
  }

  if (optimal) {
    console.log('\n' + '='.repeat(72));
    console.log('OPTIMO ENCONTRADO:');
    console.log(`  DRAW_AFFINITY_ALPHA = ${optimal.alpha}`);
    console.log(`  DRAW_FLOOR          = ${optimal.floor}`);
    console.log(`  DRAW_MARGIN         = ${optimal.margin}`);
    console.log(`  accuracy            = ${pct(optimal.accuracy)}`);
    console.log(`  draw_recall         = ${pct(optimal.draw_recall)}`);
    console.log(`  draw_precision      = ${pct(optimal.draw_precision)}`);
    console.log(`  away_recall         = ${pct(optimal.away_recall)}`);
    console.log(`  pct_draw_predicted  = ${pct(optimal.pct_draw_predicted)}`);
    console.log(`  composite           = ${optimal.composite.toFixed(4)}`);
    console.log('='.repeat(72));
  } else {
    console.log('\nNinguna combinación satisface todos los criterios de selección.');
    // Mostrar la mejor por composite score de todas formas
    const bestComposite = [...results].sort((a, b) => b.composite - a.composite)[0];
    if (bestComposite) {
      console.log('Mejor por composite score (sin restricciones):');
      console.log(`  ALPHA=${bestComposite.alpha} FLOOR=${bestComposite.floor} MARGIN=${bestComposite.margin}`);
      console.log(`  accuracy=${pct(bestComposite.accuracy)} DR=${pct(bestComposite.draw_recall)} DP=${pct(bestComposite.draw_precision)} AR=${pct(bestComposite.away_recall)}`);
    }
  }

  // Guardar resultados
  const cacheDir = path.join(process.cwd(), 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const outputFile = path.join(cacheDir, 'draw-affinity-sweep.json');
  fs.writeFileSync(outputFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalSamples: samples.length,
    baseline: baseline ?? null,
    optimal: optimal ?? null,
    results,
  }, null, 2));
  console.log(`\nResultados guardados en: ${outputFile}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

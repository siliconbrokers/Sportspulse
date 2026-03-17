/**
 * sweep-draw-floor.ts — SP-DRAW-01: Grid search DRAW_FLOOR × DRAW_MARGIN.
 *
 * Objetivo: encontrar la combinación óptima de DRAW_FLOOR y DRAW_MARGIN
 * que permita al motor V4.3 predecir empates sin degradar la accuracy global.
 *
 * Hipótesis (SP-DRAW-V1 §3): con DRAW_AFFINITY_ENABLED=false, la p_draw
 * post-calibración es "honesta". Una regla FLOOR/MARGIN calibrada sobre
 * esta distribución puede capturar 10-15% de empates reales con precision>=30%.
 *
 * Grid:
 *   DRAW_FLOOR  ∈ [0.20, 0.21, ..., 0.35]  (16 valores, step 0.01)
 *   DRAW_MARGIN ∈ [0.02, 0.03, ..., 0.15]  (14 valores, step 0.01)
 *   Total: 16 × 14 = 224 combinaciones
 *   DRAW_AFFINITY_ENABLED = false (fijo)
 *   DRAW_FLOOR_ENABLED    = true  (lo que se evalúa)
 *
 * Filtros para el óptimo (SP-DRAW-V1 §3.2):
 *   acc >= 53.5% AND draw_precision >= 30% AND away_recall >= 30% AND coverage >= 70%
 *
 * Score compuesto: 0.4 * accuracy + 0.3 * draw_recall + 0.3 * draw_precision
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/sweep-draw-floor.ts
 *
 * Guarda: cache/draw-floor-sweep.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput, CalibrationTable } from '../packages/prediction/src/engine/v3/types.js';
import { buildOddsIndex, lookupOdds, type OddsIndex } from './odds-lookup.js';

// ── Tipos ──────────────────────────────────────────────────────────────────────

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
  actual:              'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  leagueCode:          string;
  kickoffUtc:          string;
  homeTeamId:          string;
  awayTeamId:          string;
  trainingSnapshot:    V3MatchRecord[];
  prevSeasonMatches:   V3MatchRecord[];
  expectedSeasonGames: number;
  marketOdds?:         { probHome: number; probDraw: number; probAway: number; capturedAtUtc: string };
  calibrationTable?:   CalibrationTable;
}

export interface ComboResult {
  draw_floor:         number;
  draw_margin:        number;
  accuracy:           number;
  draw_recall:        number;
  draw_precision:     number | null;
  away_recall:        number;
  home_recall:        number;
  pct_draw_pred:      number;
  coverage:           number;
  composite:          number;
  n_total:            number;
  n_evaluated:        number;
  n_draw_actual:      number;
  n_draw_predicted:   number;
  n_away_actual:      number;
  n_home_actual:      number;
  passes_filter:      boolean;
}

// ── Config de ligas ─────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

const LEAGUES: LeagueConfig[] = [
  { name: 'LaLiga (PD)',         code: 'PD',  dir: path.join(CACHE_BASE, 'PD',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PD',  '2024-25', 'prev-season.json') },
  { name: 'Premier League (PL)', code: 'PL',  dir: path.join(CACHE_BASE, 'PL',  '2025-26'), expectedSeasonGames: 38, prevSeasonFile: path.join(CACHE_BASE, 'PL',  '2024-25', 'prev-season.json') },
  { name: 'Bundesliga (BL1)',    code: 'BL1', dir: path.join(CACHE_BASE, 'BL1', '2025-26'), expectedSeasonGames: 34, prevSeasonFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json') },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function collectSamples(oddsIndex: OddsIndex): { samples: MatchSample[]; nTotal: number } {
  const all: MatchSample[] = [];
  let nTotal = 0;

  for (const league of LEAGUES) {
    const allMatchdays    = loadMatchdayFiles(league.dir);
    if (allMatchdays.size === 0) {
      console.log(`  [${league.code}] sin datos de jornada`);
      continue;
    }
    const prevSeasonMatches = buildPrevSeasonMatches(league.code, league.prevSeasonFile);
    const calibrationTable  = getCalibrationTable(league.code);
    const sortedMatchdays   = [...allMatchdays.keys()].sort((a, b) => a - b);

    let lgTotal = 0;

    for (const md of sortedMatchdays) {
      const testMatches = (allMatchdays.get(md) ?? [])
        .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);
      lgTotal += testMatches.length;

      if (testMatches.length === 0) continue;

      // Training: jornadas anteriores (anti-leakage)
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

        const oddsHit    = lookupOdds(oddsIndex, league.code, match.startTimeUtc, match.scoreHome!, match.scoreAway!);
        const marketOdds = oddsHit
          ? { probHome: oddsHit.impliedProbHome, probDraw: oddsHit.impliedProbDraw, probAway: oddsHit.impliedProbAway, capturedAtUtc: match.startTimeUtc }
          : undefined;

        all.push({
          actual,
          leagueCode:          league.code,
          kickoffUtc:          match.startTimeUtc,
          homeTeamId:          match.homeTeamId,
          awayTeamId:          match.awayTeamId,
          trainingSnapshot:    [...trainingRecords],
          prevSeasonMatches,
          expectedSeasonGames: league.expectedSeasonGames,
          marketOdds,
          ...(calibrationTable ? { calibrationTable } : {}),
        });
      }
    }

    nTotal += lgTotal;
    const lgSamples = all.filter(s => s.leagueCode === league.code).length;
    console.log(`  [${league.code}] ${lgSamples} muestras (${lgTotal} partidos cargados)`);
  }

  return { samples: all, nTotal };
}

// ── Baseline: evaluar sin DRAW_FLOOR (comportamiento actual) ─────────────────

function evalBaseline(samples: MatchSample[]): ComboResult {
  let nTotal = samples.length;
  let nEval = 0;
  let nCorrect = 0;
  let nDrawActual = 0;
  let nDrawCorrect = 0;
  let nDrawPredicted = 0;
  let nAwayActual = 0;
  let nAwayCorrect = 0;
  let nHomeActual = 0;
  let nHomeCorrect = 0;
  let nNotElig = 0;

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
        DRAW_AFFINITY_ENABLED: false,
        DRAW_FLOOR_ENABLED:    false,
      },
    };

    try {
      const out = runV3Engine(input);
      if (out.eligibility === 'NOT_ELIGIBLE') { nNotElig++; continue; }
      const predicted = out.predicted_result;
      if (predicted === null || predicted === undefined || (predicted as string) === 'TOO_CLOSE') continue;

      nEval++;
      if (predicted === s.actual) nCorrect++;
      if (s.actual === 'DRAW')     { nDrawActual++;  if (predicted === 'DRAW')     nDrawCorrect++;  }
      if (s.actual === 'AWAY_WIN') { nAwayActual++;  if (predicted === 'AWAY_WIN') nAwayCorrect++;  }
      if (s.actual === 'HOME_WIN') { nHomeActual++;  if (predicted === 'HOME_WIN') nHomeCorrect++;  }
      if (predicted === 'DRAW') nDrawPredicted++;
    } catch { nNotElig++; }
  }

  const accuracy       = nEval > 0 ? nCorrect / nEval : 0;
  const draw_recall    = nDrawActual > 0 ? nDrawCorrect / nDrawActual : 0;
  const draw_precision = nDrawPredicted > 0 ? nDrawCorrect / nDrawPredicted : null;
  const away_recall    = nAwayActual > 0 ? nAwayCorrect / nAwayActual : 0;
  const home_recall    = nHomeActual > 0 ? nHomeCorrect / nHomeActual : 0;
  const pct_draw_pred  = nEval > 0 ? nDrawPredicted / nEval : 0;
  const coverage       = nTotal > 0 ? nEval / nTotal : 0;
  const dp             = draw_precision ?? 0;
  const composite      = 0.4 * accuracy + 0.3 * draw_recall + 0.3 * dp;

  return {
    draw_floor: 0, draw_margin: 0,
    accuracy, draw_recall, draw_precision, away_recall, home_recall,
    pct_draw_pred, coverage, composite,
    n_total: nTotal, n_evaluated: nEval,
    n_draw_actual: nDrawActual, n_draw_predicted: nDrawPredicted,
    n_away_actual: nAwayActual, n_home_actual: nHomeActual,
    passes_filter: false,
  };
}

// ── Fase 2: Evaluar una combinación ──────────────────────────────────────────

function evalCombo(
  samples: MatchSample[],
  drawFloor: number,
  drawMargin: number,
): ComboResult {
  const nTotal = samples.length;
  let nEval = 0;
  let nCorrect = 0;
  let nDrawActual = 0;
  let nDrawCorrect = 0;
  let nDrawPredicted = 0;
  let nAwayActual = 0;
  let nAwayCorrect = 0;
  let nHomeActual = 0;
  let nHomeCorrect = 0;
  let nNotElig = 0;

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
        DRAW_AFFINITY_ENABLED: false,
        DRAW_FLOOR_ENABLED:    true,
        DRAW_FLOOR:            drawFloor,
        DRAW_MARGIN:           drawMargin,
      },
    };

    try {
      const out = runV3Engine(input);
      if (out.eligibility === 'NOT_ELIGIBLE') { nNotElig++; continue; }
      const predicted = out.predicted_result;
      if (predicted === null || predicted === undefined || (predicted as string) === 'TOO_CLOSE') continue;

      nEval++;
      if (predicted === s.actual) nCorrect++;
      if (s.actual === 'DRAW')     { nDrawActual++;  if (predicted === 'DRAW')     nDrawCorrect++;  }
      if (s.actual === 'AWAY_WIN') { nAwayActual++;  if (predicted === 'AWAY_WIN') nAwayCorrect++;  }
      if (s.actual === 'HOME_WIN') { nHomeActual++;  if (predicted === 'HOME_WIN') nHomeCorrect++;  }
      if (predicted === 'DRAW') nDrawPredicted++;
    } catch { nNotElig++; }
  }

  const accuracy       = nEval > 0 ? nCorrect / nEval : 0;
  const draw_recall    = nDrawActual > 0 ? nDrawCorrect / nDrawActual : 0;
  const draw_precision = nDrawPredicted > 0 ? nDrawCorrect / nDrawPredicted : null;
  const away_recall    = nAwayActual > 0 ? nAwayCorrect / nAwayActual : 0;
  const home_recall    = nHomeActual > 0 ? nHomeCorrect / nHomeActual : 0;
  const pct_draw_pred  = nEval > 0 ? nDrawPredicted / nEval : 0;
  const coverage       = nTotal > 0 ? nEval / nTotal : 0;
  const dp             = draw_precision ?? 0;
  const composite      = 0.4 * accuracy + 0.3 * draw_recall + 0.3 * dp;

  // Filtros del óptimo (SP-DRAW-V1 §3.2)
  const passesFilter =
    accuracy       >= 0.535 &&
    (draw_precision ?? 0) >= 0.30 &&
    away_recall    >= 0.30 &&
    coverage       >= 0.70;

  return {
    draw_floor: drawFloor, draw_margin: drawMargin,
    accuracy, draw_recall, draw_precision, away_recall, home_recall,
    pct_draw_pred, coverage, composite,
    n_total: nTotal, n_evaluated: nEval,
    n_draw_actual: nDrawActual, n_draw_predicted: nDrawPredicted,
    n_away_actual: nAwayActual, n_home_actual: nHomeActual,
    passes_filter: passesFilter,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\nSP-DRAW-01: Sweep DRAW_FLOOR × DRAW_MARGIN (224 combinaciones)');
  console.log('DRAW_AFFINITY_ENABLED=false (fijo) | DRAW_FLOOR_ENABLED=true (se evalúa)');
  console.log('='.repeat(80));

  // Cargar índice de odds
  let oddsIndex: OddsIndex;
  try {
    oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
    console.log(`[ODDS] Índice cargado: ${oddsIndex.size} registros`);
  } catch {
    console.warn('[WARN] Error building odds index — proceeding without market odds');
    oddsIndex = new Map();
  }

  // Fase 1: recolectar muestras (una sola vez — costoso)
  console.log('\nFase 1: Recolectando muestras walk-forward...');
  const { samples, nTotal } = collectSamples(oddsIndex);
  console.log(`  Total muestras: ${samples.length} de ${nTotal} partidos`);

  if (samples.length === 0) {
    console.error('ERROR: sin muestras — verificar que cache/football-data existe');
    process.exit(1);
  }

  // Baseline: comportamiento sin DRAW_FLOOR
  console.log('\nCalculando baseline (DRAW_FLOOR_ENABLED=false)...');
  const baseline = evalBaseline(samples);
  console.log(
    `  Baseline: acc=${(baseline.accuracy * 100).toFixed(1)}%  DR=${(baseline.draw_recall * 100).toFixed(1)}%  DP=N/A  AR=${(baseline.away_recall * 100).toFixed(1)}%  coverage=${(baseline.coverage * 100).toFixed(1)}%`
  );

  // Fase 2: grid search 16 × 14 = 224 combinaciones
  // DRAW_FLOOR  ∈ [0.20, 0.21, ..., 0.35]  — 16 valores
  // DRAW_MARGIN ∈ [0.02, 0.03, ..., 0.15]  — 14 valores
  const FLOORS:  number[] = [];
  const MARGINS: number[] = [];

  for (let f = 0.20; f <= 0.3501; f = Math.round((f + 0.01) * 1000) / 1000) FLOORS.push(f);
  for (let m = 0.02; m <= 0.1501; m = Math.round((m + 0.01) * 1000) / 1000) MARGINS.push(m);

  const totalCombos = FLOORS.length * MARGINS.length;
  console.log(`\nFase 2: Grid search ${FLOORS.length} × ${MARGINS.length} = ${totalCombos} combinaciones...`);

  const results: ComboResult[] = [];
  let done = 0;

  for (const floor of FLOORS) {
    for (const margin of MARGINS) {
      const result = evalCombo(samples, floor, margin);
      results.push(result);
      done++;
      if (done % 28 === 0 || done === totalCombos) {
        process.stdout.write(`  ${done}/${totalCombos} combinaciones evaluadas\r`);
      }
    }
  }
  console.log(`  ${totalCombos}/${totalCombos} combinaciones evaluadas   `);

  // Selección del óptimo: pasa todos los filtros, máximo composite score
  const eligible = results.filter(r => r.passes_filter);
  eligible.sort((a, b) => b.composite - a.composite);
  const optimal = eligible.length > 0 ? eligible[0] : null;

  // Ordenar todos por composite DESC para reporte
  const resultsSorted = [...results].sort((a, b) => b.composite - a.composite);

  // ── Consola: top 15 por composite ───────────────────────────────────────────
  const pct  = (v: number | null) => v !== null ? (v * 100).toFixed(1) + '%' : 'N/A  ';
  const LINE = '─'.repeat(110);

  console.log('\n' + LINE);
  console.log('TOP 15 por composite score (0.4×acc + 0.3×DR + 0.3×DP):');
  console.log(LINE);
  console.log(
    'FLOOR  MARGIN  Accuracy   DR        DP        AR        HR        %DRAW     Coverage  Composite  N_eval  Filter'
  );
  console.log(LINE);

  for (const r of resultsSorted.slice(0, 15)) {
    const tag    = r.passes_filter ? ' OK' : '   ';
    const optTag = (optimal && r.draw_floor === optimal.draw_floor && r.draw_margin === optimal.draw_margin)
      ? ' *** OPTIMO'
      : '';
    console.log(
      `${r.draw_floor.toFixed(2).padStart(5)}  ${r.draw_margin.toFixed(2).padStart(6)}  ` +
      `${pct(r.accuracy).padStart(8)}  ${pct(r.draw_recall).padStart(8)}  ${pct(r.draw_precision).padStart(8)}  ` +
      `${pct(r.away_recall).padStart(8)}  ${pct(r.home_recall).padStart(8)}  ` +
      `${pct(r.pct_draw_pred).padStart(8)}  ${pct(r.coverage).padStart(8)}  ` +
      `${r.composite.toFixed(4).padStart(9)}  ${String(r.n_evaluated).padStart(6)}${tag}${optTag}`,
    );
  }
  console.log(LINE);

  // Baseline
  console.log(`\nBaseline (DRAW_FLOOR_ENABLED=false):`);
  console.log(
    `  acc=${pct(baseline.accuracy)} DR=${pct(baseline.draw_recall)} DP=N/A AR=${pct(baseline.away_recall)} coverage=${pct(baseline.coverage)} n_eval=${baseline.n_evaluated}`
  );

  // Óptimo
  if (optimal) {
    console.log(`\n${'='.repeat(80)}`);
    console.log('OPTIMO (cumple todos los filtros, máximo composite score):');
    console.log(`  DRAW_FLOOR     = ${optimal.draw_floor}`);
    console.log(`  DRAW_MARGIN    = ${optimal.draw_margin}`);
    console.log(`  accuracy       = ${pct(optimal.accuracy)}`);
    console.log(`  draw_recall    = ${pct(optimal.draw_recall)}`);
    console.log(`  draw_precision = ${pct(optimal.draw_precision)}`);
    console.log(`  away_recall    = ${pct(optimal.away_recall)}`);
    console.log(`  home_recall    = ${pct(optimal.home_recall)}`);
    console.log(`  pct_draw_pred  = ${pct(optimal.pct_draw_pred)}`);
    console.log(`  coverage       = ${pct(optimal.coverage)}`);
    console.log(`  composite      = ${optimal.composite.toFixed(4)}`);
    console.log(`  n_evaluated    = ${optimal.n_evaluated}`);
    console.log('='.repeat(80));
  } else {
    console.log('\nNinguna combinación satisface todos los filtros.');
    console.log('(acc>=53.5% AND draw_precision>=30% AND away_recall>=30% AND coverage>=70%)');
    const bestByComposite = resultsSorted[0];
    if (bestByComposite) {
      console.log('\nMejor por composite score (sin filtros):');
      console.log(
        `  FLOOR=${bestByComposite.draw_floor} MARGIN=${bestByComposite.draw_margin}  acc=${pct(bestByComposite.accuracy)} DR=${pct(bestByComposite.draw_recall)} DP=${pct(bestByComposite.draw_precision)} AR=${pct(bestByComposite.away_recall)} composite=${bestByComposite.composite.toFixed(4)}`
      );
    }
    console.log('\nDecisión: Documentar en SP-DRAW-V1 §15, considerar escalar a Solución B.');
  }

  // ── Guardar JSON ──────────────────────────────────────────────────────────────
  const cacheDir = path.join(process.cwd(), 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const outputFile = path.join(cacheDir, 'draw-floor-sweep.json');
  const output = {
    swept_at:  new Date().toISOString(),
    n_matches: samples.length,
    grid: {
      draw_floor_range:  `[${FLOORS[0]}, ${FLOORS[FLOORS.length - 1]}] step=0.01 (${FLOORS.length} valores)`,
      draw_margin_range: `[${MARGINS[0]}, ${MARGINS[MARGINS.length - 1]}] step=0.01 (${MARGINS.length} valores)`,
      total_combos:      totalCombos,
      draw_affinity_enabled: false,
      draw_floor_enabled: true,
    },
    baseline: {
      acc:           baseline.accuracy,
      draw_recall:   baseline.draw_recall,
      draw_precision: null,
      away_recall:    baseline.away_recall,
      home_recall:    baseline.home_recall,
      coverage:       baseline.coverage,
      n_evaluated:    baseline.n_evaluated,
    },
    optimal: optimal
      ? {
          draw_floor:     optimal.draw_floor,
          draw_margin:    optimal.draw_margin,
          composite:      optimal.composite,
          acc:            optimal.accuracy,
          draw_recall:    optimal.draw_recall,
          draw_precision: optimal.draw_precision,
          away_recall:    optimal.away_recall,
          home_recall:    optimal.home_recall,
          pct_draw_pred:  optimal.pct_draw_pred,
          coverage:       optimal.coverage,
          n_evaluated:    optimal.n_evaluated,
        }
      : null,
    filters_applied: {
      min_accuracy:       0.535,
      min_draw_precision: 0.30,
      min_away_recall:    0.30,
      min_coverage:       0.70,
    },
    n_passing_filter: eligible.length,
    results: results.map(r => ({
      draw_floor:     r.draw_floor,
      draw_margin:    r.draw_margin,
      acc:            r.accuracy,
      draw_recall:    r.draw_recall,
      draw_precision: r.draw_precision,
      away_recall:    r.away_recall,
      home_recall:    r.home_recall,
      pct_draw_pred:  r.pct_draw_pred,
      coverage:       r.coverage,
      composite:      r.composite,
      n_evaluated:    r.n_evaluated,
      n_draw_actual:  r.n_draw_actual,
      n_draw_pred:    r.n_draw_predicted,
      passes_filter:  r.passes_filter,
    })),
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\nResultados guardados en: ${outputFile}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

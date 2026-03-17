/**
 * sweep-too-close.ts — Grid search 1D sobre TOO_CLOSE_THRESHOLD.
 *
 * Objetivo: encontrar el umbral óptimo de abstención que maximice accuracy
 * manteniendo cobertura >= 60% y mejorando effective_accuracy sobre el baseline.
 *
 * Diagnóstico previo:
 *   - TOO_CLOSE_THRESHOLD actual: 0.05 (margin < 0.05 → predicted_result = null)
 *   - Backtest base post-DrawAffinity fix: acc=51.8%, cobertura ~77.7%
 *   - Bottom 25% por favorite_margin: accuracy 35.9% (peor que azar)
 *   - Con margin >= 0.30: accuracy 65.9% sobre 35% de los partidos
 *
 * Grid:
 *   TOO_CLOSE_THRESHOLD ∈ [0.05, 0.08, 0.10, 0.12, 0.15, 0.18, 0.20, 0.25, 0.30]
 *
 * Por cada valor, reporta:
 *   - accuracy          — sobre partidos con predicted_result != null
 *   - coverage          — % de partidos con predicted_result != null
 *   - effective_accuracy — accuracy * coverage (tradeoff penalizado)
 *   - draw_pct          — % predichos como DRAW
 *   - away_recall       — recall de AWAY_WIN
 *   - draw_recall       — recall de DRAW
 *   - draw_precision    — precision de DRAW
 *   - composite         — 0.4*accuracy + 0.3*draw_recall + 0.3*draw_precision
 *
 * Criterio de selección:
 *   1. accuracy > baseline_accuracy
 *   2. coverage >= 0.60
 *   3. effective_accuracy > baseline_effective_accuracy
 *
 * Guarda: cache/too-close-sweep.json
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/sweep-too-close.ts
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

interface ThresholdResult {
  threshold:            number;
  /** Accuracy over non-abstained predictions */
  accuracy:             number;
  /** Fraction of predictions that are non-null (not abstained) */
  coverage:             number;
  /** accuracy * coverage — penalizes abstaining too much */
  effective_accuracy:   number;
  draw_pct:             number;
  away_recall:          number;
  draw_recall:          number;
  draw_precision:       number;
  composite:            number;
  n_total:              number;
  n_covered:            number;
  n_abstained:          number;
  n_draw_actual:        number;
  n_draw_predicted:     number;
  n_away_actual:        number;
  n_home_actual:        number;
}

// ── Config de ligas (idéntico a sweep-draw-affinity.ts) ───────────────────────

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
          leagueCode:          league.code,
          kickoffUtc:          match.startTimeUtc,
          homeTeamId:          match.homeTeamId,
          awayTeamId:          match.awayTeamId,
          trainingSnapshot:    [...trainingRecords],
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

// ── Fase 2: Evaluar un threshold ──────────────────────────────────────────────

function evalThreshold(samples: MatchSample[], threshold: number): ThresholdResult {
  let nTotal      = 0;
  let nCovered    = 0;   // predicted_result != null
  let nCorrect    = 0;
  let nDrawActual = 0;
  let nDrawPred   = 0;
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
        TOO_CLOSE_THRESHOLD: threshold,
      },
    };

    try {
      const out = runV3Engine(input);
      if (out.eligibility === 'NOT_ELIGIBLE') continue;

      nTotal++;

      if (out.predicted_result === null || out.predicted_result === undefined) {
        // Abstained — counts towards total but not covered
        continue;
      }

      nCovered++;

      const predicted = out.predicted_result as string;
      if (predicted === s.actual) nCorrect++;

      // Per-class tracking
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
      if (predicted === 'DRAW') nDrawPred++;

    } catch {
      // skip engine errors
    }
  }

  const accuracy          = nCovered > 0 ? nCorrect / nCovered : 0;
  const coverage          = nTotal   > 0 ? nCovered / nTotal   : 0;
  const effective_accuracy = accuracy * coverage;
  const draw_recall       = nDrawActual > 0 ? nDrawCorrect / nDrawActual : 0;
  const draw_precision    = nDrawPred   > 0 ? nDrawCorrect / nDrawPred   : 0;
  const away_recall       = nAwayActual > 0 ? nAwayCorrect / nAwayActual : 0;
  const draw_pct          = nCovered    > 0 ? nDrawPred   / nCovered    : 0;
  const composite         = 0.4 * accuracy + 0.3 * draw_recall + 0.3 * draw_precision;

  return {
    threshold,
    accuracy,
    coverage,
    effective_accuracy,
    draw_pct,
    away_recall,
    draw_recall,
    draw_precision,
    composite,
    n_total:          nTotal,
    n_covered:        nCovered,
    n_abstained:      nTotal - nCovered,
    n_draw_actual:    nDrawActual,
    n_draw_predicted: nDrawPred,
    n_away_actual:    nAwayActual,
    n_home_actual:    nHomeActual,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('TOO_CLOSE_THRESHOLD Sweep — Tradeoff accuracy vs cobertura');
  console.log('='.repeat(72));

  // Cargar odds index
  let oddsIndex: OddsIndex;
  try {
    oddsIndex = buildOddsIndex(['PD', 'PL', 'BL1']);
    console.log(`[ODDS] Índice cargado: ${oddsIndex.size} registros`);
  } catch {
    console.warn('[WARN] Error building odds index — proceeding without market odds');
    oddsIndex = new Map();
  }

  // Fase 1: recolectar muestras walk-forward
  console.log('\nFase 1: Recolectando muestras walk-forward...');
  const samples = collectSamples(oddsIndex);
  console.log(`  Total muestras: ${samples.length}`);

  if (samples.length === 0) {
    console.error('ERROR: sin muestras — verificar que cache/football-data existe');
    process.exit(1);
  }

  // Fase 2: sweep 1D
  const THRESHOLDS = [0.05, 0.08, 0.10, 0.12, 0.15, 0.18, 0.20, 0.25, 0.30];

  console.log(`\nFase 2: Evaluando ${THRESHOLDS.length} umbrales...`);

  const results: ThresholdResult[] = [];
  for (const threshold of THRESHOLDS) {
    const result = evalThreshold(samples, threshold);
    results.push(result);
    process.stdout.write(`  threshold=${threshold.toFixed(2)} → done\n`);
  }

  // Baseline = TOO_CLOSE_THRESHOLD actual (0.05)
  const baseline = results.find(r => r.threshold === 0.05)!;
  const baselineEffective = baseline.effective_accuracy;
  const baselineAcc       = baseline.accuracy;

  // Criterio de selección del óptimo:
  //   1. accuracy > baseline_accuracy
  //   2. coverage >= 0.60
  //   3. effective_accuracy > baseline_effective_accuracy
  const eligible = results.filter(r =>
    r.accuracy > baselineAcc &&
    r.coverage >= 0.60 &&
    r.effective_accuracy > baselineEffective,
  );
  // Ordenar por composite DESC para encontrar el óptimo
  eligible.sort((a, b) => b.composite - a.composite);
  const optimal = eligible.length > 0 ? eligible[0] : null;

  // Ordenar resultados por threshold ASC para la tabla
  results.sort((a, b) => a.threshold - b.threshold);

  // ── Print tabla ─────────────────────────────────────────────────────────────
  const pct = (v: number) => (v * 100).toFixed(1) + '%';
  const fmt4 = (v: number) => v.toFixed(4);

  console.log('\n' + '─'.repeat(120));
  console.log('THRESHOLD  Accuracy  Coverage  EffAcc    DrawPct   AwayRec   DrawRec   DrawPrec  Composite  N_cov  N_abs  Tag');
  console.log('─'.repeat(120));

  for (const r of results) {
    const isOptimal  = optimal  && r.threshold === optimal.threshold;
    const isBaseline = r.threshold === 0.05;
    const tag = isOptimal && isBaseline ? ' *** OPTIMO+BASE'
      : isOptimal   ? ' *** OPTIMO'
      : isBaseline  ? ' --- BASE'
      : '';

    console.log(
      `${r.threshold.toFixed(2).padStart(9)}  ` +
      `${pct(r.accuracy).padStart(8)}  ` +
      `${pct(r.coverage).padStart(8)}  ` +
      `${pct(r.effective_accuracy).padStart(8)}  ` +
      `${pct(r.draw_pct).padStart(8)}  ` +
      `${pct(r.away_recall).padStart(8)}  ` +
      `${pct(r.draw_recall).padStart(8)}  ` +
      `${pct(r.draw_precision).padStart(8)}  ` +
      `${fmt4(r.composite).padStart(9)}  ` +
      `${r.n_covered.toString().padStart(5)}  ` +
      `${r.n_abstained.toString().padStart(5)}  ` +
      tag,
    );
  }
  console.log('─'.repeat(120));

  // ── Resumen ─────────────────────────────────────────────────────────────────
  console.log(`\nBaseline (threshold=0.05): acc=${pct(baseline.accuracy)}, coverage=${pct(baseline.coverage)}, eff_acc=${pct(baseline.effective_accuracy)}`);

  if (optimal) {
    console.log(`\nOptimo encontrado: threshold=${optimal.threshold}`);
    console.log(`  accuracy=${pct(optimal.accuracy)} (+${pct(optimal.accuracy - baseline.accuracy)} vs base)`);
    console.log(`  coverage=${pct(optimal.coverage)} (${pct(optimal.coverage - baseline.coverage)} vs base)`);
    console.log(`  effective_accuracy=${pct(optimal.effective_accuracy)} (+${pct(optimal.effective_accuracy - baselineEffective)} vs base)`);
    console.log(`  draw_precision=${pct(optimal.draw_precision)}, draw_recall=${pct(optimal.draw_recall)}, away_recall=${pct(optimal.away_recall)}`);
    console.log(`  composite=${fmt4(optimal.composite)}`);
    console.log(`\n  → Actualizar TOO_CLOSE_THRESHOLD = ${optimal.threshold} en constants.ts`);
  } else {
    console.log('\nNO se encontró un threshold óptimo que mejore sobre baseline con coverage >= 60%.');
    console.log('  → Mantener TOO_CLOSE_THRESHOLD = 0.05 (sin cambios)');
  }

  // ── Guardar resultado ────────────────────────────────────────────────────────
  const outputDir = path.join(process.cwd(), 'cache');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const output = {
    generatedAt:        new Date().toISOString(),
    n_total_samples:    samples.length,
    baseline_threshold: 0.05,
    baseline_accuracy:  baseline.accuracy,
    baseline_coverage:  baseline.coverage,
    baseline_effective: baseline.effective_accuracy,
    optimal_threshold:  optimal?.threshold ?? null,
    optimal_found:      optimal !== null,
    results,
  };

  const outPath = path.join(outputDir, 'too-close-sweep.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\nResultados guardados en: cache/too-close-sweep.json`);
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});

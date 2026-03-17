/**
 * sweep-hyperparams.ts — Búsqueda de hiperparámetros para PE v3.
 *
 * Grid: K_SHRINK × PRIOR_EQUIV_GAMES × BETA_RECENT (27 combinaciones).
 * Usa calibración mixed (PD=per-league, PL/BL1=global) ya generada.
 * Backtest walk-forward sobre 2025-26 (partidos ya jugados en cache).
 *
 * NOTA: Se usa la tabla de calibración existente para todas las combinaciones.
 * El resultado orienta qué combo reentrenar con gen-calibration.ts.
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/sweep-hyperparams.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput, CalibrationTable } from '../packages/prediction/src/engine/v3/types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface HyperparamCombo {
  K_SHRINK: number;
  PRIOR_EQUIV_GAMES: number;
  BETA_RECENT: number;
}

interface DrawAffinityCombo {
  DRAW_AFFINITY_POWER: number;
  DRAW_LOW_SCORING_BETA: number;
}

interface SweepResult extends HyperparamCombo {
  accuracy: number;
  drawRecall: number;
  drawPrecision: number;
  awayRecall: number;
  evaluable: number;
}

interface DrawAffinitySweepResult extends DrawAffinityCombo {
  accuracy: number;
  drawRecall: number;
  drawPrecision: number;
  awayRecall: number;
  evaluable: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_BASE  = path.join(process.cwd(), 'cache', 'football-data');
const HIST_BASE   = path.join(process.cwd(), 'cache', 'historical', 'football-data');
const CAL_DIR     = path.join(process.cwd(), 'cache', 'calibration');

const LEAGUES = [
  { name: 'PD',  code: 'PD',  expectedSeasonGames: 38, calStrategy: 'perLg' as const },
  { name: 'PL',  code: 'PL',  expectedSeasonGames: 38, calStrategy: 'global' as const },
  { name: 'BL1', code: 'BL1', expectedSeasonGames: 34, calStrategy: 'global' as const },
];

// Grid de búsqueda — Paso 1: K × PEG × β
const K_SHRINK_VALUES         = [3, 4, 5];
const PRIOR_EQUIV_GAMES_VALUES = [8, 12, 16];
const BETA_RECENT_VALUES      = [0.10, 0.15, 0.20];

// Grid de búsqueda — Paso 2: DC_RHO (valores de -0.05 a -0.25)
const DC_RHO_VALUES = [-0.05, -0.08, -0.10, -0.13, -0.15, -0.18, -0.20, -0.23, -0.25];

// Grid de búsqueda — Paso 3: DrawAffinity POWER × LOW_SCORING_BETA
const DRAW_AFFINITY_POWER_VALUES      = [1.0, 1.5, 2.0, 2.5, 3.0];
const DRAW_LOW_SCORING_BETA_VALUES    = [0.0, 0.25, 0.50, 0.75, 1.0];

// ── Data loading ──────────────────────────────────────────────────────────────

function loadHistorical(code: string, year: number): V3MatchRecord[] {
  const file = path.join(HIST_BASE, code, `${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return (raw?.matches as V3MatchRecord[]) ?? [];
  } catch { return []; }
}

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

function actualOutcome(h: number, a: number): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (h > a) return 'HOME_WIN';
  if (a > h) return 'AWAY_WIN';
  return 'DRAW';
}

function loadCalibration(filename: string): CalibrationTable | undefined {
  const file = path.join(CAL_DIR, filename);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as CalibrationTable;
  } catch { return undefined; }
}

// ── Backtest ──────────────────────────────────────────────────────────────────

interface BacktestResult {
  accuracy: number;
  drawRecall: number;
  drawPrecision: number;
  awayRecall: number;
  evaluable: number;
}

/** Corre el backtest walk-forward sobre todas las ligas con los hiperparámetros dados. */
function runBacktest(
  combo: HyperparamCombo & { DC_RHO?: number; DRAW_AFFINITY_POWER?: number; DRAW_LOW_SCORING_BETA?: number },
  calGlobal: CalibrationTable | undefined,
  calByCode: Map<string, CalibrationTable>,
): BacktestResult {
  let hits = 0, total = 0;
  let actualDraw = 0, hitDraw = 0, predictedDraw = 0;
  let actualAway = 0, hitAway = 0;

  for (const league of LEAGUES) {
    const seasonDir = path.join(CACHE_BASE, league.code, '2025-26');
    const allMatchdays = loadMatchdayFiles(seasonDir);
    if (allMatchdays.size === 0) continue;

    const prevSeasonMatches = [
      ...loadHistorical(league.code, 2023),
      ...loadHistorical(league.code, 2024),
    ];

    const calTable = league.calStrategy === 'perLg'
      ? (calByCode.get(league.code) ?? calGlobal)
      : calGlobal;

    const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);

    for (const md of sortedMatchdays) {
      const testMatches = (allMatchdays.get(md) ?? []).filter(
        (m) => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc,
      );
      if (testMatches.length === 0) continue;

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
          calibrationTable: calTable,
          _overrideConstants: combo,
        };

        try {
          const out = runV3Engine(input);
          if (
            out.eligibility === 'NOT_ELIGIBLE' ||
            out.predicted_result === null ||
            out.predicted_result === undefined
          ) continue;

          const predicted = out.predicted_result;
          if (predicted === 'TOO_CLOSE') continue;

          total++;
          if (predicted === actual) hits++;
          if (actual === 'DRAW') {
            actualDraw++;
            if (predicted === 'DRAW') hitDraw++;
          }
          if (predicted === 'DRAW') predictedDraw++;
          if (actual === 'AWAY_WIN') {
            actualAway++;
            if (predicted === 'AWAY_WIN') hitAway++;
          }
        } catch { /* skip errors */ }
      }
    }
  }

  return {
    accuracy:      total > 0 ? hits / total : 0,
    drawRecall:    actualDraw > 0    ? hitDraw / actualDraw : 0,
    drawPrecision: predictedDraw > 0 ? hitDraw / predictedDraw : 0,
    awayRecall:    actualAway > 0    ? hitAway / actualAway : 0,
    evaluable: total,
  };
}

// ── Score compuesto para ranking ──────────────────────────────────────────────
// Utopía: acc≥60%, DR≥50%, DP≥40%.
// Score = acc + 0.6×DR + 0.4×DP (ponderado hacia empates que tienen sesgo histórico).
function compositeScore(r: BacktestResult): number {
  return r.accuracy + 0.6 * r.drawRecall + 0.4 * r.drawPrecision;
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Check command line args to select which sweep to run
const SWEEP_MODE = process.argv[2] === 'dc_rho'
  ? 'dc_rho'
  : process.argv[2] === 'draw_affinity'
    ? 'draw_affinity'
    : 'hyperparams';

async function main() {
  console.log(`\nSportPulse PE v3 — Sweep [${SWEEP_MODE}]\n`);
  console.log('='.repeat(78));

  // Cargar calibración existente
  const calGlobal = loadCalibration('v3-iso-calibration.json');
  const calByCode = new Map<string, CalibrationTable>();
  for (const lg of LEAGUES) {
    const tbl = loadCalibration(`v3-iso-calibration-${lg.code}.json`);
    if (tbl) calByCode.set(lg.code, tbl);
  }

  if (!calGlobal) {
    console.error('ERROR: No se encontró v3-iso-calibration.json. Correr gen-calibration.ts primero.');
    process.exit(1);
  }

  console.log(`\nCalibración cargada: ${calGlobal.nCalibrationMatches} matches globales`);
  for (const [code, tbl] of calByCode) {
    console.log(`  ${code}: ${tbl.nCalibrationMatches} matches`);
  }

  if (SWEEP_MODE === 'hyperparams') {
    // ── Paso 1: K × PEG × β ────────────────────────────────────────────────
    const grid: HyperparamCombo[] = [];
    for (const K_SHRINK of K_SHRINK_VALUES) {
      for (const PRIOR_EQUIV_GAMES of PRIOR_EQUIV_GAMES_VALUES) {
        for (const BETA_RECENT of BETA_RECENT_VALUES) {
          grid.push({ K_SHRINK, PRIOR_EQUIV_GAMES, BETA_RECENT });
        }
      }
    }

    console.log(`\nGrid: ${grid.length} combinaciones (K×PEG×β)\n`);
    const results: SweepResult[] = [];

    for (let i = 0; i < grid.length; i++) {
      const combo = grid[i]!;
      process.stdout.write(
        `[${String(i+1).padStart(2)}/${grid.length}] K=${combo.K_SHRINK}  PEG=${combo.PRIOR_EQUIV_GAMES}  β=${combo.BETA_RECENT.toFixed(2)}  ... `,
      );
      const result = runBacktest(combo, calGlobal, calByCode);
      process.stdout.write(
        `acc=${(result.accuracy * 100).toFixed(1)}%  DR=${(result.drawRecall * 100).toFixed(1)}%  DP=${(result.drawPrecision * 100).toFixed(1)}%  AR=${(result.awayRecall * 100).toFixed(1)}%  [${result.evaluable}]\n`,
      );
      results.push({ ...combo, ...result });
    }

    results.sort((a, b) => compositeScore(b) - compositeScore(a));
    console.log('\n' + '='.repeat(78));
    console.log('TOP 10 (score = acc + 0.6×DR + 0.4×DP)\n');
    const header = 'K  PEG  β      acc     DR      DP      AR     eval  score';
    console.log(header);
    console.log('─'.repeat(header.length));
    for (const r of results.slice(0, 10)) {
      console.log(
        `${r.K_SHRINK}  ${String(r.PRIOR_EQUIV_GAMES).padStart(2)}   ${r.BETA_RECENT.toFixed(2)}` +
        `  ${(r.accuracy * 100).toFixed(1).padStart(6)}%` +
        `  ${(r.drawRecall * 100).toFixed(1).padStart(5)}%` +
        `  ${(r.drawPrecision * 100).toFixed(1).padStart(5)}%` +
        `  ${(r.awayRecall * 100).toFixed(1).padStart(5)}%` +
        `  ${String(r.evaluable).padStart(5)}` +
        `  ${compositeScore(r).toFixed(4)}`,
      );
    }
    const best = results[0]!;
    console.log(`\nMejor: K=${best.K_SHRINK} PEG=${best.PRIOR_EQUIV_GAMES} β=${best.BETA_RECENT}`);

  } else if (SWEEP_MODE === 'dc_rho') {
    // ── Paso 2: DC_RHO sweep (K=3/PEG=16/β=0.20 fijos) ────────────────────
    console.log(`\nDC_RHO sweep con K=3, PEG=16, β=0.20 (estimación empírica bypasseada)\n`);
    console.log('NOTA: "empirico" = dejar que estimateDcRho calcule desde datos\n');

    const BASE_COMBO: HyperparamCombo = { K_SHRINK: 3, PRIOR_EQUIV_GAMES: 16, BETA_RECENT: 0.20 };

    // Primero: baseline con estimación empírica (sin DC_RHO override)
    process.stdout.write('[ empirico ]  rho=auto  ... ');
    const baseResult = runBacktest(BASE_COMBO, calGlobal, calByCode);
    process.stdout.write(
      `acc=${(baseResult.accuracy * 100).toFixed(1)}%  DR=${(baseResult.drawRecall * 100).toFixed(1)}%  DP=${(baseResult.drawPrecision * 100).toFixed(1)}%  AR=${(baseResult.awayRecall * 100).toFixed(1)}%  [${baseResult.evaluable}]\n`,
    );

    interface DcRhoResult extends BacktestResult { rho: number | 'empirico'; }
    const dcResults: DcRhoResult[] = [{ ...baseResult, rho: 'empirico' }];

    for (let i = 0; i < DC_RHO_VALUES.length; i++) {
      const rho = DC_RHO_VALUES[i]!;
      process.stdout.write(`[${String(i+1).padStart(2)}/${DC_RHO_VALUES.length}] rho=${rho.toFixed(2).padStart(5)}  ... `);
      const combo = { ...BASE_COMBO, DC_RHO: rho };
      const result = runBacktest(combo, calGlobal, calByCode);
      process.stdout.write(
        `acc=${(result.accuracy * 100).toFixed(1)}%  DR=${(result.drawRecall * 100).toFixed(1)}%  DP=${(result.drawPrecision * 100).toFixed(1)}%  AR=${(result.awayRecall * 100).toFixed(1)}%  [${result.evaluable}]\n`,
      );
      dcResults.push({ ...result, rho });
    }

    dcResults.sort((a, b) => compositeScore(b) - compositeScore(a));

    console.log('\n' + '='.repeat(78));
    console.log('Resultados ordenados por score (acc + 0.6×DR + 0.4×DP)\n');
    console.log('rho       acc     DR      DP      AR     score');
    console.log('─'.repeat(50));
    for (const r of dcResults) {
      const rhoLabel = r.rho === 'empirico' ? 'empirico' : r.rho.toFixed(2).padStart(5);
      console.log(
        `${rhoLabel.padEnd(8)}` +
        `  ${(r.accuracy * 100).toFixed(1).padStart(6)}%` +
        `  ${(r.drawRecall * 100).toFixed(1).padStart(5)}%` +
        `  ${(r.drawPrecision * 100).toFixed(1).padStart(5)}%` +
        `  ${(r.awayRecall * 100).toFixed(1).padStart(5)}%` +
        `  ${compositeScore(r).toFixed(4)}`,
      );
    }

    const best = dcResults[0]!;
    const baseScore = compositeScore(baseResult);
    const bestScore = compositeScore(best);
    console.log(`\nMejor: rho=${best.rho}  score=${bestScore.toFixed(4)}`);
    console.log(`Empírico: score=${baseScore.toFixed(4)}`);
    if (bestScore > baseScore + 0.001) {
      console.log(`=> DC_RHO fijo ${best.rho} mejora ${(bestScore - baseScore).toFixed(4)} sobre empírico`);
      console.log(`   Actualizar DC_RHO en constants.ts si la mejora es consistente.`);
    } else {
      console.log(`   La estimación empírica es óptima o equivalente — mantener estimateDcRho.`);
    }

  } else {
    // ── Paso 3: DRAW_AFFINITY_POWER × DRAW_LOW_SCORING_BETA ────────────────
    // Base: K=3, PEG=16, β=0.20, DC_RHO=-0.15 (todos ya optimizados)
    // Objetivo: mejorar DRAW Precision (>34.3%) sin sacrificar acc (>49.5%) ni DR (<48%)
    const BASE_COMBO: HyperparamCombo = { K_SHRINK: 3, PRIOR_EQUIV_GAMES: 16, BETA_RECENT: 0.20 };
    const grid: DrawAffinityCombo[] = [];
    for (const pow of DRAW_AFFINITY_POWER_VALUES) {
      for (const beta of DRAW_LOW_SCORING_BETA_VALUES) {
        grid.push({ DRAW_AFFINITY_POWER: pow, DRAW_LOW_SCORING_BETA: beta });
      }
    }

    console.log(`\nGrid: ${grid.length} combinaciones (POWER × LOW_SCORING_BETA)`);
    console.log(`Base: K=${BASE_COMBO.K_SHRINK} PEG=${BASE_COMBO.PRIOR_EQUIV_GAMES} β=${BASE_COMBO.BETA_RECENT} DC_RHO=-0.15\n`);

    const daResults: DrawAffinitySweepResult[] = [];

    for (let i = 0; i < grid.length; i++) {
      const daCombo = grid[i]!;
      process.stdout.write(
        `[${String(i+1).padStart(2)}/${grid.length}] POWER=${daCombo.DRAW_AFFINITY_POWER.toFixed(1)}  BETA=${daCombo.DRAW_LOW_SCORING_BETA.toFixed(2)}  ... `,
      );
      const combo = {
        ...BASE_COMBO,
        DC_RHO: -0.15,
        DRAW_AFFINITY_POWER: daCombo.DRAW_AFFINITY_POWER,
        DRAW_LOW_SCORING_BETA: daCombo.DRAW_LOW_SCORING_BETA,
      };
      const result = runBacktest(combo, calGlobal, calByCode);
      process.stdout.write(
        `acc=${(result.accuracy * 100).toFixed(1)}%  DR=${(result.drawRecall * 100).toFixed(1)}%  DP=${(result.drawPrecision * 100).toFixed(1)}%  AR=${(result.awayRecall * 100).toFixed(1)}%  [${result.evaluable}]\n`,
      );
      daResults.push({ ...daCombo, ...result });
    }

    daResults.sort((a, b) => compositeScore(b) - compositeScore(a));

    console.log('\n' + '='.repeat(78));
    console.log('TOP 10 (score = acc + 0.6×DR + 0.4×DP)\n');
    const header = 'POWER  BETA   acc     DR      DP      AR     eval  score';
    console.log(header);
    console.log('─'.repeat(header.length));
    for (const r of daResults.slice(0, 10)) {
      console.log(
        `${r.DRAW_AFFINITY_POWER.toFixed(1).padStart(5)}` +
        `  ${r.DRAW_LOW_SCORING_BETA.toFixed(2).padStart(4)}` +
        `  ${(r.accuracy * 100).toFixed(1).padStart(6)}%` +
        `  ${(r.drawRecall * 100).toFixed(1).padStart(5)}%` +
        `  ${(r.drawPrecision * 100).toFixed(1).padStart(5)}%` +
        `  ${(r.awayRecall * 100).toFixed(1).padStart(5)}%` +
        `  ${String(r.evaluable).padStart(5)}` +
        `  ${compositeScore(r).toFixed(4)}`,
      );
    }

    // Current baseline
    const currentResult = runBacktest(
      { ...BASE_COMBO, DC_RHO: -0.15, DRAW_AFFINITY_POWER: 2.0, DRAW_LOW_SCORING_BETA: 0.50 },
      calGlobal, calByCode,
    );
    const currentScore = compositeScore(currentResult);
    const best = daResults[0]!;
    const bestScore = compositeScore(best);

    console.log(`\nCurrent (POWER=2.0, BETA=0.50): acc=${(currentResult.accuracy*100).toFixed(1)}%  DR=${(currentResult.drawRecall*100).toFixed(1)}%  DP=${(currentResult.drawPrecision*100).toFixed(1)}%  score=${currentScore.toFixed(4)}`);
    console.log(`Best:    POWER=${best.DRAW_AFFINITY_POWER.toFixed(1)}, BETA=${best.DRAW_LOW_SCORING_BETA.toFixed(2)}: acc=${(best.accuracy*100).toFixed(1)}%  DR=${(best.drawRecall*100).toFixed(1)}%  DP=${(best.drawPrecision*100).toFixed(1)}%  score=${bestScore.toFixed(4)}`);

    if (bestScore > currentScore + 0.001) {
      console.log(`\n=> MEJORA: score +${(bestScore - currentScore).toFixed(4)}`);
      console.log(`   Actualizar DRAW_AFFINITY_POWER=${best.DRAW_AFFINITY_POWER.toFixed(1)} y DRAW_LOW_SCORING_BETA=${best.DRAW_LOW_SCORING_BETA.toFixed(2)} en constants.ts`);
    } else {
      console.log(`\n=> Sin mejora significativa — POWER=2.0, BETA=0.50 son ya óptimos.`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

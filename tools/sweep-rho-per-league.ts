/**
 * sweep-rho-per-league.ts — DC_RHO grid search per-liga para PE v3.
 *
 * Para cada liga (PD, PL, BL1) por separado:
 *   - Corre walk-forward con DC_RHO ∈ [-0.25, 0.00] step 0.01 (26 valores)
 *   - Computa composite score = acc + 0.6×DR + 0.4×DP para esa liga
 *   - Identifica el rho óptimo
 *
 * Reutiliza la misma infraestructura de sweep-hyperparams.ts:
 *   - Misma calibración mixta (PD=per-liga, PL/BL1=global)
 *   - Mismo walk-forward (partidos anteriores a la jornada como training)
 *   - Base: K=3, PEG=16, β=0.20 (ya optimizados)
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/sweep-rho-per-league.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type {
  V3MatchRecord,
  V3EngineInput,
  CalibrationTable,
} from '../packages/prediction/src/engine/v3/types.js';

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

interface RhoResult {
  rho: number;
  accuracy: number;
  drawRecall: number;
  drawPrecision: number;
  awayRecall: number;
  evaluable: number;
  compositeScore: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');
const HIST_BASE  = path.join(process.cwd(), 'cache', 'historical', 'football-data');
const CAL_DIR    = path.join(process.cwd(), 'cache', 'calibration');

/** Rango de búsqueda: -0.25 a 0.00, step 0.01 (26 valores) */
const RHO_START = -0.25;
const RHO_END   =  0.00;
const RHO_STEP  =  0.01;

const LEAGUES = [
  { name: 'PD',  code: 'PD',  expectedSeasonGames: 38, calStrategy: 'perLg' as const },
  { name: 'PL',  code: 'PL',  expectedSeasonGames: 38, calStrategy: 'global' as const },
  { name: 'BL1', code: 'BL1', expectedSeasonGames: 34, calStrategy: 'global' as const },
];

/** Base hiperparámetros (ya optimizados). */
const BASE_K          = 3;
const BASE_PEG        = 16;
const BASE_BETA       = 0.20;
const BASE_DA_POWER   = 2.0;
const BASE_DA_BETA    = 1.00;

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

function compositeScore(acc: number, dr: number, dp: number): number {
  return acc + 0.6 * dr + 0.4 * dp;
}

// ── Backtest para una liga específica ─────────────────────────────────────────

function runBacktestForLeague(
  leagueCode: string,
  expectedSeasonGames: number,
  calStrategy: 'perLg' | 'global',
  rho: number,
  calGlobal: CalibrationTable | undefined,
  calByCode: Map<string, CalibrationTable>,
): { accuracy: number; drawRecall: number; drawPrecision: number; awayRecall: number; evaluable: number } {
  let hits = 0, total = 0;
  let actualDraw = 0, hitDraw = 0, predictedDraw = 0;
  let actualAway = 0, hitAway = 0;

  const seasonDir = path.join(CACHE_BASE, leagueCode, '2025-26');
  const allMatchdays = loadMatchdayFiles(seasonDir);
  if (allMatchdays.size === 0) {
    return { accuracy: 0, drawRecall: 0, drawPrecision: 0, awayRecall: 0, evaluable: 0 };
  }

  const prevSeasonMatches = [
    ...loadHistorical(leagueCode, 2023),
    ...loadHistorical(leagueCode, 2024),
  ];

  const calTable = calStrategy === 'perLg'
    ? (calByCode.get(leagueCode) ?? calGlobal)
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
        expectedSeasonGames,
        calibrationTable: calTable,
        leagueCode,
        _overrideConstants: {
          K_SHRINK:               BASE_K,
          PRIOR_EQUIV_GAMES:      BASE_PEG,
          BETA_RECENT:            BASE_BETA,
          DC_RHO:                 rho,
          DRAW_AFFINITY_POWER:    BASE_DA_POWER,
          DRAW_LOW_SCORING_BETA:  BASE_DA_BETA,
        },
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

  return {
    accuracy:      total > 0 ? hits / total : 0,
    drawRecall:    actualDraw > 0    ? hitDraw / actualDraw : 0,
    drawPrecision: predictedDraw > 0 ? hitDraw / predictedDraw : 0,
    awayRecall:    actualAway > 0    ? hitAway / actualAway : 0,
    evaluable: total,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nSportPulse PE v3 — DC_RHO per-liga sweep\n');
  console.log('='.repeat(72));
  console.log(`Rango: [${RHO_START}, ${RHO_END}] step ${RHO_STEP} (${Math.round((RHO_END - RHO_START) / RHO_STEP) + 1} valores)`);
  console.log(`Base: K=${BASE_K} PEG=${BASE_PEG} β=${BASE_BETA} DA_POWER=${BASE_DA_POWER} DA_BETA=${BASE_DA_BETA}`);

  // Cargar calibración
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

  console.log(`\nCalibración: global=${calGlobal.nCalibrationMatches} matches`);
  for (const [code, tbl] of calByCode) {
    console.log(`  ${code}: ${tbl.nCalibrationMatches} matches`);
  }

  // Generar lista de rho values: -0.25, -0.24, ..., 0.00
  const rhoValues: number[] = [];
  for (let r = RHO_START; r <= RHO_END + 1e-10; r += RHO_STEP) {
    rhoValues.push(Math.round(r * 100) / 100);
  }

  const optimalByLeague: Record<string, { rho: number; score: number }> = {};

  for (const league of LEAGUES) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`Liga: ${league.name} (expectedSeasonGames=${league.expectedSeasonGames}, cal=${league.calStrategy})`);
    console.log('─'.repeat(72));

    const results: RhoResult[] = [];

    for (let i = 0; i < rhoValues.length; i++) {
      const rho = rhoValues[i]!;
      process.stdout.write(`  rho=${rho.toFixed(2).padStart(5)} ... `);

      const r = runBacktestForLeague(
        league.code,
        league.expectedSeasonGames,
        league.calStrategy,
        rho,
        calGlobal,
        calByCode,
      );

      const score = compositeScore(r.accuracy, r.drawRecall, r.drawPrecision);
      process.stdout.write(
        `acc=${(r.accuracy * 100).toFixed(1)}%  DR=${(r.drawRecall * 100).toFixed(1)}%  DP=${(r.drawPrecision * 100).toFixed(1)}%  AR=${(r.awayRecall * 100).toFixed(1)}%  [${r.evaluable}]  score=${score.toFixed(4)}\n`,
      );

      results.push({ rho, ...r, compositeScore: score });
    }

    // Ordenar por composite score desc
    results.sort((a, b) => b.compositeScore - a.compositeScore);

    const best = results[0]!;
    const baseline = results.find((r) => r.rho === -0.15);
    optimalByLeague[league.code] = { rho: best.rho, score: best.compositeScore };

    console.log(`\n  TOP 5 para ${league.name}:`);
    console.log('  rho     acc     DR      DP      AR     score');
    console.log('  ' + '─'.repeat(50));
    for (const r of results.slice(0, 5)) {
      console.log(
        `  ${r.rho.toFixed(2).padStart(5)}` +
        `  ${(r.accuracy * 100).toFixed(1).padStart(6)}%` +
        `  ${(r.drawRecall * 100).toFixed(1).padStart(5)}%` +
        `  ${(r.drawPrecision * 100).toFixed(1).padStart(5)}%` +
        `  ${(r.awayRecall * 100).toFixed(1).padStart(5)}%` +
        `  ${r.compositeScore.toFixed(4)}`,
      );
    }
    console.log(`\n  Rho óptimo para ${league.name}: ${best.rho.toFixed(2)}  (score=${best.compositeScore.toFixed(4)})`);
    if (baseline) {
      const delta = best.compositeScore - baseline.compositeScore;
      console.log(`  Baseline rho=-0.15:  score=${baseline.compositeScore.toFixed(4)}  delta=${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`);
    }
  }

  // ── Resumen final ────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(72)}`);
  console.log('RESUMEN — Rho óptimo por liga\n');
  console.log('Liga  Rho_óptimo  Score');
  console.log('─'.repeat(30));
  for (const lg of LEAGUES) {
    const opt = optimalByLeague[lg.code];
    if (opt) {
      console.log(`${lg.code.padEnd(5)} ${opt.rho.toFixed(2).padStart(10)}  ${opt.score.toFixed(4)}`);
    }
  }

  console.log('\nPegar en constants.ts:');
  console.log('export const DC_RHO_PER_LEAGUE: Record<string, number> = {');
  for (const lg of LEAGUES) {
    const opt = optimalByLeague[lg.code];
    if (opt) {
      console.log(`  '${lg.code}': ${opt.rho.toFixed(2)},`);
    }
  }
  console.log('};');
}

main().catch((e) => { console.error(e); process.exit(1); });

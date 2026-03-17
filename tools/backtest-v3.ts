/**
 * BACKTEST-V3: Walk-forward backtest del motor PE v1.3 (runV3Engine).
 *
 * A diferencia de backtest-predictions.ts y backtest-model.ts, este script
 * evalúa el motor real de producción — no el legacy prediction-builder.
 *
 * Metodología: para cada jornada N, usa partidos de jornadas 1..N-1 como
 * training data (sin data leakage), testea sobre partidos FINISHED de jornada N.
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/backtest-v3.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput } from '../packages/prediction/src/engine/v3/types.js';

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

const LEAGUES: LeagueConfig[] = [
  { name: 'LaLiga (PD)',         dir: path.join(CACHE_BASE, 'PD',  '2025-26'), expectedSeasonGames: 38 },
  { name: 'Premier League (PL)', dir: path.join(CACHE_BASE, 'PL',  '2025-26'), expectedSeasonGames: 38 },
  { name: 'Bundesliga (BL1)',    dir: path.join(CACHE_BASE, 'BL1', '2025-26'), expectedSeasonGames: 34 },
];

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

// ── Backtest por liga ───────────────────────────────────────────────────────

function backtestLeague(league: LeagueConfig): MatchEval[] {
  const allMatchdays = loadMatchdayFiles(league.dir);
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

      const input: V3EngineInput = {
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        kickoffUtc: match.startTimeUtc,
        buildNowUtc: match.startTimeUtc,
        currentSeasonMatches: trainingRecords,
        prevSeasonMatches: [],
        expectedSeasonGames: league.expectedSeasonGames,
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
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log('\n🔬 SportsPulse — Backtest del motor PE v1.3 (runV3Engine)\n');
console.log('Metodología: walk-forward por jornada, sin data leakage');
console.log('Motor: runV3Engine — NO prediction-builder legacy\n');

const allEvals: MatchEval[] = [];

for (const league of LEAGUES) {
  process.stdout.write(`Procesando ${league.name}... `);
  const evals = backtestLeague(league);
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
console.log('═'.repeat(72));
console.log();

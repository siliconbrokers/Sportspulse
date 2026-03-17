/**
 * BACKTEST-V3-SWEEP: Parameter sweep para optimizar DRAW detection rule.
 *
 * Corre el motor una vez, almacena (p_home, p_draw, p_away, actual),
 * luego prueba múltiples combinaciones de parámetros para la decision policy
 * sin re-correr el motor.
 *
 * Regla a optimizar:
 *   if p_draw >= DRAW_FLOOR AND max(p_home, p_away) - p_draw <= DRAW_MARGIN:
 *     → predict DRAW
 *   else:
 *     → argmax con TOO_CLOSE_THRESHOLD
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/backtest-v3-sweep.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput } from '../packages/prediction/src/engine/v3/types.js';

// ── Tipos ───────────────────────────────────────────────────────────────────

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

interface MatchProbs {
  p_home: number;
  p_draw: number;
  p_away: number;
  actual: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  eligibility: string;
}

// ── Config ──────────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

const LEAGUES = [
  { name: 'LaLiga (PD)',         dir: path.join(CACHE_BASE, 'PD',  '2025-26'), expectedSeasonGames: 38, prevFile: path.join(CACHE_BASE, 'PD',  '2024-25', 'prev-season.json') },
  { name: 'Premier League (PL)', dir: path.join(CACHE_BASE, 'PL',  '2025-26'), expectedSeasonGames: 38, prevFile: path.join(CACHE_BASE, 'PL',  '2024-25', 'prev-season.json') },
  { name: 'Bundesliga (BL1)',    dir: path.join(CACHE_BASE, 'BL1', '2025-26'), expectedSeasonGames: 34, prevFile: path.join(CACHE_BASE, 'BL1', '2024-25', 'prev-season.json') },
];

function loadPrevSeason(file: string): V3MatchRecord[] {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf-8'))?.matches ?? []; } catch { return []; }
}

const TOO_CLOSE_THRESHOLD = 0.05;

// ── Carga de cache ──────────────────────────────────────────────────────────

function loadMatchdayFiles(dir: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  if (!fs.existsSync(dir)) return result;
  const files = fs.readdirSync(dir).filter(f => f.match(/^matchday-\d+\.json$/)).sort();
  for (const file of files) {
    const num = parseInt(file.match(/(\d+)/)?.[1] ?? '0', 10);
    if (!num) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      result.set(num, raw?.data?.matches ?? []);
    } catch { /* skip */ }
  }
  return result;
}

function toV3Record(m: CachedMatch): V3MatchRecord | null {
  if (m.scoreHome === null || m.scoreAway === null || !m.startTimeUtc) return null;
  return { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, utcDate: m.startTimeUtc,
           homeGoals: m.scoreHome, awayGoals: m.scoreAway };
}

function actualOutcome(m: CachedMatch): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway) return 'HOME_WIN';
  if (m.scoreAway > m.scoreHome) return 'AWAY_WIN';
  return 'DRAW';
}

// ── Recolección de probabilidades (una sola pasada) ─────────────────────────

function collectProbs(dir: string, expectedSeasonGames: number, prevSeasonMatches: V3MatchRecord[] = []): MatchProbs[] {
  const allMatchdays = loadMatchdayFiles(dir);
  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);
  const probs: MatchProbs[] = [];

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? [])
      .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc);
    if (testMatches.length === 0) continue;

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
        homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId,
        kickoffUtc: match.startTimeUtc, buildNowUtc: match.startTimeUtc,
        currentSeasonMatches: trainingRecords, prevSeasonMatches,
        expectedSeasonGames,
      };

      try {
        const out = runV3Engine(input);
        if (out.prob_home_win !== null && out.prob_draw !== null && out.prob_away_win !== null) {
          probs.push({ p_home: out.prob_home_win, p_draw: out.prob_draw, p_away: out.prob_away_win,
                       actual, eligibility: out.eligibility });
        }
      } catch { /* skip */ }
    }
  }
  return probs;
}

// ── Decision policy con parámetros ajustables ───────────────────────────────

function applyPolicy(
  p: MatchProbs,
  drawFloor: number,
  drawMargin: number,
): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  const { p_home, p_draw, p_away } = p;

  // DRAW floor rule: si p_draw es suficientemente alto y el líder no está muy lejos
  if (p_draw >= drawFloor) {
    const maxOther = Math.max(p_home, p_away);
    if (maxOther - p_draw <= drawMargin) {
      return 'DRAW';
    }
  }

  // Argmax estándar con TOO_CLOSE
  const probs = [
    { key: 'HOME_WIN' as const, v: p_home },
    { key: 'DRAW' as const, v: p_draw },
    { key: 'AWAY_WIN' as const, v: p_away },
  ].sort((a, b) => b.v - a.v);

  if (probs[0].v - probs[1].v < TOO_CLOSE_THRESHOLD) return null;
  return probs[0].key;
}

// ── Métricas ────────────────────────────────────────────────────────────────

interface Metrics {
  drawFloor: number;
  drawMargin: number;
  accuracy: number;
  drawRecall: number;
  drawPrecision: number;
  predicted: number;
  tooClose: number;
  predictedDrawCount: number;
  actualDrawCount: number;
}

function computeMetrics(probs: MatchProbs[], drawFloor: number, drawMargin: number): Metrics {
  let correct = 0, predicted = 0, tooClose = 0;
  let drawHits = 0, drawPred = 0, drawActual = 0;

  for (const p of probs) {
    if (p.actual === 'DRAW') drawActual++;
    const pred = applyPolicy(p, drawFloor, drawMargin);
    if (pred === null) { tooClose++; continue; }
    predicted++;
    if (pred === p.actual) correct++;
    if (pred === 'DRAW') { drawPred++; if (p.actual === 'DRAW') drawHits++; }
  }

  return {
    drawFloor, drawMargin,
    accuracy: predicted > 0 ? correct / predicted : 0,
    drawRecall: drawActual > 0 ? drawHits / drawActual : 0,
    drawPrecision: drawPred > 0 ? drawHits / drawPred : 0,
    predicted, tooClose,
    predictedDrawCount: drawPred,
    actualDrawCount: drawActual,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

const LINE = '─'.repeat(72);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// 1) Recolectar probabilidades
console.log('\n🔬 SportsPulse — Parameter sweep para DRAW detection rule\n');
const allProbs: MatchProbs[] = [];
for (const league of LEAGUES) {
  const prev = loadPrevSeason(league.prevFile);
  process.stdout.write(`Procesando ${league.name}${prev.length > 0 ? ' [+prevSeason]' : ''}... `);
  const p = collectProbs(league.dir, league.expectedSeasonGames, prev);
  allProbs.push(...p);
  console.log(`${p.length} partidos evaluables`);
}
console.log(`\nTotal: ${allProbs.length} partidos con probabilidades\n`);

// 2) Baseline: decision policy actual (sin DRAW floor)
const baseline = computeMetrics(allProbs, 1.0, 0.0); // nunca activa el floor
console.log(LINE);
console.log('BASELINE (decision policy actual — argmax puro)');
console.log(LINE);
console.log(`  Accuracy     : ${pct(baseline.accuracy)}  (${baseline.predicted} predichos, ${baseline.tooClose} TOO_CLOSE)`);
console.log(`  DRAW recall  : ${pct(baseline.drawRecall)}  (${baseline.predictedDrawCount} predichos / ${baseline.actualDrawCount} reales)`);

// 3) Sweep: DRAW floor × margin
console.log(`\n${LINE}`);
console.log('SWEEP — DRAW_FLOOR × DRAW_MARGIN (ordenado por accuracy desc)');
console.log(LINE);

const results: Metrics[] = [];
for (let floorStep = 0; floorStep <= 12; floorStep++) {
  const drawFloor = 0.24 + floorStep * 0.01;
  for (let marginStep = 0; marginStep <= 13; marginStep++) {
    const drawMargin = 0.02 + marginStep * 0.01;
    results.push(computeMetrics(allProbs, drawFloor, drawMargin));
  }
}

// Ordenar por accuracy desc, luego DRAW recall desc
results.sort((a, b) => {
  const accDiff = b.accuracy - a.accuracy;
  if (Math.abs(accDiff) > 0.001) return accDiff;
  return b.drawRecall - a.drawRecall;
});

// Top 20
console.log(`  ${'FLOOR'.padEnd(7)} ${'MARGIN'.padEnd(8)} ${'Accuracy'.padEnd(10)} ${'DRAW recall'.padEnd(13)} ${'DRAW prec'.padEnd(11)} ${'Predicted'.padEnd(11)} ${'TOO_CLOSE'}`);
console.log(`  ${'─'.repeat(70)}`);
for (const r of results.slice(0, 20)) {
  const accDiff = r.accuracy - baseline.accuracy;
  const sign = accDiff >= 0 ? '+' : '';
  console.log(
    `  ${r.drawFloor.toFixed(2).padEnd(7)} ${r.drawMargin.toFixed(2).padEnd(8)} ` +
    `${pct(r.accuracy).padEnd(7)} (${sign}${(accDiff * 100).toFixed(1)}pp)  ` +
    `${pct(r.drawRecall).padEnd(7)} ${r.predictedDrawCount}/${r.actualDrawCount}  ` +
    `${pct(r.drawPrecision).padEnd(11)} ${r.predicted.toString().padEnd(11)} ${r.tooClose}`
  );
}

// 4) Mejor resultado con DRAW recall >= 20%
console.log(`\n${LINE}`);
console.log('MEJOR RESULTADO con DRAW recall >= 20%');
console.log(LINE);

const bestWithDraw = results.filter(r => r.drawRecall >= 0.20).sort((a, b) => b.accuracy - a.accuracy)[0];
if (bestWithDraw) {
  const accDiff = bestWithDraw.accuracy - baseline.accuracy;
  const sign = accDiff >= 0 ? '+' : '';
  console.log(`  DRAW_FLOOR   : ${bestWithDraw.drawFloor.toFixed(2)}`);
  console.log(`  DRAW_MARGIN  : ${bestWithDraw.drawMargin.toFixed(2)}`);
  console.log(`  Accuracy     : ${pct(bestWithDraw.accuracy)}  (${sign}${(accDiff * 100).toFixed(1)}pp vs baseline)`);
  console.log(`  DRAW recall  : ${pct(bestWithDraw.drawRecall)}  (${bestWithDraw.predictedDrawCount}/${bestWithDraw.actualDrawCount})`);
  console.log(`  DRAW prec    : ${pct(bestWithDraw.drawPrecision)}`);
  console.log(`  Predicted    : ${bestWithDraw.predicted}  TOO_CLOSE: ${bestWithDraw.tooClose}`);
}

// 5) Distribución de p_draw — cuántos partidos tienen p_draw alto
console.log(`\n${LINE}`);
console.log('DISTRIBUCIÓN DE p_draw (todos los partidos evaluables)');
console.log(LINE);
const withElig = allProbs.filter(p => p.eligibility !== 'NOT_ELIGIBLE');
for (const threshold of [0.25, 0.27, 0.29, 0.31, 0.33, 0.35]) {
  const above = withElig.filter(p => p.p_draw >= threshold);
  const aboveDraws = above.filter(p => p.actual === 'DRAW').length;
  const aboveHomes = above.filter(p => p.actual === 'HOME_WIN').length;
  const aboveAways = above.filter(p => p.actual === 'AWAY_WIN').length;
  const drawRate = above.length > 0 ? aboveDraws / above.length : 0;
  console.log(
    `  p_draw >= ${threshold.toFixed(2)}: ${above.length.toString().padStart(3)} partidos ` +
    `| H=${aboveHomes} D=${aboveDraws} A=${aboveAways} | draw rate real: ${pct(drawRate)}`
  );
}
console.log();

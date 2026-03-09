/**
 * Walk-forward backtest — compara modelo OLD vs NEW de predicciones Poisson+DC.
 *
 * OLD: MIN_GAMES_VENUE=2, sin shrinkage
 * NEW: MIN_GAMES_VENUE=5, shrinkage K=5 hacia promedio de liga
 *
 * Metodología: para cada partido FINISHED de la jornada N,
 * usa todos los partidos de jornadas 1..N-1 como training data.
 * No usa el partido en cuestión (ni otros de la misma jornada).
 *
 * Uso: npx tsx tools/backtest-model.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface CachedMatch {
  matchId: string;
  seasonId: string;
  matchday: number;
  startTimeUtc: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  scoreHome: number | null;
  scoreAway: number | null;
}

interface TeamLambdas {
  attack: number;
  defense: number;
  games: number;
  venueSplit: boolean;
}

// ── Constantes comunes ────────────────────────────────────────────────────────

const DECAY_XI     = 0.006;
const MS_PER_DAY   = 86_400_000;
const MAX_GOALS    = 7;
const DC_RHO       = -0.13;
const HOME_ADV     = 1.15;

// ── Constantes OLD ────────────────────────────────────────────────────────────

const OLD_MIN_GAMES_VENUE = 2;
const OLD_MIN_GAMES_MODEL = 2;

// ── Constantes NEW ────────────────────────────────────────────────────────────

const NEW_MIN_GAMES_VENUE = 5;
const NEW_MIN_GAMES_MODEL = 1;
const NEW_SHRINKAGE_K     = 5;

// ── Carga de archivos de cache ─────────────────────────────────────────────

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

// ── Shared math ───────────────────────────────────────────────────────────────

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function dcTau(h: number, a: number, lh: number, la: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * DC_RHO;
  if (h === 0 && a === 1) return 1 + lh * DC_RHO;
  if (h === 1 && a === 0) return 1 + la * DC_RHO;
  if (h === 1 && a === 1) return 1 - DC_RHO;
  return 1;
}

function computeProbs(lh: number, la: number): { homeWin: number; draw: number; awayWin: number } {
  let hw = 0, dr = 0, aw = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    const ph = poissonPmf(lh, h);
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = ph * poissonPmf(la, a) * dcTau(h, a, lh, la);
      if (h > a) hw += p;
      else if (h === a) dr += p;
      else aw += p;
    }
  }
  const total = hw + dr + aw || 1;
  return { homeWin: hw / total, draw: dr / total, awayWin: aw / total };
}

function computeTeamRaw(
  teamId: string,
  trainingMatches: CachedMatch[],
  buildNowUtc: string,
  venue?: 'HOME' | 'AWAY',
): { attack: number; defense: number; games: number } {
  const buildMs = new Date(buildNowUtc).getTime();
  let wA = 0, wD = 0, wT = 0, games = 0;

  for (const m of trainingMatches) {
    if (m.status !== 'FINISHED' || !m.startTimeUtc || m.scoreHome === null || m.scoreAway === null) continue;
    if (m.startTimeUtc >= buildNowUtc) continue;

    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;
    if (!isHome && !isAway) continue;
    if (venue === 'HOME' && !isHome) continue;
    if (venue === 'AWAY' && !isAway) continue;

    const scored   = isHome ? m.scoreHome : m.scoreAway;
    const conceded = isHome ? m.scoreAway : m.scoreHome;
    const daysAgo  = (buildMs - new Date(m.startTimeUtc).getTime()) / MS_PER_DAY;
    const w        = Math.exp(-DECAY_XI * daysAgo);

    wA += scored * w;
    wD += conceded * w;
    wT += w;
    games++;
  }

  return {
    attack:  wT > 0 ? wA / wT : 0,
    defense: wT > 0 ? wD / wT : 0,
    games,
  };
}

function leagueAvgGoals(matches: CachedMatch[], buildNowUtc: string): number {
  let goals = 0, total = 0;
  for (const m of matches) {
    if (m.status !== 'FINISHED' || !m.startTimeUtc || m.scoreHome === null || m.scoreAway === null) continue;
    if (m.startTimeUtc >= buildNowUtc) continue;
    goals += m.scoreHome + m.scoreAway;
    total++;
  }
  return total > 0 ? goals / (2 * total) : 1.3;
}

// ── Modelo OLD ─────────────────────────────────────────────────────────────────

function oldResolve(teamId: string, training: CachedMatch[], now: string, venue: 'HOME' | 'AWAY'): TeamLambdas {
  const v = computeTeamRaw(teamId, training, now, venue);
  if (v.games >= OLD_MIN_GAMES_VENUE) return { ...v, venueSplit: true };
  const all = computeTeamRaw(teamId, training, now);
  return { ...all, venueSplit: false };
}

function oldPredict(match: CachedMatch, training: CachedMatch[], buildNow: string): string | null {
  const h = oldResolve(match.homeTeamId, training, buildNow, 'HOME');
  const a = oldResolve(match.awayTeamId, training, buildNow, 'AWAY');
  if (h.games < OLD_MIN_GAMES_MODEL || a.games < OLD_MIN_GAMES_MODEL) return null;

  let lh = (h.attack + a.defense) / 2;
  let la = (a.attack + h.defense) / 2;
  if (!h.venueSplit || !a.venueSplit) lh *= HOME_ADV;

  const p = computeProbs(lh, la);
  if (p.homeWin >= p.draw && p.homeWin >= p.awayWin) return 'HOME';
  if (p.awayWin >= p.draw && p.awayWin >= p.homeWin) return 'AWAY';
  return 'DRAW';
}

// ── Modelo NEW ─────────────────────────────────────────────────────────────────

function shrink(raw: number, games: number, avg: number): number {
  return (games * raw + NEW_SHRINKAGE_K * avg) / (games + NEW_SHRINKAGE_K);
}

function newResolve(teamId: string, training: CachedMatch[], now: string, venue: 'HOME' | 'AWAY', avg: number): TeamLambdas {
  const v = computeTeamRaw(teamId, training, now, venue);
  const raw = v.games >= NEW_MIN_GAMES_VENUE
    ? { ...v, venueSplit: true }
    : { ...computeTeamRaw(teamId, training, now), venueSplit: false };

  return {
    ...raw,
    attack:  shrink(raw.attack,  raw.games, avg),
    defense: shrink(raw.defense, raw.games, avg),
  };
}

function newPredict(match: CachedMatch, training: CachedMatch[], buildNow: string): string | null {
  const avg = leagueAvgGoals(training, buildNow);
  const h = newResolve(match.homeTeamId, training, buildNow, 'HOME', avg);
  const a = newResolve(match.awayTeamId, training, buildNow, 'AWAY', avg);
  if (h.games < NEW_MIN_GAMES_MODEL || a.games < NEW_MIN_GAMES_MODEL) return null;

  let lh = (h.attack + a.defense) / 2;
  let la = (a.attack + h.defense) / 2;
  if (!h.venueSplit || !a.venueSplit) lh *= HOME_ADV;

  const p = computeProbs(lh, la);
  if (p.homeWin >= p.draw && p.homeWin >= p.awayWin) return 'HOME';
  if (p.awayWin >= p.draw && p.awayWin >= p.homeWin) return 'AWAY';
  return 'DRAW';
}

// ── Resultado real ─────────────────────────────────────────────────────────────

function actualOutcome(m: CachedMatch): string | null {
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway) return 'HOME';
  if (m.scoreAway > m.scoreHome) return 'AWAY';
  return 'DRAW';
}

// ── Backtest por liga ──────────────────────────────────────────────────────────

interface LeagueResult {
  league: string;
  totalMatches: number;
  predictedOld: number;
  predictedNew: number;
  correctOld: number;
  correctNew: number;
  skippedOld: number;
  skippedNew: number;
  outcomeBreakdown: {
    actual: Record<string, number>;
    old: { correct: Record<string, number>; total: Record<string, number> };
    new: { correct: Record<string, number>; total: Record<string, number> };
  };
}

function backtestLeague(leagueName: string, leagueDir: string): LeagueResult {
  const allMatchdays = loadMatchdayFiles(leagueDir);
  const sortedMatchdays = [...allMatchdays.keys()].sort((a, b) => a - b);

  let totalMatches = 0;
  let correctOld = 0, correctNew = 0;
  let predictedOld = 0, predictedNew = 0;
  let skippedOld = 0, skippedNew = 0;

  const breakdown = {
    actual: { HOME: 0, DRAW: 0, AWAY: 0 },
    old: { correct: { HOME: 0, DRAW: 0, AWAY: 0 }, total: { HOME: 0, DRAW: 0, AWAY: 0 } },
    new: { correct: { HOME: 0, DRAW: 0, AWAY: 0 }, total: { HOME: 0, DRAW: 0, AWAY: 0 } },
  };

  for (const md of sortedMatchdays) {
    const testMatches = (allMatchdays.get(md) ?? []).filter(m => m.status === 'FINISHED');
    if (testMatches.length === 0) continue;

    // Training: all matches from earlier matchdays
    const trainingMatches: CachedMatch[] = [];
    for (const prevMd of sortedMatchdays) {
      if (prevMd >= md) break;
      trainingMatches.push(...(allMatchdays.get(prevMd) ?? []));
    }

    // Use the kickoff of the first test match as buildNowUtc proxy
    const buildNow = testMatches[0].startTimeUtc ?? new Date().toISOString();

    for (const match of testMatches) {
      const actual = actualOutcome(match);
      if (!actual) continue;
      totalMatches++;
      breakdown.actual[actual as keyof typeof breakdown.actual]++;

      const predOld = oldPredict(match, trainingMatches, buildNow);
      if (predOld === null) {
        skippedOld++;
      } else {
        predictedOld++;
        breakdown.old.total[predOld as keyof typeof breakdown.old.total]++;
        if (predOld === actual) {
          correctOld++;
          breakdown.old.correct[predOld as keyof typeof breakdown.old.correct]++;
        }
      }

      const predNew = newPredict(match, trainingMatches, buildNow);
      if (predNew === null) {
        skippedNew++;
      } else {
        predictedNew++;
        breakdown.new.total[predNew as keyof typeof breakdown.new.total]++;
        if (predNew === actual) {
          correctNew++;
          breakdown.new.correct[predNew as keyof typeof breakdown.new.correct]++;
        }
      }
    }
  }

  return {
    league: leagueName,
    totalMatches,
    predictedOld,
    predictedNew,
    correctOld,
    correctNew,
    skippedOld,
    skippedNew,
    outcomeBreakdown: breakdown,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

const leagues = [
  { name: 'LaLiga (PD)',         dir: path.join(CACHE_BASE, 'PD',  '2025-26') },
  { name: 'Premier League (PL)', dir: path.join(CACHE_BASE, 'PL',  '2025-26') },
  { name: 'Bundesliga (BL1)',    dir: path.join(CACHE_BASE, 'BL1', '2025-26') },
];

const allResults: LeagueResult[] = [];
for (const { name, dir } of leagues) {
  process.stdout.write(`Procesando ${name}... `);
  const r = backtestLeague(name, dir);
  allResults.push(r);
  console.log(`${r.totalMatches} partidos`);
}

// ── Totales acumulados ─────────────────────────────────────────────────────────

let totalMatches = 0, correctOld = 0, correctNew = 0, predictedOld = 0, predictedNew = 0;
for (const r of allResults) {
  totalMatches += r.totalMatches;
  correctOld   += r.correctOld;
  correctNew   += r.correctNew;
  predictedOld += r.predictedOld;
  predictedNew += r.predictedNew;
}

// ── Output ─────────────────────────────────────────────────────────────────────

const LINE = '─'.repeat(72);
const pct = (c: number, t: number) => t > 0 ? `${(c / t * 100).toFixed(1)}%` : 'N/A';

console.log('\n' + LINE);
console.log('BACKTEST: Modelo OLD vs NEW — Predicción 1X2');
console.log('OLD: MIN_GAMES_VENUE=2, sin shrinkage');
console.log('NEW: MIN_GAMES_VENUE=5, shrinkage K=5 hacia promedio de liga');
console.log(LINE);

for (const r of allResults) {
  const accOld = pct(r.correctOld, r.predictedOld);
  const accNew = pct(r.correctNew, r.predictedNew);
  const diffPct = r.predictedOld > 0 && r.predictedNew > 0
    ? ((r.correctNew / r.predictedNew) - (r.correctOld / r.predictedOld)) * 100
    : 0;
  const sign = diffPct > 0 ? '+' : '';

  console.log(`\n${r.league}`);
  console.log(`  Partidos evaluados : ${r.totalMatches} finalizados`);
  console.log(`  OLD accuracy       : ${r.correctOld}/${r.predictedOld} = ${accOld}  (skipped: ${r.skippedOld})`);
  console.log(`  NEW accuracy       : ${r.correctNew}/${r.predictedNew} = ${accNew}  (skipped: ${r.skippedNew})`);
  console.log(`  Diferencia         : ${sign}${diffPct.toFixed(2)} pp`);

  // Breakdown por resultado
  const b = r.outcomeBreakdown;
  console.log(`  Distribución real  : H=${b.actual.HOME}  D=${b.actual.DRAW}  A=${b.actual.AWAY}`);
  for (const model of ['old', 'new'] as const) {
    const m = b[model];
    const label = model === 'old' ? 'OLD' : 'NEW';
    console.log(`  ${label} predicciones  : H=${m.total.HOME} (aciertos=${m.correct.HOME})  D=${m.total.DRAW} (${m.correct.DRAW})  A=${m.total.AWAY} (${m.correct.AWAY})`);
  }
}

console.log('\n' + LINE);
console.log('TOTAL (3 ligas)');
console.log(`  Partidos           : ${totalMatches}`);
console.log(`  OLD accuracy       : ${correctOld}/${predictedOld} = ${pct(correctOld, predictedOld)}`);
console.log(`  NEW accuracy       : ${correctNew}/${predictedNew} = ${pct(correctNew, predictedNew)}`);
const totalDiff = predictedOld > 0 && predictedNew > 0
  ? ((correctNew / predictedNew) - (correctOld / predictedOld)) * 100
  : 0;
const sign = totalDiff > 0 ? '+' : '';
console.log(`  Diferencia         : ${sign}${totalDiff.toFixed(2)} pp`);
console.log(LINE);

// Nota metodológica
console.log('\nNota: predicción = resultado con mayor probabilidad (HOME/DRAW/AWAY)');
console.log('      baseline naive "siempre local" ≈ 45% en Europa');

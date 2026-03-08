/**
 * Calibración del umbral de empate para el predictor Poisson+DC.
 * Prueba combinaciones de DRAW_THRESHOLD y DRAW_RATIO para encontrar
 * la configuración que maximiza accuracy global sin sacrificar demasiado
 * en victorias locales/visitantes.
 *
 * Uso: pnpm tsx --tsconfig tsconfig.server.json tools/calibrate-draw-threshold.ts
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GoalStatsDTO } from '../packages/snapshot/src/dto/team-score.js';

const ROOT       = new URL('..', import.meta.url).pathname;
const CACHE_ROOT = join(ROOT, 'cache');
const DECAY_XI   = 0.006;
const MS_PER_DAY = 86_400_000;
const MIN_GAMES  = 3;
const MAX_GOALS  = 7;
const DC_RHO     = -0.13;
const HOME_ADV   = 1.15;

interface CachedMatch {
  matchId: string; matchday: number; startTimeUtc: string; status: string;
  homeTeamId: string; awayTeamId: string; scoreHome: number | null; scoreAway: number | null;
}

const LEAGUES = [
  { name: 'LaLiga',     cachePath: join(CACHE_ROOT, 'football-data/PD/2025-26') },
  { name: 'Premier',    cachePath: join(CACHE_ROOT, 'football-data/PL/2025-26') },
  { name: 'Bundesliga', cachePath: join(CACHE_ROOT, 'football-data/BL1/2025-26') },
];

function loadMatches(cachePath: string): CachedMatch[] {
  let files: string[];
  try { files = readdirSync(cachePath).filter(f => f.endsWith('.json')); }
  catch { return []; }
  const out: CachedMatch[] = [];
  for (const f of files) {
    try { out.push(...(JSON.parse(readFileSync(join(cachePath, f), 'utf8'))?.data?.matches ?? [])); }
    catch { /* skip */ }
  }
  return out;
}

function computeGoalStats(
  teamId: string, matches: CachedMatch[], cutoff: string, venue?: 'HOME' | 'AWAY',
): GoalStatsDTO {
  const cutMs = new Date(cutoff).getTime();
  let gf = 0, ga = 0, pts = 0, played = 0, wA = 0, wD = 0, wT = 0;
  for (const m of matches) {
    if (m.status !== 'FINISHED' || !m.startTimeUtc || m.startTimeUtc >= cutoff
        || m.scoreHome === null || m.scoreAway === null) continue;
    const isHome = m.homeTeamId === teamId, isAway = m.awayTeamId === teamId;
    if (!isHome && !isAway) continue;
    if (venue === 'HOME' && !isHome) continue;
    if (venue === 'AWAY' && !isAway) continue;
    const scored = isHome ? m.scoreHome : m.scoreAway!;
    const conceded = isHome ? m.scoreAway! : m.scoreHome;
    gf += scored; ga += conceded; played++;
    if (scored > conceded) pts += 3; else if (scored === conceded) pts += 1;
    const w = Math.exp(-DECAY_XI * (cutMs - new Date(m.startTimeUtc).getTime()) / MS_PER_DAY);
    wA += scored * w; wD += conceded * w; wT += w;
  }
  return { goalsFor: gf, goalsAgainst: ga, goalDifference: gf - ga, points: pts, playedGames: played,
           lambdaAttack: wT > 0 ? wA / wT : 0, lambdaDefense: wT > 0 ? wD / wT : 0 };
}

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

function computeProbs(homeGS: GoalStatsDTO, homeHomeGS: GoalStatsDTO, homeAwayGS: GoalStatsDTO,
                      awayGS: GoalStatsDTO, awayHomeGS: GoalStatsDTO, awayAwayGS: GoalStatsDTO,
): { home: number; draw: number; away: number } | null {
  const homeVenue = homeHomeGS.playedGames >= MIN_GAMES ? homeHomeGS : homeGS;
  const awayVenue = awayAwayGS.playedGames >= MIN_GAMES ? awayAwayGS : awayGS;
  if (homeVenue.playedGames < MIN_GAMES || awayVenue.playedGames < MIN_GAMES) return null;

  const homeUsedSplit = homeHomeGS.playedGames >= MIN_GAMES;
  const awayUsedSplit = awayAwayGS.playedGames >= MIN_GAMES;
  let lh = (homeVenue.lambdaAttack + awayVenue.lambdaDefense) / 2;
  let la = (awayVenue.lambdaAttack + homeVenue.lambdaDefense) / 2;
  if (!homeUsedSplit || !awayUsedSplit) lh *= HOME_ADV;

  let hw = 0, dr = 0, aw = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    const ph = poissonPmf(lh, h);
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = ph * poissonPmf(la, a) * dcTau(h, a, lh, la);
      if (h > a) hw += p; else if (h === a) dr += p; else aw += p;
    }
  }
  const tot = hw + dr + aw || 1;
  return { home: hw / tot, draw: dr / tot, away: aw / tot };
}

// ── Collect all match probabilities across leagues ─────────────────────────

interface MatchProbs {
  actual: 'HOME' | 'DRAW' | 'AWAY';
  probHome: number;
  probDraw: number;
  probAway: number;
}

const allMatches: MatchProbs[] = [];

for (const league of LEAGUES) {
  const matches = loadMatches(league.cachePath);
  const finished = matches
    .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc)
    .sort((a, b) => a.startTimeUtc < b.startTimeUtc ? -1 : 1);

  for (const match of finished) {
    const prior = matches.filter(m => m.startTimeUtc < match.startTimeUtc);
    const homeGS     = computeGoalStats(match.homeTeamId, prior, match.startTimeUtc);
    const homeHomeGS = computeGoalStats(match.homeTeamId, prior, match.startTimeUtc, 'HOME');
    const homeAwayGS = computeGoalStats(match.homeTeamId, prior, match.startTimeUtc, 'AWAY');
    const awayGS     = computeGoalStats(match.awayTeamId, prior, match.startTimeUtc);
    const awayHomeGS = computeGoalStats(match.awayTeamId, prior, match.startTimeUtc, 'HOME');
    const awayAwayGS = computeGoalStats(match.awayTeamId, prior, match.startTimeUtc, 'AWAY');

    if (homeGS.playedGames < MIN_GAMES || awayGS.playedGames < MIN_GAMES) continue;

    const probs = computeProbs(homeGS, homeHomeGS, homeAwayGS, awayGS, awayHomeGS, awayAwayGS);
    if (!probs) continue;

    const sh = match.scoreHome!, sa = match.scoreAway!;
    const actual: 'HOME' | 'DRAW' | 'AWAY' = sh > sa ? 'HOME' : sh < sa ? 'AWAY' : 'DRAW';
    allMatches.push({ actual, probHome: probs.home, probDraw: probs.draw, probAway: probs.away });
  }
}

// ── Grid search over DRAW_THRESHOLD and DRAW_RATIO ────────────────────────

function selectWinner(
  probHome: number, probDraw: number, probAway: number,
  drawThreshold: number, drawRatio: number,
): 'HOME' | 'DRAW' | 'AWAY' {
  const maxOther = Math.max(probHome, probAway);
  if (probDraw >= drawThreshold && probDraw >= maxOther * drawRatio) return 'DRAW';
  return probHome >= probAway ? 'HOME' : 'AWAY';
}

console.log(`\n🔬 Calibración de umbral de empate — ${allMatches.length} partidos\n`);
console.log(`${'threshold'.padEnd(10)} ${'ratio'.padEnd(8)} ${'acc%'.padEnd(6)} ${'draws%'.padEnd(8)} ${'predDraws'.padEnd(12)} ${'drawAcc%'.padEnd(10)} ${'homeAcc%'.padEnd(10)} ${'awayAcc%'}`);
console.log('─'.repeat(80));

const thresholds = [0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.30, 0.31, 0.32];
const ratios     = [0.65, 0.70, 0.75, 0.80, 0.85, 0.90];

let best = { acc: 0, drawAcc: 0, threshold: 0, ratio: 0, label: '' };

for (const thr of thresholds) {
  for (const ratio of ratios) {
    let hits = 0, drawPred = 0, drawHit = 0, homeHit = 0, homeTot = 0, awayHit = 0, awayTot = 0;
    for (const m of allMatches) {
      const pred = selectWinner(m.probHome, m.probDraw, m.probAway, thr, ratio);
      const hit = pred === m.actual;
      if (hit) hits++;
      if (pred === 'DRAW') { drawPred++; if (hit) drawHit++; }
      if (m.actual === 'HOME') { homeTot++; if (hit) homeHit++; }
      if (m.actual === 'AWAY') { awayTot++; if (hit) awayHit++; }
    }
    const acc = hits / allMatches.length;
    const drawAcc = drawPred > 0 ? drawHit / drawPred : 0;
    const drawRate = drawPred / allMatches.length;
    const homeAcc = homeTot > 0 ? homeHit / homeTot : 0;
    const awayAcc = awayTot > 0 ? awayHit / awayTot : 0;
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

    // Score: balance accuracy with draw coverage (penalize 0 draw predictions)
    const score = acc * 0.6 + (drawPred > 0 ? drawAcc * 0.4 : 0);

    if (score > best.acc || (score === best.acc && drawAcc > best.drawAcc)) {
      best = { acc: score, drawAcc, threshold: thr, ratio, label: `thr=${thr} ratio=${ratio}` };
    }

    console.log(`${String(thr).padEnd(10)} ${String(ratio).padEnd(8)} ${pct(acc).padEnd(6)} ${pct(drawRate).padEnd(8)} ${String(drawPred).padEnd(12)} ${pct(drawAcc).padEnd(10)} ${pct(homeAcc).padEnd(10)} ${pct(awayAcc)}`);
  }
  console.log();
}

console.log(`\n✅ Mejor configuración: DRAW_THRESHOLD=${best.threshold}, DRAW_RATIO=${best.ratio}`);
console.log(`   Score compuesto: ${(best.acc * 100).toFixed(1)}  drawAcc: ${(best.drawAcc * 100).toFixed(1)}%\n`);

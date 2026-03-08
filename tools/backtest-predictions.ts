/**
 * BACKTEST-01: Backtesting del predictor Poisson+DC sobre partidos finalizados.
 *
 * Metodología: para cada partido finalizado, computa GoalStats usando SOLO
 * partidos anteriores (sin data leakage), corre buildPrediction y compara
 * contra el resultado real. Output: accuracy por liga y por tipo de resultado.
 *
 * Uso: pnpm tsx --tsconfig tsconfig.server.json tools/backtest-predictions.ts
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { buildPrediction } from '../packages/snapshot/src/project/prediction-builder.js';
import type { GoalStatsDTO } from '../packages/snapshot/src/dto/team-score.js';

// ── Types ──────────────────────────────────────────────────────────────────────

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

interface LeagueConfig {
  name: string;
  cachePath: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE_ROOT = join(ROOT, 'cache');
const DECAY_XI = 0.006;
const MS_PER_DAY = 86_400_000;
const MIN_GAMES_BACKTEST = 3; // mínimo de partidos previos para confiar en la predicción

const LEAGUES: LeagueConfig[] = [
  { name: 'LaLiga',     cachePath: join(CACHE_ROOT, 'football-data/PD/2025-26') },
  { name: 'Premier',    cachePath: join(CACHE_ROOT, 'football-data/PL/2025-26') },
  { name: 'Bundesliga', cachePath: join(CACHE_ROOT, 'football-data/BL1/2025-26') },
  { name: 'Uruguay',    cachePath: join(CACHE_ROOT, 'thesportsdb/4432/2026') },
];

// ── Load cache ────────────────────────────────────────────────────────────────

function loadLeagueMatches(cachePath: string): CachedMatch[] {
  let files: string[];
  try {
    files = readdirSync(cachePath).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const matches: CachedMatch[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(cachePath, file), 'utf8'));
      const ms: CachedMatch[] = raw?.data?.matches ?? [];
      matches.push(...ms);
    } catch {
      // skip corrupt files
    }
  }
  return matches;
}

// ── GoalStats computation (mirrors team-tile-builder extractGoalStats) ─────────

function computeGoalStats(
  teamId: string,
  priorMatches: CachedMatch[],
  cutoffUtc: string,
  venueFilter?: 'HOME' | 'AWAY',
): GoalStatsDTO {
  const cutoffMs = new Date(cutoffUtc).getTime();
  let goalsFor = 0, goalsAgainst = 0, points = 0, playedGames = 0;
  let wSumAttack = 0, wSumDefense = 0, wTotal = 0;

  for (const m of priorMatches) {
    if (
      m.status !== 'FINISHED' ||
      !m.startTimeUtc ||
      m.startTimeUtc >= cutoffUtc ||
      m.scoreHome === null ||
      m.scoreAway === null
    ) continue;

    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;
    if (!isHome && !isAway) continue;
    if (venueFilter === 'HOME' && !isHome) continue;
    if (venueFilter === 'AWAY' && !isAway) continue;

    const scored = isHome ? m.scoreHome : m.scoreAway!;
    const conceded = isHome ? m.scoreAway! : m.scoreHome;
    goalsFor += scored;
    goalsAgainst += conceded;
    playedGames++;
    if (scored > conceded) points += 3;
    else if (scored === conceded) points += 1;

    const daysAgo = (cutoffMs - new Date(m.startTimeUtc).getTime()) / MS_PER_DAY;
    const w = Math.exp(-DECAY_XI * daysAgo);
    wSumAttack += scored * w;
    wSumDefense += conceded * w;
    wTotal += w;
  }

  return {
    goalsFor, goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    points, playedGames,
    lambdaAttack:  wTotal > 0 ? wSumAttack  / wTotal : 0,
    lambdaDefense: wTotal > 0 ? wSumDefense / wTotal : 0,
  };
}

// ── Backtest runner ───────────────────────────────────────────────────────────

interface MatchResult { hit: boolean; actual: 'HOME' | 'DRAW' | 'AWAY'; predicted: 'HOME' | 'DRAW' | 'AWAY'; confidence: string }

function runLeagueBacktest(name: string, matches: CachedMatch[]): void {
  const finished = matches
    .filter((m) => m.status === 'FINISHED' && m.scoreHome !== null && m.scoreAway !== null && m.startTimeUtc)
    .sort((a, b) => (a.startTimeUtc < b.startTimeUtc ? -1 : 1));

  const results: MatchResult[] = [];

  for (const match of finished) {
    const cutoff = match.startTimeUtc;
    const prior = matches.filter((m) => m.startTimeUtc < cutoff);

    const homeGS     = computeGoalStats(match.homeTeamId, prior, cutoff);
    const homeHomeGS = computeGoalStats(match.homeTeamId, prior, cutoff, 'HOME');
    const homeAwayGS = computeGoalStats(match.homeTeamId, prior, cutoff, 'AWAY');
    const awayGS     = computeGoalStats(match.awayTeamId, prior, cutoff);
    const awayHomeGS = computeGoalStats(match.awayTeamId, prior, cutoff, 'HOME');
    const awayAwayGS = computeGoalStats(match.awayTeamId, prior, cutoff, 'AWAY');

    // Skip if not enough prior data
    if (homeGS.playedGames < MIN_GAMES_BACKTEST || awayGS.playedGames < MIN_GAMES_BACKTEST) continue;

    const pred = buildPrediction(
      true, // home team is always "home" in this context
      match.homeTeamId,
      match.awayTeamId,
      homeHomeGS, homeAwayGS, homeGS,
      awayHomeGS, awayAwayGS, awayGS,
      cutoff,
    );
    if (!pred) continue;

    const val = pred.value as { winner: 'HOME' | 'AWAY' | 'DRAW' };
    const sh = match.scoreHome!;
    const sa = match.scoreAway!;
    const actual: 'HOME' | 'DRAW' | 'AWAY' = sh > sa ? 'HOME' : sh < sa ? 'AWAY' : 'DRAW';

    results.push({
      hit: val.winner === actual,
      actual,
      predicted: val.winner,
      confidence: pred.confidence ?? 'low',
    });
  }

  if (results.length === 0) {
    console.log(`\n${name}: sin partidos evaluables`);
    return;
  }

  const total = results.length;
  const hits  = results.filter((r) => r.hit).length;

  const byActual = (['HOME', 'DRAW', 'AWAY'] as const).map((outcome) => {
    const sub = results.filter((r) => r.actual === outcome);
    const subHits = sub.filter((r) => r.hit).length;
    return { outcome, total: sub.length, hits: subHits };
  });

  const byConf = (['high', 'medium', 'low'] as const).map((conf) => {
    const sub = results.filter((r) => r.confidence === conf);
    const subHits = sub.filter((r) => r.hit).length;
    return { conf, total: sub.length, hits: subHits };
  });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ${name}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Partidos evaluados : ${total}`);
  console.log(`  Accuracy general   : ${hits}/${total} = ${pct(hits, total)}`);
  console.log();
  console.log(`  Por resultado real:`);
  for (const { outcome, total: t, hits: h } of byActual) {
    const label = outcome === 'HOME' ? 'Local ganó ' : outcome === 'DRAW' ? 'Empate     ' : 'Visitante  ';
    const bar = t > 0 ? progressBar(h / t) : '---';
    console.log(`    ${label} ${h}/${t} ${pct(h, t)} ${bar}`);
  }
  console.log();
  console.log(`  Por confianza del modelo:`);
  for (const { conf, total: t, hits: h } of byConf) {
    if (t === 0) continue;
    const label = conf === 'high' ? 'Alta   ' : conf === 'medium' ? 'Media  ' : 'Baja   ';
    const bar = progressBar(h / t);
    console.log(`    ${label} ${h}/${t} ${pct(h, t)} ${bar}`);
  }
}

function pct(hits: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((hits / total) * 100)}%`;
}

function progressBar(ratio: number): string {
  const len = 20;
  const filled = Math.round(ratio * len);
  return '[' + '█'.repeat(filled) + '░'.repeat(len - filled) + ']';
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n🔬 SportsPulse — Backtesting de predicciones Poisson+DC\n');

for (const league of LEAGUES) {
  const matches = loadLeagueMatches(league.cachePath);
  if (matches.length === 0) {
    console.log(`${league.name}: sin datos de cache`);
    continue;
  }
  runLeagueBacktest(league.name, matches);
}

console.log('\n');

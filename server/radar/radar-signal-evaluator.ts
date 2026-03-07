/**
 * Radar SportPulse — Signal Evaluator
 * Computes 6 signal families (0..100) per candidate match.
 * Spec: radar-01-product-functional-spec.md §12, §16
 */

import type { Match } from '@sportpulse/canonical';
import type { StandingEntry } from '@sportpulse/snapshot';
import type {
  RadarCandidate,
  RadarSignalScores,
  RadarEvaluatedMatch,
  RadarSignalKey,
  RadarLabelKey,
  TeamRadarContext,
} from './radar-types.js';
import {
  SIGNAL_THRESHOLDS,
  SIGNAL_TO_LABEL,
  LABEL_PRECEDENCE,
} from './radar-types.js';
import { buildTeamContextMap } from './radar-candidate-builder.js';

export interface SignalEvaluatorInput {
  candidates: RadarCandidate[];
  matches: readonly Match[];
  standings: readonly StandingEntry[];
  buildNowUtc: string;
  totalTeams: number;
}

/**
 * Evaluates all candidate matches and returns sorted evaluated matches.
 */
export function evaluateCandidates(input: SignalEvaluatorInput): RadarEvaluatedMatch[] {
  const { candidates, matches, standings, buildNowUtc, totalTeams } = input;

  // Build context for all teams in candidates
  const allTeamIds = new Set<string>();
  for (const c of candidates) {
    allTeamIds.add(c.homeTeamId);
    allTeamIds.add(c.awayTeamId);
  }
  const teamContextMap = buildTeamContextMap([...allTeamIds], matches, standings, buildNowUtc);

  // League averages
  const leagueAvgGoalsPerGame = computeLeagueAvgGoals(matches, buildNowUtc);

  const evaluated: RadarEvaluatedMatch[] = [];

  for (const candidate of candidates) {
    const homeCtx = teamContextMap.get(candidate.homeTeamId);
    const awayCtx = teamContextMap.get(candidate.awayTeamId);
    if (!homeCtx || !awayCtx) continue;

    const signalScores = computeSignalScores(
      candidate,
      homeCtx,
      awayCtx,
      leagueAvgGoalsPerGame,
      totalTeams,
      matches,
      buildNowUtc,
    );

    // Determine dominant signal and label via precedence
    const { dominantSignal, dominantSignalScore, labelKey } = resolveDominantSignal(signalScores);
    if (!labelKey) continue; // No signal passed threshold

    // radarScore = dominantSignalScore + small context boost
    const contextBoost = computeContextBoost(homeCtx, awayCtx);
    const radarScore = Math.min(100, dominantSignalScore + contextBoost);

    evaluated.push({
      candidate,
      signalScores,
      dominantSignal,
      dominantSignalScore,
      radarScore,
      labelKey,
      homeContext: homeCtx,
      awayContext: awayCtx,
    });
  }

  // Sort by radarScore descending
  return evaluated.sort((a, b) => b.radarScore - a.radarScore);
}

// ── Signal computations ───────────────────────────────────────────────────────

function computeSignalScores(
  candidate: RadarCandidate,
  home: TeamRadarContext,
  away: TeamRadarContext,
  leagueAvgGoals: number,
  totalTeams: number,
  allMatches: readonly Match[],
  buildNowUtc: string,
): RadarSignalScores {
  return {
    attentionScore: computeAttentionScore(candidate, home, away, totalTeams),
    hiddenValueScore: computeHiddenValueScore(candidate, home, away, leagueAvgGoals),
    favoriteVulnerabilityScore: computeFavoriteVulnerabilityScore(candidate, home, away),
    surfaceContradictionScore: computeSurfaceContradictionScore(candidate, home, away, allMatches, buildNowUtc),
    openGameScore: computeOpenGameScore(home, away, leagueAvgGoals),
    tightGameScore: computeTightGameScore(home, away),
  };
}

function computeAttentionScore(
  candidate: RadarCandidate,
  home: TeamRadarContext,
  away: TeamRadarContext,
  totalTeams: number,
): number {
  let score = 0;
  const bottomThreshold = totalTeams - 2; // bottom 3

  if (home.position <= 4 || away.position <= 4) score += 30;
  if (home.position <= 8 && away.position <= 8) score += 20;

  const pointsDiff = Math.abs(home.points - away.points);
  if (pointsDiff <= 3) score += 20;

  // Matchday context boost: jornada avanzada (derivado fuera, usamos matchday)
  // (injected via candidate.matchday — not available directly here, skip for now)

  if (home.position >= bottomThreshold || away.position >= bottomThreshold) score += 15;

  return Math.min(100, score);
}

function computeHiddenValueScore(
  candidate: RadarCandidate,
  home: TeamRadarContext,
  away: TeamRadarContext,
  leagueAvgGoals: number,
): number {
  // Hidden value: lower-visibility match that carries unexpected signals
  // Proxy: neither team in top-4
  if (home.position <= 4 || away.position <= 4) return 0;

  let score = 20; // base: not a headliner

  const underdogCtx = candidate.favoriteSide === 'HOME' ? away : home;
  if (underdogCtx.formScore > 0.60) score += 35;

  // Visiting team scoring well away
  const awayGoalsPerGame = away.playedAway > 0 ? away.goalsForAway / away.playedAway : 0;
  if (awayGoalsPerGame > leagueAvgGoals / 2) score += 25;

  // Favorite fragility (low clean sheets)
  const favoriteCtx = candidate.favoriteSide === 'HOME' ? home : away;
  if (favoriteCtx !== underdogCtx && favoriteCtx.cleanSheetsLast5 <= 1) score += 20;

  return Math.min(100, score);
}

function computeFavoriteVulnerabilityScore(
  candidate: RadarCandidate,
  home: TeamRadarContext,
  away: TeamRadarContext,
): number {
  if (!candidate.favoriteSide) return 0;

  const favoriteCtx = candidate.favoriteSide === 'HOME' ? home : away;
  const underdogCtx = candidate.favoriteSide === 'HOME' ? away : home;

  // Prerequisite: meaningful point difference
  const pointsDiff = Math.abs(home.points - away.points);
  const posDiff = Math.abs(home.position - away.position);
  if (pointsDiff < 8 && posDiff < 5) return 0;

  let score = 0;

  // Favorite conceded in 4 of last 5
  if (favoriteCtx.concededLast5 >= 4) score += 40;
  else if (favoriteCtx.concededLast5 >= 3) score += 25;

  // Underdog won points in 3+ of last 5
  const underdogWins = underdogCtx.recentForm.filter((r) => r === 'W').length;
  const underdogPoints = underdogCtx.recentForm.reduce(
    (acc, r) => acc + (r === 'W' ? 3 : r === 'D' ? 1 : 0),
    0,
  );
  if (underdogPoints >= 9) score += 30; // 3 wins or better
  else if (underdogPoints >= 6) score += 20;

  // Favorite weak as home/away
  if (candidate.favoriteSide === 'HOME') {
    const homeGoalsPerGame = favoriteCtx.playedHome > 0
      ? favoriteCtx.goalsForHome / favoriteCtx.playedHome
      : 0;
    if (homeGoalsPerGame < 1.2) score += 20;
  } else {
    const awayGoalsPerGame = favoriteCtx.playedAway > 0
      ? favoriteCtx.goalsForAway / favoriteCtx.playedAway
      : 0;
    if (awayGoalsPerGame < 0.9) score += 20;
  }

  if (favoriteCtx.formScore < 0.40) score += 10;

  return Math.min(100, score);
}

function computeSurfaceContradictionScore(
  candidate: RadarCandidate,
  home: TeamRadarContext,
  away: TeamRadarContext,
  allMatches: readonly Match[],
  buildNowUtc: string,
): number {
  if (!candidate.favoriteSide) return 0;

  const pointsDiff = Math.abs(home.points - away.points);
  if (pointsDiff < 6) return 0; // No clear surface favorite

  const favoriteCtx = candidate.favoriteSide === 'HOME' ? home : away;
  const underdogCtx = candidate.favoriteSide === 'HOME' ? away : home;

  let score = 0;

  // Recent form of underdog >= favorite
  if (underdogCtx.formScore >= favoriteCtx.formScore) score += 40;
  else if (underdogCtx.formScore > favoriteCtx.formScore - 0.15) score += 20;

  // Away form of underdog vs home form of favorite
  const underdogAwayGPG = underdogCtx.playedAway > 0
    ? underdogCtx.goalsForAway / underdogCtx.playedAway
    : 0;
  const favoriteHomeGPG = favoriteCtx.playedHome > 0
    ? favoriteCtx.goalsForHome / favoriteCtx.playedHome
    : 0;

  if (candidate.favoriteSide === 'HOME' && underdogAwayGPG > favoriteHomeGPG) score += 30;
  else if (candidate.favoriteSide === 'AWAY') {
    // underdog is home — check if home underdog scores more than favorite away
    const underdogHomeGPG = underdogCtx.playedHome > 0
      ? underdogCtx.goalsForHome / underdogCtx.playedHome
      : 0;
    const favoriteAwayGPG = favoriteCtx.playedAway > 0
      ? favoriteCtx.goalsForAway / favoriteCtx.playedAway
      : 0;
    if (underdogHomeGPG > favoriteAwayGPG) score += 30;
  }

  // Favorite without win in last 2-3
  const favoriteRecentWins = favoriteCtx.recentForm.slice(-3).filter((r) => r === 'W').length;
  if (favoriteRecentWins === 0) score += 20;
  else if (favoriteRecentWins <= 1) score += 10;

  // H2H in current season: check if underdog won
  const h2hResult = getH2HResult(
    candidate.homeTeamId,
    candidate.awayTeamId,
    allMatches,
    buildNowUtc,
  );
  if (h2hResult === 'UNDERDOG_WON') score += 10;

  return Math.min(100, score);
}

function computeOpenGameScore(
  home: TeamRadarContext,
  away: TeamRadarContext,
  leagueAvgGoals: number,
): number {
  let score = 0;

  const homeGPG = home.played > 0 ? (home.goalsFor + home.goalsAgainst) / home.played : 0;
  const awayGPG = away.played > 0 ? (away.goalsFor + away.goalsAgainst) / away.played : 0;
  const avgBothGPG = (homeGPG + awayGPG) / 2;

  if (avgBothGPG > 2.8) score += 30;
  else if (avgBothGPG > 2.4) score += 15;

  // Both scored in >= 4 of last 5
  if (home.scoredLast5 >= 4 && away.scoredLast5 >= 4) score += 25;
  else if (home.scoredLast5 >= 3 && away.scoredLast5 >= 3) score += 12;

  // Both conceded in >= 3 of last 5
  const homeConcededGames = 5 - home.cleanSheetsLast5;
  const awayConcededGames = 5 - away.cleanSheetsLast5;
  if (homeConcededGames >= 3 && awayConcededGames >= 3) score += 25;
  else if (homeConcededGames >= 2 && awayConcededGames >= 2) score += 12;

  // Neither has clean sheet in last 3
  if (home.cleanSheetsLast5 === 0 && away.cleanSheetsLast5 === 0) score += 20;

  // Restriction: both must contribute (not just one)
  const homeLooksOpen = home.scoredLast5 >= 3 && home.cleanSheetsLast5 <= 2;
  const awayLooksOpen = away.scoredLast5 >= 3 && away.cleanSheetsLast5 <= 2;
  if (!homeLooksOpen || !awayLooksOpen) score = Math.floor(score * 0.5);

  return Math.min(100, score);
}

function computeTightGameScore(
  home: TeamRadarContext,
  away: TeamRadarContext,
): number {
  let score = 0;

  const homeGPG = home.played > 0 ? (home.goalsFor + home.goalsAgainst) / home.played : 0;
  const awayGPG = away.played > 0 ? (away.goalsFor + away.goalsAgainst) / away.played : 0;
  const avgBothGPG = (homeGPG + awayGPG) / 2;

  if (avgBothGPG < 2.0) score += 35;
  else if (avgBothGPG < 2.5) score += 15;

  // Both have >= 2 clean sheets in last 5
  if (home.cleanSheetsLast5 >= 2 && away.cleanSheetsLast5 >= 2) score += 25;
  else if (home.cleanSheetsLast5 >= 1 && away.cleanSheetsLast5 >= 1) score += 10;

  // Both scored <= 1 in >= 3 of last 5
  const homeLowScoring = (5 - home.scoredLast5) >= 3; // scored in <= 2 of 5
  const awayLowScoring = (5 - away.scoredLast5) >= 3;
  if (homeLowScoring && awayLowScoring) score += 25;
  else if (homeLowScoring || awayLowScoring) score += 10;

  const pointsDiff = Math.abs(home.points - away.points);
  if (pointsDiff <= 4) score += 15;

  return Math.min(100, score);
}

// ── Dominant signal resolver ──────────────────────────────────────────────────

function resolveDominantSignal(scores: RadarSignalScores): {
  dominantSignal: RadarSignalKey;
  dominantSignalScore: number;
  labelKey: RadarLabelKey | null;
} {
  // Map signal key to score
  const signalMap: Record<RadarSignalKey, number> = {
    ATTENTION_CONTEXT: scores.attentionScore,
    HIDDEN_VALUE: scores.hiddenValueScore,
    FAVORITE_VULNERABILITY: scores.favoriteVulnerabilityScore,
    SURFACE_CONTRADICTION: scores.surfaceContradictionScore,
    OPEN_GAME: scores.openGameScore,
    TIGHT_GAME: scores.tightGameScore,
  };

  // Collect signals that pass their threshold
  const qualifiedSignals: { signal: RadarSignalKey; score: number; label: RadarLabelKey }[] = [];

  for (const [signal, score] of Object.entries(signalMap) as [RadarSignalKey, number][]) {
    if (score >= SIGNAL_THRESHOLDS[signal]) {
      qualifiedSignals.push({
        signal,
        score,
        label: SIGNAL_TO_LABEL[signal],
      });
    }
  }

  if (qualifiedSignals.length === 0) {
    // Return dummy values (caller must handle null labelKey)
    return {
      dominantSignal: 'ATTENTION_CONTEXT',
      dominantSignalScore: 0,
      labelKey: null,
    };
  }

  // Apply label precedence: pick the qualified signal whose label has highest precedence
  let winner = qualifiedSignals[0];
  for (const q of qualifiedSignals.slice(1)) {
    const qPriority = LABEL_PRECEDENCE.indexOf(q.label);
    const winnerPriority = LABEL_PRECEDENCE.indexOf(winner.label);
    if (qPriority < winnerPriority) {
      winner = q;
    } else if (qPriority === winnerPriority && q.score > winner.score) {
      winner = q;
    }
  }

  return {
    dominantSignal: winner.signal,
    dominantSignalScore: winner.score,
    labelKey: winner.label,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeLeagueAvgGoals(matches: readonly Match[], buildNowUtc: string): number {
  let totalGoals = 0;
  let count = 0;
  for (const m of matches) {
    if (
      m.status === 'FINISHED' &&
      m.startTimeUtc &&
      m.startTimeUtc < buildNowUtc &&
      m.scoreHome !== null &&
      m.scoreAway !== null
    ) {
      totalGoals += m.scoreHome + m.scoreAway;
      count++;
    }
  }
  return count > 0 ? totalGoals / count : 2.5;
}

function computeContextBoost(home: TeamRadarContext, away: TeamRadarContext): number {
  // Small boost for matches that are contextually relevant
  let boost = 0;
  if (home.position <= 4 || away.position <= 4) boost += 3;
  if (Math.abs(home.points - away.points) <= 3) boost += 2;
  return boost;
}

type H2HResult = 'HOME_WON' | 'AWAY_WON' | 'UNDERDOG_WON' | 'DRAW' | 'NONE';

function getH2HResult(
  homeTeamId: string,
  awayTeamId: string,
  allMatches: readonly Match[],
  buildNowUtc: string,
): H2HResult {
  const h2h = allMatches.find(
    (m) =>
      m.status === 'FINISHED' &&
      m.startTimeUtc &&
      m.startTimeUtc < buildNowUtc &&
      ((m.homeTeamId === homeTeamId && m.awayTeamId === awayTeamId) ||
        (m.homeTeamId === awayTeamId && m.awayTeamId === homeTeamId)) &&
      m.scoreHome !== null &&
      m.scoreAway !== null,
  );

  if (!h2h) return 'NONE';
  if (h2h.scoreHome! === h2h.scoreAway!) return 'DRAW';
  if (h2h.scoreHome! > h2h.scoreAway!) return h2h.homeTeamId === homeTeamId ? 'HOME_WON' : 'AWAY_WON';
  return h2h.homeTeamId === homeTeamId ? 'AWAY_WON' : 'HOME_WON';
}

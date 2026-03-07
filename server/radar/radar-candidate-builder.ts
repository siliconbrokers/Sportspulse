/**
 * Radar SportPulse — Candidate Pool Builder
 * Spec: radar-01-product-functional-spec.md §9 (eligibility)
 */

import type { Match, Team } from '@sportpulse/canonical';
import type { StandingEntry } from '@sportpulse/snapshot';
import type { RadarCandidate } from './radar-types.js';
import { resolveEvidenceTier } from './radar-evidence-tier.js';

const FAVORITE_MIN_POINT_DIFF = 5;

export interface CandidateBuilderInput {
  competitionKey: string;
  seasonKey: string;
  matchday: number;
  matches: readonly Match[];
  standings: readonly StandingEntry[];
}

/**
 * Builds the eligible candidate pool for Radar from the given matchday.
 * Applies all eligibility filters per spec §9.
 */
export function buildCandidatePool(input: CandidateBuilderInput): RadarCandidate[] {
  const { competitionKey, seasonKey, matchday, matches, standings } = input;

  const pointsMap = new Map<string, number>();
  for (const s of standings) {
    pointsMap.set(s.teamId, s.points);
  }

  const evidenceTier = resolveEvidenceTier(matchday);

  const candidates: RadarCandidate[] = [];

  for (const match of matches) {
    // Must belong to selected matchday
    if (match.matchday !== matchday) continue;

    // Not cancelled or postponed
    if (match.status === 'CANCELED' || match.status === 'POSTPONED') continue;

    // Both teams must be resolved
    if (!match.homeTeamId || !match.awayTeamId) continue;

    // Must have a kickoff time
    if (!match.startTimeUtc) continue;

    // Standings must exist (eligibility check)
    if (standings.length === 0) continue;

    // Determine favorite from standings
    const homePoints = pointsMap.get(match.homeTeamId);
    const awayPoints = pointsMap.get(match.awayTeamId);

    let favoriteSide: 'HOME' | 'AWAY' | null = null;
    let underdogSide: 'HOME' | 'AWAY' | null = null;

    if (homePoints !== undefined && awayPoints !== undefined) {
      const diff = homePoints - awayPoints;
      if (Math.abs(diff) >= FAVORITE_MIN_POINT_DIFF) {
        favoriteSide = diff > 0 ? 'HOME' : 'AWAY';
        underdogSide = diff > 0 ? 'AWAY' : 'HOME';
      }
    }

    candidates.push({
      matchId: match.matchId,
      matchday,
      competitionKey,
      seasonKey,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      startTimeUtc: match.startTimeUtc,
      favoriteSide,
      underdogSide,
      evidenceTier,
    });
  }

  return candidates;
}

/**
 * Builds TeamRadarContext for all teams from matches and standings.
 */
export function buildTeamContextMap(
  teamIds: string[],
  matches: readonly Match[],
  standings: readonly StandingEntry[],
  buildNowUtc: string,
): Map<string, import('./radar-types.js').TeamRadarContext> {
  const standingsMap = new Map<string, StandingEntry>();
  for (const s of standings) standingsMap.set(s.teamId, s);

  const result = new Map<string, import('./radar-types.js').TeamRadarContext>();

  for (const teamId of teamIds) {
    const standing = standingsMap.get(teamId);

    // Recent form: last 5 finished matches before buildNowUtc
    const finished = matches
      .filter(
        (m) =>
          m.status === 'FINISHED' &&
          m.startTimeUtc !== null &&
          m.startTimeUtc < buildNowUtc &&
          (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
          m.scoreHome !== null &&
          m.scoreAway !== null,
      )
      .sort((a, b) => (a.startTimeUtc! > b.startTimeUtc! ? -1 : 1));

    const last5 = finished.slice(0, 5);

    const recentForm = last5.reverse().map((m) => {
      const isHome = m.homeTeamId === teamId;
      const gs = isHome ? m.scoreHome! : m.scoreAway!;
      const ga = isHome ? m.scoreAway! : m.scoreHome!;
      if (gs > ga) return 'W' as const;
      if (gs === ga) return 'D' as const;
      return 'L' as const;
    });

    // Form score 0..1
    let rawPoints = 0;
    for (const r of recentForm) {
      if (r === 'W') rawPoints += 3;
      else if (r === 'D') rawPoints += 1;
    }
    const formScore = last5.length > 0 ? rawPoints / (3 * last5.length) : 0;

    // Conceded / clean sheets / scored in last 5
    const last5Full = finished.slice().reverse().slice(0, 5); // re-sort desc, take 5
    // Actually re-derive properly
    const last5Desc = matches
      .filter(
        (m) =>
          m.status === 'FINISHED' &&
          m.startTimeUtc !== null &&
          m.startTimeUtc < buildNowUtc &&
          (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
          m.scoreHome !== null &&
          m.scoreAway !== null,
      )
      .sort((a, b) => (a.startTimeUtc! > b.startTimeUtc! ? -1 : 1))
      .slice(0, 5);

    let concededLast5 = 0;
    let cleanSheetsLast5 = 0;
    let scoredLast5 = 0;

    for (const m of last5Desc) {
      const isHome = m.homeTeamId === teamId;
      const ga = isHome ? m.scoreAway! : m.scoreHome!;
      const gs = isHome ? m.scoreHome! : m.scoreAway!;
      concededLast5 += ga;
      if (ga === 0) cleanSheetsLast5++;
      if (gs > 0) scoredLast5++;
    }

    // Home/away stats (whole season)
    let goalsForHome = 0, goalsAgainstHome = 0, playedHome = 0;
    let goalsForAway = 0, goalsAgainstAway = 0, playedAway = 0;

    for (const m of matches) {
      if (m.status !== 'FINISHED' || m.scoreHome === null || m.scoreAway === null) continue;
      if (!m.startTimeUtc || m.startTimeUtc >= buildNowUtc) continue;

      if (m.homeTeamId === teamId) {
        goalsForHome += m.scoreHome;
        goalsAgainstHome += m.scoreAway;
        playedHome++;
      } else if (m.awayTeamId === teamId) {
        goalsForAway += m.scoreAway;
        goalsAgainstAway += m.scoreHome;
        playedAway++;
      }
    }

    result.set(teamId, {
      teamId,
      position: standing?.position ?? 99,
      points: standing?.points ?? 0,
      played: standing?.playedGames ?? 0,
      goalsFor: standing?.goalsFor ?? goalsForHome + goalsForAway,
      goalsAgainst: standing?.goalsAgainst ?? goalsAgainstHome + goalsAgainstAway,
      goalsForHome,
      goalsAgainstHome,
      goalsForAway,
      goalsAgainstAway,
      playedHome,
      playedAway,
      recentForm,
      formScore,
      concededLast5,
      cleanSheetsLast5,
      scoredLast5,
    });
  }

  return result;
}

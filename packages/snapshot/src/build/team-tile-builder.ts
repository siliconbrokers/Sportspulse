import type { Team, Match } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';
import type { SignalDTO } from '@sportpulse/signals';
import { computeFormPointsLast5, computeNextMatchHours } from '@sportpulse/signals';
import { executePolicy } from '@sportpulse/scoring';
import type { PolicyDefinition, ScoringResult } from '@sportpulse/scoring';
import type { Rect } from '@sportpulse/layout';
import type { TeamScoreDTO, NextMatchDTO, FormResult, GoalStatsDTO } from '../dto/team-score.js';
import { WarningCollector } from '../warnings/warning-collector.js';

export interface TeamTileData {
  tile: TeamScoreDTO;
  layoutWeight: number;
}

/**
 * Builds a TeamScoreDTO (without rect — that comes from layout) for one team.
 * Also collects warnings for missing signals.
 */
export function buildTeamTile(
  team: Team,
  allTeams: readonly Team[],
  matches: readonly Match[],
  buildNowUtc: string,
  policy: PolicyDefinition,
  warnings: WarningCollector,
  matchday?: number,
): Omit<TeamScoreDTO, 'rect'> {
  // Compute signals
  const formSignal = computeFormPointsLast5(team.teamId, matches, buildNowUtc);
  const nextMatchSignal = computeNextMatchHours(team.teamId, matches, buildNowUtc);

  const signals: SignalDTO[] = [formSignal, nextMatchSignal];

  // Collect warnings for missing/degraded signals
  if (formSignal.quality.missing) {
    warnings.missingSignal(team.teamId, 'FORM_POINTS_LAST_5');
  } else if (
    typeof formSignal.params?.matchesUsed === 'number' &&
    formSignal.params.matchesUsed < 5
  ) {
    warnings.insufficientHistory(team.teamId, formSignal.params.matchesUsed as number);
  }

  if (nextMatchSignal.quality.missing) {
    warnings.missingSignal(team.teamId, 'NEXT_MATCH_HOURS');
    warnings.noUpcomingMatch(team.teamId);
  }

  // Execute scoring policy
  const scoringResult: ScoringResult = executePolicy(team.teamId, signals, policy);

  // Extract recent form, goal stats, and next match info
  const recentForm = extractRecentForm(team.teamId, matches, buildNowUtc);
  const goalStats = extractGoalStats(team.teamId, matches, buildNowUtc);
  const nextMatch = extractNextMatch(team.teamId, allTeams, matches, buildNowUtc, matchday);

  return {
    teamId: team.teamId,
    teamName: team.name,
    crestUrl: team.crestUrl,
    venueName: team.venueName,
    coachName: team.coachName,
    recentForm,
    goalStats,
    policyKey: policy.policyKey,
    policyVersion: policy.policyVersion,
    buildNowUtc,
    rawScore: scoringResult.rawScore,
    attentionScore: scoringResult.attentionScore,
    displayScore: scoringResult.displayScore,
    layoutWeight: scoringResult.layoutWeight,
    topContributions: scoringResult.topContributions,
    signals,
    nextMatch,
  };
}

function extractNextMatch(
  teamId: string,
  allTeams: readonly Team[],
  matches: readonly Match[],
  buildNowUtc: string,
  targetMatchday?: number,
): NextMatchDTO | undefined {
  let target: Match | undefined;

  // When a specific matchday is requested, find the match for that matchday
  if (targetMatchday !== undefined) {
    target = matches.find(
      (m) =>
        (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
        m.matchday === targetMatchday &&
        m.startTimeUtc !== null,
    );
  }

  // Fallback: next SCHEDULED match after buildNowUtc
  if (!target) {
    const upcoming = matches
      .filter(
        (m) =>
          (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
          m.status === EventStatus.SCHEDULED &&
          m.startTimeUtc !== null &&
          m.startTimeUtc > buildNowUtc,
      )
      .sort((a, b) => (a.startTimeUtc! < b.startTimeUtc! ? -1 : 1));

    target = upcoming[0];
  }

  if (!target) return undefined;

  const isHome = target.homeTeamId === teamId;
  const opponentId = isHome ? target.awayTeamId : target.homeTeamId;
  const opponent = allTeams.find((t) => t.teamId === opponentId);

  const homeTeam = isHome ? allTeams.find((t) => t.teamId === teamId) : opponent;

  return {
    matchId: target.matchId,
    matchday: target.matchday,
    kickoffUtc: target.startTimeUtc!,
    opponentTeamId: opponentId,
    opponentName: opponent?.name,
    opponentCrestUrl: opponent?.crestUrl,
    opponentRecentForm: extractRecentForm(opponentId, matches, buildNowUtc),
    opponentGoalStats: extractGoalStats(opponentId, matches, buildNowUtc),
    venueName: homeTeam?.venueName,
    venue: isHome ? 'HOME' : 'AWAY',
    scoreHome: target.status === EventStatus.FINISHED ? target.scoreHome : undefined,
    scoreAway: target.status === EventStatus.FINISHED ? target.scoreAway : undefined,
  };
}

const FORM_WINDOW = 5;

function extractRecentForm(
  teamId: string,
  matches: readonly Match[],
  buildNowUtc: string,
): FormResult[] {
  const finished = matches
    .filter(
      (m) =>
        m.status === EventStatus.FINISHED &&
        m.startTimeUtc !== null &&
        m.startTimeUtc < buildNowUtc &&
        (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
        m.scoreHome !== null &&
        m.scoreAway !== null,
    )
    .sort((a, b) => (a.startTimeUtc! > b.startTimeUtc! ? -1 : 1))
    .slice(0, FORM_WINDOW);

  // Reverse so oldest is first (left to right = old to recent)
  return finished.reverse().map((m) => {
    const isHome = m.homeTeamId === teamId;
    const teamScore = isHome ? m.scoreHome! : m.scoreAway!;
    const oppScore = isHome ? m.scoreAway! : m.scoreHome!;
    if (teamScore > oppScore) return 'W';
    if (teamScore === oppScore) return 'D';
    return 'L';
  });
}

function extractGoalStats(
  teamId: string,
  matches: readonly Match[],
  buildNowUtc: string,
): GoalStatsDTO {
  let goalsFor = 0;
  let goalsAgainst = 0;

  for (const m of matches) {
    if (
      m.status !== EventStatus.FINISHED ||
      m.startTimeUtc === null ||
      m.startTimeUtc >= buildNowUtc ||
      (m.homeTeamId !== teamId && m.awayTeamId !== teamId) ||
      m.scoreHome === null ||
      m.scoreAway === null
    )
      continue;

    if (m.homeTeamId === teamId) {
      goalsFor += m.scoreHome;
      goalsAgainst += m.scoreAway;
    } else {
      goalsFor += m.scoreAway;
      goalsAgainst += m.scoreHome;
    }
  }

  return { goalsFor, goalsAgainst, goalDifference: goalsFor - goalsAgainst };
}

import type { Team, Match } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';
import type { SignalDTO } from '@sportpulse/signals';
import { computeFormPointsLast5, computeNextMatchHours } from '@sportpulse/signals';
import { executePolicy } from '@sportpulse/scoring';
import type { PolicyDefinition, ScoringResult } from '@sportpulse/scoring';
import type { Rect } from '@sportpulse/layout';
import type { TeamScoreDTO, NextMatchDTO } from '../dto/team-score.js';
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

  // Extract next match info
  const nextMatch = extractNextMatch(team.teamId, allTeams, matches, buildNowUtc);

  return {
    teamId: team.teamId,
    teamName: team.name,
    crestUrl: team.crestUrl,
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
): NextMatchDTO | undefined {
  const upcoming = matches
    .filter(
      (m) =>
        (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
        m.status === EventStatus.SCHEDULED &&
        m.startTimeUtc !== null &&
        m.startTimeUtc > buildNowUtc,
    )
    .sort((a, b) => (a.startTimeUtc! < b.startTimeUtc! ? -1 : 1));

  if (upcoming.length === 0) return undefined;

  const next = upcoming[0];
  const isHome = next.homeTeamId === teamId;
  const opponentId = isHome ? next.awayTeamId : next.homeTeamId;
  const opponent = allTeams.find((t) => t.teamId === opponentId);

  return {
    matchId: next.matchId,
    kickoffUtc: next.startTimeUtc!,
    opponentTeamId: opponentId,
    opponentName: opponent?.name,
    opponentCrestUrl: opponent?.crestUrl,
    venue: isHome ? 'HOME' : 'AWAY',
  };
}

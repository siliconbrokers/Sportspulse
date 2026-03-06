import type { Rect } from '@sportpulse/layout';
import type { ContributionDTO } from '@sportpulse/scoring';
import type { SignalDTO } from '@sportpulse/signals';

export type FormResult = 'W' | 'D' | 'L';

export interface GoalStatsDTO {
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface NextMatchDTO {
  matchId: string;
  matchday?: number;
  kickoffUtc: string;
  opponentTeamId?: string;
  opponentName?: string;
  opponentCrestUrl?: string;
  opponentRecentForm?: FormResult[];
  opponentGoalStats?: GoalStatsDTO;
  venueName?: string;
  venue?: 'HOME' | 'AWAY' | 'NEUTRAL' | 'UNKNOWN';
  scoreHome?: number | null;
  scoreAway?: number | null;
}

export interface TeamScoreDTO {
  teamId: string;
  teamName: string;
  crestUrl?: string;
  venueName?: string;
  coachName?: string;
  recentForm?: FormResult[];
  goalStats?: GoalStatsDTO;
  policyKey: string;
  policyVersion: number;
  buildNowUtc: string;
  rawScore: number;
  attentionScore: number;
  displayScore: number;
  layoutWeight: number;
  rect: Rect;
  topContributions: ContributionDTO[];
  signals?: SignalDTO[];
  nextMatch?: NextMatchDTO;
}

import type { Rect } from '@sportpulse/layout';
import type { ContributionDTO } from '@sportpulse/scoring';
import type { SignalDTO } from '@sportpulse/signals';
import type { DisplayHintsDTO } from '../display-hints/display-hints-mapper.js';
import type { MatchGoalEventDTO } from '../data/data-source.js';

export type FormResult = 'W' | 'D' | 'L';

export type PredictionType =
  | 'winner'
  | 'double_chance'
  | 'both_teams_score'
  | 'over_under'
  | 'exact_score';

export type PredictionOutcomeStatus =
  | 'pending'
  | 'in_progress'
  | 'hit'
  | 'miss'
  | 'partial'
  | 'not_evaluable';

export interface PredictionDTO {
  type: PredictionType;
  /** User-facing label, e.g. "Ganador: Real Madrid" */
  label: string;
  /** Structured evaluable value — shape depends on type */
  value: string | number | Record<string, unknown>;
  confidence?: 'low' | 'medium' | 'high' | null;
  generatedAt: string;
}

export interface PredictionOutcomeDTO {
  status: PredictionOutcomeStatus;
  evaluatedAt?: string | null;
  actualResult?: { home: number | null; away: number | null } | null;
}

export interface GoalStatsDTO {
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  playedGames: number;
  /** Time-decay weighted average goals scored per game (ξ=0.006/day, half-life ~115d) */
  lambdaAttack: number;
  /** Time-decay weighted average goals conceded per game (ξ=0.006/day, half-life ~115d) */
  lambdaDefense: number;
}

export interface NextMatchDTO {
  matchId: string;
  matchday?: number;
  kickoffUtc: string;
  opponentTeamId?: string;
  opponentName?: string;
  opponentCrestUrl?: string;
  opponentCoachName?: string;
  opponentRecentForm?: FormResult[];
  /** Opponent crest URLs parallel to opponentRecentForm (same index = same match). */
  opponentRecentFormCrests?: (string | null)[];
  opponentGoalStats?: GoalStatsDTO;
  opponentHomeGoalStats?: GoalStatsDTO;
  opponentAwayGoalStats?: GoalStatsDTO;
  venueName?: string;
  venue?: 'HOME' | 'AWAY' | 'NEUTRAL' | 'UNKNOWN';
  scoreHome?: number | null;
  scoreAway?: number | null;
  /** Goles convertidos en tanda de penales (undefined si no hubo penales). */
  scoreHomePenalties?: number | null;
  scoreAwayPenalties?: number | null;
  /** Canonical match status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' | 'POSTPONED' | 'CANCELED' */
  matchStatus?: string;
  /** Período del partido — undefined cuando la API no lo reporta. */
  matchPeriod?: 'FIRST_HALF' | 'HALF_TIME' | 'SECOND_HALF' | 'EXTRA_TIME' | 'PENALTIES';
  /** Minuto real reportado por la API (AF: fixture.status.elapsed). Solo cuando IN_PROGRESS. */
  elapsedMinutes?: number | null;
  prediction?: PredictionDTO;
  predictionOutcome?: PredictionOutcomeDTO;
  /** Goals scored in this match — populated only for FINISHED matches. */
  events?: MatchGoalEventDTO[];
}

export interface TeamScoreDTO {
  teamId: string;
  teamName: string;
  tla?: string;
  crestUrl?: string;
  venueName?: string;
  coachName?: string;
  recentForm?: FormResult[];
  /** Opponent crest URLs parallel to recentForm (same index = same match). */
  recentFormCrests?: (string | null)[];
  goalStats?: GoalStatsDTO;
  homeGoalStats?: GoalStatsDTO;
  awayGoalStats?: GoalStatsDTO;
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
  displayHints?: DisplayHintsDTO;
}

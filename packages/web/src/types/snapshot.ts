/** Frontend-local DTO types mirroring the backend DashboardSnapshotDTO contract. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WarningDTO {
  code: string;
  severity: 'INFO' | 'WARN' | 'ERROR';
  message?: string | null;
  entityId?: string;
}

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
}

export interface ContributionDTO {
  signalKey: string;
  rawValue: number;
  normValue: number;
  weight: number;
  contribution: number;
}

export interface SignalDTO {
  key: string;
  value: number;
  label?: string;
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

export interface SnapshotHeaderDTO {
  snapshotSchemaVersion: number;
  competitionId: string;
  seasonId: string;
  buildNowUtc: string;
  timezone: string;
  policyKey: string;
  policyVersion: number;
  computedAtUtc: string;
  freshnessUtc?: string;
  snapshotKey?: string;
}

export interface LayoutMetadata {
  algorithmKey: string;
  algorithmVersion: number;
  container: {
    width: number;
    height: number;
    outerPadding: number;
    innerGutter: number;
  };
}

export interface DashboardSnapshotDTO {
  header: SnapshotHeaderDTO;
  layout: LayoutMetadata;
  warnings: WarningDTO[];
  teams: TeamScoreDTO[];
}

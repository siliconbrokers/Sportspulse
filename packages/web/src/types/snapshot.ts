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

export interface NextMatchDTO {
  matchId: string;
  kickoffUtc: string;
  opponentTeamId?: string;
  opponentName?: string;
  venue?: 'HOME' | 'AWAY' | 'NEUTRAL' | 'UNKNOWN';
}

export interface ContributionDTO {
  signalKey: string;
  rawContribution: number;
  weightedContribution: number;
  weight: number;
}

export interface SignalDTO {
  key: string;
  value: number;
  label?: string;
}

export interface TeamScoreDTO {
  teamId: string;
  teamName: string;
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

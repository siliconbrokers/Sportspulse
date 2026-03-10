/** Frontend-local DTO types mirroring the backend DashboardSnapshotDTO contract. */

export type ChipLevel = 'INFO' | 'OK' | 'WARN' | 'HOT' | 'ERROR' | 'UNKNOWN';

export interface DisplayChipDTO {
  icon: string;
  label: string;
  level: ChipLevel;
  kind: string;
}

export interface ExplainLineDTO {
  text: string;
  kind: string;
}

export interface DisplayHintsDTO {
  formChip?: DisplayChipDTO;
  nextMatchChip?: DisplayChipDTO;
  deltaChip?: DisplayChipDTO;
  explainLine?: ExplainLineDTO;
}

export interface DisplayRulesDTO {
  displayRulesKey: string;
  displayRulesVersion: number;
}

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

// ── Prediction types (mirror de packages/snapshot — no importar directamente) ──

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
  label: string;
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
  lambdaAttack: number;
  lambdaDefense: number;
}

export interface MatchGoalEventDTO {
  minute: number;
  injuryTime?: number;
  type: 'GOAL' | 'OWN_GOAL' | 'PENALTY';
  team: 'HOME' | 'AWAY';
  scorerName?: string;
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
  opponentGoalStats?: GoalStatsDTO;
  opponentHomeGoalStats?: GoalStatsDTO;
  opponentAwayGoalStats?: GoalStatsDTO;
  venueName?: string;
  venue?: 'HOME' | 'AWAY' | 'NEUTRAL' | 'UNKNOWN';
  scoreHome?: number | null;
  scoreAway?: number | null;
  scoreHomePenalties?: number | null;
  scoreAwayPenalties?: number | null;
  matchStatus?: string;
  prediction?: PredictionDTO;
  predictionOutcome?: PredictionOutcomeDTO;
  events?: MatchGoalEventDTO[];
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
  tla?: string;
  crestUrl?: string;
  venueName?: string;
  coachName?: string;
  recentForm?: FormResult[];
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

export interface MatchCardTeam {
  teamId: string;
  name: string;
  shortName?: string;
  tla?: string;
  crestUrl?: string;
  formChip?: DisplayChipDTO;
}

export type SizeBucket = 'S' | 'M' | 'L' | 'XL';
export type UrgencyColorKey = 'LIVE' | 'TODAY' | 'TOMORROW' | 'D2_3' | 'D4_7' | 'LATER' | 'UNKNOWN';
export type HeatBorderKey = 'NONE' | 'ONE_HOT' | 'BOTH_HOT' | 'DATA_MISSING';
export type FeaturedRank = 'NONE' | 'FEATURED';

export interface MatchTileHintsDTO {
  sizeBucket: SizeBucket;
  urgencyColorKey: UrgencyColorKey;
  heatBorderKey: HeatBorderKey;
  featuredRank: FeaturedRank;
}

export interface MatchCardDTO {
  matchId: string;
  kickoffUtc?: string;
  status?: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'UNKNOWN';
  scoreHome?: number | null;
  scoreAway?: number | null;
  scoreHomePenalties?: number | null;
  scoreAwayPenalties?: number | null;
  timeChip: DisplayChipDTO;
  home: MatchCardTeam;
  away: MatchCardTeam;
  rankScore?: number;
  explainLine?: ExplainLineDTO;
  tileHints?: MatchTileHintsDTO;
}

export interface DashboardSnapshotDTO {
  header: SnapshotHeaderDTO;
  layout: LayoutMetadata;
  warnings: WarningDTO[];
  displayRules: DisplayRulesDTO;
  teams: TeamScoreDTO[];
  matchCards: MatchCardDTO[];
}

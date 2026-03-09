import type {
  WarningDTO,
  NextMatchDTO,
  ContributionDTO,
  SignalDTO,
  FormResult,
  GoalStatsDTO,
  MatchGoalEventDTO,
} from './snapshot.js';

export type { MatchGoalEventDTO };

export interface TeamDetailDTO {
  header: {
    competitionId: string;
    seasonId: string;
    dateLocal: string;
    timezone: string;
    policyKey: string;
    policyVersion: number;
    buildNowUtc: string;
    computedAtUtc: string;
    freshnessUtc?: string;
    warnings: WarningDTO[];
    snapshotKey?: string;
  };
  team: {
    teamId: string;
    teamName: string;
    crestUrl?: string;
    venueName?: string;
    coachName?: string;
    recentForm?: FormResult[];
    goalStats?: GoalStatsDTO;
    homeGoalStats?: GoalStatsDTO;
    awayGoalStats?: GoalStatsDTO;
  };
  score: {
    rawScore: number;
    attentionScore: number;
    displayScore: number;
    layoutWeight: number;
  };
  nextMatch?: NextMatchDTO;
  explainability: {
    topContributions: ContributionDTO[];
    signals?: SignalDTO[];
  };
}

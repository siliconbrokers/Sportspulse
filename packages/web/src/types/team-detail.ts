import type { WarningDTO, NextMatchDTO, ContributionDTO, SignalDTO } from './snapshot.js';

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

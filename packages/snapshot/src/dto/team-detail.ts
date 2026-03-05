import type { ContributionDTO } from '@sportpulse/scoring';
import type { SignalDTO } from '@sportpulse/signals';
import type { WarningDTO } from './snapshot-header.js';
import type { NextMatchDTO } from './team-score.js';

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

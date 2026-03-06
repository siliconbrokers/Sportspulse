import type { Rect } from '@sportpulse/layout';
import type { ContributionDTO } from '@sportpulse/scoring';
import type { SignalDTO } from '@sportpulse/signals';

export interface NextMatchDTO {
  matchId: string;
  kickoffUtc: string;
  opponentTeamId?: string;
  opponentName?: string;
  opponentCrestUrl?: string;
  venue?: 'HOME' | 'AWAY' | 'NEUTRAL' | 'UNKNOWN';
}

export interface TeamScoreDTO {
  teamId: string;
  teamName: string;
  crestUrl?: string;
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

import type { Sport, CompetitionFormat, EventStatus, ParticipantRole } from './enums.js';

export interface Competition {
  competitionId: string;
  sportId: Sport;
  providerKey: string;
  providerCompetitionCode: string;
  name: string;
  formatType: CompetitionFormat;
  isEnabled: boolean;
}

export interface Season {
  seasonId: string;
  competitionId: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface Team {
  teamId: string;
  sportId: Sport;
  name: string;
  shortName?: string;
  crestUrl?: string;
  providerKey: string;
  providerTeamId: string;
}

export interface Match {
  matchId: string;
  seasonId: string;
  startTimeUtc: string | null;
  status: EventStatus;
  homeTeamId: string;
  awayTeamId: string;
  scoreHome: number | null;
  scoreAway: number | null;
  providerKey: string;
  providerMatchId: string;
  lastSeenUtc: string;
}

export interface MatchParticipant {
  matchId: string;
  teamId: string;
  role: ParticipantRole;
}

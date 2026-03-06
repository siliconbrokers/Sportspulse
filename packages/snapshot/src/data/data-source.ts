import type { Team, Match } from '@sportpulse/canonical';

export interface StandingEntry {
  position: number;
  teamId: string;
  teamName: string;
  crestUrl?: string;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface DataSource {
  getTeams(competitionId: string): Team[];
  getMatches(seasonId: string): Match[];
  getSeasonId(competitionId: string): string | undefined;
  getStandings?(competitionId: string): StandingEntry[];
  getCurrentMatchday?(competitionId: string): number | undefined;
  getTotalMatchdays?(competitionId: string): number;
}

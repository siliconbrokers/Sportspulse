import type { Team, Match } from '@sportpulse/canonical';

export interface DataSource {
  getTeams(competitionId: string): Team[];
  getMatches(seasonId: string): Match[];
  getSeasonId(competitionId: string): string | undefined;
}

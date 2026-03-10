export type LeagueKey = 'URU' | 'LL' | 'EPL' | 'BUN' | 'WC' | 'CA' | 'CLI';

export interface NewsHeadline {
  id: string;
  leagueKey: LeagueKey;
  title: string;
  url: string;
  imageUrl: string | null;
  sourceName: string;
  publishedAtUtc: string; // ISO 8601 UTC
  competitionLabel: string;
}

export interface NewsLeagueBlock {
  leagueKey: LeagueKey;
  competitionLabel: string;
  headlines: NewsHeadline[];
  error?: string;
}

export interface NewsFeedDTO {
  blocks: NewsLeagueBlock[];
  fetchedAtUtc: string;
}

export interface StandingsProvider {
  getTop5TeamNames(competitionId: string): string[];
  getLastPlayedMatchday(competitionId: string): number | undefined;
}

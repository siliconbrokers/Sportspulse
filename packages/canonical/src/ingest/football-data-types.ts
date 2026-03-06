/**
 * Provider-specific response types for football-data.org API v4.
 *
 * These types model the raw provider response shapes.
 * They are internal to the canonical package and must NEVER
 * leak into downstream packages (signals, scoring, layout, etc.).
 */

export interface FDCompetitionResponse {
  id: number;
  name: string;
  code: string;
  type: string;
  currentSeason?: {
    id: number;
    startDate: string;
    endDate: string;
  };
}

export interface FDTeamResponse {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  crest?: string;
}

export interface FDTeamsListResponse {
  teams: FDTeamResponse[];
}

export interface FDScoreDetail {
  home: number | null;
  away: number | null;
}

export interface FDMatchResponse {
  id: number;
  season: { id: number };
  utcDate: string;
  status: string;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  score: {
    fullTime: FDScoreDetail;
  };
}

export interface FDMatchesListResponse {
  matches: FDMatchResponse[];
}

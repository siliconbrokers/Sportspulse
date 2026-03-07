import type { SnapshotService, DataSource } from '@sportpulse/snapshot';

// Interfaz mínima para el servicio de noticias (evita importar server/ en packages/)
export interface INewsService {
  getNewsFeed(): Promise<{
    blocks: Array<{
      leagueKey: string;
      competitionLabel: string;
      headlines: Array<{
        id: string;
        leagueKey: string;
        title: string;
        url: string;
        imageUrl: string | null;
        sourceName: string;
        publishedAtUtc: string;
        competitionLabel: string;
      }>;
      error?: string;
    }>;
    fetchedAtUtc: string;
  }>;
}

export interface IVideoService {
  getVideoFeed(): Promise<{
    blocks: Array<{
      leagueKey: string;
      highlight: {
        id: string;
        leagueKey: string;
        title: string;
        videoId: string;
        videoUrl: string;
        embedUrl: string;
        thumbnailUrl: string | null;
        channelTitle: string;
        publishedAtUtc: string;
        sourceName: string;
      } | null;
      error?: string;
    }>;
    fetchedAtUtc: string;
  }>;
}

export interface RadarLiveMatchData {
  matchId: string;
  status: string;
  scoreHome: number | null;
  scoreAway: number | null;
  startTimeUtc: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCrest?: string;
  awayTeamCrest?: string;
}

export interface RadarIndexDTO {
  schemaVersion: number;
  module: string;
  competitionKey: string;
  seasonKey: string;
  matchday: number;
  radarKey: string;
  sectionTitle: string;
  sectionSubtitle: string;
  moduleState: string;
  evidenceTier: string;
  dataQuality: string;
  policyVersion: number;
  generatedAt: string;
  updatedAt: string;
  cardsCount: number;
  cards: Array<{
    matchId: string;
    editorialRank: number;
    editorialState: string;
    labelKey: string;
    labelText: string;
    preMatchText: string;
    hasVerdict: boolean;
    verdict: string | null;
    verdictTitle: string | null;
    verdictText: string | null;
    detailFile: string;
  }>;
}

export interface IRadarService {
  getRadar(
    competitionId: string,
    matchday: number,
    buildNowUtc: string,
  ): Promise<{
    index: RadarIndexDTO | null;
    liveData: RadarLiveMatchData[];
    state: 'ok' | 'empty' | 'unavailable';
  }>;
}

export interface AppDependencies {
  snapshotService: SnapshotService;
  dataSource: DataSource;
  newsService: INewsService;
  videoService?: IVideoService;
  radarService?: IRadarService;
}

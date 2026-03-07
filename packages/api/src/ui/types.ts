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

export interface AppDependencies {
  snapshotService: SnapshotService;
  dataSource: DataSource;
  newsService: INewsService;
  videoService?: IVideoService;
}

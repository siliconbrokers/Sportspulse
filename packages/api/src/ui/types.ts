import type { SnapshotService, DataSource, MatchGoalEventDTO } from '@sportpulse/snapshot';
import type { IPredictionService } from './prediction-route.js';

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

export interface IRadarV2Service {
  getRadar(
    competitionId: string,
    matchday: number,
    buildNowUtc: string,
  ): Promise<{
    snapshot: unknown;
    liveData: unknown[];
    state: 'ok' | 'empty' | 'unavailable';
  }>;
}

export interface IEventosService {
  getEvents(): Promise<{
    events: Array<{
      id: string;
      rawText: string;
      sourceUrl: string;
      sourceLanguage: string;
      sourceTimeText: string | null;
      sourceCompetitionText: string | null;
      sourceStatusText: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      normalizedLeague: string;
      normalizedStatus: string;
      sourceTimezoneOffsetMinutes: number | null;
      startsAtSource: string | null;
      startsAtPortalTz: string | null;
      isTodayInPortalTz: boolean;
      isDebugVisible: boolean;
      openUrl: string | null;
      homeCrestUrl: string | null;
      awayCrestUrl: string | null;
    }>;
    fetchedAtUtc: string;
    debugMode: boolean;
  }>;
}

export interface IMatchEventsService {
  getMatchGoals(canonicalMatchId: string): Promise<MatchGoalEventDTO[]>;
}

export interface ITournamentSource {
  getGroupView(competitionId: string): unknown | null;
  getBracketView(competitionId: string): unknown | null;
  getTournamentMatches(competitionId: string): unknown | null;
}

export interface UpcomingMatchDTO {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeTla?: string;
  awayTla?: string;
  homeCrestUrl: string | null;
  awayCrestUrl: string | null;
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  currentMatchday: number | null;
  normalizedLeague: string;
  normalizedStatus: 'EN_VIVO' | 'PROXIMO';
  kickoffUtc: string;
  startsAtPortalTz: string;
  isTodayInPortalTz: boolean;
  scoreHome: number | null;
  scoreAway: number | null;
  /** Período del partido — undefined cuando la API no lo reporta (e.g. football-data IN_PLAY sin distinción 1T/2T). */
  matchPeriod?: 'FIRST_HALF' | 'HALF_TIME' | 'SECOND_HALF' | 'EXTRA_TIME' | 'PENALTIES';
  /** Minuto real reportado por la API (AF: fixture.status.elapsed). Solo cuando IN_PROGRESS. */
  elapsedMinutes?: number | null;
}

export interface IUpcomingService {
  getUpcoming(windowHours?: number): UpcomingMatchDTO[];
}

export interface PortalConfigSnapshot {
  competitions: Array<{
    id: string;
    slug: string;
    displayName: string;
    enabled: boolean;
    updatedAt: string;
    updatedBy: string;
  }>;
  features: {
    tv: boolean;
    predictions: boolean;
    updatedAt: string;
    updatedBy: string;
  };
}

export interface AppDependencies {
  snapshotService: SnapshotService;
  dataSource: DataSource;
  newsService: INewsService;
  videoService?: IVideoService;
  radarService?: IRadarService;
  radarV2Service?: IRadarV2Service;
  eventosService?: IEventosService;
  matchEventsService?: IMatchEventsService;
  tournamentSource?: ITournamentSource;
  upcomingService?: IUpcomingService;
  predictionService?: IPredictionService;
  getPortalConfig?: () => PortalConfigSnapshot;
}

export type EventStatus = 'EN_VIVO' | 'PROXIMO' | 'DESCONOCIDO';

export type NormalizedLeague =
  | 'URUGUAY_PRIMERA'
  | 'LALIGA'
  | 'PREMIER_LEAGUE'
  | 'BUNDESLIGA'
  | 'OTRA'
  | 'EXCLUIDA';

export type PlaybackOpenMode = 'DIRECT' | 'EMBED_TEST';

export interface ParsedEvent {
  id: string;
  rawText: string;
  sourceUrl: string;
  sourceLanguage: 'ES' | 'EN' | 'PT' | 'UNKNOWN';

  sourceTimeText: string | null;
  sourceCompetitionText: string | null;
  sourceStatusText: string | null;

  homeTeam: string | null;
  awayTeam: string | null;

  normalizedLeague: NormalizedLeague;
  normalizedStatus: EventStatus;

  sourceTimezoneOffsetMinutes: number | null;
  startsAtSource: string | null;
  startsAtPortalTz: string | null;

  isTodayInPortalTz: boolean;
  isDebugVisible: boolean;

  openUrl: string | null;

  /** URL del escudo del equipo local (resuelto desde el DataSource canónico) */
  homeCrestUrl: string | null;
  /** URL del escudo del equipo visitante */
  awayCrestUrl: string | null;
}

export interface RawEvent {
  /** Texto libre del proveedor: "HH:MM - COMPETICION: LOCAL vs VISITANTE" */
  text: string;
  /** URL de reproducción del proveedor */
  url: string | null;
  /** Texto de estado del proveedor: "En Vivo", "Pronto", etc. */
  statusText: string | null;
}

export interface EventosServiceConfig {
  /** Offset en minutos del proveedor respecto a UTC. Default: -300 (UTC-5) */
  sourceTimezoneOffsetMinutes: number;
  /** Zona horaria del portal. Default: America/Montevideo */
  portalTimezone: string;
  /** Si true, todos los eventos incluyen debug */
  debugMode: boolean;
}

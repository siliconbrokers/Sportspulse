/**
 * Tipos compartidos del sistema de incidentes de partido.
 * Implementa spec §7.4 — datos mínimos del snapshot.
 */

export type IncidentType =
  | 'GOAL'
  | 'OWN_GOAL'
  | 'PENALTY_GOAL'
  | 'PENALTY_MISSED'
  | 'YELLOW_CARD'
  | 'RED_CARD'
  | 'YELLOW_RED_CARD'
  | 'SUBSTITUTION'
  | 'VAR';

export interface IncidentEvent {
  type: IncidentType;
  minute: number;
  minuteExtra?: number;
  teamSide: 'HOME' | 'AWAY';
  playerName?: string;
  playerOutName?: string;  // substitutions: jugador que sale
  assistName?: string;     // goals: asistente
  detail?: string;         // "Own Goal", "Penalty", etc.
}

export type IncidentMatchStatus = 'SCHEDULED' | 'LIVE' | 'HT' | 'FINISHED';
export type SnapshotType = 'live' | 'halftime' | 'final';

/** Snapshot persistido por partido — spec §7.4 */
export interface IncidentSnapshot {
  matchId: string;
  snapshotType: SnapshotType;
  matchStatusAtScrape: IncidentMatchStatus;
  homeScoreAtScrape: number;
  awayScoreAtScrape: number;
  scrapedAtUtc: string;  // ISO UTC
  isFinal: boolean;
  events: IncidentEvent[];
}

/** Datos del partido que el endpoint recibe como query params */
export interface MatchCoreInput {
  matchId: string;
  status: IncidentMatchStatus;
  homeScore: number;
  awayScore: number;
  competitionId: string;
  kickoffUtc: string;
  homeTeamName: string;
  awayTeamName: string;
  matchday?: number;
}

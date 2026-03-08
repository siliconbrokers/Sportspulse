/**
 * Tipos de incidentes de partido — espejo del contrato del backend.
 * Importado por el hook y por DetailPanel.
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

export type IncidentMatchStatus = 'SCHEDULED' | 'LIVE' | 'HT' | 'FINISHED';
export type SnapshotType = 'live' | 'halftime' | 'final';

export interface IncidentEvent {
  type: IncidentType;
  minute: number;
  minuteExtra?: number;
  teamSide: 'HOME' | 'AWAY';
  playerName?: string;
  playerOutName?: string;
  assistName?: string;
  detail?: string;
}

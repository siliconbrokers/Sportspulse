/**
 * DTOs de torneo para el frontend.
 * Estas shapes se corresponden con lo que las futuras rutas API devolverán.
 * Definidas aquí para que los componentes puedan compilar sin esperar las rutas.
 */

import type { StandingEntry } from '../hooks/use-standings.js';

// ── Enums espejados (string literal, no depende de canonical) ─────────────────

export type FormatFamily =
  | 'LEAGUE_TABLE'
  | 'GROUP_STAGE_PLUS_KNOCKOUT'
  | 'GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS'
  | 'LEAGUE_PHASE_PLUS_KNOCKOUT';

export type StageType =
  | 'LEAGUE'
  | 'GROUP_STAGE'
  | 'ROUND_OF_32'
  | 'ROUND_OF_16'
  | 'QUARTER_FINALS'
  | 'SEMI_FINALS'
  | 'FINAL'
  | 'PLAYOFF'
  | 'CUSTOM';

// ── Group standings ───────────────────────────────────────────────────────────

export interface GroupDTO {
  groupId: string;
  name: string; // "Group A"
  orderIndex: number;
}

/** Una tabla de posiciones por grupo, lista para renderizar. */
export interface GroupStandingsDTO {
  group: GroupDTO;
  standings: StandingEntry[];
}

// ── Knockout bracket ──────────────────────────────────────────────────────────

export interface TieSlotDTO {
  slotId: string;
  slotRole: 'A' | 'B';
  participantId: string | null;
  placeholderText: string | null;
  /** Nombre del equipo, si participantId está confirmado. */
  teamName?: string;
  crestUrl?: string;
}

export interface TieDTO {
  tieId: string;
  name: string; // "Quarter-final 1"
  roundLabel: string; // "QF"
  orderIndex: number;
  slotA: TieSlotDTO;
  slotB: TieSlotDTO;
  /** Marcador acumulado del cruce (suma ida+vuelta, o partido único). */
  scoreA?: number | null;
  scoreB?: number | null;
  scoreAExtraTime?: number | null;
  scoreBExtraTime?: number | null;
  scoreAPenalties?: number | null;
  scoreBPenalties?: number | null;
  /** teamId del ganador, si está definido. */
  winnerId?: string | null;
}

export interface RoundDTO {
  stageId: string;
  name: string;
  stageType: StageType;
  orderIndex: number;
  ties: TieDTO[];
}

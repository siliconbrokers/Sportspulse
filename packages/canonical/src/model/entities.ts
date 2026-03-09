import type {
  Sport,
  CompetitionFormat,
  EventStatus,
  ParticipantRole,
  FormatFamily,
  StageType,
  StandingScope,
  SlotRole,
} from './enums.js';

export interface Competition {
  competitionId: string;
  sportId: Sport;
  providerKey: string;
  providerCompetitionCode: string;
  name: string;
  formatType: CompetitionFormat;
  isEnabled: boolean;
}

export interface Season {
  seasonId: string;
  competitionId: string;
  label: string;
  startDate: string;
  endDate: string;
  /** Formato del torneo. Undefined = LEAGUE_TABLE (compatibilidad con ligas actuales). */
  formatFamily?: FormatFamily;
}

export interface Team {
  teamId: string;
  sportId: Sport;
  name: string;
  shortName?: string;
  crestUrl?: string;
  venueName?: string;
  coachName?: string;
  providerKey: string;
  providerTeamId: string;
}

export interface Match {
  matchId: string;
  seasonId: string;
  matchday?: number;
  startTimeUtc: string | null;
  status: EventStatus;
  homeTeamId: string;
  awayTeamId: string;
  scoreHome: number | null;
  scoreAway: number | null;
  providerKey: string;
  providerMatchId: string;
  lastSeenUtc: string;
  // ── Tournament fields (optional — undefined for league matches) ────────────
  stageId?: string | null;
  groupId?: string | null;
  tieId?: string | null;
  scoreHomeExtraTime?: number | null;
  scoreAwayExtraTime?: number | null;
  scoreHomePenalties?: number | null;
  scoreAwayPenalties?: number | null;
  winnerTeamId?: string | null;
}

export interface MatchParticipant {
  matchId: string;
  teamId: string;
  role: ParticipantRole;
}

// ── Tournament structure entities ─────────────────────────────────────────────

/**
 * Stage — una fase dentro de una edición de competición.
 * Ejemplos: group stage, round of 16, semi-finals, final.
 * competitionEditionId = seasonId del modelo actual.
 */
export interface Stage {
  stageId: string; /** "stage:{seasonId}:{orderIndex}" */
  competitionEditionId: string; /** = seasonId */
  name: string; /** "Group Stage", "Round of 16" */
  stageType: StageType;
  orderIndex: number; /** 0-based, define el orden dentro de la edición */
  hasStandings: boolean; /** true para LEAGUE, GROUP_STAGE */
  hasBracket: boolean; /** true para fases eliminatorias */
  metadataJson?: string | null;
}

/**
 * Group — un grupo dentro de una fase de grupos.
 * Solo existe para fases de tipo GROUP_STAGE.
 */
export interface Group {
  groupId: string; /** "group:{stageId}:{orderIndex}" */
  stageId: string;
  name: string; /** "Group A", "Group B" */
  orderIndex: number; /** 0-based */
  metadataJson?: string | null;
}

/**
 * StandingTable — tabla de posiciones asociada a una fase o grupo.
 * scope=STAGE → groupId debe ser null (tabla única de la fase).
 * scope=GROUP → groupId requerido.
 */
export interface StandingTable {
  standingTableId: string;
  competitionEditionId: string; /** = seasonId */
  stageId: string;
  groupId?: string | null;
  scope: StandingScope;
  updatedAt?: string | null;
}

/**
 * Tie — cruce eliminatorio dentro de una fase de knockout.
 * Representa un enfrentamiento (puede ser ida y vuelta o partido único).
 */
export interface Tie {
  tieId: string; /** "tie:{stageId}:{orderIndex}" */
  competitionEditionId: string; /** = seasonId */
  stageId: string;
  name: string; /** "Quarter-final 1" */
  roundLabel: string; /** "QF", "SF", "F" */
  orderIndex: number;
  metadataJson?: string | null;
}

/**
 * TieSlot — cada lado de un cruce eliminatorio.
 * Un Tie tiene exactamente 2 slots (role A y role B).
 *
 * Estados válidos:
 *   - participantId definido, placeholderText null → equipo confirmado
 *   - participantId null, placeholderText definido  → placeholder textual ("Winner Group A")
 *   - participantId null, placeholderText null      → slot aún no resuelto
 */
export interface TieSlot {
  slotId: string; /** "slot:{tieId}:{role}" */
  tieId: string;
  slotRole: SlotRole; /** A | B */
  participantId?: string | null; /** teamId si ya está confirmado */
  placeholderText?: string | null; /** "Winner Group A", "Best Third C/D/E" */
  sourceMatchId?: string | null; /** navegación/derivación interna al mismo torneo */
  metadataJson?: string | null;
}

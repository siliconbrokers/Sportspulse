import type { Team, Match, Stage, Group, Tie, TieSlot, StandingTable } from '@sportpulse/canonical';

export interface StandingEntry {
  position: number;
  teamId: string;
  teamName: string;
  tla?: string;
  crestUrl?: string;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** Grupo al que pertenece esta fila. Undefined para ligas (tabla única). */
  groupId?: string;
  /** Badge semántico que viene de la API. Ej: "CHAMPION", "UCL", "RELEGATED". Solo visual. */
  statusBadge?: string | null;
  /** Forma reciente: string de resultados separados por coma, ej. "W,D,L,W,W". */
  form?: string | null;
}

export interface MatchGoalEventDTO {
  minute: number;
  injuryTime?: number;
  type: 'GOAL' | 'OWN_GOAL' | 'PENALTY';
  team: 'HOME' | 'AWAY';
  scorerName?: string;
}

export interface TopScorerEntry {
  rank: number;
  playerName: string;
  teamName: string;
  teamCrestUrl?: string | null;
  goals: number;
  assists: number;
  penalties: number;
}

export interface DataSource {
  // ── Core (requerido por todas las ligas) ──────────────────────────────────
  getTeams(competitionId: string): Team[];
  getMatches(seasonId: string): Match[];
  getSeasonId(competitionId: string): string | undefined;

  // ── League helpers (opcionales, implementados por ligas actuales) ─────────
  getStandings?(competitionId: string, groupId?: string): StandingEntry[];
  getCurrentMatchday?(competitionId: string): number | undefined;
  getLastPlayedMatchday?(competitionId: string): number | undefined;
  getNextMatchday?(competitionId: string): number | undefined;
  getTotalMatchdays?(competitionId: string): number;
  getMatchGoals?(canonicalMatchId: string): Promise<MatchGoalEventDTO[]>;
  getTopScorers?(competitionId: string): Promise<TopScorerEntry[]>;

  // ── Tournament structure (opcionales, solo torneos con fases/grupos) ──────
  getStages?(competitionEditionId: string): Stage[];
  getGroups?(stageId: string): Group[];
  getStandingTables?(competitionEditionId: string): StandingTable[];
  getTies?(stageId: string): Tie[];
  getTieSlots?(tieId: string): TieSlot[];
}

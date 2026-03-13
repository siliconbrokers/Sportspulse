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

/**
 * Metadata for a sub-tournament within a split season.
 * Examples: Clausura / Apertura in Argentine/Uruguayan football.
 */
export interface SubTournamentInfo {
  /** Machine key used as query param and in Match.subTournamentKey. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** True for the sub-tournament active based on today's date. */
  isActive: boolean;
  /**
   * False when the sub-tournament has no real data yet (no played matches and
   * all fixtures are more than 60 days away). UI should show empty-state copy.
   */
  hasData: boolean;
}

export interface DataSource {
  // ── Core (requerido por todas las ligas) ──────────────────────────────────
  getTeams(competitionId: string): Team[];
  /**
   * Returns matches for the given season, optionally filtered to a specific
   * sub-tournament (e.g. 'CLAUSURA', 'APERTURA'). When subTournamentKey is
   * omitted and the season has sub-tournaments, implementations should return
   * only the currently-active sub-tournament's matches (backward-compatible).
   */
  getMatches(seasonId: string, subTournamentKey?: string): Match[];
  getSeasonId(competitionId: string): string | undefined;

  // ── League helpers (opcionales, implementados por ligas actuales) ─────────
  getStandings?(competitionId: string, subTournamentKeyOrGroupId?: string): StandingEntry[];
  getCurrentMatchday?(competitionId: string, subTournamentKey?: string): number | undefined;
  getLastPlayedMatchday?(competitionId: string, subTournamentKey?: string): number | undefined;
  getNextMatchday?(competitionId: string, subTournamentKey?: string): number | undefined;
  getTotalMatchdays?(competitionId: string, subTournamentKey?: string): number;
  getMatchGoals?(canonicalMatchId: string): Promise<MatchGoalEventDTO[]>;
  getTopScorers?(competitionId: string): Promise<TopScorerEntry[]>;

  // ── Sub-tournament support (opcional — ligas con Apertura/Clausura/Intermedio) ──
  /** Returns the list of sub-tournaments in this competition, if any. */
  getSubTournaments?(competitionId: string): SubTournamentInfo[];
  /** Returns the currently-active sub-tournament key based on today's date. */
  getActiveSubTournament?(competitionId: string): string | undefined;

  // ── Tournament structure (opcionales, solo torneos con fases/grupos) ──────
  getStages?(competitionEditionId: string): Stage[];
  getGroups?(stageId: string): Group[];
  getStandingTables?(competitionEditionId: string): StandingTable[];
  getTies?(stageId: string): Tie[];
  getTieSlots?(tieId: string): TieSlot[];
}

/**
 * Radar SportPulse — Types and Enums
 * All closed enums per radar-03-json-contracts-and-lifecycle.md §9
 */

// ── Evidence tier ────────────────────────────────────────────────────────────

export type RadarEvidenceTier = 'BOOTSTRAP' | 'EARLY' | 'STABLE';

// ── Module state ─────────────────────────────────────────────────────────────

export type RadarModuleState =
  | 'READY_PRE_MATCH'
  | 'READY_MIXED'
  | 'READY_POST_MATCH'
  | 'EMPTY'
  | 'UNAVAILABLE';

// ── Editorial state ──────────────────────────────────────────────────────────

export type RadarEditorialState = 'PRE_MATCH' | 'IN_PLAY' | 'POST_MATCH';

// ── Labels ───────────────────────────────────────────────────────────────────

export type RadarLabelKey =
  | 'EN_LA_MIRA'
  | 'BAJO_EL_RADAR'
  | 'SENAL_DE_ALERTA'
  | 'PARTIDO_ENGANOSO'
  | 'PARTIDO_ABIERTO'
  | 'DUELO_CERRADO';

export const LABEL_TEXT: Record<RadarLabelKey, string> = {
  EN_LA_MIRA: 'En la mira',
  BAJO_EL_RADAR: 'Bajo el radar',
  SENAL_DE_ALERTA: 'Señal de alerta',
  PARTIDO_ENGANOSO: 'Partido engañoso',
  PARTIDO_ABIERTO: 'Partido abierto',
  DUELO_CERRADO: 'Duelo cerrado',
};

// Label precedence: lower index = higher priority (spec §15)
export const LABEL_PRECEDENCE: RadarLabelKey[] = [
  'PARTIDO_ENGANOSO',
  'SENAL_DE_ALERTA',
  'PARTIDO_ABIERTO',
  'DUELO_CERRADO',
  'BAJO_EL_RADAR',
  'EN_LA_MIRA',
];

// ── Signal keys ──────────────────────────────────────────────────────────────

export type RadarSignalKey =
  | 'ATTENTION_CONTEXT'
  | 'HIDDEN_VALUE'
  | 'FAVORITE_VULNERABILITY'
  | 'SURFACE_CONTRADICTION'
  | 'OPEN_GAME'
  | 'TIGHT_GAME';

// ── Signal thresholds (spec §16) ─────────────────────────────────────────────

export const SIGNAL_THRESHOLDS: Record<RadarSignalKey, number> = {
  SURFACE_CONTRADICTION: 68,
  FAVORITE_VULNERABILITY: 64,
  OPEN_GAME: 63,
  TIGHT_GAME: 63,
  HIDDEN_VALUE: 60,
  ATTENTION_CONTEXT: 58,
};

// ── Signal → label mapping ───────────────────────────────────────────────────

export const SIGNAL_TO_LABEL: Record<RadarSignalKey, RadarLabelKey> = {
  SURFACE_CONTRADICTION: 'PARTIDO_ENGANOSO',
  FAVORITE_VULNERABILITY: 'SENAL_DE_ALERTA',
  OPEN_GAME: 'PARTIDO_ABIERTO',
  TIGHT_GAME: 'DUELO_CERRADO',
  HIDDEN_VALUE: 'BAJO_EL_RADAR',
  ATTENTION_CONTEXT: 'EN_LA_MIRA',
};

// ── Subtypes per label ───────────────────────────────────────────────────────

export type EnLaMiraSubtype = 'TOP_CONTEXT' | 'FORM_CONTEXT' | 'MATCHDAY_WEIGHT';
export type BajoElRadarSubtype =
  | 'QUIET_COMPETITIVE_SIGNAL'
  | 'LOW_VISIBILITY_CONTEXT'
  | 'NON_OBVIOUS_BALANCE';
export type SenalDeAlertaSubtype =
  | 'FAVORITE_DEFENSIVE_FRAGILITY'
  | 'UNDERDOG_COMPETITIVE_RESISTANCE'
  | 'FAVORITE_WEAK_LOCAL_EDGE';
export type PartidoEngansoSubtype =
  | 'TABLE_FORM_CONTRADICTION'
  | 'FAVORITE_NOT_AS_COMFORTABLE'
  | 'SURFACE_DISTANCE_OVERSOLD';
export type PartidoAbiertoSubtype =
  | 'BOTH_SCORE_AND_CONCEDE'
  | 'GOAL_EXCHANGE_SIGNAL'
  | 'LOW_CONTROL_PROFILE';
export type DueloCerradoSubtype =
  | 'LOW_GOAL_VOLUME'
  | 'TIGHT_BALANCE'
  | 'LOW_MARGIN_PROFILE';

export type RadarSignalSubtype =
  | EnLaMiraSubtype
  | BajoElRadarSubtype
  | SenalDeAlertaSubtype
  | PartidoEngansoSubtype
  | PartidoAbiertoSubtype
  | DueloCerradoSubtype;

// ── Verdict ──────────────────────────────────────────────────────────────────

export type RadarVerdict = 'CONFIRMED' | 'PARTIAL' | 'REJECTED';

export type RadarDataQuality =
  | 'OK'
  | 'PARTIAL_SAMPLE'
  | 'FALLBACK_USED'
  | 'INCONSISTENT_SOURCE'
  | 'UNRESOLVED';

export type RadarResolutionState =
  | 'UNRESOLVED'
  | 'RESOLVED'
  | 'NOT_APPLICABLE'
  | 'CANCELLED'
  | 'FAILED';

// ── Signal scores (raw 0..100) ───────────────────────────────────────────────

export interface RadarSignalScores {
  attentionScore: number;
  hiddenValueScore: number;
  favoriteVulnerabilityScore: number;
  surfaceContradictionScore: number;
  openGameScore: number;
  tightGameScore: number;
}

// ── Candidate match ──────────────────────────────────────────────────────────

export interface RadarCandidate {
  matchId: string;
  matchday: number;
  competitionKey: string;
  seasonKey: string;
  homeTeamId: string;
  awayTeamId: string;
  startTimeUtc: string;
  /** Favor side determined from standings (null = no clear favorite) */
  favoriteSide: 'HOME' | 'AWAY' | null;
  underdogSide: 'HOME' | 'AWAY' | null;
  evidenceTier: RadarEvidenceTier;
}

// ── Team context used for signal computation ─────────────────────────────────

export interface TeamRadarContext {
  teamId: string;
  position: number;
  points: number;
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsForHome: number;
  goalsAgainstHome: number;
  goalsForAway: number;
  goalsAgainstAway: number;
  playedHome: number;
  playedAway: number;
  recentForm: Array<'W' | 'D' | 'L'>;
  formScore: number; // 0..1
  /** Goals conceded per last-5 matches (used for fragility) */
  concededLast5: number;
  /** Clean sheets in last 5 */
  cleanSheetsLast5: number;
  /** Matches scored in last 5 */
  scoredLast5: number;
}

// ── Evaluated match (after signal computation) ───────────────────────────────

export interface RadarEvaluatedMatch {
  candidate: RadarCandidate;
  signalScores: RadarSignalScores;
  dominantSignal: RadarSignalKey;
  dominantSignalScore: number;
  radarScore: number;
  labelKey: RadarLabelKey;
  homeContext: TeamRadarContext;
  awayContext: TeamRadarContext;
}

// ── JSON snapshot contracts (spec §6, §7, §8) ────────────────────────────────

export interface RadarCardEntry {
  matchId: string;
  editorialRank: number;
  editorialState: RadarEditorialState;
  labelKey: RadarLabelKey;
  labelText: string;
  preMatchText: string;
  hasVerdict: boolean;
  verdict: RadarVerdict | null;
  verdictTitle: string | null;
  verdictText: string | null;
  detailFile: string;
}

export interface RadarIndexSnapshot {
  schemaVersion: 1;
  module: 'radar_sportpulse';
  competitionKey: string;
  seasonKey: string;
  matchday: number;
  radarKey: string;
  sectionTitle: 'Radar SportPulse';
  sectionSubtitle: 'Lo que está en la mira hoy';
  moduleState: RadarModuleState;
  evidenceTier: RadarEvidenceTier;
  dataQuality: RadarDataQuality;
  policyVersion: number;
  isHistoricalSnapshot: boolean;
  isHistoricalRebuild: boolean;
  generatedAt: string;
  updatedAt: string;
  cardsCount: number;
  cards: RadarCardEntry[];
  buildReason?: string;
  lastResolvedAt?: string | null;
}

export interface RadarMatchSnapshot {
  schemaVersion: 1;
  module: 'radar_sportpulse';
  competitionKey: string;
  seasonKey: string;
  matchday: number;
  radarKey: string;
  matchId: string;
  editorialRank: number;
  editorialState: RadarEditorialState;
  evidenceTier: RadarEvidenceTier;
  dataQuality: RadarDataQuality;
  policyVersion: number;
  isHistoricalSnapshot: boolean;
  isHistoricalRebuild: boolean;
  buildReason: string;
  generatedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  lastLiveStatusSeen: string | null;
  labelKey: RadarLabelKey;
  labelText: string;
  signalKey: RadarSignalKey;
  signalSubtype: RadarSignalSubtype;
  radarScore: number;
  preMatchText: string;
  reasons: string[];
  favoriteSide: 'HOME' | 'AWAY' | null;
  underdogSide: 'HOME' | 'AWAY' | null;
  signalScores: RadarSignalScores;
  evidenceSources: {
    seasonCurrentUsed: boolean;
    seasonPreviousUsed: boolean;
    bootstrapMode: boolean;
  };
  verdict: RadarVerdict | null;
  verdictTitle: string | null;
  verdictText: string | null;
  postMatchNote: string | null;
  resolutionState: RadarResolutionState;
  selectionContext?: {
    cardsPoolSize: number;
    selectedBy: string;
    contextBoostApplied: number;
  };
}

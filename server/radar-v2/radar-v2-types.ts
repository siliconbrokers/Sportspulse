/**
 * Radar SportPulse v2 — Types and Contracts
 * Spec: spec.sportpulse.radar-v2-core.md, spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md
 *
 * Key changes from v1:
 *   - 3 semantic families (CONTEXT, DYNAMICS, MISALIGNMENT)
 *   - family/label valid combinations enforced at type level
 *   - structured reasons with code+weight+text
 *   - verdict with resolvedAt
 *   - secondaryBadges + confidenceBand on cards
 *   - schemaVersion = "2.0.0"
 *   - NO predictor fields
 */

// ── Families ─────────────────────────────────────────────────────────────────

export type RadarV2Family = 'CONTEXT' | 'DYNAMICS' | 'MISALIGNMENT';

// ── Labels ───────────────────────────────────────────────────────────────────

export type RadarV2Label =
  | 'EN_LA_MIRA'
  | 'BAJO_EL_RADAR'
  | 'PARTIDO_ABIERTO'
  | 'DUELO_CERRADO'
  | 'SENAL_DE_ALERTA'
  | 'PARTIDO_ENGANOSO';

// ── Valid family/label combinations (spec §19) ───────────────────────────────

export const VALID_FAMILY_LABELS: Record<RadarV2Family, readonly RadarV2Label[]> = {
  CONTEXT: ['EN_LA_MIRA', 'BAJO_EL_RADAR'],
  DYNAMICS: ['PARTIDO_ABIERTO', 'DUELO_CERRADO'],
  MISALIGNMENT: ['SENAL_DE_ALERTA', 'PARTIDO_ENGANOSO'],
} as const;

export const LABEL_TO_FAMILY: Record<RadarV2Label, RadarV2Family> = {
  EN_LA_MIRA: 'CONTEXT',
  BAJO_EL_RADAR: 'CONTEXT',
  PARTIDO_ABIERTO: 'DYNAMICS',
  DUELO_CERRADO: 'DYNAMICS',
  SENAL_DE_ALERTA: 'MISALIGNMENT',
  PARTIDO_ENGANOSO: 'MISALIGNMENT',
};

export function isValidFamilyLabel(family: string, label: string): boolean {
  const allowed = VALID_FAMILY_LABELS[family as RadarV2Family];
  if (!allowed) return false;
  return allowed.includes(label as RadarV2Label);
}

// ── Display text ─────────────────────────────────────────────────────────────

export const V2_LABEL_TEXT: Record<RadarV2Label, string> = {
  EN_LA_MIRA: 'En la mira',
  BAJO_EL_RADAR: 'Bajo el radar',
  SENAL_DE_ALERTA: 'Señal de alerta',
  PARTIDO_ENGANOSO: 'Partido engañoso',
  PARTIDO_ABIERTO: 'Partido abierto',
  DUELO_CERRADO: 'Duelo cerrado',
};

export const V2_FAMILY_TEXT: Record<RadarV2Family, string> = {
  CONTEXT: 'Contexto',
  DYNAMICS: 'Dinámica',
  MISALIGNMENT: 'Desalineación',
};

// ── Evidence tiers ───────────────────────────────────────────────────────────

export type RadarV2EvidenceTier = 'BOOTSTRAP' | 'EARLY' | 'STABLE';

// ── Confidence bands ─────────────────────────────────────────────────────────

export type RadarV2ConfidenceBand = 'LOW' | 'MEDIUM' | 'HIGH';

// ── Snapshot status ──────────────────────────────────────────────────────────

export type RadarV2SnapshotStatus = 'READY' | 'EMPTY' | 'DEGRADED' | 'FAILED';

// ── Data quality ─────────────────────────────────────────────────────────────

export type RadarV2DataQuality = 'OK' | 'PARTIAL' | 'DEGRADED';

// ── Verdict status ───────────────────────────────────────────────────────────

export type RadarV2VerdictStatus = 'CONFIRMED' | 'PARTIAL' | 'REJECTED';

// ── Reason contract (spec §6) ────────────────────────────────────────────────

export interface RadarV2Reason {
  code: string;
  weight: number;
  text: string;
}

// ── Verdict contract (spec §7) ───────────────────────────────────────────────

export interface RadarV2Verdict {
  status: RadarV2VerdictStatus;
  label: RadarV2Label;
  verdictText: string;
  resolvedAt: string;
}

// ── Card contract (spec §5) ──────────────────────────────────────────────────

export interface RadarV2Card {
  matchId: string;
  family: RadarV2Family;
  primaryLabel: RadarV2Label;
  secondaryBadges: RadarV2Label[];
  subtype: string;
  confidenceBand: RadarV2ConfidenceBand;
  radarScore: number;
  evidenceTier: RadarV2EvidenceTier;
  reasons: RadarV2Reason[];
  preMatchText: string;
  verdict: RadarV2Verdict | null;
  /**
   * Contexto cuantitativo del motor predictivo — adjuntado en build time, frozen.
   * null si el predictor no tiene datos para este partido, o si es NOT_ELIGIBLE.
   */
  predictionContext: RadarV2PredictionContext | null;
}

// ── Snapshot envelope (spec §4) ──────────────────────────────────────────────

export interface RadarV2Snapshot {
  schemaVersion: '2.0.0';
  competitionKey: string;
  seasonKey: string;
  matchday: number | string;
  generatedAt: string;
  generatorVersion: string;
  status: RadarV2SnapshotStatus;
  dataQuality: RadarV2DataQuality;
  isHistoricalRebuild: boolean;
  evidenceTier: RadarV2EvidenceTier;
  cards: RadarV2Card[];
}

// ── Family precedence for tie-breaking ───────────────────────────────────────
// MISALIGNMENT > DYNAMICS > CONTEXT (most analytically demanding wins ties)

export const FAMILY_PRECEDENCE: readonly RadarV2Family[] = [
  'MISALIGNMENT',
  'DYNAMICS',
  'CONTEXT',
] as const;

// ── Internal evaluation structures ───────────────────────────────────────────

export interface FamilyScore {
  family: RadarV2Family;
  score: number;
  active: boolean;
  bestLabel: RadarV2Label;
  bestLabelScore: number;
  labels: { label: RadarV2Label; score: number }[];
}

export interface RadarV2InternalCandidate {
  matchId: string;
  familyScores: FamilyScore[];
  dominantFamily: RadarV2Family;
  primaryLabel: RadarV2Label;
  secondaryBadges: RadarV2Label[];
  radarScore: number;
  confidenceBand: RadarV2ConfidenceBand;
  evidenceTier: RadarV2EvidenceTier;
  subtype: string;
}

// ── Prediction context (integrated from predictor, frozen at build time) ─────

/**
 * Contexto cuantitativo del motor predictivo, capturado en build time y frozen con el snapshot.
 * Nunca modifica preMatchText ni verdict — es información adicional de lectura.
 *
 * Gating:
 *   - NOT_ELIGIBLE → no se adjunta (predictionContext = null en la card)
 *   - LIMITED_MODE → solo xG presente (probs calibradas = null, predictedResult = null)
 *   - FULL_MODE    → bloque completo
 */
export interface RadarV2PredictionContext {
  operatingMode: 'FULL_MODE' | 'LIMITED_MODE' | 'NOT_ELIGIBLE';
  eligibilityStatus: 'ELIGIBLE' | 'NOT_ELIGIBLE';
  /** Probabilidad calibrada de victoria local. null si NOT_ELIGIBLE o LIMITED_MODE. */
  probHomeWin: number | null;
  /** Probabilidad calibrada de empate. null si NOT_ELIGIBLE o LIMITED_MODE. */
  probDraw: number | null;
  /** Probabilidad calibrada de victoria visitante. null si NOT_ELIGIBLE o LIMITED_MODE. */
  probAwayWin: number | null;
  /** Goles esperados local (lambda_home). null si NOT_ELIGIBLE. */
  expectedGoalsHome: number | null;
  /** Goles esperados visitante (lambda_away). null si NOT_ELIGIBLE. */
  expectedGoalsAway: number | null;
  /** Resultado predicho. null si NOT_ELIGIBLE o LIMITED_MODE. */
  predictedResult: 'HOME' | 'DRAW' | 'AWAY' | 'TOO_CLOSE' | null;
  /** top_1_prob - top_2_prob. null si NOT_ELIGIBLE o LIMITED_MODE. */
  favoriteMargin: number | null;
  /** P(total goles >= 3). null si NOT_ELIGIBLE. */
  over2_5: number | null;
  /** P(ambos marcan >= 1). null si NOT_ELIGIBLE. */
  bttsYes: number | null;
  calibrationMode: 'bootstrap' | 'trained' | 'not_applied';
  engineId: string;
  generatedAt: string;
}

// ── Generator version ────────────────────────────────────────────────────────

export const RADAR_V2_GENERATOR_VERSION = 'radar-v2-integrated-1.1.0';
export const RADAR_V2_SCHEMA_VERSION = '2.0.0' as const;
export const RADAR_V2_MAX_CARDS = 3;

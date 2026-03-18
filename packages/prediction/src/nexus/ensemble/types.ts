/**
 * types.ts — NEXUS Meta-Ensemble: Type Definitions.
 *
 * Spec authority:
 *   - taxonomy spec S7.1–S7.8: meta-ensemble architecture, method, segmentation,
 *     weight learning procedure, fallback, output contract, versioning
 *   - taxonomy spec S8.1–S8.7: calibration (isotonic one-vs-rest, per-liga vs global)
 *   - taxonomy spec S9.1–S9.4: operating modes (FULL_MODE, LIMITED_MODE, NOT_ELIGIBLE)
 *
 * SPEC_AMBIGUITY #1 (S7.4.4c vs prompt):
 *   Prompt states `w_track12 >= 0.35`. Spec S7.4.4c states:
 *   "Minimum weight for Track 1+2 of 0.20 (prevents degenerate solutions where
 *    the goals model is entirely ignored)."
 *   Spec governs. MIN_WEIGHT_TRACK12 = 0.20.
 *
 * SPEC_AMBIGUITY #2 (S7.4.4d vs prompt):
 *   Prompt states `w_track4 <= 0.35`. Spec S7.4.4d states:
 *   "No maximum weight for any track (the ensemble may legitimately learn to
 *    rely heavily on market signal for certain segments)."
 *   Spec governs. No upper bound constraint on Track 4.
 *
 * SPEC_AMBIGUITY #3 (SA/FL1 per-liga vs threshold-based):
 *   Prompt states SA and FL1 must always use per-liga calibration.
 *   Spec S8.3 states: per-liga when >= 300 samples, global otherwise — threshold-based.
 *   Spec governs. SA/FL1 use per-liga when >= 300 samples, else fall to global.
 *   This is consistent with V3's confirmed bias-per-league problem: when < 300 samples
 *   exist for SA/FL1, the global calibrator is used by necessity (insufficient data
 *   to train a reliable per-liga calibrator).
 *   Assumption: "sesgo propio confirmado" is handled by the per-liga calibrator once
 *   enough samples accumulate. — SPEC_AMBIGUITY: assumption logged here.
 *
 * @module nexus/ensemble/types
 */

// ── DataQualityTier: canonical definition lives in feature-store/types.ts ─
// We import it for use in this module AND re-export it so callers can import
// from ensemble. The re-export below must NOT conflict with the nexus/index.ts
// barrel (feature-store already exports this type there).
// Note: when this module is used standalone (not via nexus/index.ts barrel),
// the re-export is required. When consumed via nexus/index.ts, feature-store
// provides it. The barrel in ensemble/index.ts deliberately omits DataQualityTier
// to avoid the duplicate export conflict.
import type { DataQualityTier as FeatureStoreDataQualityTier } from '../feature-store/types.js';

// ── Track 1+2 combined output (taxonomy spec S7.2) ────────────────────────

/**
 * Output from the combined Track 1+2 (structural + goals model).
 *
 * Track 1 produces team strength estimates; Track 2 transforms them into
 * 1X2 probabilities via the Poisson/Dixon-Coles goals model. For ensemble
 * purposes, this is a single member.
 *
 * taxonomy spec S7.2: "Note on Track 1 and Track 2: For ensemble purposes,
 * the combined (Track 1 + Track 2) output is a single ensemble member."
 *
 * INVARIANT: probs.home + probs.draw + probs.away = 1.0 (within 1e-10).
 */
export interface Track12Output {
  probs: {
    home: number;
    draw: number;
    away: number;
  };
}

/**
 * Output from Track 3 (tabular discriminative model).
 * Imported from track3/types.ts shape but redeclared here for type isolation
 * within the ensemble module. The ensemble only needs the probs triple.
 *
 * INVARIANT: probs.home + probs.draw + probs.away = 1.0 (within 1e-10).
 */
export interface Track3EnsembleInput {
  probs: {
    home: number;
    draw: number;
    away: number;
  };
}

/**
 * Output from Track 4 (market signal de-vigged probabilities).
 * 'DEACTIVATED' when no odds snapshot is available as-of buildNowUtc.
 *
 * taxonomy spec S6.3: "Track 4 is deactivated only when no snapshot is
 * available at all."
 * taxonomy spec S6.4: Track4Output interface.
 *
 * INVARIANT when active: probs.home + probs.draw + probs.away = 1.0 (within 1e-10).
 */
export interface Track4EnsembleInput {
  status: 'ACTIVE_HIGH' | 'ACTIVE_MEDIUM' | 'ACTIVE_LOW' | 'DEACTIVATED';
  probs?: {
    home: number;
    draw: number;
    away: number;
  };
  oddsSource?: string;
}

// ── Prediction horizon (taxonomy spec S7.3) ───────────────────────────────

/**
 * Prediction horizon bucket based on time-to-kickoff.
 *
 * taxonomy spec S7.3:
 *   FAR:    > 48h to kickoff
 *   MEDIUM: 24–48h to kickoff
 *   NEAR:   < 24h to kickoff
 */
export type PredictionHorizon = 'FAR' | 'MEDIUM' | 'NEAR';

// ── Data quality tier (taxonomy spec S7.3, NEXUS-0 S7.3) ─────────────────

// DataQualityTier: type alias re-exporting from feature-store.
// This allows other ensemble modules to import it from './types.js'.
// The ensemble/index.ts barrel deliberately does NOT re-export DataQualityTier
// to avoid collision with feature-store's export in nexus/index.ts.
export type DataQualityTier = FeatureStoreDataQualityTier;

// ── Ensemble segment key (taxonomy spec S7.3) ─────────────────────────────

/**
 * Identifies a specific weight vector in the segmented ensemble.
 *
 * taxonomy spec S7.3: 27 segments (3 leagues x 3 horizons x 3 quality tiers)
 * + 1 global fallback = 28 total.
 *
 * Format: '{league}/{horizon}/{quality}' e.g. 'PD/NEAR/FULL'
 * Special: 'global' for the global fallback.
 */
export type SegmentKey = string;

// ── Weight vector (taxonomy spec S7.4) ────────────────────────────────────

/**
 * Ensemble weight vector for one segment.
 *
 * Constraints (taxonomy spec S7.4.4):
 *   a. All weights >= 0.
 *   b. track12 + track3 + track4 = 1.0 (when all tracks active).
 *   c. track12 >= MIN_WEIGHT_TRACK12 (= 0.20 per spec S7.4.4c).
 *   d. No upper bound on any track (spec S7.4.4d explicitly forbids it).
 *
 * When Track 4 is deactivated, track4 = 0 and track12 + track3 = 1.0,
 * with track12 >= MIN_WEIGHT_TRACK12 maintained (taxonomy spec S7.6).
 */
export interface WeightVector {
  track12: number;
  track3: number;
  track4: number;
}

/**
 * Minimum weight for Track 1+2 (taxonomy spec S7.4.4c).
 * Value: 0.20
 *
 * SPEC_AMBIGUITY #1: Prompt stated 0.35. Spec states 0.20. Spec governs.
 */
export const MIN_WEIGHT_TRACK12 = 0.20;

// ── Ensemble weight registry (taxonomy spec S7.3, S7.4) ──────────────────

/**
 * Full registry of learned weight vectors across all segments.
 *
 * taxonomy spec S7.3: 28 weight vectors (27 segments + 1 global fallback).
 * taxonomy spec S7.4.5: fallback hierarchy — segment → league+horizon →
 *   league → global. Global must have >= 200 samples or learning fails.
 */
export interface WeightRegistry {
  /** Segment-specific weights. Key = SegmentKey. */
  segments: Record<SegmentKey, WeightVector>;
  /** Global fallback weight vector (used when all segment fallbacks exhausted). */
  global: WeightVector;
  /** Ensemble version identifier (taxonomy spec S7.8). */
  ensembleVersion: string;
  /** ISO 8601 UTC timestamp when weights were learned. */
  learnedAt: string;
}

// ── Calibration types (taxonomy spec S8) ──────────────────────────────────

/**
 * A single (raw probability, actual outcome) pair used to fit calibration.
 *
 * taxonomy spec S8.2: "Collect all raw ensemble probabilities for that class
 * over the calibration training set."
 *
 * Anti-lookahead: matchUtcDate < calibrationTable.fittedAt (S8.5).
 */
export interface CalibrationDataPoint {
  /** Raw ensemble probability for the target class (before calibration). */
  rawProb: number;
  /** 1 if this class was the actual outcome, 0 otherwise. */
  isActual: 0 | 1;
  /** ISO 8601 UTC date of the match — for anti-lookahead guard. */
  matchUtcDate: string;
  /** League code for per-liga segmentation. */
  leagueCode: string;
}

/**
 * Piecewise-linear calibration node.
 * rawProb → calProb mapping point from isotonic regression.
 */
export interface CalibrationPoint {
  rawProb: number;
  calProb: number;
}

/**
 * Per-class calibration model (one-vs-rest).
 * taxonomy spec S8.2: one calibrator per class (home, draw, away).
 */
export interface PerClassCalibrator {
  home: CalibrationPoint[];
  draw: CalibrationPoint[];
  away: CalibrationPoint[];
}

/**
 * NEXUS calibration table.
 *
 * taxonomy spec S8.3: per-liga when >= 300 samples, global otherwise.
 * taxonomy spec S8.7: calibrationVersion bumped on every recalibration.
 */
export interface NexusCalibrationTable {
  /** League code this table was trained for. 'global' for the global fallback. */
  leagueCode: string;
  /** Per-class calibrators (home, draw, away). */
  calibrators: PerClassCalibrator;
  /** Number of matches used to train this calibration. */
  nCalibrationMatches: number;
  /** ISO 8601 UTC timestamp when this calibration was fitted (anti-lookahead anchor). */
  fittedAt: string;
  /** Calibration version (taxonomy spec S8.7). */
  calibrationVersion: string;
}

/**
 * Source of calibration applied.
 * taxonomy spec S8.3: per-liga >= 300 samples, global otherwise.
 */
export type CalibrationSource = 'per_league' | 'global';

// ── Training record for walk-forward weight optimization ──────────────────

/**
 * A single historical match record used for ensemble weight training.
 *
 * taxonomy spec S7.4.2: "For each match, reconstruct each track's prediction
 * using the as-of view at the match's buildNowUtc."
 *
 * Anti-lookahead: buildNowUtc < kickoffUtc (caller's responsibility per NEXUS-0).
 */
export interface EnsembleTrainingRecord {
  /** Match identifier. */
  matchId: string;
  /** League code. */
  leagueCode: string;
  /** ISO 8601 UTC match kickoff timestamp. */
  kickoffUtc: string;
  /** buildNowUtc used for this prediction (strictly < kickoffUtc). */
  buildNowUtc: string;
  /** Track 1+2 reconstructed prediction at buildNowUtc. */
  track12Probs: { home: number; draw: number; away: number };
  /** Track 3 reconstructed prediction at buildNowUtc. null if Track 3 was excluded. */
  track3Probs: { home: number; draw: number; away: number } | null;
  /** Track 4 probabilities at buildNowUtc. null if Track 4 was DEACTIVATED. */
  track4Probs: { home: number; draw: number; away: number } | null;
  /** Realized outcome. */
  actualOutcome: 'home' | 'draw' | 'away';
  /** Prediction horizon at buildNowUtc. */
  horizon: PredictionHorizon;
  /** Data quality tier at buildNowUtc. */
  dataQuality: DataQualityTier;
}

// ── Ensemble combiner output ──────────────────────────────────────────────

/**
 * Result of combining active tracks into a single 1X2 distribution.
 * Pre-calibration.
 *
 * taxonomy spec S7.7 (pre-calibration subset of EnsembleOutput).
 */
export interface CombinedProbsUncalibrated {
  home: number;
  draw: number;
  away: number;
  /** The actual weight vector applied (may differ from learned if T4 deactivated). */
  weightsApplied: WeightVector;
  /** Segment key used to look up the weight vector. */
  segmentUsed: SegmentKey;
  /** Whether the weight fallback hierarchy was triggered. */
  fallbackApplied: boolean;
}

// ── Full ensemble output (taxonomy spec S7.7 + S8.6 + S10) ───────────────

/**
 * Full NEXUS ensemble output: calibrated 1X2 + audit fields.
 *
 * This is the primary output type from nexus-ensemble.ts.
 *
 * taxonomy spec S7.7: EnsembleOutput interface.
 * taxonomy spec S8.6: calibrated probs replace raw probs.
 * taxonomy spec S10.2–S10.3: base fields + NEXUS extension fields.
 *
 * Fields named to match the NexusEnsembleOutput shape from the task prompt.
 */
export interface NexusEnsembleOutput {
  /** Calibrated 1X2 probabilities. Sum to 1.0 (within 1e-9). */
  probs: {
    home: number;
    draw: number;
    away: number;
  };
  /** Pre-calibration 1X2 probabilities from the weighted combination. */
  probs_uncalibrated: {
    home: number;
    draw: number;
    away: number;
  };
  /** Weights actually applied (may differ from learned due to T4 deactivation). */
  weights: WeightVector;
  /** Track 4 activation status. */
  track4_status: Track4EnsembleInput['status'];
  /** Whether calibration used a per-league or global table. */
  calibration_source: CalibrationSource;
  /** Ensemble confidence based on margin between top-2 outcomes. */
  ensemble_confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Segment used for weight selection. */
  segment_used: SegmentKey;
  /** Whether the weight fallback hierarchy was triggered. */
  fallback_applied: boolean;
  /** Operating mode (taxonomy spec S9). */
  operating_mode: 'FULL_MODE' | 'LIMITED_MODE';
}

// ── Confidence margin thresholds (taxonomy spec S7.7) ────────────────────

/**
 * Margin thresholds for ensemble_confidence.
 * Derived from V3's too_close_margin_threshold pattern.
 *
 * HIGH:   top-2 margin >= 0.15
 * MEDIUM: top-2 margin >= 0.05
 * LOW:    top-2 margin < 0.05
 *
 * SPEC_AMBIGUITY: taxonomy spec S7.7 defines confidence as "Based on margin
 * between top-2 outcomes" without specifying exact thresholds.
 * Assumption: inherit V3 thresholds (HIGH=0.15, LOW=0.05) as the safe default.
 */
export const CONFIDENCE_THRESHOLD_HIGH = 0.15;
export const CONFIDENCE_THRESHOLD_MEDIUM = 0.05;

// ── Calibration sample threshold (taxonomy spec S8.3) ────────────────────

/**
 * Minimum samples required for per-liga calibration.
 * taxonomy spec S8.3: "League has >= 300 completed predictions → per-liga."
 * Same as V3 (inherited per spec S8.3 note).
 */
export const MIN_SAMPLES_PER_LIGA_CALIBRATION = 300;

// ── Weight learning thresholds (taxonomy spec S7.4.5) ────────────────────

/**
 * Minimum samples per segment to use segment-level weights.
 * taxonomy spec S7.4.5a: < 50 samples → fall back to parent.
 */
export const MIN_SAMPLES_SEGMENT = 50;

/**
 * Minimum samples per league to use league-level weights.
 * taxonomy spec S7.4.5c: < 100 samples → fall back to global.
 */
export const MIN_SAMPLES_LEAGUE = 100;

/**
 * Minimum samples for global weight vector.
 * taxonomy spec S7.4.5d: global must have >= 200 samples or learning fails.
 */
export const MIN_SAMPLES_GLOBAL = 200;

// ── Ensemble version ──────────────────────────────────────────────────────

/**
 * Current ensemble version.
 * taxonomy spec S7.8: bumped when weight procedure, segmentation, or fallback
 * rules change.
 */
export const ENSEMBLE_VERSION = 'nexus-ensemble-v1.0';

/**
 * Current calibration version (bootstrap — no real training data yet).
 * taxonomy spec S8.7: bumped on every recalibration.
 */
export const CALIBRATION_VERSION = 'nexus-cal-bootstrap-v1.0';

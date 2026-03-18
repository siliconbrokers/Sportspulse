/**
 * nexus-ensemble.ts — NEXUS Meta-Ensemble Orchestrator.
 *
 * Spec authority:
 *   - taxonomy spec S7: meta-ensemble (weights, combination, fallback)
 *   - taxonomy spec S8: calibration (per-liga, global, anti-lookahead)
 *   - taxonomy spec S9: operating modes
 *   - taxonomy spec S10: output contract
 *
 * This is the top-level module that orchestrates the full NEXUS prediction
 * pipeline from track outputs to a calibrated NexusEnsembleOutput.
 *
 * FLOW:
 *   1. Receive Track 1+2, Track 3, Track 4 outputs.
 *   2. Determine active tracks and operating mode.
 *   3. Look up segment weight vector from registry (with fallback).
 *   4. Redistribute weights for inactive tracks (taxonomy spec S7.6).
 *   5. Linear combination → pre-calibration probs.
 *   6. Apply calibration (per-liga or global, taxonomy spec S8.3).
 *   7. Compute ensemble confidence from top-2 margin.
 *   8. Return NexusEnsembleOutput.
 *
 * PURE FUNCTION: no Date.now(), no IO, no Math.random().
 *
 * @module nexus/ensemble/nexus-ensemble
 */

import type {
  Track12Output,
  Track3EnsembleInput,
  Track4EnsembleInput,
  WeightRegistry,
  NexusCalibrationTable,
  NexusEnsembleOutput,
  PredictionHorizon,
  DataQualityTier,
} from './types.js';
import {
  CONFIDENCE_THRESHOLD_HIGH,
  CONFIDENCE_THRESHOLD_MEDIUM,
} from './types.js';
import { combineEnsemble } from './ensemble-combiner.js';
import { applyNexusCalibration } from './ensemble-calibrator.js';

// ── Confidence computation (taxonomy spec S7.7) ───────────────────────────

/**
 * Determine ensemble confidence from the margin between the top-2 outcomes.
 *
 * taxonomy spec S7.7: "Based on margin between top-2 outcomes."
 *
 * SPEC_AMBIGUITY (from types.ts): thresholds not explicitly specified in spec.
 * Assumption: inherit V3 thresholds (HIGH >= 0.15, MEDIUM >= 0.05).
 *
 * @param probs  Calibrated 1X2 probabilities.
 * @returns      'HIGH' | 'MEDIUM' | 'LOW'
 */
function computeEnsembleConfidence(
  probs: { home: number; draw: number; away: number },
): 'HIGH' | 'MEDIUM' | 'LOW' {
  const sorted = [probs.home, probs.draw, probs.away].sort((a, b) => b - a);
  const margin = sorted[0]! - sorted[1]!;

  if (margin >= CONFIDENCE_THRESHOLD_HIGH) return 'HIGH';
  if (margin >= CONFIDENCE_THRESHOLD_MEDIUM) return 'MEDIUM';
  return 'LOW';
}

// ── Operating mode determination (taxonomy spec S9.3) ─────────────────────

/**
 * Determine operating mode from track availability.
 *
 * taxonomy spec S9.3 (relevant subset for ensemble layer):
 *   - If track3Excluded AND track4Inactive → LIMITED_MODE
 *   - If track3Excluded (track4 active) → LIMITED_MODE
 *   - Otherwise → FULL_MODE
 *
 * NOT_ELIGIBLE is determined upstream (match-level check) before the ensemble
 * is invoked. The ensemble only receives FULL or LIMITED candidates.
 */
function determineOperatingMode(
  track3Active: boolean,
  track4Status: Track4EnsembleInput['status'],
): 'FULL_MODE' | 'LIMITED_MODE' {
  const track4Active = track4Status !== 'DEACTIVATED';

  // taxonomy spec S9.3: "if (track3Excluded AND track4Inactive) -> LIMITED_MODE"
  if (!track3Active && !track4Active) return 'LIMITED_MODE';

  // taxonomy spec S9.3: "if (track3Excluded) -> LIMITED_MODE"
  if (!track3Active) return 'LIMITED_MODE';

  // Track 4 absent alone does NOT trigger LIMITED_MODE:
  // taxonomy spec S9.2: "Track 4 inactive... otherwise FULL_MODE (market odds
  //   absence alone does not trigger LIMITED)"
  return 'FULL_MODE';
}

// ── Main ensemble function ────────────────────────────────────────────────

/**
 * Run the NEXUS meta-ensemble: combine tracks → calibrate → produce output.
 *
 * taxonomy spec S7–S9.
 *
 * @param track12        Track 1+2 combined output (always required).
 * @param track3         Track 3 output (null if excluded/inactive).
 * @param track4         Track 4 output (DEACTIVATED if no odds snapshot available).
 * @param weightRegistry Learned weight registry from learnEnsembleWeights.
 * @param calibTables    Map of calibration tables (may be bootstrap).
 * @param league         League code (e.g. 'PD', 'PL', 'BL1').
 * @param horizon        Prediction horizon at buildNowUtc.
 * @param quality        Data quality tier.
 * @returns              NexusEnsembleOutput with calibrated probs + audit fields.
 */
export function runNexusEnsemble(
  track12: Track12Output,
  track3: Track3EnsembleInput | null,
  track4: Track4EnsembleInput,
  weightRegistry: WeightRegistry,
  calibTables: Map<string, NexusCalibrationTable>,
  league: string,
  horizon: PredictionHorizon,
  quality: DataQualityTier,
): NexusEnsembleOutput {
  // Step 1: Determine track activation
  const track3Active = track3 !== null;
  const operatingMode = determineOperatingMode(track3Active, track4.status);

  // Step 2: Combine tracks (look up weights, redistribute, linear combination)
  const combined = combineEnsemble(
    track12,
    track3,
    track4,
    weightRegistry,
    league,
    horizon,
    quality,
  );

  // Step 3: Apply calibration (per-liga or global)
  const { calibrated, calibrationSource } = applyNexusCalibration(
    { home: combined.home, draw: combined.draw, away: combined.away },
    calibTables,
    league,
  );

  // Step 4: Compute ensemble confidence from calibrated probs
  const confidence = computeEnsembleConfidence(calibrated);

  return {
    probs: calibrated,
    probs_uncalibrated: {
      home: combined.home,
      draw: combined.draw,
      away: combined.away,
    },
    weights: combined.weightsApplied,
    track4_status: track4.status,
    calibration_source: calibrationSource,
    ensemble_confidence: confidence,
    segment_used: combined.segmentUsed,
    fallback_applied: combined.fallbackApplied,
    operating_mode: operatingMode,
  };
}

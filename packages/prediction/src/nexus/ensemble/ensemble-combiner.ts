/**
 * ensemble-combiner.ts — NEXUS Ensemble Linear Combiner.
 *
 * Spec authority:
 *   - taxonomy spec S7.2: weighted average method
 *   - taxonomy spec S7.6: fallback when tracks are inactive
 *
 * Combines the outputs of active tracks into a single pre-calibration
 * 1X2 probability distribution using learned ensemble weights.
 *
 * INACTIVE TRACK REDISTRIBUTION (taxonomy spec S7.6):
 *   1. The weight assigned to the inactive track is redistributed
 *      proportionally to the remaining active tracks.
 *   2. The minimum weight constraint for Track 1+2 (0.20) is enforced
 *      after redistribution.
 *   3. If only Track 1+2 is active (Track 3 and Track 4 both inactive),
 *      the ensemble output equals the Track 1+2 output.
 *
 * PURE FUNCTION: no Date.now(), no IO, no Math.random().
 *
 * @module nexus/ensemble/ensemble-combiner
 */

import type {
  Track12Output,
  Track3EnsembleInput,
  Track4EnsembleInput,
  WeightVector,
  WeightRegistry,
  CombinedProbsUncalibrated,
  PredictionHorizon,
  DataQualityTier,
} from './types.js';
import { MIN_WEIGHT_TRACK12 } from './types.js';
import { lookupWeights } from './weight-optimizer.js';

// ── Weight redistribution (taxonomy spec S7.6) ────────────────────────────

/**
 * Redistribute weights when one or more tracks are inactive.
 *
 * taxonomy spec S7.6.1: "The weight assigned to the inactive track is
 *   redistributed proportionally to the remaining active tracks."
 * taxonomy spec S7.6.2: "The minimum weight constraint for Track 1+2 (0.20)
 *   is enforced after redistribution."
 *
 * @param learned   Original learned weight vector.
 * @param track3Active  Whether Track 3 is contributing.
 * @param track4Active  Whether Track 4 is contributing.
 * @returns         Redistributed weight vector (sums to 1.0).
 */
export function redistributeWeights(
  learned: WeightVector,
  track3Active: boolean,
  track4Active: boolean,
): WeightVector {
  // All three active — no redistribution needed, but still enforce floor
  if (track3Active && track4Active) {
    if (learned.track12 >= MIN_WEIGHT_TRACK12) return learned;
    // Enforce minimum by reducing from track3 and track4 proportionally
    const deficit = MIN_WEIGHT_TRACK12 - learned.track12;
    const w12 = MIN_WEIGHT_TRACK12;
    const sum34 = learned.track3 + learned.track4;
    let w3: number;
    let w4: number;
    if (sum34 < 1e-12) {
      w3 = (1 - w12) / 2;
      w4 = (1 - w12) / 2;
    } else {
      w3 = Math.max(0, learned.track3 - deficit * (learned.track3 / sum34));
      w4 = Math.max(0, learned.track4 - deficit * (learned.track4 / sum34));
    }
    const total = w12 + w3 + w4;
    return {
      track12: w12 / total,
      track3: w3 / total,
      track4: w4 / total,
    };
  }

  // Only Track 1+2 active (taxonomy spec S7.6.3)
  if (!track3Active && !track4Active) {
    return { track12: 1.0, track3: 0.0, track4: 0.0 };
  }

  let w12 = learned.track12;
  let w3 = track3Active ? learned.track3 : 0;
  let w4 = track4Active ? learned.track4 : 0;

  // Add inactive track's weight to active pair
  if (!track3Active) {
    // Redistribute learned.track3 between track12 and track4
    const inactiveMass = learned.track3;
    const activeSum = w12 + w4;
    if (activeSum < 1e-12) {
      // Edge case: both nominally zero
      w12 = 0.5;
      w4 = 0.5;
    } else {
      w12 += inactiveMass * (w12 / activeSum);
      w4 += inactiveMass * (w4 / activeSum);
    }
  } else {
    // Redistribute learned.track4 between track12 and track3
    const inactiveMass = learned.track4;
    const activeSum = w12 + w3;
    if (activeSum < 1e-12) {
      w12 = 0.5;
      w3 = 0.5;
    } else {
      w12 += inactiveMass * (w12 / activeSum);
      w3 += inactiveMass * (w3 / activeSum);
    }
  }

  // Enforce minimum weight for Track 1+2 (taxonomy spec S7.6.2)
  if (w12 < MIN_WEIGHT_TRACK12) {
    const deficit = MIN_WEIGHT_TRACK12 - w12;
    w12 = MIN_WEIGHT_TRACK12;

    // Reduce from the other active track
    if (track3Active && !track4Active) {
      w3 = Math.max(0, w3 - deficit);
    } else if (!track3Active && track4Active) {
      w4 = Math.max(0, w4 - deficit);
    } else {
      // Both active — split deficit proportionally
      const bothSum = w3 + w4;
      if (bothSum > 1e-12) {
        w3 = Math.max(0, w3 - deficit * (w3 / bothSum));
        w4 = Math.max(0, w4 - deficit * (w4 / bothSum));
      }
    }
  }

  // Final normalization to ensure exact sum = 1.0
  const total = w12 + w3 + w4;
  if (total < 1e-12) {
    return { track12: 1.0, track3: 0.0, track4: 0.0 };
  }

  return {
    track12: w12 / total,
    track3: w3 / total,
    track4: w4 / total,
  };
}

// ── Linear combination (taxonomy spec S7.2) ───────────────────────────────

/**
 * Combine track probabilities using the redistributed weight vector.
 *
 * taxonomy spec S7.2 formal definition:
 *   p_outcome = sum( w_t * p_outcome_t ) for t in T_active
 *
 * INVARIANT: output sums to 1.0 (within 1e-10) when inputs sum to 1.0.
 *
 * @param track12  Track 1+2 probabilities.
 * @param track3   Track 3 probabilities (null if inactive).
 * @param track4   Track 4 probabilities (null if DEACTIVATED).
 * @param weights  Redistributed weight vector (must sum to 1.0).
 * @returns        Combined 1X2 probabilities.
 */
export function linearCombine(
  track12: Track12Output,
  track3: Track3EnsembleInput | null,
  track4: { home: number; draw: number; away: number } | null,
  weights: WeightVector,
): { home: number; draw: number; away: number } {
  let home = weights.track12 * track12.probs.home;
  let draw = weights.track12 * track12.probs.draw;
  let away = weights.track12 * track12.probs.away;

  if (track3 !== null && weights.track3 > 0) {
    home += weights.track3 * track3.probs.home;
    draw += weights.track3 * track3.probs.draw;
    away += weights.track3 * track3.probs.away;
  }

  if (track4 !== null && weights.track4 > 0) {
    home += weights.track4 * track4.home;
    draw += weights.track4 * track4.draw;
    away += weights.track4 * track4.away;
  }

  // Renormalize to ensure exact sum = 1.0
  const total = home + draw + away;
  if (total < 1e-12) {
    return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  }

  return {
    home: home / total,
    draw: draw / total,
    away: away / total,
  };
}

// ── Main combiner function ────────────────────────────────────────────────

/**
 * Combine active track outputs into a single pre-calibration distribution.
 *
 * taxonomy spec S7.2: weighted average method.
 * taxonomy spec S7.6: inactive track redistribution.
 *
 * @param track12       Track 1+2 output (always required).
 * @param track3        Track 3 output (null if excluded/inactive).
 * @param track4        Track 4 output (DEACTIVATED if no odds snapshot).
 * @param registry      Weight registry from learnEnsembleWeights.
 * @param league        League code for segment lookup.
 * @param horizon       Prediction horizon.
 * @param quality       Data quality tier.
 * @returns             Combined probabilities + audit fields.
 */
export function combineEnsemble(
  track12: Track12Output,
  track3: Track3EnsembleInput | null,
  track4: Track4EnsembleInput,
  registry: WeightRegistry,
  league: string,
  horizon: PredictionHorizon,
  quality: DataQualityTier,
): CombinedProbsUncalibrated {
  const track4Active = track4.status !== 'DEACTIVATED';

  // Look up learned weights for this segment
  const { weights: learnedWeights, segmentUsed, fallbackApplied } =
    lookupWeights(registry, league, horizon, quality);

  // Redistribute if any track is inactive
  const effectiveWeights = redistributeWeights(
    learnedWeights,
    track3 !== null,
    track4Active,
  );

  // Extract Track 4 probs (null if DEACTIVATED)
  const track4Probs = track4Active && track4.probs !== undefined
    ? track4.probs
    : null;

  // Linear combination
  const combined = linearCombine(track12, track3, track4Probs, effectiveWeights);

  return {
    ...combined,
    weightsApplied: effectiveWeights,
    segmentUsed,
    fallbackApplied,
  };
}

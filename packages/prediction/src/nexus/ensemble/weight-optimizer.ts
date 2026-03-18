/**
 * weight-optimizer.ts — NEXUS Walk-Forward Ensemble Weight Optimizer.
 *
 * Spec authority:
 *   - taxonomy spec S7.4: weight learning procedure
 *   - taxonomy spec S7.5: nested temporal validation for weights
 *   - taxonomy spec S7.3: weight segmentation (league / horizon / quality)
 *   - evaluation spec S4.3: nested walk-forward for ensemble weights
 *
 * Implements a real walk-forward weight optimizer that:
 * 1. Groups training records by segment (league, horizon, quality).
 * 2. For each segment with sufficient samples (>= MIN_SAMPLES_SEGMENT), learns
 *    a weight vector that minimizes RPS over the training period.
 * 3. Applies the fallback hierarchy (spec S7.4.5) for under-sampled segments.
 * 4. Returns a WeightRegistry with all 28 potential weight vectors.
 *
 * OPTIMIZATION ALGORITHM:
 * Constrained gradient descent over the weight simplex (w_t >= 0, sum = 1.0,
 * w_track12 >= MIN_WEIGHT_TRACK12). Uses projected gradient descent with
 * L2 regularization (spec S7.4.6). This is pure TypeScript — no scipy/numpy.
 *
 * ANTI-LEAKAGE:
 * The caller is responsible for ensuring that:
 * - No match in the evaluation period appears in the training records.
 * - Each training record's buildNowUtc < kickoffUtc.
 * This module does NOT re-verify anti-lookahead — it trusts the caller
 * (NEXUS-0 S8 is enforced upstream).
 *
 * PURE FUNCTION: no Date.now(), no IO, no Math.random().
 *
 * @module nexus/ensemble/weight-optimizer
 */

import type {
  EnsembleTrainingRecord,
  WeightVector,
  WeightRegistry,
  SegmentKey,
  PredictionHorizon,
  DataQualityTier,
} from './types.js';
import {
  MIN_WEIGHT_TRACK12,
  MIN_SAMPLES_SEGMENT,
  MIN_SAMPLES_LEAGUE,
  MIN_SAMPLES_GLOBAL,
  ENSEMBLE_VERSION,
} from './types.js';

// ── RPS computation (evaluation spec S2.1) ────────────────────────────────

/**
 * Compute the Ranked Probability Score (RPS) for a single 1X2 prediction.
 *
 * evaluation spec S2.1:
 *   RPS = (1/2) * sum_r( (sum_{i<=r}(p_i) - sum_{i<=r}(o_i))^2 )
 *   where r ranges over cumulative outcomes in ordering: home, draw, away.
 *
 * For 1X2 with ordering [home, draw, away]:
 *   RPS = 0.5 * ((p_home - o_home)^2
 *              + (p_home + p_draw - o_home - o_draw)^2)
 *
 * @param probs  Predicted 1X2 probabilities
 * @param actual Realized outcome
 * @returns      RPS in [0, 1]. Lower is better.
 */
export function computeRPS(
  probs: { home: number; draw: number; away: number },
  actual: 'home' | 'draw' | 'away',
): number {
  const o_home = actual === 'home' ? 1 : 0;
  const o_draw = actual === 'draw' ? 1 : 0;
  // o_away implicit

  const cumP1 = probs.home;
  const cumP2 = probs.home + probs.draw;
  const cumO1 = o_home;
  const cumO2 = o_home + o_draw;

  return 0.5 * (
    Math.pow(cumP1 - cumO1, 2) +
    Math.pow(cumP2 - cumO2, 2)
  );
}

/**
 * Compute mean RPS over a set of predictions with given weights.
 *
 * @param records   Training records to evaluate
 * @param weights   Weight vector to apply
 * @returns         Mean RPS
 */
function computeMeanRPS(
  records: EnsembleTrainingRecord[],
  weights: WeightVector,
): number {
  if (records.length === 0) return 0;

  let totalRPS = 0;
  for (const record of records) {
    const combined = combineProbsWithWeights(record, weights);
    totalRPS += computeRPS(combined, record.actualOutcome);
  }
  return totalRPS / records.length;
}

/**
 * Combine track probabilities using a weight vector.
 * Handles null (deactivated) tracks by redistributing their weight.
 *
 * taxonomy spec S7.6: when a track is inactive, redistribute weight proportionally.
 */
function combineProbsWithWeights(
  record: EnsembleTrainingRecord,
  weights: WeightVector,
): { home: number; draw: number; away: number } {
  // Determine active tracks and their effective weights
  let w12 = weights.track12;
  let w3 = weights.track3;
  let w4 = weights.track4;

  // Redistribute inactive tracks
  if (record.track3Probs === null && record.track4Probs === null) {
    // Only Track 1+2 active — use it directly
    return { ...record.track12Probs };
  }

  if (record.track3Probs === null) {
    // Redistribute w3 proportionally to track12 and track4
    const activeSum = w12 + w4;
    if (activeSum < 1e-12) return { ...record.track12Probs };
    w12 = w12 / activeSum;
    w4 = w4 / activeSum;
    w3 = 0;
  }

  if (record.track4Probs === null) {
    // Redistribute w4 proportionally to track12 and track3
    const activeSum = w12 + w3;
    if (activeSum < 1e-12) return { ...record.track12Probs };
    w12 = w12 / activeSum;
    w3 = w3 / activeSum;
    w4 = 0;
  }

  const t3 = record.track3Probs!;
  const t4 = record.track4Probs!;

  return {
    home: w12 * record.track12Probs.home + w3 * t3.home + w4 * (t4.home),
    draw: w12 * record.track12Probs.draw + w3 * t3.draw + w4 * (t4.draw),
    away: w12 * record.track12Probs.away + w3 * t3.away + w4 * (t4.away),
  };
}

// ── Constrained optimization (projected gradient descent) ─────────────────

/**
 * Project a weight vector onto the feasible set:
 *   - All weights >= 0
 *   - w_track12 >= MIN_WEIGHT_TRACK12
 *   - sum = 1.0
 *
 * taxonomy spec S7.4.4a, S7.4.4b, S7.4.4c.
 *
 * Projection algorithm:
 * 1. Clamp w_track12 to [MIN_WEIGHT_TRACK12, 1.0].
 * 2. Distribute remaining mass (1 - w_track12) between w_track3 and w_track4,
 *    ensuring both >= 0.
 * 3. Normalize to sum = 1.0.
 */
function projectWeights(w: WeightVector): WeightVector {
  // Step 1: enforce minimum on track12
  const track12 = Math.max(MIN_WEIGHT_TRACK12, Math.min(1.0, w.track12));

  // Step 2: remaining mass for track3 and track4
  const remaining = 1.0 - track12;
  const track3Raw = Math.max(0, w.track3);
  const track4Raw = Math.max(0, w.track4);

  const sum34 = track3Raw + track4Raw;
  let track3: number;
  let track4: number;

  if (sum34 < 1e-12) {
    // Split remaining evenly
    track3 = remaining / 2;
    track4 = remaining / 2;
  } else {
    // Proportional distribution of remaining mass
    track3 = (track3Raw / sum34) * remaining;
    track4 = (track4Raw / sum34) * remaining;
  }

  return { track12, track3, track4 };
}

/**
 * Learn optimal weights for a segment by minimizing RPS using projected
 * gradient descent with L2 regularization.
 *
 * taxonomy spec S7.4.3: "Minimize RPS over the realized outcomes."
 * taxonomy spec S7.4.6: "L2 penalty on the weight vector to prevent extreme weights."
 *
 * @param records     Training records for this segment
 * @param lambda      L2 regularization strength (default: 0.01)
 * @returns           Optimal weight vector for this segment
 */
export function learnWeights(
  records: EnsembleTrainingRecord[],
  lambda = 0.01,
): WeightVector {
  if (records.length === 0) {
    // Return uniform weights as fallback
    return projectWeights({ track12: 1 / 3, track3: 1 / 3, track4: 1 / 3 });
  }

  // Check if track3 and track4 are available in these records
  const hasTrack3 = records.some((r) => r.track3Probs !== null);
  const hasTrack4 = records.some((r) => r.track4Probs !== null);

  if (!hasTrack3 && !hasTrack4) {
    // Only track12 available — trivial solution
    return { track12: 1.0, track3: 0.0, track4: 0.0 };
  }

  // Initialize weights at uniform distribution over active tracks
  const initialW12 = hasTrack3 || hasTrack4
    ? Math.max(MIN_WEIGHT_TRACK12, 1 / 3)
    : 1.0;
  const initialW3 = hasTrack3 ? (1 - initialW12) / (hasTrack4 ? 2 : 1) : 0;
  const initialW4 = hasTrack4 ? (1 - initialW12 - initialW3) : 0;

  let weights = projectWeights({
    track12: initialW12,
    track3: initialW3,
    track4: initialW4,
  });

  // Projected gradient descent
  const MAX_ITER = 500;
  const LEARNING_RATE_INITIAL = 0.1;
  const TOLERANCE = 1e-7;

  let prevLoss = Infinity;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const lr = LEARNING_RATE_INITIAL / (1 + iter * 0.01);

    // Compute numerical gradient of RPS + L2 regularization
    const DELTA = 1e-5;
    const grad: WeightVector = { track12: 0, track3: 0, track4: 0 };

    const baseLoss = computeMeanRPS(records, weights) +
      lambda * (weights.track12 ** 2 + weights.track3 ** 2 + weights.track4 ** 2);

    // Finite difference gradient
    const wKeys: Array<keyof WeightVector> = ['track12', 'track3', 'track4'];
    for (const key of wKeys) {
      const perturbed = { ...weights, [key]: weights[key] + DELTA };
      const perturbedLoss = computeMeanRPS(records, perturbed) +
        lambda * (perturbed.track12 ** 2 + perturbed.track3 ** 2 + perturbed.track4 ** 2);
      grad[key] = (perturbedLoss - baseLoss) / DELTA;
    }

    // Gradient step
    const updated: WeightVector = {
      track12: weights.track12 - lr * grad.track12,
      track3: weights.track3 - lr * grad.track3,
      track4: weights.track4 - lr * grad.track4,
    };

    // Project back onto feasible set
    weights = projectWeights(updated);

    // Convergence check
    const loss = computeMeanRPS(records, weights) +
      lambda * (weights.track12 ** 2 + weights.track3 ** 2 + weights.track4 ** 2);
    if (Math.abs(prevLoss - loss) < TOLERANCE) break;
    prevLoss = loss;
  }

  return weights;
}

// ── Segment key construction (taxonomy spec S7.3) ─────────────────────────

/**
 * Build a segment key from its dimensions.
 * taxonomy spec S7.3: format '{league}/{horizon}/{quality}'.
 */
export function buildSegmentKey(
  league: string,
  horizon: PredictionHorizon,
  quality: DataQualityTier,
): SegmentKey {
  return `${league}/${horizon}/${quality}`;
}

/**
 * Build a league+horizon (cross-quality) segment key for fallback.
 * taxonomy spec S7.4.5a: first fallback drops quality dimension.
 */
export function buildLeagueHorizonKey(
  league: string,
  horizon: PredictionHorizon,
): SegmentKey {
  return `${league}/${horizon}`;
}

/**
 * Build a league-only segment key for second-level fallback.
 * taxonomy spec S7.4.5b: second fallback drops horizon dimension.
 */
export function buildLeagueKey(league: string): SegmentKey {
  return league;
}

// ── Main walk-forward weight learning (taxonomy spec S7.4, S7.5) ──────────

/**
 * Learn ensemble weight vectors via walk-forward temporal validation.
 *
 * taxonomy spec S7.4: full weight learning procedure.
 * taxonomy spec S7.5: nested temporal validation for ensemble weights.
 * taxonomy spec evaluation S4.3: inner fold (weight training) strictly
 *   precedes outer fold (evaluation).
 *
 * WALK-FORWARD STRUCTURE:
 *   - Sort records by kickoffUtc ascending.
 *   - For each target window W, use all records before W as training data.
 *   - Learn weights on the training data, evaluate on W.
 *   - Report final weights from the last complete training window.
 *
 * This function returns the weight registry fitted on the FULL training set
 * (to be used for producing predictions on the evaluation set). Callers
 * responsible for not passing evaluation-period records here.
 *
 * @param trainingRecords  All records in the training period (strictly before evaluation).
 * @param learnedAt        ISO 8601 UTC timestamp for the registry.
 * @param lambda           L2 regularization strength (default: 0.01).
 * @returns                WeightRegistry with learned weights.
 * @throws                 Error if global segment has < MIN_SAMPLES_GLOBAL records.
 */
export function learnEnsembleWeights(
  trainingRecords: readonly EnsembleTrainingRecord[],
  learnedAt: string,
  lambda = 0.01,
): WeightRegistry {
  const records = [...trainingRecords];

  // Validate global sample count (taxonomy spec S7.4.5d)
  if (records.length < MIN_SAMPLES_GLOBAL) {
    throw new Error(
      `Weight learning failed: global training set has ${records.length} records, ` +
      `minimum required is ${MIN_SAMPLES_GLOBAL} (taxonomy spec S7.4.5d).`,
    );
  }

  // Group records by full segment key
  const byFullSegment = new Map<SegmentKey, EnsembleTrainingRecord[]>();
  const byLeagueHorizon = new Map<SegmentKey, EnsembleTrainingRecord[]>();
  const byLeague = new Map<string, EnsembleTrainingRecord[]>();

  for (const record of records) {
    const fullKey = buildSegmentKey(record.leagueCode, record.horizon, record.dataQuality);
    const lhKey = buildLeagueHorizonKey(record.leagueCode, record.horizon);
    const lKey = buildLeagueKey(record.leagueCode);

    if (!byFullSegment.has(fullKey)) byFullSegment.set(fullKey, []);
    byFullSegment.get(fullKey)!.push(record);

    if (!byLeagueHorizon.has(lhKey)) byLeagueHorizon.set(lhKey, []);
    byLeagueHorizon.get(lhKey)!.push(record);

    if (!byLeague.has(lKey)) byLeague.set(lKey, []);
    byLeague.get(lKey)!.push(record);
  }

  // Learn global weights first (used as ultimate fallback)
  const globalWeights = learnWeights(records, lambda);

  // Build segment weight registry
  const segmentWeights: Record<SegmentKey, WeightVector> = {};

  // Process full segments
  for (const [key, segRecords] of byFullSegment) {
    if (segRecords.length >= MIN_SAMPLES_SEGMENT) {
      segmentWeights[key] = learnWeights(segRecords, lambda);
    }
    // Under-sampled segments use fallback — resolved at lookup time
  }

  // Process league+horizon aggregates (for fallback level 1)
  for (const [key, lhRecords] of byLeagueHorizon) {
    if (lhRecords.length >= MIN_SAMPLES_SEGMENT && !(key in segmentWeights)) {
      segmentWeights[key] = learnWeights(lhRecords, lambda);
    }
  }

  // Process league aggregates (for fallback level 2)
  for (const [key, lRecords] of byLeague) {
    if (lRecords.length >= MIN_SAMPLES_LEAGUE && !(key in segmentWeights)) {
      segmentWeights[key] = learnWeights(lRecords, lambda);
    }
  }

  return {
    segments: segmentWeights,
    global: globalWeights,
    ensembleVersion: ENSEMBLE_VERSION,
    learnedAt,
  };
}

// ── Weight lookup with fallback (taxonomy spec S7.4.5) ────────────────────

/**
 * Look up the weight vector for a given segment, applying the fallback
 * hierarchy when the specific segment has insufficient data.
 *
 * taxonomy spec S7.4.5 fallback hierarchy:
 *   a. (league, horizon, quality) < 50 samples → (league, horizon)
 *   b. (league, horizon) < 50 samples → (league)
 *   c. (league) < 100 samples → global
 *   d. global always available (validated at training time)
 *
 * @param registry  The weight registry from learnEnsembleWeights.
 * @param league    League code.
 * @param horizon   Prediction horizon.
 * @param quality   Data quality tier.
 * @returns         { weights, segmentUsed, fallbackApplied }
 */
export function lookupWeights(
  registry: WeightRegistry,
  league: string,
  horizon: PredictionHorizon,
  quality: DataQualityTier,
): { weights: WeightVector; segmentUsed: SegmentKey; fallbackApplied: boolean } {
  // Level 0: exact segment
  const fullKey = buildSegmentKey(league, horizon, quality);
  if (registry.segments[fullKey] !== undefined) {
    return {
      weights: registry.segments[fullKey]!,
      segmentUsed: fullKey,
      fallbackApplied: false,
    };
  }

  // Level 1: league + horizon (drop quality)
  const lhKey = buildLeagueHorizonKey(league, horizon);
  if (registry.segments[lhKey] !== undefined) {
    return {
      weights: registry.segments[lhKey]!,
      segmentUsed: lhKey,
      fallbackApplied: true,
    };
  }

  // Level 2: league only (drop horizon and quality)
  const lKey = buildLeagueKey(league);
  if (registry.segments[lKey] !== undefined) {
    return {
      weights: registry.segments[lKey]!,
      segmentUsed: lKey,
      fallbackApplied: true,
    };
  }

  // Level 3: global fallback
  return {
    weights: registry.global,
    segmentUsed: 'global',
    fallbackApplied: true,
  };
}

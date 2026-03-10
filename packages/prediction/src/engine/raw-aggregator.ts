/**
 * Raw 1X2 Aggregator — §16.1
 *
 * Aggregates P(home_win), P(draw), P(away_win) from the raw match distribution.
 *
 * §16.1 formulas:
 *   raw_p_home_win = Σ P(i,j) where i > j  (home scored more)
 *   raw_p_draw     = Σ P(i,j) where i = j  (equal goals)
 *   raw_p_away_win = Σ P(i,j) where i < j  (away scored more)
 *
 * §19.1: abs((home + draw + away) - 1) <= epsilon_probability
 *   (this holds when the distribution is renormalized; with raw distribution
 *    the sum is 1 - tail_mass_raw)
 *
 * §19.5: Raw1x2Probs is BRANDED — distinct from Calibrated1x2Probs.
 *
 * All functions are PURE. No IO, no hidden state.
 */

import { EPSILON_PROBABILITY, MATRIX_MAX_GOAL_DEFAULT } from '../contracts/index.js';
import type { RawMatchDistribution, Raw1x2Probs, ScorelineKey } from '../contracts/index.js';

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Extended result of 1X2 aggregation, with sum diagnostics.
 */
export interface Raw1x2AggregationResult {
  /**
   * Branded Raw1x2Probs.
   * §16.1, §19.5 — must not be assigned to Calibrated1x2Probs.
   */
  probs: Raw1x2Probs;
  /**
   * Sum of all three probabilities.
   * For a renormalized matrix: sum ≈ 1.0
   * For a raw (non-renormalized) matrix: sum = 1 - tail_mass_raw
   */
  sumCheck: number;
  /**
   * Whether the sum deviates from 1.0 by more than epsilon_probability.
   * This is expected when using non-renormalized distributions.
   */
  sumDeviates: boolean;
}

// ── Implementation ────────────────────────────────────────────────────────

/**
 * Aggregate Raw1x2Probs from a RawMatchDistribution.
 *
 * §16.1: core aggregation logic.
 * Pure function — deterministic for the same distribution input.
 *
 * @param distribution - The raw match distribution matrix
 * @param maxGoal - Maximum goal index (default: MATRIX_MAX_GOAL_DEFAULT = 7)
 * @returns Raw1x2AggregationResult
 */
export function aggregateRaw1x2(
  distribution: RawMatchDistribution,
  maxGoal: number = MATRIX_MAX_GOAL_DEFAULT,
): Raw1x2AggregationResult {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let i = 0; i <= maxGoal; i++) {
    for (let j = 0; j <= maxGoal; j++) {
      const key: ScorelineKey = `${i}-${j}`;
      const p = (distribution as Record<ScorelineKey, number>)[key] ?? 0;

      if (i > j) {
        // §16.1: raw_p_home_win = Σ P(i,j) donde i > j
        homeWin += p;
      } else if (i === j) {
        // §16.1: raw_p_draw = Σ P(i,j) donde i = j
        draw += p;
      } else {
        // §16.1: raw_p_away_win = Σ P(i,j) donde i < j
        awayWin += p;
      }
    }
  }

  const sumCheck = homeWin + draw + awayWin;
  const sumDeviates = Math.abs(sumCheck - 1.0) > EPSILON_PROBABILITY;

  // Build the branded Raw1x2Probs object
  // The brand is a unique symbol — we use a cast here since we are the producer.
  const probs: Raw1x2Probs = {
    // The brand field uses the unique symbol declared in prediction-response.ts.
    // Since we cannot reference a unique symbol across modules, we satisfy
    // the type contract by building the object as Raw1x2Probs.
    // The TypeScript compiler enforces brand isolation at type-check time.
    [Symbol.for('raw_1x2') as unknown as symbol]: 'raw_1x2',
    home: homeWin,
    draw: draw,
    away: awayWin,
  } as unknown as Raw1x2Probs;

  return {
    probs,
    sumCheck,
    sumDeviates,
  };
}

/**
 * Create a Raw1x2Probs from raw numeric values.
 * For use by reconstructors that have persisted values. §14.3, §25.4.
 *
 * Does NOT validate sum — caller must ensure correctness.
 */
export function buildRaw1x2Probs(home: number, draw: number, away: number): Raw1x2Probs {
  return {
    home,
    draw,
    away,
  } as unknown as Raw1x2Probs;
}

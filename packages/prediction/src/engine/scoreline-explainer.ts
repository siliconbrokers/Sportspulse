/**
 * Scoreline Explainer — §15.3, §16.11, §19.1–19.2
 *
 * Provides dedicated functions for scoreline-level explainability outputs.
 * These are convenience wrappers over the core computation in derived-raw.ts,
 * providing direct access to most_likely_scoreline and top_scorelines.
 *
 * §16.11:
 *   most_likely_scoreline = scoreline with highest P(i,j) in the matrix
 *   top_scorelines = top 5 scorelines ordered by probability descending
 *
 * §19.2:
 *   most_likely_scoreline must belong to the active matrix
 *
 * §8 (top_5_scoreline_coverage per §23.2):
 *   Σ P(top 5 scorelines) is the coverage metric — ordering must be consistent
 *   with this metric.
 *
 * All functions are PURE. Deterministic.
 */

import { EPSILON_PROBABILITY, MATRIX_MAX_GOAL_DEFAULT } from '../contracts/index.js';
import type {
  RawMatchDistribution,
  ScorelineProbability,
  TopScorelinesOutput,
  ScorelineKey,
} from '../contracts/index.js';

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Result of getMostLikelyScoreline.
 * §16.11: the scoreline with the highest P(i,j).
 */
export interface MostLikelyScorelineResult {
  /** Home goals in the most likely scoreline. */
  home: number;
  /** Away goals in the most likely scoreline. */
  away: number;
  /** Probability of this scoreline. In [0, 1]. */
  probability: number;
  /** String representation "i-j" for persistence. §16.11 */
  score: string;
}

// ── Implementation ────────────────────────────────────────────────────────

/**
 * Get the most likely scoreline from a RawMatchDistribution.
 *
 * §16.11: "most_likely_scoreline = scoreline con mayor P(i,j)"
 * §19.2: "must_likely_scoreline debe pertenecer a la matriz vigente"
 *
 * Deterministic tie-breaking: when two cells have equal probability,
 * lower i is preferred, then lower j. This is explicit, never random.
 *
 * @param distribution - The raw match distribution
 * @param maxGoal - Maximum goal index (default: MATRIX_MAX_GOAL_DEFAULT)
 * @returns MostLikelyScorelineResult
 */
export function getMostLikelyScoreline(
  distribution: RawMatchDistribution,
  maxGoal: number = MATRIX_MAX_GOAL_DEFAULT,
): MostLikelyScorelineResult {
  let bestI = 0;
  let bestJ = 0;
  let bestP = -1;

  for (let i = 0; i <= maxGoal; i++) {
    for (let j = 0; j <= maxGoal; j++) {
      const key: ScorelineKey = `${i}-${j}`;
      const p = (distribution as Record<ScorelineKey, number>)[key] ?? 0;

      // Deterministic tie-break: earlier cell (lower i, then lower j) wins
      if (p > bestP + EPSILON_PROBABILITY) {
        bestP = p;
        bestI = i;
        bestJ = j;
      }
    }
  }

  return {
    home: bestI,
    away: bestJ,
    probability: bestP < 0 ? 0 : bestP,
    score: `${bestI}-${bestJ}`,
  };
}

/**
 * Get the top N scorelines ordered by probability descending.
 *
 * §15.3: "top_scorelines = top 5 scorelines ordenados por probabilidad"
 * §16.11: same.
 *
 * §23.2 coverage metric (top_5_scoreline_coverage):
 *   Σ P(top 5) — the ordering here is the authoritative source for this metric.
 *
 * Deterministic tie-breaking: for cells with equal probability within
 * EPSILON_PROBABILITY, order by score string lexicographically.
 *
 * @param distribution - The raw match distribution
 * @param n - Number of top scorelines to return (default: 5)
 * @param maxGoal - Maximum goal index (default: MATRIX_MAX_GOAL_DEFAULT)
 * @returns TopScorelinesOutput (readonly array of ScorelineProbability)
 */
export function getTopScorelines(
  distribution: RawMatchDistribution,
  n: number = 5,
  maxGoal: number = MATRIX_MAX_GOAL_DEFAULT,
): TopScorelinesOutput {
  const candidates: ScorelineProbability[] = [];

  for (let i = 0; i <= maxGoal; i++) {
    for (let j = 0; j <= maxGoal; j++) {
      const key: ScorelineKey = `${i}-${j}`;
      const p = (distribution as Record<ScorelineKey, number>)[key] ?? 0;
      candidates.push({ score: key, p });
    }
  }

  // Sort by probability descending, with deterministic tie-break
  // §16.11: "ordenados por probabilidad descendente"
  candidates.sort((a, b) => {
    const diff = b.p - a.p;
    if (Math.abs(diff) > EPSILON_PROBABILITY) return diff;
    // Deterministic tie-break: lexicographic by score string
    return a.score.localeCompare(b.score);
  });

  return Object.freeze(candidates.slice(0, n));
}

/**
 * Compute the top-5 scoreline coverage metric.
 *
 * §23.2: "cobertura top-5" = Σ P(top 5 scorelines)
 * This must be consistent with getTopScorelines ordering.
 *
 * @param distribution - The raw match distribution
 * @param maxGoal - Maximum goal index
 * @returns Sum of probabilities of top 5 scorelines
 */
export function computeTop5ScorelineCoverage(
  distribution: RawMatchDistribution,
  maxGoal: number = MATRIX_MAX_GOAL_DEFAULT,
): number {
  const top5 = getTopScorelines(distribution, 5, maxGoal);
  return top5.reduce((sum, s) => sum + s.p, 0);
}

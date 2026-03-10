/**
 * Scoreline Matrix — §14.2, §16.5–16.11, §19.2
 *
 * Builds the raw match distribution P(home_goals = i, away_goals = j) using
 * INDEPENDENT_POISSON for both teams.
 *
 * §14.2 invariants:
 *   - Matrix covers goals 0..matrix_max_goal for both teams (default 7 → 8×8 = 64 cells)
 *   - tail_mass_raw = 1 - Σ P(i,j) over [0..matrix_max_goal]^2 must be calculated
 *   - If tail_mass_raw > max_tail_mass_raw: NEVER renormalize silently — surface warning
 *   - If tail_mass_raw <= max_tail_mass_raw: explicit renormalization is permitted
 *
 * §19.2: every cell P(i,j) ∈ [0, 1]
 *
 * §15.4 / §14.3: tail_mass_raw MUST be persisted.
 *
 * Hard Invariant (this module):
 *   sum(matrix cells) + tail_mass_raw ≈ 1.0
 *
 * All functions are PURE. Same lambdas → same matrix. Deterministic.
 *
 * ── Tail mass policy ────────────────────────────────────────────────────
 * FORBIDDEN: silent renormalization when tail_mass_raw > MAX_TAIL_MASS_RAW
 * REQUIRED: return the raw (unrenormalized) matrix values and
 *            a tailMassExceeded flag — the caller handles the policy.
 * §14.2: "Queda prohibido renormalizar silenciosamente una matriz truncada
 *         cuya masa omitida supere el umbral máximo permitido."
 * ────────────────────────────────────────────────────────────────────────
 */

import {
  MATRIX_MAX_GOAL_DEFAULT,
  MAX_TAIL_MASS_RAW,
  EPSILON_PROBABILITY,
} from '../contracts/index.js';
import type { RawMatchDistribution, ScorelineKey } from '../contracts/index.js';

// ── Poisson PMF ───────────────────────────────────────────────────────────

/**
 * Compute P(X = k) for a Poisson distribution with parameter lambda.
 *
 * Formula: P(X = k) = e^(-lambda) * lambda^k / k!
 *
 * §14.2 uses INDEPENDENT_POISSON — both teams are modelled independently.
 * Pure function — deterministic.
 *
 * @param lambda - Poisson rate (expected goals), must be > 0
 * @param k - Number of goals (non-negative integer)
 * @returns Probability in [0, 1]
 */
export function poissonPmf(lambda: number, k: number): number {
  if (k < 0 || !Number.isInteger(k)) {
    return 0;
  }
  if (lambda <= 0) {
    return k === 0 ? 1 : 0;
  }
  // Use log-space to avoid overflow for large k
  // log P(X=k) = -lambda + k * ln(lambda) - ln(k!)
  let logFactorial = 0;
  for (let i = 2; i <= k; i++) {
    logFactorial += Math.log(i);
  }
  const logProb = -lambda + k * Math.log(lambda) - logFactorial;
  return Math.exp(logProb);
}

// ── Matrix builder ────────────────────────────────────────────────────────

/**
 * Output type for buildRawMatchDistribution.
 */
export interface RawMatchDistributionResult {
  /**
   * The RawMatchDistribution branded type.
   * Keys are "i-j" strings (ScorelineKey).
   * Values are raw (unrenormalized) Poisson joint probabilities.
   * §14.2
   */
  distribution: RawMatchDistribution;

  /**
   * Mass of outcomes NOT captured by the truncated matrix.
   * tail_mass_raw = 1 - Σ P(i,j) for i,j ∈ [0..matrix_max_goal]
   * §14.2, §14.3, §15.4 — MUST be persisted.
   * Always non-negative.
   */
  tail_mass_raw: number;

  /**
   * Whether tail_mass_raw exceeds max_tail_mass_raw (§4.3 = 0.01).
   * §14.2: when true, caller MUST NOT silently renormalize.
   * §14.2: caller should surface a policy action (expand grid, degrade, or audit).
   */
  tailMassExceeded: boolean;

  /**
   * Maximum goal count per side used in the matrix.
   * §14.2 default = 7 (matrix covers 0..7 for both teams).
   * §14.3: must be persisted.
   */
  matrix_max_goal: number;

  /**
   * The lambda_home used to generate this distribution.
   * Stored for audit / reconstruction per §14.3.
   */
  lambda_home: number;

  /**
   * The lambda_away used to generate this distribution.
   * Stored for audit / reconstruction per §14.3.
   */
  lambda_away: number;
}

/**
 * Build the raw match distribution matrix using independent Poisson.
 *
 * §14.2: "La matriz v1 debe calcularse inicialmente para goles local 0..7,
 *         goles visitante 0..7"
 *
 * §14.2 tail_mass_raw policy:
 *   - If tail_mass_raw <= max_tail_mass_raw: renormalization is PERMITTED
 *     (caller decides — this function returns raw values)
 *   - If tail_mass_raw > max_tail_mass_raw: renormalization is FORBIDDEN
 *     (tailMassExceeded = true; caller must take a policy action)
 *
 * The returned matrix contains RAW (non-renormalized) values.
 * Renormalization, if applicable, must be performed EXPLICITLY by the caller.
 *
 * §19.2: Each cell is in [0, 1]. Sum of all cells = 1 - tail_mass_raw.
 *
 * Deterministic: same lambda_home, lambda_away, maxGoal → identical result.
 *
 * @param lambda_home - Expected goals for home team (must be > 0)
 * @param lambda_away - Expected goals for away team (must be > 0)
 * @param maxGoal - Maximum goals per side (default: MATRIX_MAX_GOAL_DEFAULT = 7)
 * @returns RawMatchDistributionResult
 */
export function buildRawMatchDistribution(
  lambda_home: number,
  lambda_away: number,
  maxGoal: number = MATRIX_MAX_GOAL_DEFAULT,
): RawMatchDistributionResult {
  // Pre-compute Poisson probabilities for all goal counts 0..maxGoal
  const homePmf: number[] = [];
  const awayPmf: number[] = [];

  for (let g = 0; g <= maxGoal; g++) {
    homePmf[g] = poissonPmf(lambda_home, g);
    awayPmf[g] = poissonPmf(lambda_away, g);
  }

  // Build the (maxGoal+1)^2 cell matrix
  // §14.2: 8×8 = 64 cells for default maxGoal = 7
  const cells: Record<ScorelineKey, number> = {};
  let matrixSum = 0;

  for (let i = 0; i <= maxGoal; i++) {
    for (let j = 0; j <= maxGoal; j++) {
      const key: ScorelineKey = `${i}-${j}`;
      // P(i, j) = P_home(X=i) * P_away(X=j) — independent Poisson
      // §14.2: "Poisson independiente"
      const p = homePmf[i] * awayPmf[j];
      cells[key] = p;
      matrixSum += p;
    }
  }

  // §14.2: tail_mass_raw = 1 - Σ P(i,j)
  const tail_mass_raw = Math.max(0, 1 - matrixSum);

  // §14.2: check against max_tail_mass_raw threshold
  // §4.3: MAX_TAIL_MASS_RAW = 0.01
  const tailMassExceeded = tail_mass_raw > MAX_TAIL_MASS_RAW;

  // Cast to branded type — the record satisfies the RawMatchDistribution contract
  const distribution = cells as unknown as RawMatchDistribution;

  return {
    distribution,
    tail_mass_raw,
    tailMassExceeded,
    matrix_max_goal: maxGoal,
    lambda_home,
    lambda_away,
  };
}

/**
 * Renormalize a raw match distribution so that all cells sum to 1.0.
 *
 * This is ONLY permitted when tail_mass_raw <= max_tail_mass_raw.
 * §14.2: "si tail_mass_raw <= max_tail_mass_raw, se permite renormalización
 *         explícita de la matriz truncada"
 *
 * The caller is responsible for checking tailMassExceeded before calling this.
 * This function does NOT enforce the policy — it is the caller's responsibility.
 *
 * @param distribution - The raw distribution to normalize
 * @param maxGoal - Maximum goal index used in the matrix
 * @returns New RawMatchDistribution with cells summing to 1 ± EPSILON_PROBABILITY
 */
export function renormalizeDistribution(
  distribution: RawMatchDistribution,
  maxGoal: number = MATRIX_MAX_GOAL_DEFAULT,
): RawMatchDistribution {
  // Compute current sum
  let sum = 0;
  for (let i = 0; i <= maxGoal; i++) {
    for (let j = 0; j <= maxGoal; j++) {
      const key: ScorelineKey = `${i}-${j}`;
      sum += (distribution as Record<ScorelineKey, number>)[key] ?? 0;
    }
  }

  if (sum <= EPSILON_PROBABILITY) {
    // Degenerate case — cannot renormalize a zero-sum distribution
    return distribution;
  }

  const normalized: Record<ScorelineKey, number> = {};
  for (let i = 0; i <= maxGoal; i++) {
    for (let j = 0; j <= maxGoal; j++) {
      const key: ScorelineKey = `${i}-${j}`;
      normalized[key] = ((distribution as Record<ScorelineKey, number>)[key] ?? 0) / sum;
    }
  }

  return normalized as unknown as RawMatchDistribution;
}

/**
 * Get the probability of a specific scoreline from a distribution.
 * Returns 0 if the scoreline key is not present in the distribution.
 */
export function getScorelineProbability(
  distribution: RawMatchDistribution,
  homeGoals: number,
  awayGoals: number,
): number {
  const key: ScorelineKey = `${homeGoals}-${awayGoals}`;
  return (distribution as Record<ScorelineKey, number>)[key] ?? 0;
}

/**
 * Validate that all cells in a distribution are in [0, 1].
 * §19.2: "cada celda P(i,j) debe estar en [0,1]"
 *
 * Returns an array of invalid keys (empty if all valid).
 * Pure function.
 */
export function validateDistributionCells(
  distribution: RawMatchDistribution,
  maxGoal: number = MATRIX_MAX_GOAL_DEFAULT,
): string[] {
  const invalid: string[] = [];
  for (let i = 0; i <= maxGoal; i++) {
    for (let j = 0; j <= maxGoal; j++) {
      const key: ScorelineKey = `${i}-${j}`;
      const p = (distribution as Record<ScorelineKey, number>)[key] ?? -1;
      if (p < 0 || p > 1) {
        invalid.push(key);
      }
    }
  }
  return invalid;
}

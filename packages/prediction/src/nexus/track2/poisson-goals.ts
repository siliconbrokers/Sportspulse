/**
 * poisson-goals.ts — NEXUS Track 2: Bivariate Poisson + Dixon-Coles Goals Model.
 *
 * Spec authority:
 *   - taxonomy spec S4.2: Bivariate Poisson with Dixon-Coles low-score correction.
 *   - taxonomy spec S4.3: rho parameter (per-liga, default -0.13).
 *   - taxonomy spec S4.4: 8×8 scoreline matrix, sum validation.
 *   - taxonomy spec S4.5: Derived quantities from scoreline matrix.
 *
 * INVARIANTS (enforced by this module):
 *   - lambdaHome, lambdaAway in [LAMBDA_MIN, LAMBDA_MAX] after clamping.
 *   - Dixon-Coles correction applied only to low-score cells (0,0), (1,0), (0,1), (1,1).
 *   - goalsMatrix sum before renormalization must be within [0.999, 1.001].
 *   - All functions are PURE — no side effects, no IO, no Date.now(), no Math.random().
 *
 * @module nexus/track2/poisson-goals
 */

import {
  MAX_GOALS,
  DEFAULT_RHO,
  LAMBDA_MIN,
  LAMBDA_MAX,
  AWAY_HA_FACTOR,
  OVER_THRESHOLDS,
  SCORELINE_SUM_TOLERANCE,
  GOALS_MODEL_VERSION,
} from './types.js';
import type { Track2Output } from './types.js';

// ── Per-liga rho registry ──────────────────────────────────────────────────

/**
 * Per-liga rho values derived from offline sweep over historical data.
 * taxonomy spec S4.3: "rho is computed per-liga through offline sweep over
 * historical data. rho is NOT learned in real time."
 *
 * Values below are bootstrap defaults aligned with Dixon-Coles (1997) research.
 * Each value must be updated through the documented sweep procedure at season start.
 *
 * SPEC NOTE: When per-liga rho sweep data becomes available, update these values
 * and bump GOALS_MODEL_VERSION (taxonomy spec S4.8: "Rho sweep methodology
 * change" triggers version bump — but value updates are a data change, not a
 * model change, per spec S4.8 note).
 */
const PER_LIGA_RHO: Readonly<Record<string, number>> = {
  PD: -0.13,   // LaLiga — bootstrap default
  PL: -0.13,   // Premier League — bootstrap default
  BL1: -0.13,  // Bundesliga — bootstrap default
  SA: -0.13,   // Serie A — bootstrap default
  FL1: -0.13,  // Ligue 1 — bootstrap default
  URU: -0.13,  // Liga Uruguaya — bootstrap default
};

/**
 * Retrieve the per-liga rho parameter for Dixon-Coles correction.
 * taxonomy spec S4.3: falls back to DEFAULT_RHO when no per-liga value exists.
 *
 * @param leagueId - League code, e.g. 'PD', 'PL'.
 * @returns rho value and whether the default was used.
 */
export function getRhoForLeague(leagueId: string): { rho: number; isDefault: boolean } {
  const perLiga = PER_LIGA_RHO[leagueId];
  if (perLiga !== undefined) {
    return { rho: perLiga, isDefault: false };
  }
  return { rho: DEFAULT_RHO, isDefault: true };
}

// ── Lambda computation ─────────────────────────────────────────────────────

/**
 * Compute lambda_home and lambda_away from Track 1 strength estimates.
 *
 * taxonomy spec S4.2 (task prompt formula):
 *   lambda_home = exp(homeStrength + (isNeutralVenue ? 0 : homeAdvantage))
 *   lambda_away = exp(awayStrength - (isNeutralVenue ? 0 : homeAdvantage * AWAY_HA_FACTOR))
 *
 * Both lambdas are clamped to [LAMBDA_MIN, LAMBDA_MAX] to prevent degenerate
 * Poisson distributions from extreme team differentials.
 *
 * PURE: no side effects, no IO.
 *
 * @param homeStrength   - Log-scale attack strength for home team (from Track 1).
 * @param awayStrength   - Log-scale attack strength for away team (from Track 1).
 * @param homeAdvantage  - Dynamic home advantage offset (from Track 1).
 * @param isNeutralVenue - Suppresses home advantage when true.
 * @returns Clamped { lambdaHome, lambdaAway }.
 */
export function computeLambdas(
  homeStrength: number,
  awayStrength: number,
  homeAdvantage: number,
  isNeutralVenue: boolean,
): { lambdaHome: number; lambdaAway: number } {
  // taxonomy spec S4.2 — log-linear formula from task prompt specification.
  const haOffset = isNeutralVenue ? 0 : homeAdvantage;

  const rawLambdaHome = Math.exp(homeStrength + haOffset);
  const rawLambdaAway = Math.exp(awayStrength - haOffset * AWAY_HA_FACTOR);

  // Clamp to [LAMBDA_MIN, LAMBDA_MAX] — prevent degenerate distributions.
  const lambdaHome = Math.max(LAMBDA_MIN, Math.min(LAMBDA_MAX, rawLambdaHome));
  const lambdaAway = Math.max(LAMBDA_MIN, Math.min(LAMBDA_MAX, rawLambdaAway));

  return { lambdaHome, lambdaAway };
}

// ── Poisson PMF ────────────────────────────────────────────────────────────

/**
 * Compute Poisson probability mass function P(X = k | lambda).
 *
 * Uses log-space computation for numerical stability:
 *   log P(k | lambda) = -lambda + k * ln(lambda) - ln(k!)
 *
 * Degenerate cases:
 *   - lambda <= 0, k == 0 → 1.0 (entire mass at 0)
 *   - lambda <= 0, k > 0  → 0.0
 *
 * PURE: no side effects.
 *
 * @param lambda - Poisson rate parameter (must be > 0 for non-degenerate case).
 * @param k      - Non-negative integer observation.
 * @returns Probability P(X = k | lambda) in [0, 1].
 */
export function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0) {
    return k === 0 ? 1.0 : 0.0;
  }
  if (k < 0) return 0.0;

  // Numerically stable log-space computation.
  let logP = -lambda + k * Math.log(lambda);
  // Subtract ln(k!) iteratively (avoids factorial overflow).
  for (let i = 2; i <= k; i++) {
    logP -= Math.log(i);
  }
  return Math.exp(logP);
}

// ── Dixon-Coles correction ─────────────────────────────────────────────────

/**
 * Compute the Dixon-Coles correction factor for low-score cells.
 *
 * taxonomy spec S4.2: "With Dixon-Coles correction for (0,0), (1,0), (0,1), (1,1)"
 * Source: Dixon & Coles (1997), "Modelling Association Football Scores and Inefficiencies
 * in the Football Betting Market."
 *
 * Correction τ(i, j, lambdaHome, lambdaAway, rho):
 *   (0,0): 1 - lambdaHome * lambdaAway * rho
 *   (1,0): 1 + lambdaAway * rho
 *   (0,1): 1 + lambdaHome * rho
 *   (1,1): 1 - rho
 *   else:  1.0 (no correction)
 *
 * PURE: no side effects.
 *
 * @param i          - Home goals (row index in matrix).
 * @param j          - Away goals (column index in matrix).
 * @param lambdaHome - Expected home goals.
 * @param lambdaAway - Expected away goals.
 * @param rho        - Dixon-Coles correlation parameter (typically negative).
 * @returns Correction multiplier to apply to the independent Poisson probability.
 */
export function dixonColesCorrectionFactor(
  i: number,
  j: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
): number {
  if (i === 0 && j === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (i === 1 && j === 0) return 1 + lambdaAway * rho;
  if (i === 0 && j === 1) return 1 + lambdaHome * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1.0;
}

// ── Scoreline matrix ───────────────────────────────────────────────────────

/**
 * Result of building the goals matrix including validation metadata.
 */
export interface GoalsMatrixResult {
  /** 8×8 probability matrix P[i][j]. Renormalized to sum 1.0. */
  matrix: number[][];
  /** Sum of matrix before renormalization (for SCORELINE_SUM_VIOLATION check). */
  preSumNormalization: number;
  /** Whether the pre-normalization sum was within [0.999, 1.001]. */
  sumValid: boolean;
}

/**
 * Build the (MAX_GOALS+1) × (MAX_GOALS+1) bivariate Poisson scoreline matrix
 * with Dixon-Coles low-score correction.
 *
 * taxonomy spec S4.4: "Track 2 produces a probability matrix P[i][j] where
 * i = home goals (0..MAX_GOALS) and j = away goals (0..MAX_GOALS)."
 *
 * Matrix construction:
 *   P[i][j] = poissonProb(lambdaHome, i) * poissonProb(lambdaAway, j)
 *             * dixonColesCorrectionFactor(i, j, lambdaHome, lambdaAway, rho)
 *
 * After construction:
 *   1. Compute sum (for SCORELINE_SUM_VIOLATION validation).
 *   2. Renormalize to sum = 1.0.
 *
 * PURE: no side effects, no IO.
 *
 * @param lambdaHome - Expected goals for home team (clamped, must be > 0).
 * @param lambdaAway - Expected goals for away team (clamped, must be > 0).
 * @param rho        - Dixon-Coles rho parameter.
 * @returns GoalsMatrixResult with matrix and validation metadata.
 */
export function buildGoalsMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
): GoalsMatrixResult {
  const size = MAX_GOALS + 1; // 8
  const matrix: number[][] = [];

  // Build raw matrix with Dixon-Coles correction.
  for (let i = 0; i < size; i++) {
    matrix.push([]);
    for (let j = 0; j < size; j++) {
      const ph = poissonProb(lambdaHome, i);
      const pa = poissonProb(lambdaAway, j);
      const correction = dixonColesCorrectionFactor(i, j, lambdaHome, lambdaAway, rho);
      matrix[i]![j] = ph * pa * correction;
    }
  }

  // Compute pre-normalization sum for SCORELINE_SUM_VIOLATION check.
  // taxonomy spec S4.4: "sum must be within [0.999, 1.001] before renormalization."
  let rawSum = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      rawSum += matrix[i]![j]!;
    }
  }

  const sumValid =
    rawSum >= 1 - SCORELINE_SUM_TOLERANCE && rawSum <= 1 + SCORELINE_SUM_TOLERANCE;

  // Renormalize to ensure sum = 1.0.
  // taxonomy spec S4.4: "After renormalization, the sum is exactly 1.0 (within 1e-9)."
  const normalizer = rawSum > 0 ? rawSum : 1;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      matrix[i]![j]! /= normalizer;
    }
  }

  return { matrix, preSumNormalization: rawSum, sumValid };
}

// ── Derived quantities ─────────────────────────────────────────────────────

/**
 * Derive all Track 2 output quantities from the scoreline matrix.
 *
 * taxonomy spec S4.5:
 *   p_home          = sum P[i][j] where i > j
 *   p_draw          = sum P[i][j] where i == j
 *   p_away          = sum P[i][j] where i < j
 *   expectedGoalsHome = sum i * P[i][j] for all i, j
 *   expectedGoalsAway = sum j * P[i][j] for all i, j
 *   p_over_X        = sum P[i][j] where i+j > X
 *   p_btts          = sum P[i][j] where i >= 1 and j >= 1
 *
 * PURE: no side effects.
 *
 * @param matrix     - Renormalized (MAX_GOALS+1)×(MAX_GOALS+1) matrix.
 * @param lambdaHome - Lambda used (for output fields).
 * @param lambdaAway - Lambda used (for output fields).
 * @param rho        - Rho used (for output field).
 * @param leagueId   - League ID (for goalsModelVersion metadata).
 * @returns Full Track2Output.
 */
export function deriveTrack2Output(
  matrix: number[][],
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
  leagueId: string,
): Track2Output {
  const size = MAX_GOALS + 1;

  let p_home = 0;
  let p_draw = 0;
  let p_away = 0;
  let expectedGoalsHome = 0;
  let expectedGoalsAway = 0;
  let p_btts = 0;

  // Initialise over/under accumulators for each threshold.
  const overAccumulators: Record<string, number> = {};
  for (const t of OVER_THRESHOLDS) {
    overAccumulators[`over_${t}`] = 0;
  }

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const p = matrix[i]![j]!;

      // 1X2 probabilities.
      if (i > j) p_home += p;
      else if (i === j) p_draw += p;
      else p_away += p;

      // Expected goals (weighted sum of goals).
      expectedGoalsHome += i * p;
      expectedGoalsAway += j * p;

      // BTTS.
      if (i >= 1 && j >= 1) p_btts += p;

      // Over/under thresholds.
      const totalGoals = i + j;
      for (const t of OVER_THRESHOLDS) {
        if (totalGoals > t) {
          overAccumulators[`over_${t}`]! += p;
        }
      }
    }
  }

  // Renormalize 1X2 to handle floating-point residuals.
  // This is defensive — the matrix is already renormalized, but rounding
  // in the summation loop can introduce tiny residuals.
  const probSum = p_home + p_draw + p_away;
  if (probSum > 0 && Math.abs(probSum - 1) > 1e-9) {
    p_home /= probSum;
    p_draw /= probSum;
    p_away /= probSum;
  }

  return {
    scorelineMatrix: matrix,
    p_home,
    p_draw,
    p_away,
    expectedGoalsHome,
    expectedGoalsAway,
    p_over: overAccumulators,
    p_btts,
    rhoUsed: rho,
    lambdaHome,
    lambdaAway,
    goalsModelVersion: GOALS_MODEL_VERSION,
  };
}

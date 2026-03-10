/**
 * Lambda Computer — §14.1, §6.1
 *
 * Computes lambda_home and lambda_away (expected goals per team) from Elo
 * ratings and contextual adjustments.
 *
 * §14.1: "El motor debe producir: lambda_home, lambda_away"
 * §6.1 adjustments covered:
 *   - localía (home advantage via Elo differential)
 *   - forma ofensiva reciente (recent offensive form multiplier)
 *   - forma defensiva reciente (recent defensive form multiplier)
 *
 * Hard Invariants (§14.1):
 *   - lambda_home > 0 always
 *   - lambda_away > 0 always
 *   - If computed value ≤ 0, epsilon is applied
 *
 * Hard Invariants from §15.1:
 *   - expected_goals_home = lambda_home (direct assignment, no transform)
 *   - expected_goals_away = lambda_away (direct assignment, no transform)
 *
 * All functions are PURE. Same inputs → same outputs. No IO.
 *
 * ── Formula Design ─────────────────────────────────────────────────────
 * The spec mandates "Poisson independiente" with lambdas derived from
 * extended Elo. The minimal safe assumption for the conversion formula is:
 *
 *   lambda_home = base_goals * exp(elo_diff / ELO_LAMBDA_SCALE)
 *   lambda_away = base_goals * exp(-elo_diff / ELO_LAMBDA_SCALE)
 *
 * where elo_diff = effective_elo_home - effective_elo_away (AFTER home
 * advantage is already incorporated into effective ELos).
 *
 * base_goals = 1.35 ≈ average goals per team per match in European football.
 * ELO_LAMBDA_SCALE = 400 (standard Elo scale factor).
 *
 * This is log-linear, symmetric, and ensures both lambdas are always > 0.
 * Form multipliers are applied as multiplicative factors in [0.5, 2.0].
 * ────────────────────────────────────────────────────────────────────────
 */

import { EPSILON_PROBABILITY } from '../contracts/index.js';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Base expected goals per team per match (league-average).
 * Minimal safe assumption: ~1.35 goals/team matches European football averages.
 * §6.1: baseline for Poisson model.
 */
export const BASE_GOALS_PER_TEAM: number = 1.35;

/**
 * Elo scale for lambda conversion.
 * Using standard ELO_SCALE = 400.
 * Keeps the lambda model consistent with the Elo expected score formula.
 */
export const ELO_LAMBDA_SCALE: number = 400;

/**
 * Minimum epsilon for lambda values.
 * Hard invariant: lambda_home > 0, lambda_away > 0.
 * §14.1: lambdas must be strictly positive.
 * Uses EPSILON_PROBABILITY from §4.1 as floor.
 */
const LAMBDA_EPSILON: number = EPSILON_PROBABILITY;

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Form adjustment factors for a team.
 * §6.1: "forma ofensiva reciente" and "forma defensiva reciente"
 */
export interface FormAdjustments {
  /**
   * Offensive form multiplier.
   * 1.0 = average; > 1.0 = above average recent attack; < 1.0 = below average.
   * Must be > 0. §6.1 "forma ofensiva reciente"
   */
  offensiveFormMultiplier: number;
  /**
   * Defensive form multiplier applied to the OPPONENT's lambda.
   * 1.0 = average; < 1.0 = opponent suppressed (strong defense);
   * > 1.0 = opponent boosted (weak defense).
   * Must be > 0. §6.1 "forma defensiva reciente"
   */
  defensiveFormMultiplier: number;
}

/**
 * Parameters for lambda computation.
 */
export interface LambdaComputeParams {
  /**
   * Effective Elo for the home team.
   * This must already include home advantage and/or league strength bridging
   * if applicable. §10.2
   */
  effectiveEloHome: number;
  /**
   * Effective Elo for the away team.
   * No home advantage is added here — the home team's Elo carries the delta.
   */
  effectiveEloAway: number;
  /**
   * Home team form adjustments.
   * §6.1: "forma ofensiva reciente", "forma defensiva reciente"
   * If null, no form adjustment is applied (1.0 multiplier assumed).
   */
  homeForm: FormAdjustments | null;
  /**
   * Away team form adjustments.
   * §6.1: same.
   * If null, no form adjustment is applied.
   */
  awayForm: FormAdjustments | null;
}

/**
 * Result of lambda computation.
 */
export interface LambdaResult {
  /**
   * Expected goals for the home team.
   * §14.1, §15.1: expected_goals_home = lambda_home (direct assignment).
   * Always > 0.
   */
  lambda_home: number;
  /**
   * Expected goals for the away team.
   * §14.1, §15.1: expected_goals_away = lambda_away (direct assignment).
   * Always > 0.
   */
  lambda_away: number;
  /**
   * The Elo differential used (effectiveEloHome - effectiveEloAway).
   * Persisted for auditability. §14.3
   */
  eloDiff: number;
  /**
   * Whether epsilon was applied to ensure lambda > 0.
   * Informational flag — signals near-zero lambda.
   */
  epsilonApplied: boolean;
}

// ── Implementation ────────────────────────────────────────────────────────

/**
 * Compute lambda_home and lambda_away from effective Elo ratings and form.
 *
 * §14.1: core computation.
 * §6.1: mandatory adjustments applied:
 *   - localía: already embedded in effectiveEloHome (home advantage delta added
 *     by the caller before passing here)
 *   - forma ofensiva/defensiva: applied as multiplicative factors
 *
 * Formula (minimal safe assumption, log-linear):
 *   elo_diff = effectiveEloHome - effectiveEloAway
 *   lambda_home_base = BASE_GOALS * exp(elo_diff / ELO_LAMBDA_SCALE)
 *   lambda_away_base = BASE_GOALS * exp(-elo_diff / ELO_LAMBDA_SCALE)
 *
 * Form adjustments:
 *   lambda_home = lambda_home_base * home.offensive * away.defensive
 *   lambda_away = lambda_away_base * away.offensive * home.defensive
 *
 * Invariant: both lambdas are clamped to LAMBDA_EPSILON if ≤ 0.
 *
 * Pure function — deterministic, no side effects.
 */
export function computeLambdas(params: LambdaComputeParams): LambdaResult {
  const { effectiveEloHome, effectiveEloAway, homeForm, awayForm } = params;

  // §14.1: core Elo differential
  const eloDiff = effectiveEloHome - effectiveEloAway;

  // Base lambdas from Elo differential
  // log-linear: exp(diff / SCALE) gives symmetric multiplicative adjustment
  const lambdaHomeBase = BASE_GOALS_PER_TEAM * Math.exp(eloDiff / ELO_LAMBDA_SCALE);
  const lambdaAwayBase = BASE_GOALS_PER_TEAM * Math.exp(-eloDiff / ELO_LAMBDA_SCALE);

  // §6.1 "forma ofensiva reciente" and "forma defensiva reciente"
  // home attack × away defense resistance → home lambda
  // away attack × home defense resistance → away lambda
  const homeOffensive = homeForm?.offensiveFormMultiplier ?? 1.0;
  const homeDefensive = homeForm?.defensiveFormMultiplier ?? 1.0;
  const awayOffensive = awayForm?.offensiveFormMultiplier ?? 1.0;
  const awayDefensive = awayForm?.defensiveFormMultiplier ?? 1.0;

  let lambdaHome = lambdaHomeBase * homeOffensive * awayDefensive;
  let lambdaAway = lambdaAwayBase * awayOffensive * homeDefensive;

  // Hard invariant: lambda > 0 always — apply epsilon floor
  // §14.1: lambdas must be strictly positive
  let epsilonApplied = false;
  if (lambdaHome <= 0) {
    lambdaHome = LAMBDA_EPSILON;
    epsilonApplied = true;
  }
  if (lambdaAway <= 0) {
    lambdaAway = LAMBDA_EPSILON;
    epsilonApplied = true;
  }

  return {
    lambda_home: lambdaHome,
    lambda_away: lambdaAway,
    eloDiff,
    epsilonApplied,
  };
}

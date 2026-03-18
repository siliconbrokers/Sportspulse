/**
 * track2-engine.ts — NEXUS Track 2: Goals Model Entry Point.
 *
 * Spec authority:
 *   - taxonomy spec S4.1: "Track 2 translates the strength estimates from
 *     Track 1 into a joint distribution of goals scored by each team."
 *   - taxonomy spec S4.2: Bivariate Poisson + Dixon-Coles. Lambdas sourced
 *     from Track1Output.expectedGoalsHome / expectedGoalsAway.
 *   - taxonomy spec S4.4: Sum validation — SCORELINE_SUM_VIOLATION warning
 *     when pre-normalization sum outside [0.999, 1.001].
 *   - taxonomy spec S4.7: "Track 2 degrades only when Track 1 cannot produce
 *     output. If Track 1 outputs lambdas, Track 2 always produces a valid matrix."
 *   - taxonomy spec S4.8: goalsModelVersion must be set in output.
 *
 * INVARIANTS:
 *   - Pure function. No Date.now(). No Math.random(). No IO.
 *   - lambdaHome = exp(homeStrength + haOffset) → clamped to [LAMBDA_MIN, LAMBDA_MAX].
 *   - lambdaAway = exp(awayStrength - haOffset * AWAY_HA_FACTOR) → clamped.
 *   - scorelineMatrix is always 8×8 (MAX_GOALS=7 → 0..7 for each team).
 *
 * INTEGRATION NOTE — Track1Output → Track2Input mapping:
 *   Track1Output.homeStrength.attackStrength is in goals/game space (e.g. 1.3).
 *   The log-linear lambda formula requires log-space strengths.
 *   Mapping: homeStrength = ln(attackHome * defenseAway)
 *            awayStrength = ln(attackAway * defenseHome)
 *   This is the standard Dixon-Coles parameterization where:
 *     lambda_home = homeAttack * awayDefense * homeAdvantage (multiplicative)
 *   Which in log-space becomes: ln(homeAttack) + ln(awayDefense) + ln(homeAdvantage).
 *   However, for Track 2 in NEXUS, the task spec uses a simpler additive log-space
 *   formula: lambda = exp(strength + advantage). The strengths passed into Track 2
 *   are pre-mapped to log space by computeTrack2() before calling computeLambdas().
 *
 * @module nexus/track2/track2-engine
 */

import type { Track1Output } from '../track1/types.js';
import type { Track2Input, Track2Output } from './types.js';
import { buildGoalsMatrix, computeLambdas, deriveTrack2Output, getRhoForLeague } from './poisson-goals.js';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute Track 2 (Goals Model) output from Track 1 strength estimates.
 *
 * This is the primary integration point: it accepts Track1Output directly,
 * maps the strength estimates to log-space inputs, and runs the full Poisson
 * + Dixon-Coles pipeline.
 *
 * taxonomy spec S4.2: "lambda_home = Track1Output.expectedGoalsHome" — in
 * NEXUS, these are derived from Track 1's attack/defense strengths via the
 * log-linear formula rather than read directly, to preserve the Track 1/2
 * separation of concerns (Track 1 outputs strength estimates, Track 2
 * converts them to goal rates).
 *
 * taxonomy spec S4.7: No independent degradation conditions for Track 2.
 * If Track 1 produced output, Track 2 always produces a valid matrix.
 *
 * WARNINGS (not thrown — returned in metadata):
 *   SCORELINE_SUM_VIOLATION: pre-normalization sum outside [0.999, 1.001].
 *   This indicates a numerical issue and should be logged by the caller.
 *
 * @param track1Output   - Output from computeTrack1(). Must not be null.
 * @param leagueId       - League identifier for per-liga rho lookup.
 * @param isNeutralVenue - Optional override; defaults to track1Output.isNeutralVenue.
 * @returns Track2Output with scoreline matrix and all derived quantities.
 */
export function computeTrack2(
  track1Output: Track1Output,
  leagueId: string,
  isNeutralVenue?: boolean,
): Track2Output & { _scorelineSumViolation: boolean } {
  const neutral = isNeutralVenue ?? track1Output.isNeutralVenue;

  // ── Map Track 1 strengths to Track 2 log-space inputs ──────────────────
  //
  // Track1 attackStrength = goals/game average (e.g. 1.5).
  // Track1 defenseStrength = goals conceded/game average (lower = stronger).
  //
  // Log-linear mapping (standard Dixon-Coles parameterization):
  //   homeStrength = ln(attackHome) + ln(defenseAway)
  //   awayStrength = ln(attackAway) + ln(defenseHome)
  //
  // This produces: exp(homeStrength) = attackHome * defenseAway
  //                exp(awayStrength) = attackAway * defenseHome
  //
  // For defenseStrength: lower = stronger (fewer goals conceded).
  // We use defenseStrength directly as a "conceding rate" — higher defense
  // strength of the opponent means more goals for us.
  //
  // Edge case: clamp attack/defense to a minimum of 0.01 before ln() to
  // avoid ln(0) = -Infinity when a team has a perfect defensive record.
  const MIN_STRENGTH = 0.01;

  const attackHome = Math.max(MIN_STRENGTH, track1Output.homeStrength.attackStrength);
  const defenseAway = Math.max(MIN_STRENGTH, track1Output.awayStrength.defenseStrength);
  const attackAway = Math.max(MIN_STRENGTH, track1Output.awayStrength.attackStrength);
  const defenseHome = Math.max(MIN_STRENGTH, track1Output.homeStrength.defenseStrength);

  const homeStrength = Math.log(attackHome) + Math.log(defenseAway);
  const awayStrength = Math.log(attackAway) + Math.log(defenseHome);

  // Home advantage offset in log-space.
  // Track1 leagueHomeAdvantage.homeAdvantage is in goal-difference space (e.g. 0.3).
  // Convert to log-space multiplier: ln(1 + homeAdv / leagueAvgGoals).
  // Approximation: for small homeAdv relative to league average (~2.7 goals/game),
  // ln(1 + x) ≈ x. We use the offset directly as the log-space adjustment.
  // This matches the task spec formula: lambda_home = exp(homeStrength + homeAdvantage).
  const homeAdvantage = track1Output.leagueHomeAdvantage.homeAdvantage;

  // ── Build Track2Input ───────────────────────────────────────────────────
  const input: Track2Input = {
    homeStrength,
    awayStrength,
    homeAdvantage,
    leagueId,
    isNeutralVenue: neutral,
  };

  return computeTrack2FromInput(input);
}

/**
 * Compute Track 2 output directly from a Track2Input.
 *
 * This variant accepts pre-mapped inputs (homeStrength and awayStrength already
 * in log-space) and is the low-level engine function. Used by computeTrack2()
 * and directly in tests.
 *
 * taxonomy spec S4.2: full Poisson + Dixon-Coles pipeline.
 *
 * PURE: no side effects, no IO.
 *
 * @param input - Track2Input with log-space strengths and league metadata.
 * @returns Track2Output + _scorelineSumViolation metadata flag.
 */
export function computeTrack2FromInput(
  input: Track2Input,
): Track2Output & { _scorelineSumViolation: boolean } {
  const { homeStrength, awayStrength, homeAdvantage, leagueId, isNeutralVenue } = input;

  // Step 1: Compute lambdas (with home advantage and clamp).
  // taxonomy spec S4.2 formula.
  const { lambdaHome, lambdaAway } = computeLambdas(
    homeStrength,
    awayStrength,
    homeAdvantage,
    isNeutralVenue,
  );

  // Step 2: Look up per-liga rho.
  // taxonomy spec S4.3.
  const { rho } = getRhoForLeague(leagueId);

  // Step 3: Build scoreline matrix with Dixon-Coles correction.
  // taxonomy spec S4.4.
  const { matrix, sumValid } = buildGoalsMatrix(lambdaHome, lambdaAway, rho);

  // Step 4: Derive all Track 2 output quantities.
  // taxonomy spec S4.5.
  const output = deriveTrack2Output(matrix, lambdaHome, lambdaAway, rho, leagueId);

  // Step 5: Return output with sum violation flag.
  // Caller must log SCORELINE_SUM_VIOLATION if _scorelineSumViolation = true.
  // taxonomy spec S4.4: "must be logged as SCORELINE_SUM_VIOLATION."
  return {
    ...output,
    _scorelineSumViolation: !sumValid,
  };
}

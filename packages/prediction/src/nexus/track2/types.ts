/**
 * types.ts — NEXUS Track 2: Goals Model type definitions.
 *
 * Spec authority:
 *   - taxonomy spec S4.1: Track 2 purpose — translate Track 1 strengths into
 *     a joint distribution of goals scored by each team.
 *   - taxonomy spec S4.2: Bivariate Poisson with Dixon-Coles correction.
 *   - taxonomy spec S4.3: rho parameter (per-liga, offline sweep, versioned).
 *   - taxonomy spec S4.4: Scoreline matrix dimensions (MAX_GOALS = 7 → 8x8).
 *   - taxonomy spec S4.5: Derived quantities (1X2, xG, O/U thresholds, BTTS).
 *   - taxonomy spec S4.6: Track2Output interface.
 *
 * INVARIANTS (taxonomy spec S4.4):
 *   - sum(scorelineMatrix) must be within [0.999, 1.001] before renormalization.
 *   - After renormalization: sum = 1.0 (within 1e-9).
 *   - p_home + p_draw + p_away = 1.0 (within 1e-9).
 *   - lambdaHome and lambdaAway are clamped to [LAMBDA_MIN, LAMBDA_MAX].
 *
 * @module nexus/track2/types
 */

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Maximum goals in the scoreline matrix (inclusive).
 * taxonomy spec S4.4: "default MAX_GOALS = 7" → 8x8 matrix (0..7 × 0..7).
 * goalsModelVersion must be bumped if this constant changes (spec S4.8).
 */
export const MAX_GOALS = 7;

/**
 * Default Dixon-Coles rho parameter.
 * taxonomy spec S4.3: "rho is computed per-liga through offline sweep."
 * -0.13 is the standard empirical value from the original Dixon-Coles (1997) paper.
 * This default is used when no per-liga rho is available.
 */
export const DEFAULT_RHO = -0.13;

/**
 * Lambda clamp bounds.
 * Prevent degenerate Poisson distributions from extreme team strength differentials.
 * LAMBDA_MIN: avoids near-zero lambdas that cause numerical instability.
 * LAMBDA_MAX: avoids astronomically high expected goal rates.
 *
 * Task spec: clamp to [0.2, 5.0].
 */
export const LAMBDA_MIN = 0.2;
export const LAMBDA_MAX = 5.0;

/**
 * Home advantage asymmetry factor for the away team.
 * taxonomy spec S4.2 (from task prompt):
 *   lambda_home = exp(homeStrength + homeAdvantage) when not neutral
 *   lambda_away = exp(awayStrength - homeAdvantage * AWAY_HA_FACTOR) when not neutral
 * Factor 0.5 reflects that away teams benefit less from venue symmetry.
 */
export const AWAY_HA_FACTOR = 0.5;

/**
 * Over/under threshold keys supported.
 * taxonomy spec S4.5: p_over_X for X in {0.5, 1.5, 2.5, 3.5, 4.5}.
 */
export const OVER_THRESHOLDS = [0.5, 1.5, 2.5, 3.5, 4.5] as const;
export type OverThreshold = (typeof OVER_THRESHOLDS)[number];

/**
 * Tolerance for scoreline matrix sum validation.
 * taxonomy spec S4.4: "sum must be within [0.999, 1.001] before renormalization."
 */
export const SCORELINE_SUM_TOLERANCE = 0.001;

/**
 * Current goals model version identifier.
 * taxonomy spec S4.8: bumped when Dixon-Coles formula, renormalization method,
 * MAX_GOALS, or rho sweep methodology changes.
 */
export const GOALS_MODEL_VERSION = 'nexus-goals-model-v1.0';

// ── Input types ─────────────────────────────────────────────────────────────

/**
 * Input to Track 2 Goals Model.
 *
 * Derived from Track1Output (taxonomy spec S4.2):
 *   - homeStrength: log-scale attack strength for the home team
 *   - awayStrength: log-scale attack strength for the away team
 *   - homeAdvantage: dynamic home advantage offset from Track 1
 *   - leagueId: for per-liga rho lookup
 *   - isNeutralVenue: suppresses home advantage when true
 *
 * NOTE: The mapping from Track1Output to Track2Input is the caller's
 * responsibility (see track2-engine.ts). This decouples the Goals Model
 * from Track 1 internals.
 */
export interface Track2Input {
  /** Log-scale attack strength for the home team (from Track1Output). */
  homeStrength: number;
  /** Log-scale attack strength for the away team (from Track1Output). */
  awayStrength: number;
  /**
   * Dynamic home advantage offset (from Track1Output.leagueHomeAdvantage.homeAdvantage).
   * Applied as an additive offset in log-space to lambda_home and subtracted
   * (scaled by AWAY_HA_FACTOR) from lambda_away when isNeutralVenue = false.
   */
  homeAdvantage: number;
  /** League identifier — used to look up per-liga rho parameter. */
  leagueId: string;
  /**
   * Whether the match is at a neutral venue.
   * MUST come from canonical match data — never inferred.
   * When true: home advantage offset = 0 for both teams.
   */
  isNeutralVenue: boolean;
}

// ── Output types ─────────────────────────────────────────────────────────────

/**
 * Dixon-Coles correction parameters (for explainability and auditability).
 * taxonomy spec S4.3: rho is versioned and traceable.
 */
export interface DixonColesParams {
  /** Per-liga rho applied. Negative values reduce P(0,0) and P(1,1). */
  rho: number;
  /** League code the rho was selected for. 'global' if per-liga not available. */
  leagueId: string;
  /** Whether the default rho was used (no per-liga rho available). */
  isDefault: boolean;
}

/**
 * Output of Track 2 Goals Model.
 *
 * taxonomy spec S4.6: canonical Track2Output interface.
 *
 * INVARIANTS:
 *   - scorelineMatrix is (MAX_GOALS+1) × (MAX_GOALS+1) = 8×8.
 *   - sum(scorelineMatrix) = 1.0 (within 1e-9) after renormalization.
 *   - p_home + p_draw + p_away = 1.0 (within 1e-9).
 *   - lambdaHome in [LAMBDA_MIN, LAMBDA_MAX].
 *   - lambdaAway in [LAMBDA_MIN, LAMBDA_MAX].
 */
export interface Track2Output {
  /**
   * Scoreline probability matrix P[i][j].
   * i = home goals (0..MAX_GOALS), j = away goals (0..MAX_GOALS).
   * Dimensions: (MAX_GOALS+1) × (MAX_GOALS+1) = 8×8.
   * taxonomy spec S4.4.
   */
  scorelineMatrix: number[][];

  /**
   * 1X2: home win probability.
   * = sum of P[i][j] where i > j.
   * taxonomy spec S4.5.
   */
  p_home: number;

  /**
   * 1X2: draw probability.
   * = sum of P[i][j] where i == j.
   * taxonomy spec S4.5.
   */
  p_draw: number;

  /**
   * 1X2: away win probability.
   * = sum of P[i][j] where i < j.
   * taxonomy spec S4.5.
   */
  p_away: number;

  /**
   * Expected goals for home team from scoreline distribution.
   * = sum of i * P[i][j] for all i, j.
   * taxonomy spec S4.5.
   */
  expectedGoalsHome: number;

  /**
   * Expected goals for away team from scoreline distribution.
   * = sum of j * P[i][j] for all i, j.
   * taxonomy spec S4.5.
   */
  expectedGoalsAway: number;

  /**
   * Over/under probabilities for each threshold.
   * Key format: 'over_X.X' e.g. 'over_2.5'.
   * taxonomy spec S4.5: p_over_X = sum P[i][j] where i+j > X.
   */
  p_over: Record<string, number>;

  /**
   * Both teams to score probability.
   * = sum of P[i][j] where i >= 1 and j >= 1.
   * taxonomy spec S4.5.
   */
  p_btts: number;

  /**
   * The rho parameter actually applied in the Dixon-Coles correction.
   * taxonomy spec S4.6.
   */
  rhoUsed: number;

  /**
   * Lambda (expected goals) for home team — pre-Poisson, post-clamp.
   * Exposed for explainability (§19.1 alignment from V3 spec).
   */
  lambdaHome: number;

  /**
   * Lambda (expected goals) for away team — pre-Poisson, post-clamp.
   */
  lambdaAway: number;

  /**
   * Goals model version identifier (taxonomy spec S4.8).
   */
  goalsModelVersion: string;
}

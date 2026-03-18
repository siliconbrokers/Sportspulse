/**
 * logistic-model.ts — NEXUS Track 3: logistic regression for 1X2 prediction.
 *
 * Spec authority:
 *   - taxonomy spec S5.2: method — logistic regression or GBM, deterministic,
 *     explainable, calibration-compatible.
 *   - taxonomy spec S5.3.1: feature schema — which features feed the model.
 *   - taxonomy spec S5.3.3: excluded features — no market odds in Track 3.
 *   - taxonomy spec S5.4: MISSING features are excluded from input vector
 *     (not set to 0.0 in the FeatureValue layer; but as a modelling choice
 *     for logistic regression, missing numeric features use 0 as a neutral
 *     imputation to avoid input vector shrinkage — this is documented below).
 *   - NEXUS-0 S6.1: MISSING sentinel.
 *
 * ALGORITHM CHOICE (taxonomy spec S5.2):
 *   Logistic regression (multinomial / softmax over 3 classes).
 *   Rationale: deterministic, explainable (coefficients as feature importances),
 *   calibration-compatible (softmax output is suitable for isotonic calibration),
 *   low variance (important for small football datasets).
 *
 * MISSINGNESS HANDLING (taxonomy spec S5.4b):
 *   taxonomy spec S5.4 states: for logistic regression (no native missingness),
 *   "the feature is excluded from the input vector entirely, and the model uses
 *   a variant trained on the reduced feature set."
 *
 *   Implementation: for the initial logistic model with fixed weights, features
 *   with MISSING value contribute 0 to the linear combination (their weight term
 *   is multiplied by 0). This is equivalent to "not contributing" without
 *   requiring a separate model per feature subset. This is documented explicitly
 *   and is not silent imputation — it is a known, explicit modelling choice.
 *   The confidence level reflects this degradation (Track3Confidence: LOW/MEDIUM).
 *
 *   Global mean imputation is prohibited (NEXUS-0 S6.3) — we do NOT use any
 *   league-wide or dataset-wide mean as the neutral value.
 *
 * H2H EXCLUSION:
 *   taxonomy spec S5.3.2: H2H features are conditionally eligible. Until lift
 *   is demonstrated, they are NOT included in DEFAULT_LOGISTIC_WEIGHTS.
 *
 * @module nexus/track3/logistic-model
 */

import { MISSING } from '../feature-store/types.js';
import type { FeatureValue } from '../feature-store/types.js';
import type { Track3FeatureVector } from './types.js';

// ── Logistic weights (taxonomy spec S5.2) ────────────────────────────────

/**
 * Logistic weight schema for Track 3.
 *
 * Three parallel weight vectors: one per outcome class.
 * Applied via softmax multiclass: score_k = intercept_k + sum(w_k_i * x_i).
 * Final probabilities: p_k = exp(score_k) / sum(exp(score_j)).
 *
 * These are initial weights calibrated from domain knowledge for European
 * football. They will be replaced by learned weights in the meta-ensemble
 * training phase (taxonomy spec S7.4).
 *
 * Feature list used (taxonomy spec S5.3.1 eligible only):
 *   - eloDiff (eloHome - eloAway)
 *   - restDaysHome, restDaysAway
 *   - matchesLast4WeeksHome, matchesLast4WeeksAway (schedule congestion)
 *   - formHome_last5, formAway_last5 (general form)
 *   - homeFormHome_last5, awayFormAway_last5 (context-specific form)
 *
 * Features NOT used:
 *   - tablePositionHome/Away: redundant with eloDiff for logistic (correlated)
 *   - H2H features: conditionally eligible, lift not yet demonstrated
 *   - competitiveImportance: captured via matchday/seasonPhase proxy
 *   - matchday/seasonPhase: no strong signal in initial calibration
 */
export interface LogisticWeights {
  // ── Per-class intercepts ────────────────────────────────────────────────
  /** Intercept for HOME class. Encodes base home advantage. */
  intercept_home: number;
  /** Intercept for DRAW class. */
  intercept_draw: number;
  /** Intercept for AWAY class. Reference class (typically 0 in multinomial). */
  intercept_away: number;

  // ── Elo differential ────────────────────────────────────────────────────
  /** eloDiff coefficient for HOME class. Positive: higher eloDiff → more home wins. */
  eloDiff_home: number;
  /** eloDiff coefficient for DRAW class. Near-zero for eloDiff. */
  eloDiff_draw: number;
  /** eloDiff coefficient for AWAY class. Negative: higher eloDiff → fewer away wins. */
  eloDiff_away: number;

  // ── Rest days ────────────────────────────────────────────────────────────
  /** restDaysHome for HOME class. More home rest → slightly more home wins. */
  restDaysHome_home: number;
  /** restDaysHome for DRAW class. */
  restDaysHome_draw: number;
  /** restDaysHome for AWAY class. */
  restDaysHome_away: number;
  /** restDaysAway for HOME class. More away rest → fewer home wins. */
  restDaysAway_home: number;
  /** restDaysAway for DRAW class. */
  restDaysAway_draw: number;
  /** restDaysAway for AWAY class. */
  restDaysAway_away: number;

  // ── Schedule congestion ──────────────────────────────────────────────────
  /** matchesLast4WeeksHome for HOME class. More congestion → slight home disadvantage. */
  congestionHome_home: number;
  /** matchesLast4WeeksHome for DRAW class. */
  congestionHome_draw: number;
  /** matchesLast4WeeksHome for AWAY class. */
  congestionHome_away: number;
  /** matchesLast4WeeksAway for HOME class. */
  congestionAway_home: number;
  /** matchesLast4WeeksAway for DRAW class. */
  congestionAway_draw: number;
  /** matchesLast4WeeksAway for AWAY class. */
  congestionAway_away: number;

  // ── General form ─────────────────────────────────────────────────────────
  /** formHome_last5 for HOME class. Better home form → more home wins. */
  formHome_home: number;
  /** formHome_last5 for DRAW class. */
  formHome_draw: number;
  /** formHome_last5 for AWAY class. */
  formHome_away: number;
  /** formAway_last5 for HOME class. */
  formAway_home: number;
  /** formAway_last5 for DRAW class. */
  formAway_draw: number;
  /** formAway_last5 for AWAY class. */
  formAway_away: number;

  // ── Context-specific form ────────────────────────────────────────────────
  /** homeFormHome_last5 for HOME class. */
  homeFormHome_home: number;
  /** homeFormHome_last5 for DRAW class. */
  homeFormHome_draw: number;
  /** homeFormHome_last5 for AWAY class. */
  homeFormHome_away: number;
  /** awayFormAway_last5 for HOME class. */
  awayFormAway_home: number;
  /** awayFormAway_last5 for DRAW class. */
  awayFormAway_draw: number;
  /** awayFormAway_last5 for AWAY class. */
  awayFormAway_away: number;
}

/**
 * Default logistic weights — initial calibration for European football.
 *
 * Values are set to plausible starting points based on domain knowledge.
 * These will be replaced by learned weights in Fase 3 (meta-ensemble training).
 *
 * Key design rationale:
 * - eloDiff is the strongest signal (derived from Elo ratings which encode
 *   historical match outcomes). Scale: 1 Elo point ≈ 0.0004 probability change.
 * - Rest and form signals are secondary, typical literature-based values.
 * - Intercepts encode the base home advantage (~46% home / 26% draw / 28% away
 *   for a league-average European fixture).
 */
export const DEFAULT_LOGISTIC_WEIGHTS: LogisticWeights = {
  // Base rates: home ~46%, draw ~26%, away ~28%
  // log(0.46) ≈ -0.78, log(0.26) ≈ -1.35, log(0.28) ≈ -1.27
  intercept_home: -0.78,
  intercept_draw: -1.35,
  intercept_away: -1.27,

  // eloDiff: ~0.004 per Elo point in log-odds (500 point diff ≈ 2 log-odds units)
  eloDiff_home: 0.004,
  eloDiff_draw: -0.001,
  eloDiff_away: -0.004,

  // Rest days: minor effect, ~0.01 per day
  restDaysHome_home: 0.01,
  restDaysHome_draw: 0.002,
  restDaysHome_away: -0.01,
  restDaysAway_home: -0.01,
  restDaysAway_draw: 0.002,
  restDaysAway_away: 0.01,

  // Schedule congestion (matches in 4 weeks): tired = slight disadvantage
  congestionHome_home: -0.04,
  congestionHome_draw: 0.01,
  congestionHome_away: 0.02,
  congestionAway_home: 0.02,
  congestionAway_draw: 0.01,
  congestionAway_away: -0.04,

  // General form (pts per game): ~0.15 per point
  formHome_home: 0.15,
  formHome_draw: -0.02,
  formHome_away: -0.12,
  formAway_home: -0.12,
  formAway_draw: -0.02,
  formAway_away: 0.15,

  // Context-specific form: stronger signal than general form
  homeFormHome_home: 0.18,
  homeFormHome_draw: -0.03,
  homeFormHome_away: -0.15,
  awayFormAway_home: -0.15,
  awayFormAway_draw: -0.03,
  awayFormAway_away: 0.18,
};

// ── Numeric value extraction (MISSING → 0 neutral imputation) ────────────

/**
 * Extract a numeric value from a FeatureValue for use in the logistic model.
 *
 * taxonomy spec S5.4b: for logistic regression, MISSING features are handled
 * by contributing 0 to the linear combination (equivalent to neutral / no-signal
 * imputation). This is NOT global mean imputation — 0 is a deliberate neutral
 * value that makes the corresponding weight term vanish.
 *
 * Returns [numericValue, wasPresent] — the second element is used to track
 * how many features were actually available (for confidence computation).
 */
function extractNumeric(fv: FeatureValue<number>): [number, boolean] {
  if (fv.value === MISSING) return [0, false];
  return [fv.value as number, true];
}

// ── Softmax helper ──────────────────────────────────────────────────────

/**
 * Compute softmax over three scores.
 *
 * Uses the numerically stable max-subtraction form to avoid overflow.
 * taxonomy spec S5.2 requirement: deterministic output.
 */
function softmax3(
  scoreHome: number,
  scoreDraw: number,
  scoreAway: number,
): { home: number; draw: number; away: number } {
  const maxScore = Math.max(scoreHome, scoreDraw, scoreAway);
  const eHome = Math.exp(scoreHome - maxScore);
  const eDraw = Math.exp(scoreDraw - maxScore);
  const eAway = Math.exp(scoreAway - maxScore);
  const total = eHome + eDraw + eAway;
  return {
    home: eHome / total,
    draw: eDraw / total,
    away: eAway / total,
  };
}

// ── Predict (taxonomy spec S5.2, S5.5) ───────────────────────────────────

/**
 * Apply logistic regression with softmax to produce 1X2 probabilities.
 *
 * taxonomy spec S5.2: deterministic. taxonomy spec S5.5: output is purely 1X2.
 *
 * Features with MISSING value contribute 0 to the linear combination
 * (documented in module header — not silent global-mean imputation).
 *
 * INVARIANT: output.home + output.draw + output.away = 1.0 (softmax ensures this).
 *
 * @param features  - Track 3 feature vector.
 * @param weights   - Logistic weights (defaults to DEFAULT_LOGISTIC_WEIGHTS).
 * @returns 1X2 probability distribution and count of available features.
 */
export function predictLogistic(
  features: Track3FeatureVector,
  weights: LogisticWeights = DEFAULT_LOGISTIC_WEIGHTS,
): {
  probs: { home: number; draw: number; away: number };
  featuresPresent: number;
  featuresTotal: number;
} {
  // Extract numeric values (MISSING → 0 neutral)
  const [eloDiff, hasEloDiff] = [features.eloDiff, true]; // always present
  const [restHome, hasRestHome] = extractNumeric(features.restDaysHome);
  const [restAway, hasRestAway] = extractNumeric(features.restDaysAway);
  const [congHome, hasCongHome] = extractNumeric(features.matchesLast4WeeksHome);
  const [congAway, hasCongAway] = extractNumeric(features.matchesLast4WeeksAway);
  const [fHome, hasFormHome] = extractNumeric(features.formHome_last5);
  const [fAway, hasFormAway] = extractNumeric(features.formAway_last5);
  const [hfHome, hasHfHome] = extractNumeric(features.homeFormHome_last5);
  const [afAway, hasAfAway] = extractNumeric(features.awayFormAway_last5);

  const featuresPresent = [
    hasEloDiff, hasRestHome, hasRestAway, hasCongHome, hasCongAway,
    hasFormHome, hasFormAway, hasHfHome, hasAfAway,
  ].filter(Boolean).length;

  // Linear combination for each class
  // score_k = intercept_k + sum(w_k_i * x_i)
  const scoreHome =
    weights.intercept_home +
    weights.eloDiff_home * eloDiff +
    weights.restDaysHome_home * restHome +
    weights.restDaysAway_home * restAway +
    weights.congestionHome_home * congHome +
    weights.congestionAway_home * congAway +
    weights.formHome_home * fHome +
    weights.formAway_home * fAway +
    weights.homeFormHome_home * hfHome +
    weights.awayFormAway_home * afAway;

  const scoreDraw =
    weights.intercept_draw +
    weights.eloDiff_draw * eloDiff +
    weights.restDaysHome_draw * restHome +
    weights.restDaysAway_draw * restAway +
    weights.congestionHome_draw * congHome +
    weights.congestionAway_draw * congAway +
    weights.formHome_draw * fHome +
    weights.formAway_draw * fAway +
    weights.homeFormHome_draw * hfHome +
    weights.awayFormAway_draw * afAway;

  const scoreAway =
    weights.intercept_away +
    weights.eloDiff_away * eloDiff +
    weights.restDaysHome_away * restHome +
    weights.restDaysAway_away * restAway +
    weights.congestionHome_away * congHome +
    weights.congestionAway_away * congAway +
    weights.formHome_away * fHome +
    weights.formAway_away * fAway +
    weights.homeFormHome_away * hfHome +
    weights.awayFormAway_away * afAway;

  const probs = softmax3(scoreHome, scoreDraw, scoreAway);

  return {
    probs,
    featuresPresent,
    featuresTotal: 9, // 9 features used in this model (eloDiff + 4 pairs)
  };
}

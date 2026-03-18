/**
 * types.ts — NEXUS Track 3: Tabular Discriminative Model — Type Definitions.
 *
 * Spec authority:
 *   - taxonomy spec S5.1: Track 3 purpose
 *   - taxonomy spec S5.3: feature schema (eligible, conditionally eligible, excluded)
 *   - taxonomy spec S5.4: missingness in the feature vector
 *   - taxonomy spec S5.5: Track3Output interface
 *   - taxonomy spec S5.6: degradation rules
 *   - NEXUS-0 S3.2: as-of semantics (anti-lookahead)
 *   - NEXUS-0 S6.1: MISSING sentinel — never null/0/undefined for absent data
 *   - NEXUS-0 S7.1: UNKNOWN confidence → feature excluded from input vector
 *
 * CRITICAL DESIGN DECISIONS:
 *
 * 1. FEATURE VECTOR USES FeatureValue<T> (NEXUS-0 S6.1):
 *    Every contextual feature that can be absent carries the MISSING sentinel.
 *    Absent ≠ zero. The model handles missingness explicitly (taxonomy S5.4).
 *
 * 2. TRACK 3 DOES NOT IMPORT FROM engine/v3/ (master S8.4, S8.5):
 *    This module is logically isolated from V3. It receives Track 1 strength
 *    estimates as input features, not as probability distributions.
 *
 * 3. OUTPUT IS PURELY 1X2 (taxonomy spec S5.5):
 *    Track 3 does NOT produce goal expectations, scoreline matrices, or derived
 *    markets. Its output reflects only contextual factors.
 *
 * 4. H2H FEATURES ARE CONDITIONALLY ELIGIBLE (taxonomy spec S5.3.2):
 *    H2H features must demonstrate lift via walk-forward validation before
 *    being included by default. This implementation includes them with explicit
 *    documentation of the conditional eligibility requirement.
 *
 * @module nexus/track3/types
 */

import type { FeatureValue } from '../feature-store/types.js';

// ── Season phase enum (taxonomy spec S5.3.1) ──────────────────────────────

/**
 * Season phase derived from matchday number.
 *
 * taxonomy spec S5.3.1:
 *   EARLY: matchday 1-10
 *   MID:   matchday 11-25
 *   LATE:  matchday 26+
 */
export type SeasonPhase = 'EARLY' | 'MID' | 'LATE';

// ── Competitive importance enum (taxonomy spec S5.3.1) ───────────────────

/**
 * Categorical competitive importance per taxonomy spec S5.3.1.
 *
 * TITLE_RACE:         Team is contending for the league title.
 * RELEGATION_BATTLE:  Team is in or near the relegation zone.
 * MID_TABLE:          Team has no immediate competitive pressure.
 * NEUTRAL:            Default — cannot be determined (early season, unavailable data).
 */
export type CompetitiveImportance =
  | 'TITLE_RACE'
  | 'RELEGATION_BATTLE'
  | 'MID_TABLE'
  | 'NEUTRAL';

// ── Track 3 feature vector (taxonomy spec S5.3.1) ─────────────────────────

/**
 * Feature vector for Track 3 tabular discriminative model.
 *
 * taxonomy spec S5.3.1 — eligible features list.
 * Every feature that may be absent uses FeatureValue<T> per NEXUS-0 S6.1.
 * Features that are always computable at prediction time (from inputs) are
 * typed directly.
 *
 * Conditionally eligible features (taxonomy spec S5.3.2, H2H) are included
 * in the struct but marked with comments indicating their conditional status.
 * They must be excluded from the logistic input vector until lift is demonstrated.
 */
export interface Track3FeatureVector {
  // ── Elo strength estimates from Track 1 (taxonomy spec S5.3.1) ──────────
  /** Track 1 effective Elo for home team. */
  eloHome: number;
  /** Track 1 effective Elo for away team. */
  eloAway: number;
  /** Derived: eloHome - eloAway. */
  eloDiff: number;

  // ── Rest / schedule congestion (taxonomy spec S5.3.1) ───────────────────
  /** Days since home team's last match. MISSING if no prior match in history. */
  restDaysHome: FeatureValue<number>;
  /** Days since away team's last match. MISSING if no prior match in history. */
  restDaysAway: FeatureValue<number>;
  /**
   * Matches played by home team in the last 28 days before buildNowUtc.
   * MISSING if no history available.
   */
  matchesLast4WeeksHome: FeatureValue<number>;
  /**
   * Matches played by away team in the last 28 days before buildNowUtc.
   * MISSING if no history available.
   */
  matchesLast4WeeksAway: FeatureValue<number>;

  // ── Table context (taxonomy spec S5.3.1) ────────────────────────────────
  /**
   * Home team's current league table position (1 = top).
   * MISSING when table position is unavailable (e.g., matchday < 3).
   * taxonomy spec S5.6: "Table position unavailable → MISSING (never league midpoint)."
   */
  tablePositionHome: FeatureValue<number>;
  /**
   * Away team's current league table position (1 = top).
   * MISSING when unavailable. Same rules as tablePositionHome.
   */
  tablePositionAway: FeatureValue<number>;
  /**
   * Competitive importance classification.
   * Defaults to NEUTRAL when position data is unavailable (taxonomy spec S5.6).
   */
  competitiveImportance: CompetitiveImportance;

  // ── Form features (taxonomy spec S5.3.1) ────────────────────────────────
  /**
   * Points per match in home team's last 5 league matches (any venue).
   * MISSING when team has fewer than 1 match (taxonomy spec S5.6: uses team's
   * own prior if some history exists, MISSING if zero history).
   */
  formHome_last5: FeatureValue<number>;
  /**
   * Points per match in away team's last 5 league matches (any venue).
   * Same missingness rules as formHome_last5.
   */
  formAway_last5: FeatureValue<number>;
  /**
   * Points per match in home team's last 5 HOME league matches only.
   * MISSING when insufficient home-context history.
   */
  homeFormHome_last5: FeatureValue<number>;
  /**
   * Points per match in away team's last 5 AWAY league matches only.
   * MISSING when insufficient away-context history.
   */
  awayFormAway_last5: FeatureValue<number>;

  // ── Competition context (taxonomy spec S5.3.1) ──────────────────────────
  /** Current matchday number. 0 if unavailable. */
  matchday: number;
  /** Season phase derived from matchday. */
  seasonPhase: SeasonPhase;

  // ── H2H features (taxonomy spec S5.3.2 — CONDITIONALLY ELIGIBLE) ────────
  /**
   * H2H: home team win rate over last 5 direct encounters.
   *
   * CONDITIONAL ELIGIBILITY (taxonomy spec S5.3.2):
   * Must demonstrate statistically significant lift (p < 0.10) in at least 2
   * of 3 production leagues on a held-out validation set before inclusion in
   * the default feature set. Implementation includes computation but the
   * logistic model uses conditional_h2h_eligible flag to decide inclusion.
   *
   * MISSING when h2h_sample_size < 1.
   */
  h2hWinRateHome_last5: FeatureValue<number>;
  /**
   * H2H: average goal difference (home perspective) over last 5 encounters.
   * CONDITIONAL ELIGIBILITY — same rules as h2hWinRateHome_last5.
   * MISSING when h2h_sample_size < 1.
   */
  h2hGoalDiffHome_last5: FeatureValue<number>;
  /**
   * H2H: draw rate over last 5 encounters.
   * CONDITIONAL ELIGIBILITY — same rules as h2hWinRateHome_last5.
   * MISSING when h2h_sample_size < 1.
   */
  h2hDrawRate_last5: FeatureValue<number>;
  /**
   * Number of H2H matches found in history window.
   * Always 0 when no H2H history exists (not MISSING — it is a known zero).
   */
  h2hSampleSize: number;
}

// ── Track 3 output confidence (taxonomy spec S5.5, S5.6) ─────────────────

/**
 * Confidence in Track 3's output based on feature completeness.
 *
 * HIGH:   All critical features available (rest, form, Elo).
 * MEDIUM: Some MISSING features among critical set.
 * LOW:    Majority of features MISSING (e.g., no history at all).
 *
 * taxonomy spec S5.6: when entity resolution fails for both teams, Track 3
 * is excluded from the ensemble entirely. This type covers the cases where
 * Track 3 can produce output, just with varying confidence.
 */
export type Track3Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

// ── Track 3 output (taxonomy spec S5.5) ───────────────────────────────────

/**
 * Output of NEXUS Track 3 — tabular discriminative model.
 *
 * taxonomy spec S5.5:
 *   Track 3 produces a 1X2 probability distribution reflecting contextual
 *   factors. It does NOT produce goal expectations, scoreline matrices, or
 *   derived markets.
 *
 * INVARIANT: probs.home + probs.draw + probs.away = 1.0 (within 1e-10).
 */
export interface Track3Output {
  /** 1X2 probabilities from contextual discriminative model. Sum to 1.0. */
  probs: {
    home: number;
    draw: number;
    away: number;
  };
  /** Confidence based on feature completeness. */
  confidence: Track3Confidence;
  /** Feature vector used to produce this prediction. */
  features_used: Track3FeatureVector;
  /** Algorithm used: logistic regression (initial) or GBM (future). */
  model_type: 'logistic' | 'gbm';
  /**
   * Track 3 context model version (taxonomy spec S5.7).
   * Bumped when model algorithm or hyperparameters change.
   */
  contextModelVersion: string;
  /**
   * Feature schema version (taxonomy spec S5.7).
   * Bumped when feature set changes.
   */
  featureSchemaVersion: string;
}

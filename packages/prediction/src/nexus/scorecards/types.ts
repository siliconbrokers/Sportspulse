/**
 * scorecards/types.ts — NEXUS Scorecard Type Definitions.
 *
 * Spec authority:
 *   - evaluation-and-promotion spec S5: Scorecards
 *   - evaluation-and-promotion spec S5.2.7: By Prediction Origin (3 mutually exclusive slices)
 *   - evaluation-and-promotion spec S12.8: No-double-counting across origin slices
 *
 * Three mutually exclusive scorecard types:
 *   - historical_walk_forward: predictions from backtest scripts (strict walk-forward)
 *   - live_shadow: predictions from shadow runner (pre-kickoff, frozen pipeline)
 *   - combined: disjoint union of the above two
 *
 * Invariant (S12.8): no matchId can appear in both historical_walk_forward AND live_shadow.
 * The combined scorecard cardinality must equal HWF + LS. Any discrepancy is a counting error.
 *
 * @module nexus/scorecards/types
 */

// ── Scorecard type ────────────────────────────────────────────────────────────

/**
 * Identifies the origin of predictions in a scorecard.
 * evaluation-and-promotion spec S5.2.7.
 */
export type ScorecardType = 'historical_walk_forward' | 'live_shadow' | 'combined';

// ── Scorecard entry ───────────────────────────────────────────────────────────

/**
 * A single evaluated prediction entry.
 *
 * INVARIANT: predictionUtc < kickoffUtc (strictly pre-kickoff).
 * Any entry where predictionUtc >= kickoffUtc is invalid and must be rejected.
 *
 * evaluation-and-promotion spec S5.3: scorecard contents.
 * evaluation-and-promotion spec S6.2: live_shadow requires buildNowUtc < kickoffUtc.
 */
export interface ScorecardEntry {
  /** Stable match identifier. Unique within a scorecard source slice. */
  matchId: string;
  /** Competition identifier (e.g. "comp:football-data:PD"). */
  competitionId: string;
  /** ISO 8601 UTC — when the prediction was made (must be < kickoffUtc). */
  predictionUtc: string;
  /** ISO 8601 UTC — match kickoff. */
  kickoffUtc: string;
  /** Realized match result: '1'=home win, 'X'=draw, '2'=away win. */
  result: '1' | 'X' | '2';
  /** NEXUS predicted 1X2 probabilities (calibrated). Sum to 1.0 within 1e-9. */
  probs: { home: number; draw: number; away: number };
  /** Ranked Probability Score for this prediction. Lower is better. */
  rps: number;
  /** Origin slice. Determines which scorecard(s) this entry belongs to. */
  scorecardType: ScorecardType;
}

// ── Scorecard aggregate ───────────────────────────────────────────────────────

/**
 * Aggregated scorecard: a collection of entries with computed metrics.
 *
 * evaluation-and-promotion spec S5.3: each scorecard reports sample size, RPS,
 * and per-league breakdowns.
 *
 * The `combined` scorecard is built by buildCombinedScorecard() as the disjoint
 * union of historical_walk_forward + live_shadow. It must never contain duplicate
 * matchIds across the source slices.
 */
export interface NexusScorecard {
  /** Scorecard type (origin slice or combined). */
  type: ScorecardType;
  /** All entries in this scorecard. */
  entries: ScorecardEntry[];
  /** Mean RPS across all entries. 0 when n = 0. Lower is better. */
  rps_mean: number;
  /** Number of entries. */
  n: number;
  /** Per-competition breakdown: sample size and mean RPS. */
  leagues: Record<string, { n: number; rps_mean: number }>;
}

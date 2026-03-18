/**
 * promotion/types.ts — NEXUS Promotion Gate Type Definitions.
 *
 * Spec authority:
 *   - evaluation-and-promotion spec S6: Promotion Gate (conditions)
 *   - evaluation-and-promotion spec S7: Promotion Process (swap)
 *   - evaluation-and-promotion spec S8: Demotion Process
 *   - evaluation-and-promotion spec S12: Invariants
 *
 * Design principles:
 *   - All types are pure data — no IO, no side effects.
 *   - GateResult.failedConditions carries all failures for full observability.
 *   - SwapController returns recommended SwapAction — never executes production changes.
 *   - Demotion trigger is a pure function: (liveShadowRps, hwfRps) => boolean.
 *
 * @module nexus/promotion/types
 */

// ── Volume Requirements ────────────────────────────────────────────────────────

/**
 * Volume (sample) requirements for the promotion gate.
 *
 * evaluation-and-promotion spec S6.2:
 *   - Total predictions >= 600
 *   - Per league (PD, PL, BL1) >= 200
 *   - Season phases covered >= 2
 *   - Matchdays covered per league >= 10
 *   - At least 100 live_shadow predictions per league
 *
 * Invariant (S6.2 origin composition): of the 200 per league, at least 100
 * must come from live_shadow. The rest may be historical_walk_forward.
 * This condition is non-substitutable (S6.6 para 2).
 */
export interface VolumeRequirements {
  /** Minimum total predictions across all leagues and slices. */
  minTotalPredictions: number;
  /** Minimum predictions per production league (PD, PL, BL1). */
  minPerLeague: number;
  /** Minimum live_shadow predictions per production league. */
  minLiveShadowPerLeague: number;
  /** Minimum distinct season phases covered per evaluation. */
  minSeasonPhases: number;
  /** Minimum distinct matchdays covered per league. */
  minMatchdaysPerLeague: number;
}

/**
 * Default volume thresholds per evaluation-and-promotion spec S6.2.
 */
export const DEFAULT_VOLUME_REQUIREMENTS: VolumeRequirements = {
  minTotalPredictions: 600,
  minPerLeague: 200,
  minLiveShadowPerLeague: 100,
  minSeasonPhases: 2,
  minMatchdaysPerLeague: 10,
};

// ── Performance Requirements ───────────────────────────────────────────────────

/**
 * Performance (metric) requirements for the promotion gate.
 *
 * evaluation-and-promotion spec S6.3 (metric conditions):
 *   - RPS improvement (aggregate): RPS_NEXUS < RPS_V3 (strictly better)
 *   - RPS improvement (per-league majority): NEXUS RPS < V3 RPS in >= 2 of 3 leagues
 *   - DRAW recall preservation: DRAW_recall_NEXUS >= DRAW_recall_V3 - 0.03
 *   - Accuracy preservation: Accuracy_NEXUS >= Accuracy_V3 - 0.02
 *   - Log-loss preservation: LogLoss_NEXUS <= LogLoss_V3 + 0.02
 *
 * evaluation-and-promotion spec S6.4 (no-regression per-league):
 *   - RPS_NEXUS_league <= RPS_V3_league + 0.005 for every league
 *
 * evaluation-and-promotion spec S6.5 (consistency):
 *   - NEXUS RPS < V3 RPS in >= 70% of evaluated matchdays
 *
 * evaluation-and-promotion spec S6.6 (live_shadow condition):
 *   - RPS_NEXUS_live_shadow <= RPS_V3_live_shadow + 0.005
 *   - This condition is non-substitutable (cannot be replaced by combined)
 */
export interface PerformanceRequirements {
  /** RPS must be strictly better in aggregate (no numeric tolerance). */
  rpsAggregateImprovement: true;
  /** NEXUS must have better RPS than V3 in >= N of 3 production leagues. */
  rpsLeagueMajorityCount: number;
  /** DRAW recall tolerance: NEXUS draw recall >= V3 draw recall - this value. */
  drawRecallTolerancePp: number;
  /** Accuracy tolerance in percentage points: NEXUS >= V3 - this value. */
  accuracyTolerancePp: number;
  /** Log-loss max increase: NEXUS log-loss <= V3 log-loss + this value. */
  logLossMaxIncrease: number;
  /**
   * Per-league RPS no-regression threshold: NEXUS RPS per league
   * must not exceed V3 RPS per league by more than this value.
   */
  perLeagueRpsNoRegressionDelta: number;
  /**
   * Matchday consistency: fraction of matchdays where NEXUS RPS < V3 RPS.
   * Must be >= this threshold (e.g., 0.70 = 70%).
   */
  matchdayConsistencyMinFraction: number;
  /**
   * Live shadow RPS tolerance: NEXUS live_shadow RPS must not exceed
   * V3 live_shadow RPS by more than this value.
   * Non-substitutable condition (S6.6).
   */
  liveShadowRpsMaxDelta: number;
}

/**
 * Default performance thresholds per evaluation-and-promotion spec S6.3–S6.6.
 */
export const DEFAULT_PERFORMANCE_REQUIREMENTS: PerformanceRequirements = {
  rpsAggregateImprovement: true,
  rpsLeagueMajorityCount: 2,
  drawRecallTolerancePp: 0.03,
  accuracyTolerancePp: 0.02,
  logLossMaxIncrease: 0.02,
  perLeagueRpsNoRegressionDelta: 0.005,
  matchdayConsistencyMinFraction: 0.70,
  liveShadowRpsMaxDelta: 0.005,
};

// ── Scorecard summaries (inputs to gate evaluator) ────────────────────────────

/**
 * Per-league summary for gate evaluation.
 * All metrics are NEXUS vs V3 for the same match set.
 */
export interface LeagueSummary {
  /** Competition ID (e.g., "comp:football-data:PD"). */
  competitionId: string;
  /** Number of predictions evaluated for this league. */
  n: number;
  /** Number of live_shadow predictions for this league. */
  nLiveShadow: number;
  /** Number of distinct matchdays evaluated. */
  matchdayCount: number;
  /** NEXUS mean RPS for this league. Lower is better. */
  nexusRps: number;
  /** V3 mean RPS for the same matches. Lower is better. */
  v3Rps: number;
}

/**
 * Matchday-level summary for consistency check (S6.5).
 * One entry per matchday with at least 3 evaluated predictions.
 */
export interface MatchdaySummary {
  /** Matchday identifier (e.g., "PD-2026-MD15"). */
  matchdayId: string;
  /** NEXUS mean RPS for this matchday. */
  nexusRps: number;
  /** V3 mean RPS for this matchday. */
  v3Rps: number;
}

/**
 * Full evaluation snapshot used as input to the gate evaluator.
 *
 * Contains separately:
 *   - combined: disjoint union of hwf + live_shadow (S5.2.7)
 *   - liveShadow: only live_shadow slice (S6.6, non-substitutable)
 *   - hwf: only historical_walk_forward slice
 *
 * Invariant (S12.8): combined.n == hwf.n + liveShadow.n.
 */
export interface GateEvaluationInput {
  // ── Combined slice (disjoint union of hwf + live_shadow) ──
  /** Total number of evaluated predictions (HWF + LS combined). */
  combinedN: number;
  /** NEXUS mean RPS across combined slice. */
  combinedNexusRps: number;
  /** V3 mean RPS across combined slice. */
  combinedV3Rps: number;
  /** NEXUS draw recall across combined slice (fraction, 0–1). */
  combinedNexusDrawRecall: number;
  /** V3 draw recall across combined slice (fraction, 0–1). */
  combinedV3DrawRecall: number;
  /** NEXUS accuracy across combined slice (fraction, 0–1). */
  combinedNexusAccuracy: number;
  /** V3 accuracy across combined slice (fraction, 0–1). */
  combinedV3Accuracy: number;
  /** NEXUS log-loss across combined slice. */
  combinedNexusLogLoss: number;
  /** V3 log-loss across combined slice. */
  combinedV3LogLoss: number;

  // ── Live shadow slice (non-substitutable for S6.6) ──
  /** Total predictions in live_shadow slice. */
  liveShadowN: number;
  /** NEXUS mean RPS for live_shadow slice. */
  liveShadowNexusRps: number;
  /** V3 mean RPS for live_shadow slice. */
  liveShadowV3Rps: number;

  // ── Historical walk-forward slice ──
  /** Total predictions in historical_walk_forward slice. */
  hwfN: number;

  // ── Per-league breakdowns ──
  /** Per-league summaries (must include PD, PL, BL1 for production gate). */
  leagueSummaries: LeagueSummary[];

  // ── Matchday-level consistency ──
  /**
   * Matchday summaries for consistency check (S6.5).
   * Only matchdays with >= 3 predictions are included.
   */
  matchdaySummaries: MatchdaySummary[];

  // ── Season phase coverage ──
  /** Number of distinct season phases covered (EARLY=1, MID=2, LATE=3). */
  seasonPhaseCount: number;
}

// ── Gate Result ───────────────────────────────────────────────────────────────

/**
 * Condition identifiers used in GateResult.failedConditions.
 * These strings are the canonical names of gate conditions for observability.
 */
export const GATE_CONDITION = {
  INSUFFICIENT_SAMPLES: 'INSUFFICIENT_SAMPLES',
  INSUFFICIENT_SAMPLES_PER_LEAGUE: 'INSUFFICIENT_SAMPLES_PER_LEAGUE',
  INSUFFICIENT_LIVE_SHADOW: 'INSUFFICIENT_LIVE_SHADOW',
  INSUFFICIENT_SEASON_PHASES: 'INSUFFICIENT_SEASON_PHASES',
  INSUFFICIENT_MATCHDAYS: 'INSUFFICIENT_MATCHDAYS',
  RPS_NO_IMPROVEMENT: 'RPS_NO_IMPROVEMENT',
  RPS_LEAGUE_MAJORITY_FAILED: 'RPS_LEAGUE_MAJORITY_FAILED',
  DRAW_RECALL_REGRESSION: 'DRAW_RECALL_REGRESSION',
  ACCURACY_REGRESSION: 'ACCURACY_REGRESSION',
  LOG_LOSS_REGRESSION: 'LOG_LOSS_REGRESSION',
  PER_LEAGUE_RPS_REGRESSION: 'PER_LEAGUE_RPS_REGRESSION',
  MATCHDAY_CONSISTENCY_FAILED: 'MATCHDAY_CONSISTENCY_FAILED',
  LIVE_SHADOW_RPS_REGRESSION: 'LIVE_SHADOW_RPS_REGRESSION',
} as const;

export type GateConditionId = (typeof GATE_CONDITION)[keyof typeof GATE_CONDITION];

/**
 * Result of the promotion gate evaluation.
 *
 * evaluation-and-promotion spec S6.1:
 *   "The promotion gate is a conjunction of conditions. ALL conditions must be
 *    satisfied simultaneously. There is no override, no 'majority vote,' and no
 *    'close enough.' A single failed condition blocks promotion."
 */
export interface GateResult {
  /** True iff ALL gate conditions passed. */
  passed: boolean;
  /**
   * List of condition IDs that failed.
   * Empty if passed = true.
   * Non-empty if passed = false.
   */
  failedConditions: GateConditionId[];
  /** Numeric evidence for each condition (pass/fail + values). */
  evidence: GateEvidence;
  /** ISO 8601 UTC timestamp when this gate evaluation was run. */
  evaluatedAt: string;
}

/**
 * Numeric evidence attached to a GateResult for full observability.
 * Every condition has a numeric entry so failures can be diagnosed.
 */
export interface GateEvidence {
  // Volume
  totalN: number;
  liveShadowN: number;
  hwfN: number;
  seasonPhaseCount: number;
  perLeagueN: Record<string, number>;
  perLeagueLiveShadowN: Record<string, number>;
  perLeagueMatchdayCount: Record<string, number>;

  // Metrics
  combinedNexusRps: number;
  combinedV3Rps: number;
  rpsDelta: number; // nexus - v3, negative is favorable to NEXUS
  leaguesWhereNexusWins: string[];
  combinedNexusDrawRecall: number;
  combinedV3DrawRecall: number;
  drawRecallDelta: number; // nexus - v3
  combinedNexusAccuracy: number;
  combinedV3Accuracy: number;
  accuracyDelta: number; // nexus - v3
  combinedNexusLogLoss: number;
  combinedV3LogLoss: number;
  logLossDelta: number; // nexus - v3
  perLeagueRpsDelta: Record<string, number>; // nexus - v3 per league
  matchdayConsistencyFraction: number;
  liveShadowNexusRps: number;
  liveShadowV3Rps: number;
  liveShadowRpsDelta: number; // nexus - v3 in live_shadow
}

// ── Demotion Trigger ──────────────────────────────────────────────────────────

/**
 * Result of the demotion trigger check.
 *
 * evaluation-and-promotion spec S8.2:
 *   "NEXUS is demoted if: RPS_NEXUS > RPS_V3 + 0.005 sustained for >= 10
 *    consecutive matches evaluated."
 */
export interface DemotionCheckResult {
  /** True if demotion trigger condition is met. */
  demotionSignal: boolean;
  /**
   * RPS delta that was checked: nexusRps - v3Rps.
   * Positive means NEXUS is worse than V3.
   */
  rpsDelta: number;
  /**
   * Number of consecutive evaluated matches where the trigger condition held.
   * Populated only when demotionSignal = true.
   */
  consecutiveMatches?: number;
  /** Threshold used for the check (from spec S8.2: 0.005). */
  threshold: number;
}

/**
 * Threshold per evaluation-and-promotion spec S8.2.
 */
export const DEMOTION_RPS_THRESHOLD = 0.005;

/**
 * Number of consecutive matches required to fire the demotion trigger (S8.2).
 */
export const DEMOTION_CONSECUTIVE_MATCHES_REQUIRED = 10;

// ── Swap State ────────────────────────────────────────────────────────────────

/**
 * Which model is currently serving production predictions.
 */
export type ActiveModel = 'v3' | 'nexus';

/**
 * Current state of the swap / observation period.
 *
 * evaluation-and-promotion spec S7.1 Step 5–6:
 *   - After promotion: activeModel = 'nexus', v3InShadow = true
 *   - V3 may be deprecated only after 30-day observation period completes
 *     without demotion trigger (spec S8.4, S7.2).
 */
export interface SwapState {
  /** Which model currently serves production. */
  activeModel: ActiveModel;
  /**
   * True if V3 is running in shadow mode (during observation period).
   * Set to true immediately after NEXUS promotion.
   */
  v3InShadow: boolean;
  /**
   * ISO 8601 UTC timestamp when NEXUS was promoted to production.
   * null before promotion.
   */
  nexusPromotedAt: string | null;
  /**
   * ISO 8601 UTC timestamp when V3 was deprecated (shadow deactivated).
   * null until V3 is deprecated.
   */
  v3DeprecatedAt: string | null;
  /**
   * True if a demotion trigger fired during the observation period.
   * Once true, v3 resumes production (activeModel reverts to 'v3').
   */
  demotionFired: boolean;
}

/**
 * Recommended action returned by SwapController.
 * The controller is evaluative — it returns actions, never executes them.
 */
export type SwapActionType =
  | 'ACTIVATE_NEXUS'    // Promote NEXUS to production
  | 'DEMOTE_NEXUS'      // Revert to V3 due to demotion trigger
  | 'DEPRECATE_V3'      // Deactivate V3 shadow runner after observation
  | 'NO_ACTION'         // No change recommended
  | 'BLOCKED';          // Action requested but preconditions not met

/**
 * A recommended swap action with explanation.
 */
export interface SwapAction {
  action: SwapActionType;
  /** Human-readable reason for the recommendation. */
  reason: string;
  /** ISO 8601 UTC timestamp when the recommendation was produced. */
  recommendedAt: string;
}

/**
 * Minimum observation period in days before V3 can be deprecated.
 * evaluation-and-promotion spec S7.2 + S8.4: 30-day observation period.
 */
export const OBSERVATION_PERIOD_DAYS = 30;

/**
 * NEXUS_PROMOTED env var name (per spec S7.1 Step 5).
 * The controller returns whether to set this, it does not set it directly.
 */
export const NEXUS_PROMOTED_ENV_VAR = 'NEXUS_PROMOTED';

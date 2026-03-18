/**
 * NEXUS Odds Store — Core Types
 *
 * Spec authority:
 *   market-signal-policy (MSP):
 *     S2.2  — Role 2 temporal policy (confidence by capture horizon)
 *     S3.1  — Source hierarchy: Pinnacle > Bet365 > market_max > market_avg
 *     S3.2  — OddsSource identifier values
 *     S4.1  — Eligibility for feature role
 *     S4.2  — Eligibility for benchmark role (Pinnacle ONLY)
 *     S7.2  — De-vigging: proportional normalization only
 *   model-taxonomy-and-ensemble (MTE):
 *     S6.2  — Track 4 computation: de-vig pass-through
 *     S6.3  — Track 4 activation state: active/inactive
 *     S6.4  — Track4Output contract
 *
 * CRITICAL DESIGN DECISIONS:
 *
 * 1. OddsProvider follows spec S3.2 exactly. Four values are defined:
 *    'pinnacle', 'bet365', 'market_max', 'market_avg'. No aliases.
 *    Rationale: the spec names these providers precisely; the raw odds
 *    store must be able to represent any source the pipeline ingests.
 *
 * 2. ProviderRole enforces the benchmark/feature separation at the type level.
 *    'benchmark' → only Pinnacle may be selected (MSP S4.2).
 *    'feature'   → Pinnacle → Bet365 → market_max → market_avg (MSP S3.1).
 *    The canonical serving view makes the wrong-source-for-role state
 *    unrepresentable by returning null when benchmark is requested and
 *    Pinnacle is unavailable — the caller cannot inadvertently use Bet365
 *    as a benchmark.
 *
 * 3. snapshot_utc is the effectiveAt timestamp: when the odds snapshot was
 *    captured in the market. The anti-lookahead guard (MSP S6.2) uses
 *    snapshot_utc < buildNowUtc (strict less-than). retrieved_at_utc
 *    tracks ingestion time and is never used for as-of filtering.
 *
 * 4. OddsConfidence is DEACTIVATED (not 'UNKNOWN') when no snapshot exists,
 *    per MSP S2.2: "No snapshot available → Track 4 is deactivated."
 *    The 'UNKNOWN' terminology belongs to FeatureConfidence in NEXUS-0; this
 *    domain uses 'DEACTIVATED' to reflect Track 4's binary activation state.
 *
 * 5. overround in ImpliedProbs stores the pre-normalization sum of raw
 *    implied probabilities (not overround as percentage). This is the
 *    value inspected for well-formedness: spec MSP S4.1 requires
 *    overround within [1.00, 1.15]. Storing it enables post-hoc auditing
 *    without re-deriving from the original odds.
 */

// ── Provider source identifiers (MSP S3.2) ────────────────────────────────

/**
 * Bookmaker source identifiers per MSP S3.1 precedence table.
 *
 * Precedence (highest to lowest):
 *   1. pinnacle    — Most efficient market. Preferred for both roles.
 *   2. bet365      — Wide coverage. Acceptable for feature role only.
 *   3. market_max  — Maximum across bookmakers. Tertiary fallback.
 *   4. market_avg  — Average across bookmakers. Last resort.
 *
 * NOTE: Only 'pinnacle' is eligible for the benchmark role (MSP S4.2).
 * 'bet365', 'market_max', and 'market_avg' are feature-role only.
 */
export type OddsProvider = 'pinnacle' | 'bet365' | 'market_max' | 'market_avg';

/**
 * Precedence order for provider selection per MSP S3.1.
 * Array index = precedence rank (0 = highest).
 * Used by selectFeatureProvider to pick the best available source.
 */
export const PROVIDER_PRECEDENCE: readonly OddsProvider[] = [
  'pinnacle',
  'bet365',
  'market_max',
  'market_avg',
] as const;

// ── Role separation (MSP S2, S4) ──────────────────────────────────────────

/**
 * The role in which odds are being consumed.
 *
 * 'benchmark' — Evaluation reference. Pinnacle ONLY (MSP S4.2).
 *               Never use Bet365 or aggregates for benchmarking.
 * 'feature'   — Meta-ensemble Track 4 input. Pinnacle → Bet365 → Avg
 *               (MSP S4.1, S3.1). Bet365 and aggregates are acceptable
 *               fallbacks when Pinnacle is unavailable.
 *
 * The canonical serving view enforces this at the type level: calling
 * getCanonicalOddsSnapshot with role='benchmark' can only return a record
 * with provider='pinnacle', or null. The wrong-source state is structurally
 * absent from the return type.
 */
export type ProviderRole = 'benchmark' | 'feature';

// ── Market types (MSP S6.1 — 1X2 markets in scope for Track 4) ───────────

/**
 * Supported odds markets. Only 1X2 is in scope for NEXUS Track 4 in this
 * phase. This type is defined as a union to allow future market types
 * (BTTS, Over/Under) to be added without structural change.
 */
export type OddsMarket = '1x2';

// ── Raw odds record (MSP S11 — append-only store unit) ────────────────────

/**
 * A single point-in-time odds snapshot from one bookmaker for one match.
 *
 * INVARIANT: Records in the raw odds store are immutable. Once written,
 * no field may be modified. The key (match_id, provider, snapshot_utc)
 * uniquely identifies a record; writing the same key twice is a no-op
 * (idempotent append per raw-odds-store.ts).
 *
 * Timestamp semantics:
 * - snapshot_utc:    When the odds were captured in the market (effectiveAt).
 *                    Used for as-of filtering: only snapshots with
 *                    snapshot_utc < buildNowUtc are considered valid.
 * - retrieved_at_utc: When the pipeline ingested this record. Used for
 *                     auditing and freshness diagnostics only. Never used
 *                     for as-of filtering.
 */
export interface OddsRecord {
  readonly match_id: string;
  readonly provider: OddsProvider;
  readonly market: OddsMarket;
  readonly odds_home: number;
  readonly odds_draw: number;
  readonly odds_away: number;
  /** When the odds were live in the market — the as-of timestamp (ISO 8601 UTC). */
  readonly snapshot_utc: string;
  /** When the pipeline stored this record — ingestion timestamp (ISO 8601 UTC). */
  readonly retrieved_at_utc: string;
}

// ── De-vigged probabilities (MSP S7.2) ────────────────────────────────────

/**
 * Result of proportional de-vigging per MSP S7.2.
 *
 * Formula (proportional normalization):
 *   rawImplied_i = 1 / odds_i
 *   overround     = sum(rawImplied_i)       ← stored here for auditing
 *   devigged_i    = rawImplied_i / overround
 *
 * Post-de-vig invariants (MSP S7.3):
 *   abs(home + draw + away - 1.0) < 1e-9
 *   all values in [0, 1]
 *
 * Well-formedness guard (MSP S4.1, S4.2):
 *   overround must be in [1.00, 1.15]; outside this range the record
 *   is flagged SUSPECT and excluded from both roles.
 *
 * NOTE: overround here is the raw sum of implied probabilities (e.g.,
 * 1.05 for a 5% vig), NOT a percentage. It equals 1 + vig_fraction.
 */
export interface ImpliedProbs {
  readonly home: number;
  readonly draw: number;
  readonly away: number;
  /** Pre-normalization sum of raw implied probs: sum(1/odds_i). */
  readonly overround: number;
}

// ── Confidence (MSP S2.2, S6.1) ───────────────────────────────────────────

/**
 * Track 4 confidence level, determined by the time distance between
 * snapshot_utc and kickoffUtc (MSP S2.2, S6.1).
 *
 * HIGH:        snapshot within 24h of kickoff (closing line / near-closing).
 *              Track 4 operates at full learned weight.
 * MEDIUM:      snapshot 24-72h before kickoff.
 *              Track 4 operates at full learned weight; per-horizon
 *              segmentation handles information quality.
 * LOW:         snapshot more than 72h before kickoff (stale early odds).
 *              Meta-ensemble applies FAR horizon weight vector; effective
 *              Track 4 weight is empirically lower but non-zero.
 * DEACTIVATED: No snapshot available as-of buildNowUtc.
 *              Track 4 is excluded from the ensemble; its weight is
 *              redistributed to remaining active tracks (MTE S7.6).
 *
 * Note: 'DEACTIVATED' differs from FeatureConfidence's 'UNKNOWN' in
 * NEXUS-0. Here it signals binary track activation state, not data
 * quality of an individual feature observation.
 *
 * IMPORTANT: The confidence thresholds here use snapshot_age_hours
 * (age of the snapshot relative to buildNowUtc), NOT capture distance
 * from kickoff. The canonical serving view computes snapshot_age_hours
 * as hours between snapshot_utc and buildNowUtc. The kickoff-relative
 * semantics in MSP S2.2 apply when building Track 4 input for inference;
 * for the store layer, we expose snapshot age and let the inference layer
 * compute kickoff distance.
 */
export type OddsConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'DEACTIVATED';

// ── Canonical serving view output (MSP S6.2, MTE S6.4) ───────────────────

/**
 * The output of the canonical serving view for a single match + role.
 *
 * This is the unit that Track 4 consumes during inference. It represents
 * the best available odds snapshot as-of buildNowUtc for the requested role,
 * with de-vigging applied.
 *
 * When null is returned (no valid snapshot), Track 4 is DEACTIVATED.
 *
 * Fields:
 * - match_id:          The match this snapshot belongs to.
 * - provider:          The bookmaker whose odds were selected.
 * - role:              Whether these odds serve as 'benchmark' or 'feature'.
 * - implied_probs:     De-vigged 1X2 probabilities (MSP S7.2).
 * - snapshot_age_hours: Hours between snapshot_utc and buildNowUtc.
 *                       Used downstream to determine kickoff-relative
 *                       confidence if the caller has kickoffUtc available.
 * - confidence:        Computed from snapshot_age_hours per MSP S6.1.
 *                      NOTE: see OddsConfidence JSDoc for the snapshot-age
 *                      vs kickoff-distance distinction.
 * - raw_record:        The original OddsRecord that produced this snapshot,
 *                      for audit and reproducibility (MSP S8.3).
 */
export interface CanonicalOddsSnapshot {
  readonly match_id: string;
  readonly provider: OddsProvider;
  readonly role: ProviderRole;
  readonly implied_probs: ImpliedProbs;
  /** Hours between snapshot_utc and buildNowUtc (non-negative). */
  readonly snapshot_age_hours: number;
  readonly confidence: OddsConfidence;
  readonly raw_record: OddsRecord;
}

// ── Odds quality flag (MSP S4.1, S7.3) ────────────────────────────────────

/**
 * Quality assessment after de-vigging, per MSP S7.3.
 *
 * VALID:   overround within [1.00, 1.15]. Record eligible for both roles.
 * SUSPECT: overround outside [1.00, 1.15]. Indicates stale odds or data
 *          error. Record excluded from both feature and benchmark roles.
 */
export type OddsQuality = 'VALID' | 'SUSPECT';

/** Well-formedness bounds for the raw overround (MSP S4.1, S7.3). */
export const OVERROUND_BOUNDS = {
  MIN: 1.00,
  MAX: 1.15,
} as const;

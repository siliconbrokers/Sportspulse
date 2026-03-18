/**
 * NEXUS Temporal Feature Store — Core Types
 *
 * Spec authority: NEXUS-0 (spec.sportpulse.prediction-engine-v2.nexus-0-temporal-feature-store.md)
 *   S3 (As-Of Semantics)
 *   S4 (Source-of-Truth Hierarchy)
 *   S5 (Feature Provenance)
 *   S6 (Missingness Policy)
 *   S11 (Module Invariants)
 *
 * CRITICAL DESIGN DECISIONS:
 *
 * 1. MISSING IS A SYMBOL (S6, S11.5):
 *    Missing values are represented by the `MISSING` Symbol sentinel. Using
 *    null, undefined, or 0 for missingness is prohibited. The spec states:
 *    "Missing data is information, not an error." A distinct type ensures
 *    downstream consumers must explicitly handle the absent case.
 *
 * 2. FIVE REQUIRED PROVENANCE FIELDS (S11.1):
 *    Every feature instance must have all five fields populated:
 *    source, ingestedAt, effectiveAt, confidence, freshness (computed).
 *    No field may be null or undefined — this is an invariant.
 *
 * 3. AS-OF SEMANTICS USE effectiveAt/ingestedAt (S3.1, S5.1):
 *    The spec defines two distinct timestamps: `ingestedAt` (when the pipeline
 *    received the data) and `effectiveAt` (when the real-world event occurred).
 *    These must never be conflated. The anti-lookahead guard operates on
 *    `effectiveAt` with strict less-than against `buildNowUtc` (S3.2).
 *
 * 4. CONFIDENCE IS EXHAUSTIVE (S5.2):
 *    The 'UNKNOWN' level causes the feature to be excluded from prediction
 *    input vectors entirely (S7.1). It is not a degraded confidence — it is
 *    a disqualification.
 */

// ── Source identifiers (S4.1 — S4.5) ─────────────────────────────────────

/**
 * Provider source identifiers per NEXUS-0 S5.1.
 *
 * football-data.co.uk = historical odds CSV downloads only (not match results)
 * flashscore = match incidents (goals, cards, substitutions) only
 * official-club = club official communications (injuries, squad news)
 * manual = manual data entry override
 * derived = computed from other features (S5.3)
 */
export type SourceId =
  | 'api-football'
  | 'football-data-org'
  | 'football-data-co-uk'
  | 'sofascore'
  | 'flashscore'
  | 'official-club'
  | 'manual'
  | 'derived';

// ── MISSING sentinel (S6.1, S6.3) ────────────────────────────────────────

/**
 * The MISSING sentinel represents an absent feature value.
 *
 * INVARIANT: Never use null, undefined, or 0 to represent feature absence.
 * Missing data is information (S6.1). The consuming model must handle this
 * sentinel explicitly — the type system enforces it.
 *
 * Export both the symbol and the type.
 */
export const MISSING = Symbol('MISSING');
export type MissingValue = typeof MISSING;

// ── Confidence levels (S5.2, S7.1) ───────────────────────────────────────

/**
 * Feature confidence level per NEXUS-0 S5.2 and S7.1.
 *
 * HIGH:    Used at full weight. No degradation.
 * MEDIUM:  Used at full weight. Presence logged as QUALITY_MEDIUM.
 * LOW:     May be used with reduced weight. Consumer decides. Must be
 *          documented in prediction explanation if used.
 * UNKNOWN: Feature is EXCLUDED from prediction input vector. Never passed
 *          to any model. Present in store for auditing only.
 */
export type FeatureConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

// ── Provenance (S5.1, S11.1) ──────────────────────────────────────────────

/**
 * Feature provenance record per NEXUS-0 S5.1.
 *
 * All five fields are required with no undefined/null — S11.1 states:
 * "Every feature in the store has all five provenance fields populated."
 *
 * Field semantics:
 * - source:      Provider identifier from SourceId union.
 * - ingestedAt:  When the feature was received by SportPulse's ingestion
 *                pipeline (ISO-8601 UTC with Z).
 * - effectiveAt: When the real-world event occurred or became true
 *                (ISO-8601 UTC with Z). THIS is the timestamp checked
 *                by the anti-lookahead guard (effectiveAt < buildNowUtc).
 * - confidence:  Reliability assessment per S5.2 rules.
 * - freshness:   Computed: seconds between ingestedAt and buildNowUtc.
 *                Must be computed at query time, not stored.
 */
export interface FeatureProvenance {
  readonly source: SourceId;
  readonly ingestedAt: string;   // ISO-8601 UTC
  readonly effectiveAt: string;  // ISO-8601 UTC — used by anti-lookahead
  readonly confidence: FeatureConfidence;
  readonly freshness: number;    // seconds: buildNowUtc - ingestedAt
}

// ── Feature value (S5, S6) ────────────────────────────────────────────────

/**
 * A typed feature value paired with its provenance.
 *
 * When `value` is `MISSING`, the feature is absent but tracked (S6.1).
 * The provenance is still present for MISSING values — it records that
 * a lookup was attempted and found no data, along with when and from where.
 */
export interface FeatureValue<T> {
  readonly value: T | MissingValue;
  readonly provenance: FeatureProvenance;
}

// ── Feature snapshot (S3.4, S9.2) ────────────────────────────────────────

/**
 * A point-in-time snapshot of features for a single match prediction.
 *
 * INVARIANT (S3.4): The as-of view for a given buildNowUtc is deterministic
 * and immutable. Same inputs always produce the same feature set.
 *
 * INVARIANT (S11.2): No feature with effectiveAt >= buildNowUtc may appear
 * in this snapshot. The anti-lookahead guard enforces this invariant.
 *
 * `featureSnapshotId`: A hash or opaque reference that identifies this
 * specific feature set, enabling reproducibility (S9.3).
 */
export interface FeatureSnapshot {
  readonly matchId: string;
  readonly buildNowUtc: string;       // Temporal anchor — ISO-8601 UTC
  readonly featureSnapshotId: string; // Reproducibility identifier (S9.2)
  readonly features: Record<string, FeatureValue<unknown>>;
}

// ── Derived feature provenance (S5.3) ─────────────────────────────────────

/**
 * Extended provenance for features computed from other features (S5.3).
 *
 * INVARIANTS:
 * - confidence = min(confidence of all input features). A derivation can
 *   never increase confidence (S11.8, confidence monotonicity).
 * - effectiveAt = max(effectiveAt of all input features).
 * - source is always 'derived'.
 */
export interface DerivedFeatureProvenance extends FeatureProvenance {
  readonly source: 'derived';
  readonly inputFeatureIds: readonly string[];
  readonly computationVersion: string;
}

// ── Data quality tier (S7.3) ──────────────────────────────────────────────

/**
 * Prediction-level data quality tier per NEXUS-0 S7.3.
 *
 * FULL:    All criteria met: >=80% xG coverage, injury data at MEDIUM+,
 *          market odds at MEDIUM+.
 * PARTIAL: At least one FULL criterion unmet but match history available.
 * MINIMAL: Only basic match history. No xG, injuries, or market odds.
 *
 * Passed to meta-ensemble to select appropriate weight vector.
 */
export type DataQualityTier = 'FULL' | 'PARTIAL' | 'MINIMAL';

// ── Feature conflict event (S4.6) ─────────────────────────────────────────

/**
 * Conflict event logged when two providers supply conflicting values
 * for the same feature (S4.6). Append-only log.
 *
 * INVARIANT (S11.4): Conflicts are never silently resolved. Every conflict
 * generates a logged event.
 */
export interface FeatureConflictEvent {
  readonly entityId: string;
  readonly featureType: string;
  readonly effectiveAt: string;
  readonly winningSource: SourceId;
  readonly losingSource: SourceId;
  readonly winningValue: unknown;
  readonly losingValue: unknown;
  readonly resolvedAt: string; // ISO-8601 UTC
}

// ── xG-specific feature types (S4.2, S6.2.2) ─────────────────────────────

/**
 * Expected goals data for a single team in a match.
 * Used by xg-features.ts to build FeatureValue<XgMatchData>.
 *
 * xgDataAvailable provides the binary indicator required by the prompt.
 * When xgDataAvailable is false, xgValue will be MISSING.
 */
export interface XgMatchData {
  readonly fixtureId: number;
  readonly utcDate: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly xgHome: number | MissingValue;
  readonly xgAway: number | MissingValue;
  readonly xgDataAvailable: boolean;
}

// ── Freshness threshold constants (S7.2) ─────────────────────────────────

/**
 * Freshness thresholds in seconds per NEXUS-0 S7.2.
 * These constants determine when confidence degrades.
 */
export const FRESHNESS_THRESHOLDS_SECONDS = {
  INJURY_ABSENCE: 24 * 60 * 60,           // 24 hours
  CONFIRMED_LINEUP: 2 * 60 * 60,          // 2 hours before kickoff
  COACH_MANAGER: 30 * 24 * 60 * 60,       // 30 days
  MARKET_ODDS_HIGH_CUTOFF: 24 * 60 * 60,  // < 24h → HIGH
  MARKET_ODDS_MEDIUM_CUTOFF: 72 * 60 * 60, // 24-72h → MEDIUM, >72h → LOW
} as const;

/**
 * xG partial coverage threshold (S6.2.2).
 * Below this fraction of matches with xG data, emit XG_PARTIAL_COVERAGE warning.
 */
export const XG_PARTIAL_COVERAGE_THRESHOLD = 0.5;

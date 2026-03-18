/**
 * NEXUS Entity Identity and Resolution — Core Types
 *
 * Spec authority: spec.sportpulse.prediction-engine-v2.entity-identity-and-resolution.md
 *   S2 (Entities in scope)
 *   S3 (Canonical identity model)
 *   S5 (Transfers, loans, club changes)
 *   S6 (Coach and staff changes)
 *   S7 (Resolution confidence states)
 *   S8 (Availability representation)
 *   S10 (Invariants)
 *
 * CRITICAL DESIGN DECISIONS:
 *
 * 1. RESOLUTION STATE IS AN EXHAUSTIVE UNION (S7.1):
 *    Four states: RESOLVED, PARTIAL, UNRESOLVED, CONFLICTED.
 *    UNRESOLVED and CONFLICTED entities are EXCLUDED from the prediction
 *    input vector (S9.1). TypeScript discriminated unions enforce this
 *    separation structurally.
 *
 * 2. AVAILABILITY STATE IS AN EXHAUSTIVE UNION (S8.1):
 *    UNKNOWN is distinct from CONFIRMED_AVAILABLE. "We don't know" is not
 *    "they are available" — the spec states this explicitly in S8.3.
 *
 * 3. CANONICAL ID FORMAT (S3.1):
 *    Unreconciled: player:{source}:{providerId}
 *    Reconciled:   player:canonical:{deterministicHash}
 *    The format is enforced by the resolution layer; these types represent
 *    the resolved form.
 *
 * 4. VENUES ARE OUT OF SCOPE (entity-identity S2.5, master S6.2):
 *    Venue/stadium entity types are not defined here. The spec explicitly
 *    declares them out of scope. Do not add them.
 *
 * 5. AVAILABILITY IS A FEATURE, NOT AN IDENTITY ATTRIBUTE (S8.2):
 *    PlayerAvailability is defined here for structural completeness, but its
 *    temporal semantics (as-of constraint, provenance) are governed by NEXUS-0.
 */

import type { SourceId } from '../feature-store/types.js';

// ── Resolution state (S7.1, S3.2) ────────────────────────────────────────

/**
 * Entity resolution state per entity-identity S7.1.
 *
 * RESOLVED:    Identity confirmed across >= 2 providers (Tier 1 or Tier 2 match)
 *              or via manual confirmation. Full feature eligibility.
 * PARTIAL:     Identified in exactly 1 provider. No contradictory information.
 *              Feature-eligible from that single source.
 * UNRESOLVED:  Reconciliation attempted but failed. Entity is EXCLUDED from
 *              prediction input vector. Present in store for auditing only.
 * CONFLICTED:  Contradictory information from >= 2 providers. EXCLUDED from
 *              prediction input vector. Requires manual resolution (S7.3).
 */
export type ResolutionState = 'RESOLVED' | 'PARTIAL' | 'UNRESOLVED' | 'CONFLICTED';

// ── Availability state (S8.1) ─────────────────────────────────────────────

/**
 * Player availability state per entity-identity S8.1.
 *
 * CONFIRMED_AVAILABLE: Player explicitly declared available or in confirmed lineup.
 * CONFIRMED_ABSENT:    Confirmed absent (injury, suspension, official reason).
 * DOUBT:               Availability uncertain. Provider reports doubtful status.
 *                      Corresponds to API-Football `status: 'Doubtful'`.
 * UNKNOWN:             No availability information in the feature store.
 *                      The model does not assume available or absent (S8.3).
 *
 * INVARIANT: UNKNOWN != CONFIRMED_AVAILABLE. Not knowing is not knowing.
 */
export type AvailabilityState =
  | 'CONFIRMED_AVAILABLE'
  | 'CONFIRMED_ABSENT'
  | 'DOUBT'
  | 'UNKNOWN';

// ── Position (S2.1) ───────────────────────────────────────────────────────

/**
 * Player primary/secondary position per entity-identity S2.1.
 */
export type PositionEnum =
  | 'GK'
  | 'CB'
  | 'LB'
  | 'RB'
  | 'CDM'
  | 'CM'
  | 'CAM'
  | 'LM'
  | 'RM'
  | 'LW'
  | 'RW'
  | 'CF'
  | 'ST';

/**
 * Coarse position group for reconciliation key (S3.3).
 */
export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD';

// ── Coach role (S2.2) ─────────────────────────────────────────────────────

export type CoachRoleEnum = 'HEAD_COACH' | 'ASSISTANT_COACH' | 'INTERIM_COACH';

// ── Affiliation type (S5.1) ───────────────────────────────────────────────

export type AffiliationType = 'permanent' | 'loan' | 'free_agent';

// ── Provider ID mapping (S3.4) ────────────────────────────────────────────

/**
 * A single provider ID entry in a canonical entity's mapping.
 * Once associated, never removed — only marked superseded (S10.8).
 */
export interface ProviderIdEntry {
  readonly source: SourceId;
  readonly providerId: string;
  readonly superseded: boolean;
  readonly supersededAt?: string;   // ISO-8601 UTC, present only when superseded
  readonly supersededReason?: string;
}

// ── Canonical Player (S2.1, S3.1, S3.4) ──────────────────────────────────

/**
 * A resolved canonical player entity.
 *
 * `canonicalPlayerId` follows the format:
 *   - RESOLVED:   player:canonical:{deterministicHash}
 *   - PARTIAL:    player:{source}:{providerId}
 *   - UNRESOLVED: player:{primarySource}:{id}
 *   - CONFLICTED: player:{primarySource}:{id}
 *
 * `externalIds` maps source names to provider IDs for the resolved entity.
 * Empty for PARTIAL/UNRESOLVED/CONFLICTED (only the primary ID is known).
 *
 * Note: `resolution` of UNRESOLVED or CONFLICTED means this entity's features
 * are excluded from the prediction input vector (S9.1).
 */
export interface CanonicalPlayer {
  readonly canonicalPlayerId: string;
  readonly resolution: ResolutionState;
  /**
   * Maps source shorthand to the provider ID string.
   * Example: { 'api-football': '874', 'sofascore': '24629' }
   * Present and populated for RESOLVED entities; may be empty for PARTIAL.
   */
  readonly externalIds: Readonly<Record<string, string>>;
  readonly displayName: string;
  readonly normalizedName: string;
  readonly dateOfBirth: string | null;
  readonly primaryPosition: PositionEnum | null;
  readonly secondaryPosition: PositionEnum | null;
  readonly nationality: string | null; // ISO 3166-1 alpha-3
}

// ── Canonical Coach (S2.2, S6.1) ─────────────────────────────────────────

export interface CanonicalCoach {
  readonly canonicalCoachId: string;
  readonly resolution: ResolutionState;
  readonly externalIds: Readonly<Record<string, string>>;
  readonly displayName: string;
  readonly normalizedName: string;
  readonly role: CoachRoleEnum;
}

// ── Club affiliation (S5.1, S5.2) ────────────────────────────────────────

/**
 * A single club affiliation period for a player.
 *
 * The temporal belonging rule (S5.2): player belongs to team at buildNowUtc T
 * if `from <= T AND (to === null OR to > T)` — closed-open interval [from, to).
 */
export interface ClubAffiliation {
  readonly teamId: string;          // canonicalTeamId
  readonly from: string;            // ISO-8601 UTC
  readonly to: string | null;       // null = current affiliation
  readonly type: AffiliationType;
}

// ── Player availability (S8.1, S8.2) ─────────────────────────────────────

/**
 * Player availability for a specific match at a given buildNowUtc.
 *
 * This is a feature in NEXUS-0, not an identity attribute (S8.2).
 * The spec governs temporal semantics (as-of constraint) of this data.
 *
 * INVARIANT: "We don't know" (UNKNOWN) ≠ "available" (CONFIRMED_AVAILABLE).
 * The model must not assume a player is available when state = UNKNOWN (S8.3).
 */
export interface PlayerAvailability {
  readonly canonicalPlayerId: string;
  readonly availability: AvailabilityState;
  /**
   * Structured absence reason when availability = CONFIRMED_ABSENT.
   * Null for other states.
   */
  readonly absenceReason: string | null;
  /**
   * Expected return date for injuries (when available).
   * ISO-8601 date. Null if unknown or not applicable.
   */
  readonly expectedReturnDate: string | null;
}

// ── Baseline squad (S8.1, S8.3) ──────────────────────────────────────────

/**
 * The effective squad used for a team in a prediction.
 *
 * Formula per spec S8.3:
 *   effective_squad = baseline_players - confirmed_absences + confirmed_lineup (if available)
 *
 * When confirmed_lineup is null (not yet published), the model uses
 * baseline_players minus confirmed_absences as the best estimate.
 *
 * INVARIANT: Lineups are never inferred or predicted (NEXUS-0 S4.4, S6.2.4).
 * If the confirmed lineup is not available at buildNowUtc, confirmed_lineup = null.
 */
export interface BaselineSquad {
  readonly teamId: string;
  readonly baselinePlayers: readonly CanonicalPlayer[];
  readonly confirmedAbsences: readonly CanonicalPlayer[];
  /**
   * Null if the confirmed lineup is not available at buildNowUtc.
   * Non-null when the official team sheet is published (typically ~60min
   * before kickoff — NEXUS-0 S4.4, S6.2.4).
   */
  readonly confirmedLineup: readonly CanonicalPlayer[] | null;
}

/**
 * Compute the effective squad from a BaselineSquad.
 *
 * Per spec S8.3:
 * - If confirmedLineup is available: use it directly (it supersedes all absences).
 * - Otherwise: baseline_players minus confirmed_absences.
 *
 * Returns a readonly array of CanonicalPlayer.
 */
export function computeEffectiveSquad(
  squad: BaselineSquad,
): readonly CanonicalPlayer[] {
  if (squad.confirmedLineup !== null) {
    return squad.confirmedLineup;
  }

  const absentIds = new Set(
    squad.confirmedAbsences.map((p) => p.canonicalPlayerId),
  );

  return squad.baselinePlayers.filter(
    (p) => !absentIds.has(p.canonicalPlayerId),
  );
}

// ── Resolution state change event (S7.2) ─────────────────────────────────

/**
 * Append-only log event for resolution state transitions.
 * All transitions are logged — no silent state changes (S7.2).
 */
export type ResolutionTrigger = 'automatic-match' | 'manual-override' | 'new-data-arrival';

export interface ResolutionStateChangeEvent {
  readonly entityId: string;
  readonly oldState: ResolutionState;
  readonly newState: ResolutionState;
  readonly trigger: ResolutionTrigger;
  readonly timestamp: string; // ISO-8601 UTC
  readonly notes?: string;
}

// ── Matching tier (S4.4) ──────────────────────────────────────────────────

/**
 * The tier used in automatic entity matching (S4.4).
 * Tier 1 = highest confidence. Tier 3 = low confidence, flagged for review.
 * NONE = no match found.
 */
export type MatchTier = 1 | 2 | 3 | 'NONE';

// ── Constants (S6.3) ─────────────────────────────────────────────────────

/**
 * Minimum coach tenure (competitive matches) before tactical features have
 * reasonable confidence per S6.3.
 */
export const INTERIM_TACTICAL_CONFIDENCE_THRESHOLD = 3;

/**
 * Default weight for a player in DOUBT availability state (S8.3).
 */
export const DOUBT_WEIGHT = 0.5;

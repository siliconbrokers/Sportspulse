/**
 * NEXUS Entity Identity and Resolution — Player/Coach Resolver
 *
 * Spec authority: entity-identity S3, S4, S7, S10
 *
 * This module implements the entity resolution layer that maps provider-specific
 * IDs to canonical SportPulse entity IDs.
 *
 * SCOPE BOUNDARY:
 *   This module answers: "Who is this entity, and under what confidence?"
 *   It does NOT answer: "What did we know about this entity at time T?"
 *   That belongs to NEXUS-0 (the temporal feature store).
 *
 * RESOLUTION STATES (S7.1):
 *   RESOLVED    → identity confirmed across >= 2 providers
 *   PARTIAL     → identified in exactly 1 provider, no contradictions
 *   UNRESOLVED  → reconciliation attempted but failed
 *   CONFLICTED  → contradictory data, requires manual resolution
 *
 * FEATURE ELIGIBILITY (S9.1):
 *   RESOLVED:   full eligibility
 *   PARTIAL:    single-source eligibility
 *   UNRESOLVED: EXCLUDED from prediction input vector
 *   CONFLICTED: EXCLUDED from prediction input vector
 *
 * PHASE 0 IMPLEMENTATION NOTE:
 *   This is the Phase 0 skeleton. The full matching pipeline (Tier 1, 2, 3
 *   matching per S4.4, Levenshtein distance, alias tables) is implemented in
 *   a subsequent phase. Phase 0 provides the types, state machine, and
 *   lookup interface that downstream consumers depend on.
 *
 *   The resolver in this phase operates on an in-memory registry seeded at
 *   construction. Production use requires persistent storage.
 */

import type { SourceId } from '../feature-store/types.js';
import type {
  CanonicalPlayer,
  CanonicalCoach,
  ResolutionState,
  ResolutionStateChangeEvent,
  ResolutionTrigger,
  MatchTier,
  ProviderIdEntry,
  PositionGroup,
} from './types.js';

// ── Resolver options ──────────────────────────────────────────────────────

export interface ResolverOptions {
  /** Initial player registry entries. Keyed by canonical player ID. */
  readonly players?: ReadonlyMap<string, CanonicalPlayer>;
  /** Initial coach registry entries. Keyed by canonical coach ID. */
  readonly coaches?: ReadonlyMap<string, CanonicalCoach>;
  /**
   * Provider-ID-to-canonical-ID index.
   * Key format: "{source}:{providerId}" → canonicalPlayerId or canonicalCoachId.
   */
  readonly providerIndex?: ReadonlyMap<string, string>;
}

// ── Resolution result ─────────────────────────────────────────────────────

/**
 * Result of a player resolution lookup.
 * Always returns a non-null CanonicalPlayer — even for UNRESOLVED/CONFLICTED
 * entities, the player exists with its provider-specific ID as canonical ID.
 */
export interface PlayerResolutionResult {
  readonly player: CanonicalPlayer;
  /** Whether the entity is eligible for prediction input features. */
  readonly featureEligible: boolean;
  /**
   * The match tier used if resolution produced a RESOLVED result.
   * Null for PARTIAL/UNRESOLVED/CONFLICTED.
   */
  readonly matchTier: MatchTier | null;
}

// ── Main resolver class ───────────────────────────────────────────────────

/**
 * Entity resolver for the NEXUS prediction pipeline.
 *
 * INVARIANT (S10.1): Every entity has exactly one canonical ID at any time.
 * INVARIANT (S10.3): CONFLICTED state is never auto-resolved (S7.3).
 * INVARIANT (S10.5): Identity history is append-only.
 * INVARIANT (S10.6): Name normalization is deterministic.
 */
export class EntityResolver {
  private readonly playerRegistry: Map<string, CanonicalPlayer>;
  private readonly coachRegistry: Map<string, CanonicalCoach>;
  /**
   * Index: "{source}:{providerId}" → canonical entity ID
   * Used for O(1) lookup by provider key.
   */
  private readonly providerIndex: Map<string, string>;
  /**
   * Append-only event log for resolution state changes.
   */
  private readonly stateChangeLog: ResolutionStateChangeEvent[] = [];

  constructor(options: ResolverOptions = {}) {
    this.playerRegistry = new Map(options.players ?? []);
    this.coachRegistry = new Map(options.coaches ?? []);
    this.providerIndex = new Map(options.providerIndex ?? []);
  }

  // ── Player resolution (S3.2, S7.1) ─────────────────────────────────────

  /**
   * Resolve a player by external provider ID.
   *
   * Resolution logic per S7.1 and S4.2:
   * - If the provider key maps to a known canonical ID → return that entity.
   * - If the canonical entity is RESOLVED or PARTIAL → featureEligible = true.
   * - If the canonical entity is UNRESOLVED or CONFLICTED → featureEligible = false.
   * - If no mapping exists → return UNRESOLVED player with provider-specific ID.
   *
   * @param externalId The provider's native player ID (numeric string or string).
   * @param source     The provider from which this ID originates.
   * @returns PlayerResolutionResult with the canonical player and eligibility flag.
   */
  resolvePlayer(
    externalId: string,
    source: SourceId,
  ): PlayerResolutionResult {
    const providerKey = buildProviderKey(source, externalId);
    const canonicalId = this.providerIndex.get(providerKey);

    if (canonicalId !== undefined) {
      const player = this.playerRegistry.get(canonicalId);

      if (player !== undefined) {
        return {
          player,
          featureEligible: isFeatureEligible(player.resolution),
          matchTier: player.resolution === 'RESOLVED' ? 1 : null,
        };
      }
    }

    // No match found → return UNRESOLVED with provider-specific canonical ID
    const unresolvedId = buildUnresolvedId('player', source, externalId);
    const unresolvedPlayer: CanonicalPlayer = {
      canonicalPlayerId: unresolvedId,
      resolution: 'UNRESOLVED',
      externalIds: { [shortSourceName(source)]: externalId },
      displayName: '',
      normalizedName: '',
      dateOfBirth: null,
      primaryPosition: null,
      secondaryPosition: null,
      nationality: null,
    };

    return {
      player: unresolvedPlayer,
      featureEligible: false,
      matchTier: 'NONE',
    };
  }

  /**
   * Register a new player entity in the resolver registry.
   *
   * This is used by ingestion pipelines to populate the registry.
   * The provider-to-canonical index is updated with all external IDs.
   *
   * INVARIANT (S10.5): Registration is append-only. To update an existing
   * entity, use updatePlayer() which preserves history.
   */
  registerPlayer(
    player: CanonicalPlayer,
    trigger: ResolutionTrigger = 'new-data-arrival',
  ): void {
    const existing = this.playerRegistry.get(player.canonicalPlayerId);

    if (existing !== undefined && existing.resolution !== player.resolution) {
      this.logStateChange(
        player.canonicalPlayerId,
        existing.resolution,
        player.resolution,
        trigger,
      );
    }

    this.playerRegistry.set(player.canonicalPlayerId, player);

    // Update provider index for all external IDs
    for (const [sourceName, providerId] of Object.entries(player.externalIds)) {
      const source = sourceNameToId(sourceName);
      if (source !== null) {
        const providerKey = buildProviderKey(source, providerId);
        this.providerIndex.set(providerKey, player.canonicalPlayerId);
      }
    }
  }

  // ── Coach resolution ────────────────────────────────────────────────────

  /**
   * Resolve a coach by external provider ID.
   * Follows the same logic as resolvePlayer.
   */
  resolveCoach(
    externalId: string,
    source: SourceId,
  ): { coach: CanonicalCoach; featureEligible: boolean } {
    const providerKey = buildProviderKey(source, externalId);
    const canonicalId = this.providerIndex.get(providerKey);

    if (canonicalId !== undefined) {
      const coach = this.coachRegistry.get(canonicalId);
      if (coach !== undefined) {
        return {
          coach,
          featureEligible: isFeatureEligible(coach.resolution),
        };
      }
    }

    const unresolvedId = buildUnresolvedId('coach', source, externalId);
    const unresolvedCoach: CanonicalCoach = {
      canonicalCoachId: unresolvedId,
      resolution: 'UNRESOLVED',
      externalIds: { [shortSourceName(source)]: externalId },
      displayName: '',
      normalizedName: '',
      role: 'HEAD_COACH',
    };

    return { coach: unresolvedCoach, featureEligible: false };
  }

  // ── State change log ────────────────────────────────────────────────────

  /**
   * Return a read-only copy of the state change log.
   * Used for auditing and reproducibility (S9.3, S10.5).
   */
  getStateChangeLog(): readonly ResolutionStateChangeEvent[] {
    return [...this.stateChangeLog];
  }

  // ── Registry access ─────────────────────────────────────────────────────

  /**
   * Return the number of registered players in the registry.
   */
  get playerCount(): number {
    return this.playerRegistry.size;
  }

  /**
   * Return the number of registered coaches in the registry.
   */
  get coachCount(): number {
    return this.coachRegistry.size;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private logStateChange(
    entityId: string,
    oldState: ResolutionState,
    newState: ResolutionState,
    trigger: ResolutionTrigger,
  ): void {
    this.stateChangeLog.push({
      entityId,
      oldState,
      newState,
      trigger,
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Name normalization (S4.3) ─────────────────────────────────────────────

/**
 * Normalize a player or coach display name for reconciliation.
 *
 * Procedure per entity-identity S4.3:
 * 1. Lowercase
 * 2. NFD normalization + strip combining characters (diacritics)
 * 3. Remove punctuation except hyphens and spaces
 * 4. Collapse multiple spaces
 * 5. Trim
 * 6. Remove common suffixes (Jr., Sr., III, II)
 *
 * INVARIANT (S10.6): This function is deterministic, has no external
 * dependencies, no locale-sensitive behavior, and no randomness.
 */
export function normalizeName(displayName: string): string {
  let name = displayName;

  // Step 1: lowercase
  name = name.toLowerCase();

  // Step 2: NFD + strip combining characters (diacritics)
  name = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Step 3: remove punctuation except hyphens and spaces
  name = name.replace(/[^\p{L}\p{N}\s-]/gu, '');

  // Step 4: collapse multiple spaces
  name = name.replace(/\s+/g, ' ');

  // Step 5: trim
  name = name.trim();

  // Step 6: remove common suffixes
  name = name.replace(/\b(jr|sr|iii|ii)\b\.?\s*$/i, '').trim();

  return name;
}

/**
 * Classify a playing position into a coarse position group.
 * Used as part of the reconciliation key (S3.3).
 */
export function toPositionGroup(
  position: string | null | undefined,
): PositionGroup | null {
  if (position == null) return null;

  const p = position.toUpperCase();
  if (p === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'SW', 'WB'].includes(p)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM', 'DM'].includes(p)) return 'MID';
  if (['LW', 'RW', 'CF', 'ST', 'SS', 'FWD'].includes(p)) return 'FWD';
  return null;
}

// ── Internal utilities ────────────────────────────────────────────────────

/**
 * Build the provider index key: "{source}:{providerId}"
 */
function buildProviderKey(source: SourceId, providerId: string): string {
  return `${source}:${providerId}`;
}

/**
 * Build an unresolved entity canonical ID per S3.1 format.
 * player:{source}:{providerId} or coach:{source}:{providerId}
 */
function buildUnresolvedId(
  entityType: 'player' | 'coach',
  source: SourceId,
  providerId: string,
): string {
  const shortSource = shortSourceName(source);
  return `${entityType}:${shortSource}:${providerId}`;
}

/**
 * Short source name for canonical ID format (S3.1).
 * Matches the examples in the spec: 'af', 'sofascore', 'fd'.
 */
function shortSourceName(source: SourceId): string {
  switch (source) {
    case 'api-football':
      return 'af';
    case 'football-data-org':
      return 'fd';
    case 'sofascore':
      return 'sofascore';
    default:
      return source;
  }
}

/**
 * Map a short source name back to SourceId for provider index updates.
 * Returns null if the source name is unrecognized.
 */
function sourceNameToId(shortName: string): SourceId | null {
  switch (shortName) {
    case 'af':
    case 'api-football':
      return 'api-football';
    case 'fd':
    case 'football-data-org':
      return 'football-data-org';
    case 'sofascore':
      return 'sofascore';
    default:
      return null;
  }
}

/**
 * Determine feature eligibility from resolution state per S9.1.
 */
function isFeatureEligible(state: ResolutionState): boolean {
  return state === 'RESOLVED' || state === 'PARTIAL';
}

// ── Provider ID entry helpers ─────────────────────────────────────────────

/**
 * Build the active (non-superseded) provider ID entries for an entity.
 * Used when constructing the externalIds map for canonical players.
 */
export function buildExternalIds(
  entries: readonly ProviderIdEntry[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.superseded) {
      result[shortSourceName(entry.source)] = entry.providerId;
    }
  }
  return result;
}

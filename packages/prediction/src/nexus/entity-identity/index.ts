/**
 * NEXUS Entity Identity and Resolution — Public API
 *
 * Spec authority: entity-identity-and-resolution.md
 *
 * This barrel exports the public surface of the entity identity module.
 * Internal implementation details are not re-exported.
 *
 * DO NOT import from this barrel in V3 engine code. NEXUS has its own
 * module boundary (master spec S8.5, S8.4).
 */

// Core types
export type {
  ResolutionState,
  AvailabilityState,
  PositionEnum,
  PositionGroup,
  CoachRoleEnum,
  AffiliationType,
  ProviderIdEntry,
  CanonicalPlayer,
  CanonicalCoach,
  ClubAffiliation,
  PlayerAvailability,
  BaselineSquad,
  ResolutionStateChangeEvent,
  ResolutionTrigger,
  MatchTier,
} from './types.js';

// computeEffectiveSquad — core squad derivation formula
export { computeEffectiveSquad } from './types.js';

// Constants
export {
  INTERIM_TACTICAL_CONFIDENCE_THRESHOLD,
  DOUBT_WEIGHT,
} from './types.js';

// Resolver
export {
  EntityResolver,
  normalizeName,
  toPositionGroup,
  buildExternalIds,
} from './resolver.js';

export type {
  PlayerResolutionResult,
  ResolverOptions,
} from './resolver.js';

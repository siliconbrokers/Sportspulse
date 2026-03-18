/**
 * NEXUS Temporal Feature Store — Public API
 *
 * Spec authority: NEXUS-0 (nexus-0-temporal-feature-store.md)
 *
 * This barrel exports only the public surface of the feature store module.
 * Internal helpers are NOT re-exported from here.
 *
 * DO NOT import from this barrel in V3 engine code. NEXUS has its own
 * module boundary. V3 and NEXUS must not share mutable runtime state
 * (master spec S8.5).
 */

// Core types
export type {
  SourceId,
  MissingValue,
  FeatureConfidence,
  FeatureProvenance,
  FeatureValue,
  FeatureSnapshot,
  DerivedFeatureProvenance,
  DataQualityTier,
  FeatureConflictEvent,
  XgMatchData,
} from './types.js';

// The MISSING sentinel (not just the type)
export { MISSING } from './types.js';

// Constants
export {
  FRESHNESS_THRESHOLDS_SECONDS,
  XG_PARTIAL_COVERAGE_THRESHOLD,
} from './types.js';

// Anti-lookahead guard
export {
  applyAntiLookaheadGuard,
  assertNoLookahead,
  collectViolations,
  TemporalLeakageError,
} from './anti-lookahead.js';

export type {
  AntiLookaheadResult,
  FeatureLookaheadViolation,
} from './anti-lookahead.js';

// xG feature integration
export {
  AF_LEAGUE_IDS,
  AF_LEAGUE_ID_TO_CODE,
  loadXgFeature,
  computeXgCoverage,
  extractTeamXg,
} from './xg-features.js';

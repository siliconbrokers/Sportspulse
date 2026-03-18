/**
 * index.ts — NEXUS Track 3: public API.
 *
 * Exports all public types and functions for consumers.
 * Meta-ensemble and evaluation layers depend on Track3Output from this module.
 *
 * BOUNDARY RULES (master spec S8.4, S8.5):
 *   - Track 3 does NOT re-export anything from engine/v3/.
 *   - Track 3 does NOT re-export V3 Elo or Poisson internals.
 *   - Track 3 is isolated: only its own types + Track 1 HistoricalMatch type.
 *
 * @module nexus/track3
 */

// ── Types ───────────────────────────────────────────────────────────────────
export type {
  SeasonPhase,
  CompetitiveImportance,
  Track3FeatureVector,
  Track3Confidence,
  Track3Output,
} from './types.js';

// ── Context feature extractors ──────────────────────────────────────────────
export {
  computeRestDays,
  computeMatchesLast4Weeks,
  computeFormGeneral,
  computeFormSplit,
  computeH2hFeatures,
  deriveCompetitiveImportance,
  deriveSeasonPhase,
  computeMatchImportanceScore,
  buildTrack3FeatureVector,
} from './context-features.js';
export type { H2hFeatures } from './context-features.js';

// ── Logistic model ───────────────────────────────────────────────────────────
export {
  predictLogistic,
  DEFAULT_LOGISTIC_WEIGHTS,
} from './logistic-model.js';
export type { LogisticWeights } from './logistic-model.js';

// ── Track 3 engine ───────────────────────────────────────────────────────────
export {
  computeTrack3,
  CONTEXT_MODEL_VERSION,
  FEATURE_SCHEMA_VERSION,
} from './track3-engine.js';

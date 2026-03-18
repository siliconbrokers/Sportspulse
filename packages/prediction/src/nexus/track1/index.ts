/**
 * index.ts — NEXUS Track 1: public API.
 *
 * Re-exports all public types and functions for consumers.
 * Track 2 and Track 3 depend on Track1Output from this module.
 *
 * @module nexus/track1
 */

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  HistoricalMatch,
  LeagueHomeAdvantageConfig,
  AdaptiveKConfig,
  Track1TeamStrength,
  Track1Output,
} from './types.js';

// ── Home advantage ─────────────────────────────────────────────────────────
export {
  estimateHomeAdvantage,
  MIN_SAMPLE_SIZE_FOR_EMPIRICAL,
  DEFAULT_HOME_ADVANTAGES,
  GLOBAL_HOME_ADVANTAGE_DEFAULT,
} from './home-advantage.js';

// ── Adaptive K-factor ──────────────────────────────────────────────────────
export {
  computeAdaptiveK,
  computeAdaptiveKWithContext,
  DEFAULT_ADAPTIVE_K_CONFIG,
  K_CONTEXT_MULTIPLIERS,
} from './adaptive-k.js';
export type { KContextType } from './adaptive-k.js';

// ── Track 1 engine ─────────────────────────────────────────────────────────
export { computeTrack1 } from './track1-engine.js';
export type { Phase1bOptions } from './track1-engine.js';

// ── Phase 1B: Injury impact ────────────────────────────────────────────────
export { computeInjuryImpact, DEFAULT_POSITION_IMPACT_WEIGHTS, MAX_ABSENCE_ADJUSTMENT } from './injury-impact.js';
export type { PlayerAbsence, InjuryImpactResult } from './injury-impact.js';

// ── Phase 1B: Lineup adjuster ──────────────────────────────────────────────
export { computeLineupAdjustment } from './lineup-adjuster.js';
export type { LineupAdjustmentResult } from './lineup-adjuster.js';

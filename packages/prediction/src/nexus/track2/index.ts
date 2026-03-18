/**
 * index.ts — NEXUS Track 2: Goals Model public API.
 *
 * Re-exports all public types and functions for consumers.
 * Track 2 depends on Track1Output from nexus/track1.
 *
 * Spec authority: taxonomy spec S4.
 *
 * @module nexus/track2
 */

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  Track2Input,
  Track2Output,
  DixonColesParams,
} from './types.js';

export {
  MAX_GOALS,
  DEFAULT_RHO,
  LAMBDA_MIN,
  LAMBDA_MAX,
  AWAY_HA_FACTOR,
  OVER_THRESHOLDS,
  SCORELINE_SUM_TOLERANCE,
  GOALS_MODEL_VERSION,
} from './types.js';

// ── Core functions ─────────────────────────────────────────────────────────
export {
  computeLambdas,
  poissonProb,
  buildGoalsMatrix,
  dixonColesCorrectionFactor,
  getRhoForLeague,
  deriveTrack2Output,
} from './poisson-goals.js';

export type { GoalsMatrixResult } from './poisson-goals.js';

// ── Engine entry point ─────────────────────────────────────────────────────
export {
  computeTrack2,
  computeTrack2FromInput,
} from './track2-engine.js';

/**
 * NEXUS Predictive Engine (PE v2) — Package Root
 *
 * Spec authority: spec.sportpulse.prediction-engine-v2.master.md
 *
 * NEXUS is a challenger engine running in shadow mode alongside V3.
 * This barrel exports the Phase 0 contracts only.
 *
 * BOUNDARY RULES (master S8.4, S8.5):
 * - NEXUS modules must NOT be imported by V3 engine code.
 * - V3 and NEXUS share only immutable canonical data and buildNowUtc.
 * - NEXUS internals (feature store, entity registry) are logically separate.
 */

// Phase 0: Temporal Feature Store (NEXUS-0)
export * from './feature-store/index.js';

// Track 1: Structural/Ratings Model (taxonomy spec S3)
export * from './track1/index.js';

// Track 2: Goals Model — Bivariate Poisson + Dixon-Coles (taxonomy spec S4)
export * from './track2/index.js';

// Phase 0: Entity Identity and Resolution (master S6.2)
export * from './entity-identity/index.js';

// Track 4: Market Signal — Raw Odds Store + Canonical Serving View (MSP, MTE S6)
export * from './odds/index.js';

// Phase 3: Meta-Ensemble with Learned Weights (taxonomy spec S7–S8)
export * from './ensemble/index.js';

// Phase 4: Scorecard Infrastructure (evaluation-and-promotion spec S5)
export * from './scorecards/index.js';

// Phase 5: Promotion Gate + Swap (evaluation-and-promotion spec S6–S8)
export * from './promotion/index.js';

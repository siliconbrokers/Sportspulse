/**
 * nexus/scorecards — NEXUS Scorecard Infrastructure Barrel
 *
 * Spec authority: evaluation-and-promotion spec S5.
 *
 * Exports:
 *   - types: ScorecardType, ScorecardEntry, NexusScorecard
 *   - scorecard-store: appendScorecardEntry, loadScorecard, computeRps
 *   - scorecard-aggregator: buildCombinedScorecard
 *
 * @module nexus/scorecards
 */

export type { ScorecardType, ScorecardEntry, NexusScorecard } from './types.js';
export { appendScorecardEntry, loadScorecard, computeRps } from './scorecard-store.js';
export { buildCombinedScorecard } from './scorecard-aggregator.js';

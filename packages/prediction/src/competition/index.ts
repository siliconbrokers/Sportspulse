/**
 * Competition Engine — public surface.
 *
 * Phase 3 implementation. Exports:
 *   - standings.ts: computeStandings (§5.2, §8.2)
 *   - group-ranking.ts: rankGroup, computeBestThirds (§18.3, §7.7)
 *   - knockout-resolver.ts: resolveKnockout (§8.4, §18.2)
 *   - bracket-mapper.ts: mapToBracket (§8.3, §18.3)
 *
 * All types exported for use by tests and potential callers within the
 * prediction package. No cross-package export needed at this stage.
 */

// ── Standings ────────────────────────────────────────────────────────────────
export { computeStandings, computeH2HSubtable } from './standings.js';
export type { MatchResult, StandingEntry, StandingsResult, ResolutionGap } from './standings.js';

// ── Group ranking ─────────────────────────────────────────────────────────────
export { rankGroup, computeBestThirds } from './group-ranking.js';
export type {
  GroupData,
  RankedTeam,
  BestThirdEntry,
  GroupResult,
  GroupRankingResult,
  BestThirdsResult,
} from './group-ranking.js';

// ── Knockout resolver ────────────────────────────────────────────────────────
export { resolveKnockout } from './knockout-resolver.js';
export type {
  LegScore,
  AggregateState,
  KnockoutMatchData,
  KnockoutWinner,
  ResolutionStep,
  KnockoutResolutionResult,
} from './knockout-resolver.js';

// ── Bracket mapper ───────────────────────────────────────────────────────────
export { mapToBracket } from './bracket-mapper.js';
export type { TeamQualification, BracketSlot, BracketMapResult } from './bracket-mapper.js';

// ── Competition profiles (catalog) ───────────────────────────────────────────
export {
  CA_GROUP_RANKING_RULES,
  CA_QUALIFICATION_RULES,
  CA_TIE_BREAK_RULES,
  CA_KNOCKOUT_RESOLUTION_RULES,
  CA_GROUP_STAGE_PROFILE,
  CA_KNOCKOUT_PROFILE,
} from './profiles/copa-america.js';

/**
 * knockout-resolver.ts — Knockout match resolution (single-leg and two-leg).
 *
 * Spec authority: §5.2 (Competition Engine), §7.3 (SECOND_LEG guard),
 *                 §8.2 (KnockoutResolutionRules), §8.3 (consistency rules),
 *                 §8.4 (ordered sequence application), §18.2 (ida/vuelta)
 *
 * CRITICAL INVARIANTS (§8.4, system prompt):
 *   1. KnockoutResolutionRules is an ORDERED ARRAY. Applied strictly in order.
 *   2. ORGANIZER_DEFINED, if present, is always the last step — resolution
 *      engine yields UNDECIDED (external outcome required).
 *   3. SECOND_LEG requires aggregate_state_before_match. Missing → BLOCKED.
 *   4. Same match state + same rules → identical result (determinism).
 *   5. No implicit tournament logic from match IDs or competition names.
 *
 * AWAY_GOALS note: AWAY_GOALS_AFTER_90 only applies when it appears in
 * second_leg_resolution_order. Never inferred. §8.4
 */

import type {
  KnockoutResolutionRules,
  LegType,
  FormatType,
} from '../contracts/types/competition-profile.js';
import type { ResolutionGap } from './standings.js';

// ── Domain types ─────────────────────────────────────────────────────────────

/**
 * Scores for one leg of a tie.
 * home/away here refer to the team designated as home/away in THAT specific
 * leg, not the overall "home" team of the tie. Callers must track this.
 */
export interface LegScore {
  home_score: number;
  away_score: number;
}

/**
 * Aggregate state entering the second leg.
 * Mirrors CompetitionProfile.aggregate_state_before_match (§7.3, §8.1).
 */
export interface AggregateState {
  /** Goals scored by the team playing at home in the SECOND leg across the first leg. */
  home_aggregate_goals: number;
  /** Goals scored by the team playing away in the SECOND leg across the first leg. */
  away_aggregate_goals: number;
}

/**
 * All data about a knockout match needed for resolution.
 */
export interface KnockoutMatchData {
  match_id: string;
  format_type: FormatType;
  leg_type: LegType;
  /** Score of the current match (null if unplayed / result not yet available). */
  current_leg_score: LegScore | null;
  /**
   * Required when leg_type = SECOND_LEG.
   * Represents scores from the first leg, from the perspective of the team
   * playing AT HOME in the second leg.
   * Spec §7.3, §8.1, §18.2
   */
  aggregate_state_before_match: AggregateState | null;
  knockout_resolution_rules: KnockoutResolutionRules | null;
}

/** Who advances after resolving the knockout tie. */
export type KnockoutWinner = 'HOME' | 'AWAY';

/**
 * The resolution step that decided the outcome.
 * Mirrors the spec's ordered step values from §8.2.
 */
export type ResolutionStep =
  | 'AGGREGATE_SCORE'
  | 'AWAY_GOALS_AFTER_90'
  | 'EXTRA_TIME'
  | 'PENALTIES'
  | 'REPLAY'
  | 'ORGANIZER_DEFINED';

/**
 * The result of knockout resolution.
 *
 * RESOLVED: a clear winner was determined.
 * UNDECIDED: the match is in progress, not yet played, or ORGANIZER_DEFINED
 *   was reached (external outcome required).
 * BLOCKED: a required field is missing — cannot proceed.
 * DEGRADED: resolved but with warnings (e.g., partial data was used).
 */
export type KnockoutResolutionResult =
  | {
      status: 'RESOLVED';
      winner: KnockoutWinner;
      decided_by: ResolutionStep;
    }
  | {
      status: 'UNDECIDED';
      reason: 'MATCH_NOT_YET_PLAYED' | 'ORGANIZER_DEFINED_REQUIRED' | 'TIED_NO_FURTHER_RULE';
    }
  | { status: 'BLOCKED'; gap: ResolutionGap }
  | {
      status: 'DEGRADED';
      winner: KnockoutWinner;
      decided_by: ResolutionStep;
      warnings: string[];
    };

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Resolve a knockout match according to the configured rule sequence.
 *
 * Rule §8.4: "el orden de los elementos define precedencia normativa."
 * We iterate second_leg_resolution_order / single_leg_resolution_order in
 * strict array order. Each step either decides the winner or falls through.
 *
 * Spec §8.3, §8.4, §18.2
 */
export function resolveKnockout(
  match: KnockoutMatchData,
  rules: KnockoutResolutionRules,
): KnockoutResolutionResult {
  // Guard: current score must be available to resolve anything.
  if (match.current_leg_score === null) {
    return { status: 'UNDECIDED', reason: 'MATCH_NOT_YET_PLAYED' };
  }

  if (match.format_type === 'KNOCKOUT_TWO_LEG') {
    return resolveTwoLeg(match, rules);
  }

  if (match.format_type === 'KNOCKOUT_SINGLE_LEG') {
    return resolveSingleLeg(match, rules);
  }

  // Non-knockout format_type passed to this function.
  return {
    status: 'BLOCKED',
    gap: {
      missingFields: ['format_type (must be KNOCKOUT_TWO_LEG or KNOCKOUT_SINGLE_LEG)'],
      requiredByRule: 'resolveKnockout',
      specSection: '§8.4',
      canFallbackToSimulation: false,
    },
  };
}

// ── Two-leg resolution ───────────────────────────────────────────────────────

/**
 * Resolve a two-legged tie.
 *
 * For FIRST_LEG: no resolution is possible (the tie is not complete).
 * For SECOND_LEG: compute aggregate and apply resolution order.
 * For SINGLE (both legs played but leg_type=SINGLE): treat as single-leg.
 *
 * Spec §18.2, §8.4
 */
function resolveTwoLeg(
  match: KnockoutMatchData,
  rules: KnockoutResolutionRules,
): KnockoutResolutionResult {
  if (match.leg_type === 'FIRST_LEG') {
    // First leg finished — tie is incomplete. §18.2
    return { status: 'UNDECIDED', reason: 'MATCH_NOT_YET_PLAYED' };
  }

  if (match.leg_type === 'SECOND_LEG') {
    // §7.3 guard: aggregate_state_before_match is MANDATORY for SECOND_LEG.
    if (!match.aggregate_state_before_match) {
      return {
        status: 'BLOCKED',
        gap: {
          missingFields: ['aggregate_state_before_match'],
          requiredByRule: 'SECOND_LEG requires aggregate_state_before_match per §7.3',
          specSection: '§7.3',
          canFallbackToSimulation: false,
        },
      };
    }

    const agg = match.aggregate_state_before_match;
    const leg2 = match.current_leg_score!;

    // Compute aggregate totals.
    // agg.home_aggregate_goals = goals by the "home" team in the 2nd leg over leg 1.
    // leg2.home_score = goals by the home team in the 2nd leg (now).
    const totalHome = agg.home_aggregate_goals + leg2.home_score;
    const totalAway = agg.away_aggregate_goals + leg2.away_score;

    // Step 1: Aggregate score decides immediately if not level.
    if (totalHome > totalAway) {
      return { status: 'RESOLVED', winner: 'HOME', decided_by: 'AGGREGATE_SCORE' };
    }
    if (totalAway > totalHome) {
      return { status: 'RESOLVED', winner: 'AWAY', decided_by: 'AGGREGATE_SCORE' };
    }

    // Aggregate is level — apply second_leg_resolution_order.
    const resolutionOrder = rules.second_leg_resolution_order;
    if (!resolutionOrder || resolutionOrder.length === 0) {
      // No rules to break the tie.
      return { status: 'UNDECIDED', reason: 'TIED_NO_FURTHER_RULE' };
    }

    // §8.4: iterate strictly in order.
    for (const step of resolutionOrder) {
      switch (step) {
        case 'AWAY_GOALS_AFTER_90': {
          // Away goals: count goals scored away by each team across both legs.
          // Team playing AWAY in leg 2 scored agg.home_aggregate_goals in leg 1
          // (they were the away team then). In leg 2 they are away, scoring leg2.away_score.
          // Team playing HOME in leg 2 scored agg.away_aggregate_goals in leg 1 as home.
          //
          // Away goals for HOME team (2nd leg) = goals scored in the away leg (leg 1):
          //   agg.away_aggregate_goals (these are what "away" team scored in leg 1,
          //   but the "home" team in leg 2 was the AWAY team in leg 1).
          //
          // This requires careful mapping. We follow the convention:
          //   home_aggregate_goals = goals by team H (home in leg 2) across leg 1.
          //   In leg 1, team H was the AWAY team → their goals in leg 1 are "away goals"
          //   for team H.
          //   Team H away goals total = agg.home_aggregate_goals (goals as away in leg 1).
          //   Team A away goals total = leg2.away_score (goals as away in leg 2).
          const homeAwayGoals = agg.home_aggregate_goals; // scored away (in leg 1)
          const awayAwayGoals = leg2.away_score; // scored away (in leg 2)

          if (homeAwayGoals > awayAwayGoals) {
            return {
              status: 'RESOLVED',
              winner: 'HOME',
              decided_by: 'AWAY_GOALS_AFTER_90',
            };
          }
          if (awayAwayGoals > homeAwayGoals) {
            return {
              status: 'RESOLVED',
              winner: 'AWAY',
              decided_by: 'AWAY_GOALS_AFTER_90',
            };
          }
          // Still level — fall through to next step.
          break;
        }

        case 'EXTRA_TIME':
          // Extra time is an EXTERNAL outcome — the Competition Engine does not
          // model ET scoring. If ET appears in the sequence, we yield UNDECIDED
          // here because ET scoring is not part of the current match data contract.
          // The caller should re-invoke with updated leg scores after ET is played.
          // §2.2: "prórroga" is out of scope for the Match Prediction Engine.
          // §8.4: we apply the step but cannot resolve without ET score data.
          return { status: 'UNDECIDED', reason: 'ORGANIZER_DEFINED_REQUIRED' };

        case 'PENALTIES':
          // Same as ET — penalty outcome is external.
          return { status: 'UNDECIDED', reason: 'ORGANIZER_DEFINED_REQUIRED' };

        case 'ORGANIZER_DEFINED':
          // §8.4: "si aparece ORGANIZER_DEFINED, debe ser el último elemento."
          // Yields UNDECIDED — result must come from outside.
          return { status: 'UNDECIDED', reason: 'ORGANIZER_DEFINED_REQUIRED' };
      }
    }

    // Exhausted all steps without resolution.
    return { status: 'UNDECIDED', reason: 'TIED_NO_FURTHER_RULE' };
  }

  // leg_type === 'SINGLE' for a TWO_LEG format — treat as single-leg.
  return resolveSingleLeg(match, rules);
}

// ── Single-leg resolution ────────────────────────────────────────────────────

/**
 * Resolve a single-leg knockout match.
 *
 * After 90 minutes: if there is a clear winner, return RESOLVED.
 * If drawn, apply single_leg_resolution_order.
 *
 * Spec §8.4
 */
function resolveSingleLeg(
  match: KnockoutMatchData,
  rules: KnockoutResolutionRules,
): KnockoutResolutionResult {
  const score = match.current_leg_score!;

  if (score.home_score > score.away_score) {
    return { status: 'RESOLVED', winner: 'HOME', decided_by: 'AGGREGATE_SCORE' };
  }
  if (score.away_score > score.home_score) {
    return { status: 'RESOLVED', winner: 'AWAY', decided_by: 'AGGREGATE_SCORE' };
  }

  // Draw — apply resolution sequence.
  const resolutionOrder = rules.single_leg_resolution_order;
  if (!resolutionOrder || resolutionOrder.length === 0) {
    return { status: 'UNDECIDED', reason: 'TIED_NO_FURTHER_RULE' };
  }

  // §8.4: iterate in order.
  for (const step of resolutionOrder) {
    switch (step) {
      case 'EXTRA_TIME':
        // External outcome required. §2.2
        return { status: 'UNDECIDED', reason: 'ORGANIZER_DEFINED_REQUIRED' };

      case 'PENALTIES':
        return { status: 'UNDECIDED', reason: 'ORGANIZER_DEFINED_REQUIRED' };

      case 'REPLAY':
        return { status: 'UNDECIDED', reason: 'ORGANIZER_DEFINED_REQUIRED' };

      case 'ORGANIZER_DEFINED':
        // Must be last per §8.4 (validated upstream by competition-profile-validator).
        return { status: 'UNDECIDED', reason: 'ORGANIZER_DEFINED_REQUIRED' };
    }
  }

  return { status: 'UNDECIDED', reason: 'TIED_NO_FURTHER_RULE' };
}

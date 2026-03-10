/**
 * group-ranking.ts — Group ranking and best-thirds computation.
 *
 * Spec authority: §5.2 (Competition Engine), §7.7 (group_id context),
 *                 §8.2 (GroupRankingRules, QualificationRules),
 *                 §18.3 (best-thirds ranking)
 *
 * CONTRACTS:
 *   rankGroup(group, rules) → RankedTeam[]
 *     Ranks all teams within a single group using computeStandings.
 *
 *   computeBestThirds(groups, qualificationRules) → BestThirdEntry[]
 *     Ranks third-placed teams across groups for cross-group advancement.
 *     Criteria per §18.3: points first, then GD, then GF.
 *     Groups with different match counts are supported (DEGRADED mode).
 *
 * INVARIANTS:
 *   - No implicit tournament logic; all rules come from explicit config objects.
 *   - Deterministic for same input (team_id as lexicographic final tiebreak).
 *   - DRAW_LOT without seed → BLOCKED (propagated from computeStandings).
 *   - Best-thirds ranking with unequal matches played → DEGRADED (not BLOCKED).
 */

import type {
  GroupRankingRules,
  QualificationRules,
} from '../contracts/types/competition-profile.js';
import {
  computeStandings,
  type MatchResult,
  type StandingEntry,
  type ResolutionGap,
} from './standings.js';

// ── Domain types ─────────────────────────────────────────────────────────────

/** One group's worth of data passed to rankGroup. */
export interface GroupData {
  group_id: string;
  team_ids: readonly string[];
  matches: readonly MatchResult[];
}

/** A team after group ranking has been applied. */
export interface RankedTeam {
  team_id: string;
  group_id: string;
  rank: number; // 1 = winner, 2 = runner-up, etc.
  standing: StandingEntry;
}

/** A third-placed team eligible for best-thirds consideration. §18.3 */
export interface BestThirdEntry {
  team_id: string;
  group_id: string;
  rank_in_group: number; // always 3
  points: number;
  goal_difference: number;
  goals_for: number;
  /** 1-based rank among all best thirds. */
  best_third_rank: number;
}

/** Full result of a group (all ranks). */
export interface GroupResult {
  group_id: string;
  ranked_teams: RankedTeam[];
  /** True when the group had unplayed matches. §18.3 */
  is_partial: boolean;
}

export type GroupRankingResult =
  | { status: 'RESOLVED'; data: RankedTeam[] }
  | { status: 'BLOCKED'; gap: ResolutionGap }
  | { status: 'DEGRADED'; data: RankedTeam[]; warnings: string[] };

export type BestThirdsResult =
  | { status: 'RESOLVED'; data: BestThirdEntry[] }
  | { status: 'BLOCKED'; gap: ResolutionGap }
  | { status: 'DEGRADED'; data: BestThirdEntry[]; warnings: string[] };

// ── rankGroup ─────────────────────────────────────────────────────────────────

/**
 * Rank all teams within a single group.
 *
 * Delegates to computeStandings for point accumulation and tiebreaker
 * application. Maps StandingEntry.rank to RankedTeam.rank.
 *
 * Spec §5.2, §8.2
 */
export function rankGroup(
  group: GroupData,
  rules: GroupRankingRules,
  drawOfLotsSeed?: number,
): GroupRankingResult {
  const standingsResult = computeStandings(group.matches, group.team_ids, rules, drawOfLotsSeed);

  if (standingsResult.status === 'BLOCKED') {
    return { status: 'BLOCKED', gap: standingsResult.gap };
  }

  const entries = standingsResult.data;
  const warnings: string[] = standingsResult.status === 'DEGRADED' ? standingsResult.warnings : [];

  const rankedTeams: RankedTeam[] = entries.map((entry) => ({
    team_id: entry.team_id,
    group_id: group.group_id,
    rank: entry.rank,
    standing: entry,
  }));

  // Detect whether any matches in the group are still unplayed.
  const hasUnplayed = group.matches.some((m) => m.home_score === null || m.away_score === null);
  if (hasUnplayed) {
    warnings.push(`Group ${group.group_id} has unplayed matches — table is partial.`);
  }

  if (warnings.length > 0) {
    return { status: 'DEGRADED', data: rankedTeams, warnings };
  }

  return { status: 'RESOLVED', data: rankedTeams };
}

// ── computeBestThirds ────────────────────────────────────────────────────────

/**
 * Rank the third-placed teams across multiple groups.
 *
 * Per §18.3:
 *   1. Points (across best thirds)
 *   2. Goal difference
 *   3. Goals for
 *   4. Team ID (deterministic fallback — draw_of_lots marker if explicitly
 *      reached in a real tournament, but the spec §18.3 does not define a
 *      DRAW_LOT step for best-thirds specifically)
 *
 * If groups have unequal matches played, the function returns DEGRADED
 * (not BLOCKED) because a partial table can still be compared, it just
 * has lower reliability. §18.3 does not require BLOCKED here.
 *
 * @param groups             - Pre-ranked group results (output of rankGroup).
 * @param qualificationRules - Used to check allow_cross_group_third_ranking.
 *
 * Spec §18.3
 */
export function computeBestThirds(
  groups: readonly GroupResult[],
  qualificationRules: QualificationRules,
): BestThirdsResult {
  if (!qualificationRules.allow_cross_group_third_ranking) {
    // Not applicable — caller should not invoke this function.
    return {
      status: 'BLOCKED',
      gap: {
        missingFields: [],
        requiredByRule: 'allow_cross_group_third_ranking must be true',
        specSection: '§8.2',
        canFallbackToSimulation: false,
      },
    };
  }

  const warnings: string[] = [];

  // Collect third-placed teams (rank === 3) from each group.
  const thirds: BestThirdEntry[] = [];

  for (const group of groups) {
    if (group.is_partial) {
      warnings.push(
        `Group ${group.group_id} is partial — best-thirds comparison may be unreliable.`,
      );
    }

    const third = group.ranked_teams.find((t) => t.rank === 3);
    if (!third) {
      warnings.push(`Group ${group.group_id} has no third-placed team — may have < 3 teams.`);
      continue;
    }

    thirds.push({
      team_id: third.team_id,
      group_id: third.group_id,
      rank_in_group: 3,
      points: third.standing.points,
      goal_difference: third.standing.goal_difference,
      goals_for: third.standing.goals_for,
      best_third_rank: 0, // assigned after sorting
    });
  }

  if (thirds.length === 0) {
    return {
      status: 'BLOCKED',
      gap: {
        missingFields: ['groups[*].ranked_teams (rank === 3)'],
        requiredByRule: 'computeBestThirds requires at least one third-placed team',
        specSection: '§18.3',
        canFallbackToSimulation: false,
      },
    };
  }

  // Sort per §18.3: points → GD → GF → team_id (deterministic fallback).
  thirds.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
    if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
    // Deterministic final tiebreak: team_id lexicographic ascending.
    return a.team_id < b.team_id ? -1 : a.team_id > b.team_id ? 1 : 0;
  });

  // Assign best_third_rank (1-based).
  thirds.forEach((t, i) => {
    t.best_third_rank = i + 1;
  });

  // Trim to best_thirds_count if specified.
  let result = thirds;
  if (
    qualificationRules.best_thirds_count !== undefined &&
    qualificationRules.best_thirds_count !== null
  ) {
    result = thirds.slice(0, qualificationRules.best_thirds_count);
  }

  if (warnings.length > 0) {
    return { status: 'DEGRADED', data: result, warnings };
  }

  return { status: 'RESOLVED', data: result };
}

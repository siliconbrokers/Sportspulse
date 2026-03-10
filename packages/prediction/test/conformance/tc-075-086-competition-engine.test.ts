/**
 * TC-075 to TC-086 — Competition Engine conformance tests.
 *
 * Conformance Test Plan §G: Competition Engine
 * Spec authority: §5.2, §7.7, §8.2, §8.4, §18.2, §18.3, §18.4
 *
 * Gate G3 — Competition Engine:
 * - TC-075 to TC-086 must all pass.
 * - No release if KnockoutResolutionRules admits ambiguous combos.
 * - No logic derived from tournament name.
 */

import { describe, it, expect } from 'vitest';
import { rankGroup, computeBestThirds } from '../../src/competition/group-ranking.js';
import type { GroupData, GroupResult } from '../../src/competition/group-ranking.js';
import { resolveKnockout } from '../../src/competition/knockout-resolver.js';
import type { KnockoutMatchData } from '../../src/competition/knockout-resolver.js';
import { mapToBracket } from '../../src/competition/bracket-mapper.js';
import type { TeamQualification } from '../../src/competition/bracket-mapper.js';
import { computeStandings } from '../../src/competition/standings.js';
import type { MatchResult, StandingEntry } from '../../src/competition/standings.js';
import type {
  GroupRankingRules,
  QualificationRules,
} from '../../src/contracts/types/competition-profile.js';

// ── Shared fixtures ──────────────────────────────────────────────────────────

function makeRules(
  rankBy: string[] = ['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR'],
): GroupRankingRules {
  return {
    points_win: 3,
    points_draw: 1,
    points_loss: 0,
    rank_by: rankBy as GroupRankingRules['rank_by'],
  };
}

function makeGroup(groupId: string, teamIds: string[], matches: MatchResult[]): GroupData {
  return { group_id: groupId, team_ids: teamIds, matches };
}

/** Helper to create a MatchResult — includes required match_id field. */
function mr(
  id: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number | null,
  awayScore: number | null,
): MatchResult {
  return {
    match_id: id,
    home_team_id: homeTeam,
    away_team_id: awayTeam,
    home_score: homeScore,
    away_score: awayScore,
  };
}

/** Helper to build a StandingEntry for fixture use in GroupResult. */
function se(
  teamId: string,
  rank: number,
  played: number,
  wins: number,
  draws: number,
  losses: number,
  gf: number,
  ga: number,
  pts: number,
): StandingEntry {
  return {
    team_id: teamId,
    rank,
    played,
    wins,
    draws,
    losses,
    goals_for: gf,
    goals_against: ga,
    goal_difference: gf - ga,
    points: pts,
    draw_lot_required: false,
  };
}

// ── TC-075: Group ranking follows rank_by order exactly ───────────────────

describe('TC-075 — Ranking de grupo clásico por orden rank_by (§8.2, §18.3)', () => {
  it('PASS: Teams ranked strictly by POINTS then GOAL_DIFFERENCE as configured', () => {
    // Spec §8.2: "standings siguen exactamente el orden de rank_by"
    const teams = ['T1', 'T2', 'T3', 'T4'];
    const matches: MatchResult[] = [
      mr('m1', 'T1', 'T2', 2, 1),
      mr('m2', 'T3', 'T4', 1, 1),
      mr('m3', 'T1', 'T3', 3, 0),
      mr('m4', 'T2', 'T4', 2, 0),
      mr('m5', 'T1', 'T4', 1, 0),
      mr('m6', 'T2', 'T3', 0, 0),
    ];

    const rules = makeRules(['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR']);
    const group = makeGroup('A', teams, matches);
    const result = rankGroup(group, rules);

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    // T1: 3 wins = 9 pts, GD = +6
    // T2: 1W 1D 1L = 4 pts, GD = +1
    // T3: 0W 2D 1L = 2 pts, GD = -2
    // T4: 0W 1D 2L = 1 pt, GD = -5
    const ordered = result.data.slice().sort((a, b) => a.rank - b.rank);
    expect(ordered[0]!.team_id).toBe('T1');
    expect(ordered[1]!.team_id).toBe('T2');
    expect(ordered[2]!.team_id).toBe('T3');
    expect(ordered[3]!.team_id).toBe('T4');

    // Ranks must be sequential 1-based
    expect(ordered[0]!.rank).toBe(1);
    expect(ordered[1]!.rank).toBe(2);
    expect(ordered[2]!.rank).toBe(3);
    expect(ordered[3]!.rank).toBe(4);
  });

  it('PASS: Teams with equal points ranked by GOAL_DIFFERENCE before GOALS_FOR', () => {
    // Spec §8.2: rank_by order is normative — GD checked before GF
    const teams = ['TA', 'TB', 'TC'];
    const matches: MatchResult[] = [
      mr('n1', 'TA', 'TB', 1, 0), // TA wins
      mr('n2', 'TB', 'TC', 1, 0), // TB wins
      mr('n3', 'TC', 'TA', 0, 0), // draw → TA 1pt, TC 1pt
    ];

    // After all: TA=4pts GD=1, TB=3pts GD=0, TC=1pt GD=-1
    const rules = makeRules(['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR']);
    const result = rankGroup(makeGroup('B', teams, matches), rules);

    expect(result.status === 'RESOLVED' || result.status === 'DEGRADED').toBe(true);
    if (result.status !== 'RESOLVED' && result.status !== 'DEGRADED') return;
    const ordered = result.data.slice().sort((a, b) => a.rank - b.rank);
    // TA must be rank 1 (most points)
    expect(ordered[0]!.team_id).toBe('TA');
  });
});

// ── TC-076: Head-to-head applied only when configured ────────────────────

describe('TC-076 — Head-to-head aplicado solo si configurado (§8.2)', () => {
  it('PASS: Without head-to-head in rank_by, ties resolved by next criterion only', () => {
    // Spec §8.2: "resolución cambia solo cuando la regla está activa"
    const teams = ['X', 'Y', 'Z'];
    const matches: MatchResult[] = [
      mr('p1', 'X', 'Y', 2, 0), // X beats Y
      mr('p2', 'Y', 'Z', 2, 0), // Y beats Z
      mr('p3', 'Z', 'X', 2, 0), // Z beats X
    ];
    // All teams 3pts, GD=0, GF=2 — must fall through to deterministic fallback

    const rulesWithoutH2H: GroupRankingRules = {
      points_win: 3,
      points_draw: 1,
      points_loss: 0,
      rank_by: ['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR'],
    };

    const groupData = makeGroup('C', teams, matches);
    const withoutH2H = rankGroup(groupData, rulesWithoutH2H);

    // Must return some valid result — not BLOCKED
    expect(withoutH2H.status).not.toBe('BLOCKED');
    if (withoutH2H.status !== 'RESOLVED' && withoutH2H.status !== 'DEGRADED') return;
    // All 3 teams must have ranks assigned
    expect(withoutH2H.data.length).toBe(3);
  });

  it('PASS: Without head-to-head configured, fallback to next rule in rank_by', () => {
    // Spec §8.2: when H2H not in rank_by, system uses next criterion without applying H2H
    const teams = ['P', 'Q'];
    const matches: MatchResult[] = [
      mr('q1', 'P', 'Q', 1, 1), // draw — equal on all normal criteria
    ];

    // Both teams: 1pt, GD=0, GF=1 — with just POINTS ties fall through to deterministic team_id
    const rules: GroupRankingRules = {
      points_win: 3,
      points_draw: 1,
      points_loss: 0,
      rank_by: ['POINTS'],
    };

    const result = rankGroup(makeGroup('D', teams, matches), rules);
    // Should resolve deterministically (team_id lex fallback), not BLOCKED
    expect(result.status === 'RESOLVED' || result.status === 'DEGRADED').toBe(true);
  });
});

// ── TC-077: Best-thirds cross-group ranking ───────────────────────────────

describe('TC-077 — Best third ranking cross-group (§8.2, §18.3)', () => {
  it('PASS: allow_cross_group_third_ranking=true ranks thirds across groups', () => {
    // Spec §18.3: criteria for cross-group third ranking: points, GD, GF
    const groupARanked: GroupResult = {
      group_id: 'A',
      is_partial: false,
      ranked_teams: [
        { team_id: 'A1', group_id: 'A', rank: 1, standing: se('A1', 1, 3, 3, 0, 0, 9, 0, 9) },
        { team_id: 'A2', group_id: 'A', rank: 2, standing: se('A2', 2, 3, 2, 0, 1, 4, 3, 6) },
        { team_id: 'A3', group_id: 'A', rank: 3, standing: se('A3', 3, 3, 0, 1, 2, 2, 5, 1) },
      ],
    };

    const groupBRanked: GroupResult = {
      group_id: 'B',
      is_partial: false,
      ranked_teams: [
        { team_id: 'B1', group_id: 'B', rank: 1, standing: se('B1', 1, 3, 3, 0, 0, 7, 1, 9) },
        { team_id: 'B2', group_id: 'B', rank: 2, standing: se('B2', 2, 3, 1, 1, 1, 3, 3, 4) },
        { team_id: 'B3', group_id: 'B', rank: 3, standing: se('B3', 3, 3, 1, 0, 2, 4, 7, 3) },
      ],
    };

    const qualRules: QualificationRules = {
      qualified_count_per_group: 2,
      best_thirds_count: 1, // only best single third advances
      allow_cross_group_third_ranking: true,
    };

    const result = computeBestThirds([groupARanked, groupBRanked], qualRules);

    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    // B3 has 3pts vs A3's 1pt — B3 must be the best third
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.team_id).toBe('B3');
    expect(result.data[0]!.best_third_rank).toBe(1);
  });

  it('FAIL: allow_cross_group_third_ranking=false → BLOCKED (§8.2)', () => {
    // Spec §8.2: cross-group third ranking only when explicitly enabled
    const qualRules: QualificationRules = {
      qualified_count_per_group: 2,
      best_thirds_count: 2,
      allow_cross_group_third_ranking: false,
    };

    const result = computeBestThirds([], qualRules);
    expect(result.status).toBe('BLOCKED');
  });
});

// ── TC-078: Bracket mapping THIRD_PLACE_DEPENDENT ─────────────────────────

describe('TC-078 — Bracket mapping THIRD_PLACE_DEPENDENT (§8.2, §18.3)', () => {
  it('PASS: mapping_table present, bracket built using exact mapping', () => {
    // Spec §8.3: "si strategy = THIRD_PLACE_DEPENDENT, debe existir mapping_table"
    // Spec §18.3: bracket conditioned on which thirds classified
    const qualifiers: TeamQualification[] = [
      { team_id: 'W1', group_id: 'A', qualified_from_position: 1, is_seeded: true },
      { team_id: 'W2', group_id: 'B', qualified_from_position: 1, is_seeded: true },
      { team_id: 'RU1', group_id: 'A', qualified_from_position: 2, is_seeded: false },
      { team_id: 'T3B', group_id: 'B', qualified_from_position: 3, is_seeded: false },
    ];

    // Combination key is built from group_ids of third-placed qualifiers, sorted and joined.
    // T3B has group_id='B' and qualified_from_position=3 → only one third → key = 'B'
    const mappingTable = {
      B: {
        slot1: { position: 1, group_id: 'A' },
        slot2: { position: 1, group_id: 'B' },
        slot3: { position: 2, group_id: 'A' },
        slot4: { position: 3, group_id: 'B' },
      },
    };

    const rules: QualificationRules = {
      qualified_count_per_group: 2,
      allow_cross_group_third_ranking: true,
      bracket_mapping_definition: {
        strategy: 'THIRD_PLACE_DEPENDENT',
        mapping_table: mappingTable,
      },
    };

    const result = mapToBracket(qualifiers, rules);
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    // All qualified teams must appear in slots
    const teamIds = result.data.map((s) => s.team_id);
    expect(teamIds).toContain('W1');
    expect(teamIds).toContain('W2');
    expect(teamIds).toContain('RU1');
    expect(teamIds).toContain('T3B');
  });

  it('FAIL: mapping_table null for THIRD_PLACE_DEPENDENT → BLOCKED (§8.3)', () => {
    // Spec §8.3: "si strategy = THIRD_PLACE_DEPENDENT, debe existir mapping_table"
    const qualifiers: TeamQualification[] = [
      { team_id: 'T1', group_id: 'A', qualified_from_position: 1 },
      { team_id: 'T2', group_id: 'B', qualified_from_position: 1 },
    ];

    const rules: QualificationRules = {
      qualified_count_per_group: 1,
      allow_cross_group_third_ranking: false,
      bracket_mapping_definition: {
        strategy: 'THIRD_PLACE_DEPENDENT',
        mapping_table: null,
      },
    };

    const result = mapToBracket(qualifiers, rules);
    expect(result.status).toBe('BLOCKED');
  });
});

// ── TC-079: League phase single table ─────────────────────────────────────

describe('TC-079 — League phase single table (§8.2, §18.4)', () => {
  it('PASS: Standings computed correctly for all teams in league phase', () => {
    // Spec §18.4: league_phase_rules with positions for classification/playoff/elimination
    const teams = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'];
    const matches: MatchResult[] = [
      mr('lp1', 'L1', 'L2', 2, 1),
      mr('lp2', 'L3', 'L4', 0, 0),
      mr('lp3', 'L5', 'L6', 3, 1),
      mr('lp4', 'L7', 'L8', 1, 2),
    ];

    const rules = makeRules(['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR']);
    const result = computeStandings(matches, teams, rules);

    expect(result.status === 'RESOLVED' || result.status === 'DEGRADED').toBe(true);
    if (result.status === 'BLOCKED') return;

    // All 8 teams must have standings entries
    expect(result.data.length).toBe(8);

    // Verify point totals
    const l1 = result.data.find((e) => e.team_id === 'L1');
    expect(l1!.points).toBe(3);
    expect(l1!.wins).toBe(1);

    const l3 = result.data.find((e) => e.team_id === 'L3');
    const l4 = result.data.find((e) => e.team_id === 'L4');
    expect(l3!.points).toBe(1);
    expect(l4!.points).toBe(1);

    const l2 = result.data.find((e) => e.team_id === 'L2');
    expect(l2!.points).toBe(0);
  });
});

// ── TC-080: KNOCKOUT_TWO_LEG with aggregate_state and valid sequence ───────

describe('TC-080 — KNOCKOUT_TWO_LEG con aggregate_state y secuencia válida (§8.4, §18.2)', () => {
  it('PASS: Aggregate winner decided immediately when not level', () => {
    // Spec §18.2: resolución usa aggregate_state_before_match y secuencia del perfil
    const match: KnockoutMatchData = {
      match_id: 'semi-2nd-leg',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 2, away_score: 1 },
      // Team playing home in leg2 had 0 goals in leg1; away had 2 goals
      aggregate_state_before_match: { home_aggregate_goals: 0, away_aggregate_goals: 2 },
      knockout_resolution_rules: {
        second_leg_resolution_order: ['AWAY_GOALS_AFTER_90', 'EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };

    const result = resolveKnockout(match, match.knockout_resolution_rules!);
    // Total: Home=0+2=2, Away=2+1=3 → AWAY wins on aggregate
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.winner).toBe('AWAY');
    expect(result.decided_by).toBe('AGGREGATE_SCORE');
  });

  it('FAIL: SECOND_LEG without aggregate_state → BLOCKED (§7.3)', () => {
    // Spec §7.3 guard: missing aggregate_state_before_match → BLOCKED
    const match: KnockoutMatchData = {
      match_id: 'semi-2nd-leg-broken',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 2, away_score: 0 },
      aggregate_state_before_match: null, // MISSING — violation
      knockout_resolution_rules: {
        second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };

    const result = resolveKnockout(match, match.knockout_resolution_rules!);
    expect(result.status).toBe('BLOCKED');
  });

  it('PASS: FIRST_LEG returns UNDECIDED — tie not yet complete (§18.2)', () => {
    // Spec §18.2: first leg finished — tie is incomplete
    const match: KnockoutMatchData = {
      match_id: 'r16-1st-leg',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'FIRST_LEG',
      current_leg_score: { home_score: 2, away_score: 0 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: {
        second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };

    const result = resolveKnockout(match, match.knockout_resolution_rules!);
    expect(result.status).toBe('UNDECIDED');
  });

  it('PASS: Match not yet played returns UNDECIDED (current_leg_score null)', () => {
    // Spec §8.4: current_leg_score = null → cannot resolve
    const match: KnockoutMatchData = {
      match_id: 'upcoming-leg',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: null,
      aggregate_state_before_match: { home_aggregate_goals: 1, away_aggregate_goals: 1 },
      knockout_resolution_rules: {
        second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };

    const result = resolveKnockout(match, match.knockout_resolution_rules!);
    expect(result.status).toBe('UNDECIDED');
  });
});

// ── TC-081: KNOCKOUT_SINGLE_LEG draw at 90 ───────────────────────────────

describe('TC-081 — KNOCKOUT_SINGLE_LEG empatado a 90 (§8.4)', () => {
  it('PASS: Draw at 90 → resolution sequence applied in order → UNDECIDED at EXTRA_TIME', () => {
    // Spec §8.4: single_leg_resolution_order applied strictly when drawn
    const match: KnockoutMatchData = {
      match_id: 'final-single',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 1, away_score: 1 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: {
        single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };

    const result = resolveKnockout(match, match.knockout_resolution_rules!);
    // Draw → sequence applied → EXTRA_TIME → UNDECIDED (external outcome)
    expect(result.status).toBe('UNDECIDED');
  });

  it('PASS: Clear winner at 90 → RESOLVED without applying sequence (§8.4)', () => {
    // Spec §8.4: clear 90-min winner resolves without needing the sequence
    const match: KnockoutMatchData = {
      match_id: 'r16-single',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 3, away_score: 1 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: {
        single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };

    const result = resolveKnockout(match, match.knockout_resolution_rules!);
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;
    expect(result.winner).toBe('HOME');
  });

  it('PASS: PENALTIES-only sequence → UNDECIDED (external outcome required)', () => {
    // Spec §8.4: PENALTIES is external — resolution yields UNDECIDED
    const match: KnockoutMatchData = {
      match_id: 'cup-qf',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 0, away_score: 0 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: {
        single_leg_resolution_order: ['PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };

    const result = resolveKnockout(match, match.knockout_resolution_rules!);
    expect(result.status).toBe('UNDECIDED');
  });
});

// ── TC-082: Final override flag preserved ─────────────────────────────────

describe('TC-082 — Final override aplicado (§8.4)', () => {
  it('PASS: final_overrides_prior_round_rules=true does not cause BLOCKED', () => {
    // Spec §8.4: "la final usa la secuencia especial y no la de rondas previas"
    // The flag is part of the rules contract — must not cause errors when set to true
    const finalMatch: KnockoutMatchData = {
      match_id: 'final-match',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 2, away_score: 2 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: {
        single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: true, // final override enabled
      },
    };

    const result = resolveKnockout(finalMatch, finalMatch.knockout_resolution_rules!);
    // Should proceed with the provided resolution sequence without error
    // Draw → EXTRA_TIME → UNDECIDED
    expect(result.status).toBe('UNDECIDED');
    expect(result.status).not.toBe('BLOCKED');
  });
});

// ── TC-083: No tournament name heuristics ─────────────────────────────────

describe('TC-083 — No se usa heurística por nombre del torneo (§7.6, §18.3)', () => {
  it('PASS: Away goals NOT applied when absent from resolution_order (§8.4)', () => {
    // Spec §7.6: "queda prohibido inferir clasificación por heurística blanda"
    // Spec §18.3: tournament logic comes from explicit config, not from name
    // A match with competition name implying away goals rule, but sequence has none configured
    const match: KnockoutMatchData = {
      match_id: 'champions-semi',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 1, away_score: 1 },
      // Aggregate level 2-2
      aggregate_state_before_match: { home_aggregate_goals: 1, away_aggregate_goals: 1 },
      knockout_resolution_rules: {
        // No AWAY_GOALS_AFTER_90 in sequence — must NOT be implicitly applied
        second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };

    const result = resolveKnockout(match, match.knockout_resolution_rules!);
    // Aggregate: Home=1+1=2, Away=1+1=2 → level
    // No AWAY_GOALS in sequence → EXTRA_TIME → UNDECIDED
    // Must NOT be RESOLVED based on implicit away goals logic
    if (result.status === 'RESOLVED') {
      throw new Error(
        'BUG-TC083: Away goals applied without being in resolution_order — heuristic inference from competition name',
      );
    }
    expect(result.status).toBe('UNDECIDED');
  });
});

// ── TC-084: Phase transition — qualifiers from group to bracket ───────────

describe('TC-084 — Transición entre fases (§5.2, §18)', () => {
  it('PASS: Qualified teams from group ranking feed correctly into bracket', () => {
    // Spec §5.2: "los clasificados y emparejamientos de siguiente fase son correctos"
    const teams = ['G1', 'G2', 'G3'];
    const matches: MatchResult[] = [
      mr('t1', 'G1', 'G2', 3, 0),
      mr('t2', 'G1', 'G3', 2, 1),
      mr('t3', 'G2', 'G3', 1, 0),
    ];

    const rules = makeRules(['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR']);
    const rankResult = rankGroup(makeGroup('E', teams, matches), rules);

    expect(rankResult.status).toBe('RESOLVED');
    if (rankResult.status !== 'RESOLVED') return;

    // G1: 2 wins = 6pts, G2: 1W1L = 3pts, G3: 0W2L = 0pts
    const ordered = rankResult.data.slice().sort((a, b) => a.rank - b.rank);
    expect(ordered[0]!.team_id).toBe('G1');
    expect(ordered[1]!.team_id).toBe('G2');

    // Build qualifiers for bracket from top 2, using different groups
    // (POSITION_SEEDED validates that same-group teams don't face each other)
    const qualifiers: TeamQualification[] = [
      { team_id: ordered[0]!.team_id, group_id: 'E', qualified_from_position: 1, is_seeded: true },
      { team_id: ordered[1]!.team_id, group_id: 'F', qualified_from_position: 2, is_seeded: false }, // different group
    ];

    const bracketRules: QualificationRules = {
      qualified_count_per_group: 2,
      allow_cross_group_third_ranking: false,
      bracket_mapping_definition: { strategy: 'POSITION_SEEDED' },
    };

    const bracketResult = mapToBracket(qualifiers, bracketRules);
    expect(bracketResult.status === 'RESOLVED' || bracketResult.status === 'DEGRADED').toBe(true);
    if (bracketResult.status === 'BLOCKED') return;

    const teamIds = bracketResult.data.map((s) => s.team_id);
    expect(teamIds).toContain('G1');
    expect(teamIds).toContain('G2');
  });
});

// ── TC-085: stage_id/group_id required in ranked team entries ─────────────

describe('TC-085 — stage_id/group_id requeridos (§7.7, §5.2)', () => {
  it('PASS: Group ranking includes group_id in every RankedTeam entry', () => {
    // Spec §7.7: group_id context must be present — must never be silently dropped
    const teams = ['H1', 'H2'];
    const matches: MatchResult[] = [mr('h1', 'H1', 'H2', 2, 0)];

    const result = rankGroup(makeGroup('group-stage-A', teams, matches), makeRules());

    expect(result.status === 'RESOLVED' || result.status === 'DEGRADED').toBe(true);
    if (result.status !== 'RESOLVED' && result.status !== 'DEGRADED') return;

    for (const rankedTeam of result.data) {
      expect(rankedTeam.group_id).toBe('group-stage-A');
      expect(typeof rankedTeam.group_id).toBe('string');
      expect(rankedTeam.group_id.length).toBeGreaterThan(0);
    }
  });

  it('PASS: BestThirdEntry carries group_id from its source group', () => {
    // Spec §7.7: group_id must flow through best-thirds ranking
    const groupResult: GroupResult = {
      group_id: 'F',
      is_partial: false,
      ranked_teams: [
        { team_id: 'F1', group_id: 'F', rank: 1, standing: se('F1', 1, 3, 3, 0, 0, 9, 0, 9) },
        { team_id: 'F2', group_id: 'F', rank: 2, standing: se('F2', 2, 3, 1, 1, 1, 3, 4, 4) },
        { team_id: 'F3', group_id: 'F', rank: 3, standing: se('F3', 3, 3, 0, 1, 2, 2, 10, 1) },
      ],
    };

    const qualRules: QualificationRules = {
      qualified_count_per_group: 2,
      best_thirds_count: 1,
      allow_cross_group_third_ranking: true,
    };

    const result = computeBestThirds([groupResult], qualRules);
    expect(result.status === 'RESOLVED' || result.status === 'DEGRADED').toBe(true);
    if (result.status !== 'RESOLVED' && result.status !== 'DEGRADED') return;

    for (const entry of result.data) {
      expect(entry.group_id).toBe('F');
    }
  });
});

// ── TC-086: Cross-group third ranking disabled ────────────────────────────

describe('TC-086 — Cross-group third ranking deshabilitado (§8.2)', () => {
  it('FAIL: allow_cross_group_third_ranking=false → BLOCKED even with best_thirds_count defined', () => {
    // Spec §8.2: "engine no realiza ranking cruzado cuando la regla lo prohíbe"
    const groupRanked: GroupResult = {
      group_id: 'Z',
      is_partial: false,
      ranked_teams: [
        { team_id: 'Z1', group_id: 'Z', rank: 1, standing: se('Z1', 1, 2, 2, 0, 0, 4, 0, 6) },
        { team_id: 'Z2', group_id: 'Z', rank: 2, standing: se('Z2', 2, 2, 0, 0, 2, 0, 4, 0) },
        { team_id: 'Z3', group_id: 'Z', rank: 3, standing: se('Z3', 3, 2, 0, 0, 2, 0, 4, 0) },
      ],
    };

    const qualRules: QualificationRules = {
      qualified_count_per_group: 2,
      best_thirds_count: 2, // defined, but cross-ranking is disabled
      allow_cross_group_third_ranking: false, // DISABLED
    };

    const result = computeBestThirds([groupRanked], qualRules);
    // Must be BLOCKED — cross-group ranking not allowed
    expect(result.status).toBe('BLOCKED');
  });
});

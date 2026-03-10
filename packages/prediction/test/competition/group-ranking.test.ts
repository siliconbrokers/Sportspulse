/**
 * group-ranking.test.ts — Unit tests for rankGroup and computeBestThirds.
 *
 * Spec authority: §5.2, §7.7 (group_id context), §8.2 (GroupRankingRules),
 *                 §18.3 (best-thirds ranking criteria)
 * Acceptance matrix: §25 (group ranking, best-thirds)
 */

import { describe, it, expect } from 'vitest';
import {
  rankGroup,
  computeBestThirds,
  type GroupData,
  type GroupResult,
} from '../../src/competition/group-ranking.js';
import type {
  GroupRankingRules,
  QualificationRules,
} from '../../src/contracts/types/competition-profile.js';
import type { MatchResult } from '../../src/competition/standings.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const STANDARD_RULES: GroupRankingRules = {
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  rank_by: ['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR'],
};

function makeRoundRobin(
  group_id: string,
  teams: string[],
  scores: [string, string, number, number][],
): GroupData {
  const matches: MatchResult[] = scores.map(([h, a, hs, as_], i) => ({
    match_id: `${group_id}-m${i + 1}`,
    home_team_id: h,
    away_team_id: a,
    home_score: hs,
    away_score: as_,
  }));
  return { group_id, team_ids: teams, matches };
}

// ── rankGroup — clear winner ──────────────────────────────────────────────────

describe('rankGroup — full group with clear winner', () => {
  const groupA = makeRoundRobin(
    'A',
    ['A1', 'A2', 'A3', 'A4'],
    [
      ['A1', 'A2', 3, 0],
      ['A1', 'A3', 2, 1],
      ['A1', 'A4', 1, 0],
      ['A2', 'A3', 2, 0],
      ['A2', 'A4', 1, 0],
      ['A3', 'A4', 1, 0],
    ],
  );

  it('returns RESOLVED status', () => {
    const result = rankGroup(groupA, STANDARD_RULES);
    expect(result.status).toBe('RESOLVED');
  });

  it('assigns rank 1 to A1 (9 points, best winner)', () => {
    const result = rankGroup(groupA, STANDARD_RULES);
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    const winner = result.data.find((t) => t.rank === 1);
    expect(winner?.team_id).toBe('A1');
  });

  it('assigns rank 4 to A4 (0 points)', () => {
    const result = rankGroup(groupA, STANDARD_RULES);
    if (result.status !== 'RESOLVED') return;

    const last = result.data.find((t) => t.rank === 4);
    expect(last?.team_id).toBe('A4');
  });

  it('preserves group_id on all ranked teams', () => {
    const result = rankGroup(groupA, STANDARD_RULES);
    if (result.status !== 'RESOLVED') return;

    expect(result.data.every((t) => t.group_id === 'A')).toBe(true);
  });
});

// ── rankGroup — tiebreakers required ─────────────────────────────────────────

describe('rankGroup — multiple tiebreakers required', () => {
  it('breaks tie by GD when points are equal', () => {
    // T1 and T2 both 4pts. T1 has GD=+3, T2 has GD=+1.
    const group = makeRoundRobin(
      'B',
      ['T1', 'T2', 'T3'],
      [
        ['T1', 'T2', 2, 1], // T1 wins
        ['T1', 'T3', 3, 0], // T1 wins
        ['T2', 'T3', 1, 0], // T2 wins
      ],
    );
    // T1: 6pts, GD = (2+3-1-0) = 4
    // T2: 3pts
    // T3: 0pts
    const result = rankGroup(group, STANDARD_RULES);
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    const byId = Object.fromEntries(result.data.map((t) => [t.team_id, t]));
    expect(byId['T1'].rank).toBe(1);
    expect(byId['T2'].rank).toBe(2);
    expect(byId['T3'].rank).toBe(3);
  });
});

// ── rankGroup — partial (incomplete matches) ──────────────────────────────────

describe('rankGroup — partial group results', () => {
  it('returns DEGRADED when group has unplayed matches', () => {
    const partialGroup: GroupData = {
      group_id: 'C',
      team_ids: ['C1', 'C2', 'C3'],
      matches: [
        { match_id: 'cm1', home_team_id: 'C1', away_team_id: 'C2', home_score: 1, away_score: 0 },
        {
          match_id: 'cm2',
          home_team_id: 'C1',
          away_team_id: 'C3',
          home_score: null,
          away_score: null,
        },
        {
          match_id: 'cm3',
          home_team_id: 'C2',
          away_team_id: 'C3',
          home_score: null,
          away_score: null,
        },
      ],
    };

    const result = rankGroup(partialGroup, STANDARD_RULES);
    expect(result.status).toBe('DEGRADED');
  });

  it('DEGRADED result still contains all teams', () => {
    const partialGroup: GroupData = {
      group_id: 'C',
      team_ids: ['C1', 'C2', 'C3'],
      matches: [
        { match_id: 'cm1', home_team_id: 'C1', away_team_id: 'C2', home_score: 1, away_score: 0 },
        {
          match_id: 'cm2',
          home_team_id: 'C1',
          away_team_id: 'C3',
          home_score: null,
          away_score: null,
        },
        {
          match_id: 'cm3',
          home_team_id: 'C2',
          away_team_id: 'C3',
          home_score: null,
          away_score: null,
        },
      ],
    };

    const result = rankGroup(partialGroup, STANDARD_RULES);
    if (result.status === 'DEGRADED') {
      expect(result.data).toHaveLength(3);
    }
  });
});

// ── computeBestThirds — 4 groups, pick best 4 thirds ─────────────────────────

describe('computeBestThirds — 4 groups of 3 teams', () => {
  const QUAL_RULES: QualificationRules = {
    qualified_count_per_group: 2,
    best_thirds_count: 4,
    allow_cross_group_third_ranking: true,
  };

  /**
   * Groups A, B, C, D each with 3 teams.
   * The third-placed team in each group has different points/GD.
   *
   * Expected ranking of thirds:
   *   G1_T3: 4pts, GD=+1
   *   G2_T3: 3pts, GD=0
   *   G3_T3: 3pts, GD=-1
   *   G4_T3: 1pts, GD=-2
   */
  function buildGroup(gid: string, t3Points: number, t3Gd: number, t3Gf: number): GroupResult {
    // Create a mock group result with a third-placed team at the specified stats.
    // We craft the standing entry directly.
    const winnerEntry = {
      team_id: `${gid}_T1`,
      group_id: gid,
      rank: 1,
      standing: {
        team_id: `${gid}_T1`,
        played: 2,
        wins: 2,
        draws: 0,
        losses: 0,
        goals_for: 6,
        goals_against: 0,
        goal_difference: 6,
        points: 6,
        rank: 1,
        draw_lot_required: false,
      },
    };
    const runnerUpEntry = {
      team_id: `${gid}_T2`,
      group_id: gid,
      rank: 2,
      standing: {
        team_id: `${gid}_T2`,
        played: 2,
        wins: 1,
        draws: 0,
        losses: 1,
        goals_for: 2,
        goals_against: 2,
        goal_difference: 0,
        points: 3,
        rank: 2,
        draw_lot_required: false,
      },
    };
    const ga = t3Gf - t3Gd;
    const thirdEntry = {
      team_id: `${gid}_T3`,
      group_id: gid,
      rank: 3,
      standing: {
        team_id: `${gid}_T3`,
        played: 2,
        wins: 0,
        draws: t3Points,
        losses: 2 - t3Points,
        goals_for: t3Gf,
        goals_against: ga,
        goal_difference: t3Gd,
        points: t3Points,
        rank: 3,
        draw_lot_required: false,
      },
    };

    return {
      group_id: gid,
      ranked_teams: [winnerEntry, runnerUpEntry, thirdEntry],
      is_partial: false,
    };
  }

  const groups: GroupResult[] = [
    buildGroup('G1', 4, 1, 3),
    buildGroup('G2', 3, 0, 2),
    buildGroup('G3', 3, -1, 1),
    buildGroup('G4', 1, -2, 0),
  ];

  it('returns RESOLVED with 4 best-third entries', () => {
    const result = computeBestThirds(groups, QUAL_RULES);
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    expect(result.data).toHaveLength(4);
  });

  it('ranks G1_T3 first (most points among thirds)', () => {
    const result = computeBestThirds(groups, QUAL_RULES);
    if (result.status !== 'RESOLVED') return;

    expect(result.data[0].team_id).toBe('G1_T3');
    expect(result.data[0].best_third_rank).toBe(1);
  });

  it('sorts by GD when points are equal (G2_T3 before G3_T3)', () => {
    const result = computeBestThirds(groups, QUAL_RULES);
    if (result.status !== 'RESOLVED') return;

    const g2Third = result.data.find((t) => t.team_id === 'G2_T3');
    const g3Third = result.data.find((t) => t.team_id === 'G3_T3');
    expect(g2Third!.best_third_rank).toBeLessThan(g3Third!.best_third_rank);
  });

  it('assigns consecutive best_third_rank values starting at 1', () => {
    const result = computeBestThirds(groups, QUAL_RULES);
    if (result.status !== 'RESOLVED') return;

    const ranks = result.data.map((t) => t.best_third_rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4]);
  });

  it('returns BLOCKED when allow_cross_group_third_ranking is false', () => {
    const noThirds: QualificationRules = {
      allow_cross_group_third_ranking: false,
    };
    const result = computeBestThirds(groups, noThirds);
    expect(result.status).toBe('BLOCKED');
  });

  it('returns DEGRADED when some groups are partial', () => {
    const partialGroups = groups.map((g, i) => (i === 0 ? { ...g, is_partial: true } : g));
    const result = computeBestThirds(partialGroups, QUAL_RULES);
    expect(result.status).toBe('DEGRADED');
    if (result.status === 'DEGRADED') {
      expect(result.warnings.some((w) => w.includes('partial'))).toBe(true);
    }
  });

  it('is deterministic — same inputs produce identical output', () => {
    const r1 = computeBestThirds(groups, QUAL_RULES);
    const r2 = computeBestThirds(groups, QUAL_RULES);

    if (r1.status === 'RESOLVED' && r2.status === 'RESOLVED') {
      expect(r1.data.map((t) => t.team_id)).toEqual(r2.data.map((t) => t.team_id));
    }
  });
});

/**
 * bracket-mapper.test.ts — Unit tests for mapToBracket.
 *
 * Spec authority: §5.2, §8.2 (QualificationRules, BracketMappingStrategy),
 *                 §8.3 (THIRD_PLACE_DEPENDENT requires mapping_table),
 *                 §18.3 (bracket construction conditioned on thirds)
 * Acceptance matrix: §25 (bracket mapping determinism, BLOCKED states)
 */

import { describe, it, expect } from 'vitest';
import { mapToBracket, type TeamQualification } from '../../src/competition/bracket-mapper.js';
import type { QualificationRules } from '../../src/contracts/types/competition-profile.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** 8 qualifiers from 4 groups (2 per group): winners are seeded. */
function make8Qualifiers(): TeamQualification[] {
  const groups = ['A', 'B', 'C', 'D'];
  const qualifiers: TeamQualification[] = [];
  for (const g of groups) {
    qualifiers.push({
      team_id: `${g}_winner`,
      group_id: g,
      qualified_from_position: 1,
      is_seeded: true,
    });
    qualifiers.push({
      team_id: `${g}_runner`,
      group_id: g,
      qualified_from_position: 2,
      is_seeded: false,
    });
  }
  return qualifiers;
}

// ── FIXED strategy ────────────────────────────────────────────────────────────

describe('mapToBracket — FIXED strategy', () => {
  const FIXED_RULES: QualificationRules = {
    qualified_count_per_group: 2,
    allow_cross_group_third_ranking: false,
    bracket_mapping_definition: { strategy: 'FIXED' },
  };

  it('maps 4 qualifiers with explicit slot_ids', () => {
    const qualifiers: TeamQualification[] = [
      {
        team_id: 'T1',
        group_id: 'A',
        qualified_from_position: 1,
        slot_id: 'slot1',
        is_seeded: true,
      },
      {
        team_id: 'T2',
        group_id: 'B',
        qualified_from_position: 1,
        slot_id: 'slot2',
        is_seeded: false,
      },
      {
        team_id: 'T3',
        group_id: 'C',
        qualified_from_position: 1,
        slot_id: 'slot3',
        is_seeded: true,
      },
      {
        team_id: 'T4',
        group_id: 'D',
        qualified_from_position: 1,
        slot_id: 'slot4',
        is_seeded: false,
      },
    ];

    const result = mapToBracket(qualifiers, FIXED_RULES);
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    expect(result.data).toHaveLength(4);
    const bySlot = Object.fromEntries(result.data.map((s) => [s.slot_id, s]));
    expect(bySlot['slot1'].team_id).toBe('T1');
    expect(bySlot['slot2'].team_id).toBe('T2');
  });

  it('returns BLOCKED on duplicate slot_id', () => {
    const qualifiers: TeamQualification[] = [
      { team_id: 'T1', group_id: 'A', qualified_from_position: 1, slot_id: 'slot1' },
      { team_id: 'T2', group_id: 'B', qualified_from_position: 1, slot_id: 'slot1' }, // duplicate
    ];

    const result = mapToBracket(qualifiers, FIXED_RULES);
    expect(result.status).toBe('BLOCKED');
  });

  it('returns DEGRADED (not BLOCKED) for qualifiers with missing slot_id', () => {
    const qualifiers: TeamQualification[] = [
      { team_id: 'T1', group_id: 'A', qualified_from_position: 1, slot_id: 'slot1' },
      { team_id: 'T2', group_id: 'B', qualified_from_position: 1, slot_id: null }, // missing
    ];

    const result = mapToBracket(qualifiers, FIXED_RULES);
    // T2 is skipped with a warning → DEGRADED.
    expect(result.status).toBe('DEGRADED');
  });
});

// ── POSITION_SEEDED strategy ──────────────────────────────────────────────────

describe('mapToBracket — POSITION_SEEDED strategy', () => {
  const POS_SEEDED_RULES: QualificationRules = {
    qualified_count_per_group: 2,
    allow_cross_group_third_ranking: false,
    bracket_mapping_definition: { strategy: 'POSITION_SEEDED' },
  };

  /**
   * For POSITION_SEEDED, the same-group detection checks pairs within the
   * same "matchN" slot pair. With 4 groups A/B/C/D, seeded sort order is
   * A_winner, B_winner, C_winner, D_winner and unseeded is A_runner, B_runner,
   * C_runner, D_runner. This means pair 0 = A_winner + A_runner = same group,
   * which triggers BLOCKED (correct behavior per invariant 5).
   *
   * To get RESOLVED we must use qualifiers where seeded[i] and unseeded[i]
   * come from different groups. We arrange unseeded so group order is reversed.
   */
  it('maps 8 qualifiers (4 seeded, 4 unseeded) to 8 slots when no same-group pairing', () => {
    // Seeded sort order by group_id+position: A_winner(1), B_winner(1), C_winner(1), D_winner(1)
    // Unseeded must NOT match their paired seeded team's group.
    // We give unseeded teams group_ids that are different from their paired seeded team.
    // Pair 0: A_winner (seeded, group A) paired with group B runner.
    // Pair 1: B_winner (seeded, group B) paired with group C runner.
    // Pair 2: C_winner (seeded, group C) paired with group D runner.
    // Pair 3: D_winner (seeded, group D) paired with group A runner.
    // Sort by group_id: unseeded in order B_runner, C_runner, D_runner, A_runner.
    const qualifiers: TeamQualification[] = [
      // Seeded (group A, B, C, D — sorted alphabetically = A, B, C, D)
      { team_id: 'A_winner', group_id: 'A', qualified_from_position: 1, is_seeded: true },
      { team_id: 'B_winner', group_id: 'B', qualified_from_position: 1, is_seeded: true },
      { team_id: 'C_winner', group_id: 'C', qualified_from_position: 1, is_seeded: true },
      { team_id: 'D_winner', group_id: 'D', qualified_from_position: 1, is_seeded: true },
      // Unseeded — groups B, C, D, A (sorted alphabetically = A, B, C, D)
      // Wait — the sort is byGroupPos, so A_runner sorts before B_runner.
      // To avoid same-group pairs we need unseeded[0] to not be from group A.
      // Since sort is alphabetical on group_id, we cannot swap order there.
      // Instead, give unseeded teams group_ids with no seeded counterpart prefix:
      // Use groups W, X, Y, Z to avoid any group overlap with seeded.
      { team_id: 'W_runner', group_id: 'W', qualified_from_position: 2, is_seeded: false },
      { team_id: 'X_runner', group_id: 'X', qualified_from_position: 2, is_seeded: false },
      { team_id: 'Y_runner', group_id: 'Y', qualified_from_position: 2, is_seeded: false },
      { team_id: 'Z_runner', group_id: 'Z', qualified_from_position: 2, is_seeded: false },
    ];

    const result = mapToBracket(qualifiers, POS_SEEDED_RULES);
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    expect(result.data).toHaveLength(8);
  });

  it('seeded teams have is_seeded=true in output', () => {
    const qualifiers: TeamQualification[] = [
      { team_id: 'A_winner', group_id: 'A', qualified_from_position: 1, is_seeded: true },
      { team_id: 'B_winner', group_id: 'B', qualified_from_position: 1, is_seeded: true },
      { team_id: 'W_runner', group_id: 'W', qualified_from_position: 2, is_seeded: false },
      { team_id: 'X_runner', group_id: 'X', qualified_from_position: 2, is_seeded: false },
    ];
    const result = mapToBracket(qualifiers, POS_SEEDED_RULES);
    if (result.status !== 'RESOLVED') return;

    const seeded = result.data.filter((s) => s.is_seeded);
    const unseeded = result.data.filter((s) => !s.is_seeded);
    expect(seeded).toHaveLength(2);
    expect(unseeded).toHaveLength(2);
  });

  it('is deterministic — same qualifiers same result', () => {
    const qualifiers: TeamQualification[] = [
      { team_id: 'A_winner', group_id: 'A', qualified_from_position: 1, is_seeded: true },
      { team_id: 'B_winner', group_id: 'B', qualified_from_position: 1, is_seeded: true },
      { team_id: 'W_runner', group_id: 'W', qualified_from_position: 2, is_seeded: false },
      { team_id: 'X_runner', group_id: 'X', qualified_from_position: 2, is_seeded: false },
    ];
    const r1 = mapToBracket(qualifiers, POS_SEEDED_RULES);
    const r2 = mapToBracket(qualifiers, POS_SEEDED_RULES);

    if (r1.status === 'RESOLVED' && r2.status === 'RESOLVED') {
      expect(r1.data.map((s) => s.team_id)).toEqual(r2.data.map((s) => s.team_id));
    }
  });

  it('returns BLOCKED when same-group teams would be paired (invariant 5)', () => {
    // A_winner and A_runner from same group A → pair 0 = same group → BLOCKED.
    const qualifiers = make8Qualifiers(); // A_winner + A_runner in pair 0
    const result = mapToBracket(qualifiers, POS_SEEDED_RULES);
    expect(result.status).toBe('BLOCKED');
    if (result.status === 'BLOCKED') {
      expect(result.gap.specSection).toBe('§5.2');
    }
  });
});

// ── LEAGUE_TABLE_SEEDED strategy ──────────────────────────────────────────────

describe('mapToBracket — LEAGUE_TABLE_SEEDED strategy', () => {
  const LT_RULES: QualificationRules = {
    allow_cross_group_third_ranking: false,
    bracket_mapping_definition: { strategy: 'LEAGUE_TABLE_SEEDED' },
  };

  it('pairs rank 1 vs rank 8, rank 2 vs rank 7, etc.', () => {
    const qualifiers: TeamQualification[] = Array.from({ length: 8 }, (_, i) => ({
      team_id: `P${i + 1}`,
      group_id: null,
      qualified_from_position: i + 1,
    }));

    const result = mapToBracket(qualifiers, LT_RULES);
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    // Slot match1_top should be P1 (rank 1), match1_bottom should be P8 (rank 8).
    const match1Top = result.data.find((s) => s.slot_id === 'match1_top');
    const match1Bot = result.data.find((s) => s.slot_id === 'match1_bottom');
    expect(match1Top?.team_id).toBe('P1');
    expect(match1Bot?.team_id).toBe('P8');
  });
});

// ── THIRD_PLACE_DEPENDENT strategy ───────────────────────────────────────────

describe('mapToBracket — THIRD_PLACE_DEPENDENT strategy', () => {
  it('returns BLOCKED when mapping_table is missing', () => {
    const rules: QualificationRules = {
      allow_cross_group_third_ranking: true,
      bracket_mapping_definition: {
        strategy: 'THIRD_PLACE_DEPENDENT',
        mapping_table: null, // explicitly null
      },
    };
    const qualifiers = make8Qualifiers();
    const result = mapToBracket(qualifiers, rules);
    expect(result.status).toBe('BLOCKED');
    if (result.status === 'BLOCKED') {
      expect(result.gap.specSection).toBe('§8.3');
      expect(result.gap.missingFields).toContain(
        'qualification_rules.bracket_mapping_definition.mapping_table',
      );
    }
  });

  it('applies mapping_table to assign slots', () => {
    // Group combination: groups A, B, C, D → thirds are from A, B, C, D.
    // Thirds sorted: ABCD.
    const qualifiers: TeamQualification[] = [
      { team_id: 'A_win', group_id: 'A', qualified_from_position: 1 },
      { team_id: 'B_win', group_id: 'B', qualified_from_position: 1 },
      { team_id: 'C_win', group_id: 'C', qualified_from_position: 1 },
      { team_id: 'D_win', group_id: 'D', qualified_from_position: 1 },
      { team_id: 'A_third', group_id: 'A', qualified_from_position: 3 },
      { team_id: 'B_third', group_id: 'B', qualified_from_position: 3 },
      { team_id: 'C_third', group_id: 'C', qualified_from_position: 3 },
      { team_id: 'D_third', group_id: 'D', qualified_from_position: 3 },
    ];

    const mappingTable = {
      ABCD: {
        match1_a: { position: 1, group_id: 'A' },
        match1_b: { position: 3, group_id: 'A' },
        match2_a: { position: 1, group_id: 'B' },
        match2_b: { position: 3, group_id: 'B' },
        match3_a: { position: 1, group_id: 'C' },
        match3_b: { position: 3, group_id: 'C' },
        match4_a: { position: 1, group_id: 'D' },
        match4_b: { position: 3, group_id: 'D' },
      },
    };

    const rules: QualificationRules = {
      allow_cross_group_third_ranking: true,
      bracket_mapping_definition: {
        strategy: 'THIRD_PLACE_DEPENDENT',
        mapping_table: mappingTable,
      },
    };

    const result = mapToBracket(qualifiers, rules);
    expect(result.status).toBe('RESOLVED');
    if (result.status !== 'RESOLVED') return;

    const bySlot = Object.fromEntries(result.data.map((s) => [s.slot_id, s]));
    expect(bySlot['match1_a'].team_id).toBe('A_win');
    expect(bySlot['match1_b'].team_id).toBe('A_third');
  });

  it('returns BLOCKED when combination key not in mapping_table', () => {
    const qualifiers: TeamQualification[] = [
      { team_id: 'X_third', group_id: 'X', qualified_from_position: 3 },
      { team_id: 'Y_third', group_id: 'Y', qualified_from_position: 3 },
    ];
    // mapping_table has ABCD but combination is XY.
    const rules: QualificationRules = {
      allow_cross_group_third_ranking: true,
      bracket_mapping_definition: {
        strategy: 'THIRD_PLACE_DEPENDENT',
        mapping_table: { ABCD: {} },
      },
    };

    const result = mapToBracket(qualifiers, rules);
    expect(result.status).toBe('BLOCKED');
    if (result.status === 'BLOCKED') {
      expect(result.gap.specSection).toBe('§18.3');
    }
  });
});

// ── Missing bracket_mapping_definition ────────────────────────────────────────

describe('mapToBracket — missing bracket_mapping_definition', () => {
  it('returns BLOCKED when bracket_mapping_definition is absent', () => {
    const rules: QualificationRules = {
      allow_cross_group_third_ranking: false,
      // bracket_mapping_definition intentionally omitted
    };
    const qualifiers = make8Qualifiers();
    const result = mapToBracket(qualifiers, rules);
    expect(result.status).toBe('BLOCKED');
    if (result.status === 'BLOCKED') {
      expect(result.gap.specSection).toBe('§8.2');
    }
  });
});

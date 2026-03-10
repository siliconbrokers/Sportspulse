/**
 * competition-profile-validator.test.ts
 *
 * Tests for CompetitionProfile consistency validation.
 *
 * Spec authority: §8.3, §8.4
 * Acceptance matrix: §25.1 (schema validation suite)
 */

import { describe, it, expect } from 'vitest';
import { validateCompetitionProfile } from '../../src/validation/competition-profile-validator.js';
import type { CompetitionProfile } from '../../src/contracts/types/competition-profile.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

const BASE_PROFILE: CompetitionProfile = {
  competition_profile_version: '1.0',
  team_domain: 'CLUB',
  competition_family: 'DOMESTIC_LEAGUE',
  stage_type: 'QUALIFYING',
  format_type: 'ROUND_ROBIN',
  leg_type: 'SINGLE',
  neutral_venue: false,
};

const VALID_KNOCKOUT_TWO_LEG: CompetitionProfile = {
  competition_profile_version: '1.0',
  team_domain: 'CLUB',
  competition_family: 'DOMESTIC_CUP',
  stage_type: 'SEMI_FINAL',
  format_type: 'KNOCKOUT_TWO_LEG',
  leg_type: 'FIRST_LEG',
  neutral_venue: false,
  knockout_resolution_rules: {
    second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
    final_overrides_prior_round_rules: false,
  },
};

const VALID_GROUP_CLASSIC: CompetitionProfile = {
  competition_profile_version: '1.0',
  team_domain: 'CLUB',
  competition_family: 'INTERNATIONAL_CLUB',
  stage_type: 'GROUP_STAGE',
  format_type: 'GROUP_CLASSIC',
  leg_type: 'SINGLE',
  neutral_venue: false,
  group_ranking_rules: {
    points_win: 3,
    points_draw: 1,
    points_loss: 0,
    rank_by: ['POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR'],
  },
  qualification_rules: {
    qualified_count_per_group: 2,
    allow_cross_group_third_ranking: true,
  },
  tie_break_rules: {
    use_head_to_head: true,
    use_goal_difference: true,
    use_goals_for: true,
    use_fair_play: false,
    final_fallback: 'DRAW_LOT',
  },
};

// ── §8.3 consistency rule tests ───────────────────────────────────────────

describe('validateCompetitionProfile — §8.3 consistency rules', () => {
  it('accepts a valid ROUND_ROBIN profile', () => {
    const result = validateCompetitionProfile(BASE_PROFILE);
    expect(result.valid).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('accepts a valid GROUP_CLASSIC profile with all required sub-rules', () => {
    const result = validateCompetitionProfile(VALID_GROUP_CLASSIC);
    expect(result.valid).toBe(true);
  });

  it('accepts a valid KNOCKOUT_TWO_LEG profile', () => {
    const result = validateCompetitionProfile(VALID_KNOCKOUT_TWO_LEG);
    expect(result.valid).toBe(true);
  });

  it('rejects GROUP_CLASSIC without group_ranking_rules — §8.3', () => {
    const profile: CompetitionProfile = {
      ...VALID_GROUP_CLASSIC,
      group_ranking_rules: undefined,
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects GROUP_CLASSIC without qualification_rules — §7.3, §8.3', () => {
    const profile: CompetitionProfile = {
      ...VALID_GROUP_CLASSIC,
      qualification_rules: undefined,
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects GROUP_CLASSIC without tie_break_rules — §7.3, §8.3', () => {
    const profile: CompetitionProfile = {
      ...VALID_GROUP_CLASSIC,
      tie_break_rules: undefined,
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects LEAGUE_PHASE_SWISS_STYLE without league_phase_rules — §8.3', () => {
    const profile: CompetitionProfile = {
      competition_profile_version: '1.0',
      team_domain: 'CLUB',
      competition_family: 'INTERNATIONAL_CLUB',
      stage_type: 'LEAGUE_PHASE',
      format_type: 'LEAGUE_PHASE_SWISS_STYLE',
      leg_type: 'SINGLE',
      neutral_venue: false,
      // Missing: league_phase_rules, qualification_rules, tie_break_rules
      qualification_rules: {
        qualified_count_per_group: 8,
        allow_cross_group_third_ranking: false,
      },
      tie_break_rules: {
        use_head_to_head: false,
        use_goal_difference: true,
        use_goals_for: true,
        use_fair_play: false,
        final_fallback: 'ORGANIZER_DEFINED',
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects THIRD_PLACE_DEPENDENT bracket mapping without mapping_table — §8.3', () => {
    const profile: CompetitionProfile = {
      ...VALID_GROUP_CLASSIC,
      qualification_rules: {
        qualified_count_per_group: 2,
        allow_cross_group_third_ranking: true,
        bracket_mapping_definition: {
          strategy: 'THIRD_PLACE_DEPENDENT',
          mapping_table: null, // MUST exist when strategy = THIRD_PLACE_DEPENDENT
        },
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects SECOND_LEG without aggregate_state_before_match — §8.3, §7.3', () => {
    const profile: CompetitionProfile = {
      ...VALID_KNOCKOUT_TWO_LEG,
      leg_type: 'SECOND_LEG',
      aggregate_state_before_match: undefined, // missing
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('MISSING_AGGREGATE_STATE_FOR_SECOND_LEG');
  });

  it('accepts SECOND_LEG with aggregate_state_before_match present — §8.3', () => {
    const profile: CompetitionProfile = {
      ...VALID_KNOCKOUT_TWO_LEG,
      leg_type: 'SECOND_LEG',
      aggregate_state_before_match: {
        home_aggregate_goals: 1,
        away_aggregate_goals: 0,
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('rejects GROUP_STAGE stage_type paired with non-GROUP_CLASSIC format — §8.3', () => {
    const profile: CompetitionProfile = {
      ...BASE_PROFILE,
      stage_type: 'GROUP_STAGE',
      format_type: 'ROUND_ROBIN', // inconsistent with GROUP_STAGE
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects LEAGUE_PHASE stage_type paired with non-LEAGUE_PHASE_SWISS_STYLE format — §8.3', () => {
    const profile: CompetitionProfile = {
      ...BASE_PROFILE,
      stage_type: 'LEAGUE_PHASE',
      format_type: 'ROUND_ROBIN',
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects FINAL stage_type with ROUND_ROBIN format — §8.3', () => {
    const profile: CompetitionProfile = {
      ...BASE_PROFILE,
      stage_type: 'FINAL',
      format_type: 'ROUND_ROBIN',
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

// ── §8.4 KnockoutResolutionRules tests ────────────────────────────────────

describe('validateCompetitionProfile — §8.4 KnockoutResolutionRules', () => {
  it('rejects KNOCKOUT_TWO_LEG without knockout_resolution_rules — §7.3, §8.4', () => {
    const profile: CompetitionProfile = {
      ...VALID_KNOCKOUT_TWO_LEG,
      knockout_resolution_rules: undefined,
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('KNOCKOUT_RULES_UNAVAILABLE');
  });

  it('rejects KNOCKOUT_SINGLE_LEG without knockout_resolution_rules — §7.3, §8.4', () => {
    const profile: CompetitionProfile = {
      competition_profile_version: '1.0',
      team_domain: 'CLUB',
      competition_family: 'DOMESTIC_CUP',
      stage_type: 'ROUND_OF_16',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      neutral_venue: false,
      knockout_resolution_rules: undefined,
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('KNOCKOUT_RULES_UNAVAILABLE');
  });

  it('accepts KNOCKOUT_TWO_LEG with valid second_leg_resolution_order — §8.4', () => {
    const profile: CompetitionProfile = {
      ...VALID_KNOCKOUT_TWO_LEG,
      knockout_resolution_rules: {
        second_leg_resolution_order: ['AWAY_GOALS_AFTER_90', 'EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('rejects duplicate steps in second_leg_resolution_order — §8.4', () => {
    const profile: CompetitionProfile = {
      ...VALID_KNOCKOUT_TWO_LEG,
      knockout_resolution_rules: {
        second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES', 'EXTRA_TIME'], // duplicate
        final_overrides_prior_round_rules: false,
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects ORGANIZER_DEFINED as non-last in second_leg_resolution_order — §8.4', () => {
    const profile: CompetitionProfile = {
      ...VALID_KNOCKOUT_TWO_LEG,
      knockout_resolution_rules: {
        // ORGANIZER_DEFINED is at index 0, not last
        second_leg_resolution_order: ['ORGANIZER_DEFINED', 'EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('accepts ORGANIZER_DEFINED as last element in second_leg_resolution_order — §8.4', () => {
    const profile: CompetitionProfile = {
      ...VALID_KNOCKOUT_TWO_LEG,
      knockout_resolution_rules: {
        second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES', 'ORGANIZER_DEFINED'],
        final_overrides_prior_round_rules: false,
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('rejects duplicate steps in single_leg_resolution_order — §8.4', () => {
    const profile: CompetitionProfile = {
      competition_profile_version: '1.0',
      team_domain: 'CLUB',
      competition_family: 'DOMESTIC_CUP',
      stage_type: 'QUARTER_FINAL',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      neutral_venue: false,
      knockout_resolution_rules: {
        single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES', 'EXTRA_TIME'], // duplicate
        final_overrides_prior_round_rules: false,
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects ORGANIZER_DEFINED as non-last in single_leg_resolution_order — §8.4', () => {
    const profile: CompetitionProfile = {
      competition_profile_version: '1.0',
      team_domain: 'CLUB',
      competition_family: 'DOMESTIC_CUP',
      stage_type: 'QUARTER_FINAL',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      neutral_venue: false,
      knockout_resolution_rules: {
        single_leg_resolution_order: ['ORGANIZER_DEFINED', 'EXTRA_TIME'],
        final_overrides_prior_round_rules: false,
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('rejects empty second_leg_resolution_order array — §8.4', () => {
    const profile: CompetitionProfile = {
      ...VALID_KNOCKOUT_TWO_LEG,
      knockout_resolution_rules: {
        second_leg_resolution_order: [],
        final_overrides_prior_round_rules: false,
      },
    };
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

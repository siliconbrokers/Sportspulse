/**
 * TC-013 to TC-024 — CompetitionProfile and KnockoutResolutionRules conformance tests.
 *
 * Conformance Test Plan §B: CompetitionProfile y reglas knockout
 * Spec authority: §8.3, §8.4, §10.1, §10.2, §10.4, §10.5, §13.1, §18, §19.6
 */

import { describe, it, expect } from 'vitest';
import { validateCompetitionProfile } from '../../src/validation/competition-profile-validator.js';
import { validateMatch } from '../../src/validation/match-validator.js';
import type { MatchValidationContext } from '../../src/validation/match-validator.js';
import type { MatchInput } from '../../src/contracts/types/match-input.js';
import type {
  CompetitionProfile,
  KnockoutResolutionRules,
} from '../../src/contracts/types/competition-profile.js';

// ── Shared helpers ─────────────────────────────────────────────────────────

function baseProfile(overrides: Partial<CompetitionProfile> = {}): CompetitionProfile {
  return {
    competition_profile_version: '1.0',
    team_domain: 'CLUB',
    competition_family: 'DOMESTIC_LEAGUE',
    stage_type: 'REGULAR_SEASON',
    format_type: 'ROUND_ROBIN',
    leg_type: 'SINGLE',
    neutral_venue: false,
    ...overrides,
  } as CompetitionProfile;
}

function baseInput(profileOverrides: Partial<CompetitionProfile> = {}): MatchInput {
  return {
    schemaVersion: 1,
    match_id: 'profile-test',
    kickoff_utc: '2025-10-01T20:00:00Z',
    competition_id: 'comp:PL',
    season_id: '2025-26',
    home_team_id: 'team-A',
    away_team_id: 'team-B',
    home_team_domain_id: 'CLUB',
    away_team_domain_id: 'CLUB',
    competition_profile: baseProfile(profileOverrides),
    historical_context: {
      home_completed_official_matches_last_365d: 20,
      away_completed_official_matches_last_365d: 20,
      home_prior_rating_available: false,
      away_prior_rating_available: false,
    },
  } as MatchInput;
}

function baseCtx(profileOverrides: Partial<CompetitionProfile> = {}): MatchValidationContext {
  return {
    input: baseInput(profileOverrides),
    catalog_confirms_official_senior_11v11: true,
  };
}

// ── TC-013: stage_type inconsistente con format_type ──────────────────────

describe('TC-013 — stage_type inconsistente con format_type → INVALID_COMPETITION_PROFILE (§8.3)', () => {
  it('GROUP_STAGE con KNOCKOUT_TWO_LEG → inválido', () => {
    // Spec §8.3: "stage_type debe ser consistente con format_type"
    const profile = baseProfile({
      stage_type: 'GROUP_STAGE',
      format_type: 'KNOCKOUT_TWO_LEG',
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('FINAL con ROUND_ROBIN → inválido', () => {
    const profile = baseProfile({
      stage_type: 'FINAL',
      format_type: 'ROUND_ROBIN',
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });

  it('SEMI_FINAL con GROUP_CLASSIC → inválido', () => {
    const profile = baseProfile({
      stage_type: 'SEMI_FINAL',
      format_type: 'GROUP_CLASSIC',
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

// ── TC-014: THIRD_PLACE_DEPENDENT sin mapping_table ───────────────────────

describe('TC-014 — THIRD_PLACE_DEPENDENT sin mapping_table → CompetitionProfile inválido (§8.3, §18.3)', () => {
  it('FAIL: qualification_rules.bracket_mapping_definition.strategy = THIRD_PLACE_DEPENDENT sin mapping_table', () => {
    // Spec §8.3: "si strategy = THIRD_PLACE_DEPENDENT, debe existir mapping_table"
    const profile = baseProfile({
      format_type: 'GROUP_CLASSIC',
      stage_type: 'GROUP_STAGE',
      group_ranking_rules: {
        points_win: 3,
        points_draw: 1,
        points_loss: 0,
        rank_by: ['POINTS', 'GOAL_DIFFERENCE'],
      },
      qualification_rules: {
        qualified_count_per_group: 2,
        best_thirds_count: 4,
        allow_cross_group_third_ranking: true,
        bracket_mapping_definition: {
          strategy: 'THIRD_PLACE_DEPENDENT',
          mapping_table: null, // absent — violation
        },
      },
      tie_break_rules: {
        use_head_to_head: true,
        use_goal_difference: true,
        use_goals_for: false,
        use_fair_play: false,
        final_fallback: 'DRAW_LOT',
      },
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

// ── TC-015: second_leg_resolution_order used in KNOCKOUT_SINGLE_LEG ────────

describe('TC-015 — second_leg_resolution_order en KNOCKOUT_SINGLE_LEG → inválido (§8.4)', () => {
  it('FAIL: §8.4 second_leg_resolution_order solo aplica cuando format_type = KNOCKOUT_TWO_LEG', () => {
    // Spec §8.4: "second_leg_resolution_order solo aplica cuando format_type = KNOCKOUT_TWO_LEG"
    const profile = baseProfile({
      format_type: 'KNOCKOUT_SINGLE_LEG',
      stage_type: 'QUARTER_FINAL',
      leg_type: 'SINGLE',
      knockout_resolution_rules: {
        second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'], // invalid for SINGLE_LEG
        final_overrides_prior_round_rules: false,
      },
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

// ── TC-016: single_leg_resolution_order used in KNOCKOUT_TWO_LEG ──────────

describe('TC-016 — single_leg_resolution_order en KNOCKOUT_TWO_LEG → inválido (§8.4)', () => {
  it('FAIL: §8.4 single_leg_resolution_order solo aplica cuando format_type = KNOCKOUT_SINGLE_LEG', () => {
    // Spec §8.4: "single_leg_resolution_order solo aplica cuando format_type = KNOCKOUT_SINGLE_LEG"
    const profile = baseProfile({
      format_type: 'KNOCKOUT_TWO_LEG',
      stage_type: 'QUARTER_FINAL',
      leg_type: 'FIRST_LEG',
      knockout_resolution_rules: {
        single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'], // invalid for TWO_LEG
        final_overrides_prior_round_rules: false,
      },
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

// ── TC-017: Secuencia knockout con pasos repetidos ─────────────────────────

describe('TC-017 — Secuencia knockout con pasos repetidos → inválido (§8.4)', () => {
  it('FAIL: §8.4 "no pueden repetirse pasos dentro del mismo arreglo"', () => {
    // Spec §8.4: pasos repetidos en la secuencia knockout → inválido
    const profile = baseProfile({
      format_type: 'KNOCKOUT_TWO_LEG',
      stage_type: 'SEMI_FINAL',
      leg_type: 'FIRST_LEG',
      knockout_resolution_rules: {
        second_leg_resolution_order: ['EXTRA_TIME', 'EXTRA_TIME', 'PENALTIES'], // repeated EXTRA_TIME
        final_overrides_prior_round_rules: false,
      },
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

// ── TC-018: ORGANIZER_DEFINED no es último paso ────────────────────────────

describe('TC-018 — ORGANIZER_DEFINED no es último paso → inválido (§8.4)', () => {
  it('FAIL: §8.4 "si aparece ORGANIZER_DEFINED, debe ser el último elemento del arreglo"', () => {
    // Spec §8.4: ORGANIZER_DEFINED debe ser el ÚLTIMO elemento
    const profile = baseProfile({
      format_type: 'KNOCKOUT_SINGLE_LEG',
      stage_type: 'ROUND_OF_16',
      leg_type: 'SINGLE',
      knockout_resolution_rules: {
        single_leg_resolution_order: ['ORGANIZER_DEFINED', 'PENALTIES'], // ORGANIZER_DEFINED not last
        final_overrides_prior_round_rules: false,
      },
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

// ── TC-020: Secuencia knockout válida con precedencia inequívoca ───────────

describe('TC-020 — Secuencia knockout válida con precedencia inequívoca (§8.4, §18.2)', () => {
  it('PASS: second_leg_resolution_order = [AWAY_GOALS_AFTER_90, EXTRA_TIME, PENALTIES]', () => {
    // Spec §8.4 example: ["AWAY_GOALS_AFTER_90", "EXTRA_TIME", "PENALTIES"] → válido
    const profile = baseProfile({
      format_type: 'KNOCKOUT_TWO_LEG',
      stage_type: 'QUARTER_FINAL',
      leg_type: 'SECOND_LEG',
      aggregate_state_before_match: { home_aggregate_goals: 1, away_aggregate_goals: 1 },
      knockout_resolution_rules: {
        second_leg_resolution_order: ['AWAY_GOALS_AFTER_90', 'EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('PASS: single_leg_resolution_order = [EXTRA_TIME, PENALTIES]', () => {
    const profile = baseProfile({
      format_type: 'KNOCKOUT_SINGLE_LEG',
      stage_type: 'FINAL',
      leg_type: 'SINGLE',
      knockout_resolution_rules: {
        single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('PASS: single_leg_resolution_order = [PENALTIES]', () => {
    const profile = baseProfile({
      format_type: 'KNOCKOUT_SINGLE_LEG',
      stage_type: 'ROUND_OF_32',
      leg_type: 'SINGLE',
      knockout_resolution_rules: {
        single_leg_resolution_order: ['PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
    });
    const result = validateCompetitionProfile(profile);
    expect(result.valid).toBe(true);
  });
});

// ── TC-022: INTERNATIONAL_CLUB sin league_strength_factor → no FULL_MODE ──

describe('TC-022 — INTERNATIONAL_CLUB sin league_strength_factor válido → no FULL_MODE (§10.4, §13.1)', () => {
  it('FAIL: operatingMode = LIMITED_MODE; applicability_level != STRONG', () => {
    // Spec §10.4: "Si falta league_strength_factor válido para INTERNATIONAL_CLUB:
    //   - no puede operar en FULL_MODE"
    const profile = baseProfile({
      competition_family: 'INTERNATIONAL_CLUB',
      stage_type: 'GROUP_STAGE',
      format_type: 'GROUP_CLASSIC',
      group_ranking_rules: {
        points_win: 3,
        points_draw: 1,
        points_loss: 0,
        rank_by: ['POINTS', 'GOAL_DIFFERENCE'],
      },
      qualification_rules: {
        qualified_count_per_group: 2,
        allow_cross_group_third_ranking: false,
      },
      tie_break_rules: {
        use_head_to_head: true,
        use_goal_difference: true,
        use_goals_for: false,
        use_fair_play: false,
        final_fallback: 'DRAW_LOT',
      },
    });
    const ctx: MatchValidationContext = {
      input: baseInput(profile),
      catalog_confirms_official_senior_11v11: true,
      // No league_strength_factor provided → bridging unavailable
      home_league_strength_factor: null,
      away_league_strength_factor: null,
    };
    const result = validateMatch(ctx);
    // Spec §10.4: must degrade to LIMITED_MODE
    expect(result.operating_mode).toBe('LIMITED_MODE');
    expect(result.applicability_level).not.toBe('STRONG');
    expect(result.reasons).toContain('INTERLEAGUE_FACTOR_UNAVAILABLE');
  });
});

// ── TC-023: NATIONAL_TEAM no usa league_strength_factor ───────────────────

describe('TC-023 — NATIONAL_TEAM no usa league_strength_factor (§10.5, §19.6)', () => {
  it('PASS: Partido de selecciones elegible sin requerir league_strength_factor', () => {
    // Spec §10.5: NATIONAL_TEAM_TOURNAMENT no usa league_strength_factor
    // Si se inyecta un factor de liga para selecciones, no debería requerirlo para FULL_MODE
    const profile = baseProfile({
      team_domain: 'NATIONAL_TEAM',
      competition_family: 'NATIONAL_TEAM_TOURNAMENT',
      stage_type: 'GROUP_STAGE',
      format_type: 'GROUP_CLASSIC',
      group_ranking_rules: {
        points_win: 3,
        points_draw: 1,
        points_loss: 0,
        rank_by: ['POINTS', 'GOAL_DIFFERENCE'],
      },
      qualification_rules: {
        qualified_count_per_group: 2,
        allow_cross_group_third_ranking: false,
      },
      tie_break_rules: {
        use_head_to_head: true,
        use_goal_difference: true,
        use_goals_for: false,
        use_fair_play: false,
        final_fallback: 'DRAW_LOT',
      },
    });
    const ctx: MatchValidationContext = {
      input: {
        ...baseInput(profile),
        historical_context: {
          home_completed_official_matches_last_730d: 10,
          away_completed_official_matches_last_730d: 10,
          home_prior_rating_available: false,
          away_prior_rating_available: false,
        },
      } as MatchInput,
      catalog_confirms_official_senior_11v11: true,
      // No league_strength_factor — should be fine for NATIONAL_TEAM
      home_league_strength_factor: null,
      away_league_strength_factor: null,
    };
    const result = validateMatch(ctx);
    // Spec §10.5: NATIONAL_TEAM no usa league_strength_factor
    // Should not be NOT_ELIGIBLE due to missing bridging
    expect(result.reasons).not.toContain('INTERLEAGUE_FACTOR_UNAVAILABLE');
    // Must be eligible
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });
});

// ── TC-024: Pools de rating separados por dominio ─────────────────────────

describe('TC-024 — Pools de rating separados por dominio (§10.1, §19.6)', () => {
  it('FAIL: prior_rating_domain_mismatch → NOT_ELIGIBLE', () => {
    // Spec §10.1: club_rating_pool != national_team_rating_pool
    // Spec §20.2: prior_rating_domain_mismatch => NOT_ELIGIBLE
    const ctx: MatchValidationContext = {
      input: baseInput({ competition_profile: baseProfile({ team_domain: 'CLUB' }) }),
      catalog_confirms_official_senior_11v11: true,
      home_prior_rating: {
        team_id: 'team-A',
        team_domain: 'NATIONAL_TEAM', // MISMATCH: match is CLUB domain
        elo_value: 1500,
        last_updated_utc: '2025-01-01T00:00:00Z',
        updates_in_last_730d: 10,
        conditions: {
          domain_matches: false, // explicit mismatch
          age_within_limit: true,
          sufficient_updates_in_window: true,
          cross_season_carry_valid: true,
          is_utilizable: false, // not utilizable due to domain mismatch
        },
      },
    };
    const result = validateMatch(ctx);
    // Spec §19.6: domain mismatch → NOT_ELIGIBLE
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('INVALID_PRIOR_RATING');
  });
});

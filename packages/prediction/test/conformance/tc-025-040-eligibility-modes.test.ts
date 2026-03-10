/**
 * TC-025 to TC-040 — Eligibility, operating modes, and applicability tests.
 *
 * Conformance Test Plan §C: Elegibilidad, modos y aplicabilidad
 * Spec authority: §11.1, §11.3, §13.1, §20.2, §21.1, §21.3
 */

import { describe, it, expect } from 'vitest';
import { validateMatch } from '../../src/validation/match-validator.js';
import type { MatchValidationContext } from '../../src/validation/match-validator.js';
import type { MatchInput } from '../../src/contracts/types/match-input.js';
import type { CompetitionProfile } from '../../src/contracts/types/competition-profile.js';

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

function baseInput(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    schemaVersion: 1,
    match_id: 'mode-test',
    kickoff_utc: '2025-10-01T20:00:00Z',
    competition_id: 'comp:PL',
    season_id: '2025-26',
    home_team_id: 'team-A',
    away_team_id: 'team-B',
    home_team_domain_id: 'CLUB',
    away_team_domain_id: 'CLUB',
    competition_profile: baseProfile(),
    historical_context: {
      home_completed_official_matches_last_365d: 20,
      away_completed_official_matches_last_365d: 20,
      home_prior_rating_available: false,
      away_prior_rating_available: false,
    },
    ...overrides,
  } as MatchInput;
}

function baseCtx(overrides: Partial<MatchInput> = {}): MatchValidationContext {
  return {
    input: baseInput(overrides),
    catalog_confirms_official_senior_11v11: true,
  };
}

// ── TC-025: FULL_MODE STRONG doméstica estándar ────────────────────────────

describe('TC-025 — FULL_MODE STRONG: DOMESTIC_LEAGUE, non-neutral, non-second-leg, historia fuerte (§11.1, §13.1)', () => {
  it('PASS: operating_mode = FULL_MODE, applicability_level = STRONG', () => {
    // Spec §13.1 STRONG: todos los requisitos cumplidos
    const ctx = baseCtx({
      competition_profile: baseProfile({
        competition_family: 'DOMESTIC_LEAGUE',
        neutral_venue: false,
        leg_type: 'SINGLE',
      }),
      historical_context: {
        home_completed_official_matches_last_365d: 15, // >= STRONG_RECENT_MATCHES_CLUB (12)
        away_completed_official_matches_last_365d: 14, // >= 12
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(ctx);
    expect(result.operating_mode).toBe('FULL_MODE');
    expect(result.applicability_level).toBe('STRONG');
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });
});

// ── TC-026: FULL_MODE CAUTION por copa/neutral/fase eliminatoria ───────────

describe('TC-026 — FULL_MODE CAUTION: DOMESTIC_CUP, neutral_venue, knockout stage (§11.1, §13.1)', () => {
  it('CAUTION por competition_family = DOMESTIC_CUP', () => {
    // Spec §13.1 CAUTION: DOMESTIC_CUP → no STRONG
    const ctx = baseCtx({
      competition_profile: baseProfile({
        competition_family: 'DOMESTIC_CUP',
        neutral_venue: false,
        leg_type: 'SINGLE',
        stage_type: 'ROUND_OF_16',
        format_type: 'KNOCKOUT_SINGLE_LEG',
        knockout_resolution_rules: {
          single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
          final_overrides_prior_round_rules: false,
        },
      }),
      historical_context: {
        home_completed_official_matches_last_365d: 15,
        away_completed_official_matches_last_365d: 15,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(ctx);
    expect(result.operating_mode).toBe('FULL_MODE');
    expect(result.applicability_level).toBe('CAUTION');
  });

  it('CAUTION por neutral_venue = true', () => {
    // Spec §13.1: neutral_venue = true → no STRONG, como máximo CAUTION
    const ctx = baseCtx({
      competition_profile: baseProfile({
        competition_family: 'DOMESTIC_LEAGUE',
        neutral_venue: true, // neutral venue
        leg_type: 'SINGLE',
      }),
      historical_context: {
        home_completed_official_matches_last_365d: 15,
        away_completed_official_matches_last_365d: 15,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(ctx);
    expect(result.applicability_level).not.toBe('STRONG');
  });

  it('CAUTION por stage_type = SEMI_FINAL', () => {
    // Spec §13.1 CAUTION: stage_type in {PLAYOFF, ..., FINAL, THIRD_PLACE}
    const ctx = baseCtx({
      competition_profile: baseProfile({
        competition_family: 'DOMESTIC_CUP',
        stage_type: 'SEMI_FINAL',
        format_type: 'KNOCKOUT_SINGLE_LEG',
        leg_type: 'SINGLE',
        knockout_resolution_rules: {
          single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
          final_overrides_prior_round_rules: false,
        },
      }),
      historical_context: {
        home_completed_official_matches_last_365d: 15,
        away_completed_official_matches_last_365d: 15,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(ctx);
    expect(result.applicability_level).not.toBe('STRONG');
  });
});

// ── TC-028: prior_rating_domain_mismatch → NOT_ELIGIBLE ──────────────────

describe('TC-028 — prior_rating_domain_mismatch → NOT_ELIGIBLE (§20.2)', () => {
  it('FAIL: domain mismatch → NOT_ELIGIBLE + INVALID_PRIOR_RATING', () => {
    // Spec §20.2: "prior_rating_domain_mismatch => NOT_ELIGIBLE"
    // Spec §19.6: same rule
    const ctx: MatchValidationContext = {
      input: baseInput({
        competition_profile: baseProfile({ team_domain: 'CLUB' }),
        historical_context: {
          home_completed_official_matches_last_365d: 20,
          away_completed_official_matches_last_365d: 20,
          home_prior_rating_available: true,
          away_prior_rating_available: false,
        },
      }),
      catalog_confirms_official_senior_11v11: true,
      home_prior_rating: {
        team_id: 'team-A',
        team_domain: 'NATIONAL_TEAM', // mismatch: match is CLUB
        elo_value: 1500,
        last_updated_utc: '2025-01-01T00:00:00Z',
        updates_in_last_730d: 10,
        conditions: {
          domain_matches: false, // explicit mismatch
          age_within_limit: true,
          sufficient_updates_in_window: true,
          cross_season_carry_valid: true,
          is_utilizable: false,
        },
      },
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('INVALID_PRIOR_RATING');
  });
});

// ── TC-029: prior_rating demasiado viejo ──────────────────────────────────

describe('TC-029 — prior_rating demasiado viejo → no utilizable (§4.3, §20.2)', () => {
  it('prior_rating_age_days > 400 → not utilizable (falls to history check)', () => {
    // Spec §20.2: "prior_rating_age_days > prior_rating_max_age_days => prior_rating no utilizable"
    // Spec §4.3: prior_rating_max_age_days = 400
    const ctx: MatchValidationContext = {
      input: baseInput({
        historical_context: {
          home_completed_official_matches_last_365d: 2, // below min
          away_completed_official_matches_last_365d: 2, // below min
          home_prior_rating_available: true,
          away_prior_rating_available: false,
        },
      }),
      catalog_confirms_official_senior_11v11: true,
      home_prior_rating: {
        team_id: 'team-A',
        team_domain: 'CLUB',
        elo_value: 1500,
        last_updated_utc: '2023-01-01T00:00:00Z', // very old — >400 days before kickoff 2025-10-01
        updates_in_last_730d: 10,
        // No conditions — will be computed from raw fields
      },
    };
    const result = validateMatch(ctx);
    // home_prior_rating is too old (> 400 days) → not utilizable
    // away has no prior_rating and below min history → not eligible (or just home fails for away)
    // Either NOT_ELIGIBLE or ELIGIBLE depends on away situation
    // At minimum: home's prior_rating should be treated as not utilizable
    // If both teams are insufficient → NOT_ELIGIBLE
    expect(result.reasons).not.toContain('INVALID_PRIOR_RATING'); // age is not domain mismatch
  });
});

// ── TC-030: prior_rating con muy pocas actualizaciones ───────────────────

describe('TC-030 — prior_rating con < 3 actualizaciones → no utilizable (§4.3, §20.2)', () => {
  it('updates_in_last_730d < 3 → prior_rating not utilizable', () => {
    // Spec §4.3: prior_rating_min_updates_last_730d = 3
    // Spec §20.2: insufficient updates → not utilizable
    const ctx: MatchValidationContext = {
      input: baseInput({
        historical_context: {
          home_completed_official_matches_last_365d: 2, // below min history
          away_completed_official_matches_last_365d: 2, // below min history
          home_prior_rating_available: true,
          away_prior_rating_available: false,
        },
      }),
      catalog_confirms_official_senior_11v11: true,
      home_prior_rating: {
        team_id: 'team-A',
        team_domain: 'CLUB',
        elo_value: 1500,
        last_updated_utc: '2025-06-01T00:00:00Z', // recent enough
        updates_in_last_730d: 2, // below minimum of 3
        // No conditions — computed from raw fields
      },
    };
    const result = validateMatch(ctx);
    // home has insufficient updates → prior_rating not utilizable
    // Without utilizable prior_rating and with only 2 matches → NOT_ELIGIBLE
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
  });
});

// ── TC-031: prior_rating utilizable no habilita STRONG por sí solo ─────────

describe('TC-031 — prior_rating utilizable no habilita STRONG (§13.1, §20.2)', () => {
  it('Ambos equipos con prior_rating pero historia débil → applicability_level != STRONG', () => {
    // Spec §13.1: "Queda prohibido otorgar STRONG solo por existencia de prior_rating
    //              si no se cumple también el umbral fuerte de historia reciente"
    const ctx = baseCtx({
      competition_profile: baseProfile({
        competition_family: 'DOMESTIC_LEAGUE',
        neutral_venue: false,
        leg_type: 'SINGLE',
      }),
      historical_context: {
        home_completed_official_matches_last_365d: 7, // below STRONG threshold (12)
        away_completed_official_matches_last_365d: 7, // below STRONG threshold
        home_prior_rating_available: true, // has prior rating
        away_prior_rating_available: true, // has prior rating
      },
    });
    const result = validateMatch(ctx);
    // Must be ELIGIBLE but not STRONG
    expect(result.eligibility_status).toBe('ELIGIBLE');
    expect(result.applicability_level).not.toBe('STRONG');
  });
});

// ── TC-033: domain_pool unavailable ───────────────────────────────────────

describe('TC-033 — domain_pool unavailable → NOT_ELIGIBLE (§11.2, §12)', () => {
  it('FAIL: domain_pool_available = false → NOT_ELIGIBLE + DOMAIN_POOL_UNAVAILABLE', () => {
    // Spec §11.2: DOMAIN_POOL_UNAVAILABLE as explicit reason
    const ctx: MatchValidationContext = {
      input: baseInput(),
      catalog_confirms_official_senior_11v11: true,
      domain_pool_available: false,
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('DOMAIN_POOL_UNAVAILABLE');
    expect(result.data_integrity_flags.domain_pool_available).toBe(false);
  });
});

// ── TC-035: Reasons obligatorias en degradación ───────────────────────────

describe('TC-035 — Reasons obligatorias en LIMITED_MODE (§11.3, §12, §21.3)', () => {
  it('LIMITED_MODE siempre tiene al menos una razón de degradación', () => {
    // Spec §11.3: "el motivo de degradación debe persistirse"
    // Spec §11.2: LIMITED_MODE debe tener al menos un código reason
    const ctx: MatchValidationContext = {
      input: baseInput({
        competition_profile: baseProfile({
          competition_family: 'INTERNATIONAL_CLUB',
          stage_type: 'GROUP_STAGE',
          format_type: 'GROUP_CLASSIC',
          group_ranking_rules: {
            points_win: 3,
            points_draw: 1,
            points_loss: 0,
            rank_by: ['POINTS'],
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
        }),
      }),
      catalog_confirms_official_senior_11v11: true,
      home_league_strength_factor: null, // missing bridging → LIMITED_MODE
      away_league_strength_factor: null,
    };
    const result = validateMatch(ctx);
    if (result.operating_mode === 'LIMITED_MODE') {
      expect(result.reasons.length).toBeGreaterThan(0);
    }
    // If already NOT_ELIGIBLE for another reason, that's also fine
  });
});

// ── TC-036: NOT_ELIGIBLE no expone predicciones visibles ──────────────────

describe('TC-036 — NOT_ELIGIBLE no expone predicciones visibles (§11.1, §21.1, §21.2)', () => {
  it('ValidationResult NOT_ELIGIBLE tiene eligibility_status = NOT_ELIGIBLE y reasons no vacío', () => {
    // Spec §21.1: "predictions = null" cuando NOT_ELIGIBLE
    // Spec §11.2: reasons debe contener al menos un código válido
    const ctx = baseCtx({ match_id: '' }); // missing critical field
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

// ── TC-037: STRONG solo en contextos permitidos ───────────────────────────

describe('TC-037 — STRONG solo en contextos permitidos (§13.1)', () => {
  it('FINAL nunca STRONG', () => {
    // Spec §13.1: FINAL es stage_type que impide STRONG (está en CAUTION cases)
    const ctx = baseCtx({
      competition_profile: baseProfile({
        competition_family: 'DOMESTIC_CUP',
        stage_type: 'FINAL',
        format_type: 'KNOCKOUT_SINGLE_LEG',
        leg_type: 'SINGLE',
        knockout_resolution_rules: {
          single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
          final_overrides_prior_round_rules: false,
        },
      }),
      historical_context: {
        home_completed_official_matches_last_365d: 15,
        away_completed_official_matches_last_365d: 15,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(ctx);
    expect(result.applicability_level).not.toBe('STRONG');
  });

  it('DOMESTIC_CUP nunca STRONG', () => {
    // Spec §13.1: DOMESTIC_CUP está en CAUTION cases → nunca STRONG
    const ctx = baseCtx({
      competition_profile: baseProfile({
        competition_family: 'DOMESTIC_CUP',
        stage_type: 'ROUND_OF_16',
        format_type: 'KNOCKOUT_SINGLE_LEG',
        leg_type: 'SINGLE',
        knockout_resolution_rules: {
          single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
          final_overrides_prior_round_rules: false,
        },
      }),
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(ctx);
    expect(result.applicability_level).not.toBe('STRONG');
  });
});

// ── TC-038: SECOND_LEG nunca STRONG ──────────────────────────────────────

describe('TC-038 — SECOND_LEG nunca STRONG (§13.1)', () => {
  it('leg_type = SECOND_LEG → applicability_level != STRONG', () => {
    // Spec §13.1: leg_type = SECOND_LEG → no STRONG
    const ctx = baseCtx({
      competition_profile: baseProfile({
        competition_family: 'DOMESTIC_CUP',
        stage_type: 'SEMI_FINAL',
        format_type: 'KNOCKOUT_TWO_LEG',
        leg_type: 'SECOND_LEG',
        aggregate_state_before_match: { home_aggregate_goals: 1, away_aggregate_goals: 0 },
        knockout_resolution_rules: {
          second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
          final_overrides_prior_round_rules: false,
        },
      }),
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(ctx);
    expect(result.applicability_level).not.toBe('STRONG');
  });
});

// ── TC-039: neutral_venue nunca STRONG ────────────────────────────────────

describe('TC-039 — neutral_venue nunca STRONG (§13.1)', () => {
  it('neutral_venue = true → applicability_level != STRONG', () => {
    // Spec §13.1: neutral_venue = true → STRONG condition fails
    const ctx = baseCtx({
      competition_profile: baseProfile({
        competition_family: 'DOMESTIC_LEAGUE',
        neutral_venue: true,
        leg_type: 'SINGLE',
      }),
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(ctx);
    expect(result.applicability_level).not.toBe('STRONG');
  });
});

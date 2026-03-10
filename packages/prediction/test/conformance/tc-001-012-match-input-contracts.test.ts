/**
 * TC-001 to TC-012 — MatchInput contract conformance tests.
 *
 * Conformance Test Plan §A: Contratos y MatchInput
 * Spec authority: §7.1, §7.2, §7.3, §7.4, §7.5, §7.6, §7.7, §11.2, §12
 *
 * Each test explicitly references its TC-XXX ID from the Conformance Test Plan.
 */

import { describe, it, expect } from 'vitest';
import { validateMatch } from '../../src/validation/match-validator.js';
import type { MatchValidationContext } from '../../src/validation/match-validator.js';
import type { MatchInput } from '../../src/contracts/types/match-input.js';
import type { CompetitionProfile } from '../../src/contracts/types/competition-profile.js';

// ── Shared fixture builder ─────────────────────────────────────────────────

function baseProfile(): CompetitionProfile {
  return {
    competition_profile_version: '1.0',
    team_domain: 'CLUB',
    competition_family: 'DOMESTIC_LEAGUE',
    stage_type: 'REGULAR_SEASON',
    format_type: 'ROUND_ROBIN',
    leg_type: 'SINGLE',
    neutral_venue: false,
  } as CompetitionProfile;
}

function baseInput(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    schemaVersion: 1,
    match_id: 'match-001',
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

function baseContext(inputOverrides: Partial<MatchInput> = {}): MatchValidationContext {
  return {
    input: baseInput(inputOverrides),
    catalog_confirms_official_senior_11v11: true,
  };
}

// ── TC-001: MatchInput mínimo válido ───────────────────────────────────────

describe('TC-001 — MatchInput mínimo válido para partido elegible (§7.1, §7.2, §12)', () => {
  it('PASS: ValidationResult elegible, sin razones de fallo por campos críticos', () => {
    // Spec §7.1: campos críticos presentes; §12: ValidationResult shape
    const result = validateMatch(baseContext());
    expect(result.eligibility_status).toBe('ELIGIBLE');
    expect(result.reasons).not.toContain('MISSING_CRITICAL_FIELD');
  });
});

// ── TC-002: Falta match_id ─────────────────────────────────────────────────

describe('TC-002 — Falta match_id → NOT_ELIGIBLE (§7.2, §11.2)', () => {
  it('FAIL: eligibility_status = NOT_ELIGIBLE; reasons incluye MISSING_CRITICAL_FIELD', () => {
    // Spec §7.2: match_id es campo crítico. Ausencia → NOT_ELIGIBLE.
    const ctx = baseContext({ match_id: '' });
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('MISSING_CRITICAL_FIELD');
  });
});

// ── TC-003: Falta competition_profile.team_domain ─────────────────────────

describe('TC-003 — Falta competition_profile.team_domain → NOT_ELIGIBLE (§7.2, §11.2)', () => {
  it('FAIL: NOT_ELIGIBLE; reasons incluye MISSING_CRITICAL_FIELD o INVALID_COMPETITION_PROFILE', () => {
    // Spec §7.2: competition_profile.team_domain es campo crítico
    const profile = { ...baseProfile(), team_domain: undefined } as unknown as CompetitionProfile;
    const ctx: MatchValidationContext = {
      input: baseInput({ competition_profile: profile }),
      catalog_confirms_official_senior_11v11: true,
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    const hasMissingOrInvalid =
      result.reasons.includes('MISSING_CRITICAL_FIELD') ||
      result.reasons.includes('INVALID_COMPETITION_PROFILE');
    expect(hasMissingOrInvalid).toBe(true);
  });
});

// ── TC-004: SECOND_LEG sin aggregate_state_before_match ───────────────────

describe('TC-004 — SECOND_LEG sin aggregate_state_before_match → NOT_ELIGIBLE (§7.3, §8.1, §11.2, §19.6)', () => {
  it('FAIL: NOT_ELIGIBLE; reasons incluye MISSING_AGGREGATE_STATE_FOR_SECOND_LEG', () => {
    // Spec §7.3: SECOND_LEG requiere aggregate_state_before_match
    // Spec §8.4: ausencia → CompetitionProfile inválido
    const profile: CompetitionProfile = {
      ...baseProfile(),
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      stage_type: 'SEMI_FINAL',
      knockout_resolution_rules: {
        second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
        final_overrides_prior_round_rules: false,
      },
      // aggregate_state_before_match intentionally absent
    } as CompetitionProfile;
    const ctx: MatchValidationContext = {
      input: baseInput({ competition_profile: profile }),
      catalog_confirms_official_senior_11v11: true,
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('MISSING_AGGREGATE_STATE_FOR_SECOND_LEG');
  });
});

// ── TC-005: GROUP_CLASSIC sin reglas de grupo ──────────────────────────────

describe('TC-005 — GROUP_CLASSIC sin group_ranking_rules → CompetitionProfile inválido (§7.3, §8.3)', () => {
  it('FAIL: NOT_ELIGIBLE o CompetitionProfile inválido', () => {
    // Spec §7.3, §8.3: GROUP_CLASSIC requiere group_ranking_rules + qualification_rules + tie_break_rules
    const profile: CompetitionProfile = {
      ...baseProfile(),
      format_type: 'GROUP_CLASSIC',
      stage_type: 'GROUP_STAGE',
      // group_ranking_rules: absent
    } as CompetitionProfile;
    const ctx: MatchValidationContext = {
      input: baseInput({ competition_profile: profile }),
      catalog_confirms_official_senior_11v11: true,
    };
    const result = validateMatch(ctx);
    // Must not be ELIGIBLE in FULL_MODE
    const isInvalid =
      result.eligibility_status === 'NOT_ELIGIBLE' || result.operating_mode === 'NOT_ELIGIBLE';
    expect(isInvalid).toBe(true);
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

// ── TC-006: LEAGUE_PHASE sin league_phase_rules ───────────────────────────

describe('TC-006 — LEAGUE_PHASE sin league_phase_rules → CompetitionProfile inválido (§7.3, §8.3)', () => {
  it('FAIL: NOT_ELIGIBLE; reasons incluye INVALID_COMPETITION_PROFILE', () => {
    // Spec §7.3, §8.3: LEAGUE_PHASE_SWISS_STYLE requiere league_phase_rules
    const profile: CompetitionProfile = {
      ...baseProfile(),
      format_type: 'LEAGUE_PHASE_SWISS_STYLE',
      stage_type: 'LEAGUE_PHASE',
      // league_phase_rules: absent
    } as CompetitionProfile;
    const ctx: MatchValidationContext = {
      input: baseInput({ competition_profile: profile }),
      catalog_confirms_official_senior_11v11: true,
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('INVALID_COMPETITION_PROFILE');
  });
});

// ── TC-007: Historia mínima CLUB satisfecha por prior_rating ──────────────

describe('TC-007 — Historia mínima CLUB satisfecha por prior_rating utilizable (§7.4, §20.1, §20.2)', () => {
  it('PASS: No cae por historia mínima cuando prior_rating está disponible', () => {
    // Spec §7.4: equipo debe tener ≥5 partidos en 365d O prior_rating utilizable
    const ctx: MatchValidationContext = {
      input: baseInput({
        historical_context: {
          home_completed_official_matches_last_365d: 2, // below minimum
          away_completed_official_matches_last_365d: 2, // below minimum
          home_prior_rating_available: true, // has prior rating
          away_prior_rating_available: true, // has prior rating
        },
      }),
      catalog_confirms_official_senior_11v11: true,
    };
    const result = validateMatch(ctx);
    // Should be ELIGIBLE (not fail on history minimum)
    expect(result.eligibility_status).toBe('ELIGIBLE');
    expect(result.reasons).not.toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });
});

// ── TC-008: Sin historia mínima ni prior_rating ────────────────────────────

describe('TC-008 — Sin historia mínima ni prior_rating → NOT_ELIGIBLE (§7.4, §11.2, §20.1)', () => {
  it('FAIL: NOT_ELIGIBLE; reasons incluye insufficient history code', () => {
    // Spec §7.4: sin historia mínima NI prior_rating → NOT_ELIGIBLE
    const ctx: MatchValidationContext = {
      input: baseInput({
        historical_context: {
          home_completed_official_matches_last_365d: 2,
          away_completed_official_matches_last_365d: 2,
          home_prior_rating_available: false,
          away_prior_rating_available: false,
        },
      }),
      catalog_confirms_official_senior_11v11: true,
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    // Spec §11.2 catalog code for this failure
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });
});

// ── TC-009: Ventanas históricas correctas por dominio ──────────────────────

describe('TC-009 — Ventanas históricas correctas por dominio (§7.4)', () => {
  it('CLUB: usa ventana de 365 días', () => {
    // Spec §7.4: CLUB → completed_official_matches_last_365d >= 5
    const ctx: MatchValidationContext = {
      input: baseInput({
        competition_profile: {
          ...baseProfile(),
          team_domain: 'CLUB',
        } as CompetitionProfile,
        historical_context: {
          home_completed_official_matches_last_365d: 5, // exactly min
          away_completed_official_matches_last_365d: 5, // exactly min
          home_prior_rating_available: false,
          away_prior_rating_available: false,
        },
      }),
      catalog_confirms_official_senior_11v11: true,
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });

  it('NATIONAL_TEAM: usa ventana de 730 días', () => {
    // Spec §7.4: NATIONAL_TEAM → completed_official_matches_last_730d >= 5
    const ctx: MatchValidationContext = {
      input: baseInput({
        competition_profile: {
          ...baseProfile(),
          team_domain: 'NATIONAL_TEAM',
          competition_family: 'NATIONAL_TEAM_TOURNAMENT',
        } as CompetitionProfile,
        historical_context: {
          home_completed_official_matches_last_365d: 2, // below 365d window
          away_completed_official_matches_last_365d: 2, // below 365d window
          home_completed_official_matches_last_730d: 5, // meets 730d window
          away_completed_official_matches_last_730d: 5, // meets 730d window
          home_prior_rating_available: false,
          away_prior_rating_available: false,
        },
      }),
      catalog_confirms_official_senior_11v11: true,
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });

  it('NATIONAL_TEAM: falla si no cumple ventana de 730 días ni tiene prior_rating', () => {
    // Spec §7.4: NATIONAL_TEAM sin 730d history NI prior_rating → NOT_ELIGIBLE
    const ctx: MatchValidationContext = {
      input: baseInput({
        competition_profile: {
          ...baseProfile(),
          team_domain: 'NATIONAL_TEAM',
          competition_family: 'NATIONAL_TEAM_TOURNAMENT',
        } as CompetitionProfile,
        historical_context: {
          home_completed_official_matches_last_365d: 8, // above 365d but wrong domain window
          away_completed_official_matches_last_365d: 8,
          home_completed_official_matches_last_730d: 3, // below 730d min
          away_completed_official_matches_last_730d: 3, // below 730d min
          home_prior_rating_available: false,
          away_prior_rating_available: false,
        },
      }),
      catalog_confirms_official_senior_11v11: true,
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
  });
});

// ── TC-010: Partido amistoso / fuera de alcance ────────────────────────────

describe('TC-010 — Partido fuera de alcance (no oficial/senior/11v11) → NOT_ELIGIBLE (§7.5, §7.6, §11.2)', () => {
  it('FAIL: catalog_confirms_official_senior_11v11 = false → NOT_ELIGIBLE con UNSUPPORTED_MATCH_TYPE', () => {
    // Spec §7.5: solo se aceptan partidos oficiales senior 11v11
    // Spec §7.6: clasificación debe venir del catálogo, no por heurística blanda
    const ctx: MatchValidationContext = {
      input: baseInput(),
      catalog_confirms_official_senior_11v11: false, // catálogo dice que no es oficial
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('UNSUPPORTED_MATCH_TYPE');
  });
});

// ── TC-011: No se permite inferir oficial/senior/11v11 por nombre libre ─────

describe('TC-011 — No inferir oficial/senior/11v11 por heurística blanda (§7.6)', () => {
  it('FAIL: sin confirmación del catálogo → NOT_ELIGIBLE (no heurística blanda)', () => {
    // Spec §7.6: "queda prohibido inferir esta clasificación por heurística blanda"
    // Cuando catalog_confirms es undefined/null → NOT_ELIGIBLE, no ELIGIBLE por deducción
    const ctx: MatchValidationContext = {
      input: baseInput(),
      catalog_confirms_official_senior_11v11: undefined, // ausente = no confirmado
    };
    const result = validateMatch(ctx);
    // Must be NOT_ELIGIBLE — no soft inference allowed
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('UNSUPPORTED_MATCH_TYPE');
  });
});

// ── TC-012: DOMAIN_POOL_UNAVAILABLE ───────────────────────────────────────

describe('TC-012 — Domain pool unavailable → NOT_ELIGIBLE (§11.2, §12)', () => {
  it('FAIL: domain_pool_available = false → NOT_ELIGIBLE con DOMAIN_POOL_UNAVAILABLE', () => {
    // Spec §11.2: DOMAIN_POOL_UNAVAILABLE es razón de fallo válida
    const ctx: MatchValidationContext = {
      input: baseInput(),
      catalog_confirms_official_senior_11v11: true,
      domain_pool_available: false,
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('DOMAIN_POOL_UNAVAILABLE');
  });
});

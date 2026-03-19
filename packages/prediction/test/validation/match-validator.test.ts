/**
 * match-validator.test.ts
 *
 * Tests for the main ValidationResult producer.
 *
 * Spec authority: §7.2, §7.3, §7.4, §7.6, §8.3, §8.4, §10.4, §11.1, §11.2, §11.3,
 *                 §12, §13.1, §19.6, §20.1, §20.2, §25.3
 *
 * Acceptance matrix IDs are mapped in comments per the SDD workflow.
 */

import { describe, it, expect } from 'vitest';
import { validateMatch } from '../../src/validation/match-validator.js';
import type { MatchValidationContext } from '../../src/validation/match-validator.js';
import type { MatchInput } from '../../src/contracts/types/match-input.js';
import type { CompetitionProfile } from '../../src/contracts/types/competition-profile.js';
import type { LeagueStrengthFactorRecord } from '../../src/contracts/types/league-strength.js';
import type { PriorRating } from '../../src/contracts/types/prior-rating.js';
import {
  isKnownOfficialSenior11v11,
  OFFICIAL_SENIOR_11V11_COMPETITION_IDS,
} from '../../src/contracts/constants.js';

// ── Test fixtures ──────────────────────────────────────────────────────────

const DOMESTIC_LEAGUE_PROFILE: CompetitionProfile = {
  competition_profile_version: '1.0',
  team_domain: 'CLUB',
  competition_family: 'DOMESTIC_LEAGUE',
  stage_type: 'QUALIFYING',
  format_type: 'ROUND_ROBIN',
  leg_type: 'SINGLE',
  neutral_venue: false,
};

const INTL_CLUB_PROFILE_GROUP: CompetitionProfile = {
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

const SECOND_LEG_PROFILE: CompetitionProfile = {
  competition_profile_version: '1.0',
  team_domain: 'CLUB',
  competition_family: 'DOMESTIC_CUP',
  stage_type: 'SEMI_FINAL',
  format_type: 'KNOCKOUT_TWO_LEG',
  leg_type: 'SECOND_LEG',
  neutral_venue: false,
  aggregate_state_before_match: {
    home_aggregate_goals: 1,
    away_aggregate_goals: 0,
  },
  knockout_resolution_rules: {
    second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
    final_overrides_prior_round_rules: false,
  },
};

/** Builds a fully valid MatchInput with the given profile. */
function makeFullInput(profile: CompetitionProfile, overrides?: Partial<MatchInput>): MatchInput {
  return {
    schemaVersion: 1,
    match_id: 'match-001',
    kickoff_utc: '2025-08-15T20:00:00Z',
    competition_id: 'PD',
    season_id: '2025-26',
    home_team_id: 'team-home',
    away_team_id: 'team-away',
    competition_profile: profile,
    home_team_domain_id: 'domain-esp',
    away_team_domain_id: 'domain-esp',
    historical_context: {
      home_completed_official_matches_last_365d: 20,
      away_completed_official_matches_last_365d: 18,
      home_prior_rating_available: false,
      away_prior_rating_available: false,
    },
    ...overrides,
  };
}

/** Builds a context that catalog-confirms the match as official/senior/11v11. */
function makeContext(
  input: MatchInput,
  lsfOverrides?: {
    home?: LeagueStrengthFactorRecord | null;
    away?: LeagueStrengthFactorRecord | null;
  },
): MatchValidationContext {
  return {
    input,
    catalog_confirms_official_senior_11v11: true,
    home_league_strength_factor: lsfOverrides?.home,
    away_league_strength_factor: lsfOverrides?.away,
  };
}

const VALID_LSF: LeagueStrengthFactorRecord = {
  league_strength_factor_version: '1.0',
  team_domain_id: 'domain-esp',
  value: 50,
  effective_from_utc: '2025-01-01T00:00:00Z',
  effective_to_utc: null,
  source: 'internal',
  confidence_level: 'HIGH',
};

// ── §7.2 Critical field absence → NOT_ELIGIBLE ────────────────────────────

describe('validateMatch — §7.2 critical field absence', () => {
  it('missing match_id → NOT_ELIGIBLE + MISSING_CRITICAL_FIELD', () => {
    // Acceptance matrix: §25.1 schema validation, §25.3 operating mode
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, { match_id: '' });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('MISSING_CRITICAL_FIELD');
  });

  it('missing kickoff_utc → NOT_ELIGIBLE + MISSING_CRITICAL_FIELD', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, { kickoff_utc: '' });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('MISSING_CRITICAL_FIELD');
  });

  it('missing competition_id → NOT_ELIGIBLE + MISSING_CRITICAL_FIELD', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, { competition_id: '' });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('MISSING_CRITICAL_FIELD');
  });

  it('missing home_team_id → NOT_ELIGIBLE + MISSING_CRITICAL_FIELD', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, { home_team_id: '' });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('MISSING_CRITICAL_FIELD');
  });

  it('missing season_id → NOT_ELIGIBLE + MISSING_CRITICAL_FIELD', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, { season_id: '' });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('MISSING_CRITICAL_FIELD');
  });

  it('same home and away team_id → NOT_ELIGIBLE', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      home_team_id: 'same-team',
      away_team_id: 'same-team',
    });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.data_integrity_flags.teams_distinct).toBe(false);
  });
});

// ── §7.6 catalog confirmation absence → NOT_ELIGIBLE ─────────────────────

describe('validateMatch — §7.6 official/senior/11v11 classification', () => {
  it('catalog_confirms missing → NOT_ELIGIBLE + UNSUPPORTED_MATCH_TYPE', () => {
    // §7.6: "queda prohibido inferir esta clasificación por heurística blanda"
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE);
    const result = validateMatch({
      input,
      catalog_confirms_official_senior_11v11: false,
    });
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('UNSUPPORTED_MATCH_TYPE');
  });

  it('catalog_confirms = null → NOT_ELIGIBLE', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE);
    const result = validateMatch({
      input,
      catalog_confirms_official_senior_11v11: null,
    });
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('UNSUPPORTED_MATCH_TYPE');
  });

  it('catalog_confirms = undefined → NOT_ELIGIBLE', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE);
    const result = validateMatch({ input });
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('UNSUPPORTED_MATCH_TYPE');
  });
});

// ── §7.3 SECOND_LEG without aggregate_state → NOT_ELIGIBLE ───────────────

describe('validateMatch — §7.3 conditionally required fields', () => {
  it('SECOND_LEG without aggregate_state → NOT_ELIGIBLE — §7.3', () => {
    const profileNoAgg: CompetitionProfile = {
      ...SECOND_LEG_PROFILE,
      aggregate_state_before_match: undefined,
    };
    const input = makeFullInput(profileNoAgg);
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('MISSING_AGGREGATE_STATE_FOR_SECOND_LEG');
  });

  it('KNOCKOUT_TWO_LEG without knockout_resolution_rules → NOT_ELIGIBLE — §7.3', () => {
    const profileNoKrr: CompetitionProfile = {
      ...SECOND_LEG_PROFILE,
      knockout_resolution_rules: undefined,
    };
    const input = makeFullInput(profileNoKrr);
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('KNOCKOUT_RULES_UNAVAILABLE');
  });
});

// ── §7.4 insufficient history, no prior_rating → NOT_ELIGIBLE ────────────

describe('validateMatch — §7.4 history and prior_rating eligibility', () => {
  it('club team with 0 matches and no prior_rating → NOT_ELIGIBLE — §7.4', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 0,
        away_completed_official_matches_last_365d: 10,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });

  it('club team with insufficient history but valid prior_rating → eligible — §7.4', () => {
    // Acceptance: §25.3 — LIMITED_MODE path (team enters only via prior_rating)
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 2, // < 5 (min)
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: true, // covers the gap
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    // Team enters via prior_rating → eligible, but applicability = WEAK (§20.2, §13.1)
    expect(result.operating_mode).not.toBe('NOT_ELIGIBLE');
    expect(result.applicability_level).toBe('WEAK');
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });

  it('both teams with sufficient history (5+) → FULL_MODE — §7.4, §11.1', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 10,
        away_completed_official_matches_last_365d: 8,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('FULL_MODE');
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });
});

// ── §10.4 INTERNATIONAL_CLUB without league_strength_factor → LIMITED_MODE

describe('validateMatch — §10.4 INTERNATIONAL_CLUB bridging', () => {
  it('INTERNATIONAL_CLUB without league_strength_factor → LIMITED_MODE + reason — §10.4', () => {
    // Acceptance matrix: §10.4, §25.3
    const input = makeFullInput(INTL_CLUB_PROFILE_GROUP, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    // No LSF provided
    const result = validateMatch(makeContext(input, { home: null, away: null }));
    expect(result.operating_mode).toBe('LIMITED_MODE');
    expect(result.eligibility_status).toBe('ELIGIBLE');
    expect(result.reasons).toContain('INTERLEAGUE_FACTOR_UNAVAILABLE');
    // §10.4 + §11.3: applicability must not be STRONG when LIMITED_MODE
    expect(result.applicability_level).not.toBe('STRONG');
    // §11.2: LIMITED_MODE must have at least one reason
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('INTERNATIONAL_CLUB with valid LSF → can be FULL_MODE — §10.4', () => {
    const input = makeFullInput(INTL_CLUB_PROFILE_GROUP, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input, { home: VALID_LSF, away: VALID_LSF }));
    expect(result.operating_mode).toBe('FULL_MODE');
    expect(result.reasons).not.toContain('INTERLEAGUE_FACTOR_UNAVAILABLE');
  });

  it('INTERNATIONAL_CLUB with LOW confidence bridging → CAUTION applicability — §13.1', () => {
    const lowLsf: LeagueStrengthFactorRecord = { ...VALID_LSF, confidence_level: 'LOW' };
    const input = makeFullInput(INTL_CLUB_PROFILE_GROUP, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input, { home: lowLsf, away: lowLsf }));
    expect(result.operating_mode).toBe('FULL_MODE');
    // §13.1: STRONG requires bridging confidence_level in {HIGH, MEDIUM}; LOW → CAUTION
    expect(result.applicability_level).toBe('CAUTION');
  });
});

// ── §13.1 applicability_level decision table ──────────────────────────────

describe('validateMatch — §13.1 applicability_level', () => {
  it('FULL_MODE + DOMESTIC_LEAGUE + both strong history + not neutral + not second_leg → STRONG', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 15, // >= 12 (STRONG_RECENT_MATCHES_CLUB)
        away_completed_official_matches_last_365d: 14,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    expect(result.applicability_level).toBe('STRONG');
    expect(result.operating_mode).toBe('FULL_MODE');
  });

  it('FULL_MODE + DOMESTIC_LEAGUE + one team below strong threshold → CAUTION — §13.1', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 15,
        away_completed_official_matches_last_365d: 8, // < 12 (STRONG_RECENT_MATCHES_CLUB)
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    expect(result.applicability_level).toBe('CAUTION');
  });

  it('FULL_MODE + neutral venue → CAUTION (§13.1 CAUTION condition)', () => {
    const neutralProfile: CompetitionProfile = {
      ...DOMESTIC_LEAGUE_PROFILE,
      neutral_venue: true,
    };
    const input = makeFullInput(neutralProfile, {
      historical_context: {
        home_completed_official_matches_last_365d: 15,
        away_completed_official_matches_last_365d: 14,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    expect(result.applicability_level).toBe('CAUTION');
  });

  it('FULL_MODE + SECOND_LEG → CAUTION (§13.1 CAUTION condition)', () => {
    const input = makeFullInput(SECOND_LEG_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 15,
        away_completed_official_matches_last_365d: 14,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    expect(result.applicability_level).toBe('CAUTION');
  });

  it('LIMITED_MODE → applicability is WEAK (§11.3, §13.1)', () => {
    const input = makeFullInput(INTL_CLUB_PROFILE_GROUP, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input, { home: null, away: null }));
    expect(result.operating_mode).toBe('LIMITED_MODE');
    expect(result.applicability_level).toBe('WEAK');
  });

  it('FULL_MODE STRONG is never granted from prior_rating alone — §13.1 anti-pattern guard', () => {
    // Team enters only via prior_rating (0 recent matches) → WEAK per §13.1 + §20.2
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 0,
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: true, // ONLY via prior_rating
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    // §13.1: "Queda prohibido otorgar STRONG solo por existencia de prior_rating"
    expect(result.applicability_level).not.toBe('STRONG');
    expect(result.applicability_level).toBe('WEAK');
  });
});

// ── §12 DataIntegrityFlags population ────────────────────────────────────

describe('validateMatch — §12 DataIntegrityFlags', () => {
  it('valid full input → all flags set correctly', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 15,
        away_completed_official_matches_last_365d: 14,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    const flags = result.data_integrity_flags;
    expect(flags.teams_distinct).toBe(true);
    expect(flags.kickoff_present).toBe(true);
    expect(flags.profile_complete).toBe(true);
    expect(flags.domain_pool_available).toBe(true);
    expect(flags.leakage_guard_passed).toBe(true);
  });

  it('SECOND_LEG with aggregate_state → aggregate_state_consistent_with_leg_type = true', () => {
    const input = makeFullInput(SECOND_LEG_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 15,
        away_completed_official_matches_last_365d: 14,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    expect(result.data_integrity_flags.aggregate_state_consistent_with_leg_type).toBe(true);
  });

  it('NOT_ELIGIBLE result → domain_pool_available = false in flags', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 0,
        away_completed_official_matches_last_365d: 0,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.data_integrity_flags.domain_pool_available).toBe(false);
  });
});

// ── §11.2 invariant: LIMITED_MODE always has ≥ 1 reason ──────────────────

describe('validateMatch — §11.2 reasons invariant', () => {
  it('LIMITED_MODE has at least one reason code — §11.2', () => {
    // Force LIMITED_MODE via missing LSF for INTERNATIONAL_CLUB
    const input = makeFullInput(INTL_CLUB_PROFILE_GROUP, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input, { home: null, away: null }));
    expect(result.operating_mode).toBe('LIMITED_MODE');
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
  });
});

// ── FULL_MODE happy path ──────────────────────────────────────────────────

describe('validateMatch — FULL_MODE happy path (§11.1)', () => {
  it('all fields present, strong history, domestic league → FULL_MODE + STRONG', () => {
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input));
    expect(result.operating_mode).toBe('FULL_MODE');
    expect(result.eligibility_status).toBe('ELIGIBLE');
    expect(result.applicability_level).toBe('STRONG');
    expect(result.reasons).toHaveLength(0);
    expect(result.data_integrity_flags.teams_distinct).toBe(true);
    expect(result.data_integrity_flags.kickoff_present).toBe(true);
    expect(result.data_integrity_flags.profile_complete).toBe(true);
  });
});

// ── CRITICAL-001/003: §19.6 + §20.2 — real PriorRating record enforcement ─

/**
 * Fixtures for PriorRating record tests.
 *
 * kickoff_utc in the MatchInput fixture = '2025-08-15T20:00:00Z'
 * A fresh rating (last_updated 30 days before kickoff) is utilizable.
 * A stale rating (last_updated 401 days before kickoff) is NOT utilizable.
 */
const FRESH_LAST_UPDATED = '2025-07-16T00:00:00Z'; // 30 days before kickoff
const STALE_LAST_UPDATED = '2024-07-06T00:00:00Z'; // ~406 days before kickoff

const VALID_PRIOR_RATING: PriorRating = {
  team_id: 'team-home',
  team_domain: 'CLUB', // matches DOMESTIC_LEAGUE_PROFILE.team_domain
  rating_value: 1500,
  last_updated_utc: FRESH_LAST_UPDATED,
  updates_in_last_730d: 10, // >= 3 (PRIOR_RATING_MIN_UPDATES_LAST_730D)
};

const DOMAIN_MISMATCH_PRIOR_RATING: PriorRating = {
  ...VALID_PRIOR_RATING,
  team_domain: 'NATIONAL_TEAM', // mismatch: competition is CLUB domain
};

const STALE_PRIOR_RATING: PriorRating = {
  ...VALID_PRIOR_RATING,
  last_updated_utc: STALE_LAST_UPDATED, // > 400 days → not utilizable
};

const LOW_UPDATES_PRIOR_RATING: PriorRating = {
  ...VALID_PRIOR_RATING,
  updates_in_last_730d: 2, // < 3 (PRIOR_RATING_MIN_UPDATES_LAST_730D) → not utilizable
};

const DOMAIN_MISMATCH_VIA_CONDITIONS: PriorRating = {
  ...VALID_PRIOR_RATING,
  team_domain: 'CLUB', // raw field matches, but conditions flag says false
  conditions: {
    domain_matches: false, // explicit domain mismatch signal
    age_within_limit: true,
    sufficient_updates_in_window: true,
    cross_season_carry_valid: true,
    is_utilizable: false,
  },
};

const FULLY_UTILIZABLE_VIA_CONDITIONS: PriorRating = {
  ...VALID_PRIOR_RATING,
  conditions: {
    domain_matches: true,
    age_within_limit: true,
    sufficient_updates_in_window: true,
    cross_season_carry_valid: true,
    is_utilizable: true,
  },
};

describe('validateMatch — CRITICAL-001/003: §19.6 + §20.2 real PriorRating enforcement', () => {
  // ── Domain mismatch → NOT_ELIGIBLE (§19.6, §20.2) ──

  it('home_prior_rating with team_domain NATIONAL_TEAM in CLUB competition → NOT_ELIGIBLE + INVALID_PRIOR_RATING', () => {
    // §19.6: prior_rating_domain_mismatch => NOT_ELIGIBLE — non-negotiable
    // §20.2 Condition 1: domain must match competition's team_domain
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 0, // needs prior_rating
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: true, // caller said available
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      home_prior_rating: DOMAIN_MISMATCH_PRIOR_RATING, // domain = NATIONAL_TEAM ≠ CLUB
    };
    const result = validateMatch(ctx);
    // §19.6: must be NOT_ELIGIBLE regardless of other signals
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('INVALID_PRIOR_RATING');
  });

  it('away_prior_rating with domain mismatch → NOT_ELIGIBLE + INVALID_PRIOR_RATING', () => {
    // §19.6: applies to either team's prior_rating
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 0,
        home_prior_rating_available: false,
        away_prior_rating_available: true,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      away_prior_rating: DOMAIN_MISMATCH_PRIOR_RATING, // domain mismatch
    };
    const result = validateMatch(ctx);
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('INVALID_PRIOR_RATING');
  });

  it('home_prior_rating with conditions.domain_matches=false → NOT_ELIGIBLE + INVALID_PRIOR_RATING', () => {
    // §20.2: when conditions object is present, domain_matches=false is definitive
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 0,
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: true,
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      home_prior_rating: DOMAIN_MISMATCH_VIA_CONDITIONS,
    };
    const result = validateMatch(ctx);
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('INVALID_PRIOR_RATING');
  });

  // ── Age threshold: > 400 days → not utilizable (§20.2) ──

  it('home_prior_rating age > 400 days → not utilizable → falls to history check', () => {
    // §20.2: prior_rating_age_days > prior_rating_max_age_days => not utilizable
    // The match is NOT_ELIGIBLE because the team has 0 history AND rating is not utilizable.
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 0, // no history
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: true, // caller said available (wrong)
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      home_prior_rating: STALE_PRIOR_RATING, // age > 400 days → not utilizable
    };
    const result = validateMatch(ctx);
    // Stale rating → not utilizable → no history → NOT_ELIGIBLE
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
    // Domain mismatch was NOT triggered (domain is correct) → no INVALID_PRIOR_RATING
    expect(result.reasons).not.toContain('INVALID_PRIOR_RATING');
  });

  it('home_prior_rating age > 400 days but team has sufficient history → ELIGIBLE (NOT_ELIGIBLE is not forced)', () => {
    // §20.2: stale rating is not utilizable, but team meets min history independently
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 10, // >= 5, meets min history
        away_completed_official_matches_last_365d: 15,
        home_prior_rating_available: true,
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      home_prior_rating: STALE_PRIOR_RATING, // stale → not utilizable, but history is fine
    };
    const result = validateMatch(ctx);
    // History covers the team even though rating is not utilizable
    expect(result.operating_mode).not.toBe('NOT_ELIGIBLE');
    expect(result.eligibility_status).toBe('ELIGIBLE');
  });

  // ── Insufficient updates: < 3 → not utilizable (§20.2) ──

  it('home_prior_rating with updates_in_last_730d < 3 → not utilizable → falls to history check', () => {
    // §20.2 Condition 3: updates_in_last_730d >= PRIOR_RATING_MIN_UPDATES_LAST_730D (3)
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 0, // no history
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: true,
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      home_prior_rating: LOW_UPDATES_PRIOR_RATING, // updates = 2 < 3
    };
    const result = validateMatch(ctx);
    // Not utilizable + no history → NOT_ELIGIBLE
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
    expect(result.reasons).not.toContain('INVALID_PRIOR_RATING');
  });

  // ── Valid PriorRating record with conditions → is_utilizable=true ──

  it('valid home_prior_rating with conditions.is_utilizable=true → eligible — §20.2', () => {
    // When conditions are pre-evaluated and is_utilizable=true, the rating counts
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 0, // team has no history
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: true,
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      home_prior_rating: FULLY_UTILIZABLE_VIA_CONDITIONS,
    };
    const result = validateMatch(ctx);
    // Valid rating + no domain mismatch → eligible, applicability = WEAK (§13.1)
    expect(result.operating_mode).not.toBe('NOT_ELIGIBLE');
    expect(result.eligibility_status).toBe('ELIGIBLE');
    expect(result.applicability_level).toBe('WEAK'); // §13.1: only via prior_rating → WEAK
  });

  it('fresh valid home_prior_rating without conditions (raw fields evaluated) → eligible', () => {
    // Engine provides record without pre-evaluated conditions; validator evaluates from raw fields
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 0, // team has no history
        away_completed_official_matches_last_365d: 20,
        home_prior_rating_available: true,
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      home_prior_rating: VALID_PRIOR_RATING, // no conditions field, raw fields are valid
    };
    const result = validateMatch(ctx);
    expect(result.operating_mode).not.toBe('NOT_ELIGIBLE');
    expect(result.eligibility_status).toBe('ELIGIBLE');
    expect(result.applicability_level).toBe('WEAK');
  });
});

// ── CRITICAL-004: §11.2 DOMAIN_POOL_UNAVAILABLE emitted when signalled ─────

describe('validateMatch — CRITICAL-004: §11.2 DOMAIN_POOL_UNAVAILABLE', () => {
  it('domain_pool_available=false → NOT_ELIGIBLE + DOMAIN_POOL_UNAVAILABLE', () => {
    // §11.2: DOMAIN_POOL_UNAVAILABLE is a valid reason code that must be emitted
    // when the domain pool for this team_domain is unavailable.
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      domain_pool_available: false, // explicit signal: pool not available
    };
    const result = validateMatch(ctx);
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('DOMAIN_POOL_UNAVAILABLE');
  });

  it('domain_pool_available=true → normal flow, no DOMAIN_POOL_UNAVAILABLE', () => {
    // When pool is explicitly available, no change to normal flow
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      ...makeContext(input),
      domain_pool_available: true,
    };
    const result = validateMatch(ctx);
    expect(result.operating_mode).toBe('FULL_MODE');
    expect(result.reasons).not.toContain('DOMAIN_POOL_UNAVAILABLE');
  });

  it('domain_pool_available=undefined → normal flow (default: available)', () => {
    // When field is absent, the default is pool available — backwards compatible
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const result = validateMatch(makeContext(input)); // no domain_pool_available field
    expect(result.operating_mode).toBe('FULL_MODE');
    expect(result.reasons).not.toContain('DOMAIN_POOL_UNAVAILABLE');
  });
});

// ── F-005: §7.6 isKnownOfficialSenior11v11 catalog lookup ─────────────────

/**
 * F-005 — catalog_confirms_official_senior_11v11 must come from a real catalog
 * lookup, never from a hardcoded true.
 *
 * §7.6: "la clasificación de partido como oficial, senior, 11v11 no viene
 * resuelta por flags ad hoc del MatchInput, sino por un catálogo confiable de
 * competición asociado a competition_id y season_id."
 *
 * §7.6 invariant: queda PROHIBIDO inferir esta clasificación por heurística
 * blanda o por nombre libre del torneo.
 */
describe('F-005 — §7.6 isKnownOfficialSenior11v11 catalog', () => {
  // ── MVP competitions must be in the catalog ──────────────────────────────

  it('PD (LaLiga short code) → true', () => {
    // §7.6 + §2.1: LaLiga is official/senior/11v11 in MVP scope
    expect(isKnownOfficialSenior11v11('PD')).toBe(true);
  });

  it('comp:football-data:PD (LaLiga namespaced) → true', () => {
    expect(isKnownOfficialSenior11v11('comp:football-data:PD')).toBe(true);
  });

  it('PL (Premier League short code) → true', () => {
    expect(isKnownOfficialSenior11v11('PL')).toBe(true);
  });

  it('comp:football-data:PL (Premier League namespaced) → true', () => {
    expect(isKnownOfficialSenior11v11('comp:football-data:PL')).toBe(true);
  });

  it('BL1 (Bundesliga short code) → true', () => {
    expect(isKnownOfficialSenior11v11('BL1')).toBe(true);
  });

  it('comp:football-data:BL1 (Bundesliga namespaced) → true', () => {
    expect(isKnownOfficialSenior11v11('comp:football-data:BL1')).toBe(true);
  });

  it('4432 (Liga Uruguaya TheSportsDB short ID) → true', () => {
    expect(isKnownOfficialSenior11v11('4432')).toBe(true);
  });

  it('TheSportsDB:4432 (Liga Uruguaya namespaced) → true', () => {
    expect(isKnownOfficialSenior11v11('TheSportsDB:4432')).toBe(true);
  });

  it('comp:thesportsdb:4432 (Liga Uruguaya server form) → true', () => {
    expect(isKnownOfficialSenior11v11('comp:thesportsdb:4432')).toBe(true);
  });

  // ── Unknown competitions must return false ───────────────────────────────

  it('unknown competition "comp:unknown:999" → false', () => {
    // §7.6: competitions not in the catalog are NOT confirmed official/senior/11v11
    expect(isKnownOfficialSenior11v11('comp:unknown:999')).toBe(false);
  });

  it('empty string → false', () => {
    expect(isKnownOfficialSenior11v11('')).toBe(false);
  });

  it('free-form tournament name → false (heuristics prohibited by §7.6)', () => {
    // §7.6: queda prohibido inferir clasificación por nombre libre del torneo
    expect(isKnownOfficialSenior11v11('UEFA Champions League')).toBe(false);
    expect(isKnownOfficialSenior11v11('World Cup 2026')).toBe(false);
    expect(isKnownOfficialSenior11v11('friendly match')).toBe(false);
  });

  it('near-miss spellings → false (no soft matching)', () => {
    // Exact membership only — no prefix/suffix/case-insensitive matching
    expect(isKnownOfficialSenior11v11('pd')).toBe(false); // wrong case
    expect(isKnownOfficialSenior11v11('pl')).toBe(false); // wrong case
    expect(isKnownOfficialSenior11v11('bl1')).toBe(false); // wrong case
    expect(isKnownOfficialSenior11v11(' PD')).toBe(false); // leading space
    expect(isKnownOfficialSenior11v11('PD ')).toBe(false); // trailing space
  });

  // ── OFFICIAL_SENIOR_11V11_COMPETITION_IDS set structure ─────────────────

  it('catalog set contains exactly the 19 expected entries', () => {
    // §7.6: catalog covers all ID representations for all supported competitions.
    // Updated from 9→19 entries as new competitions and apifootball namespaced
    // IDs were added: apifootball aliases for PD/PL/BL1/URU, Liga Argentina
    // (4406 / comp:sportsdb-ar:4406 / comp:apifootball:128), Copa Libertadores
    // (comp:apifootball:13), Copa del Mundo 2026 (comp:apifootball:1), and
    // OpenLigaDB alias for Bundesliga (comp:openligadb:bl1).
    const expectedIds = [
      // LaLiga
      'PD',
      'comp:football-data:PD',
      'comp:apifootball:140',
      // Premier League
      'PL',
      'comp:football-data:PL',
      'comp:apifootball:39',
      // Bundesliga
      'BL1',
      'comp:football-data:BL1',
      'comp:openligadb:bl1',
      'comp:apifootball:78',
      // Liga Uruguaya
      '4432',
      'TheSportsDB:4432',
      'comp:thesportsdb:4432',
      'comp:apifootball:268',
      // Liga Argentina
      '4406',
      'comp:sportsdb-ar:4406',
      'comp:apifootball:128',
      // Copa Libertadores
      'comp:apifootball:13',
      // Copa del Mundo 2026
      'comp:apifootball:1',
    ];
    expect(OFFICIAL_SENIOR_11V11_COMPETITION_IDS.size).toBe(expectedIds.length);
    for (const id of expectedIds) {
      expect(OFFICIAL_SENIOR_11V11_COMPETITION_IDS.has(id)).toBe(true);
    }
  });

  // ── Integration: unknown competition → NOT_ELIGIBLE via validator ─────────

  it('validateMatch with unknown competition_id and catalog_confirms=false → NOT_ELIGIBLE + UNSUPPORTED_MATCH_TYPE', () => {
    // §7.6: caller must use isKnownOfficialSenior11v11 to populate
    // catalog_confirms_official_senior_11v11. When the competition is not in
    // the catalog, the field is false → NOT_ELIGIBLE.
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      competition_id: 'comp:unknown:999', // not in the catalog
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    // Caller uses isKnownOfficialSenior11v11 to populate the field — returns false
    const ctx: MatchValidationContext = {
      input,
      catalog_confirms_official_senior_11v11: isKnownOfficialSenior11v11(input.competition_id),
    };
    const result = validateMatch(ctx);
    expect(result.operating_mode).toBe('NOT_ELIGIBLE');
    expect(result.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(result.reasons).toContain('UNSUPPORTED_MATCH_TYPE');
  });

  it('validateMatch with known competition_id and catalog_confirms derived from lookup → ELIGIBLE', () => {
    // §7.6: when the competition IS in the catalog, the lookup returns true
    // and the validator proceeds normally
    const input = makeFullInput(DOMESTIC_LEAGUE_PROFILE, {
      competition_id: 'PD', // LaLiga — in the catalog
      historical_context: {
        home_completed_official_matches_last_365d: 20,
        away_completed_official_matches_last_365d: 18,
        home_prior_rating_available: false,
        away_prior_rating_available: false,
      },
    });
    const ctx: MatchValidationContext = {
      input,
      catalog_confirms_official_senior_11v11: isKnownOfficialSenior11v11(input.competition_id),
    };
    const result = validateMatch(ctx);
    expect(result.eligibility_status).toBe('ELIGIBLE');
    expect(result.operating_mode).toBe('FULL_MODE');
    expect(result.reasons).not.toContain('UNSUPPORTED_MATCH_TYPE');
  });
});

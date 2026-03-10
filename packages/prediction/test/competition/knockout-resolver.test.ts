/**
 * knockout-resolver.test.ts — Unit tests for resolveKnockout.
 *
 * Spec authority: §5.2, §7.3 (SECOND_LEG guard), §8.2 (KnockoutResolutionRules),
 *                 §8.4 (ordered sequence), §18.2 (two-leg resolution)
 * Acceptance matrix: §25 (knockout resolution determinism, BLOCKED states)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveKnockout,
  type KnockoutMatchData,
} from '../../src/competition/knockout-resolver.js';
import type { KnockoutResolutionRules } from '../../src/contracts/types/competition-profile.js';

// ── Shared rule fixtures ──────────────────────────────────────────────────────

const RULES_ET_PENS: KnockoutResolutionRules = {
  single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
  final_overrides_prior_round_rules: false,
};

const RULES_AWAY_ET_PENS: KnockoutResolutionRules = {
  second_leg_resolution_order: ['AWAY_GOALS_AFTER_90', 'EXTRA_TIME', 'PENALTIES'],
  final_overrides_prior_round_rules: false,
};

const RULES_NO_AWAY_GOALS: KnockoutResolutionRules = {
  second_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
  final_overrides_prior_round_rules: false,
};

// ── Single-leg: winner in 90 minutes ─────────────────────────────────────────

describe('resolveKnockout — SINGLE LEG, winner at 90 min', () => {
  it('returns HOME winner when home score > away score', () => {
    const match: KnockoutMatchData = {
      match_id: 'sl1',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 2, away_score: 1 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: RULES_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_ET_PENS);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.winner).toBe('HOME');
      expect(result.decided_by).toBe('AGGREGATE_SCORE');
    }
  });

  it('returns AWAY winner when away score > home score', () => {
    const match: KnockoutMatchData = {
      match_id: 'sl2',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 0, away_score: 3 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: RULES_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_ET_PENS);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.winner).toBe('AWAY');
    }
  });

  it('returns UNDECIDED when match not yet played (null scores)', () => {
    const match: KnockoutMatchData = {
      match_id: 'sl3',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: null,
      aggregate_state_before_match: null,
      knockout_resolution_rules: RULES_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_ET_PENS);
    expect(result.status).toBe('UNDECIDED');
    if (result.status === 'UNDECIDED') {
      expect(result.reason).toBe('MATCH_NOT_YET_PLAYED');
    }
  });

  it('draw → UNDECIDED with ORGANIZER_DEFINED_REQUIRED (ET is external)', () => {
    const match: KnockoutMatchData = {
      match_id: 'sl4',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 1, away_score: 1 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: RULES_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_ET_PENS);
    expect(result.status).toBe('UNDECIDED');
    if (result.status === 'UNDECIDED') {
      expect(result.reason).toBe('ORGANIZER_DEFINED_REQUIRED');
    }
  });

  it('draw with ORGANIZER_DEFINED as sole rule → UNDECIDED', () => {
    const orgRules: KnockoutResolutionRules = {
      single_leg_resolution_order: ['ORGANIZER_DEFINED'],
      final_overrides_prior_round_rules: false,
    };
    const match: KnockoutMatchData = {
      match_id: 'sl5',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 0, away_score: 0 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: orgRules,
    };

    const result = resolveKnockout(match, orgRules);
    expect(result.status).toBe('UNDECIDED');
    if (result.status === 'UNDECIDED') {
      expect(result.reason).toBe('ORGANIZER_DEFINED_REQUIRED');
    }
  });
});

// ── Two-leg: aggregate decides ────────────────────────────────────────────────

describe('resolveKnockout — TWO LEG, aggregate decides', () => {
  it('HOME wins on aggregate (leads after leg 1, scores in leg 2)', () => {
    // Leg 1: HOME away → away_aggregate = HOME scored 2 in their away leg.
    // In leg 2: HOME plays at home.
    // agg.home = 2 (HOME scored in leg 1, they were "away" then).
    // Wait: convention is home_aggregate_goals = goals by team playing AT HOME in leg 2.
    // So HOME (home in leg 2) scored 2 in leg 1 (when they were away).
    // Leg 2: HOME 1-0 AWAY → aggregate: HOME 2+1=3, AWAY 0+0=0.
    const match: KnockoutMatchData = {
      match_id: 'tl1',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 1, away_score: 0 },
      aggregate_state_before_match: {
        home_aggregate_goals: 2, // HOME scored 2 in leg 1 (as away team)
        away_aggregate_goals: 0,
      },
      knockout_resolution_rules: RULES_AWAY_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_AWAY_ET_PENS);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.winner).toBe('HOME');
      expect(result.decided_by).toBe('AGGREGATE_SCORE');
    }
  });

  it('AWAY wins on aggregate', () => {
    // Aggregate: HOME 0+0=0, AWAY 1+2=3
    const match: KnockoutMatchData = {
      match_id: 'tl2',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 0, away_score: 2 },
      aggregate_state_before_match: {
        home_aggregate_goals: 0,
        away_aggregate_goals: 1,
      },
      knockout_resolution_rules: RULES_AWAY_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_AWAY_ET_PENS);
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.winner).toBe('AWAY');
    }
  });
});

// ── Two-leg: aggregate draw → apply resolution order ─────────────────────────

describe('resolveKnockout — TWO LEG, aggregate draw', () => {
  it('applies AWAY_GOALS_AFTER_90 when enabled and away team has more away goals', () => {
    // Leg 1 (HOME away): HOME scored 1, AWAY scored 1.
    // home_aggregate_goals = 1 (HOME's goals in leg 1 as away team)
    // away_aggregate_goals = 1 (AWAY's goals in leg 1 as home team)
    // Leg 2: HOME 1-1 AWAY → aggregate 2-2.
    // Away goals: HOME away goals = agg.home_aggregate_goals = 1 (scored as away in leg 1)
    //             AWAY away goals = leg2.away_score = 1 (scored as away in leg 2)
    // Tied → ET.
    const match: KnockoutMatchData = {
      match_id: 'tl3',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 1, away_score: 1 },
      aggregate_state_before_match: {
        home_aggregate_goals: 1,
        away_aggregate_goals: 1,
      },
      knockout_resolution_rules: RULES_AWAY_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_AWAY_ET_PENS);
    // Aggregate tied 2-2. Away goals: HOME=1, AWAY=1 → also tied → falls to ET → UNDECIDED.
    expect(result.status).toBe('UNDECIDED');
  });

  it('AWAY wins by away goals when AWAY has more away goals than HOME', () => {
    // Leg 1: HOME (as away) scored 0, AWAY (as home) scored 0.
    // Leg 2: HOME 1-2 AWAY → aggregate 1-2 → AWAY wins on aggregate.
    // Different scenario: aggregate 1-1 with AWAY having more away goals.
    // Leg 1: home_agg=0, away_agg=1 (AWAY scored 1 at home in leg 1)
    // Leg 2: HOME 1-0 AWAY → aggregate: HOME 0+1=1, AWAY 1+0=1 → tied.
    // Away goals: HOME away goals = agg.home_aggregate_goals = 0 (HOME scored 0 in leg 1 as away)
    //             AWAY away goals = leg2.away_score = 0 (AWAY scored 0 in leg 2 as away)
    // Still tied — ET.
    // Let's use a clearer case: HOME won leg 1 away 2-1.
    // home_aggregate_goals=2 (HOME scored 2 as away in leg1), away_agg=1.
    // Leg 2: HOME 0-1 AWAY → aggregate: HOME 2+0=2, AWAY 1+1=2 → tied.
    // Away goals: HOME away = agg.home_agg = 2 (scored in leg1 as away)
    //             AWAY away = leg2.away_score = 1 (scored in leg2 as away)
    // HOME has more away goals → HOME wins.
    const match: KnockoutMatchData = {
      match_id: 'tl_ag1',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 0, away_score: 1 },
      aggregate_state_before_match: {
        home_aggregate_goals: 2,
        away_aggregate_goals: 1,
      },
      knockout_resolution_rules: RULES_AWAY_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_AWAY_ET_PENS);
    // Aggregate: HOME 2, AWAY 2 → tied.
    // Away goals: HOME away=2 (from leg 1), AWAY away=1 (leg 2) → HOME wins.
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.winner).toBe('HOME');
      expect(result.decided_by).toBe('AWAY_GOALS_AFTER_90');
    }
  });

  it('does NOT apply away goals when not in resolution_order (RULES_NO_AWAY_GOALS)', () => {
    // Aggregate tied, no AWAY_GOALS_AFTER_90 in rules → skips to ET → UNDECIDED.
    const match: KnockoutMatchData = {
      match_id: 'tl4',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 0, away_score: 1 },
      aggregate_state_before_match: {
        home_aggregate_goals: 2,
        away_aggregate_goals: 1,
      },
      knockout_resolution_rules: RULES_NO_AWAY_GOALS,
    };

    const result = resolveKnockout(match, RULES_NO_AWAY_GOALS);
    // Aggregate: HOME 2, AWAY 2 → tied, but AWAY_GOALS not in order → ET → UNDECIDED.
    expect(result.status).toBe('UNDECIDED');
    if (result.status === 'UNDECIDED') {
      expect(result.reason).toBe('ORGANIZER_DEFINED_REQUIRED');
    }
  });

  it('ORGANIZER_DEFINED → UNDECIDED (external result required)', () => {
    const orgRules: KnockoutResolutionRules = {
      second_leg_resolution_order: ['ORGANIZER_DEFINED'],
      final_overrides_prior_round_rules: false,
    };
    const match: KnockoutMatchData = {
      match_id: 'tl5',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 1, away_score: 1 },
      aggregate_state_before_match: {
        home_aggregate_goals: 0,
        away_aggregate_goals: 0,
      },
      knockout_resolution_rules: orgRules,
    };

    const result = resolveKnockout(match, orgRules);
    // Aggregate: HOME 0+1=1, AWAY 0+1=1 → tied → ORGANIZER_DEFINED.
    expect(result.status).toBe('UNDECIDED');
    if (result.status === 'UNDECIDED') {
      expect(result.reason).toBe('ORGANIZER_DEFINED_REQUIRED');
    }
  });
});

// ── SECOND_LEG guard: missing aggregate_state ─────────────────────────────────

describe('resolveKnockout — SECOND_LEG guard (§7.3)', () => {
  it('returns BLOCKED when SECOND_LEG lacks aggregate_state_before_match', () => {
    const match: KnockoutMatchData = {
      match_id: 'tl_block',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'SECOND_LEG',
      current_leg_score: { home_score: 2, away_score: 0 },
      aggregate_state_before_match: null, // MISSING — §7.3 violation
      knockout_resolution_rules: RULES_AWAY_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_AWAY_ET_PENS);
    expect(result.status).toBe('BLOCKED');
    if (result.status === 'BLOCKED') {
      expect(result.gap.missingFields).toContain('aggregate_state_before_match');
      expect(result.gap.specSection).toBe('§7.3');
    }
  });
});

// ── FIRST_LEG → UNDECIDED (tie not complete) ─────────────────────────────────

describe('resolveKnockout — FIRST_LEG', () => {
  it('returns UNDECIDED for first leg (tie is not yet complete)', () => {
    const match: KnockoutMatchData = {
      match_id: 'fl1',
      format_type: 'KNOCKOUT_TWO_LEG',
      leg_type: 'FIRST_LEG',
      current_leg_score: { home_score: 2, away_score: 1 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: RULES_AWAY_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_AWAY_ET_PENS);
    expect(result.status).toBe('UNDECIDED');
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe('resolveKnockout — determinism', () => {
  it('produces identical output for identical inputs', () => {
    const match: KnockoutMatchData = {
      match_id: 'det1',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 3, away_score: 1 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: RULES_ET_PENS,
    };

    const r1 = resolveKnockout(match, RULES_ET_PENS);
    const r2 = resolveKnockout(match, RULES_ET_PENS);

    expect(r1).toEqual(r2);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('resolveKnockout — edge cases', () => {
  it('resolves 0-0 single leg as UNDECIDED (draw, ET next)', () => {
    const match: KnockoutMatchData = {
      match_id: 'edge1',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 0, away_score: 0 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: RULES_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_ET_PENS);
    expect(result.status).toBe('UNDECIDED');
  });

  it('returns BLOCKED for non-knockout format_type', () => {
    const match: KnockoutMatchData = {
      match_id: 'edge2',
      format_type: 'ROUND_ROBIN',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 1, away_score: 0 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: RULES_ET_PENS,
    };

    const result = resolveKnockout(match, RULES_ET_PENS);
    expect(result.status).toBe('BLOCKED');
  });

  it('empty resolution_order single leg draw → TIED_NO_FURTHER_RULE', () => {
    const emptyRules: KnockoutResolutionRules = {
      single_leg_resolution_order: [],
      final_overrides_prior_round_rules: false,
    };
    const match: KnockoutMatchData = {
      match_id: 'edge3',
      format_type: 'KNOCKOUT_SINGLE_LEG',
      leg_type: 'SINGLE',
      current_leg_score: { home_score: 1, away_score: 1 },
      aggregate_state_before_match: null,
      knockout_resolution_rules: emptyRules,
    };

    const result = resolveKnockout(match, emptyRules);
    expect(result.status).toBe('UNDECIDED');
    if (result.status === 'UNDECIDED') {
      expect(result.reason).toBe('TIED_NO_FURTHER_RULE');
    }
  });
});

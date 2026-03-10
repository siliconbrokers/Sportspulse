/**
 * history-validator.test.ts
 *
 * Tests for per-team history and prior_rating eligibility evaluation.
 *
 * Spec authority: §7.4, §20.1, §20.2, §4.3 (thresholds)
 * Acceptance matrix: §25.1, §25.3
 */

import { describe, it, expect } from 'vitest';
import { validateHistory } from '../../src/validation/history-validator.js';
import type { MatchInput } from '../../src/contracts/types/match-input.js';
import type { CompetitionProfile } from '../../src/contracts/types/competition-profile.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

const CLUB_PROFILE: CompetitionProfile = {
  competition_profile_version: '1.0',
  team_domain: 'CLUB',
  competition_family: 'DOMESTIC_LEAGUE',
  stage_type: 'QUALIFYING',
  format_type: 'ROUND_ROBIN',
  leg_type: 'SINGLE',
  neutral_venue: false,
};

const NT_PROFILE: CompetitionProfile = {
  competition_profile_version: '1.0',
  team_domain: 'NATIONAL_TEAM',
  competition_family: 'NATIONAL_TEAM_TOURNAMENT',
  stage_type: 'GROUP_STAGE',
  format_type: 'GROUP_CLASSIC',
  leg_type: 'SINGLE',
  neutral_venue: false,
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
};

function makeInput(
  profile: CompetitionProfile,
  home365: number | undefined,
  away365: number | undefined,
  home730: number | undefined,
  away730: number | undefined,
  homePrior: boolean,
  awayPrior: boolean,
): MatchInput {
  return {
    schemaVersion: 1,
    match_id: 'test-match',
    kickoff_utc: '2025-06-15T20:00:00Z',
    competition_id: 'comp1',
    season_id: '2024-25',
    home_team_id: 'home',
    away_team_id: 'away',
    competition_profile: profile,
    home_team_domain_id: 'domain-home',
    away_team_domain_id: 'domain-away',
    historical_context: {
      home_completed_official_matches_last_365d: home365,
      away_completed_official_matches_last_365d: away365,
      home_completed_official_matches_last_730d: home730,
      away_completed_official_matches_last_730d: away730,
      home_prior_rating_available: homePrior,
      away_prior_rating_available: awayPrior,
    },
  };
}

// ── CLUB domain tests (§7.4, §4.3: min=5/365d, strong=12/365d) ────────────

describe('validateHistory — CLUB domain (§7.4)', () => {
  it('both teams with 5+ matches in 365d → both_eligible = true', () => {
    const input = makeInput(CLUB_PROFILE, 10, 8, undefined, undefined, false, false);
    const result = validateHistory(input);
    expect(result.both_eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('both teams with 12+ matches in 365d → both_strong_history = true', () => {
    const input = makeInput(CLUB_PROFILE, 12, 15, undefined, undefined, false, false);
    const result = validateHistory(input);
    expect(result.both_strong_history).toBe(true);
    expect(result.home.meets_strong_history).toBe(true);
    expect(result.away.meets_strong_history).toBe(true);
  });

  it('both teams with 11 matches → meets_min but NOT strong history', () => {
    const input = makeInput(CLUB_PROFILE, 11, 11, undefined, undefined, false, false);
    const result = validateHistory(input);
    expect(result.both_eligible).toBe(true);
    expect(result.both_strong_history).toBe(false);
    expect(result.home.meets_strong_history).toBe(false);
  });

  it('club team with 300 days of history (4 matches), no prior_rating → NOT eligible — test req', () => {
    // 4 matches < 5 (MIN_RECENT_MATCHES_CLUB), no prior_rating → NOT_ELIGIBLE
    const input = makeInput(CLUB_PROFILE, 4, 10, undefined, undefined, false, false);
    const result = validateHistory(input);
    expect(result.home.is_eligible).toBe(false);
    expect(result.both_eligible).toBe(false);
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });

  it('home team 0 matches, no prior_rating → NOT eligible', () => {
    const input = makeInput(CLUB_PROFILE, 0, 10, undefined, undefined, false, false);
    const result = validateHistory(input);
    expect(result.both_eligible).toBe(false);
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });

  it('home team 0 matches, but prior_rating available → eligible (§7.4)', () => {
    const input = makeInput(CLUB_PROFILE, 0, 10, undefined, undefined, true, false);
    const result = validateHistory(input);
    expect(result.home.is_eligible).toBe(true);
    expect(result.both_eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('home prior_rating available, insufficient recent history → meets_strong = false', () => {
    // §20.2 + §13.1: prior_rating utilizable but below strong threshold
    const input = makeInput(CLUB_PROFILE, 3, 12, undefined, undefined, true, false);
    const result = validateHistory(input);
    expect(result.home.is_eligible).toBe(true);
    expect(result.home.meets_strong_history).toBe(false); // 3 < 12
    expect(result.both_strong_history).toBe(false);
  });

  it('both teams 0 matches, no prior_rating → reasons includes INSUFFICIENT_HISTORY — §7.4', () => {
    const input = makeInput(CLUB_PROFILE, 0, 0, undefined, undefined, false, false);
    const result = validateHistory(input);
    expect(result.both_eligible).toBe(false);
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });
});

// ── NATIONAL_TEAM domain tests (§7.4, §4.3: min=5/730d, strong=8/730d) ───

describe('validateHistory — NATIONAL_TEAM domain (§7.4)', () => {
  it('national team with 700 days history (4 matches in 730d), no prior_rating → NOT eligible — test req', () => {
    // 4 matches < 5 (MIN_RECENT_MATCHES_NATIONAL_TEAM) → not eligible
    const input = makeInput(NT_PROFILE, undefined, undefined, 4, 5, false, false);
    const result = validateHistory(input);
    expect(result.home.is_eligible).toBe(false);
    expect(result.both_eligible).toBe(false);
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });

  it('national team with 5+ matches in 730d → eligible (§7.4)', () => {
    const input = makeInput(NT_PROFILE, undefined, undefined, 5, 5, false, false);
    const result = validateHistory(input);
    expect(result.both_eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('national team with 8+ matches in 730d → meets_strong_history (§4.3, §13.1)', () => {
    const input = makeInput(NT_PROFILE, undefined, undefined, 8, 10, false, false);
    const result = validateHistory(input);
    expect(result.both_strong_history).toBe(true);
    expect(result.home.meets_strong_history).toBe(true);
    expect(result.away.meets_strong_history).toBe(true);
  });

  it('national team with 7 matches → eligible but not strong', () => {
    const input = makeInput(NT_PROFILE, undefined, undefined, 7, 7, false, false);
    const result = validateHistory(input);
    expect(result.both_eligible).toBe(true);
    expect(result.both_strong_history).toBe(false);
  });

  it('national team 0 matches, prior_rating available → eligible (§7.4)', () => {
    const input = makeInput(NT_PROFILE, undefined, undefined, 0, 8, true, false);
    const result = validateHistory(input);
    expect(result.home.is_eligible).toBe(true);
    expect(result.both_eligible).toBe(true);
  });

  it('national team 0 matches, no prior_rating → NOT eligible (§7.4, §20.1)', () => {
    const input = makeInput(NT_PROFILE, undefined, undefined, 0, 8, false, false);
    const result = validateHistory(input);
    expect(result.home.is_eligible).toBe(false);
    expect(result.both_eligible).toBe(false);
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });
});

// ── meets_min_history = false, but prior_rating → eligible (§7.4) ─────────

describe('validateHistory — history < min but prior_rating available (§7.4, §20.1)', () => {
  it('CLUB home 3 matches, prior_rating available → home eligible via prior_rating', () => {
    const input = makeInput(CLUB_PROFILE, 3, 8, undefined, undefined, true, false);
    const result = validateHistory(input);
    expect(result.home.meets_min_history).toBe(false);
    expect(result.home.prior_rating_available).toBe(true);
    expect(result.home.is_eligible).toBe(true);
    expect(result.both_eligible).toBe(true);
  });
});

// ── effectivePriorAvailable override parameter (§19.6, §20.2 enforcement path) ──

describe('validateHistory — effectivePriorAvailable override (§19.6, §20.2)', () => {
  it('effectiveHomePriorAvailable=false overrides boolean true in MatchInput → home not eligible via prior_rating', () => {
    // Simulates match-validator passing false after detecting stale/low-updates rating
    // Input says prior_rating_available=true but the engine evaluated it as not utilizable
    const input = makeInput(CLUB_PROFILE, 0, 20, undefined, undefined, true, false);
    // Pass false as effectiveHomePriorAvailable — the evaluated §20.2 result
    const result = validateHistory(input, false, undefined);
    // 0 matches and effective prior = false → home not eligible
    expect(result.home.is_eligible).toBe(false);
    expect(result.both_eligible).toBe(false);
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });

  it('effectiveHomePriorAvailable=true overrides boolean false in MatchInput → home eligible via prior_rating', () => {
    // Simulates match-validator passing true after validating the PriorRating record
    const input = makeInput(CLUB_PROFILE, 0, 20, undefined, undefined, false, false);
    // Pass true as effectiveHomePriorAvailable — the engine found a valid record
    const result = validateHistory(input, true, undefined);
    expect(result.home.is_eligible).toBe(true);
    expect(result.both_eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('effectiveAwayPriorAvailable=false overrides true → away not eligible via prior_rating', () => {
    const input = makeInput(CLUB_PROFILE, 20, 0, undefined, undefined, false, true);
    const result = validateHistory(input, undefined, false);
    expect(result.away.is_eligible).toBe(false);
    expect(result.both_eligible).toBe(false);
    expect(result.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });

  it('no override params → falls back to MatchInput boolean flags (backwards compatible)', () => {
    // When no effective flags are provided, behavior must be identical to old code
    const input = makeInput(CLUB_PROFILE, 0, 20, undefined, undefined, true, false);
    const result = validateHistory(input); // no optional params
    // prior_rating_available=true from MatchInput is used
    expect(result.home.is_eligible).toBe(true);
    expect(result.both_eligible).toBe(true);
  });
});

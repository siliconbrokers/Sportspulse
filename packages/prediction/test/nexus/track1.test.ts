/**
 * track1.test.ts — NEXUS Track 1: unit tests.
 *
 * Spec authority:
 *   - taxonomy spec S3.1–S3.5: Track 1 specification
 *   - master spec S5.1, S8.5: coexistence + isolation invariants
 *
 * Test IDs follow the acceptance matrix pattern: T1-xx
 */

import { describe, test, expect } from 'vitest';
import type { HistoricalMatch, AdaptiveKConfig } from '../../src/nexus/track1/types.js';
import {
  estimateHomeAdvantage,
  MIN_SAMPLE_SIZE_FOR_EMPIRICAL,
  DEFAULT_HOME_ADVANTAGES,
  GLOBAL_HOME_ADVANTAGE_DEFAULT,
} from '../../src/nexus/track1/home-advantage.js';
import {
  computeAdaptiveK,
  computeAdaptiveKWithContext,
  DEFAULT_ADAPTIVE_K_CONFIG,
  K_CONTEXT_MULTIPLIERS,
} from '../../src/nexus/track1/adaptive-k.js';
import { computeTrack1 } from '../../src/nexus/track1/track1-engine.js';

// ── Test fixtures ──────────────────────────────────────────────────────────

function makeMatch(
  homeGoals: number,
  awayGoals: number,
  isNeutralVenue = false,
  homeTeamId = 'teamA',
  awayTeamId = 'teamB',
): HistoricalMatch {
  return {
    homeTeamId,
    awayTeamId,
    utcDate: '2024-10-01T20:00:00Z',
    homeGoals,
    awayGoals,
    isNeutralVenue,
  };
}

/**
 * Build a dataset with a specific home goal differential.
 * Creates `n` matches where home team scores homeGoals and away scores awayGoals.
 */
function buildDataset(
  n: number,
  homeGoals: number,
  awayGoals: number,
  isNeutralVenue = false,
): HistoricalMatch[] {
  return Array.from({ length: n }, (_, i) => ({
    homeTeamId: `home${i % 5}`,
    awayTeamId: `away${i % 5}`,
    utcDate: `2024-${String(Math.floor(i / 4) + 1).padStart(2, '0')}-01T20:00:00Z`,
    homeGoals,
    awayGoals,
    isNeutralVenue,
  }));
}

const NOW = '2024-11-01T12:00:00Z';

// ══════════════════════════════════════════════════════════════════════════
// T1-01: Home advantage varies by league
// taxonomy spec S3.2 Extension 1: dynamic per-league home advantage
// ══════════════════════════════════════════════════════════════════════════

describe('T1-01: estimateHomeAdvantage — prior phase', () => {
  test('returns league-specific prior when sample is too small', () => {
    const smallDataset = buildDataset(10, 2, 1); // fewer than MIN_SAMPLE_SIZE_FOR_EMPIRICAL
    const pd = estimateHomeAdvantage(smallDataset, 'PD', NOW);
    const pl = estimateHomeAdvantage(smallDataset, 'PL', NOW);
    const bl1 = estimateHomeAdvantage(smallDataset, 'BL1', NOW);

    expect(pd.homeAdvantage).toBe(DEFAULT_HOME_ADVANTAGES['PD']);
    expect(pl.homeAdvantage).toBe(DEFAULT_HOME_ADVANTAGES['PL']);
    expect(bl1.homeAdvantage).toBe(DEFAULT_HOME_ADVANTAGES['BL1']);

    // PD and BL1 share the same prior (both 0.35 and 0.30 respectively)
    // but PD > PL per literature
    expect(pd.homeAdvantage).toBeGreaterThan(pl.homeAdvantage);
  });

  test('returns global default for unknown league', () => {
    const smallDataset = buildDataset(5, 2, 1);
    const result = estimateHomeAdvantage(smallDataset, 'UNKNOWN_LEAGUE', NOW);
    expect(result.homeAdvantage).toBe(GLOBAL_HOME_ADVANTAGE_DEFAULT);
  });

  test('sampleSize reflects number of non-neutral matches', () => {
    const dataset = buildDataset(15, 2, 1, false);
    const result = estimateHomeAdvantage(dataset, 'PD', NOW);
    expect(result.sampleSize).toBe(15);
    expect(result.leagueId).toBe('PD');
    expect(result.computedAt).toBe(NOW);
  });
});

describe('T1-01: home advantage varies by league — empirical phase', () => {
  test('PD-like data (strong home advantage) vs FL1-like data (weaker) produce different estimates', () => {
    // PD-like: heavy home win bias (goals 2-0 consistently)
    const pdData = buildDataset(MIN_SAMPLE_SIZE_FOR_EMPIRICAL + 5, 2, 0);
    // FL1-like: very balanced (goals 1-1 consistently)
    const fl1Data = buildDataset(MIN_SAMPLE_SIZE_FOR_EMPIRICAL + 5, 1, 1);

    const pdResult = estimateHomeAdvantage(pdData, 'PD', NOW);
    const fl1Result = estimateHomeAdvantage(fl1Data, 'FL1', NOW);

    // PD data has higher home advantage
    expect(pdResult.homeAdvantage).toBeGreaterThan(fl1Result.homeAdvantage);
    // FL1 data has 0 advantage (1-1 in every game)
    expect(fl1Result.homeAdvantage).toBeCloseTo(0, 6);
    // PD data: mean(2-0) = 2.0
    expect(pdResult.homeAdvantage).toBeCloseTo(2.0, 6);
  });

  test('sampleSize is correct for large datasets', () => {
    const n = MIN_SAMPLE_SIZE_FOR_EMPIRICAL + 10;
    const data = buildDataset(n, 2, 1);
    const result = estimateHomeAdvantage(data, 'PL', NOW);
    expect(result.sampleSize).toBe(n);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-02: Neutral venue excluded from home advantage estimation
// taxonomy spec S3.2 Ext 1: neutral venue → exclude from calc
// ══════════════════════════════════════════════════════════════════════════

describe('T1-02: neutral venue exclusion in home advantage', () => {
  test('neutral venue matches are excluded from home advantage estimation', () => {
    // Mix of neutral (0 advantage) and non-neutral (2-0 = 2.0 advantage) matches
    const neutralMatches = buildDataset(40, 2, 0, true);   // all neutral
    const nonNeutralMatches = buildDataset(40, 2, 0, false); // all home

    // Neutral-only: all 40 matches excluded → sampleSize = 0 → uses prior
    const neutralResult = estimateHomeAdvantage(neutralMatches, 'PD', NOW);
    expect(neutralResult.sampleSize).toBe(0);
    expect(neutralResult.homeAdvantage).toBe(DEFAULT_HOME_ADVANTAGES['PD']); // prior

    // Non-neutral: all 40 matches included → empirical
    const nonNeutralResult = estimateHomeAdvantage(nonNeutralMatches, 'PD', NOW);
    expect(nonNeutralResult.sampleSize).toBe(40);
    expect(nonNeutralResult.homeAdvantage).toBeCloseTo(2.0, 6); // empirical
  });

  test('mixed dataset: neutral matches do not inflate the home advantage', () => {
    // 35 non-neutral matches (1-0) + 20 neutral matches (3-0) that should be excluded
    const nonNeutral = buildDataset(35, 1, 0, false);
    const neutralHigh = buildDataset(20, 3, 0, true); // these should be excluded
    const mixed = [...nonNeutral, ...neutralHigh];

    const result = estimateHomeAdvantage(mixed, 'PL', NOW);

    // Only the 35 non-neutral matches are used
    expect(result.sampleSize).toBe(35);
    // homeAdvantage should be 1.0 (from the 1-0 matches only)
    expect(result.homeAdvantage).toBeCloseTo(1.0, 6);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-03: Adaptive K decreases with observed matches
// taxonomy spec S3.2 Extension 3: K decays per matchesObserved
// ══════════════════════════════════════════════════════════════════════════

describe('T1-03: computeAdaptiveK — decay behaviour', () => {
  test('K at match 1 is greater than K at match 30', () => {
    const config: AdaptiveKConfig = { k_initial: 32, k_floor: 16, decay_rate: 0.05 };
    const k1 = computeAdaptiveK(1, config);
    const k30 = computeAdaptiveK(30, config);
    expect(k1).toBeGreaterThan(k30);
  });

  test('K at match 0 equals k_initial (no decay applied)', () => {
    const config: AdaptiveKConfig = { k_initial: 32, k_floor: 16, decay_rate: 0.05 };
    const k0 = computeAdaptiveK(0, config);
    expect(k0).toBeCloseTo(32, 6);
  });

  test('K is monotonically non-increasing with more matches', () => {
    const config: AdaptiveKConfig = { k_initial: 32, k_floor: 16, decay_rate: 0.05 };
    let prev = computeAdaptiveK(0, config);
    for (let n = 1; n <= 50; n++) {
      const curr = computeAdaptiveK(n, config);
      expect(curr).toBeLessThanOrEqual(prev + 1e-9);
      prev = curr;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-04: K-factor never falls below k_floor
// taxonomy spec S3.2 Ext 3: k = max(k_floor, k_initial * exp(...))
// ══════════════════════════════════════════════════════════════════════════

describe('T1-04: K-factor floor invariant', () => {
  test('K never falls below k_floor over a full season (0..100 matches)', () => {
    const config: AdaptiveKConfig = { k_initial: 32, k_floor: 16, decay_rate: 0.05 };
    for (let n = 0; n <= 100; n++) {
      const k = computeAdaptiveK(n, config);
      expect(k).toBeGreaterThanOrEqual(config.k_floor);
    }
  });

  test('K floor holds for aggressive decay rate', () => {
    const config: AdaptiveKConfig = { k_initial: 64, k_floor: 8, decay_rate: 0.5 };
    for (let n = 0; n <= 100; n++) {
      const k = computeAdaptiveK(n, config);
      expect(k).toBeGreaterThanOrEqual(config.k_floor);
    }
  });

  test('DEFAULT_ADAPTIVE_K_CONFIG floor is respected', () => {
    for (let n = 0; n <= 100; n++) {
      const k = computeAdaptiveK(n, DEFAULT_ADAPTIVE_K_CONFIG);
      expect(k).toBeGreaterThanOrEqual(DEFAULT_ADAPTIVE_K_CONFIG.k_floor);
    }
  });

  test('K at very large matchesObserved converges to floor, not below', () => {
    const config: AdaptiveKConfig = { k_initial: 32, k_floor: 10, decay_rate: 0.05 };
    const k1000 = computeAdaptiveK(1000, config);
    expect(k1000).toBe(config.k_floor);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-05: Context multipliers change K correctly
// taxonomy spec S3.2 Ext 3: season opener 1.2x, final stretch 0.9x
// ══════════════════════════════════════════════════════════════════════════

describe('T1-05: computeAdaptiveKWithContext', () => {
  test('season opener multiplier produces higher K than mid-season', () => {
    const config: AdaptiveKConfig = { k_initial: 32, k_floor: 4, decay_rate: 0.05 };
    const kOpener = computeAdaptiveKWithContext(5, 'SEASON_OPENER', config);
    const kMid = computeAdaptiveKWithContext(5, 'MID_SEASON', config);
    expect(kOpener).toBeGreaterThan(kMid);
    expect(kOpener / kMid).toBeCloseTo(K_CONTEXT_MULTIPLIERS.SEASON_OPENER, 5);
  });

  test('final stretch multiplier produces lower K than mid-season', () => {
    const config: AdaptiveKConfig = { k_initial: 32, k_floor: 4, decay_rate: 0.05 };
    const kFinal = computeAdaptiveKWithContext(20, 'FINAL_STRETCH', config);
    const kMid = computeAdaptiveKWithContext(20, 'MID_SEASON', config);
    expect(kFinal).toBeLessThan(kMid);
  });

  test('context multiplier still respects k_floor', () => {
    const config: AdaptiveKConfig = { k_initial: 32, k_floor: 20, decay_rate: 0.5 };
    // With decay_rate=0.5 and n=50, raw K is tiny — floor must hold even after 0.9x
    for (let n = 0; n <= 50; n++) {
      const k = computeAdaptiveKWithContext(n, 'FINAL_STRETCH', config);
      expect(k).toBeGreaterThanOrEqual(config.k_floor);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-06: Neutral venue → home advantage offset = 0
// taxonomy spec S3.2 Ext 1: "For neutral-venue matches ... set home advantage to 1.0"
// master spec S8.5: isNeutralVenue from canonical data, never inferred
// ══════════════════════════════════════════════════════════════════════════

describe('T1-06: neutral venue — homeAdvantageAdjusted = 0', () => {
  const history: HistoricalMatch[] = [
    { homeTeamId: 'A', awayTeamId: 'B', utcDate: '2024-09-01T20:00:00Z', homeGoals: 2, awayGoals: 1, isNeutralVenue: false },
    { homeTeamId: 'B', awayTeamId: 'A', utcDate: '2024-09-08T20:00:00Z', homeGoals: 1, awayGoals: 1, isNeutralVenue: false },
    { homeTeamId: 'A', awayTeamId: 'C', utcDate: '2024-09-15T20:00:00Z', homeGoals: 3, awayGoals: 0, isNeutralVenue: false },
    { homeTeamId: 'C', awayTeamId: 'B', utcDate: '2024-09-22T20:00:00Z', homeGoals: 1, awayGoals: 2, isNeutralVenue: false },
  ];

  test('neutral venue → homeStrength.homeAdvantageAdjusted is 0', () => {
    const output = computeTrack1('A', 'B', history, true, 'PD', NOW);
    expect(output.isNeutralVenue).toBe(true);
    expect(output.homeStrength.homeAdvantageAdjusted).toBe(0);
  });

  test('non-neutral venue → homeStrength.homeAdvantageAdjusted is > 0 when league has positive home advantage', () => {
    // We need enough data for empirical estimate, or rely on prior (PD=0.35)
    const output = computeTrack1('A', 'B', history, false, 'PD', NOW);
    expect(output.isNeutralVenue).toBe(false);
    // With 4 matches (< MIN_SAMPLE_SIZE_FOR_EMPIRICAL=30), falls back to prior = 0.35
    expect(output.homeStrength.homeAdvantageAdjusted).toBeGreaterThan(0);
  });

  test('away team always has homeAdvantageAdjusted = 0', () => {
    const output = computeTrack1('A', 'B', history, false, 'PD', NOW);
    expect(output.awayStrength.homeAdvantageAdjusted).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-07: isNeutralVenue comes from input, not inferred
// master spec S8.5: canonical data is shared; neutral_venue is a canonical field
// ══════════════════════════════════════════════════════════════════════════

describe('T1-07: isNeutralVenue from input — never inferred', () => {
  const history: HistoricalMatch[] = [
    { homeTeamId: 'X', awayTeamId: 'Y', utcDate: '2024-10-01T20:00:00Z', homeGoals: 1, awayGoals: 1, isNeutralVenue: false },
    { homeTeamId: 'Y', awayTeamId: 'X', utcDate: '2024-10-08T20:00:00Z', homeGoals: 2, awayGoals: 0, isNeutralVenue: false },
  ];

  test('passing isNeutralVenue=false → output.isNeutralVenue is false', () => {
    const output = computeTrack1('X', 'Y', history, false, 'PL', NOW);
    expect(output.isNeutralVenue).toBe(false);
  });

  test('passing isNeutralVenue=true → output.isNeutralVenue is true', () => {
    const output = computeTrack1('X', 'Y', history, true, 'PL', NOW);
    expect(output.isNeutralVenue).toBe(true);
  });

  test('same history, different isNeutralVenue inputs → different homeAdvantageAdjusted', () => {
    const withAdvantage = computeTrack1('X', 'Y', history, false, 'PL', NOW);
    const withoutAdvantage = computeTrack1('X', 'Y', history, true, 'PL', NOW);

    expect(withAdvantage.homeStrength.homeAdvantageAdjusted).not.toBe(0);
    expect(withoutAdvantage.homeStrength.homeAdvantageAdjusted).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-08: Track1 output structure invariants
// taxonomy spec S3.4: output contract fields
// ══════════════════════════════════════════════════════════════════════════

describe('T1-08: Track1Output structure invariants', () => {
  const history: HistoricalMatch[] = [
    { homeTeamId: 'A', awayTeamId: 'B', utcDate: '2024-09-01T20:00:00Z', homeGoals: 2, awayGoals: 1, isNeutralVenue: false },
    { homeTeamId: 'B', awayTeamId: 'A', utcDate: '2024-09-08T20:00:00Z', homeGoals: 1, awayGoals: 1, isNeutralVenue: false },
  ];

  test('output contains homeStrength, awayStrength, isNeutralVenue, leagueHomeAdvantage', () => {
    const output = computeTrack1('A', 'B', history, false, 'PD', NOW);
    expect(output).toHaveProperty('homeStrength');
    expect(output).toHaveProperty('awayStrength');
    expect(output).toHaveProperty('isNeutralVenue');
    expect(output).toHaveProperty('leagueHomeAdvantage');
  });

  test('team strengths contain all required fields', () => {
    const output = computeTrack1('A', 'B', history, false, 'PD', NOW);

    for (const strength of [output.homeStrength, output.awayStrength]) {
      expect(strength).toHaveProperty('teamId');
      expect(strength).toHaveProperty('eloRating');
      expect(strength).toHaveProperty('attackStrength');
      expect(strength).toHaveProperty('defenseStrength');
      expect(strength).toHaveProperty('homeAdvantageAdjusted');
      expect(strength).toHaveProperty('matchesObserved');
      expect(strength).toHaveProperty('currentK');
    }
  });

  test('teamIds match input', () => {
    const output = computeTrack1('A', 'B', history, false, 'PD', NOW);
    expect(output.homeStrength.teamId).toBe('A');
    expect(output.awayStrength.teamId).toBe('B');
  });

  test('Track1Output does NOT contain 1X2 probabilities', () => {
    const output = computeTrack1('A', 'B', history, false, 'PD', NOW) as Record<string, unknown>;
    expect(output).not.toHaveProperty('prob_home_win');
    expect(output).not.toHaveProperty('prob_draw');
    expect(output).not.toHaveProperty('prob_away_win');
    expect(output).not.toHaveProperty('p_home');
    expect(output).not.toHaveProperty('p_draw');
    expect(output).not.toHaveProperty('p_away');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-09: Elo ratings move in the right direction
// taxonomy spec S3.2: "Modified Elo system"
// ══════════════════════════════════════════════════════════════════════════

describe('T1-09: Elo direction and determinism', () => {
  test('winning team has higher Elo than consistently losing team', () => {
    // A wins all matches, B loses all
    const history: HistoricalMatch[] = Array.from({ length: 10 }, (_, i) => ({
      homeTeamId: 'A',
      awayTeamId: 'B',
      utcDate: `2024-${String(i + 1).padStart(2, '0')}-01T20:00:00Z`,
      homeGoals: 2,
      awayGoals: 0,
      isNeutralVenue: false,
    }));

    const output = computeTrack1('A', 'B', history, false, 'PD', NOW);
    expect(output.homeStrength.eloRating).toBeGreaterThan(output.awayStrength.eloRating);
  });

  test('same inputs produce identical output (determinism)', () => {
    const history: HistoricalMatch[] = [
      { homeTeamId: 'A', awayTeamId: 'B', utcDate: '2024-09-01T20:00:00Z', homeGoals: 1, awayGoals: 0, isNeutralVenue: false },
      { homeTeamId: 'B', awayTeamId: 'A', utcDate: '2024-09-08T20:00:00Z', homeGoals: 0, awayGoals: 2, isNeutralVenue: false },
    ];

    const out1 = computeTrack1('A', 'B', history, false, 'PD', NOW);
    const out2 = computeTrack1('A', 'B', history, false, 'PD', NOW);

    expect(out1.homeStrength.eloRating).toBe(out2.homeStrength.eloRating);
    expect(out1.awayStrength.eloRating).toBe(out2.awayStrength.eloRating);
    expect(out1.homeStrength.homeAdvantageAdjusted).toBe(out2.homeStrength.homeAdvantageAdjusted);
  });

  test('no history → teams start at default Elo (1500)', () => {
    const output = computeTrack1('NewA', 'NewB', [], false, 'PD', NOW);
    expect(output.homeStrength.eloRating).toBe(1500);
    expect(output.awayStrength.eloRating).toBe(1500);
    expect(output.homeStrength.matchesObserved).toBe(0);
    expect(output.awayStrength.matchesObserved).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-10: matchesObserved tracks correctly through history replay
// taxonomy spec S3.2: match history drives rating updates
// ══════════════════════════════════════════════════════════════════════════

describe('T1-10: matchesObserved tracking', () => {
  test('matchesObserved counts correctly for each team', () => {
    // A plays 3 matches, B plays 2, C plays 2 (as home or away)
    const history: HistoricalMatch[] = [
      { homeTeamId: 'A', awayTeamId: 'B', utcDate: '2024-09-01T20:00:00Z', homeGoals: 1, awayGoals: 0, isNeutralVenue: false },
      { homeTeamId: 'C', awayTeamId: 'A', utcDate: '2024-09-08T20:00:00Z', homeGoals: 1, awayGoals: 1, isNeutralVenue: false },
      { homeTeamId: 'B', awayTeamId: 'C', utcDate: '2024-09-15T20:00:00Z', homeGoals: 2, awayGoals: 1, isNeutralVenue: false },
      { homeTeamId: 'A', awayTeamId: 'C', utcDate: '2024-09-22T20:00:00Z', homeGoals: 0, awayGoals: 1, isNeutralVenue: false },
    ];

    // A has 3 matches (match 1, 2, 4), B has 2 (match 1, 3)
    const output = computeTrack1('A', 'B', history, false, 'PD', NOW);
    expect(output.homeStrength.matchesObserved).toBe(3);
    expect(output.awayStrength.matchesObserved).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-11: currentK reflects adaptive decay
// taxonomy spec S3.2 Ext 3: K adapts per matchesObserved
// ══════════════════════════════════════════════════════════════════════════

describe('T1-11: currentK reflects adaptive decay', () => {
  test('team with more observed matches has lower or equal currentK', () => {
    // A has many matches, B has few
    const history: HistoricalMatch[] = Array.from({ length: 20 }, (_, i) => ({
      homeTeamId: 'A',
      awayTeamId: `team${i}`, // A plays 20 different opponents
      utcDate: `2024-${String(Math.floor(i / 4) + 1).padStart(2, '0')}-01T20:00:00Z`,
      homeGoals: 1,
      awayGoals: 0,
      isNeutralVenue: false,
    }));
    // Add 1 match with B
    history.push({ homeTeamId: 'B', awayTeamId: 'X', utcDate: '2024-11-01T20:00:00Z', homeGoals: 1, awayGoals: 0, isNeutralVenue: false });

    const output = computeTrack1('A', 'B', history, false, 'PD', NOW);
    // A has 20 matches, B has 1 → A's K should be ≤ B's K
    expect(output.homeStrength.currentK).toBeLessThanOrEqual(output.awayStrength.currentK);
  });

  test('currentK is always >= k_floor of default config', () => {
    const history: HistoricalMatch[] = Array.from({ length: 100 }, (_, i) => ({
      homeTeamId: 'A',
      awayTeamId: 'B',
      utcDate: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T20:00:00Z`,
      homeGoals: 1,
      awayGoals: 1,
      isNeutralVenue: false,
    }));

    const output = computeTrack1('A', 'B', history, false, 'PD', NOW);
    expect(output.homeStrength.currentK).toBeGreaterThanOrEqual(DEFAULT_ADAPTIVE_K_CONFIG.k_floor);
    expect(output.awayStrength.currentK).toBeGreaterThanOrEqual(DEFAULT_ADAPTIVE_K_CONFIG.k_floor);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-12: leagueHomeAdvantage in output is populated
// taxonomy spec S3.4: homeAdvantage field in output
// ══════════════════════════════════════════════════════════════════════════

describe('T1-12: leagueHomeAdvantage output field', () => {
  test('leagueHomeAdvantage.leagueId matches input leagueId', () => {
    const output = computeTrack1('A', 'B', [], false, 'BL1', NOW);
    expect(output.leagueHomeAdvantage.leagueId).toBe('BL1');
  });

  test('leagueHomeAdvantage.computedAt matches buildNowUtc', () => {
    const output = computeTrack1('A', 'B', [], false, 'PL', NOW);
    expect(output.leagueHomeAdvantage.computedAt).toBe(NOW);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-13: estimateHomeAdvantage boundary — empty history
// ══════════════════════════════════════════════════════════════════════════

describe('T1-13: estimateHomeAdvantage boundary conditions', () => {
  test('empty history → prior returned with sampleSize = 0', () => {
    const result = estimateHomeAdvantage([], 'PD', NOW);
    expect(result.sampleSize).toBe(0);
    expect(result.homeAdvantage).toBe(DEFAULT_HOME_ADVANTAGES['PD']);
  });

  test('exactly MIN_SAMPLE_SIZE_FOR_EMPIRICAL matches → uses empirical (boundary)', () => {
    const data = buildDataset(MIN_SAMPLE_SIZE_FOR_EMPIRICAL, 2, 1);
    const result = estimateHomeAdvantage(data, 'PD', NOW);
    expect(result.sampleSize).toBe(MIN_SAMPLE_SIZE_FOR_EMPIRICAL);
    expect(result.homeAdvantage).toBeCloseTo(1.0, 6); // mean(2-1) = 1.0
  });

  test('exactly MIN_SAMPLE_SIZE_FOR_EMPIRICAL - 1 matches → uses prior', () => {
    const data = buildDataset(MIN_SAMPLE_SIZE_FOR_EMPIRICAL - 1, 2, 1);
    const result = estimateHomeAdvantage(data, 'PD', NOW);
    expect(result.sampleSize).toBe(MIN_SAMPLE_SIZE_FOR_EMPIRICAL - 1);
    expect(result.homeAdvantage).toBe(DEFAULT_HOME_ADVANTAGES['PD']); // prior
  });
});

// ══════════════════════════════════════════════════════════════════════════
// T1-14: computeAdaptiveK boundary — negative matchesObserved
// ══════════════════════════════════════════════════════════════════════════

describe('T1-14: computeAdaptiveK boundary — invalid inputs', () => {
  test('negative matchesObserved → treated as 0 (defensive guard)', () => {
    const config: AdaptiveKConfig = { k_initial: 32, k_floor: 16, decay_rate: 0.05 };
    // Guard in computeAdaptiveK returns k_initial for negative inputs
    const k = computeAdaptiveK(-1, config);
    expect(k).toBe(config.k_initial);
  });
});

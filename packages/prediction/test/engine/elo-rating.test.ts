/**
 * Elo Rating Engine — Unit Tests
 *
 * Spec authority: §6.1, §20, §4.3
 * Tests mapped to acceptance matrix patterns:
 *   - Determinism (§26 criterion 1)
 *   - Home advantage (§6.1 "localía")
 *   - Neutral venue zeroes home advantage (§18.1)
 *   - K-factor by competition type (§6.1 "peso por competición")
 *   - Limited mode for sparse history (§20)
 *   - New team policy (§20.1)
 */

import { describe, it, expect } from 'vitest';
import {
  computeExpectedScore,
  computeKFactor,
  updateEloRating,
  getEffectiveElo,
  K_FACTOR_BASE,
  HOME_ADVANTAGE_ELO_DELTA,
  ELO_SCALE,
} from '../../src/engine/elo-rating.js';
import {
  createClubRatingPool,
  createNationalTeamRatingPool,
  DEFAULT_ELO_RATING,
} from '../../src/store/rating-pool.js';

// ── computeExpectedScore ───────────────────────────────────────────────────

describe('computeExpectedScore', () => {
  it('returns 0.5 for equal ratings with no home advantage', () => {
    const result = computeExpectedScore(1500, 1500, 0);
    expect(result).toBeCloseTo(0.5, 10);
  });

  it('returns > 0.5 for home team with home advantage', () => {
    const result = computeExpectedScore(1500, 1500, HOME_ADVANTAGE_ELO_DELTA);
    expect(result).toBeGreaterThan(0.5);
  });

  it('is always in (0, 1)', () => {
    const cases = [
      [2000, 1000, 0],
      [1000, 2000, 0],
      [1500, 1500, HOME_ADVANTAGE_ELO_DELTA],
      [1500, 1500, -HOME_ADVANTAGE_ELO_DELTA],
    ] as const;
    for (const [h, a, delta] of cases) {
      const result = computeExpectedScore(h, a, delta);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    }
  });

  it('is symmetric when home advantage is 0', () => {
    const e1 = computeExpectedScore(1600, 1400, 0);
    const e2 = computeExpectedScore(1400, 1600, 0);
    expect(e1 + e2).toBeCloseTo(1.0, 10);
    expect(e1).toBeGreaterThan(0.5);
    expect(e2).toBeLessThan(0.5);
  });

  it('is deterministic — same inputs produce same output', () => {
    const r1 = computeExpectedScore(1523, 1487, 100);
    const r2 = computeExpectedScore(1523, 1487, 100);
    expect(r1).toBe(r2);
  });
});

// ── computeKFactor ────────────────────────────────────────────────────────

describe('computeKFactor', () => {
  it('domestic league returns K_FACTOR_BASE', () => {
    expect(computeKFactor('DOMESTIC_LEAGUE')).toBe(K_FACTOR_BASE);
  });

  it('domestic cup returns higher K than domestic league', () => {
    expect(computeKFactor('DOMESTIC_CUP')).toBeGreaterThan(computeKFactor('DOMESTIC_LEAGUE'));
  });

  it('all categories return positive K', () => {
    const categories = [
      'DOMESTIC_LEAGUE',
      'DOMESTIC_CUP',
      'INTERNATIONAL_CLUB',
      'NATIONAL_TEAM_TOURNAMENT',
    ] as const;
    for (const cat of categories) {
      expect(computeKFactor(cat)).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    expect(computeKFactor('DOMESTIC_LEAGUE')).toBe(computeKFactor('DOMESTIC_LEAGUE'));
  });
});

// ── updateEloRating ───────────────────────────────────────────────────────

describe('updateEloRating', () => {
  it('winner gains Elo, loser loses Elo', () => {
    const pool = createClubRatingPool();
    const result = updateEloRating(
      {
        homeTeamId: 'team-a',
        awayTeamId: 'team-b',
        actualScore: 1, // home wins
        neutralVenue: false,
        competitionWeightCategory: 'DOMESTIC_LEAGUE',
        matchUtc: '2024-01-01T15:00:00Z',
      },
      pool,
    );

    // Home (winner) gains rating
    expect(result.homeRecord.rating).toBeGreaterThan(DEFAULT_ELO_RATING);
    // Away (loser) loses rating
    expect(result.awayRecord.rating).toBeLessThan(DEFAULT_ELO_RATING);
    // Deltas sum to approximately 0 (zero-sum game)
    const homeDelta = result.homeRecord.rating - DEFAULT_ELO_RATING;
    const awayDelta = result.awayRecord.rating - DEFAULT_ELO_RATING;
    expect(homeDelta + awayDelta).toBeCloseTo(0, 8);
  });

  it('applies home advantage (non-neutral venue)', () => {
    // Home team wins — with home advantage, expected score is higher,
    // so the rating gain is smaller than without advantage.
    const pool1 = createClubRatingPool();
    const pool2 = createClubRatingPool();

    const withAdvantage = updateEloRating(
      {
        homeTeamId: 'h',
        awayTeamId: 'a',
        actualScore: 1,
        neutralVenue: false,
        competitionWeightCategory: 'DOMESTIC_LEAGUE',
        matchUtc: '2024-01-01T15:00:00Z',
      },
      pool1,
    );

    const neutral = updateEloRating(
      {
        homeTeamId: 'h',
        awayTeamId: 'a',
        actualScore: 1,
        neutralVenue: true,
        competitionWeightCategory: 'DOMESTIC_LEAGUE',
        matchUtc: '2024-01-01T15:00:00Z',
      },
      pool2,
    );

    // With home advantage, expected score is higher, so gain from a win is smaller
    const gainWithAdvantage = withAdvantage.homeRecord.rating - DEFAULT_ELO_RATING;
    const gainNeutral = neutral.homeRecord.rating - DEFAULT_ELO_RATING;
    expect(gainWithAdvantage).toBeLessThan(gainNeutral);

    // Neutral venue: home advantage delta should be 0
    expect(withAdvantage.homeAdvantageDelta).toBe(HOME_ADVANTAGE_ELO_DELTA);
    expect(neutral.homeAdvantageDelta).toBe(0);
  });

  it('is deterministic — same pool state + same params → same result', () => {
    const pool1 = createClubRatingPool();
    const pool2 = createClubRatingPool();

    const params = {
      homeTeamId: 'home',
      awayTeamId: 'away',
      actualScore: 0.5 as const,
      neutralVenue: false,
      competitionWeightCategory: 'DOMESTIC_LEAGUE' as const,
      matchUtc: '2024-03-15T19:00:00Z',
    };

    const r1 = updateEloRating(params, pool1);
    const r2 = updateEloRating(params, pool2);

    expect(r1.homeRecord.rating).toBe(r2.homeRecord.rating);
    expect(r1.awayRecord.rating).toBe(r2.awayRecord.rating);
    expect(r1.expectedScoreHome).toBe(r2.expectedScoreHome);
  });

  it('increments updateCount for both teams', () => {
    const pool = createClubRatingPool();
    const result = updateEloRating(
      {
        homeTeamId: 'h',
        awayTeamId: 'a',
        actualScore: 0,
        neutralVenue: false,
        competitionWeightCategory: 'DOMESTIC_LEAGUE',
        matchUtc: '2024-01-01T15:00:00Z',
      },
      pool,
    );
    expect(result.homeRecord.updateCount).toBe(1);
    expect(result.awayRecord.updateCount).toBe(1);
  });

  it('draw: both teams update towards expected score', () => {
    const pool = createClubRatingPool();
    // Initialize with different ratings
    pool.set({ teamId: 'strong', rating: 1700, updateCount: 10, lastUpdatedUtc: null });
    pool.set({ teamId: 'weak', rating: 1300, updateCount: 10, lastUpdatedUtc: null });

    const result = updateEloRating(
      {
        homeTeamId: 'strong',
        awayTeamId: 'weak',
        actualScore: 0.5, // draw
        neutralVenue: true,
        competitionWeightCategory: 'DOMESTIC_LEAGUE',
        matchUtc: '2024-01-01T15:00:00Z',
      },
      pool,
    );

    // Strong team expected to win — draw is a bad result, should lose rating
    expect(result.homeRecord.rating).toBeLessThan(1700);
    // Weak team expected to lose — draw is a good result, should gain rating
    expect(result.awayRecord.rating).toBeGreaterThan(1300);
  });
});

// ── getEffectiveElo ───────────────────────────────────────────────────────

describe('getEffectiveElo', () => {
  it('returns default Elo and LIMITED_MODE for new team (no record)', () => {
    const pool = createClubRatingPool();
    const result = getEffectiveElo('unknown-team', pool, 'CLUB');

    expect(result.rating).toBe(DEFAULT_ELO_RATING);
    expect(result.isLimitedMode).toBe(true);
    expect(result.limitedModeReason).toBe('NEW_TEAM');
    expect(result.updateCount).toBe(0);
  });

  it('returns LIMITED_MODE for team with sparse history (§20)', () => {
    const pool = createClubRatingPool();
    // updateCount = 3 < MIN_RECENT_MATCHES_CLUB = 5
    pool.set({
      teamId: 'sparse',
      rating: 1520,
      updateCount: 3,
      lastUpdatedUtc: '2024-01-01T00:00:00Z',
    });

    const result = getEffectiveElo('sparse', pool, 'CLUB');
    expect(result.isLimitedMode).toBe(true);
    expect(result.limitedModeReason).toBe('SPARSE_HISTORY');
    expect(result.rating).toBe(1520);
  });

  it('returns FULL mode for team with sufficient history', () => {
    const pool = createClubRatingPool();
    // updateCount = 5 = MIN_RECENT_MATCHES_CLUB = 5
    pool.set({
      teamId: 'established',
      rating: 1600,
      updateCount: 5,
      lastUpdatedUtc: '2024-01-01T00:00:00Z',
    });

    const result = getEffectiveElo('established', pool, 'CLUB');
    expect(result.isLimitedMode).toBe(false);
    expect(result.limitedModeReason).toBeNull();
    expect(result.rating).toBe(1600);
  });

  it('national team pool has correct minimum threshold', () => {
    const pool = createNationalTeamRatingPool();
    // updateCount = 4 < MIN_RECENT_MATCHES_NATIONAL_TEAM = 5 → limited
    pool.set({ teamId: 'nt', rating: 1550, updateCount: 4, lastUpdatedUtc: null });

    const result = getEffectiveElo('nt', pool, 'NATIONAL_TEAM');
    expect(result.isLimitedMode).toBe(true);

    // With 5 updates → full mode
    pool.set({ teamId: 'nt2', rating: 1550, updateCount: 5, lastUpdatedUtc: null });
    const result2 = getEffectiveElo('nt2', pool, 'NATIONAL_TEAM');
    expect(result2.isLimitedMode).toBe(false);
  });

  it('is deterministic', () => {
    const pool = createClubRatingPool();
    pool.set({ teamId: 't1', rating: 1580, updateCount: 8, lastUpdatedUtc: null });

    const r1 = getEffectiveElo('t1', pool, 'CLUB');
    const r2 = getEffectiveElo('t1', pool, 'CLUB');
    expect(r1.rating).toBe(r2.rating);
    expect(r1.isLimitedMode).toBe(r2.isLimitedMode);
  });
});

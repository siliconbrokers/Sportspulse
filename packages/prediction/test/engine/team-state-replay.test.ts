/**
 * team-state-replay.test.ts — unit tests for the pure Elo replay function.
 *
 * Tests prove:
 * 1. ANTI-LOOKAHEAD: matches at or after kickoffUtc are excluded
 * 2. DETERMINISM: same inputs → same output regardless of input order
 * 3. COMPLETENESS: BOOTSTRAP / PARTIAL / FULL thresholds
 * 4. ELO_REPLAY: known win sequence produces non-trivial Elo values
 * 5. 365D_COUNT: matches older than 365d before kickoff not counted
 * 6. EMPTY INPUT: graceful BOOTSTRAP result with DEFAULT_ELO_RATING
 *
 * H2 — Historical Team State Backbone
 */

import { describe, it, expect } from 'vitest';
import { computePreMatchTeamState } from '../../src/engine/team-state-replay.js';
import type { FinishedMatchRecord } from '../../src/engine/team-state-replay.js';
import { DEFAULT_ELO_RATING } from '../../src/store/rating-pool.js';

// ── Test helpers ────────────────────────────────────────────────────────────

function makeMatch(
  homeId: string,
  awayId: string,
  date: string,
  homeGoals: number,
  awayGoals: number,
): FinishedMatchRecord {
  return { homeTeamId: homeId, awayTeamId: awayId, utcDate: date, homeGoals, awayGoals };
}

const HOME = 'team:football-data:1';
const AWAY = 'team:football-data:2';
const THIRD = 'team:football-data:3';

// ── Test 1: ANTI-LOOKAHEAD ──────────────────────────────────────────────────

describe('computePreMatchTeamState — anti-lookahead', () => {
  it('excludes matches exactly at kickoffUtc (strict less-than)', () => {
    const kickoff = '2025-01-15T20:00:00Z';
    const matches: FinishedMatchRecord[] = [
      makeMatch(HOME, AWAY, '2025-01-10T20:00:00Z', 2, 1), // before → included
      makeMatch(HOME, AWAY, kickoff, 3, 0), // exact kickoff → excluded
      makeMatch(HOME, AWAY, '2025-01-16T20:00:00Z', 1, 1), // after → excluded
    ];

    const state = computePreMatchTeamState(matches, HOME, AWAY, kickoff);

    // Only 1 match before kickoff, so Elo was updated exactly once
    expect(state.homeTeam.updateCount).toBe(1);
    expect(state.awayTeam.updateCount).toBe(1);
    expect(state.totalHistoricalMatches).toBe(1);
  });

  it('excludes all matches when all are at or after kickoffUtc', () => {
    const kickoff = '2025-01-15T20:00:00Z';
    const matches: FinishedMatchRecord[] = [
      makeMatch(HOME, AWAY, kickoff, 1, 0),
      makeMatch(HOME, AWAY, '2025-01-20T20:00:00Z', 2, 1),
    ];

    const state = computePreMatchTeamState(matches, HOME, AWAY, kickoff);
    expect(state.totalHistoricalMatches).toBe(0);
    expect(state.dataCompleteness).toBe('BOOTSTRAP');
  });
});

// ── Test 2: DETERMINISM ─────────────────────────────────────────────────────

describe('computePreMatchTeamState — determinism', () => {
  it('produces identical output regardless of input array order', () => {
    const kickoff = '2025-06-01T18:00:00Z';
    const matches: FinishedMatchRecord[] = [
      makeMatch(HOME, AWAY, '2025-01-01T18:00:00Z', 2, 0),
      makeMatch(HOME, THIRD, '2025-02-01T18:00:00Z', 1, 1),
      makeMatch(AWAY, HOME, '2025-03-01T18:00:00Z', 0, 1),
      makeMatch(THIRD, HOME, '2025-04-01T18:00:00Z', 2, 2),
    ];

    const shuffled = [...matches].reverse();
    const result1 = computePreMatchTeamState(matches, HOME, AWAY, kickoff);
    const result2 = computePreMatchTeamState(shuffled, HOME, AWAY, kickoff);

    expect(result1.homeTeam.eloRating).toBe(result2.homeTeam.eloRating);
    expect(result1.awayTeam.eloRating).toBe(result2.awayTeam.eloRating);
    expect(result1.homeTeam.updateCount).toBe(result2.homeTeam.updateCount);
    expect(result1.homeTeam.completedMatches365d).toBe(result2.homeTeam.completedMatches365d);
    expect(result1.dataCompleteness).toBe(result2.dataCompleteness);
  });

  it('same inputs always return same Elo values (pure function)', () => {
    const kickoff = '2025-05-01T18:00:00Z';
    const matches: FinishedMatchRecord[] = [
      makeMatch(HOME, AWAY, '2024-12-01T18:00:00Z', 3, 1),
      makeMatch(AWAY, HOME, '2025-01-15T18:00:00Z', 0, 2),
    ];

    const r1 = computePreMatchTeamState(matches, HOME, AWAY, kickoff);
    const r2 = computePreMatchTeamState(matches, HOME, AWAY, kickoff);

    expect(r1.homeTeam.eloRating).toBe(r2.homeTeam.eloRating);
    expect(r1.awayTeam.eloRating).toBe(r2.awayTeam.eloRating);
  });
});

// ── Test 3: COMPLETENESS thresholds ────────────────────────────────────────

describe('computePreMatchTeamState — data completeness', () => {
  it('returns BOOTSTRAP when no matches', () => {
    const state = computePreMatchTeamState([], HOME, AWAY, '2025-01-01T00:00:00Z');
    expect(state.dataCompleteness).toBe('BOOTSTRAP');
    expect(state.earliestMatchUtc).toBeNull();
    expect(state.totalHistoricalMatches).toBe(0);
  });

  it('returns PARTIAL with 1–299 matches', () => {
    const kickoff = '2026-01-01T00:00:00Z';
    // Generate 50 matches between different teams
    const matches: FinishedMatchRecord[] = Array.from({ length: 50 }, (_, i) => {
      const d = new Date('2025-01-01T18:00:00Z');
      d.setDate(d.getDate() + i * 3);
      return makeMatch(HOME, AWAY, d.toISOString(), 1, 0);
    });
    const state = computePreMatchTeamState(matches, HOME, AWAY, kickoff);
    expect(state.dataCompleteness).toBe('PARTIAL');
    expect(state.totalHistoricalMatches).toBe(50);
  });

  it('returns FULL with ≥ 300 matches', () => {
    const kickoff = '2026-06-01T00:00:00Z';
    const teams = ['t1', 't2', 't3', 't4'];
    const matches: FinishedMatchRecord[] = [];
    // Generate 300+ matches across many team pairs
    for (let i = 0; i < 310; i++) {
      const d = new Date('2024-01-01T18:00:00Z');
      d.setDate(d.getDate() + i);
      const home = teams[i % teams.length];
      const away = teams[(i + 1) % teams.length];
      matches.push(makeMatch(home, away, d.toISOString(), 1, 0));
    }
    const state = computePreMatchTeamState(matches, 't1', 't2', kickoff);
    expect(state.dataCompleteness).toBe('FULL');
    expect(state.totalHistoricalMatches).toBeGreaterThanOrEqual(300);
  });
});

// ── Test 4: ELO_REPLAY — non-trivial Elo after known results ───────────────

describe('computePreMatchTeamState — Elo replay', () => {
  it('team that wins consistently has higher Elo than loser', () => {
    const kickoff = '2025-06-01T18:00:00Z';
    // HOME wins all 10 matches against AWAY
    const matches: FinishedMatchRecord[] = Array.from({ length: 10 }, (_, i) => {
      const d = new Date('2025-01-01T18:00:00Z');
      d.setDate(d.getDate() + i * 14);
      return makeMatch(HOME, AWAY, d.toISOString(), 2, 0);
    });

    const state = computePreMatchTeamState(matches, HOME, AWAY, kickoff);

    expect(state.homeTeam.eloRating).toBeGreaterThan(DEFAULT_ELO_RATING);
    expect(state.awayTeam.eloRating).toBeLessThan(DEFAULT_ELO_RATING);
    expect(state.homeTeam.eloRating).toBeGreaterThan(state.awayTeam.eloRating);
    expect(state.homeTeam.updateCount).toBe(10);
    expect(state.awayTeam.updateCount).toBe(10);
  });

  it('symmetric: equal wins produce approx equal Elo', () => {
    const kickoff = '2025-07-01T18:00:00Z';
    // HOME wins 5, AWAY wins 5, alternating
    const matches: FinishedMatchRecord[] = Array.from({ length: 10 }, (_, i) => {
      const d = new Date('2025-01-01T18:00:00Z');
      d.setDate(d.getDate() + i * 14);
      return i % 2 === 0
        ? makeMatch(HOME, AWAY, d.toISOString(), 1, 0) // HOME wins
        : makeMatch(AWAY, HOME, d.toISOString(), 1, 0); // AWAY wins (from AWAY's perspective)
    });

    const state = computePreMatchTeamState(matches, HOME, AWAY, kickoff);

    // Elo values should be close (within a reasonable range)
    const diff = Math.abs(state.homeTeam.eloRating - state.awayTeam.eloRating);
    expect(diff).toBeLessThan(100);
  });

  it('new team with no history returns DEFAULT_ELO_RATING and updateCount 0', () => {
    const kickoff = '2025-05-01T18:00:00Z';
    const OTHER = 'team:football-data:99';
    // Matches only between HOME and AWAY — THIRD never plays
    const matches: FinishedMatchRecord[] = [
      makeMatch(HOME, AWAY, '2025-01-01T18:00:00Z', 1, 0),
      makeMatch(HOME, AWAY, '2025-02-01T18:00:00Z', 0, 1),
    ];

    const state = computePreMatchTeamState(matches, OTHER, AWAY, kickoff);

    expect(state.homeTeam.eloRating).toBe(DEFAULT_ELO_RATING);
    expect(state.homeTeam.updateCount).toBe(0);
  });
});

// ── Test 5: 365D_COUNT ──────────────────────────────────────────────────────

describe('computePreMatchTeamState — 365d match count', () => {
  it('counts matches within 365 days before kickoff', () => {
    const kickoff = '2025-06-01T18:00:00Z';
    // Match 400 days before kickoff → outside window
    const d400 = new Date(new Date(kickoff).getTime() - 400 * 24 * 3600_000).toISOString();
    // Match 200 days before kickoff → inside window
    const d200 = new Date(new Date(kickoff).getTime() - 200 * 24 * 3600_000).toISOString();
    // Match 10 days before kickoff → inside window
    const d10 = new Date(new Date(kickoff).getTime() - 10 * 24 * 3600_000).toISOString();

    const matches: FinishedMatchRecord[] = [
      makeMatch(HOME, AWAY, d400, 1, 0), // outside 365d window
      makeMatch(HOME, AWAY, d200, 2, 1), // inside
      makeMatch(HOME, AWAY, d10, 1, 2), // inside
    ];

    const state = computePreMatchTeamState(matches, HOME, AWAY, kickoff);

    // Both teams participated in 3 total matches, but only 2 are within 365d
    expect(state.homeTeam.completedMatches365d).toBe(2);
    expect(state.awayTeam.completedMatches365d).toBe(2);
  });

  it('counts home and away appearances separately', () => {
    const kickoff = '2025-06-01T18:00:00Z';
    const recent = (daysAgo: number) =>
      new Date(new Date(kickoff).getTime() - daysAgo * 24 * 3600_000).toISOString();

    // HOME plays 3 matches (as home + away), AWAY plays 1 match
    const matches: FinishedMatchRecord[] = [
      makeMatch(HOME, THIRD, recent(30), 1, 0), // HOME plays
      makeMatch(THIRD, HOME, recent(60), 0, 2), // HOME plays (as away)
      makeMatch(HOME, AWAY, recent(90), 1, 1), // both play
      makeMatch(THIRD, AWAY, recent(120), 2, 0), // AWAY plays (as away)
    ];

    const state = computePreMatchTeamState(matches, HOME, AWAY, kickoff);

    // HOME appears in matches 0, 1, 2 → 3 times
    expect(state.homeTeam.completedMatches365d).toBe(3);
    // AWAY appears in matches 2, 3 → 2 times
    expect(state.awayTeam.completedMatches365d).toBe(2);
  });

  it('returns 0 for teams with no matches in the 365d window', () => {
    const kickoff = '2025-06-01T18:00:00Z';
    // Only very old matches
    const old = new Date(new Date(kickoff).getTime() - 400 * 24 * 3600_000).toISOString();
    const matches: FinishedMatchRecord[] = [makeMatch(HOME, AWAY, old, 1, 0)];

    const state = computePreMatchTeamState(matches, HOME, AWAY, kickoff);

    expect(state.homeTeam.completedMatches365d).toBe(0);
    expect(state.awayTeam.completedMatches365d).toBe(0);
    // But Elo was still updated (the match is before kickoff, just outside 365d)
    expect(state.homeTeam.updateCount).toBe(1);
  });
});

// ── Test 6: EMPTY INPUT ─────────────────────────────────────────────────────

describe('computePreMatchTeamState — empty input', () => {
  it('returns DEFAULT_ELO_RATING for both teams', () => {
    const state = computePreMatchTeamState([], HOME, AWAY, '2025-01-01T00:00:00Z');
    expect(state.homeTeam.eloRating).toBe(DEFAULT_ELO_RATING);
    expect(state.awayTeam.eloRating).toBe(DEFAULT_ELO_RATING);
  });

  it('returns BOOTSTRAP with 0 counts', () => {
    const state = computePreMatchTeamState([], HOME, AWAY, '2025-01-01T00:00:00Z');
    expect(state.homeTeam.completedMatches365d).toBe(0);
    expect(state.awayTeam.completedMatches365d).toBe(0);
    expect(state.homeTeam.updateCount).toBe(0);
    expect(state.awayTeam.updateCount).toBe(0);
    expect(state.earliestMatchUtc).toBeNull();
    expect(state.dataCompleteness).toBe('BOOTSTRAP');
  });
});

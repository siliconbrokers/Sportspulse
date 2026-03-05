import { describe, it, expect } from 'vitest';
import { computeFormPointsLast5, SignalKey } from '../src/index.js';
import type { Match } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';

const BUILD_NOW = '2025-12-15T12:00:00Z';
const TEAM_ID = 'team:football-data:86';

function makeMatch(overrides: Partial<Match> & { matchId: string }): Match {
  return {
    seasonId: 'season:1',
    startTimeUtc: '2025-12-01T20:00:00Z',
    status: EventStatus.FINISHED,
    homeTeamId: TEAM_ID,
    awayTeamId: 'team:football-data:81',
    scoreHome: 2,
    scoreAway: 1,
    providerKey: 'football-data',
    providerMatchId: '1',
    lastSeenUtc: BUILD_NOW,
    ...overrides,
  };
}

// B-01: normal computation with 5 matches
describe('FORM_POINTS_LAST_5 — normal (B-01)', () => {
  const matches: Match[] = [
    makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-14T20:00:00Z', scoreHome: 2, scoreAway: 1 }), // W=3
    makeMatch({ matchId: 'm2', startTimeUtc: '2025-12-12T20:00:00Z', scoreHome: 1, scoreAway: 1 }), // D=1
    makeMatch({ matchId: 'm3', startTimeUtc: '2025-12-10T20:00:00Z', scoreHome: 0, scoreAway: 2 }), // L=0
    makeMatch({ matchId: 'm4', startTimeUtc: '2025-12-08T20:00:00Z', scoreHome: 3, scoreAway: 0 }), // W=3
    makeMatch({ matchId: 'm5', startTimeUtc: '2025-12-06T20:00:00Z', scoreHome: 1, scoreAway: 0 }), // W=3
  ];
  // Total: 3+1+0+3+3 = 10, max = 15, norm = 10/15 ≈ 0.6667

  it('computes correct normalized value', () => {
    const signal = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(signal.value).toBeCloseTo(10 / 15, 4);
  });

  it('has correct params', () => {
    const signal = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(signal.params?.windowSize).toBe(5);
    expect(signal.params?.matchesUsed).toBe(5);
    expect(signal.params?.rawPoints).toBe(10);
    expect(signal.params?.maxPoints).toBe(15);
  });

  it('is not missing', () => {
    const signal = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(signal.quality.missing).toBe(false);
  });

  it('has correct key and entity', () => {
    const signal = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(signal.key).toBe(SignalKey.FORM_POINTS_LAST_5);
    expect(signal.entityId).toBe(TEAM_ID);
    expect(signal.entityKind).toBe('TEAM');
    expect(signal.unit).toBe('points');
  });
});

// B-02: insufficient history (3 matches)
describe('FORM_POINTS_LAST_5 — insufficient history (B-02)', () => {
  const matches: Match[] = [
    makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-14T20:00:00Z', scoreHome: 2, scoreAway: 1 }), // W=3
    makeMatch({ matchId: 'm2', startTimeUtc: '2025-12-12T20:00:00Z', scoreHome: 1, scoreAway: 1 }), // D=1
    makeMatch({ matchId: 'm3', startTimeUtc: '2025-12-10T20:00:00Z', scoreHome: 0, scoreAway: 2 }), // L=0
  ];
  // Total: 3+1+0 = 4, max = 9, norm = 4/9

  it('computes using available matches', () => {
    const signal = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(signal.params?.matchesUsed).toBe(3);
    expect(signal.value).toBeCloseTo(4 / 9, 4);
  });

  it('is not marked missing (has some history)', () => {
    const signal = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(signal.quality.missing).toBe(false);
  });
});

// B-03: zero history
describe('FORM_POINTS_LAST_5 — zero history (B-03)', () => {
  it('returns missing signal with value 0', () => {
    const signal = computeFormPointsLast5(TEAM_ID, [], BUILD_NOW);
    expect(signal.quality.missing).toBe(true);
    expect(signal.value).toBe(0);
    expect(signal.params?.matchesUsed).toBe(0);
    expect(signal.params?.reason).toBe('no_finished_matches');
  });
});

// Additional cases
describe('FORM_POINTS_LAST_5 — edge cases', () => {
  it('ignores matches after buildNowUtc', () => {
    const matches: Match[] = [
      makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-16T20:00:00Z', scoreHome: 2, scoreAway: 0 }),
    ];
    const signal = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(signal.quality.missing).toBe(true);
  });

  it('ignores non-finished matches', () => {
    const matches: Match[] = [
      makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-14T20:00:00Z', status: EventStatus.SCHEDULED }),
    ];
    const signal = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(signal.quality.missing).toBe(true);
  });

  it('uses only last 5 when more than 5 finished matches exist', () => {
    const matches = Array.from({ length: 8 }, (_, i) =>
      makeMatch({
        matchId: `m${i}`,
        startTimeUtc: `2025-12-${String(14 - i).padStart(2, '0')}T20:00:00Z`,
        scoreHome: 1,
        scoreAway: 0, // all wins
      }),
    );
    const signal = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(signal.params?.matchesUsed).toBe(5);
    expect(signal.params?.rawPoints).toBe(15);
    expect(signal.value).toBe(1);
  });

  it('handles away matches correctly', () => {
    const awayMatch = makeMatch({
      matchId: 'm1',
      startTimeUtc: '2025-12-14T20:00:00Z',
      homeTeamId: 'team:other',
      awayTeamId: TEAM_ID,
      scoreHome: 1,
      scoreAway: 3, // team won as away
    });
    const signal = computeFormPointsLast5(TEAM_ID, [awayMatch], BUILD_NOW);
    expect(signal.params?.rawPoints).toBe(3); // win
  });

  it('is deterministic across repeated calls', () => {
    const matches: Match[] = [
      makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-14T20:00:00Z' }),
      makeMatch({ matchId: 'm2', startTimeUtc: '2025-12-12T20:00:00Z' }),
    ];
    const r1 = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    const r2 = computeFormPointsLast5(TEAM_ID, matches, BUILD_NOW);
    expect(r1).toEqual(r2);
  });
});

import { describe, it, expect } from 'vitest';
import { computeNextMatchHours, SignalKey } from '../src/index.js';
import type { Match } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';

const BUILD_NOW = '2025-12-15T12:00:00Z';
const TEAM_ID = 'team:football-data:86';

function makeMatch(overrides: Partial<Match> & { matchId: string }): Match {
  return {
    seasonId: 'season:1',
    startTimeUtc: '2025-12-18T20:00:00Z',
    status: EventStatus.SCHEDULED,
    homeTeamId: TEAM_ID,
    awayTeamId: 'team:football-data:81',
    scoreHome: null,
    scoreAway: null,
    providerKey: 'football-data',
    providerMatchId: '1',
    lastSeenUtc: BUILD_NOW,
    ...overrides,
  };
}

// B-04: normal computation
describe('NEXT_MATCH_HOURS — normal (B-04)', () => {
  // Match at Dec 18 20:00 UTC, build at Dec 15 12:00 UTC → 80 hours
  const matches: Match[] = [
    makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-18T20:00:00Z' }),
  ];

  it('computes correct hours', () => {
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.params?.hours).toBeCloseTo(80, 1);
  });

  it('computes correct inverse-normalized value', () => {
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    // norm = 1 - clamp(80/168, 0, 1) = 1 - 0.4762 ≈ 0.5238
    const expected = 1 - 80 / 168;
    expect(signal.value).toBeCloseTo(expected, 4);
  });

  it('has correct params', () => {
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.params?.minHours).toBe(0);
    expect(signal.params?.maxHours).toBe(168);
    expect(signal.params?.nextMatchId).toBe('m1');
  });

  it('is not missing', () => {
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.quality.missing).toBe(false);
    expect(signal.key).toBe(SignalKey.NEXT_MATCH_HOURS);
    expect(signal.entityKind).toBe('TEAM');
    expect(signal.unit).toBe('hours');
  });
});

// B-05: no upcoming match
describe('NEXT_MATCH_HOURS — no upcoming match (B-05)', () => {
  it('returns missing signal with value 0', () => {
    const signal = computeNextMatchHours(TEAM_ID, [], BUILD_NOW);
    expect(signal.quality.missing).toBe(true);
    expect(signal.value).toBe(0);
    expect(signal.params?.reason).toBe('no_next_match');
    expect(signal.params?.nextMatchId).toBeNull();
  });
});

// B-06: buildNowUtc determinism
describe('NEXT_MATCH_HOURS — determinism (B-06)', () => {
  const matches: Match[] = [
    makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-18T20:00:00Z' }),
  ];

  it('produces identical output across repeated runs', () => {
    const r1 = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    const r2 = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(r1).toEqual(r2);
  });
});

describe('NEXT_MATCH_HOURS — edge cases', () => {
  it('picks the soonest match when multiple exist', () => {
    const matches: Match[] = [
      makeMatch({ matchId: 'm2', startTimeUtc: '2025-12-20T20:00:00Z' }),
      makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-16T14:00:00Z' }),
    ];
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.params?.nextMatchId).toBe('m1');
    // 26 hours
    expect(signal.params?.hours).toBeCloseTo(26, 1);
  });

  it('ignores finished matches', () => {
    const matches: Match[] = [
      makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-16T20:00:00Z', status: EventStatus.FINISHED }),
    ];
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.quality.missing).toBe(true);
  });

  it('ignores matches before buildNowUtc', () => {
    const matches: Match[] = [
      makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-14T20:00:00Z' }),
    ];
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.quality.missing).toBe(true);
  });

  it('clamps to 1.0 for match starting immediately', () => {
    const matches: Match[] = [
      makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-15T12:00:01Z' }),
    ];
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.value).toBeCloseTo(1, 2);
  });

  it('clamps to 0.0 for match at or beyond horizon', () => {
    const matches: Match[] = [
      makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-22T12:00:00Z' }), // exactly 168h
    ];
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.value).toBe(0);
  });

  it('includes TBD status matches', () => {
    const matches: Match[] = [
      makeMatch({ matchId: 'm1', startTimeUtc: '2025-12-17T20:00:00Z', status: EventStatus.TBD }),
    ];
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.quality.missing).toBe(false);
    expect(signal.params?.nextMatchId).toBe('m1');
  });

  it('handles away matches', () => {
    const matches: Match[] = [
      makeMatch({
        matchId: 'm1',
        startTimeUtc: '2025-12-17T20:00:00Z',
        homeTeamId: 'team:other',
        awayTeamId: TEAM_ID,
      }),
    ];
    const signal = computeNextMatchHours(TEAM_ID, matches, BUILD_NOW);
    expect(signal.quality.missing).toBe(false);
  });
});

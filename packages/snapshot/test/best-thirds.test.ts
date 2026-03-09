import { describe, it, expect } from 'vitest';
import { computeBestThirds } from '../src/derivation/best-thirds.js';
import type { StandingEntry } from '../src/data/data-source.js';

function makeThird(overrides: Partial<StandingEntry> & { teamName: string }): StandingEntry {
  return {
    position: 3,
    teamId: `team:${overrides.teamName.toLowerCase().replace(/\s/g, '-')}`,
    teamName: overrides.teamName,
    playedGames: 3,
    won: 0,
    draw: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    groupId: 'group:default:0',
    ...overrides,
  };
}

describe('computeBestThirds', () => {
  it('returns empty array when count is 0', () => {
    const thirds = [makeThird({ teamName: 'Argentina', points: 7 })];
    expect(computeBestThirds(thirds, 0)).toEqual([]);
  });

  it('returns empty array when there are no third-place entries', () => {
    const standings: StandingEntry[] = [
      { ...makeThird({ teamName: 'Brasil', points: 9 }), position: 1 },
      { ...makeThird({ teamName: 'Uruguay', points: 6 }), position: 2 },
    ];
    expect(computeBestThirds(standings, 4)).toHaveLength(0);
  });

  it('ignores entries without groupId', () => {
    const standings: StandingEntry[] = [
      makeThird({ teamName: 'Colombia', points: 6, groupId: undefined }),
      makeThird({ teamName: 'Ecuador', points: 5, groupId: 'group:wc:0' }),
    ];
    const result = computeBestThirds(standings, 4);
    expect(result).toHaveLength(1);
    expect(result[0].teamName).toBe('Ecuador');
  });

  it('sorts by points descending', () => {
    const standings = [
      makeThird({ teamName: 'C', points: 4, groupId: 'group:wc:2' }),
      makeThird({ teamName: 'A', points: 7, groupId: 'group:wc:0' }),
      makeThird({ teamName: 'B', points: 6, groupId: 'group:wc:1' }),
    ];
    const result = computeBestThirds(standings, 3);
    expect(result.map((r) => r.teamName)).toEqual(['A', 'B', 'C']);
  });

  it('uses goalDifference as tiebreak when points are equal', () => {
    const standings = [
      makeThird({ teamName: 'Peru', points: 4, goalDifference: -1, groupId: 'group:wc:0' }),
      makeThird({ teamName: 'Bolivia', points: 4, goalDifference: 2, groupId: 'group:wc:1' }),
      makeThird({ teamName: 'Chile', points: 4, goalDifference: 0, groupId: 'group:wc:2' }),
    ];
    const result = computeBestThirds(standings, 3);
    expect(result.map((r) => r.teamName)).toEqual(['Bolivia', 'Chile', 'Peru']);
  });

  it('uses goalsFor as tiebreak when points and GD are equal', () => {
    const standings = [
      makeThird({
        teamName: 'X',
        points: 4,
        goalDifference: 1,
        goalsFor: 3,
        groupId: 'group:wc:0',
      }),
      makeThird({
        teamName: 'Y',
        points: 4,
        goalDifference: 1,
        goalsFor: 5,
        groupId: 'group:wc:1',
      }),
    ];
    const result = computeBestThirds(standings, 2);
    expect(result[0].teamName).toBe('Y');
    expect(result[1].teamName).toBe('X');
  });

  it('uses teamName alphabetically as final deterministic tiebreak', () => {
    const standings = [
      makeThird({
        teamName: 'Zimbabwe',
        points: 3,
        goalDifference: 0,
        goalsFor: 1,
        groupId: 'group:wc:5',
      }),
      makeThird({
        teamName: 'Angola',
        points: 3,
        goalDifference: 0,
        goalsFor: 1,
        groupId: 'group:wc:0',
      }),
      makeThird({
        teamName: 'Morocco',
        points: 3,
        goalDifference: 0,
        goalsFor: 1,
        groupId: 'group:wc:3',
      }),
    ];
    const result = computeBestThirds(standings, 3);
    expect(result.map((r) => r.teamName)).toEqual(['Angola', 'Morocco', 'Zimbabwe']);
  });

  it('slices to count even if there are more thirds', () => {
    const standings = Array.from({ length: 12 }, (_, i) =>
      makeThird({ teamName: `Team${i}`, points: 12 - i, groupId: `group:wc:${i}` }),
    );
    const result = computeBestThirds(standings, 8);
    expect(result).toHaveLength(8);
    expect(result[0].teamName).toBe('Team0'); // highest points
  });

  it('returns all thirds when count exceeds available thirds', () => {
    const standings = [
      makeThird({ teamName: 'A', points: 5, groupId: 'group:wc:0' }),
      makeThird({ teamName: 'B', points: 3, groupId: 'group:wc:1' }),
    ];
    const result = computeBestThirds(standings, 8);
    expect(result).toHaveLength(2);
  });

  it('is deterministic: same input always produces same output', () => {
    const standings = [
      makeThird({
        teamName: 'Alpha',
        points: 4,
        goalDifference: 1,
        goalsFor: 2,
        groupId: 'group:wc:0',
      }),
      makeThird({
        teamName: 'Beta',
        points: 4,
        goalDifference: 1,
        goalsFor: 2,
        groupId: 'group:wc:1',
      }),
      makeThird({
        teamName: 'Gamma',
        points: 6,
        goalDifference: 3,
        goalsFor: 4,
        groupId: 'group:wc:2',
      }),
    ];
    const r1 = computeBestThirds(standings, 3);
    const r2 = computeBestThirds(standings, 3);
    expect(r1.map((e) => e.teamName)).toEqual(r2.map((e) => e.teamName));
  });
});

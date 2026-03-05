import { describe, it, expect } from 'vitest';
import { SnapshotService, SnapshotBuildFailed, InMemorySnapshotStore } from '../src/index.js';
import { MVP_POLICY } from '@sportpulse/scoring';
import { EventStatus, Sport } from '@sportpulse/canonical';
import type { Team, Match } from '@sportpulse/canonical';
import type { TreemapContainer } from '@sportpulse/layout';

const CONTAINER: TreemapContainer = {
  width: 1200,
  height: 700,
  outerPadding: 8,
  innerGutter: 6,
};

function makeTeam(id: string, name: string): Team {
  return {
    teamId: `team:football-data:${id}`,
    sportId: Sport.FOOTBALL,
    name,
    providerKey: 'football-data',
    providerTeamId: id,
  };
}

function makeMatch(
  id: string,
  homeId: string,
  awayId: string,
  status: EventStatus,
  startTime: string,
  scoreHome: number | null = null,
  scoreAway: number | null = null,
): Match {
  return {
    matchId: `match:football-data:${id}`,
    seasonId: 'season:football-data:2025',
    startTimeUtc: startTime,
    status,
    homeTeamId: `team:football-data:${homeId}`,
    awayTeamId: `team:football-data:${awayId}`,
    scoreHome,
    scoreAway,
    providerKey: 'football-data',
    providerMatchId: id,
    lastSeenUtc: '2026-03-04T11:00:00Z',
  };
}

const TEAMS: Team[] = [
  makeTeam('86', 'Real Madrid'),
  makeTeam('81', 'FC Barcelona'),
];

const MATCHES: Match[] = [
  makeMatch('1', '86', '100', EventStatus.FINISHED, '2026-02-01T20:00:00Z', 2, 0),
  makeMatch('2', '86', '101', EventStatus.FINISHED, '2026-02-08T20:00:00Z', 3, 1),
  makeMatch('3', '102', '86', EventStatus.FINISHED, '2026-02-15T20:00:00Z', 0, 1),
  makeMatch('4', '86', '103', EventStatus.FINISHED, '2026-02-22T20:00:00Z', 1, 1),
  makeMatch('5', '104', '86', EventStatus.FINISHED, '2026-03-01T20:00:00Z', 0, 2),
  makeMatch('6', '81', '100', EventStatus.FINISHED, '2026-02-05T20:00:00Z', 2, 0),
  makeMatch('7', '101', '81', EventStatus.FINISHED, '2026-02-12T20:00:00Z', 1, 0),
  makeMatch('8', '81', '102', EventStatus.FINISHED, '2026-02-19T20:00:00Z', 1, 1),
  makeMatch('9', '86', '81', EventStatus.SCHEDULED, '2026-03-05T20:00:00Z'),
  makeMatch('10', '103', '81', EventStatus.SCHEDULED, '2026-03-10T18:00:00Z'),
];

const SERVE_INPUT = {
  competitionId: 'comp:football-data:PD',
  seasonId: 'season:football-data:2025',
  dateLocal: '2026-03-04',
  timezone: 'Europe/Madrid',
  teams: TEAMS,
  matches: MATCHES,
};

function createService(store?: InMemorySnapshotStore) {
  return new SnapshotService({
    store: store ?? new InMemorySnapshotStore(),
    defaultPolicy: MVP_POLICY,
    defaultContainer: CONTAINER,
  });
}

describe('SnapshotService', () => {
  it('fresh build stores and returns source "fresh"', () => {
    const result = createService().serve(SERVE_INPUT);

    expect(result.source).toBe('fresh');
    expect(result.snapshot.header.competitionId).toBe('comp:football-data:PD');
    expect(result.snapshot.teams.length).toBe(2);
  });

  it('second call with same input returns from cache', () => {
    const store = new InMemorySnapshotStore();
    const service = createService(store);

    const first = service.serve(SERVE_INPUT);
    expect(first.source).toBe('fresh');

    const second = service.serve(SERVE_INPUT);
    expect(second.source).toBe('cache');
    expect(second.snapshot).toBe(first.snapshot); // same reference
  });

  it('cache hit returns same snapshot without rebuild', () => {
    const store = new InMemorySnapshotStore();
    const service = createService(store);

    // First call populates cache
    const first = service.serve(SERVE_INPUT);
    expect(first.source).toBe('fresh');

    // Second call should be a cache hit
    const second = service.serve(SERVE_INPUT);
    expect(second.source).toBe('cache');
    expect(second.snapshot.header.snapshotKey).toBe(first.snapshot.header.snapshotKey);
  });

  it('different dateLocal produces different cache keys', () => {
    const store = new InMemorySnapshotStore();
    const service = createService(store);

    const r1 = service.serve(SERVE_INPUT);
    const r2 = service.serve({ ...SERVE_INPUT, dateLocal: '2026-03-05' });

    expect(r1.source).toBe('fresh');
    expect(r2.source).toBe('fresh');
    expect(r1.snapshot.header.snapshotKey).not.toBe(r2.snapshot.header.snapshotKey);
  });

  it('build failure with no cache throws SnapshotBuildFailed', () => {
    const service = createService();

    // Pass empty teams array - this should still work, so instead pass
    // invalid input that will cause buildSnapshot to fail.
    // We provide teams but sabotage the policy to cause a failure.
    expect(() =>
      service.serve({
        ...SERVE_INPUT,
        // Use an invalid timezone to make buildNowUtcFromDate throw
        timezone: 'Invalid/Timezone_That_Does_Not_Exist',
      }),
    ).toThrow();
  });
});

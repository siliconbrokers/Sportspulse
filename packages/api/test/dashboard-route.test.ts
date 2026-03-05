import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  SnapshotService,
  InMemorySnapshotStore,
} from '@sportpulse/snapshot';
import type { DataSource } from '@sportpulse/snapshot';
import { MVP_POLICY } from '@sportpulse/scoring';
import { EventStatus, Sport } from '@sportpulse/canonical';
import type { Team, Match } from '@sportpulse/canonical';

const CONTAINER = { width: 1200, height: 700, outerPadding: 8, innerGutter: 6 };

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
  makeMatch('9', '86', '81', EventStatus.SCHEDULED, '2026-03-05T20:00:00Z'),
];

const mockDataSource: DataSource = {
  getTeams: (competitionId: string) =>
    competitionId === 'comp:football-data:PD' ? TEAMS : [],
  getMatches: (_seasonId: string) => MATCHES,
  getSeasonId: (competitionId: string) =>
    competitionId === 'comp:football-data:PD' ? 'season:football-data:2025' : undefined,
};

describe('GET /api/ui/dashboard', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const store = new InMemorySnapshotStore();
    const snapshotService = new SnapshotService({
      store,
      defaultPolicy: MVP_POLICY,
      defaultContainer: CONTAINER,
    });

    app = buildApp({ snapshotService, dataSource: mockDataSource });
    await app.ready();
  });

  it('returns 200 with DashboardSnapshotDTO shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:football-data:PD&dateLocal=2026-03-04',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.header).toBeDefined();
    expect(body.header.competitionId).toBe('comp:football-data:PD');
    expect(body.layout).toBeDefined();
    expect(body.teams).toBeDefined();
    expect(Array.isArray(body.teams)).toBe(true);
    expect(body.teams.length).toBe(2);
  });

  it('has cache headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:football-data:PD&dateLocal=2026-03-04',
    });
    expect(res.headers['cache-control']).toBe(
      'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    );
    expect(res.headers['x-snapshot-source']).toBeDefined();
  });

  it('strips signals by default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:football-data:PD&dateLocal=2026-03-04',
    });
    const body = JSON.parse(res.body);
    for (const team of body.teams) {
      expect(team.signals).toBeUndefined();
    }
  });

  it('includes signals when includeSignals=true', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:football-data:PD&dateLocal=2026-03-04&includeSignals=true',
    });
    const body = JSON.parse(res.body);
    for (const team of body.teams) {
      expect(team.signals).toBeDefined();
    }
  });

  it('returns 400 on missing competitionId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?dateLocal=2026-03-04',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 on invalid dateLocal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:test&dateLocal=invalid',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 on unknown competitionId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:unknown&dateLocal=2026-03-04',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('second call returns from cache', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:football-data:PD&dateLocal=2026-03-04',
    });
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:football-data:PD&dateLocal=2026-03-04',
    });
    expect(res2.headers['x-snapshot-source']).toBe('cache');
  });
});

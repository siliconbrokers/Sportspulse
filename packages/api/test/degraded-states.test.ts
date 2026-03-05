import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { SnapshotService, InMemorySnapshotStore } from '@sportpulse/snapshot';
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

const TEAMS: Team[] = [makeTeam('200', 'Team A'), makeTeam('201', 'Team B')];

describe('Dashboard degraded states', () => {
  describe('zero-score teams → 200 + LAYOUT_DEGRADED', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      // DataSource returns teams but NO matches → all signals missing
      const mockDataSource: DataSource = {
        getTeams: (competitionId: string) => (competitionId === 'comp:test:PD' ? TEAMS : []),
        getMatches: (_seasonId: string) => [],
        getSeasonId: (competitionId: string) =>
          competitionId === 'comp:test:PD' ? 'season:test:2025' : undefined,
      };

      const store = new InMemorySnapshotStore();
      const snapshotService = new SnapshotService({
        store,
        defaultPolicy: MVP_POLICY,
        defaultContainer: CONTAINER,
      });

      app = buildApp({ snapshotService, dataSource: mockDataSource });
      await app.ready();
    });

    it('returns 200 with LAYOUT_DEGRADED warning', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/dashboard?competitionId=comp:test:PD&dateLocal=2026-03-04',
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body);
      expect(body.header).toBeDefined();
      expect(body.teams).toBeDefined();
      expect(Array.isArray(body.teams)).toBe(true);

      // All teams should have layoutWeight 0
      for (const team of body.teams) {
        expect(team.layoutWeight).toBe(0);
      }

      // warnings should include LAYOUT_DEGRADED
      expect(body.warnings).toBeDefined();
      const degraded = body.warnings.find((w: { code: string }) => w.code === 'LAYOUT_DEGRADED');
      expect(degraded).toBeDefined();
      expect(degraded.severity).toBe('WARN');
    });
  });

  describe('unknown competition → 404', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      const mockDataSource: DataSource = {
        getTeams: () => [],
        getMatches: () => [],
        getSeasonId: () => undefined,
      };

      const store = new InMemorySnapshotStore();
      const snapshotService = new SnapshotService({
        store,
        defaultPolicy: MVP_POLICY,
        defaultContainer: CONTAINER,
      });

      app = buildApp({ snapshotService, dataSource: mockDataSource });
      await app.ready();
    });

    it('returns 404 with NOT_FOUND error code', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/dashboard?competitionId=comp:unknown:XX&dateLocal=2026-03-04',
      });

      expect(res.statusCode).toBe(404);

      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});

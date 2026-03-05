import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { SnapshotService, InMemorySnapshotStore } from '@sportpulse/snapshot';
import type { DataSource } from '@sportpulse/snapshot';
import { MVP_POLICY } from '@sportpulse/scoring';
import { Sport } from '@sportpulse/canonical';
import type { Team } from '@sportpulse/canonical';

const CONTAINER = { width: 1200, height: 700, outerPadding: 8, innerGutter: 6 };

// Teams with NO matches → all signals missing → all scores 0 → LAYOUT_DEGRADED
const TEAMS: Team[] = [
  {
    teamId: 'team:test:A',
    sportId: Sport.FOOTBALL,
    name: 'Team A',
    providerKey: 'test',
    providerTeamId: 'A',
  },
  {
    teamId: 'team:test:B',
    sportId: Sport.FOOTBALL,
    name: 'Team B',
    providerKey: 'test',
    providerTeamId: 'B',
  },
  {
    teamId: 'team:test:C',
    sportId: Sport.FOOTBALL,
    name: 'Team C',
    providerKey: 'test',
    providerTeamId: 'C',
  },
];

const mockDataSource: DataSource = {
  getTeams: (id: string) => (id === 'comp:test:X' ? TEAMS : []),
  getMatches: () => [], // NO matches at all
  getSeasonId: (id: string) => (id === 'comp:test:X' ? 'season:test:2025' : undefined),
};

describe('All-zero layout fallback E2E', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const store = new InMemorySnapshotStore();
    const service = new SnapshotService({
      store,
      defaultPolicy: MVP_POLICY,
      defaultContainer: CONTAINER,
    });
    app = buildApp({ snapshotService: service, dataSource: mockDataSource });
    await app.ready();
  });

  it('returns 200 (not error)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:test:X&dateLocal=2026-03-04',
    });
    expect(res.statusCode).toBe(200);
  });

  it('contains LAYOUT_DEGRADED warning', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:test:X&dateLocal=2026-03-04',
    });
    const body = JSON.parse(res.body);
    const degraded = body.warnings.find((w: any) => w.code === 'LAYOUT_DEGRADED');
    expect(degraded).toBeDefined();
    expect(degraded.severity).toBe('WARN');
  });

  it('all teams have layoutWeight 0', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:test:X&dateLocal=2026-03-04',
    });
    const body = JSON.parse(res.body);
    for (const team of body.teams) {
      expect(team.layoutWeight).toBe(0);
    }
  });

  it('all teams have valid rect with positive dimensions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:test:X&dateLocal=2026-03-04',
    });
    const body = JSON.parse(res.body);
    expect(body.teams.length).toBe(3);
    for (const team of body.teams) {
      expect(team.rect).toBeDefined();
      expect(team.rect.w).toBeGreaterThan(0);
      expect(team.rect.h).toBeGreaterThan(0);
    }
  });

  it('all rects fit within container bounds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:test:X&dateLocal=2026-03-04',
    });
    const body = JSON.parse(res.body);
    const c = body.layout.container;
    for (const team of body.teams) {
      const r = team.rect;
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(c.width);
      expect(r.y + r.h).toBeLessThanOrEqual(c.height);
    }
  });

  it('tiles have approximately equal area (equal fallback)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ui/dashboard?competitionId=comp:test:X&dateLocal=2026-03-04',
    });
    const body = JSON.parse(res.body);
    const areas = body.teams.map((t: any) => t.rect.w * t.rect.h);
    const avgArea = areas.reduce((a: number, b: number) => a + b, 0) / areas.length;
    for (const area of areas) {
      // Within 10% tolerance of average (rounding may cause small differences)
      expect(Math.abs(area - avgArea) / avgArea).toBeLessThan(0.1);
    }
  });
});

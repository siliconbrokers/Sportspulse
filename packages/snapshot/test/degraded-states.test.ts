import { describe, it, expect } from 'vitest';
import { buildSnapshot, SnapshotService, InMemorySnapshotStore } from '../src/index.js';
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

const BUILD_NOW = '2026-03-04T11:00:00Z';

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
    lastSeenUtc: BUILD_NOW,
  };
}

function createService(store?: InMemorySnapshotStore) {
  return new SnapshotService({
    store: store ?? new InMemorySnapshotStore(),
    defaultPolicy: MVP_POLICY,
    defaultContainer: CONTAINER,
  });
}

describe('Degraded: Stale fallback (G-01)', () => {
  it('serve() returns source "cache" on second call with same key', () => {
    const store = new InMemorySnapshotStore();
    const service = createService(store);

    const teams: Team[] = [makeTeam('86', 'Real Madrid'), makeTeam('81', 'FC Barcelona')];
    const matches: Match[] = [
      makeMatch('1', '86', '100', EventStatus.FINISHED, '2026-02-01T20:00:00Z', 2, 0),
      makeMatch('9', '86', '81', EventStatus.SCHEDULED, '2026-03-05T20:00:00Z'),
    ];

    const input = {
      competitionId: 'comp:football-data:PD',
      seasonId: 'season:football-data:2025',
      dateLocal: '2026-03-04',
      timezone: 'Europe/Madrid',
      teams,
      matches,
    };

    // First call builds fresh
    const first = service.serve(input);
    expect(first.source).toBe('fresh');
    expect(first.snapshot.header.competitionId).toBe('comp:football-data:PD');

    // Second call with same key returns from cache
    const second = service.serve(input);
    expect(second.source).toBe('cache');
    expect(second.snapshot.header.snapshotKey).toBe(first.snapshot.header.snapshotKey);
  });

  it('pre-populated store returns cache hit directly', () => {
    const store = new InMemorySnapshotStore();
    const service = createService(store);

    const teams: Team[] = [makeTeam('86', 'Real Madrid'), makeTeam('81', 'FC Barcelona')];
    const matches: Match[] = [
      makeMatch('1', '86', '100', EventStatus.FINISHED, '2026-02-01T20:00:00Z', 2, 0),
      makeMatch('9', '86', '81', EventStatus.SCHEDULED, '2026-03-05T20:00:00Z'),
    ];

    // Build a snapshot and manually store it
    const snapshot = buildSnapshot({
      competitionId: 'comp:football-data:PD',
      seasonId: 'season:football-data:2025',
      buildNowUtc: BUILD_NOW,
      timezone: 'Europe/Madrid',
      teams,
      matches,
      policy: MVP_POLICY,
      container: CONTAINER,
    });

    const key = snapshot.header.snapshotKey!;
    store.set(key, snapshot);

    // serve() with matching params returns from cache
    const result = service.serve({
      competitionId: 'comp:football-data:PD',
      seasonId: 'season:football-data:2025',
      dateLocal: '2026-03-04',
      timezone: 'Europe/Madrid',
      teams,
      matches,
    });

    expect(result.source).toBe('cache');
    expect(result.snapshot.header.snapshotKey).toBe(key);
  });
});

describe('Degraded: Missing signals — no matches (G-02)', () => {
  const teams: Team[] = [makeTeam('200', 'Team A'), makeTeam('201', 'Team B')];

  const snapshot = buildSnapshot({
    competitionId: 'comp:test',
    seasonId: 'season:test',
    buildNowUtc: BUILD_NOW,
    timezone: 'UTC',
    teams,
    matches: [], // empty matches
    policy: MVP_POLICY,
    container: CONTAINER,
  });

  it('emits MISSING_SIGNAL warnings for FORM_POINTS_LAST_5 and NEXT_MATCH_HOURS', () => {
    const missing = snapshot.warnings.filter((w) => w.code === 'MISSING_SIGNAL');
    expect(missing.length).toBeGreaterThanOrEqual(2);

    const messages = missing.map((w) => w.message ?? '');
    const hasFormPoints = messages.some((m) => m.includes('FORM_POINTS_LAST_5'));
    const hasNextMatch = messages.some((m) => m.includes('NEXT_MATCH_HOURS'));
    expect(hasFormPoints).toBe(true);
    expect(hasNextMatch).toBe(true);
  });

  it('all teams have layoutWeight = 0', () => {
    for (const team of snapshot.teams) {
      expect(team.layoutWeight).toBe(0);
    }
  });

  it('emits LAYOUT_DEGRADED warning', () => {
    const degraded = snapshot.warnings.find((w) => w.code === 'LAYOUT_DEGRADED');
    expect(degraded).toBeDefined();
    expect(degraded?.severity).toBe('WARN');
  });

  it('tiles still have positive dimensions (equal-area fallback)', () => {
    for (const team of snapshot.teams) {
      expect(team.rect.w).toBeGreaterThan(0);
      expect(team.rect.h).toBeGreaterThan(0);
    }
  });
});

describe('Degraded: Insufficient history', () => {
  const teamFull = makeTeam('86', 'Real Madrid');
  const teamShort = makeTeam('81', 'FC Barcelona');

  // 5 finished matches for Real Madrid
  const matches: Match[] = [
    makeMatch('1', '86', '100', EventStatus.FINISHED, '2026-02-01T20:00:00Z', 2, 0),
    makeMatch('2', '86', '101', EventStatus.FINISHED, '2026-02-08T20:00:00Z', 3, 1),
    makeMatch('3', '102', '86', EventStatus.FINISHED, '2026-02-15T20:00:00Z', 0, 1),
    makeMatch('4', '86', '103', EventStatus.FINISHED, '2026-02-22T20:00:00Z', 1, 1),
    makeMatch('5', '104', '86', EventStatus.FINISHED, '2026-03-01T20:00:00Z', 0, 2),
    // Only 2 finished matches for Barcelona
    makeMatch('6', '81', '100', EventStatus.FINISHED, '2026-02-05T20:00:00Z', 2, 0),
    makeMatch('7', '101', '81', EventStatus.FINISHED, '2026-02-12T20:00:00Z', 1, 0),
    // Upcoming for both
    makeMatch('9', '86', '81', EventStatus.SCHEDULED, '2026-03-05T20:00:00Z'),
  ];

  const snapshot = buildSnapshot({
    competitionId: 'comp:test',
    seasonId: 'season:test',
    buildNowUtc: BUILD_NOW,
    timezone: 'UTC',
    teams: [teamFull, teamShort],
    matches,
    policy: MVP_POLICY,
    container: CONTAINER,
  });

  it('Barcelona (2 matches) gets INSUFFICIENT_HISTORY warning', () => {
    const hist = snapshot.warnings.find(
      (w) => w.code === 'INSUFFICIENT_HISTORY' && w.entityId === 'team:football-data:81',
    );
    expect(hist).toBeDefined();
    expect(hist?.severity).toBe('INFO');
  });

  it('Real Madrid (5 matches) does NOT get INSUFFICIENT_HISTORY warning', () => {
    const hist = snapshot.warnings.find(
      (w) => w.code === 'INSUFFICIENT_HISTORY' && w.entityId === 'team:football-data:86',
    );
    expect(hist).toBeUndefined();
  });
});

describe('Degraded: No upcoming match', () => {
  const teamWithNext = makeTeam('86', 'Real Madrid');
  const teamNoNext = makeTeam('200', 'Lonely FC');

  // Real Madrid has a scheduled match, Lonely FC does not
  const matches: Match[] = [
    makeMatch('1', '86', '100', EventStatus.FINISHED, '2026-02-01T20:00:00Z', 2, 0),
    makeMatch('2', '200', '100', EventStatus.FINISHED, '2026-02-05T20:00:00Z', 1, 0),
    makeMatch('9', '86', '100', EventStatus.SCHEDULED, '2026-03-05T20:00:00Z'),
  ];

  const snapshot = buildSnapshot({
    competitionId: 'comp:test',
    seasonId: 'season:test',
    buildNowUtc: BUILD_NOW,
    timezone: 'UTC',
    teams: [teamWithNext, teamNoNext],
    matches,
    policy: MVP_POLICY,
    container: CONTAINER,
  });

  it('Lonely FC gets NO_UPCOMING_MATCH warning', () => {
    const warn = snapshot.warnings.find(
      (w) => w.code === 'NO_UPCOMING_MATCH' && w.entityId === 'team:football-data:200',
    );
    expect(warn).toBeDefined();
  });

  it('Lonely FC gets MISSING_SIGNAL for NEXT_MATCH_HOURS', () => {
    const missing = snapshot.warnings.find(
      (w) =>
        w.code === 'MISSING_SIGNAL' &&
        w.entityId === 'team:football-data:200' &&
        (w.message ?? '').includes('NEXT_MATCH_HOURS'),
    );
    expect(missing).toBeDefined();
  });

  it('Lonely FC has no nextMatch', () => {
    const lonely = snapshot.teams.find((t) => t.teamId === 'team:football-data:200');
    expect(lonely?.nextMatch).toBeUndefined();
  });
});

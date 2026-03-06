import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../src/index.js';
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

const TEAMS: Team[] = [makeTeam('86', 'Real Madrid'), makeTeam('81', 'FC Barcelona')];

const MATCHES: Match[] = [
  // 5 finished matches for Real Madrid (WWWWD = 13 pts)
  makeMatch('1', '86', '100', EventStatus.FINISHED, '2026-02-01T20:00:00Z', 2, 0),
  makeMatch('2', '86', '101', EventStatus.FINISHED, '2026-02-08T20:00:00Z', 3, 1),
  makeMatch('3', '102', '86', EventStatus.FINISHED, '2026-02-15T20:00:00Z', 0, 1),
  makeMatch('4', '86', '103', EventStatus.FINISHED, '2026-02-22T20:00:00Z', 1, 1),
  makeMatch('5', '104', '86', EventStatus.FINISHED, '2026-03-01T20:00:00Z', 0, 2),
  // 3 finished matches for Barcelona (WLD = 4 pts)
  makeMatch('6', '81', '100', EventStatus.FINISHED, '2026-02-05T20:00:00Z', 2, 0),
  makeMatch('7', '101', '81', EventStatus.FINISHED, '2026-02-12T20:00:00Z', 1, 0),
  makeMatch('8', '81', '102', EventStatus.FINISHED, '2026-02-19T20:00:00Z', 1, 1),
  // Upcoming matches
  makeMatch('9', '86', '81', EventStatus.SCHEDULED, '2026-03-05T20:00:00Z'),
  makeMatch('10', '103', '81', EventStatus.SCHEDULED, '2026-03-10T18:00:00Z'),
];

describe('buildSnapshot (E-01, E-02, E-03)', () => {
  const snapshot = buildSnapshot({
    competitionId: 'comp:football-data:PD',
    seasonId: 'season:football-data:2025',
    buildNowUtc: BUILD_NOW,
    timezone: 'Europe/Madrid',
    teams: TEAMS,
    matches: MATCHES,
    policy: MVP_POLICY,
    container: CONTAINER,
  });

  it('has valid header with all required fields', () => {
    expect(snapshot.header.snapshotSchemaVersion).toBe(2);
    expect(snapshot.header.competitionId).toBe('comp:football-data:PD');
    expect(snapshot.header.seasonId).toBe('season:football-data:2025');
    expect(snapshot.header.buildNowUtc).toBe(BUILD_NOW);
    expect(snapshot.header.timezone).toBe('Europe/Madrid');
    expect(snapshot.header.policyKey).toBe('sportpulse.mvp.form-agenda');
    expect(snapshot.header.policyVersion).toBe(1);
    expect(snapshot.header.computedAtUtc).toBeDefined();
    expect(snapshot.header.snapshotKey).toBeDefined();
  });

  it('has valid layout metadata', () => {
    expect(snapshot.layout.algorithmKey).toBe('treemap.squarified');
    expect(snapshot.layout.algorithmVersion).toBe(1);
    expect(snapshot.layout.container).toEqual(CONTAINER);
  });

  it('has warnings array (may be empty)', () => {
    expect(Array.isArray(snapshot.warnings)).toBe(true);
  });

  it('has teams array with correct length', () => {
    expect(snapshot.teams).toHaveLength(2);
  });

  it('teams sorted by layoutWeight desc, teamId asc', () => {
    for (let i = 0; i < snapshot.teams.length - 1; i++) {
      const a = snapshot.teams[i];
      const b = snapshot.teams[i + 1];
      if (a.layoutWeight === b.layoutWeight) {
        expect(a.teamId.localeCompare(b.teamId)).toBeLessThanOrEqual(0);
      } else {
        expect(a.layoutWeight).toBeGreaterThan(b.layoutWeight);
      }
    }
  });

  it('each team has rect (geometry)', () => {
    for (const team of snapshot.teams) {
      expect(team.rect).toBeDefined();
      expect(team.rect.w).toBeGreaterThan(0);
      expect(team.rect.h).toBeGreaterThan(0);
    }
  });

  it('each team has scoring fields', () => {
    for (const team of snapshot.teams) {
      expect(typeof team.rawScore).toBe('number');
      expect(typeof team.attentionScore).toBe('number');
      expect(typeof team.displayScore).toBe('number');
      expect(typeof team.layoutWeight).toBe('number');
      expect(team.policyKey).toBe('sportpulse.mvp.form-agenda');
      expect(team.policyVersion).toBe(1);
      expect(team.buildNowUtc).toBe(BUILD_NOW);
    }
  });

  it('each team has topContributions', () => {
    for (const team of snapshot.teams) {
      expect(Array.isArray(team.topContributions)).toBe(true);
    }
  });

  it('each team has signals array', () => {
    for (const team of snapshot.teams) {
      expect(Array.isArray(team.signals)).toBe(true);
      expect(team.signals!.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('Real Madrid has nextMatch (El Clasico)', () => {
    const rm = snapshot.teams.find((t) => t.teamId === 'team:football-data:86');
    expect(rm?.nextMatch).toBeDefined();
    expect(rm?.nextMatch?.matchId).toBe('match:football-data:9');
    expect(rm?.nextMatch?.venue).toBe('HOME');
    expect(rm?.nextMatch?.opponentTeamId).toBe('team:football-data:81');
  });

  it('Barcelona has nextMatch', () => {
    const barca = snapshot.teams.find((t) => t.teamId === 'team:football-data:81');
    expect(barca?.nextMatch).toBeDefined();
    expect(barca?.nextMatch?.matchId).toBe('match:football-data:9');
    expect(barca?.nextMatch?.venue).toBe('AWAY');
  });
});

describe('determinism (E-02)', () => {
  it('same inputs produce identical output (excluding computedAtUtc)', () => {
    const input = {
      competitionId: 'comp:football-data:PD',
      seasonId: 'season:football-data:2025',
      buildNowUtc: BUILD_NOW,
      timezone: 'Europe/Madrid',
      teams: TEAMS,
      matches: MATCHES,
      policy: MVP_POLICY,
      container: CONTAINER,
    };
    const s1 = buildSnapshot(input);
    const s2 = buildSnapshot(input);

    // Everything except computedAtUtc should be identical
    expect(s1.teams).toEqual(s2.teams);
    expect(s1.layout).toEqual(s2.layout);
    expect(s1.warnings).toEqual(s2.warnings);
    expect(s1.header.snapshotKey).toBe(s2.header.snapshotKey);
    expect(s1.header.buildNowUtc).toBe(s2.header.buildNowUtc);
  });
});

describe('degraded: all missing signals (G-01, G-02)', () => {
  it('all-zero weights → LAYOUT_DEGRADED warning + equal tiles', () => {
    const teamsNoHistory: Team[] = [makeTeam('200', 'Team A'), makeTeam('201', 'Team B')];

    const snapshot = buildSnapshot({
      competitionId: 'comp:test',
      seasonId: 'season:test',
      buildNowUtc: BUILD_NOW,
      timezone: 'UTC',
      teams: teamsNoHistory,
      matches: [], // no matches at all
      policy: MVP_POLICY,
      container: CONTAINER,
    });

    // All weights should be 0
    for (const team of snapshot.teams) {
      expect(team.layoutWeight).toBe(0);
    }

    // Should have LAYOUT_DEGRADED warning
    const degraded = snapshot.warnings.find((w) => w.code === 'LAYOUT_DEGRADED');
    expect(degraded).toBeDefined();
    expect(degraded?.severity).toBe('WARN');

    // Should have MISSING_SIGNAL warnings
    const missing = snapshot.warnings.filter((w) => w.code === 'MISSING_SIGNAL');
    expect(missing.length).toBeGreaterThan(0);

    // Tiles should still have positive dimensions (equal-area fallback)
    for (const team of snapshot.teams) {
      expect(team.rect.w).toBeGreaterThan(0);
      expect(team.rect.h).toBeGreaterThan(0);
    }
  });
});

describe('insufficient history warning', () => {
  it('teams with <5 matches get INSUFFICIENT_HISTORY', () => {
    const snapshot = buildSnapshot({
      competitionId: 'comp:test',
      seasonId: 'season:test',
      buildNowUtc: BUILD_NOW,
      timezone: 'UTC',
      teams: TEAMS,
      matches: MATCHES,
      policy: MVP_POLICY,
      container: CONTAINER,
    });

    // Barcelona has only 3 matches
    const hist = snapshot.warnings.find(
      (w) => w.code === 'INSUFFICIENT_HISTORY' && w.entityId === 'team:football-data:81',
    );
    expect(hist).toBeDefined();
  });
});

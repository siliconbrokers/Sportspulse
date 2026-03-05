import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../src/index.js';
import { projectTeamDetail } from '../src/project/team-detail.js';
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

describe('projectTeamDetail', () => {
  it('returns null for unknown teamId', () => {
    const result = projectTeamDetail(snapshot, 'team:unknown', '2026-03-04', 'Europe/Madrid');
    expect(result).toBeNull();
  });

  it('projects Real Madrid with correct header', () => {
    const result = projectTeamDetail(
      snapshot,
      'team:football-data:86',
      '2026-03-04',
      'Europe/Madrid',
    );
    expect(result).not.toBeNull();
    expect(result!.header.competitionId).toBe('comp:football-data:PD');
    expect(result!.header.dateLocal).toBe('2026-03-04');
    expect(result!.header.timezone).toBe('Europe/Madrid');
    expect(result!.header.policyKey).toBe('sportpulse.mvp.form-agenda');
  });

  it('projects team identity', () => {
    const result = projectTeamDetail(
      snapshot,
      'team:football-data:86',
      '2026-03-04',
      'Europe/Madrid',
    );
    expect(result!.team.teamId).toBe('team:football-data:86');
    expect(result!.team.teamName).toBe('Real Madrid');
  });

  it('projects score fields', () => {
    const result = projectTeamDetail(
      snapshot,
      'team:football-data:86',
      '2026-03-04',
      'Europe/Madrid',
    );
    expect(typeof result!.score.rawScore).toBe('number');
    expect(typeof result!.score.attentionScore).toBe('number');
    expect(typeof result!.score.displayScore).toBe('number');
    expect(typeof result!.score.layoutWeight).toBe('number');
  });

  it('projects nextMatch when available', () => {
    const result = projectTeamDetail(
      snapshot,
      'team:football-data:86',
      '2026-03-04',
      'Europe/Madrid',
    );
    expect(result!.nextMatch).toBeDefined();
    expect(result!.nextMatch?.matchId).toBe('match:football-data:9');
  });

  it('projects explainability with topContributions', () => {
    const result = projectTeamDetail(
      snapshot,
      'team:football-data:86',
      '2026-03-04',
      'Europe/Madrid',
    );
    expect(result!.explainability).toBeDefined();
    expect(Array.isArray(result!.explainability.topContributions)).toBe(true);
  });

  it('projects signals in explainability', () => {
    const result = projectTeamDetail(
      snapshot,
      'team:football-data:86',
      '2026-03-04',
      'Europe/Madrid',
    );
    expect(Array.isArray(result!.explainability.signals)).toBe(true);
  });

  it('includes snapshot warnings in header', () => {
    const result = projectTeamDetail(
      snapshot,
      'team:football-data:86',
      '2026-03-04',
      'Europe/Madrid',
    );
    expect(Array.isArray(result!.header.warnings)).toBe(true);
  });
});

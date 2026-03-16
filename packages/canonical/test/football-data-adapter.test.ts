import { describe, it, expect } from 'vitest';
import {
  mapCompetition,
  mapSeason,
  mapTeam,
  mapMatch,
  PROVIDER_KEY,
  Sport,
  CompetitionFormat,
  EventStatus,
} from '../src/index.js';
import type { FDCompetitionResponse, FDTeamResponse, FDMatchResponse } from '../src/index.js';

const FD_COMPETITION: FDCompetitionResponse = {
  id: 2014,
  name: 'Primera Division',
  code: 'PD',
  type: 'LEAGUE',
  currentSeason: {
    id: 1564,
    startDate: '2025-08-15',
    endDate: '2026-05-24',
  },
};

const FD_TEAM: FDTeamResponse = {
  id: 86,
  name: 'Real Madrid CF',
  shortName: 'Real Madrid',
  tla: 'RMA',
};

const TEAM_ID_MAP = new Map<string, string>([
  ['86', 'team:real-madrid'],
  ['81', 'team:barcelona'],
]);

const FD_MATCH: FDMatchResponse = {
  id: 450123,
  season: { id: 1564 },
  utcDate: '2025-12-15T20:00:00Z',
  status: 'SCHEDULED',
  homeTeam: { id: 86, name: 'Real Madrid CF' },
  awayTeam: { id: 81, name: 'FC Barcelona' },
  score: {
    fullTime: { home: null, away: null },
  },
};

describe('PROVIDER_KEY', () => {
  it('equals football-data', () => {
    expect(PROVIDER_KEY).toBe('football-data');
  });
});

describe('mapCompetition', () => {
  it('maps football-data competition to canonical Competition', () => {
    const result = mapCompetition(FD_COMPETITION, 'comp:la-liga');
    expect(result).toEqual({
      competitionId: 'comp:la-liga',
      sportId: Sport.FOOTBALL,
      providerKey: 'football-data',
      providerCompetitionCode: 'PD',
      name: 'Primera Division',
      formatType: CompetitionFormat.LEAGUE,
      isEnabled: true,
    });
  });

  it('defaults unknown format to LEAGUE', () => {
    const fd = { ...FD_COMPETITION, type: 'SOMETHING_NEW' };
    const result = mapCompetition(fd, 'comp:x');
    expect(result.formatType).toBe(CompetitionFormat.LEAGUE);
  });

  it('maps CUP format correctly', () => {
    const fd = { ...FD_COMPETITION, type: 'CUP' };
    const result = mapCompetition(fd, 'comp:copa');
    expect(result.formatType).toBe(CompetitionFormat.CUP);
  });
});

describe('mapSeason', () => {
  it('maps current season from competition response', () => {
    const result = mapSeason(FD_COMPETITION, 'comp:la-liga', 'season:2025-26');
    expect(result).toEqual({
      seasonId: 'season:2025-26',
      competitionId: 'comp:la-liga',
      label: '2025/26',
      startDate: '2025-08-15',
      endDate: '2026-05-24',
    });
  });

  it('returns null when no current season', () => {
    const fd = { ...FD_COMPETITION, currentSeason: undefined };
    const result = mapSeason(fd, 'comp:x', 'season:x');
    expect(result).toBeNull();
  });

  it('handles same-year season label', () => {
    const fd: FDCompetitionResponse = {
      ...FD_COMPETITION,
      currentSeason: { id: 1, startDate: '2025-06-01', endDate: '2025-12-15' },
    };
    const result = mapSeason(fd, 'comp:x', 'season:x');
    expect(result?.label).toBe('2025');
  });
});

describe('mapTeam', () => {
  it('maps football-data team to canonical Team', () => {
    const result = mapTeam(FD_TEAM, 'team:real-madrid');
    expect(result).toEqual({
      teamId: 'team:real-madrid',
      sportId: Sport.FOOTBALL,
      name: 'Real Madrid CF',
      shortName: 'Real Madrid',
      tla: 'RMA',
      providerKey: 'football-data',
      providerTeamId: '86',
    });
  });

  it('uses display name override when shortName is empty', () => {
    const fd = { ...FD_TEAM, shortName: '' };
    const result = mapTeam(fd, 'team:x');
    // 'Real Madrid CF' is in DISPLAY_NAME_MAP → 'Real Madrid'
    expect(result.shortName).toBe('Real Madrid');
  });

  it('uses display name override when both shortName and tla are empty', () => {
    const fd = { ...FD_TEAM, shortName: '', tla: '' };
    const result = mapTeam(fd, 'team:x');
    // 'Real Madrid CF' is in DISPLAY_NAME_MAP → 'Real Madrid'
    expect(result.shortName).toBe('Real Madrid');
  });
});

describe('mapMatch', () => {
  it('maps football-data match to canonical Match', () => {
    const result = mapMatch(
      FD_MATCH,
      'match:450123',
      'season:2025-26',
      TEAM_ID_MAP,
      '2025-12-01T10:00:00Z',
    );
    expect(result).toEqual({
      matchId: 'match:450123',
      seasonId: 'season:2025-26',
      startTimeUtc: '2025-12-15T20:00:00Z',
      status: EventStatus.SCHEDULED,
      homeTeamId: 'team:real-madrid',
      awayTeamId: 'team:barcelona',
      scoreHome: null,
      scoreAway: null,
      providerKey: 'football-data',
      providerMatchId: '450123',
      lastSeenUtc: '2025-12-01T10:00:00Z',
    });
  });

  it('maps finished match with scores', () => {
    const fd: FDMatchResponse = {
      ...FD_MATCH,
      status: 'FINISHED',
      score: { fullTime: { home: 2, away: 1 } },
    };
    const result = mapMatch(fd, 'match:x', 'season:x', TEAM_ID_MAP, '2025-12-16T00:00:00Z');
    expect(result?.status).toBe(EventStatus.FINISHED);
    expect(result?.scoreHome).toBe(2);
    expect(result?.scoreAway).toBe(1);
  });

  it('uses classifyStatus for provider statuses', () => {
    const fd = { ...FD_MATCH, status: 'IN_PLAY' };
    const result = mapMatch(fd, 'match:x', 'season:x', TEAM_ID_MAP, '2025-12-15T20:30:00Z');
    expect(result?.status).toBe(EventStatus.IN_PROGRESS);
  });

  it('returns null when home team is not in teamIdMap', () => {
    const fd = { ...FD_MATCH, homeTeam: { id: 999, name: 'Unknown FC' } };
    const result = mapMatch(fd, 'match:x', 'season:x', TEAM_ID_MAP, '2025-12-01T00:00:00Z');
    expect(result).toBeNull();
  });

  it('returns null when away team is not in teamIdMap', () => {
    const fd = { ...FD_MATCH, awayTeam: { id: 999, name: 'Unknown FC' } };
    const result = mapMatch(fd, 'match:x', 'season:x', TEAM_ID_MAP, '2025-12-01T00:00:00Z');
    expect(result).toBeNull();
  });
});

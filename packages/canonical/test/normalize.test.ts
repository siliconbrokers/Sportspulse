import { describe, it, expect } from 'vitest';
import {
  canonicalId,
  competitionId,
  seasonId,
  teamId,
  matchId,
  normalizeIngestion,
  EventStatus,
} from '../src/index.js';
import type {
  FDCompetitionResponse,
  FDTeamResponse,
  FDMatchResponse,
} from '../src/index.js';

// --- canonical-id tests ---

describe('canonicalId', () => {
  it('produces deterministic ID from entity prefix, provider key, and provider ID', () => {
    expect(canonicalId('team', 'football-data', '86')).toBe('team:football-data:86');
  });

  it('handles numeric provider IDs', () => {
    expect(canonicalId('match', 'football-data', 450123)).toBe('match:football-data:450123');
  });

  it('is idempotent (same inputs → same output)', () => {
    const a = canonicalId('team', 'football-data', '86');
    const b = canonicalId('team', 'football-data', '86');
    expect(a).toBe(b);
  });
});

describe('typed ID helpers', () => {
  it('competitionId uses comp prefix', () => {
    expect(competitionId('football-data', 'PD')).toBe('comp:football-data:PD');
  });

  it('seasonId uses season prefix', () => {
    expect(seasonId('football-data', 1564)).toBe('season:football-data:1564');
  });

  it('teamId uses team prefix', () => {
    expect(teamId('football-data', 86)).toBe('team:football-data:86');
  });

  it('matchId uses match prefix', () => {
    expect(matchId('football-data', 450123)).toBe('match:football-data:450123');
  });
});

// --- normalizeIngestion tests ---

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

const FD_TEAMS: FDTeamResponse[] = [
  { id: 86, name: 'Real Madrid CF', shortName: 'Real Madrid', tla: 'RMA' },
  { id: 81, name: 'FC Barcelona', shortName: 'Barcelona', tla: 'BAR' },
  { id: 78, name: 'Club Atletico de Madrid', shortName: 'Atletico', tla: 'ATM' },
];

const FD_MATCHES: FDMatchResponse[] = [
  {
    id: 450001,
    season: { id: 1564 },
    utcDate: '2025-12-15T20:00:00Z',
    status: 'SCHEDULED',
    homeTeam: { id: 86, name: 'Real Madrid CF' },
    awayTeam: { id: 81, name: 'FC Barcelona' },
    score: { fullTime: { home: null, away: null } },
  },
  {
    id: 450002,
    season: { id: 1564 },
    utcDate: '2025-12-10T18:00:00Z',
    status: 'FINISHED',
    homeTeam: { id: 78, name: 'Club Atletico de Madrid' },
    awayTeam: { id: 86, name: 'Real Madrid CF' },
    score: { fullTime: { home: 1, away: 2 } },
  },
];

const NOW_UTC = '2025-12-12T10:00:00Z';

describe('normalizeIngestion', () => {
  it('produces competition with deterministic canonical ID', () => {
    const result = normalizeIngestion(FD_COMPETITION, FD_TEAMS, FD_MATCHES, NOW_UTC);
    expect(result.competition.competitionId).toBe('comp:football-data:PD');
    expect(result.competition.name).toBe('Primera Division');
  });

  it('produces season with deterministic canonical ID', () => {
    const result = normalizeIngestion(FD_COMPETITION, FD_TEAMS, FD_MATCHES, NOW_UTC);
    expect(result.season).not.toBeNull();
    expect(result.season!.seasonId).toBe('season:football-data:1564');
    expect(result.season!.competitionId).toBe('comp:football-data:PD');
  });

  it('returns null season when no currentSeason', () => {
    const fd = { ...FD_COMPETITION, currentSeason: undefined };
    const result = normalizeIngestion(fd, FD_TEAMS, [], NOW_UTC);
    expect(result.season).toBeNull();
  });

  it('produces teams with deterministic canonical IDs', () => {
    const result = normalizeIngestion(FD_COMPETITION, FD_TEAMS, FD_MATCHES, NOW_UTC);
    expect(result.teams).toHaveLength(3);
    expect(result.teams[0].teamId).toBe('team:football-data:86');
    expect(result.teams[1].teamId).toBe('team:football-data:81');
    expect(result.teams[2].teamId).toBe('team:football-data:78');
  });

  it('produces matches with deterministic canonical IDs and correct references', () => {
    const result = normalizeIngestion(FD_COMPETITION, FD_TEAMS, FD_MATCHES, NOW_UTC);
    expect(result.matches).toHaveLength(2);

    const m1 = result.matches[0];
    expect(m1.matchId).toBe('match:football-data:450001');
    expect(m1.seasonId).toBe('season:football-data:1564');
    expect(m1.homeTeamId).toBe('team:football-data:86');
    expect(m1.awayTeamId).toBe('team:football-data:81');
    expect(m1.status).toBe(EventStatus.SCHEDULED);
  });

  it('correctly maps finished match with scores', () => {
    const result = normalizeIngestion(FD_COMPETITION, FD_TEAMS, FD_MATCHES, NOW_UTC);
    const m2 = result.matches[1];
    expect(m2.status).toBe(EventStatus.FINISHED);
    expect(m2.scoreHome).toBe(1);
    expect(m2.scoreAway).toBe(2);
  });

  it('skips matches with unknown team IDs and reports them', () => {
    const matchWithUnknownTeam: FDMatchResponse = {
      id: 450099,
      season: { id: 1564 },
      utcDate: '2025-12-20T20:00:00Z',
      status: 'SCHEDULED',
      homeTeam: { id: 9999, name: 'Unknown FC' },
      awayTeam: { id: 81, name: 'FC Barcelona' },
      score: { fullTime: { home: null, away: null } },
    };
    const result = normalizeIngestion(
      FD_COMPETITION,
      FD_TEAMS,
      [...FD_MATCHES, matchWithUnknownTeam],
      NOW_UTC,
    );
    expect(result.matches).toHaveLength(2);
    expect(result.skippedMatchIds).toEqual(['450099']);
  });

  it('skips all matches when no season exists', () => {
    const fd = { ...FD_COMPETITION, currentSeason: undefined };
    const result = normalizeIngestion(fd, FD_TEAMS, FD_MATCHES, NOW_UTC);
    expect(result.matches).toHaveLength(0);
    expect(result.skippedMatchIds).toHaveLength(2);
  });

  it('is idempotent (same input → same output)', () => {
    const r1 = normalizeIngestion(FD_COMPETITION, FD_TEAMS, FD_MATCHES, NOW_UTC);
    const r2 = normalizeIngestion(FD_COMPETITION, FD_TEAMS, FD_MATCHES, NOW_UTC);
    expect(r1).toEqual(r2);
  });

  it('sets lastSeenUtc to nowUtc on all matches', () => {
    const result = normalizeIngestion(FD_COMPETITION, FD_TEAMS, FD_MATCHES, NOW_UTC);
    for (const match of result.matches) {
      expect(match.lastSeenUtc).toBe(NOW_UTC);
    }
  });
});

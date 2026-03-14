import { describe, it, expect } from 'vitest';
import type { Match, Team } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';
import type { TeamScoreDTO } from '../src/dto/team-score.js';
import { buildMatchCards, mapTimeChipFromHours } from '../src/display-hints/match-card-builder.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BUILD_NOW = '2026-03-06T12:00:00Z';

function makeTeam(id: string, name: string): Team {
  return {
    teamId: id,
    sportId: 'FOOTBALL',
    name,
    providerKey: 'fd',
    providerTeamId: id,
  };
}

function makeMatch(
  id: string,
  homeId: string,
  awayId: string,
  kickoffUtc: string,
  status: string = EventStatus.SCHEDULED,
): Match {
  return {
    matchId: id,
    seasonId: 'season:1',
    matchday: 25,
    startTimeUtc: kickoffUtc,
    status: status as Match['status'],
    homeTeamId: homeId,
    awayTeamId: awayId,
    scoreHome: null,
    scoreAway: null,
    providerKey: 'fd',
    providerMatchId: id,
    lastSeenUtc: BUILD_NOW,
  };
}

function makeScore(
  teamId: string,
  displayScore: number,
  formKind: string = 'FORM_HOT',
): Omit<TeamScoreDTO, 'rect'> {
  return {
    teamId,
    teamName: teamId,
    policyKey: 'mvp',
    policyVersion: 1,
    buildNowUtc: BUILD_NOW,
    rawScore: displayScore,
    attentionScore: displayScore,
    displayScore,
    layoutWeight: displayScore,
    topContributions: [],
    displayHints: {
      formChip: { icon: '🔥', label: 'Picante', level: 'HOT', kind: formKind },
    },
  };
}

// ─── mapTimeChipFromHours ─────────────────────────────────────────────────────

describe('mapTimeChipFromHours', () => {
  it('isLive → TIME_LIVE', () => {
    const chip = mapTimeChipFromHours(5, true);
    expect(chip.kind).toBe('TIME_LIVE');
    expect(chip.icon).toBe('🔴');
    expect(chip.level).toBe('HOT');
  });

  it('null hours → TIME_UNKNOWN', () => {
    const chip = mapTimeChipFromHours(null, false);
    expect(chip.kind).toBe('TIME_UNKNOWN');
    expect(chip.level).toBe('UNKNOWN');
  });

  it('hours <= 0 → TIME_STARTED', () => {
    expect(mapTimeChipFromHours(0, false).kind).toBe('TIME_STARTED');
    expect(mapTimeChipFromHours(-1, false).kind).toBe('TIME_STARTED');
  });

  it('hours=6 → TIME_TODAY_HOURS', () => {
    const chip = mapTimeChipFromHours(6, false);
    expect(chip.kind).toBe('TIME_TODAY_HOURS');
    expect(chip.label).toBe('Hoy · en 6 h');
  });

  it('hours=30 → TIME_TOMORROW_HOURS', () => {
    const chip = mapTimeChipFromHours(30, false);
    expect(chip.kind).toBe('TIME_TOMORROW_HOURS');
    expect(chip.label).toBe('Mañana · en 30 h');
  });

  it('hours=72 → TIME_DAYS', () => {
    const chip = mapTimeChipFromHours(72, false);
    expect(chip.kind).toBe('TIME_DAYS');
    expect(chip.label).toBe('En 3 días');
  });

  it('hours=200 → TIME_LATER_DAYS', () => {
    const chip = mapTimeChipFromHours(200, false);
    expect(chip.kind).toBe('TIME_LATER_DAYS');
    expect(chip.icon).toBe('🗓️');
  });
});

// ─── buildMatchCards ──────────────────────────────────────────────────────────

describe('buildMatchCards', () => {
  const teams = [
    makeTeam('team:a', 'Team A'),
    makeTeam('team:b', 'Team B'),
    makeTeam('team:c', 'Team C'),
  ];

  it('returns empty array when no relevant matches', () => {
    // POSTPONED matches (no matchday given) are not relevant
    const postponedMatch: Match = {
      ...makeMatch('match:1', 'team:a', 'team:b', '2026-03-01T20:00:00Z'),
      status: EventStatus.POSTPONED,
    };
    const cards = buildMatchCards([postponedMatch], teams, [], BUILD_NOW);
    expect(cards).toHaveLength(0);
  });

  it('includes FINISHED matches (score must be visible after match ends)', () => {
    const finishedMatch: Match = {
      ...makeMatch('match:1', 'team:a', 'team:b', '2026-03-01T20:00:00Z'),
      status: EventStatus.FINISHED,
      scoreHome: 2,
      scoreAway: 1,
    };
    const cards = buildMatchCards([finishedMatch], teams, [], BUILD_NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBe('FINISHED');
    expect(cards[0].scoreHome).toBe(2);
    expect(cards[0].scoreAway).toBe(1);
  });

  it('returns card for scheduled future match', () => {
    const match = makeMatch('match:1', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const cards = buildMatchCards([match], teams, [], BUILD_NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0].matchId).toBe('match:1');
  });

  it('§8.1 dedupes duplicate matchId entries', () => {
    const m1 = makeMatch('match:1', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const m2 = makeMatch('match:1', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const cards = buildMatchCards([m1, m2], teams, [], BUILD_NOW);
    expect(cards).toHaveLength(1);
  });

  it('sets status=LIVE for IN_PROGRESS match', () => {
    const match: Match = {
      ...makeMatch('match:1', 'team:a', 'team:b', '2026-03-06T11:00:00Z'),
      status: EventStatus.IN_PROGRESS,
    };
    const cards = buildMatchCards([match], teams, [], BUILD_NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBe('LIVE');
    expect(cards[0].timeChip.kind).toBe('TIME_LIVE');
  });

  it('maps home/away names from allTeams', () => {
    const match = makeMatch('match:1', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const cards = buildMatchCards([match], teams, [], BUILD_NOW);
    expect(cards[0].home.name).toBe('Team A');
    expect(cards[0].away.name).toBe('Team B');
  });

  it('attaches formChip from teamScores', () => {
    const match = makeMatch('match:1', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const scores = [makeScore('team:a', 0.9, 'FORM_HOT'), makeScore('team:b', 0.3, 'FORM_BAD')];
    const cards = buildMatchCards([match], teams, scores, BUILD_NOW);
    expect(cards[0].home.formChip?.kind).toBe('FORM_HOT');
    expect(cards[0].away.formChip?.kind).toBe('FORM_BAD');
  });

  it('§8.2 rankScore = 1 - (1-home)*(1-away)', () => {
    const match = makeMatch('match:1', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const scores = [makeScore('team:a', 0.8), makeScore('team:b', 0.6)];
    const cards = buildMatchCards([match], teams, scores, BUILD_NOW);
    const expected = 1 - (1 - 0.8) * (1 - 0.6);
    expect(cards[0].rankScore).toBeCloseTo(expected);
  });

  it('rankScore fallback: only home team known', () => {
    const match = makeMatch('match:1', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const scores = [makeScore('team:a', 0.7)];
    const cards = buildMatchCards([match], teams, scores, BUILD_NOW);
    expect(cards[0].rankScore).toBeCloseTo(0.7);
  });

  it('rankScore fallback: neither team known → 0', () => {
    const match = makeMatch('match:1', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const cards = buildMatchCards([match], teams, [], BUILD_NOW);
    expect(cards[0].rankScore).toBe(0);
  });

  it('sorted by kickoffUtc desc (más reciente primero), then matchId asc', () => {
    const m1 = makeMatch('match:z', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const m2 = makeMatch('match:a', 'team:b', 'team:c', '2026-03-08T20:00:00Z');
    const cards = buildMatchCards([m1, m2], teams, [], BUILD_NOW);
    // match:z kickoff 07 < match:a kickoff 08 → match:z primero (más cercano)
    expect(cards[0].matchId).toBe('match:z');
    expect(cards[1].matchId).toBe('match:a');
  });

  it('includes explainLine with template text', () => {
    const match = makeMatch('match:1', 'team:a', 'team:b', '2026-03-07T20:00:00Z');
    const scores = [makeScore('team:a', 0.9, 'FORM_HOT'), makeScore('team:b', 0.3, 'FORM_NORMAL')];
    const cards = buildMatchCards([match], teams, scores, BUILD_NOW);
    expect(cards[0].explainLine?.kind).toBe('WHY_MATCH_SIMPLE');
    expect(cards[0].explainLine?.text).toContain('local picante');
    expect(cards[0].explainLine?.text).toContain('visita normal');
  });

  it('past SCHEDULED match (before buildNow) is excluded', () => {
    const match = makeMatch('match:1', 'team:a', 'team:b', '2026-03-05T20:00:00Z');
    const cards = buildMatchCards([match], teams, [], BUILD_NOW);
    expect(cards).toHaveLength(0);
  });
});

/**
 * Tests para las entidades del modelo de torneos:
 * Stage, Group, StandingTable, Tie, TieSlot.
 *
 * Verifica:
 *   1. Las entidades nuevas se construyen con los campos obligatorios.
 *   2. Los campos opcionales no son requeridos (backward-compat de Match y Season).
 *   3. Un DataSource mínimo (solo métodos core) sigue satisfaciendo la interfaz.
 *   4. TieSlot soporta los tres estados válidos (confirmado / placeholder / sin resolver).
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  FormatFamily,
  StageType,
  StandingScope,
  SlotRole,
  EventStatus,
  Sport,
} from '../src/index.js';
import type {
  Stage,
  Group,
  StandingTable,
  Tie,
  TieSlot,
  Match,
  Season,
  Team,
} from '../src/index.js';
import type { DataSource, StandingEntry } from '@sportpulse/snapshot';

// ── Stage ────────────────────────────────────────────────────────────────────

describe('Stage entity', () => {
  const groupStage: Stage = {
    stageId: 'stage:season:football-data:2025:0',
    competitionEditionId: 'season:football-data:2025',
    name: 'Group Stage',
    stageType: StageType.GROUP_STAGE,
    orderIndex: 0,
    hasStandings: true,
    hasBracket: false,
  };

  const finalStage: Stage = {
    stageId: 'stage:season:football-data:2025:5',
    competitionEditionId: 'season:football-data:2025',
    name: 'Final',
    stageType: StageType.FINAL,
    orderIndex: 5,
    hasStandings: false,
    hasBracket: true,
    metadataJson: null,
  };

  it('constructs group stage with required fields', () => {
    expect(groupStage.stageType).toBe(StageType.GROUP_STAGE);
    expect(groupStage.hasStandings).toBe(true);
    expect(groupStage.hasBracket).toBe(false);
    expect(groupStage.orderIndex).toBe(0);
  });

  it('constructs final stage', () => {
    expect(finalStage.stageType).toBe(StageType.FINAL);
    expect(finalStage.hasBracket).toBe(true);
    expect(finalStage.hasStandings).toBe(false);
  });

  it('metadataJson is optional', () => {
    // groupStage no tiene metadataJson — TS no debe rechazarlo
    expect(groupStage.metadataJson).toBeUndefined();
    expect(finalStage.metadataJson).toBeNull();
  });
});

// ── Group ────────────────────────────────────────────────────────────────────

describe('Group entity', () => {
  const groupA: Group = {
    groupId: 'group:stage-gs-0:0',
    stageId: 'stage-gs-0',
    name: 'Group A',
    orderIndex: 0,
  };

  const groupB: Group = {
    groupId: 'group:stage-gs-0:1',
    stageId: 'stage-gs-0',
    name: 'Group B',
    orderIndex: 1,
    metadataJson: null,
  };

  it('constructs groups correctly', () => {
    expect(groupA.name).toBe('Group A');
    expect(groupB.name).toBe('Group B');
    expect(groupA.orderIndex).toBe(0);
    expect(groupB.orderIndex).toBe(1);
  });

  it('groups share the same stageId', () => {
    expect(groupA.stageId).toBe(groupB.stageId);
  });
});

// ── StandingTable ─────────────────────────────────────────────────────────────

describe('StandingTable entity', () => {
  it('scope=STAGE → groupId should be null', () => {
    const table: StandingTable = {
      standingTableId: 'st:conmebol:league',
      competitionEditionId: 'season:football-data:WC2026',
      stageId: 'stage:WC2026:0',
      groupId: null,
      scope: StandingScope.STAGE,
    };
    expect(table.scope).toBe(StandingScope.STAGE);
    expect(table.groupId).toBeNull();
  });

  it('scope=GROUP → groupId is defined', () => {
    const table: StandingTable = {
      standingTableId: 'st:libertadores:groupA',
      competitionEditionId: 'season:football-data:LIB2025',
      stageId: 'stage:LIB2025:gs',
      groupId: 'group:LIB2025:gs:0',
      scope: StandingScope.GROUP,
    };
    expect(table.scope).toBe(StandingScope.GROUP);
    expect(table.groupId).toBeTruthy();
  });
});

// ── Tie ──────────────────────────────────────────────────────────────────────

describe('Tie entity', () => {
  const qf1: Tie = {
    tieId: 'tie:stage-qf:0',
    competitionEditionId: 'season:football-data:LIB2025',
    stageId: 'stage-qf',
    name: 'Quarter-final 1',
    roundLabel: 'QF',
    orderIndex: 0,
  };

  it('constructs a quarter-final tie', () => {
    expect(qf1.roundLabel).toBe('QF');
    expect(qf1.orderIndex).toBe(0);
  });
});

// ── TieSlot ──────────────────────────────────────────────────────────────────

describe('TieSlot entity — three valid states', () => {
  it('state 1: participant confirmed', () => {
    const slot: TieSlot = {
      slotId: 'slot:tie-qf1:A',
      tieId: 'tie:stage-qf:0',
      slotRole: SlotRole.A,
      participantId: 'team:football-data:86', // Real Madrid
      placeholderText: null,
    };
    expect(slot.participantId).toBeTruthy();
    expect(slot.placeholderText).toBeNull();
  });

  it('state 2: placeholder text defined (team not confirmed yet)', () => {
    const slot: TieSlot = {
      slotId: 'slot:tie-qf1:B',
      tieId: 'tie:stage-qf:0',
      slotRole: SlotRole.B,
      participantId: null,
      placeholderText: 'Winner Group A',
    };
    expect(slot.participantId).toBeNull();
    expect(slot.placeholderText).toBe('Winner Group A');
  });

  it('state 3: slot not yet resolved (both null)', () => {
    const slot: TieSlot = {
      slotId: 'slot:tie-sf1:A',
      tieId: 'tie:stage-sf:0',
      slotRole: SlotRole.A,
    };
    // Both undefined (not set yet)
    expect(slot.participantId).toBeUndefined();
    expect(slot.placeholderText).toBeUndefined();
  });

  it('sourceMatchId is optional navigation field', () => {
    const slot: TieSlot = {
      slotId: 'slot:tie-qf2:A',
      tieId: 'tie:stage-qf:1',
      slotRole: SlotRole.A,
      sourceMatchId: 'match:football-data:99001',
    };
    expect(slot.sourceMatchId).toBe('match:football-data:99001');
  });
});

// ── Backward-compat: Match sin campos de torneo ───────────────────────────────

describe('Match backward-compat', () => {
  it('a league match without tournament fields is still valid', () => {
    const m: Match = {
      matchId: 'match:football-data:12345',
      seasonId: 'season:football-data:2025',
      matchday: 10,
      startTimeUtc: '2025-11-02T16:00:00Z',
      status: EventStatus.FINISHED,
      homeTeamId: 'team:football-data:86',
      awayTeamId: 'team:football-data:81',
      scoreHome: 2,
      scoreAway: 1,
      providerKey: 'football-data',
      providerMatchId: '12345',
      lastSeenUtc: '2025-11-02T18:00:00Z',
    };
    // Campos de torneo ausentes — no rompen el tipo
    expect(m.stageId).toBeUndefined();
    expect(m.groupId).toBeUndefined();
    expect(m.tieId).toBeUndefined();
    expect(m.winnerTeamId).toBeUndefined();
    expect(m.scoreHomeExtraTime).toBeUndefined();
  });

  it('a tournament match can carry all optional fields', () => {
    const m: Match = {
      matchId: 'match:football-data:99001',
      seasonId: 'season:football-data:LIB2025',
      startTimeUtc: '2025-08-14T21:00:00Z',
      status: EventStatus.FINISHED,
      homeTeamId: 'team:football-data:500',
      awayTeamId: 'team:football-data:501',
      scoreHome: 1,
      scoreAway: 1,
      scoreHomeExtraTime: 0,
      scoreAwayExtraTime: 0,
      scoreHomePenalties: 5,
      scoreAwayPenalties: 4,
      winnerTeamId: 'team:football-data:500',
      stageId: 'stage:LIB2025:qf',
      tieId: 'tie:stage-qf:0',
      providerKey: 'football-data',
      providerMatchId: '99001',
      lastSeenUtc: '2025-08-14T23:30:00Z',
    };
    expect(m.winnerTeamId).toBe('team:football-data:500');
    expect(m.scoreHomePenalties).toBe(5);
    expect(m.tieId).toBe('tie:stage-qf:0');
  });
});

// ── Backward-compat: Season sin formatFamily ──────────────────────────────────

describe('Season backward-compat', () => {
  it('a league season without formatFamily is still valid', () => {
    const s: Season = {
      seasonId: 'season:football-data:2025',
      competitionId: 'comp:football-data:PD',
      label: '2024/25',
      startDate: '2024-08-15',
      endDate: '2025-05-25',
    };
    expect(s.formatFamily).toBeUndefined();
  });

  it('a tournament season carries formatFamily', () => {
    const s: Season = {
      seasonId: 'season:football-data:WC2026',
      competitionId: 'comp:football-data:WC',
      label: '2026',
      startDate: '2026-06-11',
      endDate: '2026-07-19',
      formatFamily: FormatFamily.GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS,
    };
    expect(s.formatFamily).toBe('GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS');
  });
});

// ── Backward-compat: StandingEntry sin groupId ───────────────────────────────

describe('StandingEntry backward-compat', () => {
  it('a league standing entry without groupId is still valid', () => {
    const entry: StandingEntry = {
      position: 1,
      teamId: 'team:football-data:86',
      teamName: 'Real Madrid',
      playedGames: 10,
      won: 8,
      draw: 1,
      lost: 1,
      goalsFor: 25,
      goalsAgainst: 8,
      goalDifference: 17,
      points: 25,
    };
    expect(entry.groupId).toBeUndefined();
    expect(entry.statusBadge).toBeUndefined();
  });

  it('a tournament standing entry can carry groupId and statusBadge', () => {
    const entry: StandingEntry = {
      position: 1,
      teamId: 'team:football-data:500',
      teamName: 'Flamengo',
      playedGames: 6,
      won: 5,
      draw: 1,
      lost: 0,
      goalsFor: 14,
      goalsAgainst: 3,
      goalDifference: 11,
      points: 16,
      groupId: 'group:LIB2025:gs:0',
      statusBadge: 'QUALIFIED',
    };
    expect(entry.groupId).toBe('group:LIB2025:gs:0');
    expect(entry.statusBadge).toBe('QUALIFIED');
  });
});

// ── DataSource interface: implementación mínima (solo métodos core) ───────────

describe('DataSource interface backward-compat', () => {
  it('a minimal DataSource (no tournament methods) still satisfies the interface', () => {
    // Si esto compila, la interfaz es compatible hacia atrás.
    const minimalSource: DataSource = {
      getTeams: (_compId: string): Team[] => [],
      getMatches: (_seasonId: string): Match[] => [],
      getSeasonId: (_compId: string): string | undefined => undefined,
    };
    expect(minimalSource.getStages).toBeUndefined();
    expect(minimalSource.getGroups).toBeUndefined();
    expect(minimalSource.getTies).toBeUndefined();
    expect(minimalSource.getTieSlots).toBeUndefined();
    expect(minimalSource.getStandingTables).toBeUndefined();
  });
});

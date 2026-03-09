import { describe, it, expect } from 'vitest';
import {
  Sport,
  CompetitionFormat,
  EventStatus,
  ParticipantRole,
  FormatFamily,
  StageType,
  StandingScope,
  SlotRole,
} from '../src/index.js';

describe('Domain enums', () => {
  it('Sport has FOOTBALL for MVP', () => {
    expect(Sport.FOOTBALL).toBe('FOOTBALL');
  });

  it('CompetitionFormat has LEAGUE', () => {
    expect(CompetitionFormat.LEAGUE).toBe('LEAGUE');
  });

  it('EventStatus has all lifecycle states', () => {
    const states = Object.values(EventStatus);
    expect(states).toContain('TBD');
    expect(states).toContain('SCHEDULED');
    expect(states).toContain('IN_PROGRESS');
    expect(states).toContain('FINISHED');
    expect(states).toContain('POSTPONED');
    expect(states).toContain('CANCELED');
    expect(states).toHaveLength(6);
  });

  it('ParticipantRole has HOME and AWAY', () => {
    expect(ParticipantRole.HOME).toBe('HOME');
    expect(ParticipantRole.AWAY).toBe('AWAY');
  });
});

describe('FormatFamily enum', () => {
  it('has all four families', () => {
    expect(FormatFamily.LEAGUE_TABLE).toBe('LEAGUE_TABLE');
    expect(FormatFamily.GROUP_STAGE_PLUS_KNOCKOUT).toBe('GROUP_STAGE_PLUS_KNOCKOUT');
    expect(FormatFamily.GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS).toBe(
      'GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS',
    );
    expect(FormatFamily.LEAGUE_PHASE_PLUS_KNOCKOUT).toBe('LEAGUE_PHASE_PLUS_KNOCKOUT');
    expect(Object.keys(FormatFamily)).toHaveLength(4);
  });
});

describe('StageType enum', () => {
  it('has all stage types including knockout phases', () => {
    const values = Object.values(StageType);
    expect(values).toContain('LEAGUE');
    expect(values).toContain('GROUP_STAGE');
    expect(values).toContain('ROUND_OF_32');
    expect(values).toContain('ROUND_OF_16');
    expect(values).toContain('QUARTER_FINALS');
    expect(values).toContain('SEMI_FINALS');
    expect(values).toContain('FINAL');
    expect(values).toContain('PLAYOFF');
    expect(values).toContain('CUSTOM');
    expect(values).toHaveLength(9);
  });
});

describe('StandingScope enum', () => {
  it('has STAGE and GROUP', () => {
    expect(StandingScope.STAGE).toBe('STAGE');
    expect(StandingScope.GROUP).toBe('GROUP');
    expect(Object.keys(StandingScope)).toHaveLength(2);
  });
});

describe('SlotRole enum', () => {
  it('has A and B', () => {
    expect(SlotRole.A).toBe('A');
    expect(SlotRole.B).toBe('B');
    expect(Object.keys(SlotRole)).toHaveLength(2);
  });
});

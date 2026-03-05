import { describe, it, expect } from 'vitest';
import { Sport, CompetitionFormat, EventStatus, ParticipantRole } from '../src/index.js';

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

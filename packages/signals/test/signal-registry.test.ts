import { describe, it, expect } from 'vitest';
import { SignalKey, SIGNAL_REGISTRY, SignalEntityKind } from '../src/index.js';

describe('Signal Registry', () => {
  it('has entries for all signal keys', () => {
    const registeredKeys = SIGNAL_REGISTRY.map(e => e.key);
    for (const key of Object.values(SignalKey)) {
      expect(registeredKeys).toContain(key);
    }
  });

  it('all entries have TEAM entity kind for MVP', () => {
    for (const entry of SIGNAL_REGISTRY) {
      expect(entry.entityKind).toBe(SignalEntityKind.TEAM);
    }
  });

  it('FORM_POINTS_LAST_5 uses points unit', () => {
    const entry = SIGNAL_REGISTRY.find(e => e.key === SignalKey.FORM_POINTS_LAST_5);
    expect(entry?.unit).toBe('points');
  });

  it('NEXT_MATCH_HOURS uses hours unit', () => {
    const entry = SIGNAL_REGISTRY.find(e => e.key === SignalKey.NEXT_MATCH_HOURS);
    expect(entry?.unit).toBe('hours');
  });
});

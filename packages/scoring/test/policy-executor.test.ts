import { describe, it, expect } from 'vitest';
import { executePolicy, MVP_POLICY } from '../src/index.js';
import type { SignalDTO } from '@sportpulse/signals';
import { SignalKey, SignalEntityKind } from '@sportpulse/signals';

const TEAM_ID = 'team:football-data:86';

function makeSignal(overrides: Partial<SignalDTO>): SignalDTO {
  return {
    key: SignalKey.FORM_POINTS_LAST_5,
    entityKind: SignalEntityKind.TEAM,
    entityId: TEAM_ID,
    value: 0.5,
    unit: 'points',
    quality: { source: 'canonical_derived', missing: false },
    ...overrides,
  };
}

// C-01: Policy identity propagation
describe('policy identity propagation (C-01)', () => {
  it('includes policyKey and policyVersion in result', () => {
    const signals: SignalDTO[] = [
      makeSignal({ key: SignalKey.FORM_POINTS_LAST_5, value: 0.7333 }),
      makeSignal({ key: SignalKey.NEXT_MATCH_HOURS, value: 0.8214, unit: 'hours' }),
    ];
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    expect(result.policyKey).toBe('sportpulse.mvp.form-agenda');
    expect(result.policyVersion).toBe(1);
    expect(result.entityId).toBe(TEAM_ID);
    expect(result.entityKind).toBe('TEAM');
  });
});

// C-02: Weighted contribution correctness
describe('weighted contribution correctness (C-02)', () => {
  const signals: SignalDTO[] = [
    makeSignal({
      key: SignalKey.FORM_POINTS_LAST_5,
      value: 0.7333,
      params: { rawPoints: 11, windowSize: 5, matchesUsed: 5, maxPoints: 15 },
    }),
    makeSignal({
      key: SignalKey.NEXT_MATCH_HOURS,
      value: 0.8214,
      unit: 'hours',
      params: { hours: 30, minHours: 0, maxHours: 168, nextMatchId: 'match:6' },
    }),
  ];

  it('computes correct rawScore as weighted sum', () => {
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    // 0.7333*0.7 + 0.8214*0.3 = 0.51331 + 0.24642 = 0.75973
    expect(result.rawScore).toBeCloseTo(0.7333 * 0.7 + 0.8214 * 0.3, 4);
  });

  it('topContributions sorted by |contribution| desc', () => {
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    expect(result.topContributions).toHaveLength(2);
    expect(result.topContributions[0].signalKey).toBe('FORM_POINTS_LAST_5');
    expect(result.topContributions[1].signalKey).toBe('NEXT_MATCH_HOURS');
    expect(Math.abs(result.topContributions[0].contribution))
      .toBeGreaterThanOrEqual(Math.abs(result.topContributions[1].contribution));
  });

  it('each contribution = normValue * weight', () => {
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    for (const c of result.topContributions) {
      expect(c.contribution).toBeCloseTo(c.normValue * c.weight, 6);
    }
  });

  it('includes rawValue from signal params', () => {
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    const formContrib = result.topContributions.find(c => c.signalKey === 'FORM_POINTS_LAST_5');
    expect(formContrib?.rawValue).toBe(11);
    const nextContrib = result.topContributions.find(c => c.signalKey === 'NEXT_MATCH_HOURS');
    expect(nextContrib?.rawValue).toBe(30);
  });
});

// C-03: DisplayScore and layoutWeight mapping
describe('displayScore and layoutWeight mapping (C-03)', () => {
  it('MVP v1: displayScore = rawScore (identity)', () => {
    const signals: SignalDTO[] = [
      makeSignal({ key: SignalKey.FORM_POINTS_LAST_5, value: 0.6 }),
    ];
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    expect(result.displayScore).toBe(result.rawScore);
  });

  it('MVP v1: layoutWeight = max(0, rawScore)', () => {
    const signals: SignalDTO[] = [
      makeSignal({ key: SignalKey.FORM_POINTS_LAST_5, value: 0.6 }),
    ];
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    expect(result.layoutWeight).toBe(Math.max(0, result.rawScore));
    expect(result.layoutWeight).toBeGreaterThanOrEqual(0);
  });
});

// Missing signals
describe('missing signal handling', () => {
  it('excludes missing signals from topContributions', () => {
    const signals: SignalDTO[] = [
      makeSignal({ key: SignalKey.FORM_POINTS_LAST_5, value: 0.6 }),
      makeSignal({
        key: SignalKey.NEXT_MATCH_HOURS,
        value: 0,
        quality: { source: 'canonical_derived', missing: true },
      }),
    ];
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    expect(result.topContributions).toHaveLength(1);
    expect(result.topContributions[0].signalKey).toBe('FORM_POINTS_LAST_5');
  });

  it('rawScore uses only available signals', () => {
    const signals: SignalDTO[] = [
      makeSignal({ key: SignalKey.FORM_POINTS_LAST_5, value: 0.8 }),
    ];
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    expect(result.rawScore).toBeCloseTo(0.8 * 0.7, 4);
  });

  it('all signals missing → rawScore = 0', () => {
    const signals: SignalDTO[] = [
      makeSignal({
        key: SignalKey.FORM_POINTS_LAST_5,
        value: 0,
        quality: { source: 'canonical_derived', missing: true },
      }),
      makeSignal({
        key: SignalKey.NEXT_MATCH_HOURS,
        value: 0,
        quality: { source: 'canonical_derived', missing: true },
      }),
    ];
    const result = executePolicy(TEAM_ID, signals, MVP_POLICY);
    expect(result.rawScore).toBe(0);
    expect(result.topContributions).toHaveLength(0);
  });

  it('no signals provided → rawScore = 0', () => {
    const result = executePolicy(TEAM_ID, [], MVP_POLICY);
    expect(result.rawScore).toBe(0);
    expect(result.layoutWeight).toBe(0);
  });
});

// Determinism
describe('determinism', () => {
  it('is deterministic across repeated calls', () => {
    const signals: SignalDTO[] = [
      makeSignal({ key: SignalKey.FORM_POINTS_LAST_5, value: 0.7333 }),
      makeSignal({ key: SignalKey.NEXT_MATCH_HOURS, value: 0.8214, unit: 'hours' }),
    ];
    const r1 = executePolicy(TEAM_ID, signals, MVP_POLICY);
    const r2 = executePolicy(TEAM_ID, signals, MVP_POLICY);
    expect(r1).toEqual(r2);
  });
});

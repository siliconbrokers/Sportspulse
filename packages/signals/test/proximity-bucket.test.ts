import { describe, it, expect } from 'vitest';
import { computeProximityBucket, ProximityBucket, SignalKey, SignalEntityKind } from '../src/index.js';
import type { SignalDTO } from '../src/index.js';

const TEAM_ID = 'team:football-data:86';

function makeSignal(overrides: Partial<SignalDTO> = {}): SignalDTO {
  return {
    key: SignalKey.NEXT_MATCH_HOURS,
    entityKind: SignalEntityKind.TEAM,
    entityId: TEAM_ID,
    value: 0.5,
    unit: 'hours',
    params: { hours: 48 },
    quality: {
      source: 'canonical_derived',
      missing: false,
    },
    ...overrides,
  };
}

// B-06: PROXIMITY_BUCKET tests
describe('PROXIMITY_BUCKET (B-06)', () => {
  it('0h → D1', () => {
    const signal = makeSignal({ params: { hours: 0 } });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.D1);
  });

  it('12h → D1', () => {
    const signal = makeSignal({ params: { hours: 12 } });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.D1);
  });

  it('24h → D1 (boundary inclusive)', () => {
    const signal = makeSignal({ params: { hours: 24 } });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.D1);
  });

  it('25h → D3', () => {
    const signal = makeSignal({ params: { hours: 25 } });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.D3);
  });

  it('72h → D3 (boundary inclusive)', () => {
    const signal = makeSignal({ params: { hours: 72 } });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.D3);
  });

  it('73h → W1', () => {
    const signal = makeSignal({ params: { hours: 73 } });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.W1);
  });

  it('168h → W1 (boundary inclusive)', () => {
    const signal = makeSignal({ params: { hours: 168 } });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.W1);
  });

  it('169h → LATER', () => {
    const signal = makeSignal({ params: { hours: 169 } });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.LATER);
  });

  it('missing signal (quality.missing=true) → NONE', () => {
    const signal = makeSignal({
      quality: { source: 'canonical_derived', missing: true },
      params: { hours: null, reason: 'no_next_match' },
    });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.NONE);
  });

  it('no hours param → NONE', () => {
    const signal = makeSignal({ params: {} });
    expect(computeProximityBucket(signal)).toBe(ProximityBucket.NONE);
  });
});

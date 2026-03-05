import { describe, it, expect } from 'vitest';
import { isAllZeroWeights } from '../src/index.js';

describe('isAllZeroWeights', () => {
  it('returns true when all weights are zero', () => {
    expect(isAllZeroWeights([
      { entityId: 'A', layoutWeight: 0 },
      { entityId: 'B', layoutWeight: 0 },
    ])).toBe(true);
  });

  it('returns false when any weight is non-zero', () => {
    expect(isAllZeroWeights([
      { entityId: 'A', layoutWeight: 0 },
      { entityId: 'B', layoutWeight: 0.5 },
    ])).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(isAllZeroWeights([])).toBe(false);
  });
});

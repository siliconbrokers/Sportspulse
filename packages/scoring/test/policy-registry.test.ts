import { describe, it, expect } from 'vitest';
import { MVP_POLICY, getPolicy, getDefaultPolicy, sortContributions } from '../src/index.js';
import type { ContributionDTO } from '../src/index.js';

describe('Policy Registry', () => {
  it('MVP policy has correct identity', () => {
    expect(MVP_POLICY.policyKey).toBe('sportpulse.mvp.form-agenda');
    expect(MVP_POLICY.policyVersion).toBe(1);
  });

  it('MVP policy weights sum to 1.0', () => {
    const sum = MVP_POLICY.weights.reduce((acc, w) => acc + w.weight, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it('MVP policy has exactly 2 signals', () => {
    expect(MVP_POLICY.weights).toHaveLength(2);
  });

  it('getPolicy returns MVP policy by identity', () => {
    const policy = getPolicy({ policyKey: 'sportpulse.mvp.form-agenda', policyVersion: 1 });
    expect(policy).toBeDefined();
    expect(policy?.policyKey).toBe(MVP_POLICY.policyKey);
  });

  it('getPolicy returns undefined for unknown policy', () => {
    const policy = getPolicy({ policyKey: 'unknown', policyVersion: 1 });
    expect(policy).toBeUndefined();
  });

  it('getDefaultPolicy returns MVP policy', () => {
    expect(getDefaultPolicy()).toBe(MVP_POLICY);
  });
});

describe('Contribution sorting', () => {
  it('sorts by |contribution| descending', () => {
    const contributions: ContributionDTO[] = [
      { signalKey: 'A', normValue: 0.5, weight: 0.3, contribution: 0.15 },
      { signalKey: 'B', normValue: 0.8, weight: 0.7, contribution: 0.56 },
    ];
    const sorted = sortContributions(contributions);
    expect(sorted[0].signalKey).toBe('B');
    expect(sorted[1].signalKey).toBe('A');
  });

  it('breaks ties by signalKey ascending', () => {
    const contributions: ContributionDTO[] = [
      { signalKey: 'Z', normValue: 0.5, weight: 0.5, contribution: 0.25 },
      { signalKey: 'A', normValue: 0.5, weight: 0.5, contribution: 0.25 },
    ];
    const sorted = sortContributions(contributions);
    expect(sorted[0].signalKey).toBe('A');
    expect(sorted[1].signalKey).toBe('Z');
  });
});

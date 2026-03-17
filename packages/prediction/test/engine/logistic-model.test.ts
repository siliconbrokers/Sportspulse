/**
 * logistic-model.test.ts — Tests para §SP-V4-20 Logistic Model.
 *
 * Cubre:
 *   - extractLogisticFeatures: feature derivation, edge cases
 *   - predictLogistic: softmax invariants, default coefs, trained coefs
 *   - DEFAULT_LOGISTIC_COEFFICIENTS: todos ceros → uniform
 *   - LOGISTIC_FEATURE_KEYS: completitud
 */

import { describe, it, expect } from 'vitest';
import {
  extractLogisticFeatures,
  predictLogistic,
  DEFAULT_LOGISTIC_COEFFICIENTS,
  LOGISTIC_FEATURE_KEYS,
  type LogisticFeatureVector,
  type LogisticCoefficients,
} from '../../src/engine/v3/logistic-model.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBaseParams() {
  return {
    lambdaHome: 1.8,
    lambdaAway: 1.2,
    restDaysHome: 5,
    restDaysAway: 7,
    h2hMultHome: 1.05,
    h2hMultAway: 0.97,
    absenceScoreHome: 0.95,
    absenceScoreAway: 1.0,
    xgCoverage: 0.8,
    leagueCode: 'PD' as string | undefined,
  };
}

// ── extractLogisticFeatures ────────────────────────────────────────────────

describe('extractLogisticFeatures', () => {
  it('SP-V4-20-F01: computes derived features correctly', () => {
    const fv = extractLogisticFeatures(makeBaseParams());

    // lambda_home and lambda_away are pass-through
    expect(fv.lambda_home).toBe(1.8);
    expect(fv.lambda_away).toBe(1.2);

    // balance_ratio = min/max = 1.2/1.8
    expect(fv.balance_ratio).toBeCloseTo(1.2 / 1.8, 10);

    // lambda_diff = 1.8 - 1.2
    expect(fv.lambda_diff).toBeCloseTo(0.6, 10);

    // total_goals_expected = 1.8 + 1.2
    expect(fv.total_goals_expected).toBeCloseTo(3.0, 10);

    // home_dominance = 1.8 / 3.0
    expect(fv.home_dominance).toBeCloseTo(0.6, 10);
  });

  it('SP-V4-20-F02: league one-hot encoding for PD', () => {
    const fv = extractLogisticFeatures(makeBaseParams());
    expect(fv.league_pd).toBe(1);
    expect(fv.league_pl).toBe(0);
    expect(fv.league_bl1).toBe(0);
  });

  it('SP-V4-20-F03: league one-hot encoding for PL', () => {
    const fv = extractLogisticFeatures({ ...makeBaseParams(), leagueCode: 'PL' });
    expect(fv.league_pd).toBe(0);
    expect(fv.league_pl).toBe(1);
    expect(fv.league_bl1).toBe(0);
  });

  it('SP-V4-20-F04: league one-hot encoding for BL1', () => {
    const fv = extractLogisticFeatures({ ...makeBaseParams(), leagueCode: 'BL1' });
    expect(fv.league_pd).toBe(0);
    expect(fv.league_pl).toBe(0);
    expect(fv.league_bl1).toBe(1);
  });

  it('SP-V4-20-F05: unknown league code → all zeros', () => {
    const fv = extractLogisticFeatures({ ...makeBaseParams(), leagueCode: 'URU' });
    expect(fv.league_pd).toBe(0);
    expect(fv.league_pl).toBe(0);
    expect(fv.league_bl1).toBe(0);
  });

  it('SP-V4-20-F06: missing league code → all zeros', () => {
    const fv = extractLogisticFeatures({ ...makeBaseParams(), leagueCode: undefined });
    expect(fv.league_pd).toBe(0);
    expect(fv.league_pl).toBe(0);
    expect(fv.league_bl1).toBe(0);
  });

  it('SP-V4-20-F07: rest_days clipped to [0, 14]', () => {
    const fv1 = extractLogisticFeatures({ ...makeBaseParams(), restDaysHome: -1, restDaysAway: 20 });
    expect(fv1.rest_days_home).toBe(0);
    expect(fv1.rest_days_away).toBe(14);

    const fv2 = extractLogisticFeatures({ ...makeBaseParams(), restDaysHome: 0, restDaysAway: 14 });
    expect(fv2.rest_days_home).toBe(0);
    expect(fv2.rest_days_away).toBe(14);
  });

  it('SP-V4-20-F08: balance_ratio = 1.0 when both lambdas equal', () => {
    const fv = extractLogisticFeatures({ ...makeBaseParams(), lambdaHome: 1.5, lambdaAway: 1.5 });
    expect(fv.balance_ratio).toBeCloseTo(1.0, 10);
    expect(fv.lambda_diff).toBeCloseTo(0.0, 10);
    expect(fv.home_dominance).toBeCloseTo(0.5, 10);
  });

  it('SP-V4-20-F09: balance_ratio = 1.0 when both lambdas are 0', () => {
    const fv = extractLogisticFeatures({ ...makeBaseParams(), lambdaHome: 0, lambdaAway: 0 });
    expect(fv.balance_ratio).toBe(1.0);
    // home_dominance = 0.5 when sum = 0
    expect(fv.home_dominance).toBe(0.5);
    expect(fv.total_goals_expected).toBe(0);
  });

  it('SP-V4-20-F10: home_dominance approaches 1 when away lambda near 0', () => {
    const fv = extractLogisticFeatures({ ...makeBaseParams(), lambdaHome: 3.0, lambdaAway: 0.001 });
    expect(fv.home_dominance).toBeGreaterThan(0.99);
    expect(fv.balance_ratio).toBeLessThan(0.01);
  });

  it('SP-V4-20-F11: all 19 feature keys present in output', () => {
    const fv = extractLogisticFeatures(makeBaseParams());
    for (const key of LOGISTIC_FEATURE_KEYS) {
      expect(fv[key]).toBeDefined();
      expect(typeof fv[key]).toBe('number');
    }
  });

  it('SP-V4-20-F12: xg_coverage is passed through unchanged', () => {
    const fv = extractLogisticFeatures({ ...makeBaseParams(), xgCoverage: 0.35 });
    expect(fv.xg_coverage).toBe(0.35);
  });

  it('SP-V4-20-F13: market_imp_* defaults to 1/3 when not provided', () => {
    const fv = extractLogisticFeatures(makeBaseParams());
    expect(fv.market_imp_home).toBeCloseTo(1 / 3, 10);
    expect(fv.market_imp_draw).toBeCloseTo(1 / 3, 10);
    expect(fv.market_imp_away).toBeCloseTo(1 / 3, 10);
  });

  it('SP-V4-20-F14: market_imp_* passed through when provided', () => {
    const fv = extractLogisticFeatures({
      ...makeBaseParams(),
      marketImpHome: 0.55,
      marketImpDraw: 0.25,
      marketImpAway: 0.20,
    });
    expect(fv.market_imp_home).toBe(0.55);
    expect(fv.market_imp_draw).toBe(0.25);
    expect(fv.market_imp_away).toBe(0.20);
  });
});

// ── LOGISTIC_FEATURE_KEYS ──────────────────────────────────────────────────

describe('LOGISTIC_FEATURE_KEYS', () => {
  it('SP-V4-20-K01: contains exactly 19 keys matching LogisticFeatureVector fields', () => {
    expect(LOGISTIC_FEATURE_KEYS).toHaveLength(19);
  });

  it('SP-V4-20-K02: no duplicate keys', () => {
    const unique = new Set(LOGISTIC_FEATURE_KEYS);
    expect(unique.size).toBe(LOGISTIC_FEATURE_KEYS.length);
  });
});

// ── DEFAULT_LOGISTIC_COEFFICIENTS ─────────────────────────────────────────

describe('DEFAULT_LOGISTIC_COEFFICIENTS', () => {
  it('SP-V4-20-D01: trained_on_matches = 0 (not yet trained)', () => {
    expect(DEFAULT_LOGISTIC_COEFFICIENTS.trained_on_matches).toBe(0);
  });

  it('SP-V4-20-D02: all biases are 0', () => {
    expect(DEFAULT_LOGISTIC_COEFFICIENTS.home.bias).toBe(0);
    expect(DEFAULT_LOGISTIC_COEFFICIENTS.draw.bias).toBe(0);
    expect(DEFAULT_LOGISTIC_COEFFICIENTS.away.bias).toBe(0);
  });

  it('SP-V4-20-D03: all weights are 0', () => {
    for (const cls of ['home', 'draw', 'away'] as const) {
      for (const key of LOGISTIC_FEATURE_KEYS) {
        expect(DEFAULT_LOGISTIC_COEFFICIENTS[cls].weights[key]).toBe(0);
      }
    }
  });

  it('SP-V4-20-D04: regularization_lambda is 0.01', () => {
    expect(DEFAULT_LOGISTIC_COEFFICIENTS.regularization_lambda).toBe(0.01);
  });
});

// ── predictLogistic — invariants ─────────────────────────────────────────

describe('predictLogistic — invariants', () => {
  const baseFeatures = extractLogisticFeatures(makeBaseParams());

  it('SP-V4-20-P01: default coefficients → uniform probabilities (33.3%)', () => {
    const result = predictLogistic(baseFeatures, DEFAULT_LOGISTIC_COEFFICIENTS);
    expect(result.probHome).toBeCloseTo(1 / 3, 10);
    expect(result.probDraw).toBeCloseTo(1 / 3, 10);
    expect(result.probAway).toBeCloseTo(1 / 3, 10);
  });

  it('SP-V4-20-P02: probabilities sum to 1.0', () => {
    const result = predictLogistic(baseFeatures, DEFAULT_LOGISTIC_COEFFICIENTS);
    expect(result.probHome + result.probDraw + result.probAway).toBeCloseTo(1.0, 10);
  });

  it('SP-V4-20-P03: all probabilities are non-negative', () => {
    const result = predictLogistic(baseFeatures, DEFAULT_LOGISTIC_COEFFICIENTS);
    expect(result.probHome).toBeGreaterThanOrEqual(0);
    expect(result.probDraw).toBeGreaterThanOrEqual(0);
    expect(result.probAway).toBeGreaterThanOrEqual(0);
  });

  it('SP-V4-20-P04: all probabilities are at most 1', () => {
    const result = predictLogistic(baseFeatures, DEFAULT_LOGISTIC_COEFFICIENTS);
    expect(result.probHome).toBeLessThanOrEqual(1);
    expect(result.probDraw).toBeLessThanOrEqual(1);
    expect(result.probAway).toBeLessThanOrEqual(1);
  });
});

// ── predictLogistic — trained coefficients ────────────────────────────────

describe('predictLogistic — with trained coefficients', () => {
  function makeCoeffsWithHomeAdvantage(): LogisticCoefficients {
    // Strong home advantage: large positive bias for home, negative for away
    const zeroWeights = () => {
      const w = {} as Record<keyof LogisticFeatureVector, number>;
      for (const k of LOGISTIC_FEATURE_KEYS) w[k] = 0;
      return w;
    };
    return {
      home: { bias: 2.0,  weights: zeroWeights() },
      draw: { bias: 0.0,  weights: zeroWeights() },
      away: { bias: -1.0, weights: zeroWeights() },
      trained_on_matches: 500,
      trained_at: '2026-03-01T00:00:00Z',
      regularization_lambda: 0.01,
    };
  }

  it('SP-V4-20-P05: high home bias → probHome is highest', () => {
    const features = extractLogisticFeatures(makeBaseParams());
    const coeffs = makeCoeffsWithHomeAdvantage();
    const result = predictLogistic(features, coeffs);
    expect(result.probHome).toBeGreaterThan(result.probDraw);
    expect(result.probHome).toBeGreaterThan(result.probAway);
  });

  it('SP-V4-20-P06: probabilities sum to 1.0 with trained coefficients', () => {
    const features = extractLogisticFeatures(makeBaseParams());
    const coeffs = makeCoeffsWithHomeAdvantage();
    const result = predictLogistic(features, coeffs);
    expect(result.probHome + result.probDraw + result.probAway).toBeCloseTo(1.0, 10);
  });

  it('SP-V4-20-P07: lambda_diff weight on home class → higher lambda_diff → higher probHome', () => {
    const zeroWeights = () => {
      const w = {} as Record<keyof LogisticFeatureVector, number>;
      for (const k of LOGISTIC_FEATURE_KEYS) w[k] = 0;
      return w;
    };
    const homeWeights = zeroWeights();
    homeWeights['lambda_diff'] = 1.0; // positive weight on lambda_diff for home class

    const coeffs: LogisticCoefficients = {
      home: { bias: 0, weights: homeWeights },
      draw: { bias: 0, weights: zeroWeights() },
      away: { bias: 0, weights: zeroWeights() },
      trained_on_matches: 100,
      trained_at: '2026-03-01T00:00:00Z',
      regularization_lambda: 0.01,
    };

    // High home advantage (λh >> λa) → lambda_diff positive → home score high
    const highHomeFv = extractLogisticFeatures({ ...makeBaseParams(), lambdaHome: 3.0, lambdaAway: 0.5 });
    const result1 = predictLogistic(highHomeFv, coeffs);

    // Low home advantage (λh << λa) → lambda_diff negative → home score low
    const highAwayFv = extractLogisticFeatures({ ...makeBaseParams(), lambdaHome: 0.5, lambdaAway: 3.0 });
    const result2 = predictLogistic(highAwayFv, coeffs);

    expect(result1.probHome).toBeGreaterThan(result2.probHome);
  });

  it('SP-V4-20-P08: deterministic — same inputs → same output', () => {
    const features = extractLogisticFeatures(makeBaseParams());
    const result1 = predictLogistic(features, DEFAULT_LOGISTIC_COEFFICIENTS);
    const result2 = predictLogistic(features, DEFAULT_LOGISTIC_COEFFICIENTS);
    expect(result1.probHome).toBe(result2.probHome);
    expect(result1.probDraw).toBe(result2.probDraw);
    expect(result1.probAway).toBe(result2.probAway);
  });

  it('SP-V4-20-P09: softmax numerical stability with very large scores', () => {
    const zeroWeights = () => {
      const w = {} as Record<keyof LogisticFeatureVector, number>;
      for (const k of LOGISTIC_FEATURE_KEYS) w[k] = 0;
      return w;
    };
    // Extreme bias difference that would overflow without max-subtraction trick
    const coeffs: LogisticCoefficients = {
      home: { bias: 1000.0, weights: zeroWeights() },
      draw: { bias: 999.9,  weights: zeroWeights() },
      away: { bias: 0.0,    weights: zeroWeights() },
      trained_on_matches: 0,
      trained_at: '2026-01-01T00:00:00Z',
      regularization_lambda: 0.01,
    };
    const features = extractLogisticFeatures(makeBaseParams());
    const result = predictLogistic(features, coeffs);
    // Should not be NaN
    expect(isNaN(result.probHome)).toBe(false);
    expect(isNaN(result.probDraw)).toBe(false);
    expect(isNaN(result.probAway)).toBe(false);
    // Should sum to 1
    expect(result.probHome + result.probDraw + result.probAway).toBeCloseTo(1.0, 10);
    // Home should dominate
    expect(result.probHome).toBeGreaterThan(0.5);
  });
});

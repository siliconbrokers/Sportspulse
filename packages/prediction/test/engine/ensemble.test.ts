/**
 * ensemble.test.ts — Tests para §SP-V4-21 Ensemble Combinator.
 *
 * Cubre:
 *   - Los 3 componentes disponibles → mezcla correcta
 *   - Sin market → redistribución correcta
 *   - Sin logistic → redistribución correcta
 *   - Solo poisson → retorna poisson directo
 *   - Pesos no normalizados → se normalizan antes de operar
 *   - Resultado siempre en [0,1] y suma 1.0
 *   - weights_used suma 1.0
 *   - Determinismo
 */

import { describe, it, expect } from 'vitest';
import {
  combineEnsemble,
  type EnsembleInput,
  type EnsembleWeights,
} from '../../src/engine/v3/ensemble.js';
import { ENSEMBLE_WEIGHTS_DEFAULT } from '../../src/engine/v3/constants.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const poissonProbs = { probHome: 0.50, probDraw: 0.25, probAway: 0.25 };
const marketProbs  = { probHome: 0.45, probDraw: 0.27, probAway: 0.28 };
const logisticProbs = { probHome: 0.52, probDraw: 0.24, probAway: 0.24 };
const defaultWeights: EnsembleWeights = {
  w_poisson:  0.70,
  w_market:   0.15,
  w_logistic: 0.15,
};

function sumProbs(r: { probHome: number; probDraw: number; probAway: number }) {
  return r.probHome + r.probDraw + r.probAway;
}

function sumWeights(w: EnsembleWeights) {
  return w.w_poisson + w.w_market + w.w_logistic;
}

// ── ENSEMBLE_WEIGHTS_DEFAULT constant ────────────────────────────────────

describe('ENSEMBLE_WEIGHTS_DEFAULT', () => {
  it('SP-V4-21-C01: w_poisson = 0.80 (updated SP-V4-11+V4-22: sweep walk-forward 2026-03-17)', () => {
    expect(ENSEMBLE_WEIGHTS_DEFAULT.w_poisson).toBe(0.80);
  });

  it('SP-V4-21-C02: w_market = 0.15 (SP-V4-22 sweep walk-forward 2026-03-18)', () => {
    expect(ENSEMBLE_WEIGHTS_DEFAULT.w_market).toBe(0.15);
  });

  it('SP-V4-21-C03: w_logistic = 0.05 (SP-V4-22 sweep: +0.8pp DR pre-calibration vs no-logistic)', () => {
    expect(ENSEMBLE_WEIGHTS_DEFAULT.w_logistic).toBe(0.05);
  });

  it('SP-V4-21-C04: weights sum to 1.0', () => {
    expect(
      ENSEMBLE_WEIGHTS_DEFAULT.w_poisson +
      ENSEMBLE_WEIGHTS_DEFAULT.w_market +
      ENSEMBLE_WEIGHTS_DEFAULT.w_logistic
    ).toBeCloseTo(1.0, 10);
  });
});

// ── 3 components available ────────────────────────────────────────────────

describe('combineEnsemble — all 3 components', () => {
  it('SP-V4-21-A01: probabilities sum to 1.0', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(sumProbs(result)).toBeCloseTo(1.0, 10);
  });

  it('SP-V4-21-A02: probabilities are in [0, 1]', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(result.probHome).toBeGreaterThanOrEqual(0);
    expect(result.probDraw).toBeGreaterThanOrEqual(0);
    expect(result.probAway).toBeGreaterThanOrEqual(0);
    expect(result.probHome).toBeLessThanOrEqual(1);
    expect(result.probDraw).toBeLessThanOrEqual(1);
    expect(result.probAway).toBeLessThanOrEqual(1);
  });

  it('SP-V4-21-A03: weights_used sum to 1.0', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(sumWeights(result.weights_used)).toBeCloseTo(1.0, 10);
  });

  it('SP-V4-21-A04: weights_used equals normalized input weights when all available', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    // Input weights already sum to 1.0, so effective weights = input weights
    expect(result.weights_used.w_poisson).toBeCloseTo(0.70, 10);
    expect(result.weights_used.w_market).toBeCloseTo(0.15, 10);
    expect(result.weights_used.w_logistic).toBeCloseTo(0.15, 10);
  });

  it('SP-V4-21-A05: result is weighted average of all 3 components', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    const expectedHome = 0.70 * poissonProbs.probHome + 0.15 * marketProbs.probHome + 0.15 * logisticProbs.probHome;
    const expectedDraw = 0.70 * poissonProbs.probDraw + 0.15 * marketProbs.probDraw + 0.15 * logisticProbs.probDraw;
    const expectedAway = 0.70 * poissonProbs.probAway + 0.15 * marketProbs.probAway + 0.15 * logisticProbs.probAway;
    expect(result.probHome).toBeCloseTo(expectedHome, 10);
    expect(result.probDraw).toBeCloseTo(expectedDraw, 10);
    expect(result.probAway).toBeCloseTo(expectedAway, 10);
  });
});

// ── Without market ────────────────────────────────────────────────────────

describe('combineEnsemble — without market', () => {
  it('SP-V4-21-B01: probabilities sum to 1.0 without market', () => {
    const input: EnsembleInput = { poisson: poissonProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(sumProbs(result)).toBeCloseTo(1.0, 10);
  });

  it('SP-V4-21-B02: weights_used sum to 1.0 without market', () => {
    const input: EnsembleInput = { poisson: poissonProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(sumWeights(result.weights_used)).toBeCloseTo(1.0, 10);
  });

  it('SP-V4-21-B03: w_market = 0 when market not available', () => {
    const input: EnsembleInput = { poisson: poissonProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(result.weights_used.w_market).toBe(0);
  });

  it('SP-V4-21-B04: w_poisson and w_logistic are > 0 when market absent', () => {
    const input: EnsembleInput = { poisson: poissonProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(result.weights_used.w_poisson).toBeGreaterThan(0);
    expect(result.weights_used.w_logistic).toBeGreaterThan(0);
  });

  it('SP-V4-21-B05: market weight redistributed proportionally to poisson and logistic', () => {
    const input: EnsembleInput = { poisson: poissonProbs, logistic: logisticProbs };
    const result = combineEnsemble(input, defaultWeights);
    // Original: 0.70, 0.15, 0.15. Market absent → redistribute 0.15
    // Proportional redistribution: poisson gets 0.15*(0.70/0.85), logistic gets 0.15*(0.15/0.85)
    const expectedPoisson  = 0.70 + 0.15 * (0.70 / (0.70 + 0.15));
    const expectedLogistic = 0.15 + 0.15 * (0.15 / (0.70 + 0.15));
    expect(result.weights_used.w_poisson).toBeCloseTo(expectedPoisson / (expectedPoisson + expectedLogistic), 6);
    expect(result.weights_used.w_logistic).toBeCloseTo(expectedLogistic / (expectedPoisson + expectedLogistic), 6);
  });
});

// ── Without logistic ──────────────────────────────────────────────────────

describe('combineEnsemble — without logistic', () => {
  it('SP-V4-21-L01: probabilities sum to 1.0 without logistic', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(sumProbs(result)).toBeCloseTo(1.0, 10);
  });

  it('SP-V4-21-L02: weights_used sum to 1.0 without logistic', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(sumWeights(result.weights_used)).toBeCloseTo(1.0, 10);
  });

  it('SP-V4-21-L03: w_logistic = 0 when logistic not available', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(result.weights_used.w_logistic).toBe(0);
  });

  it('SP-V4-21-L04: w_poisson and w_market are > 0 when logistic absent', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(result.weights_used.w_poisson).toBeGreaterThan(0);
    expect(result.weights_used.w_market).toBeGreaterThan(0);
  });
});

// ── Only poisson ──────────────────────────────────────────────────────────

describe('combineEnsemble — only poisson', () => {
  it('SP-V4-21-O01: probabilities equal poisson when market and logistic absent', () => {
    const input: EnsembleInput = { poisson: poissonProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(result.probHome).toBeCloseTo(poissonProbs.probHome, 10);
    expect(result.probDraw).toBeCloseTo(poissonProbs.probDraw, 10);
    expect(result.probAway).toBeCloseTo(poissonProbs.probAway, 10);
  });

  it('SP-V4-21-O02: w_poisson = 1.0 when only poisson available', () => {
    const input: EnsembleInput = { poisson: poissonProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(result.weights_used.w_poisson).toBeCloseTo(1.0, 10);
    expect(result.weights_used.w_market).toBe(0);
    expect(result.weights_used.w_logistic).toBe(0);
  });

  it('SP-V4-21-O03: probabilities sum to 1.0 when only poisson', () => {
    const input: EnsembleInput = { poisson: poissonProbs };
    const result = combineEnsemble(input, defaultWeights);
    expect(sumProbs(result)).toBeCloseTo(1.0, 10);
  });
});

// ── Non-normalized input weights ──────────────────────────────────────────

describe('combineEnsemble — non-normalized input weights', () => {
  it('SP-V4-21-N01: weights that do not sum to 1 are normalized before operating', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    // Weights sum to 2.0 (double)
    const doubleWeights: EnsembleWeights = { w_poisson: 1.40, w_market: 0.30, w_logistic: 0.30 };
    const result = combineEnsemble(input, doubleWeights);
    // Effective weights should be same as defaultWeights (proportionally identical)
    expect(result.weights_used.w_poisson).toBeCloseTo(0.70, 10);
    expect(result.weights_used.w_market).toBeCloseTo(0.15, 10);
    expect(result.weights_used.w_logistic).toBeCloseTo(0.15, 10);
  });

  it('SP-V4-21-N02: result matches default weights case when rescaled', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    const doubleWeights: EnsembleWeights = { w_poisson: 1.40, w_market: 0.30, w_logistic: 0.30 };
    const resultNorm    = combineEnsemble(input, defaultWeights);
    const resultDouble  = combineEnsemble(input, doubleWeights);
    expect(resultNorm.probHome).toBeCloseTo(resultDouble.probHome, 10);
    expect(resultNorm.probDraw).toBeCloseTo(resultDouble.probDraw, 10);
    expect(resultNorm.probAway).toBeCloseTo(resultDouble.probAway, 10);
  });

  it('SP-V4-21-N03: weights_used sum to 1.0 after normalization', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    const weirdWeights: EnsembleWeights = { w_poisson: 3.5, w_market: 0.5, w_logistic: 1.0 };
    const result = combineEnsemble(input, weirdWeights);
    expect(sumWeights(result.weights_used)).toBeCloseTo(1.0, 10);
  });
});

// ── Boundary cases ────────────────────────────────────────────────────────

describe('combineEnsemble — boundary cases', () => {
  it('SP-V4-21-Z01: extreme poisson (100% home) → result dominated by home', () => {
    const input: EnsembleInput = {
      poisson:  { probHome: 1.0,  probDraw: 0.0,  probAway: 0.0 },
      market:   { probHome: 0.40, probDraw: 0.30, probAway: 0.30 },
      logistic: { probHome: 0.40, probDraw: 0.30, probAway: 0.30 },
    };
    const result = combineEnsemble(input, defaultWeights);
    expect(result.probHome).toBeGreaterThan(result.probDraw);
    expect(result.probHome).toBeGreaterThan(result.probAway);
    expect(sumProbs(result)).toBeCloseTo(1.0, 10);
  });

  it('SP-V4-21-Z02: all components identical → result equals any component', () => {
    const uniform = { probHome: 1/3, probDraw: 1/3, probAway: 1/3 };
    const input: EnsembleInput = { poisson: uniform, market: uniform, logistic: uniform };
    const result = combineEnsemble(input, defaultWeights);
    expect(result.probHome).toBeCloseTo(1/3, 10);
    expect(result.probDraw).toBeCloseTo(1/3, 10);
    expect(result.probAway).toBeCloseTo(1/3, 10);
  });

  it('SP-V4-21-Z03: deterministic — same inputs → same output', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    const result1 = combineEnsemble(input, defaultWeights);
    const result2 = combineEnsemble(input, defaultWeights);
    expect(result1.probHome).toBe(result2.probHome);
    expect(result1.probDraw).toBe(result2.probDraw);
    expect(result1.probAway).toBe(result2.probAway);
  });

  it('SP-V4-21-Z04: zero input weights sum → poisson gets full weight', () => {
    const input: EnsembleInput = { poisson: poissonProbs, market: marketProbs, logistic: logisticProbs };
    const zeroWeights: EnsembleWeights = { w_poisson: 0, w_market: 0, w_logistic: 0 };
    const result = combineEnsemble(input, zeroWeights);
    // With all zero weights, poisson gets full weight as fallback
    expect(result.weights_used.w_poisson).toBeCloseTo(1.0, 10);
    expect(sumProbs(result)).toBeCloseTo(1.0, 10);
  });
});

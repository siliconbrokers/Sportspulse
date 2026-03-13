/**
 * walk-forward-metrics.test.ts
 *
 * Tests unitarios del framework de validación walk-forward (§17).
 *
 * Cubre:
 *   - Constantes naive baseline
 *   - computeLogLoss (fórmula, ELIGIBLE-only, NOT_ELIGIBLE excluido)
 *   - computeBrierScore multiclase (fórmula, rango [0, 2])
 *   - computeAccuracy
 *   - computeDrawRate
 *   - computeGoalsComparison
 *   - computeCalibration (global)
 *   - computePerClassCalibration (por clase)
 *   - computeAllMetrics (incluye per_class_calibration_buckets)
 *   - Anti-leakage: n_current_at_time refleja solo pasado estricto
 */

import { describe, it, expect } from 'vitest';
import {
  NAIVE_LOG_LOSS,
  NAIVE_BRIER,
  computeLogLoss,
  computeBrierScore,
  computeAccuracy,
  computeDrawRate,
  computeGoalsComparison,
  computeCalibration,
  computePerClassCalibration,
  computeAllMetrics,
} from '../../src/validation/metrics.js';
import { runWalkForward } from '../../src/validation/walk-forward.js';
import type { WFPrediction } from '../../src/validation/walk-forward.js';

// ── Fixtures helpers ──────────────────────────────────────────────────────────

function makePred(overrides: Partial<WFPrediction> = {}): WFPrediction {
  return {
    matchId: 'T1:T2:2024-01-01T00:00:00.000Z',
    utcDate: '2024-01-01T00:00:00.000Z',
    homeTeamId: 'T1',
    awayTeamId: 'T2',
    prob_home_win: 0.5,
    prob_draw: 0.3,
    prob_away_win: 0.2,
    lambda_home: 1.5,
    lambda_away: 1.0,
    actual_outcome: 'H',
    actual_home_goals: 2,
    actual_away_goals: 0,
    eligibility_status: 'FULL',
    confidence_level: 'HIGH',
    n_current_at_time: 10,
    ...overrides,
  };
}

// ── NAIVE_LOG_LOSS ────────────────────────────────────────────────────────────

describe('NAIVE_LOG_LOSS', () => {
  it('es ln(3) ≈ 1.0986', () => {
    expect(NAIVE_LOG_LOSS).toBeCloseTo(Math.log(3), 10);
    expect(NAIVE_LOG_LOSS).toBeGreaterThan(1.09);
    expect(NAIVE_LOG_LOSS).toBeLessThan(1.1);
  });
});

// ── NAIVE_BRIER ───────────────────────────────────────────────────────────────

describe('NAIVE_BRIER', () => {
  it('es 2/3 ≈ 0.6667', () => {
    expect(NAIVE_BRIER).toBeCloseTo(2 / 3, 10);
    expect(NAIVE_BRIER).toBeGreaterThan(0.666);
    expect(NAIVE_BRIER).toBeLessThan(0.667);
  });

  it('el modelo uniforme (1/3 cada outcome) produce exactamente NAIVE_BRIER', () => {
    // 3 partidos: cada outcome real, prob uniforme 1/3
    const preds = [
      makePred({
        prob_home_win: 1 / 3,
        prob_draw: 1 / 3,
        prob_away_win: 1 / 3,
        actual_outcome: 'H',
      }),
      makePred({
        prob_home_win: 1 / 3,
        prob_draw: 1 / 3,
        prob_away_win: 1 / 3,
        actual_outcome: 'D',
      }),
      makePred({
        prob_home_win: 1 / 3,
        prob_draw: 1 / 3,
        prob_away_win: 1 / 3,
        actual_outcome: 'A',
      }),
    ];
    expect(computeBrierScore(preds)).toBeCloseTo(NAIVE_BRIER, 10);
  });
});

// ── computeLogLoss ────────────────────────────────────────────────────────────

describe('computeLogLoss', () => {
  it('computa -log(p_actual) correctamente para predicción conocida', () => {
    // actual=H, prob_home_win=0.5 → contribution = -log(0.5) = log(2)
    const preds = [makePred({ prob_home_win: 0.5, actual_outcome: 'H' })];
    expect(computeLogLoss(preds)).toBeCloseTo(Math.log(2), 8);
  });

  it('usa prob_draw cuando actual=D', () => {
    const preds = [makePred({ prob_draw: 0.3, actual_outcome: 'D' })];
    expect(computeLogLoss(preds)).toBeCloseTo(-Math.log(0.3), 8);
  });

  it('usa prob_away_win cuando actual=A', () => {
    const preds = [makePred({ prob_away_win: 0.2, actual_outcome: 'A' })];
    expect(computeLogLoss(preds)).toBeCloseTo(-Math.log(0.2), 8);
  });

  it('promedia correctamente sobre múltiples predicciones', () => {
    const p1 = makePred({ prob_home_win: 0.8, actual_outcome: 'H' });
    const p2 = makePred({ prob_away_win: 0.6, actual_outcome: 'A' });
    const expected = -(Math.log(0.8) + Math.log(0.6)) / 2;
    expect(computeLogLoss([p1, p2])).toBeCloseTo(expected, 8);
  });

  it('excluye partidos NOT_ELIGIBLE', () => {
    const eligible = makePred({ prob_home_win: 0.8, actual_outcome: 'H' });
    const notEligible = makePred({
      eligibility_status: 'NOT_ELIGIBLE',
      prob_home_win: 0.1,
      actual_outcome: 'A',
    });
    const withOut = computeLogLoss([eligible]);
    const withIn = computeLogLoss([eligible, notEligible]);
    expect(withOut).toBeCloseTo(withIn, 8);
  });

  it('retorna NaN cuando todos son NOT_ELIGIBLE', () => {
    const preds = [
      makePred({ eligibility_status: 'NOT_ELIGIBLE' }),
      makePred({ eligibility_status: 'NOT_ELIGIBLE' }),
    ];
    expect(computeLogLoss(preds)).toBeNaN();
  });

  it('clampea prob a EPSILON para evitar log(0)', () => {
    const preds = [makePred({ prob_home_win: 0.0, actual_outcome: 'H' })];
    const result = computeLogLoss(preds);
    expect(isFinite(result)).toBe(true);
    // -log(1e-7) ≈ 16.1
    expect(result).toBeGreaterThan(10);
  });
});

// ── computeBrierScore ─────────────────────────────────────────────────────────

describe('computeBrierScore', () => {
  it('es 0 para predicción perfecta', () => {
    const preds = [
      makePred({ prob_home_win: 1.0, prob_draw: 0.0, prob_away_win: 0.0, actual_outcome: 'H' }),
    ];
    expect(computeBrierScore(preds)).toBeCloseTo(0, 8);
  });

  it('computa (pH-1)²+(pD-0)²+(pA-0)² cuando actual=H', () => {
    const pH = 0.5,
      pD = 0.3,
      pA = 0.2;
    const expected = (pH - 1) ** 2 + (pD - 0) ** 2 + (pA - 0) ** 2;
    const preds = [
      makePred({ prob_home_win: pH, prob_draw: pD, prob_away_win: pA, actual_outcome: 'H' }),
    ];
    expect(computeBrierScore(preds)).toBeCloseTo(expected, 8);
  });

  it('computa correctamente cuando actual=D', () => {
    const pH = 0.4,
      pD = 0.4,
      pA = 0.2;
    const expected = (pH - 0) ** 2 + (pD - 1) ** 2 + (pA - 0) ** 2;
    const preds = [
      makePred({ prob_home_win: pH, prob_draw: pD, prob_away_win: pA, actual_outcome: 'D' }),
    ];
    expect(computeBrierScore(preds)).toBeCloseTo(expected, 8);
  });

  it('excluye NOT_ELIGIBLE del cómputo', () => {
    const eligible = makePred({
      prob_home_win: 1,
      prob_draw: 0,
      prob_away_win: 0,
      actual_outcome: 'H',
    });
    const notEligible = makePred({
      eligibility_status: 'NOT_ELIGIBLE',
      prob_home_win: 0,
      prob_draw: 0,
      prob_away_win: 1,
      actual_outcome: 'A',
    });
    expect(computeBrierScore([eligible, notEligible])).toBeCloseTo(0, 8);
  });

  it('modelo uniforme produce NAIVE_BRIER', () => {
    const preds = [
      makePred({
        prob_home_win: 1 / 3,
        prob_draw: 1 / 3,
        prob_away_win: 1 / 3,
        actual_outcome: 'H',
      }),
      makePred({
        prob_home_win: 1 / 3,
        prob_draw: 1 / 3,
        prob_away_win: 1 / 3,
        actual_outcome: 'D',
      }),
      makePred({
        prob_home_win: 1 / 3,
        prob_draw: 1 / 3,
        prob_away_win: 1 / 3,
        actual_outcome: 'A',
      }),
    ];
    expect(computeBrierScore(preds)).toBeCloseTo(NAIVE_BRIER, 8);
  });

  it('el peor caso (probabilidad 0 al outcome real, en todos) puede alcanzar 2', () => {
    // pH=0, pD=0, pA=1 pero actual=H → (0-1)²+(0-0)²+(1-0)²=2
    const preds = [
      makePred({ prob_home_win: 0, prob_draw: 0, prob_away_win: 1, actual_outcome: 'H' }),
    ];
    expect(computeBrierScore(preds)).toBeCloseTo(2, 8);
  });
});

// ── computeAccuracy ───────────────────────────────────────────────────────────

describe('computeAccuracy', () => {
  it('100% cuando argmax siempre coincide con outcome real', () => {
    const preds = [
      makePred({ prob_home_win: 0.8, prob_draw: 0.1, prob_away_win: 0.1, actual_outcome: 'H' }),
      makePred({ prob_home_win: 0.1, prob_draw: 0.8, prob_away_win: 0.1, actual_outcome: 'D' }),
      makePred({ prob_home_win: 0.1, prob_draw: 0.1, prob_away_win: 0.8, actual_outcome: 'A' }),
    ];
    expect(computeAccuracy(preds)).toBeCloseTo(1.0, 8);
  });

  it('0% cuando argmax nunca coincide', () => {
    const preds = [
      makePred({ prob_home_win: 0.8, prob_draw: 0.1, prob_away_win: 0.1, actual_outcome: 'A' }),
      makePred({ prob_home_win: 0.1, prob_draw: 0.8, prob_away_win: 0.1, actual_outcome: 'A' }),
    ];
    expect(computeAccuracy(preds)).toBeCloseTo(0, 8);
  });

  it('desempate prob_home_win >= prob_draw → predice H', () => {
    // pH == pD → H gana el desempate
    const preds = [
      makePred({ prob_home_win: 0.4, prob_draw: 0.4, prob_away_win: 0.2, actual_outcome: 'H' }),
    ];
    expect(computeAccuracy(preds)).toBeCloseTo(1.0, 8);
  });

  it('excluye NOT_ELIGIBLE', () => {
    const eligible = makePred({ prob_home_win: 0.9, actual_outcome: 'H' });
    const notElig = makePred({
      eligibility_status: 'NOT_ELIGIBLE',
      prob_home_win: 0.1,
      actual_outcome: 'H',
    });
    expect(computeAccuracy([eligible, notElig])).toBeCloseTo(1.0, 8);
  });
});

// ── computeDrawRate ───────────────────────────────────────────────────────────

describe('computeDrawRate', () => {
  it('calcula media de prob_draw y fracción de empates reales', () => {
    const preds = [
      makePred({ prob_draw: 0.2, actual_outcome: 'H' }),
      makePred({ prob_draw: 0.4, actual_outcome: 'D' }),
      makePred({ prob_draw: 0.3, actual_outcome: 'D' }),
    ];
    const r = computeDrawRate(preds);
    expect(r.predicted_mean).toBeCloseTo((0.2 + 0.4 + 0.3) / 3, 8);
    expect(r.actual_rate).toBeCloseTo(2 / 3, 8);
    expect(r.n).toBe(3);
  });

  it('retorna NaN cuando sin partidos evaluables', () => {
    const r = computeDrawRate([makePred({ eligibility_status: 'NOT_ELIGIBLE' })]);
    expect(r.predicted_mean).toBeNaN();
    expect(r.actual_rate).toBeNaN();
    expect(r.n).toBe(0);
  });
});

// ── computeGoalsComparison ────────────────────────────────────────────────────

describe('computeGoalsComparison', () => {
  it('promedia lambdas y goles reales correctamente', () => {
    const preds = [
      makePred({ lambda_home: 1.5, lambda_away: 1.0, actual_home_goals: 2, actual_away_goals: 1 }),
      makePred({ lambda_home: 2.0, lambda_away: 0.5, actual_home_goals: 1, actual_away_goals: 0 }),
    ];
    const r = computeGoalsComparison(preds);
    expect(r.predicted_home_pg).toBeCloseTo(1.75, 8);
    expect(r.predicted_away_pg).toBeCloseTo(0.75, 8);
    expect(r.actual_home_pg).toBeCloseTo(1.5, 8);
    expect(r.actual_away_pg).toBeCloseTo(0.5, 8);
    expect(r.predicted_total_pg).toBeCloseTo(2.5, 8);
    expect(r.actual_total_pg).toBeCloseTo(2.0, 8);
  });
});

// ── computeCalibration (global) ───────────────────────────────────────────────

describe('computeCalibration (global)', () => {
  it('agrupa correctamente en buckets de 10%', () => {
    // prob_home_win=0.85 → bucket [80%,90%)
    const preds = [
      makePred({ prob_home_win: 0.85, prob_draw: 0.1, prob_away_win: 0.05, actual_outcome: 'H' }),
    ];
    const buckets = computeCalibration(preds);
    // Bucket 8 = [80%,90%)
    const bucket80 = buckets.find((b) => b.p_min === 0.8 && b.p_max === 0.9)!;
    expect(bucket80).toBeDefined();
    expect(bucket80.n_pairs).toBeGreaterThan(0);
    // actual_outcome=H → el par (prob_home_win=0.85, hit=true) cae aquí
    expect(bucket80.actual_hit_rate).toBeCloseTo(1, 5);
  });

  it('genera exactamente 10 buckets', () => {
    const preds = [makePred()];
    expect(computeCalibration(preds)).toHaveLength(10);
  });

  it('produce 3 pares por partido evaluable (home + draw + away)', () => {
    // 1 partido → 3 pares total distribuidos en buckets
    const preds = [makePred({ prob_home_win: 0.5, prob_draw: 0.3, prob_away_win: 0.2 })];
    const buckets = computeCalibration(preds);
    const total = buckets.reduce((s, b) => s + b.n_pairs, 0);
    expect(total).toBe(3);
  });
});

// ── computePerClassCalibration ────────────────────────────────────────────────

describe('computePerClassCalibration', () => {
  it('retorna home, draw, away separados', () => {
    const preds = [makePred()];
    const result = computePerClassCalibration(preds);
    expect(result).toHaveProperty('home');
    expect(result).toHaveProperty('draw');
    expect(result).toHaveProperty('away');
    expect(result.home).toHaveLength(10);
    expect(result.draw).toHaveLength(10);
    expect(result.away).toHaveLength(10);
  });

  it('cada clase genera exactamente 1 par por partido (no mezcla clases)', () => {
    const preds = [
      makePred({ prob_home_win: 0.7, prob_draw: 0.2, prob_away_win: 0.1 }),
      makePred({ prob_home_win: 0.6, prob_draw: 0.3, prob_away_win: 0.1 }),
    ];
    const result = computePerClassCalibration(preds);
    const totalHome = result.home.reduce((s, b) => s + b.n_pairs, 0);
    const totalDraw = result.draw.reduce((s, b) => s + b.n_pairs, 0);
    const totalAway = result.away.reduce((s, b) => s + b.n_pairs, 0);
    // Cada clase tiene exactamente N pares (uno por partido)
    expect(totalHome).toBe(2);
    expect(totalDraw).toBe(2);
    expect(totalAway).toBe(2);
  });

  it('hit rate de home = 1.0 cuando todos aciertan el outcome H', () => {
    // 10 partidos donde prob_home_win=0.8 y actual=H → todos hits en bucket [80%,90%)
    const preds = Array.from({ length: 10 }, () =>
      makePred({ prob_home_win: 0.85, prob_draw: 0.1, prob_away_win: 0.05, actual_outcome: 'H' }),
    );
    const result = computePerClassCalibration(preds);
    const bucket80 = result.home.find((b) => b.p_min === 0.8)!;
    expect(bucket80.n_pairs).toBe(10);
    expect(bucket80.actual_hit_rate).toBeCloseTo(1.0, 5);
  });

  it('hit rate de draw = 0.0 cuando actual nunca es D pero prob_draw cae en el bucket', () => {
    const preds = Array.from({ length: 5 }, () =>
      makePred({ prob_draw: 0.25, actual_outcome: 'H' }),
    );
    const result = computePerClassCalibration(preds);
    const bucket20 = result.draw.find((b) => b.p_min === 0.2)!;
    expect(bucket20.n_pairs).toBe(5);
    expect(bucket20.actual_hit_rate).toBeCloseTo(0.0, 5);
  });

  it('excluye NOT_ELIGIBLE de todas las clases', () => {
    const preds = [makePred({ eligibility_status: 'NOT_ELIGIBLE', prob_home_win: 0.9 })];
    const result = computePerClassCalibration(preds);
    const total = [...result.home, ...result.draw, ...result.away].reduce(
      (s, b) => s + b.n_pairs,
      0,
    );
    expect(total).toBe(0);
  });
});

// ── computeAllMetrics ─────────────────────────────────────────────────────────

describe('computeAllMetrics', () => {
  it('incluye per_class_calibration_buckets en el bundle', () => {
    const preds = [makePred(), makePred()];
    const m = computeAllMetrics(preds);
    expect(m).toHaveProperty('per_class_calibration_buckets');
    expect(m.per_class_calibration_buckets).toHaveProperty('home');
    expect(m.per_class_calibration_buckets).toHaveProperty('draw');
    expect(m.per_class_calibration_buckets).toHaveProperty('away');
  });

  it('n_total incluye NOT_ELIGIBLE, n_evaluated no', () => {
    const preds = [
      makePred({ eligibility_status: 'FULL' }),
      makePred({ eligibility_status: 'LIMITED' }),
      makePred({ eligibility_status: 'NOT_ELIGIBLE' }),
    ];
    const m = computeAllMetrics(preds);
    expect(m.n_total).toBe(3);
    expect(m.n_evaluated).toBe(2);
    expect(m.n_not_eligible).toBe(1);
    expect(m.n_limited).toBe(1);
  });
});

// ── Anti-leakage: n_current_at_time ──────────────────────────────────────────

describe('runWalkForward — anti-leakage via n_current_at_time', () => {
  /**
   * Verifica que en el walk-forward, cada predicción solo tiene acceso
   * a los partidos estrictamente anteriores en el tiempo.
   *
   * n_current_at_time debe ser 0 para el primero, 1 para el segundo, etc.
   * Este test es independiente del resultado del engine (que puede retornar
   * NOT_ELIGIBLE con pocos datos).
   */
  it('la primera predicción usa 0 partidos pasados de la temporada actual', () => {
    const matches = [
      {
        homeTeamId: 'T1',
        awayTeamId: 'T2',
        utcDate: '2024-08-10T15:00:00.000Z',
        homeGoals: 2,
        awayGoals: 1,
      },
      {
        homeTeamId: 'T3',
        awayTeamId: 'T4',
        utcDate: '2024-08-17T15:00:00.000Z',
        homeGoals: 1,
        awayGoals: 1,
      },
      {
        homeTeamId: 'T5',
        awayTeamId: 'T6',
        utcDate: '2024-08-24T15:00:00.000Z',
        homeGoals: 0,
        awayGoals: 2,
      },
    ];

    const predictions = runWalkForward(matches, []);
    expect(predictions.length).toBeGreaterThan(0);
    expect(predictions[0].n_current_at_time).toBe(0);
  });

  it('la segunda predicción usa exactamente 1 partido pasado', () => {
    const matches = [
      {
        homeTeamId: 'T1',
        awayTeamId: 'T2',
        utcDate: '2024-08-10T15:00:00.000Z',
        homeGoals: 2,
        awayGoals: 1,
      },
      {
        homeTeamId: 'T3',
        awayTeamId: 'T4',
        utcDate: '2024-08-17T15:00:00.000Z',
        homeGoals: 1,
        awayGoals: 0,
      },
      {
        homeTeamId: 'T5',
        awayTeamId: 'T6',
        utcDate: '2024-08-24T15:00:00.000Z',
        homeGoals: 0,
        awayGoals: 1,
      },
    ];

    const predictions = runWalkForward(matches, []);
    if (predictions.length >= 2) {
      expect(predictions[1].n_current_at_time).toBe(1);
    }
  });

  it('la predicción N tiene n_current_at_time = N - 1', () => {
    const matches = Array.from({ length: 8 }, (_, i) => ({
      homeTeamId: `T${i * 2 + 1}`,
      awayTeamId: `T${i * 2 + 2}`,
      utcDate: `2024-08-${String(i + 1).padStart(2, '0')}T15:00:00.000Z`,
      homeGoals: 1,
      awayGoals: 0,
    }));

    const predictions = runWalkForward(matches, []);
    for (let i = 0; i < predictions.length; i++) {
      expect(predictions[i].n_current_at_time).toBe(i);
    }
  });

  it('el orden de entrada no altera el anti-leakage (sortea internamente)', () => {
    const matchesShuffled = [
      {
        homeTeamId: 'T5',
        awayTeamId: 'T6',
        utcDate: '2024-08-24T15:00:00.000Z',
        homeGoals: 0,
        awayGoals: 1,
      },
      {
        homeTeamId: 'T1',
        awayTeamId: 'T2',
        utcDate: '2024-08-10T15:00:00.000Z',
        homeGoals: 2,
        awayGoals: 1,
      },
      {
        homeTeamId: 'T3',
        awayTeamId: 'T4',
        utcDate: '2024-08-17T15:00:00.000Z',
        homeGoals: 1,
        awayGoals: 0,
      },
    ];
    const predictions = runWalkForward(matchesShuffled, []);
    // Después de sort, la primera pred (fecha más temprana) tiene n=0
    expect(predictions[0].n_current_at_time).toBe(0);
    // Y su matchId debe corresponder al match más temprano
    expect(predictions[0].utcDate).toBe('2024-08-10T15:00:00.000Z');
  });
});

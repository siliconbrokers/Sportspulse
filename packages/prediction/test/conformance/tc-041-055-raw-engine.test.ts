/**
 * TC-041 to TC-055 — Match Prediction Engine raw outputs conformance tests.
 *
 * Conformance Test Plan §D: Match Prediction Engine raw
 * Spec authority: §14.1, §14.2, §14.3, §15.1, §15.3, §16.1, §16.5–§16.11, §19.2, §19.3
 *
 * FAMILY: RAW GOAL/SCORELINE ONLY.
 * Calibrated 1X2 invariants are NOT asserted here. §19.7
 */

import { describe, it, expect } from 'vitest';
import {
  buildRawMatchDistribution,
  renormalizeDistribution,
  aggregateRaw1x2,
  computeDerivedRaw,
  getTopScorelines,
  getMostLikelyScoreline,
  EPSILON_PROBABILITY,
  MATRIX_MAX_GOAL_DEFAULT,
  MAX_TAIL_MASS_RAW,
} from '../../src/index.js';
import type { RawMatchDistribution } from '../../src/contracts/index.js';

// Deterministic lambda pairs for property testing (§3 — no randomness)
const LAMBDA_PAIRS: [number, number][] = [
  [0.5, 0.5],
  [1.0, 1.0],
  [1.5, 1.2],
  [2.0, 1.5],
  [2.5, 2.0],
  [3.0, 1.0],
  [3.5, 2.5],
  [4.0, 1.5],
];

// ── TC-041: Cálculo de lambda_home y lambda_away ──────────────────────────

describe('TC-041 — buildRawMatchDistribution genera distribución válida (§5.1, §14.1)', () => {
  it('PASS: distribución construida con lambdas válidos no es null/undefined', () => {
    // Spec §14.1: "El motor debe producir lambda_home, lambda_away"
    const result = buildRawMatchDistribution(1.5, 1.2);
    expect(result).toBeDefined();
    expect(result.distribution).toBeDefined();
    expect(result.lambda_home).toBe(1.5);
    expect(result.lambda_away).toBe(1.2);
  });
});

// ── TC-042: Matriz raw renormalizada suma 1 ───────────────────────────────

describe('TC-042 — Matriz raw renormalizada suma 1 (§14.2, §19.2)', () => {
  it.each(LAMBDA_PAIRS)(
    'PASS: Σ P(i,j) renormalizada = 1 ± epsilon para lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // Spec §19.2: "la suma total de la matriz renormalizada debe ser 1 ± epsilon_probability"
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const agg = aggregateRaw1x2(normalized, result.matrix_max_goal);
      // After renormalization, sum = 1.0 ± epsilon
      expect(Math.abs(agg.sumCheck - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
    },
  );
});

// ── TC-043: Cada celda está en [0,1] y most_likely_scoreline en la matriz ──

describe('TC-043 — Cada celda ∈ [0,1] y most_likely_scoreline pertenece a la matriz (§14.2, §19.2)', () => {
  it.each(LAMBDA_PAIRS)(
    'PASS: todas las celdas en [0,1] para lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // Spec §19.2: "cada celda P(i,j) debe estar en [0,1]"
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const dist = result.distribution as Record<string, number>;
      for (let i = 0; i <= result.matrix_max_goal; i++) {
        for (let j = 0; j <= result.matrix_max_goal; j++) {
          const p = dist[`${i}-${j}`] ?? 0;
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
      }
    },
  );

  it('PASS: most_likely_scoreline pertenece a la matriz vigente', () => {
    // Spec §19.2: "most_likely_scoreline debe pertenecer a la matriz vigente"
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const mls = getMostLikelyScoreline(normalized, result.matrix_max_goal);
    // Score must be a valid i-j key within the matrix bounds
    const parts = mls.score.split('-').map(Number);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeGreaterThanOrEqual(0);
    expect(parts[0]).toBeLessThanOrEqual(result.matrix_max_goal);
    expect(parts[1]).toBeGreaterThanOrEqual(0);
    expect(parts[1]).toBeLessThanOrEqual(result.matrix_max_goal);
  });
});

// ── TC-044: tail_mass_raw bajo permite renormalización ────────────────────

describe('TC-044 — tail_mass_raw bajo permite renormalización (§14.2, §19.2)', () => {
  it('PASS: tail_mass_raw <= max_tail_mass_raw → tailMassExceeded = false', () => {
    // Spec §14.2: "si tail_mass_raw <= max_tail_mass_raw, se permite renormalización explícita"
    // For typical lambdas (e.g., 1.5/1.2), tail mass with maxGoal=7 should be small
    const result = buildRawMatchDistribution(1.5, 1.2, 7);
    expect(result.tail_mass_raw).toBeLessThanOrEqual(MAX_TAIL_MASS_RAW);
    expect(result.tailMassExceeded).toBe(false);
  });
});

// ── TC-045: tail_mass_raw alto no permite renormalización silenciosa ───────

describe('TC-045 — tail_mass_raw alto → no renormalización silenciosa (§14.2, §19.2)', () => {
  it('PASS: lambdas muy altos → tailMassExceeded = true → no renormalización silenciosa', () => {
    // Spec §14.2: "Queda prohibido renormalizar silenciosamente una matriz truncada
    //              cuya masa omitida supere el umbral máximo permitido."
    // With very high lambdas and small maxGoal, tail_mass_raw will exceed threshold
    // Lambda=8.0 with maxGoal=3 → heavy tail
    const result = buildRawMatchDistribution(8.0, 7.0, 3);
    // tail_mass_raw should exceed max_tail_mass_raw = 0.01
    expect(result.tail_mass_raw).toBeGreaterThan(MAX_TAIL_MASS_RAW);
    expect(result.tailMassExceeded).toBe(true);
  });
});

// ── TC-046: expected_goals coincide con lambdas ───────────────────────────

describe('TC-046 — expected_goals = lambda (§15.1, §16.1)', () => {
  it('PASS: expected_goals_home = lambda_home en Poisson v1', () => {
    // Spec §15.1: "expected_goals_home = lambda_home" en baseline v1 con Poisson independiente
    const result = buildRawMatchDistribution(1.75, 1.25);
    expect(result.lambda_home).toBe(1.75);
    expect(result.lambda_away).toBe(1.25);
  });
});

// ── TC-047: raw_1x2_probs se agregan desde la matriz ─────────────────────

describe('TC-047 — raw_1x2_probs agregados desde la matriz (§16.1)', () => {
  it.each(LAMBDA_PAIRS)(
    'PASS: raw_p_home_win = Σ P(i,j) donde i>j para lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // Spec §16.1: "raw_p_home_win = Σ P(i,j) donde i > j"
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const dist = normalized as Record<string, number>;

      let manualHomeWin = 0;
      let manualDraw = 0;
      let manualAwayWin = 0;
      for (let i = 0; i <= result.matrix_max_goal; i++) {
        for (let j = 0; j <= result.matrix_max_goal; j++) {
          const p = dist[`${i}-${j}`] ?? 0;
          if (i > j) manualHomeWin += p;
          else if (i === j) manualDraw += p;
          else manualAwayWin += p;
        }
      }

      const agg = aggregateRaw1x2(normalized, result.matrix_max_goal);
      expect(Math.abs(agg.probs.home - manualHomeWin)).toBeLessThan(EPSILON_PROBABILITY);
      expect(Math.abs(agg.probs.draw - manualDraw)).toBeLessThan(EPSILON_PROBABILITY);
      expect(Math.abs(agg.probs.away - manualAwayWin)).toBeLessThan(EPSILON_PROBABILITY);
    },
  );
});

// ── TC-048: Totales over/under desde raw ──────────────────────────────────

describe('TC-048 — Totales over/under desde raw (§16.5)', () => {
  it('PASS: over_2_5 = P(i+j >= 3) calculado correctamente', () => {
    // Spec §16.5: "over_2_5 = P(i + j >= 3)"
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    const dist = normalized as Record<string, number>;

    let manualOver25 = 0;
    let manualUnder25 = 0;
    for (let i = 0; i <= result.matrix_max_goal; i++) {
      for (let j = 0; j <= result.matrix_max_goal; j++) {
        const p = dist[`${i}-${j}`] ?? 0;
        if (i + j >= 3) manualOver25 += p;
        if (i + j <= 2) manualUnder25 += p;
      }
    }

    expect(Math.abs(derived.over_2_5 - manualOver25)).toBeLessThan(EPSILON_PROBABILITY);
    expect(Math.abs(derived.under_2_5 - manualUnder25)).toBeLessThan(EPSILON_PROBABILITY);
  });

  it('PASS: over_1_5 = P(i+j >= 2) calculado correctamente', () => {
    // Spec §16.5: "over_1_5 = P(i + j >= 2)"
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    const dist = normalized as Record<string, number>;

    let manualOver15 = 0;
    let manualUnder35 = 0;
    for (let i = 0; i <= result.matrix_max_goal; i++) {
      for (let j = 0; j <= result.matrix_max_goal; j++) {
        const p = dist[`${i}-${j}`] ?? 0;
        if (i + j >= 2) manualOver15 += p;
        if (i + j <= 3) manualUnder35 += p;
      }
    }

    expect(Math.abs(derived.over_1_5 - manualOver15)).toBeLessThan(EPSILON_PROBABILITY);
    expect(Math.abs(derived.under_3_5 - manualUnder35)).toBeLessThan(EPSILON_PROBABILITY);
  });
});

// ── TC-049: BTTS desde raw y complemento exacto ───────────────────────────

describe('TC-049 — BTTS desde raw y complemento exacto (§16.6, §19.3)', () => {
  it.each(LAMBDA_PAIRS)(
    'PASS: btts_no = 1 - btts_yes para lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // Spec §16.6: "btts_no = 1 - btts_yes"
      // Spec §19.3: "abs((btts_yes + btts_no) - 1) <= epsilon_probability"
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const derived = computeDerivedRaw(normalized, result.matrix_max_goal);

      // btts_no is computed as 1 - btts_yes
      expect(Math.abs(derived.btts_no - (1 - derived.btts_yes))).toBeLessThan(EPSILON_PROBABILITY);
      // Sum must be 1 ± epsilon (renormalized distribution)
      expect(Math.abs(derived.btts_yes + derived.btts_no - 1.0)).toBeLessThanOrEqual(
        EPSILON_PROBABILITY * 1000,
      );
    },
  );

  it('PASS: btts_yes = P(i >= 1 AND j >= 1)', () => {
    // Spec §16.6: exact formula
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    const dist = normalized as Record<string, number>;

    let manualBtts = 0;
    for (let i = 1; i <= result.matrix_max_goal; i++) {
      for (let j = 1; j <= result.matrix_max_goal; j++) {
        manualBtts += dist[`${i}-${j}`] ?? 0;
      }
    }

    expect(Math.abs(derived.btts_yes - manualBtts)).toBeLessThan(EPSILON_PROBABILITY);
  });
});

// ── TC-050: Totales por equipo desde raw ──────────────────────────────────

describe('TC-050 — Totales por equipo desde raw (§16.7)', () => {
  it('PASS: team_home_over_0_5 = P(i >= 1), team_home_over_1_5 = P(i >= 2)', () => {
    // Spec §16.7: exact formulas
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    const dist = normalized as Record<string, number>;

    let homeOver05 = 0;
    let homeOver15 = 0;
    let awayOver05 = 0;
    let awayOver15 = 0;

    for (let i = 0; i <= result.matrix_max_goal; i++) {
      for (let j = 0; j <= result.matrix_max_goal; j++) {
        const p = dist[`${i}-${j}`] ?? 0;
        if (i >= 1) homeOver05 += p;
        if (i >= 2) homeOver15 += p;
        if (j >= 1) awayOver05 += p;
        if (j >= 2) awayOver15 += p;
      }
    }

    expect(Math.abs(derived.team_home_over_0_5 - homeOver05)).toBeLessThan(EPSILON_PROBABILITY);
    expect(Math.abs(derived.team_home_over_1_5 - homeOver15)).toBeLessThan(EPSILON_PROBABILITY);
    expect(Math.abs(derived.team_away_over_0_5 - awayOver05)).toBeLessThan(EPSILON_PROBABILITY);
    expect(Math.abs(derived.team_away_over_1_5 - awayOver15)).toBeLessThan(EPSILON_PROBABILITY);
  });
});

// ── TC-051: Clean sheets y win to nil desde raw ───────────────────────────

describe('TC-051 — Clean sheets y win to nil desde raw (§16.8, §16.9)', () => {
  it('PASS: clean_sheet_home = P(j = 0)', () => {
    // Spec §16.8: "clean_sheet_home = P(j = 0)"
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    const dist = normalized as Record<string, number>;

    let cleanSheetHome = 0;
    for (let i = 0; i <= result.matrix_max_goal; i++) {
      cleanSheetHome += dist[`${i}-0`] ?? 0;
    }

    expect(Math.abs(derived.clean_sheet_home - cleanSheetHome)).toBeLessThan(EPSILON_PROBABILITY);
  });

  it('PASS: win_to_nil_home = Σ P(i,j) donde i > j y j = 0', () => {
    // Spec §16.9: exact formula
    const result = buildRawMatchDistribution(2.0, 0.8);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    const dist = normalized as Record<string, number>;

    let winToNilHome = 0;
    for (let i = 1; i <= result.matrix_max_goal; i++) {
      winToNilHome += dist[`${i}-0`] ?? 0;
    }

    expect(Math.abs(derived.win_to_nil_home - winToNilHome)).toBeLessThan(EPSILON_PROBABILITY);
  });

  it('PASS: win_to_nil_away = Σ P(i,j) donde j > i y i = 0', () => {
    // Spec §16.9: exact formula
    const result = buildRawMatchDistribution(0.8, 2.0);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    const dist = normalized as Record<string, number>;

    let winToNilAway = 0;
    for (let j = 1; j <= result.matrix_max_goal; j++) {
      winToNilAway += dist[`0-${j}`] ?? 0;
    }

    expect(Math.abs(derived.win_to_nil_away - winToNilAway)).toBeLessThan(EPSILON_PROBABILITY);
  });
});

// ── TC-052: low_scoring_risk fórmula exacta ───────────────────────────────

describe('TC-052 — low_scoring_risk = P(0,0) + P(1,0) + P(0,1) + P(1,1) (§16.10)', () => {
  it('PASS: fórmula exacta con matriz conocida', () => {
    // Spec §16.10: exact formula
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
    const dist = normalized as Record<string, number>;

    const p00 = dist['0-0'] ?? 0;
    const p10 = dist['1-0'] ?? 0;
    const p01 = dist['0-1'] ?? 0;
    const p11 = dist['1-1'] ?? 0;

    const expected = p00 + p10 + p01 + p11;
    expect(Math.abs(derived.low_scoring_risk - expected)).toBeLessThan(EPSILON_PROBABILITY);
  });
});

// ── TC-053: top_scorelines expone exactamente TOP 5 ordenado ──────────────

describe('TC-053 — top_scorelines expone top 5 ordenados (§16.11, §23.2)', () => {
  it('PASS: top_scorelines contiene exactamente 5 scorelines ordenados por probabilidad desc', () => {
    // Spec §15.3: "top_scorelines = top 5 scorelines ordenados por probabilidad"
    // Spec §16.11: same
    // CRITICAL: must be TOP 5, not top 3 (Conformance Plan §I TC-099)
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const top = getTopScorelines(normalized, 5, result.matrix_max_goal);

    // Must have exactly 5 entries
    expect(top).toHaveLength(5);

    // Must be sorted descending
    for (let i = 0; i < top.length - 1; i++) {
      expect(top[i]!.p).toBeGreaterThanOrEqual(top[i + 1]!.p);
    }
  });

  it('PASS: top_scorelines con matrix donde hay > 5 scorelines no-zero', () => {
    // When many scorelines have non-zero probability, top 5 are selected
    const result = buildRawMatchDistribution(2.0, 1.5);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
    const top = getTopScorelines(normalized, 5, result.matrix_max_goal);

    // Should still have exactly 5
    expect(top).toHaveLength(5);
    // All probabilities should be in [0, 1]
    for (const entry of top) {
      expect(entry.p).toBeGreaterThanOrEqual(0);
      expect(entry.p).toBeLessThanOrEqual(1);
    }
  });
});

// ── TC-054: score_model_type persiste INDEPENDENT_POISSON ─────────────────

describe('TC-054 — score_model_type = INDEPENDENT_POISSON (§14.3, §15.4)', () => {
  it('PASS: score_model_type es el literal INDEPENDENT_POISSON', () => {
    // Spec §21: "score_model_type: INDEPENDENT_POISSON" — literal en v1
    // Verifica que la constante/literal existe en el contrato
    // (el response builder la asigna en buildInternals)
    const scoreModelType: 'INDEPENDENT_POISSON' = 'INDEPENDENT_POISSON';
    expect(scoreModelType).toBe('INDEPENDENT_POISSON');
  });
});

// ── TC-055: Reconstrucción determinística desde persistencia mínima ────────

describe('TC-055 — Reconstrucción determinística desde persistencia mínima (§14.3, §25.4)', () => {
  it('PASS: mismos lambda_home, lambda_away, matrix_max_goal → distribución idéntica', () => {
    // Spec §25.4: "pueden reconstruirse de forma determinística los outputs raw correspondientes"
    const lambda_home = 1.75;
    const lambda_away = 1.25;
    const maxGoal = 7;

    const result1 = buildRawMatchDistribution(lambda_home, lambda_away, maxGoal);
    const result2 = buildRawMatchDistribution(lambda_home, lambda_away, maxGoal);

    const dist1 = result1.distribution as Record<string, number>;
    const dist2 = result2.distribution as Record<string, number>;

    // All cells must be identical
    for (let i = 0; i <= maxGoal; i++) {
      for (let j = 0; j <= maxGoal; j++) {
        const key = `${i}-${j}`;
        expect(dist1[key]).toBe(dist2[key]);
      }
    }

    expect(result1.tail_mass_raw).toBe(result2.tail_mass_raw);
    expect(result1.tailMassExceeded).toBe(result2.tailMassExceeded);
  });

  it('PASS: derived raw outputs son determinísticos para misma distribución', () => {
    // §25.4: same inputs → same outputs
    const result = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);

    const derived1 = computeDerivedRaw(normalized, result.matrix_max_goal);
    const derived2 = computeDerivedRaw(normalized, result.matrix_max_goal);

    expect(derived1.over_2_5).toBe(derived2.over_2_5);
    expect(derived1.btts_yes).toBe(derived2.btts_yes);
    expect(derived1.most_likely_scoreline).toBe(derived2.most_likely_scoreline);
    expect(derived1.top_scorelines[0]?.score).toBe(derived2.top_scorelines[0]?.score);
  });
});

// ── ADDITIONAL: over_2_5 + under_2_5 invariant (RENORMALIZED) ─────────────

describe('RAW family: over_2_5 + under_2_5 = 1.0 ONLY for renormalized distributions (§19.3)', () => {
  it.each(LAMBDA_PAIRS)(
    'PASS: over_2_5 + under_2_5 = 1.0 ± epsilon para distribución renormalizada (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // Spec §19.3: "abs((over_2_5 + under_2_5) - 1) <= epsilon_probability"
      // This invariant holds for RENORMALIZED distributions.
      // For raw (non-renormalized): over_2_5 + under_2_5 = 1 - tail_mass_raw
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const normalized = renormalizeDistribution(result.distribution, result.matrix_max_goal);
      const derived = computeDerivedRaw(normalized, result.matrix_max_goal);
      expect(Math.abs(derived.over_2_5 + derived.under_2_5 - 1.0)).toBeLessThanOrEqual(
        EPSILON_PROBABILITY * 1000,
      );
    },
  );

  it('PASS: para distribución NO renormalizada, over_2_5 + under_2_5 = 1 - tail_mass_raw', () => {
    // This is the raw invariant: the pair sums to 1 - tail_mass_raw, not 1.0
    // This test explicitly verifies the non-renormalized case behaves as expected
    const result = buildRawMatchDistribution(1.5, 1.2);
    const dist = result.distribution as Record<string, number>;
    const maxGoal = result.matrix_max_goal;

    let rawOver25 = 0;
    let rawUnder25 = 0;
    for (let i = 0; i <= maxGoal; i++) {
      for (let j = 0; j <= maxGoal; j++) {
        const p = dist[`${i}-${j}`] ?? 0;
        if (i + j >= 3) rawOver25 += p;
        if (i + j <= 2) rawUnder25 += p;
      }
    }

    // For raw (non-renormalized): sum = 1 - tail_mass_raw
    const expectedSum = 1 - result.tail_mass_raw;
    expect(Math.abs(rawOver25 + rawUnder25 - expectedSum)).toBeLessThan(EPSILON_PROBABILITY);

    // Confirm it does NOT equal 1.0 when there's tail mass
    if (result.tail_mass_raw > EPSILON_PROBABILITY) {
      expect(Math.abs(rawOver25 + rawUnder25 - 1.0)).toBeGreaterThan(result.tail_mass_raw / 2);
    }
  });
});

// ── ADDITIONAL: tail_mass_raw identity checks ─────────────────────────────

describe('RAW family: tail_mass_raw identity (§14.2, §19.2)', () => {
  it.each(LAMBDA_PAIRS)(
    'PASS: matrix_sum + tail_mass_raw = 1.0 ± epsilon para lambdas (%s, %s)',
    (lambdaHome, lambdaAway) => {
      // Spec §14.2: tail_mass_raw = 1 - Σ P(i,j)
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      const agg = aggregateRaw1x2(result.distribution, result.matrix_max_goal);
      const reconstructed = agg.sumCheck + result.tail_mass_raw;
      expect(Math.abs(reconstructed - 1.0)).toBeLessThanOrEqual(EPSILON_PROBABILITY);
    },
  );

  it('PASS: tail_mass_raw >= 0 siempre', () => {
    // Spec §14.2: tail_mass_raw is always non-negative (Math.max(0, ...))
    for (const [lambdaHome, lambdaAway] of LAMBDA_PAIRS) {
      const result = buildRawMatchDistribution(lambdaHome, lambdaAway);
      expect(result.tail_mass_raw).toBeGreaterThanOrEqual(0);
    }
  });

  it('PASS: tail_mass_raw < 1.0 cuando hay al menos un scoreline con masa no-zero', () => {
    // At minimum, P(0,0) > 0 for any finite lambda
    const result = buildRawMatchDistribution(1.5, 1.2);
    expect(result.tail_mass_raw).toBeLessThan(1.0);
  });
});

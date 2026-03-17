/**
 * Tests para markets.ts
 *
 * Invariantes verificados:
 * 1. over_X_5 + under_X_5 = 1 para cada umbral
 * 2. btts.yes + btts.no = 1
 * 3. dnb.home + dnb.away = 1
 * 4. AH: home_plus_half = home_minus_half + probDraw
 * 5. AH: away_plus_half = away_minus_half + probDraw
 * 6. DC: home_or_draw = probHome + probDraw
 * 7. xG: total = home + away
 * 8. Top scorelines: ordenadas desc por probabilidad, máx 5 elementos
 * 9. Valores conocidos para una distribución simple
 * 10. computeMarkets wrapper retorna todos los campos
 */

import { describe, it, expect } from 'vitest';
import {
  computeOverUnder,
  computeBtts,
  computeDoubleChance,
  computeDnb,
  computeAsianHandicap,
  computeExpectedGoals,
  computeTopScorelines,
  computeMarkets,
} from '../../src/engine/v3/markets.js';

// ── Matrices de prueba ─────────────────────────────────────────────────────────

/**
 * Distribución determinística: solo el marcador 1-0.
 * matrix[1][0] = 1.0, el resto = 0.
 */
function makeDegenerate1_0(): number[][] {
  const m: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
  m[1]![0] = 1.0;
  return m;
}

/**
 * Distribución determinística: solo el marcador 0-0.
 */
function makeDegenerate0_0(): number[][] {
  const m: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
  m[0]![0] = 1.0;
  return m;
}

/**
 * Distribución uniforme sobre marcadores 0-0, 0-1, 1-0, 1-1 (P=0.25 cada uno).
 */
function makeUniform2x2(): number[][] {
  const m: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
  m[0]![0] = 0.25;
  m[0]![1] = 0.25;
  m[1]![0] = 0.25;
  m[1]![1] = 0.25;
  return m;
}

/**
 * Distribución con goles altos: solo 3-2.
 */
function makeDegenerate3_2(): number[][] {
  const m: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
  m[3]![2] = 1.0;
  return m;
}

// ── Over/Under ─────────────────────────────────────────────────────────────────

describe('computeOverUnder — invariantes', () => {
  it('over + under = 1 para cada umbral con distribución 1-0', () => {
    const ou = computeOverUnder(makeDegenerate1_0());
    expect(ou.over_0_5 + ou.under_0_5).toBeCloseTo(1, 10);
    expect(ou.over_1_5 + ou.under_1_5).toBeCloseTo(1, 10);
    expect(ou.over_2_5 + ou.under_2_5).toBeCloseTo(1, 10);
    expect(ou.over_3_5 + ou.under_3_5).toBeCloseTo(1, 10);
    expect(ou.over_4_5 + ou.under_4_5).toBeCloseTo(1, 10);
  });

  it('distribución 1-0: over_0_5=1, over_1_5=0, over_2_5=0', () => {
    const ou = computeOverUnder(makeDegenerate1_0());
    expect(ou.over_0_5).toBeCloseTo(1.0, 10);
    expect(ou.over_1_5).toBeCloseTo(0.0, 10);
    expect(ou.over_2_5).toBeCloseTo(0.0, 10);
  });

  it('distribución 0-0: over_0_5=0, todos los over = 0', () => {
    const ou = computeOverUnder(makeDegenerate0_0());
    expect(ou.over_0_5).toBeCloseTo(0.0, 10);
    expect(ou.over_1_5).toBeCloseTo(0.0, 10);
    expect(ou.over_4_5).toBeCloseTo(0.0, 10);
  });

  it('distribución 3-2: over_4_5=1, over_2_5=1, over_3_5=1', () => {
    const ou = computeOverUnder(makeDegenerate3_2());
    expect(ou.over_2_5).toBeCloseTo(1.0, 10);
    expect(ou.over_3_5).toBeCloseTo(1.0, 10);
    expect(ou.over_4_5).toBeCloseTo(1.0, 10);
  });

  it('distribución uniforme 2x2: over_0_5=0.75, over_1_5=0.25, over_2_5=0', () => {
    const ou = computeOverUnder(makeUniform2x2());
    // 0-0 tiene 0 goles, el resto tiene ≥1 gol
    expect(ou.over_0_5).toBeCloseTo(0.75, 10);
    expect(ou.under_0_5).toBeCloseTo(0.25, 10);
    // Solo 1-1 tiene ≥2 goles
    expect(ou.over_1_5).toBeCloseTo(0.25, 10);
    // Ninguno tiene ≥3 goles
    expect(ou.over_2_5).toBeCloseTo(0.0, 10);
  });
});

// ── BTTS ──────────────────────────────────────────────────────────────────────

describe('computeBtts — invariantes', () => {
  it('yes + no = 1', () => {
    for (const m of [makeDegenerate1_0(), makeDegenerate0_0(), makeUniform2x2(), makeDegenerate3_2()]) {
      const btts = computeBtts(m);
      expect(btts.yes + btts.no).toBeCloseTo(1, 10);
    }
  });

  it('1-0: BTTS=0 (away no anota)', () => {
    const btts = computeBtts(makeDegenerate1_0());
    expect(btts.yes).toBeCloseTo(0.0, 10);
    expect(btts.no).toBeCloseTo(1.0, 10);
  });

  it('0-0: BTTS=0 (nadie anota)', () => {
    const btts = computeBtts(makeDegenerate0_0());
    expect(btts.yes).toBeCloseTo(0.0, 10);
  });

  it('3-2: BTTS=1 (ambos anotan)', () => {
    const btts = computeBtts(makeDegenerate3_2());
    expect(btts.yes).toBeCloseTo(1.0, 10);
  });

  it('2x2 uniforme: BTTS=0.25 (solo 1-1 tiene ambos anotando)', () => {
    const btts = computeBtts(makeUniform2x2());
    expect(btts.yes).toBeCloseTo(0.25, 10);
  });
});

// ── Double Chance ─────────────────────────────────────────────────────────────

describe('computeDoubleChance — invariantes', () => {
  it('1X = probHome + probDraw', () => {
    const ph = 0.5, pd = 0.25, pa = 0.25;
    const dc = computeDoubleChance(ph, pd, pa);
    expect(dc.home_or_draw).toBeCloseTo(ph + pd, 10);
  });

  it('X2 = probDraw + probAway', () => {
    const ph = 0.5, pd = 0.25, pa = 0.25;
    const dc = computeDoubleChance(ph, pd, pa);
    expect(dc.draw_or_away).toBeCloseTo(pd + pa, 10);
  });

  it('12 = probHome + probAway = 1 − probDraw', () => {
    const ph = 0.5, pd = 0.25, pa = 0.25;
    const dc = computeDoubleChance(ph, pd, pa);
    expect(dc.home_or_away).toBeCloseTo(ph + pa, 10);
    expect(dc.home_or_away).toBeCloseTo(1 - pd, 10);
  });
});

// ── DNB ───────────────────────────────────────────────────────────────────────

describe('computeDnb — invariantes', () => {
  it('home + away = 1', () => {
    const dnb = computeDnb(0.6, 0.25);
    expect(dnb.home + dnb.away).toBeCloseTo(1, 10);
  });

  it('partido parejo: home = away = 0.5', () => {
    const dnb = computeDnb(0.35, 0.35);
    expect(dnb.home).toBeCloseTo(0.5, 10);
    expect(dnb.away).toBeCloseTo(0.5, 10);
  });

  it('home dominante: dnb.home > 0.5', () => {
    const dnb = computeDnb(0.6, 0.1);
    expect(dnb.home).toBeGreaterThan(0.5);
    expect(dnb.home + dnb.away).toBeCloseTo(1, 10);
  });

  it('total ≈ 0: fallback 0.5/0.5', () => {
    const dnb = computeDnb(0, 0);
    expect(dnb.home).toBeCloseTo(0.5, 10);
    expect(dnb.away).toBeCloseTo(0.5, 10);
  });
});

// ── Asian Handicap ────────────────────────────────────────────────────────────

describe('computeAsianHandicap — invariantes', () => {
  const ph = 0.55, pd = 0.25, pa = 0.20;

  it('home_plus_half = home_minus_half + probDraw', () => {
    const ah = computeAsianHandicap(ph, pd, pa);
    expect(ah.home_plus_half).toBeCloseTo(ah.home_minus_half + pd, 10);
  });

  it('away_plus_half = away_minus_half + probDraw', () => {
    const ah = computeAsianHandicap(ph, pd, pa);
    expect(ah.away_plus_half).toBeCloseTo(ah.away_minus_half + pd, 10);
  });

  it('home_minus_half = probHome', () => {
    const ah = computeAsianHandicap(ph, pd, pa);
    expect(ah.home_minus_half).toBeCloseTo(ph, 10);
  });

  it('away_minus_half = probAway', () => {
    const ah = computeAsianHandicap(ph, pd, pa);
    expect(ah.away_minus_half).toBeCloseTo(pa, 10);
  });
});

// ── Expected Goals ────────────────────────────────────────────────────────────

describe('computeExpectedGoals — invariantes', () => {
  it('total = home + away', () => {
    const ou = computeOverUnder(makeUniform2x2());
    const xg = computeExpectedGoals(1.5, 1.1, ou);
    expect(xg.total).toBeCloseTo(xg.home + xg.away, 10);
  });

  it('lambdas se preservan en home y away', () => {
    const ou = computeOverUnder(makeUniform2x2());
    const xg = computeExpectedGoals(1.82, 1.05, ou);
    expect(xg.home).toBeCloseTo(1.82, 10);
    expect(xg.away).toBeCloseTo(1.05, 10);
  });

  it('implied_goal_line: para 0-0 puro → 0.5 (todos los over ≈ 0)', () => {
    const ou = computeOverUnder(makeDegenerate0_0());
    const xg = computeExpectedGoals(0, 0, ou);
    // over_0_5 = 0 (más cercano a 0.5 que any otras), implied_goal_line = 0.5
    expect(xg.implied_goal_line).toBe(0.5);
  });

  it('implied_goal_line: para 3-2 puro → over_4_5=1 (todos son 1), el más cercano a 0.5 es 4.5', () => {
    const ou = computeOverUnder(makeDegenerate3_2());
    const xg = computeExpectedGoals(2.5, 1.5, ou);
    // All over values: over_0_5=1, over_1_5=1, over_2_5=1, over_3_5=1, over_4_5=1
    // Closest to 0.5 is the first one (0.5), but all are tied at dist=0.5
    // Should return 0.5 (first element wins tie)
    expect(xg.implied_goal_line).toBe(0.5);
  });
});

// ── Top Scorelines ────────────────────────────────────────────────────────────

describe('computeTopScorelines — invariantes', () => {
  it('retorna exactamente N elementos cuando hay suficientes celdas', () => {
    const m = makeUniform2x2();
    const top = computeTopScorelines(m, 3);
    expect(top).toHaveLength(3);
  });

  it('ordena por probabilidad descendente', () => {
    const m = makeDegenerate1_0();
    const top = computeTopScorelines(m, 5);
    for (let i = 1; i < top.length; i++) {
      expect(top[i]!.probability).toBeLessThanOrEqual(top[i - 1]!.probability);
    }
  });

  it('el primer elemento para 1-0 puro es { home:1, away:0, probability:1.0 }', () => {
    const top = computeTopScorelines(makeDegenerate1_0(), 1);
    expect(top[0]!.home).toBe(1);
    expect(top[0]!.away).toBe(0);
    expect(top[0]!.probability).toBeCloseTo(1.0, 10);
  });

  it('2x2 uniforme: top-4 tienen todos probability=0.25', () => {
    const top = computeTopScorelines(makeUniform2x2(), 4);
    expect(top).toHaveLength(4);
    for (const s of top) {
      expect(s.probability).toBeCloseTo(0.25, 10);
    }
  });

  it('§16.11 — default n=5: retorna exactamente 5 o el total de celdas disponibles si < 5', () => {
    const top = computeTopScorelines(makeUniform2x2());
    // Uniform 2x2 has only 4 non-zero cells; the other 21 cells of the 5x5 matrix are 0.
    // All 25 cells are returned but only first 5 (including zeros) — max is 5.
    expect(top.length).toBeLessThanOrEqual(5);
    // With a bigger matrix having ≥5 non-zero cells, exactly 5 must be returned
    const bigM: number[][] = Array.from({ length: 4 }, () => Array(4).fill(0) as number[]);
    bigM[0]![0] = 0.3; bigM[1]![0] = 0.2; bigM[0]![1] = 0.2; bigM[1]![1] = 0.15; bigM[2]![0] = 0.1; bigM[0]![2] = 0.05;
    const top2 = computeTopScorelines(bigM);
    expect(top2).toHaveLength(5);
  });
});

// ── computeMarkets (wrapper) ──────────────────────────────────────────────────

describe('computeMarkets — wrapper', () => {
  it('retorna todos los campos de MarketsOutput', () => {
    const m = makeUniform2x2();
    const markets = computeMarkets(m, 0.40, 0.30, 0.30, 1.2, 1.1);

    expect(markets.over_under).toBeDefined();
    expect(markets.btts).toBeDefined();
    expect(markets.double_chance).toBeDefined();
    expect(markets.dnb).toBeDefined();
    expect(markets.asian_handicap).toBeDefined();
    expect(markets.expected_goals).toBeDefined();
    expect(markets.top_scorelines).toBeDefined();
  });

  it('§16.11 — top_scorelines retorna exactamente 5 elementos (spec §16.11)', () => {
    // Use a large matrix so there are definitely ≥5 non-zero cells
    const m: number[][] = Array.from({ length: 6 }, () => Array(6).fill(0) as number[]);
    m[0]![0] = 0.20; m[1]![0] = 0.18; m[0]![1] = 0.15; m[1]![1] = 0.12; m[2]![0] = 0.10;
    m[0]![2] = 0.08; m[2]![1] = 0.05; // 7 non-zero cells
    const markets = computeMarkets(m, 0.5, 0.25, 0.25, 1.3, 0.8);
    expect(markets.top_scorelines).toHaveLength(5);
  });

  it('expected_goals.total = lambdaHome + lambdaAway', () => {
    const markets = computeMarkets(makeUniform2x2(), 0.4, 0.3, 0.3, 1.6, 1.2);
    expect(markets.expected_goals.total).toBeCloseTo(1.6 + 1.2, 10);
  });

  it('btts.yes + btts.no = 1', () => {
    const markets = computeMarkets(makeUniform2x2(), 0.4, 0.3, 0.3, 1.2, 1.0);
    expect(markets.btts.yes + markets.btts.no).toBeCloseTo(1, 10);
  });

  it('dnb.home + dnb.away = 1', () => {
    const markets = computeMarkets(makeUniform2x2(), 0.5, 0.25, 0.25, 1.2, 1.0);
    expect(markets.dnb.home + markets.dnb.away).toBeCloseTo(1, 10);
  });

  // ── §16.3/§16.4 — F4: calibrated probs used for double_chance and DNB ────────

  it('§16.3 — double_chance usa probs calibradas cuando se proveen (no las raw Poisson)', () => {
    const m = makeUniform2x2();
    // Raw Poisson probs: home=0.40, draw=0.30, away=0.30
    // Calibrated probs:  home=0.50, draw=0.25, away=0.25
    const markets = computeMarkets(m, 0.40, 0.30, 0.30, 1.2, 1.1, 0.50, 0.25, 0.25);
    // double_chance should use calibrated, not raw
    expect(markets.double_chance.home_or_draw).toBeCloseTo(0.50 + 0.25, 10);
    expect(markets.double_chance.draw_or_away).toBeCloseTo(0.25 + 0.25, 10);
    expect(markets.double_chance.home_or_away).toBeCloseTo(0.50 + 0.25, 10);
    // NOT equal to raw-based values (0.40+0.30=0.70, 0.30+0.30=0.60, etc.)
    expect(markets.double_chance.home_or_draw).not.toBeCloseTo(0.40 + 0.30, 5);
  });

  it('§16.4 — DNB usa probs calibradas cuando se proveen (no las raw Poisson)', () => {
    const m = makeUniform2x2();
    // Raw: home=0.40, away=0.30; Calibrated: home=0.55, away=0.20
    const markets = computeMarkets(m, 0.40, 0.30, 0.30, 1.2, 1.1, 0.55, 0.25, 0.20);
    // DNB should use calibrated home=0.55 and away=0.20
    const expectedDnbHome = 0.55 / (0.55 + 0.20);
    expect(markets.dnb.home).toBeCloseTo(expectedDnbHome, 8);
    expect(markets.dnb.home + markets.dnb.away).toBeCloseTo(1, 10);
    // NOT equal to raw-based DNB (0.40/(0.40+0.30)=0.571...)
    expect(markets.dnb.home).not.toBeCloseTo(0.40 / (0.40 + 0.30), 5);
  });

  it('§16.3/§16.4 — sin probs calibradas: fallback a raw Poisson (backward-compat)', () => {
    const m = makeUniform2x2();
    const markets = computeMarkets(m, 0.45, 0.30, 0.25, 1.2, 1.0);
    // No calibrated probs passed → should use raw probs
    expect(markets.double_chance.home_or_draw).toBeCloseTo(0.45 + 0.30, 10);
    expect(markets.dnb.home).toBeCloseTo(0.45 / (0.45 + 0.25), 8);
  });

  it('§16.3 — O/U y BTTS no se ven afectados por las probs calibradas (usan matriz Poisson)', () => {
    const m = makeUniform2x2();
    const marketsRaw = computeMarkets(m, 0.40, 0.30, 0.30, 1.2, 1.1);
    const marketsCal = computeMarkets(m, 0.40, 0.30, 0.30, 1.2, 1.1, 0.60, 0.20, 0.20);
    // O/U and BTTS come from the matrix, unaffected by prob changes
    expect(marketsRaw.over_under.over_0_5).toBeCloseTo(marketsCal.over_under.over_0_5, 10);
    expect(marketsRaw.btts.yes).toBeCloseTo(marketsCal.btts.yes, 10);
  });
});

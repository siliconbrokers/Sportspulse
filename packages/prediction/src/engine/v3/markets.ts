/**
 * markets.ts — Motor Predictivo V3: §T1 Mercados derivados de la matriz Poisson.
 *
 * Todos los mercados se derivan de la grilla Poisson renormalizada y de las
 * probabilidades 1X2 ya calculadas por computePoissonMatrix.
 *
 * Sin nuevos datos. Sin nuevo modelo. Funciones puras. Sin IO. Deterministas.
 *
 * Funciones exportadas:
 *   computeOverUnder     — O/U 0.5..4.5
 *   computeBtts          — Both Teams To Score
 *   computeDoubleChance  — 1X, X2, 12
 *   computeDnb           — Draw No Bet
 *   computeAsianHandicap — AH ±0.5
 *   computeExpectedGoals — xG + implied goal line
 *   computeTopScorelines — top N marcadores más probables
 *   computeMarkets       — wrapper unificado → MarketsOutput
 */

import type {
  OverUnderMarkets,
  BTTSMarket,
  DoubleChanceMarkets,
  DNBMarkets,
  AsianHandicapMarkets,
  ExpectedGoalsMarkets,
  TopScoreline,
  MarketsOutput,
} from './types.js';

// ── Helpers internos ──────────────────────────────────────────────────────────

/**
 * Suma de celdas matrix[h][a] donde (h + a) ≤ k.
 * Equivale a P(total goals ≤ k).
 */
function pTotalAtMost(matrix: number[][], k: number): number {
  const maxG = matrix.length - 1;
  let p = 0;
  for (let h = 0; h <= Math.min(k, maxG); h++) {
    const row = matrix[h]!;
    const maxA = Math.min(k - h, row.length - 1);
    for (let a = 0; a <= maxA; a++) {
      p += row[a]!;
    }
  }
  return p;
}

// ── Funciones de mercado ──────────────────────────────────────────────────────

/**
 * Computa Over/Under para umbrales 0.5, 1.5, 2.5, 3.5 y 4.5.
 * over_X_5 = P(total goals > X) = 1 − P(total goals ≤ floor(X))
 */
export function computeOverUnder(matrix: number[][]): OverUnderMarkets {
  const u0 = pTotalAtMost(matrix, 0);
  const u1 = pTotalAtMost(matrix, 1);
  const u2 = pTotalAtMost(matrix, 2);
  const u3 = pTotalAtMost(matrix, 3);
  const u4 = pTotalAtMost(matrix, 4);

  return {
    over_0_5:  1 - u0, under_0_5:  u0,
    over_1_5:  1 - u1, under_1_5:  u1,
    over_2_5:  1 - u2, under_2_5:  u2,
    over_3_5:  1 - u3, under_3_5:  u3,
    over_4_5:  1 - u4, under_4_5:  u4,
  };
}

/**
 * Computa BTTS (Both Teams To Score).
 * yes = P(homeGoals ≥ 1 AND awayGoals ≥ 1)
 */
export function computeBtts(matrix: number[][]): BTTSMarket {
  let yes = 0;
  for (let h = 1; h < matrix.length; h++) {
    const row = matrix[h]!;
    for (let a = 1; a < row.length; a++) {
      yes += row[a]!;
    }
  }
  // Clamp a [0,1] por acumulación numérica
  const yesClamped = Math.min(1, Math.max(0, yes));
  return { yes: yesClamped, no: 1 - yesClamped };
}

/**
 * Computa Double Chance (1X, X2, 12).
 * Derivable directamente de las probabilidades 1X2 — no requiere la matriz.
 */
export function computeDoubleChance(
  probHome: number,
  probDraw: number,
  probAway: number,
): DoubleChanceMarkets {
  return {
    home_or_draw: probHome + probDraw,  // 1X
    draw_or_away: probDraw + probAway,  // X2
    home_or_away: probHome + probAway,  // 12 = 1 − probDraw
  };
}

/**
 * Computa Draw No Bet (DNB).
 * Redistribuye la probabilidad de empate entre H y A proporcionalmente.
 */
export function computeDnb(probHome: number, probAway: number): DNBMarkets {
  const total = probHome + probAway;
  if (total < 1e-10) return { home: 0.5, away: 0.5 };
  return {
    home: probHome / total,
    away: probAway / total,
  };
}

/**
 * Computa Asian Handicap ±0.5.
 *   AH -0.5 home  = P(home gana por ≥1) = probHome
 *   AH +0.5 home  = P(home gana o empata) = probHome + probDraw
 *   (simétricamente para away)
 */
export function computeAsianHandicap(
  probHome: number,
  probDraw: number,
  probAway: number,
): AsianHandicapMarkets {
  return {
    home_minus_half: probHome,
    home_plus_half:  probHome + probDraw,
    away_minus_half: probAway,
    away_plus_half:  probAway + probDraw,
  };
}

/**
 * Computa Expected Goals y la línea de goles implícita del mercado.
 * lambdaHome/lambdaAway son los xG del motor (los mejores estimadores de goles esperados).
 * implied_goal_line = umbral O/U (0.5..4.5) donde over_X es más cercano a 0.5.
 */
export function computeExpectedGoals(
  lambdaHome: number,
  lambdaAway: number,
  ou: OverUnderMarkets,
): ExpectedGoalsMarkets {
  const thresholds: Array<[number, number]> = [
    [0.5, ou.over_0_5],
    [1.5, ou.over_1_5],
    [2.5, ou.over_2_5],
    [3.5, ou.over_3_5],
    [4.5, ou.over_4_5],
  ];

  let bestLine = 2.5;
  let bestDist = Infinity;
  for (const [line, over] of thresholds) {
    const dist = Math.abs(over - 0.5);
    if (dist < bestDist) {
      bestDist = dist;
      bestLine = line;
    }
  }

  return {
    home: lambdaHome,
    away: lambdaAway,
    total: lambdaHome + lambdaAway,
    implied_goal_line: bestLine,
  };
}

/**
 * Retorna los N marcadores más probables, ordenados de mayor a menor probabilidad.
 * @param matrix  Matriz normalizada de la distribución de marcadores.
 * @param n       Número máximo de marcadores a retornar (default 5).
 */
export function computeTopScorelines(matrix: number[][], n = 5): TopScoreline[] {
  const entries: TopScoreline[] = [];
  for (let h = 0; h < matrix.length; h++) {
    const row = matrix[h]!;
    for (let a = 0; a < row.length; a++) {
      entries.push({ home: h, away: a, probability: row[a]! });
    }
  }
  entries.sort((x, y) => y.probability - x.probability);
  return entries.slice(0, n);
}

// ── Wrapper unificado ─────────────────────────────────────────────────────────

/**
 * Computa todos los mercados Tier 1 desde la matriz Poisson y las probs 1X2.
 *
 * @param matrix     Matriz normalizada matrix[h][a] de la distribución de marcadores.
 * @param probHome   P(home win) — ya renormalizada.
 * @param probDraw   P(draw) — ya renormalizada.
 * @param probAway   P(away win) — ya renormalizada.
 * @param lambdaHome Lambda del equipo local (xG estimado).
 * @param lambdaAway Lambda del equipo visitante (xG estimado).
 */
export function computeMarkets(
  matrix: number[][],
  probHome: number,
  probDraw: number,
  probAway: number,
  lambdaHome: number,
  lambdaAway: number,
): MarketsOutput {
  const ou = computeOverUnder(matrix);
  return {
    over_under:     ou,
    btts:           computeBtts(matrix),
    double_chance:  computeDoubleChance(probHome, probDraw, probAway),
    dnb:            computeDnb(probHome, probAway),
    asian_handicap: computeAsianHandicap(probHome, probDraw, probAway),
    expected_goals: computeExpectedGoals(lambdaHome, lambdaAway, ou),
    top_scorelines: computeTopScorelines(matrix, 6),
  };
}

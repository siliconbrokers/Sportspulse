/**
 * poisson-v2.ts — Probabilidades 1X2 por Poisson independiente (§12).
 *
 * Grilla 0..8 para local y visitante (§12.1).
 * Renormaliza si la truncación pierde masa (§12.3).
 *
 * Función pura. Sin IO.
 */

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface PoissonResult {
  prob_home_win: number;
  prob_draw: number;
  prob_away_win: number;
}

// ── Implementación ────────────────────────────────────────────────────────────

/**
 * PMF de Poisson en espacio logarítmico para estabilidad numérica.
 * P(X = k | lambda) = exp(-lambda) * lambda^k / k!
 */
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1.0 : 0.0;
  // log-espacio para evitar overflow con lambdas altas y k grandes
  let logProb = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) {
    logProb -= Math.log(i);
  }
  return Math.exp(logProb);
}

/**
 * Computa P(home_win), P(draw), P(away_win) desde lambda_home y lambda_away.
 *
 * §12.1: grilla 0..8 × 0..8 (= 81 celdas).
 * §12.2: P(home) = Σ P(h,a) donde h > a, etc.
 * §12.3: renormaliza si total < 1 (masa truncada por la grilla).
 */
export function computePoissonProbs(lambda_home: number, lambda_away: number): PoissonResult {
  const MAX_GOALS = 8;
  let p_home = 0;
  let p_draw = 0;
  let p_away = 0;
  let total = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    const ph = poissonPmf(lambda_home, h);
    for (let a = 0; a <= MAX_GOALS; a++) {
      const pa = poissonPmf(lambda_away, a);
      const cell = ph * pa;
      total += cell;
      if (h > a) p_home += cell;
      else if (h === a) p_draw += cell;
      else p_away += cell;
    }
  }

  // §12.3: renormalizar si hubo pérdida de masa
  if (total > 0 && total < 1 - 1e-9) {
    p_home /= total;
    p_draw /= total;
    p_away /= total;
  }

  return { prob_home_win: p_home, prob_draw: p_draw, prob_away_win: p_away };
}

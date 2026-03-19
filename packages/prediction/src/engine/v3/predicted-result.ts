/**
 * predicted-result.ts — Motor Predictivo V3: §18 Predicted Result.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §18
 *
 * Función pura. Sin IO. Determinista.
 */

import { TOO_CLOSE_THRESHOLD, DRAW_FLOOR, DRAW_MARGIN, DRAW_FLOOR_ENABLED } from './constants.js';

export interface PredictedResultOutput {
  predicted_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  /** |p_max − p_second| */
  favorite_margin: number;
}

export interface PredictedResultOverrides {
  DRAW_FLOOR?: number;
  DRAW_MARGIN?: number;
  TOO_CLOSE_THRESHOLD?: number;
  /** fix #3: override DRAW_FLOOR_ENABLED feature flag. */
  DRAW_FLOOR_ENABLED?: boolean;
}

/**
 * Determina el resultado predicho a partir de las probabilidades 1X2.
 *
 * max_prob = max(prob_home, prob_draw, prob_away)
 * second_prob = segunda más alta
 *
 * Si max_prob − second_prob < TOO_CLOSE_THRESHOLD (= 0.05):
 *   predicted_result = null   (demasiado parejo)
 * else:
 *   predicted_result = argmax(prob_home, prob_draw, prob_away)
 *
 * @param probHome  Probabilidad de victoria local
 * @param probDraw  Probabilidad de empate
 * @param probAway  Probabilidad de victoria visitante
 * @param overrides Optional overrides for DRAW_FLOOR and DRAW_MARGIN
 */
export function computePredictedResult(
  probHome: number,
  probDraw: number,
  probAway: number,
  overrides?: PredictedResultOverrides,
): PredictedResultOutput {
  const probs: Array<{ key: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'; value: number }> = [
    { key: 'HOME_WIN', value: probHome },
    { key: 'DRAW', value: probDraw },
    { key: 'AWAY_WIN', value: probAway },
  ];

  // Ordenar descendente por probabilidad
  probs.sort((a, b) => b.value - a.value);

  const maxProb = probs[0].value;
  const secondProb = probs[1].value;
  const margin = maxProb - secondProb;

  const effectiveTooCloseThreshold = overrides?.TOO_CLOSE_THRESHOLD ?? TOO_CLOSE_THRESHOLD;

  // ── TOO_CLOSE: diferencia pequeña pero aún retorna argmax ───────────────
  // La cercanía queda señalada por favorite_margin < TOO_CLOSE_THRESHOLD.
  // predicted_result nunca es null cuando hay probs — null queda reservado
  // exclusivamente para NOT_ELIGIBLE (sin probs).
  if (margin < effectiveTooCloseThreshold) {
    return { predicted_result: probs[0].key, favorite_margin: margin };
  }

  // ── DRAW floor rule ────────────────────────────────────────────────────
  // Solo corre cuando el argmax ya es decisivo (TOO_CLOSE ya descartado).
  // Captura partidos donde el argmax elegiría HOME/AWAY pero p_draw está
  // suficientemente elevada y el líder no la supera por mucho.
  // Compensa el sesgo estructural del modelo Poisson + home advantage que
  // siempre infla p_home por encima de p_draw.
  // fix #3: co-desactivada con DrawAffinity. Sin boost previo de p_draw,
  // la regla operaría sobre probs no boosteadas → puede forzar DRAWs erróneos.
  const effectiveDrawFloorEnabled = overrides?.DRAW_FLOOR_ENABLED ?? DRAW_FLOOR_ENABLED;
  if (effectiveDrawFloorEnabled) {
    const effectiveDrawFloor = overrides?.DRAW_FLOOR ?? DRAW_FLOOR;
    const effectiveDrawMargin = overrides?.DRAW_MARGIN ?? DRAW_MARGIN;
    if (probDraw >= effectiveDrawFloor) {
      const maxOther = Math.max(probHome, probAway);
      if (maxOther - probDraw <= effectiveDrawMargin) {
        return {
          predicted_result: 'DRAW',
          favorite_margin: maxOther - probDraw,
        };
      }
    }
  }

  return {
    predicted_result: probs[0].key,
    favorite_margin: margin,
  };
}

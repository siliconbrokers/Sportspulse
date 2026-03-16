/**
 * predicted-result.ts — Motor Predictivo V3: §18 Predicted Result.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §18
 *
 * Función pura. Sin IO. Determinista.
 */

import { TOO_CLOSE_THRESHOLD } from './constants.js';

export interface PredictedResultOutput {
  predicted_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;
  /** |p_max − p_second| */
  favorite_margin: number;
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
 */
export function computePredictedResult(
  probHome: number,
  probDraw: number,
  probAway: number,
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

  return {
    predicted_result: margin < TOO_CLOSE_THRESHOLD ? null : probs[0].key,
    favorite_margin: margin,
  };
}

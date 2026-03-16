/**
 * market-blend.ts — Motor Predictivo V3: §T3-04 Mezcla con odds de mercado.
 *
 * Spec: SP-MKT-T3-00 §6.3
 *
 * Mezcla las probabilidades 1X2 del modelo con las probabilidades implícitas
 * del mercado (de-vigged) usando un peso configurable MARKET_WEIGHT.
 *
 * El resultado afecta SOLO prob_home_win, prob_draw, prob_away_win y
 * predicted_result. Los mercados derivados (O/U, BTTS, scorelines) siguen
 * usando la matriz Poisson original, que es estructuralmente más rica.
 *
 * Función pura. Sin IO. Determinista.
 */

import type { MarketOddsRecord } from './types.js';
import { MARKET_WEIGHT, MARKET_ODDS_SUM_TOLERANCE } from './constants.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MarketBlendResult {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  applied: boolean;
  blend_weight: number;
  model_prob_home_pre_blend: number | null;
  model_prob_draw_pre_blend: number | null;
  model_prob_away_pre_blend: number | null;
  market_prob_home: number | null;
  market_prob_draw: number | null;
  market_prob_away: number | null;
  /** true si las odds de mercado fueron rechazadas por suma inválida. */
  invalidOdds: boolean;
}

// ── Función exportada ─────────────────────────────────────────────────────────

/**
 * Mezcla probabilidades 1X2 del modelo con las odds del mercado (si están disponibles).
 *
 * Cuando `marketOdds` es undefined → retorna las probabilidades del modelo sin cambios,
 * applied = false.
 *
 * Cuando las odds no pasan la validación de suma → retorna modelo sin cambios,
 * applied = false, invalidOdds = true (el caller debe emitir warning MARKET_ODDS_INVALID).
 *
 * @param modelProbHome   Probabilidad de victoria local del modelo Poisson.
 * @param modelProbDraw   Probabilidad de empate del modelo Poisson.
 * @param modelProbAway   Probabilidad de victoria visitante del modelo Poisson.
 * @param marketOdds      Odds del mercado (de-vigged), opcional.
 * @returns               MarketBlendResult con probabilidades resultantes.
 */
export function blendWithMarketOdds(
  modelProbHome: number,
  modelProbDraw: number,
  modelProbAway: number,
  marketOdds: MarketOddsRecord | undefined,
): MarketBlendResult {
  // Caso: no hay odds → retornar modelo sin cambios
  if (marketOdds === undefined) {
    return {
      prob_home: modelProbHome,
      prob_draw: modelProbDraw,
      prob_away: modelProbAway,
      applied: false,
      blend_weight: 0,
      model_prob_home_pre_blend: null,
      model_prob_draw_pre_blend: null,
      model_prob_away_pre_blend: null,
      market_prob_home: null,
      market_prob_draw: null,
      market_prob_away: null,
      invalidOdds: false,
    };
  }

  // Validar suma de odds: |probHome + probDraw + probAway - 1.0| < MARKET_ODDS_SUM_TOLERANCE
  const oddsSum = marketOdds.probHome + marketOdds.probDraw + marketOdds.probAway;
  if (Math.abs(oddsSum - 1.0) >= MARKET_ODDS_SUM_TOLERANCE) {
    return {
      prob_home: modelProbHome,
      prob_draw: modelProbDraw,
      prob_away: modelProbAway,
      applied: false,
      blend_weight: 0,
      model_prob_home_pre_blend: modelProbHome,
      model_prob_draw_pre_blend: modelProbDraw,
      model_prob_away_pre_blend: modelProbAway,
      market_prob_home: marketOdds.probHome,
      market_prob_draw: marketOdds.probDraw,
      market_prob_away: marketOdds.probAway,
      invalidOdds: true,
    };
  }

  // Mezcla: blended = (1 - MARKET_WEIGHT) * model + MARKET_WEIGHT * market
  const w = MARKET_WEIGHT;
  const blendedHome = (1 - w) * modelProbHome + w * marketOdds.probHome;
  const blendedDraw = (1 - w) * modelProbDraw + w * marketOdds.probDraw;
  const blendedAway = (1 - w) * modelProbAway + w * marketOdds.probAway;

  // Renormalizar (defensivo — debería estar cerca de 1.0)
  const blendedSum = blendedHome + blendedDraw + blendedAway;
  const prob_home = blendedHome / blendedSum;
  const prob_draw  = blendedDraw  / blendedSum;
  const prob_away  = blendedAway  / blendedSum;

  return {
    prob_home,
    prob_draw,
    prob_away,
    applied: true,
    blend_weight: w,
    model_prob_home_pre_blend: modelProbHome,
    model_prob_draw_pre_blend: modelProbDraw,
    model_prob_away_pre_blend: modelProbAway,
    market_prob_home: marketOdds.probHome,
    market_prob_draw: marketOdds.probDraw,
    market_prob_away: marketOdds.probAway,
    invalidOdds: false,
  };
}

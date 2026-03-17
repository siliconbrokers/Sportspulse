/**
 * confidence.ts — Motor Predictivo V3: §15 Nivel de Confianza.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §15
 *
 * Función pura. Sin IO. Determinista.
 */

import type { ConfidenceLevel, PriorQuality } from './types.js';
import { MARGIN_FOR_HIGH_CONFIDENCE } from './constants.js';

/**
 * Calcula el nivel de confianza según la tabla del spec §15,
 * con ajuste de margen para evitar etiquetas HIGH engañosas en partidos equilibrados.
 *
 * | min_games | prior_quality             | favorite_margin        | Confianza  |
 * |-----------|---------------------------|------------------------|------------|
 * | ≥ 20      | cualquiera                | ≥ MARGIN_FOR_HIGH      | HIGH       |
 * | ≥ 20      | cualquiera                | < MARGIN_FOR_HIGH      | MEDIUM     |
 * | 12–19     | PREV_SEASON o PARTIAL     | ≥ MARGIN_FOR_HIGH      | HIGH       |
 * | 12–19     | PREV_SEASON o PARTIAL     | < MARGIN_FOR_HIGH      | MEDIUM     |
 * | 12–19     | LEAGUE_BASELINE           | —                      | MEDIUM     |
 * | 7–11      | PREV_SEASON               | —                      | MEDIUM     |
 * | 7–11      | PARTIAL o LEAGUE_BASELINE | —                      | LOW        |
 * | 3–6       | cualquiera                | —                      | LOW        |
 * | < 3       | —                         | —                      | INSUFFICIENT |
 *
 * INSUFFICIENT siempre coincide con NOT_ELIGIBLE (§15).
 *
 * @param gamesHome         Partidos totales del equipo local
 * @param gamesAway         Partidos totales del equipo visitante
 * @param priorQualityHome  Calidad del prior del equipo local
 * @param priorQualityAway  Calidad del prior del equipo visitante
 * @param favoriteMargin    Diferencia entre prob máxima y segunda (opcional).
 *                          Si presente y < MARGIN_FOR_HIGH_CONFIDENCE, degrada HIGH → MEDIUM.
 */
export function computeConfidence(
  gamesHome: number,
  gamesAway: number,
  priorQualityHome: PriorQuality,
  priorQualityAway: PriorQuality,
  favoriteMargin?: number,
): ConfidenceLevel {
  const minGames = Math.min(gamesHome, gamesAway);

  // Usar la peor calidad de prior entre los dos equipos (conservador)
  const worstPrior = worstPriorQuality(priorQualityHome, priorQualityAway);

  if (minGames < 3) return 'INSUFFICIENT';
  if (minGames <= 6) return 'LOW';

  if (minGames <= 11) {
    // 7–11
    if (worstPrior === 'PREV_SEASON') return 'MEDIUM';
    return 'LOW';
  }

  if (minGames <= 19) {
    // 12–19
    if (worstPrior === 'LEAGUE_BASELINE') return 'MEDIUM';
    // HIGH candidate: check margin for equilibrated matches
    if (favoriteMargin !== undefined && favoriteMargin < MARGIN_FOR_HIGH_CONFIDENCE) return 'MEDIUM';
    return 'HIGH';
  }

  // ≥ 20: check margin before HIGH
  if (favoriteMargin !== undefined && favoriteMargin < MARGIN_FOR_HIGH_CONFIDENCE) return 'MEDIUM';
  return 'HIGH';
}

/** Retorna la peor calidad de prior entre dos (la menos informativa). */
function worstPriorQuality(a: PriorQuality, b: PriorQuality): PriorQuality {
  const order: Record<PriorQuality, number> = {
    LEAGUE_BASELINE: 0,
    PARTIAL: 1,
    PREV_SEASON: 2,
  };
  return order[a] <= order[b] ? a : b;
}

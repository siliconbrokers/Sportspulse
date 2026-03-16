/**
 * confidence.ts — Motor Predictivo V3: §15 Nivel de Confianza.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §15
 *
 * Función pura. Sin IO. Determinista.
 */

import type { ConfidenceLevel, PriorQuality } from './types.js';

/**
 * Calcula el nivel de confianza según la tabla del spec §15.
 *
 * | min_games | prior_quality         | Confianza  |
 * |-----------|-----------------------|------------|
 * | ≥ 20      | cualquiera            | HIGH       |
 * | 12–19     | PREV_SEASON o PARTIAL | HIGH       |
 * | 12–19     | LEAGUE_BASELINE       | MEDIUM     |
 * | 7–11      | PREV_SEASON           | MEDIUM     |
 * | 7–11      | PARTIAL o LEAGUE_BASELINE | LOW    |
 * | 3–6       | cualquiera            | LOW        |
 * | < 3       | —                     | INSUFFICIENT |
 *
 * INSUFFICIENT siempre coincide con NOT_ELIGIBLE (§15).
 *
 * @param gamesHome         Partidos totales del equipo local
 * @param gamesAway         Partidos totales del equipo visitante
 * @param priorQualityHome  Calidad del prior del equipo local
 * @param priorQualityAway  Calidad del prior del equipo visitante
 */
export function computeConfidence(
  gamesHome: number,
  gamesAway: number,
  priorQualityHome: PriorQuality,
  priorQualityAway: PriorQuality,
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
    return 'HIGH';
  }

  // ≥ 20
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

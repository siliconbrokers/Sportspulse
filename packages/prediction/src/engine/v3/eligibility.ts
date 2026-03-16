/**
 * eligibility.ts — Motor Predictivo V3: §14 Elegibilidad.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §14
 *
 * Función pura. Sin IO. Determinista.
 */

import type { EligibilityStatus } from './types.js';
import { THRESHOLD_NOT_ELIGIBLE, THRESHOLD_ELIGIBLE } from './constants.js';

/**
 * Determina el status de elegibilidad según los partidos jugados de ambos equipos.
 *
 * min_games = min(games_home, games_away)
 *
 * < thresholdNotEligible → NOT_ELIGIBLE
 * < thresholdEligible    → LIMITED
 * ≥ thresholdEligible    → ELIGIBLE
 *
 * Los thresholds son opcionales — si se omiten, se usan las constantes globales.
 * v3-engine.ts deriva thresholds adaptativos cuando V3EngineInput.expectedSeasonGames
 * está presente (§14 adaptive).
 *
 * @param gamesHome             Partidos totales del equipo local en la temporada actual
 * @param gamesAway             Partidos totales del equipo visitante en la temporada actual
 * @param thresholdNotEligible  Override del umbral NOT_ELIGIBLE (default: THRESHOLD_NOT_ELIGIBLE)
 * @param thresholdEligible     Override del umbral ELIGIBLE    (default: THRESHOLD_ELIGIBLE)
 */
export function computeEligibility(
  gamesHome: number,
  gamesAway: number,
  thresholdNotEligible: number = THRESHOLD_NOT_ELIGIBLE,
  thresholdEligible: number = THRESHOLD_ELIGIBLE,
): EligibilityStatus {
  const minGames = Math.min(gamesHome, gamesAway);

  if (minGames < thresholdNotEligible) return 'NOT_ELIGIBLE';
  if (minGames < thresholdEligible) return 'LIMITED';
  return 'ELIGIBLE';
}

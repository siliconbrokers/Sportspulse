/**
 * recency.ts — Motor Predictivo V3: §9 Recency Delta.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §9
 *
 * Función pura. Sin IO. Determinista.
 */

import type { MatchSignalRA, RecencyDeltas } from './types.js';
import {
  N_RECENT,
  MIN_GAMES_FOR_RECENCY,
  RECENCY_DELTA_MIN,
  RECENCY_DELTA_MAX,
} from './constants.js';

/**
 * Computa los deltas de forma reciente (recency) para un equipo.
 *
 * Solo aplica si totalGames >= MIN_GAMES_FOR_RECENCY.
 * Con menos historial, el time-decay ya es suficiente y la recency añadiría ruido.
 *
 * delta_attack  = recent_attack_avg  / season_attack_avg   [centrado en 1.0]
 * delta_defense = recent_defense_avg / season_defense_avg  [centrado en 1.0]
 *
 * Clip: delta ∈ [0.5, 2.0]
 *
 * @param signals       Señales rival-adjusted del equipo, ordenadas cronológicamente
 * @param totalGames    Total de partidos del equipo en la temporada actual
 * @param seasonAttack  effective_attack del equipo (resultado del paso §7)
 * @param seasonDefense effective_defense del equipo (resultado del paso §7)
 */
export function computeRecencyDeltas(
  signals: readonly MatchSignalRA[],
  totalGames: number,
  seasonAttack: number,
  seasonDefense: number,
): RecencyDeltas {
  // No aplica si hay pocos partidos — deltas neutros
  if (totalGames < MIN_GAMES_FOR_RECENCY || signals.length === 0) {
    return { delta_attack: 1.0, delta_defense: 1.0, applied: false };
  }

  // Tomar los últimos N_RECENT signals (ya ordenados cronológicamente)
  const recent = signals.slice(-N_RECENT);

  const recentAttackAvg = recent.reduce((sum, s) => sum + s.attack_signal, 0) / recent.length;
  const recentDefenseAvg = recent.reduce((sum, s) => sum + s.defense_signal, 0) / recent.length;

  // Evitar división por cero
  const rawDeltaAttack = seasonAttack > 0 ? recentAttackAvg / seasonAttack : 1.0;
  const rawDeltaDefense = seasonDefense > 0 ? recentDefenseAvg / seasonDefense : 1.0;

  // Clip
  const delta_attack = Math.max(RECENCY_DELTA_MIN, Math.min(RECENCY_DELTA_MAX, rawDeltaAttack));
  const delta_defense = Math.max(RECENCY_DELTA_MIN, Math.min(RECENCY_DELTA_MAX, rawDeltaDefense));

  return { delta_attack, delta_defense, applied: true };
}

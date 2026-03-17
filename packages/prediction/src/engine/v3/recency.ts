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
  SOS_SENSITIVITY,
} from './constants.js';

/**
 * Computa los deltas de forma reciente (recency) para un equipo.
 *
 * Solo aplica si totalGames >= MIN_GAMES_FOR_RECENCY.
 * Con menos historial, el time-decay ya es suficiente y la recency añadiría ruido.
 *
 * Promedio uniforme (SOS_SENSITIVITY = 0):
 *   delta_attack  = recent_attack_avg  / season_attack_avg   [centrado en 1.0]
 *   delta_defense = recent_defense_avg / season_defense_avg  [centrado en 1.0]
 *
 * Promedio ponderado por SoS (SOS_SENSITIVITY > 0):
 *   weight_i = max(0, 1 + SOS_SENSITIVITY * (rivalStrength_i − 1.0))
 *   delta_attack  = Σ(weight_i * attack_signal_i)  / Σ(weight_i) / season_attack_avg
 *   delta_defense = Σ(weight_i * defense_signal_i) / Σ(weight_i) / season_defense_avg
 *
 *   Si rivalStrength_i no está disponible para un partido, se usa weight = 1.0 (fallback neutral).
 *   Si la suma de pesos es 0, se cae al promedio uniforme.
 *
 * Clip: delta ∈ [0.5, 2.0]
 *
 * @param signals         Señales rival-adjusted del equipo, ordenadas cronológicamente.
 *                        MatchSignalRA.rivalStrength se usa cuando SOS_SENSITIVITY > 0.
 * @param totalGames      Total de partidos del equipo en la temporada actual
 * @param seasonAttack    effective_attack del equipo (resultado del paso §7)
 * @param seasonDefense   effective_defense del equipo (resultado del paso §7)
 * @param sosSensitivity  Override de SOS_SENSITIVITY (solo para sweep tools). Si no se pasa,
 *                        usa la constante de constants.ts.
 */
export function computeRecencyDeltas(
  signals: readonly MatchSignalRA[],
  totalGames: number,
  seasonAttack: number,
  seasonDefense: number,
  sosSensitivity?: number,
): RecencyDeltas {
  // No aplica si hay pocos partidos — deltas neutros
  if (totalGames < MIN_GAMES_FOR_RECENCY || signals.length === 0) {
    return { delta_attack: 1.0, delta_defense: 1.0, applied: false };
  }

  // Tomar los últimos N_RECENT signals (ya ordenados cronológicamente)
  const recent = signals.slice(-N_RECENT);

  // Sensibilidad SoS efectiva — usa override del sweeper si se pasa, si no la constante global
  const effectiveSoS = sosSensitivity ?? SOS_SENSITIVITY;

  let recentAttackAvg: number;
  let recentDefenseAvg: number;

  if (effectiveSoS === 0) {
    // §9 promedio uniforme — comportamiento original
    recentAttackAvg = recent.reduce((sum, s) => sum + s.attack_signal, 0) / recent.length;
    recentDefenseAvg = recent.reduce((sum, s) => sum + s.defense_signal, 0) / recent.length;
  } else {
    // §SP-V4-05: promedio ponderado por SoS
    // weight_i = max(0, 1 + SOS_SENSITIVITY * (rivalStrength_i − 1.0))
    // Si rivalStrength no está disponible para un partido → weight = 1.0 (neutral fallback)
    let totalWeight = 0;
    let weightedAttack = 0;
    let weightedDefense = 0;

    for (const s of recent) {
      const rivalry = s.rivalStrength ?? 1.0; // fallback neutral cuando el rival no tiene datos
      const weight = Math.max(0, 1 + effectiveSoS * (rivalry - 1.0));
      weightedAttack  += weight * s.attack_signal;
      weightedDefense += weight * s.defense_signal;
      totalWeight     += weight;
    }

    if (totalWeight === 0) {
      // Suma de pesos degenerada → caer al promedio uniforme
      recentAttackAvg  = recent.reduce((sum, s) => sum + s.attack_signal, 0)  / recent.length;
      recentDefenseAvg = recent.reduce((sum, s) => sum + s.defense_signal, 0) / recent.length;
    } else {
      recentAttackAvg  = weightedAttack  / totalWeight;
      recentDefenseAvg = weightedDefense / totalWeight;
    }
  }

  // Evitar división por cero
  const rawDeltaAttack = seasonAttack > 0 ? recentAttackAvg / seasonAttack : 1.0;
  const rawDeltaDefense = seasonDefense > 0 ? recentDefenseAvg / seasonDefense : 1.0;

  // Clip
  const delta_attack = Math.max(RECENCY_DELTA_MIN, Math.min(RECENCY_DELTA_MAX, rawDeltaAttack));
  const delta_defense = Math.max(RECENCY_DELTA_MIN, Math.min(RECENCY_DELTA_MAX, rawDeltaDefense));

  return { delta_attack, delta_defense, applied: true };
}

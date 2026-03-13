/**
 * recency.ts — Recencia como desviación reciente (§9).
 *
 * La forma NO entra como goles crudos. Entra como desviación respecto
 * a la expectativa ajustada por rival. Valor neutro = 1.0.
 *
 * Ventana: últimos 5 partidos válidos.
 * Pesos: [5, 4, 3, 2, 1] del más reciente al más viejo.
 * Shrinkage de recencia: w_form = N / (N + K_form).
 *
 * Funciones puras. Sin IO.
 */

import type { MatchSignal, RecentFormDeltas } from './types.js';

// ── Constantes (§9.2, §9.5) ───────────────────────────────────────────────────

/** Tamaño de ventana de recencia. §9.1 */
const RECENCY_WINDOW = 5;

/**
 * Pesos de recencia del más reciente al más viejo. §9.2
 * Índice 0 = más reciente (peso 5), índice 4 = más viejo (peso 1).
 */
const RECENCY_WEIGHTS = [5, 4, 3, 2, 1] as const;

/** Shrinkage de recencia. §9.5 */
export const K_FORM = 6;

// ── Implementación ────────────────────────────────────────────────────────────

/**
 * Computa los deltas efectivos de forma reciente.
 *
 * @param signals  Señales de partidos ordenadas cronológicamente (ascendente).
 *                 La función extrae los últimos RECENCY_WINDOW.
 * @returns        Deltas efectivos tras shrinkage. Ambos son 1.0 si n_recent=0.
 */
export function computeRecentFormDeltas(signals: MatchSignal[]): RecentFormDeltas {
  // Toma los últimos N partidos (más recientes)
  const recent = signals.slice(-RECENCY_WINDOW);
  const n_recent = recent.length;

  if (n_recent === 0) {
    return {
      effective_recent_attack_delta: 1.0,
      effective_recent_defense_delta: 1.0,
      n_recent: 0,
    };
  }

  // §9.2: pesos por posición — el índice 0 de `recent` es el más viejo
  // (slice(-5) de un array ordenado asc → recent[0]=más viejo, recent[n-1]=más reciente)
  // RECENCY_WEIGHTS[0]=5 va al más reciente → RECENCY_WEIGHTS[n_recent-1-i] al índice i
  let weighted_attack = 0;
  let weighted_defense = 0;
  let total_weight = 0;

  for (let i = 0; i < n_recent; i++) {
    // i=0 es el más viejo → peso = RECENCY_WEIGHTS[n_recent - 1 - i] en la escala 5-a-1
    // pero como RECENCY_WEIGHTS solo tiene 5 elementos, indexamos desde el final
    const weightIdx = RECENCY_WEIGHTS.length - n_recent + i; // 0..4 mapeado a los slots disponibles
    const w = RECENCY_WEIGHTS[weightIdx] ?? 1;
    weighted_attack += w * recent[i].attack_signal;
    weighted_defense += w * recent[i].defense_signal;
    total_weight += w;
  }

  // §9.3: promedios ponderados
  const recent_attack_delta = weighted_attack / total_weight;
  const recent_defense_delta = weighted_defense / total_weight;

  // §9.5: shrinkage hacia neutro (1.0)
  const w_form = n_recent / (n_recent + K_FORM);
  const effective_recent_attack_delta = w_form * recent_attack_delta + (1 - w_form) * 1.0;
  const effective_recent_defense_delta = w_form * recent_defense_delta + (1 - w_form) * 1.0;

  return {
    effective_recent_attack_delta,
    effective_recent_defense_delta,
    n_recent,
  };
}

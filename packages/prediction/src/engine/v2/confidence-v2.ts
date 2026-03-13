/**
 * confidence-v2.ts — Nivel de confianza V2 (§14).
 *
 * Score interno continuo [0,1] compuesto por múltiples factores:
 *   - muestra total
 *   - muestra contextual (home/away específica)
 *   - calidad del prior
 *   - cobertura de recencia
 *   - uso de ajuste por rival
 *
 * Mapeo a categorías:
 *   ≥ 0.75 → HIGH
 *   ≥ 0.50 → MEDIUM
 *   ≥ 0.25 → LOW
 *   < 0.25 → INSUFFICIENT
 *
 * Un partido puede ser ELIGIBLE pero con confidence = LOW. §14 (regla conceptual).
 *
 * Funciones puras. Sin IO.
 */

import type { V2ConfidenceLevel, PriorQuality } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convierte calidad del prior a score numérico. */
function priorQualityScore(q: PriorQuality): number {
  switch (q) {
    case 'HIGH':
      return 1.0;
    case 'MEDIUM':
      return 0.7;
    case 'LOW':
      return 0.4;
    case 'NONE':
      return 0.0;
  }
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ConfidenceInputs {
  /** Partidos totales del equipo local en la temporada actual. */
  home_pj: number;
  /** Partidos totales del equipo visitante. */
  away_pj: number;
  /** Partidos en contexto relevante (home para el local, away para el visitante). */
  home_pj_context: number;
  away_pj_context: number;
  prior_quality_home: PriorQuality;
  prior_quality_away: PriorQuality;
  /** Partidos de recencia usados (máx 5). */
  n_recent_home: number;
  n_recent_away: number;
  rival_adjustment_used: boolean;
}

// ── Implementación ────────────────────────────────────────────────────────────

/**
 * Computa el nivel de confianza a partir de múltiples factores.
 *
 * Ponderación:
 *   30% — muestra total (satura en 15 partidos)
 *   20% — muestra contextual (satura en 7)
 *   20% — calidad del prior (promedio de ambos equipos)
 *   20% — cobertura de recencia (satura en 5)
 *   10% — uso de ajuste por rival
 */
export function computeV2Confidence(inputs: ConfidenceInputs): V2ConfidenceLevel {
  const {
    home_pj,
    away_pj,
    home_pj_context,
    away_pj_context,
    prior_quality_home,
    prior_quality_away,
    n_recent_home,
    n_recent_away,
    rival_adjustment_used,
  } = inputs;

  // Factor 1: muestra total (peor de los dos equipos domina)
  const min_pj = Math.min(home_pj, away_pj);
  const sample_score = Math.min(min_pj / 15, 1.0);

  // Factor 2: muestra contextual
  const min_ctx = Math.min(home_pj_context, away_pj_context);
  const context_score = Math.min(min_ctx / 7, 1.0);

  // Factor 3: prior (promedio de ambos equipos)
  const prior_score =
    (priorQualityScore(prior_quality_home) + priorQualityScore(prior_quality_away)) / 2;

  // Factor 4: cobertura de recencia
  const min_recent = Math.min(n_recent_home, n_recent_away);
  const recency_score = Math.min(min_recent / 5, 1.0);

  // Factor 5: ajuste por rival
  const rival_score = rival_adjustment_used ? 1.0 : 0.5;

  // Agregado ponderado
  const score =
    0.3 * sample_score +
    0.2 * context_score +
    0.2 * prior_score +
    0.2 * recency_score +
    0.1 * rival_score;

  if (score >= 0.75) return 'HIGH';
  if (score >= 0.5) return 'MEDIUM';
  if (score >= 0.25) return 'LOW';
  return 'INSUFFICIENT';
}

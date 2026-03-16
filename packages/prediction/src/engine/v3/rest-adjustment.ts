/**
 * rest-adjustment.ts — Motor Predictivo V3: §T2-01 Ajuste por descanso / fatiga.
 *
 * Un equipo que jugó hace < 4 días tiene fatiga severa y rinde peor.
 * Un equipo que descansó 9–14 días está en óptimas condiciones.
 * > 14 días de descanso es neutral (el ritmo se pierde).
 *
 * El multiplicador REST_MULT_* se aplica a lambda del equipo DESPUÉS de la
 * fórmula log-lineal de §11, como un ajuste de partido independiente del modelo.
 *
 * Tabla de multiplicadores (ver constants.ts para los valores):
 *   < 4 días  → REST_MULT_SEVERE  (0.92) — fatiga severa
 *   4–5 días  → REST_MULT_MILD    (0.97) — fatiga leve
 *   6–8 días  → 1.00              — descanso normal
 *   9–14 días → REST_MULT_OPTIMAL (1.03) — condición óptima
 *   > 14 días → 1.00              — ritmo perdido, neutral
 *   null      → 1.00              — sin datos, neutral
 *
 * Función pura. Sin IO. Determinista.
 */

import type { V3MatchRecord } from './types.js';
import { MS_PER_DAY } from './constants.js';

// ── Constantes locales ────────────────────────────────────────────────────────

/** Multiplicador de fatiga severa (< 4 días). */
export const REST_MULT_SEVERE = 0.92;

/** Multiplicador de fatiga leve (4–5 días). */
export const REST_MULT_MILD = 0.97;

/** Multiplicador de descanso óptimo (9–14 días). */
export const REST_MULT_OPTIMAL = 1.03;

// ── Funciones exportadas ──────────────────────────────────────────────────────

/**
 * Calcula los días transcurridos desde el último partido jugado por un equipo
 * antes de `beforeUtc`.
 *
 * @param teamId    ID del equipo.
 * @param matches   Partidos candidatos (el filtro de kickoffUtc ya se aplica externamente).
 * @param beforeUtc Timestamp de referencia (kickoffUtc del partido a predecir).
 * @returns Días como número real, o null si no hay partidos previos.
 */
export function daysToLastMatch(
  teamId: string,
  matches: V3MatchRecord[],
  beforeUtc: string,
): number | null {
  // Partidos del equipo anteriores al kickoff
  const played = matches
    .filter(
      (m) =>
        (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
        m.utcDate < beforeUtc,
    )
    .sort((a, b) => b.utcDate.localeCompare(a.utcDate));

  if (played.length === 0) return null;

  const lastMs = new Date(played[0]!.utcDate).getTime();
  const refMs  = new Date(beforeUtc).getTime();
  return (refMs - lastMs) / MS_PER_DAY;
}

/**
 * Convierte días de descanso en un multiplicador de rendimiento.
 *
 * @param days  Días desde el último partido, o null si no hay datos.
 * @returns Multiplicador en [REST_MULT_SEVERE, REST_MULT_OPTIMAL] ⊂ [0.92, 1.03].
 */
export function restMultiplier(days: number | null): number {
  if (days === null) return 1.0;
  if (days < 4)       return REST_MULT_SEVERE;   // 0.92 — fatiga severa
  if (days < 6)       return REST_MULT_MILD;     // 0.97 — fatiga leve (4–5 días)
  if (days <= 8)      return 1.0;                // 6–8 días — normal
  if (days <= 14)     return REST_MULT_OPTIMAL;  // 9–14 días — óptimo
  return 1.0;                                    // > 14 días — ritmo perdido
}

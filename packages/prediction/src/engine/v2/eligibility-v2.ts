/**
 * eligibility-v2.ts — Elegibilidad V2 (§13).
 *
 * La elegibilidad depende del número de partidos ACTUALES del equipo,
 * no del prior. El prior solo afecta la confianza.
 *
 * Reglas (§13):
 *   NOT_ELIGIBLE: algún equipo tiene < 3 partidos, o faltan baselines de liga
 *   LIMITED:      algún equipo tiene 3–4 partidos, baselines presentes
 *   ELIGIBLE:     ambos tienen ≥ 5 partidos, baselines presentes
 *
 * Funciones puras. Sin IO.
 */

import type { V2EligibilityStatus, LeagueBaselines } from './types.js';

// ── Umbrales (§13, §15) ───────────────────────────────────────────────────────

/** Mínimo de partidos para no ser NOT_ELIGIBLE. */
export const THRESHOLD_NOT_ELIGIBLE = 3;
/** Mínimo de partidos para ser ELIGIBLE (no solo LIMITED). */
export const THRESHOLD_ELIGIBLE = 5;

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface EligibilityResult {
  status: V2EligibilityStatus;
  reason: string;
}

// ── Implementación ────────────────────────────────────────────────────────────

/**
 * Evalúa la elegibilidad del partido para el motor V2.
 *
 * @param home_pj   Partidos jugados por el equipo local en la temporada actual.
 * @param away_pj   Partidos jugados por el equipo visitante.
 * @param baselines Baselines de liga. Null o league_goals_pg ≤ 0 → NOT_ELIGIBLE.
 */
export function computeV2Eligibility(
  home_pj: number,
  away_pj: number,
  baselines: LeagueBaselines | null,
): EligibilityResult {
  // Baselines de liga obligatorios
  if (!baselines || baselines.league_goals_pg <= 0) {
    return { status: 'NOT_ELIGIBLE', reason: 'missing_league_baselines' };
  }

  // Algún equipo con < 3 partidos
  if (home_pj < THRESHOLD_NOT_ELIGIBLE || away_pj < THRESHOLD_NOT_ELIGIBLE) {
    return {
      status: 'NOT_ELIGIBLE',
      reason: `insufficient_matches: home=${home_pj}, away=${away_pj}`,
    };
  }

  // Algún equipo con 3–4 partidos → LIMITED
  if (home_pj < THRESHOLD_ELIGIBLE || away_pj < THRESHOLD_ELIGIBLE) {
    return {
      status: 'LIMITED',
      reason: `limited_matches: home=${home_pj}, away=${away_pj}`,
    };
  }

  // Ambos con ≥ 5 → ELIGIBLE
  return { status: 'ELIGIBLE', reason: 'sufficient_matches' };
}

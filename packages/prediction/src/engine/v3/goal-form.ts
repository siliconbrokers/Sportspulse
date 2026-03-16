/**
 * goal-form.ts — Motor Predictivo V3: §T2-03 Rachas de gol (Goal Scoring Form).
 *
 * Computa señales de forma ofensiva/defensiva reciente de un equipo basadas en
 * los últimos GOAL_FORM_WINDOW partidos (máx 10). Estas señales son informacionales:
 * se exponen en `explanation` para contexto y para el panel ModelContextPanel del UI,
 * pero NO modifican lambdas (para evitar doble-conteo con recency delta de §9).
 *
 * Señales:
 *   goals_scored_form    — media ponderada exponencialmente de goles anotados
 *   goals_conceded_form  — media ponderada exponencialmente de goles concedidos
 *   clean_sheet_rate     — fracción de partidos sin goles concedidos (últimos WINDOW)
 *   scoring_rate         — fracción de partidos con ≥1 gol anotado (últimos WINDOW)
 *
 * Función pura. Sin IO. Determinista.
 */

import type { V3MatchRecord } from './types.js';
import { DECAY_XI, MS_PER_DAY } from './constants.js';

// ── Constantes ────────────────────────────────────────────────────────────────

/** Número máximo de partidos en la ventana de forma. */
export const GOAL_FORM_WINDOW = 10;

// ── Tipos exportados ──────────────────────────────────────────────────────────

export interface GoalFormStats {
  /** Media de goles anotados (exponential decay, más reciente pesa más). */
  goals_scored_form: number;
  /** Media de goles concedidos (exponential decay, más reciente pesa más). */
  goals_conceded_form: number;
  /** Fracción de últimos WINDOW partidos sin goles concedidos. */
  clean_sheet_rate: number;
  /** Fracción de últimos WINDOW partidos con ≥1 gol anotado. */
  scoring_rate: number;
  /** Partidos usados para el cálculo. */
  n_matches: number;
}

// ── Implementación ────────────────────────────────────────────────────────────

/**
 * Computa las señales de forma ofensiva/defensiva de un equipo.
 *
 * @param teamId     ID del equipo.
 * @param matches    Partidos disponibles (anti-lookahead aplicado por el caller).
 * @param beforeUtc  Fecha de corte (kickoffUtc del partido a predecir).
 */
export function computeGoalForm(
  teamId: string,
  matches: V3MatchRecord[],
  beforeUtc: string,
): GoalFormStats {
  const empty: GoalFormStats = {
    goals_scored_form: 0,
    goals_conceded_form: 0,
    clean_sheet_rate: 0,
    scoring_rate: 0,
    n_matches: 0,
  };

  // Filtrar y ordenar los partidos del equipo (más recientes primero)
  const relevant = matches
    .filter(
      (m) =>
        (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
        m.utcDate < beforeUtc,
    )
    .sort((a, b) => b.utcDate.localeCompare(a.utcDate))
    .slice(0, GOAL_FORM_WINDOW);

  if (relevant.length === 0) return empty;

  // Decay anclado en el partido más reciente
  const anchorMs = new Date(relevant[0]!.utcDate).getTime();

  let weightedScored   = 0;
  let weightedConceded = 0;
  let wTotal           = 0;
  let cleanSheets      = 0;
  let scoringMatches   = 0;

  for (const m of relevant) {
    const daysAgo = (anchorMs - new Date(m.utcDate).getTime()) / MS_PER_DAY;
    const w = Math.exp(-DECAY_XI * daysAgo);

    const isHome = m.homeTeamId === teamId;
    const gs = isHome ? m.homeGoals : m.awayGoals;
    const gc = isHome ? m.awayGoals : m.homeGoals;

    weightedScored   += gs * w;
    weightedConceded += gc * w;
    wTotal           += w;

    // Tasas no-ponderadas (igual peso por partido)
    if (gc === 0) cleanSheets++;
    if (gs >= 1)  scoringMatches++;
  }

  const n = relevant.length;
  return {
    goals_scored_form:   wTotal > 0 ? weightedScored   / wTotal : 0,
    goals_conceded_form: wTotal > 0 ? weightedConceded / wTotal : 0,
    clean_sheet_rate:    cleanSheets    / n,
    scoring_rate:        scoringMatches / n,
    n_matches:           n,
  };
}

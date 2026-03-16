/**
 * h2h-adjustment.ts — Motor Predictivo V3: §T2-02 Ajuste H2H (Head-to-Head).
 *
 * Algunos cruces tienen desequilibrios sistemáticos que el modelo de fuerza
 * de equipo no captura completamente. Este módulo lee los últimos N partidos
 * directos entre homeTeamId y awayTeamId (ambas temporadas) y computa un
 * multiplicador de ajuste para cada equipo.
 *
 * Fórmula:
 *   h2h_goals_H = total de goles anotados por H en los N partidos H2H
 *   h2h_expected_H = suma de goles esperados por H en cada partido (baselines)
 *   h2h_rate = h2h_goals_H / h2h_expected_H    (1.0 = rendimiento promedio)
 *   bayesian_weight = n / (n + H2H_SHRINK)      (shrinkage de muestra pequeña)
 *   raw_mult = 1 + (h2h_rate − 1) × bayesian_weight
 *   mult = clamp(raw_mult, H2H_MULT_MIN, H2H_MULT_MAX)  → [0.92, 1.08]
 *
 * Restricciones:
 *   - Solo activo si hay ≥ H2H_MIN_MATCHES (3) partidos directos.
 *   - Máx 10 partidos H2H (H2H_MAX_MATCHES).
 *   - Ajuste máximo ±8% (H2H_MULT_MIN/MAX).
 *
 * Función pura. Sin IO. Determinista.
 */

import type { V3MatchRecord, LeagueBaselines } from './types.js';

// ── Constantes ────────────────────────────────────────────────────────────────

/** Mínimo de partidos H2H para activar el ajuste. */
export const H2H_MIN_MATCHES = 3;

/** Máximo de partidos H2H a considerar (más recientes primero). */
export const H2H_MAX_MATCHES = 10;

/** Shrinkage bayesiano: equivale a H2H_SHRINK partidos de sample "neutro". */
export const H2H_SHRINK = 8;

/** Multiplicador mínimo (máximo castigo). */
export const H2H_MULT_MIN = 0.92;

/** Multiplicador máximo (máximo beneficio). */
export const H2H_MULT_MAX = 1.08;

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface H2HAdjustmentResult {
  /** Multiplicador para lambda del equipo local en este partido. */
  mult_home: number;
  /** Multiplicador para lambda del equipo visitante en este partido. */
  mult_away: number;
  /** true si se encontraron ≥ H2H_MIN_MATCHES partidos directos. */
  applied: boolean;
  /** Número de partidos H2H encontrados (antes del slice). */
  n_matches: number;
}

// ── Implementación ────────────────────────────────────────────────────────────

/**
 * Computa el multiplicador de ajuste H2H para el partido homeTeamId vs awayTeamId.
 *
 * @param homeTeamId          Equipo local del partido a predecir.
 * @param awayTeamId          Equipo visitante del partido a predecir.
 * @param currentSeasonMatches Partidos de la temporada actual (ya filtrados anti-lookahead).
 * @param prevSeasonMatches   Partidos de la temporada anterior.
 * @param baselines           Baselines de la liga (para goles esperados).
 */
export function computeH2HAdjustment(
  homeTeamId: string,
  awayTeamId: string,
  currentSeasonMatches: V3MatchRecord[],
  prevSeasonMatches: V3MatchRecord[],
  baselines: LeagueBaselines,
): H2HAdjustmentResult {
  const neutral: H2HAdjustmentResult = { mult_home: 1.0, mult_away: 1.0, applied: false, n_matches: 0 };

  // Recopilar todos los H2H de ambas temporadas (cualquier dirección)
  const allH2H = [...currentSeasonMatches, ...prevSeasonMatches]
    .filter(
      (m) =>
        (m.homeTeamId === homeTeamId && m.awayTeamId === awayTeamId) ||
        (m.homeTeamId === awayTeamId && m.awayTeamId === homeTeamId),
    )
    .sort((a, b) => b.utcDate.localeCompare(a.utcDate)) // más recientes primero
    .slice(0, H2H_MAX_MATCHES);

  const n = allH2H.length;
  if (n < H2H_MIN_MATCHES) return { ...neutral, n_matches: n };

  // Acumular goles anotados y esperados para cada equipo
  let homeScored = 0, homeExpected = 0;
  let awayScored = 0, awayExpected = 0;

  for (const m of allH2H) {
    if (m.homeTeamId === homeTeamId) {
      // homeTeamId jugó de local
      homeScored   += m.homeGoals;
      homeExpected += baselines.league_home_goals_pg;
      awayScored   += m.awayGoals;
      awayExpected += baselines.league_away_goals_pg;
    } else {
      // homeTeamId jugó de visitante
      homeScored   += m.awayGoals;
      homeExpected += baselines.league_away_goals_pg;
      awayScored   += m.homeGoals;
      awayExpected += baselines.league_home_goals_pg;
    }
  }

  const bayesianWeight = n / (n + H2H_SHRINK);

  const multHome = clampH2H(computeMult(homeScored, homeExpected, bayesianWeight));
  const multAway = clampH2H(computeMult(awayScored, awayExpected, bayesianWeight));

  return {
    mult_home: multHome,
    mult_away: multAway,
    applied: true,
    n_matches: n,
  };
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function computeMult(scored: number, expected: number, weight: number): number {
  if (expected <= 0) return 1.0;
  const rate = scored / expected;
  return 1 + (rate - 1) * weight;
}

function clampH2H(v: number): number {
  return Math.max(H2H_MULT_MIN, Math.min(H2H_MULT_MAX, v));
}

/**
 * dc-rho-estimator.ts — Motor Predictivo V3: estimación empírica de DC_RHO por liga.
 *
 * Estima el parámetro de correlación Dixon-Coles (ρ) mediante grid search sobre
 * el log-likelihood del factor de corrección τ para scores bajos.
 *
 * Solo los partidos con score ∈ {0,1}×{0,1} contribuyen a la log-likelihood
 * del factor τ — para los demás, τ = 1, log(τ) = 0.
 *
 * Usa los baselines de liga como proxies de λ/μ para todos los partidos.
 *
 * Función pura. Sin IO. Determinista.
 */

import type { V3MatchRecord, LeagueBaselines } from './types.js';
import { DC_RHO } from './constants.js';

// ── Grid search parameters ────────────────────────────────────────────────

const GRID_MIN  = -0.25;
const GRID_MAX  =  0.00;
const GRID_STEP =  0.01;   // 26 puntos: -0.25, -0.24, ..., 0.00

/** Mínimo de partidos terminados en la liga para intentar estimar ρ. */
const MIN_MATCHES_FOR_DC_ESTIMATION = 20;

const LOG_EPSILON = 1e-10;

// ── Inline tau factor (sin importar dixon-coles para evitar dependencia cruzada) ─

/**
 * Factor τ Dixon-Coles para score (h, a) con lambdas (lh, la) y parámetro rho.
 * τ = 1 para scores fuera de {0,1}×{0,1}.
 */
function tauFactor(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// ── Estimator ─────────────────────────────────────────────────────────────

/**
 * Estima el ρ óptimo de Dixon-Coles para una liga mediante grid search.
 *
 * Maximiza: L(ρ) = Σ_{(h,a) ∈ {0,1}²} log(τ(h, a, λ, μ, ρ))
 * usando league_home_goals_pg / league_away_goals_pg como λ/μ.
 *
 * Con ρ < 0:
 *  - τ(0,0) > 1 → aumenta probabilidad de 0-0
 *  - τ(1,1) > 1 → aumenta probabilidad de 1-1
 *  - τ(0,1) < 1 → reduce probabilidad de 0-1
 *  - τ(1,0) < 1 → reduce probabilidad de 1-0
 *
 * Ligas con más 0-0 y 1-1 de lo esperado (vs Poisson independiente) → ρ más negativo.
 * Ligas sin patrón especial en scores bajos → ρ cerca de 0.
 *
 * @param matches   Partidos FINISHED de la temporada (temporada actual o anterior)
 * @param baselines Baselines de la liga (para λ/μ proxies)
 * @returns ρ estimado en [GRID_MIN, 0], o DC_RHO si hay < MIN_MATCHES_FOR_DC_ESTIMATION
 */
export function estimateDcRho(
  matches: readonly V3MatchRecord[],
  baselines: LeagueBaselines,
): number {
  if (matches.length < MIN_MATCHES_FOR_DC_ESTIMATION) {
    return DC_RHO;
  }

  // Solo los partidos con score bajo contribuyen al likelihood de τ
  const lowScoreMatches = matches.filter(
    (m) => m.homeGoals <= 1 && m.awayGoals <= 1,
  );

  if (lowScoreMatches.length === 0) {
    return DC_RHO;
  }

  const lh = baselines.league_home_goals_pg;
  const la = baselines.league_away_goals_pg;

  let bestRho = DC_RHO;
  let bestLogL = -Infinity;

  for (let step = 0; step <= Math.round((GRID_MAX - GRID_MIN) / GRID_STEP); step++) {
    // Usar aritmética de enteros para evitar drift de punto flotante
    const rho = Math.round((GRID_MIN + step * GRID_STEP) * 100) / 100;

    let logL = 0;
    let valid = true;

    for (const m of lowScoreMatches) {
      const tau = tauFactor(m.homeGoals, m.awayGoals, lh, la, rho);
      if (tau <= 0) {
        // ρ inválido para estos datos — descartar este punto del grid
        valid = false;
        break;
      }
      logL += Math.log(Math.max(tau, LOG_EPSILON));
    }

    if (valid && logL > bestLogL) {
      bestLogL = logL;
      bestRho = rho;
    }
  }

  return bestRho;
}

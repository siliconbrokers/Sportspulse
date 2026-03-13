/**
 * shrinkage.ts — Shrinkage dinámico de tres niveles (§7).
 *
 * Lógica: contexto → total → prior → baseline de liga
 *
 * Funciones puras. Sin IO.
 */

import type { TeamStats, ObservedRates, TeamPrior } from './types.js';

// ── Constantes (§7.1) ─────────────────────────────────────────────────────────

/** Parámetro de shrinkage para muestra total. §7.1 */
export const K_TOTAL = 5;
/** Parámetro de shrinkage para muestra local. §7.1 */
export const K_HOME = 4;
/** Parámetro de shrinkage para muestra visitante. §7.1 */
export const K_AWAY = 4;

// ── Pesos dinámicos ───────────────────────────────────────────────────────────

export interface ShrinkageWeights {
  w_total: number;
  w_home: number;
  w_away: number;
}

/**
 * Computa pesos dinámicos por tamaño de muestra. §7.1
 *   w = n / (n + K)  →  con n=0 es 0, saturando hacia 1 al crecer n.
 */
export function computeShrinkageWeights(stats: TeamStats): ShrinkageWeights {
  return {
    w_total: stats.pj_total / (stats.pj_total + K_TOTAL),
    w_home: stats.pj_home / (stats.pj_home + K_HOME),
    w_away: stats.pj_away / (stats.pj_away + K_AWAY),
  };
}

// ── Tasas efectivas ───────────────────────────────────────────────────────────

export interface EffectiveSingleRates {
  effective_attack: number;
  effective_defense: number;
}

/**
 * Computa tasas efectivas de ataque y defensa mediante shrinkage de tres niveles.
 *
 * Para el EQUIPO LOCAL (isHome = true), se usan los índices home:
 *   obs_attack  = w_home * gf_pg_home + (1 - w_home) * gf_pg_total   §7.2
 *   eff_attack  = w_total * obs_attack + (1 - w_total) * prior_home   §7.2
 *   obs_defense = w_home * gc_pg_home + (1 - w_home) * gc_pg_total   §7.3
 *   eff_defense = w_total * obs_defense + (1 - w_total) * prior_home  §7.3
 *
 * Para el EQUIPO VISITANTE (isHome = false) se usan los índices away.
 *
 * @param stats    Stats del equipo en la temporada actual.
 * @param rates    Tasas observadas brutas del equipo.
 * @param prior    Prior estructural del equipo.
 * @param isHome   true = el equipo juega como local en el partido objetivo.
 */
export function computeEffectiveRates(
  stats: TeamStats,
  rates: ObservedRates,
  prior: TeamPrior,
  isHome: boolean,
): EffectiveSingleRates {
  const { w_total, w_home, w_away } = computeShrinkageWeights(stats);

  if (isHome) {
    // §7.2: ataque local
    const obs_attack = w_home * rates.gf_pg_home + (1 - w_home) * rates.gf_pg_total;
    const eff_attack = w_total * obs_attack + (1 - w_total) * prior.attack_prior_home;
    // §7.3: defensa local
    const obs_defense = w_home * rates.gc_pg_home + (1 - w_home) * rates.gc_pg_total;
    const eff_defense = w_total * obs_defense + (1 - w_total) * prior.defense_prior_home;
    return { effective_attack: eff_attack, effective_defense: eff_defense };
  } else {
    // §7.2: ataque visitante
    const obs_attack = w_away * rates.gf_pg_away + (1 - w_away) * rates.gf_pg_total;
    const eff_attack = w_total * obs_attack + (1 - w_total) * prior.attack_prior_away;
    // §7.3: defensa visitante
    const obs_defense = w_away * rates.gc_pg_away + (1 - w_away) * rates.gc_pg_total;
    const eff_defense = w_total * obs_defense + (1 - w_total) * prior.defense_prior_away;
    return { effective_attack: eff_attack, effective_defense: eff_defense };
  }
}

/**
 * prior-builder.ts — Prior estructural del club (§6).
 *
 * Construye el prior para un equipo usando la temporada anterior.
 * Degrada graciosamente cuando no hay historia útil (§6.4, §6.8).
 *
 * Funciones puras. Sin IO.
 */

import type { V2MatchRecord, TeamPrior, LeagueBaselines, PriorQuality } from './types.js';
import { computeTeamStats, computeObservedRates } from './stats-builder.js';

// ── Constantes (§6.6, §6.7) ───────────────────────────────────────────────────

/** §6.6: peso de la temporada anterior al mezclar con baseline de liga. */
export const ALPHA_PREV = 0.7;

/** §6.7: peso del prior de división inferior al mezclar con baseline top. */
export const D_PROMOTED = 0.4;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mezcla un valor con un baseline usando un peso alpha. */
function mix(value: number, baseline: number, alpha: number): number {
  return alpha * value + (1 - alpha) * baseline;
}

/**
 * Clasifica la calidad del prior según la muestra de partidos previos.
 *
 * Umbrales conservadores:
 *   ≥ 20 matches → HIGH (≈ mitad de temporada o más)
 *   10–19        → MEDIUM
 *   1–9          → LOW
 *   0            → NONE
 */
function classifyPriorQuality(pj: number): PriorQuality {
  if (pj >= 20) return 'HIGH';
  if (pj >= 10) return 'MEDIUM';
  if (pj > 0) return 'LOW';
  return 'NONE';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Construye el prior estructural para un equipo a partir de los partidos
 * de la temporada anterior.
 *
 * §6.4: La ausencia de temporada anterior NO invalida el modelo.
 *        Solo degrada el prior y baja la confianza.
 *
 * §6.5: Si hay datos previos, mezcla con baseline usando alpha_prev.
 * §6.8: Si no hay datos, usa baselines de liga directamente (prior_quality = NONE).
 *
 * Mezclas de contexto (§6.5):
 *   attack_prior_home  ↔ league_home_goals_pg  (ataque en casa vs lo esperado en casa)
 *   defense_prior_home ↔ league_away_goals_pg   (concedidos como local vs promedio visitante)
 *   attack_prior_away  ↔ league_away_goals_pg
 *   defense_prior_away ↔ league_home_goals_pg
 *
 * @param prevSeasonMatches  Partidos terminados de la temporada anterior.
 * @param teamId             Equipo para el que se construye el prior.
 * @param leagueBaselines    Baselines de la liga actual.
 */
export function buildTeamPrior(
  prevSeasonMatches: V2MatchRecord[],
  teamId: string,
  leagueBaselines: LeagueBaselines,
): TeamPrior {
  const { league_home_goals_pg, league_away_goals_pg, league_goals_pg } = leagueBaselines;

  // §6.8: sin datos previos → usar baseline de liga
  if (prevSeasonMatches.length === 0) {
    return {
      attack_prior_total: league_goals_pg,
      defense_prior_total: league_goals_pg,
      attack_prior_home: league_home_goals_pg,
      defense_prior_home: league_away_goals_pg,
      attack_prior_away: league_away_goals_pg,
      defense_prior_away: league_home_goals_pg,
      prior_quality: 'NONE',
      prior_source: 'LEAGUE_BASELINE',
    };
  }

  const stats = computeTeamStats(prevSeasonMatches, teamId);

  // §6.7: equipo ascendido — no jugó en la temporada anterior de ESTA competición,
  // pero la competición sí tenía datos de otros equipos → llegó de división inferior.
  // Aplicar d_promoted: prior_promoted = d_promoted * lower_div_prior + (1 - d_promoted) * league_baseline.
  // Sin acceso a datos reales de la división inferior, lower_div_prior = league_baseline
  // (conservador y honesto: no inventamos jerarquía). El código ejecuta d_promoted realmente.
  if (stats.pj_total === 0) {
    // lower_div_prior y league_baseline son ambos league_baseline (única fuente disponible)
    const attack_prior_total = D_PROMOTED * league_goals_pg + (1 - D_PROMOTED) * league_goals_pg;
    const defense_prior_total = D_PROMOTED * league_goals_pg + (1 - D_PROMOTED) * league_goals_pg;
    const attack_prior_home =
      D_PROMOTED * league_home_goals_pg + (1 - D_PROMOTED) * league_home_goals_pg;
    const defense_prior_home =
      D_PROMOTED * league_away_goals_pg + (1 - D_PROMOTED) * league_away_goals_pg;
    const attack_prior_away =
      D_PROMOTED * league_away_goals_pg + (1 - D_PROMOTED) * league_away_goals_pg;
    const defense_prior_away =
      D_PROMOTED * league_home_goals_pg + (1 - D_PROMOTED) * league_home_goals_pg;
    return {
      attack_prior_total,
      defense_prior_total,
      attack_prior_home,
      defense_prior_home,
      attack_prior_away,
      defense_prior_away,
      prior_quality: 'NONE',
      prior_source: 'LOWER_DIVISION',
    };
  }

  const rates = computeObservedRates(stats);
  const quality = classifyPriorQuality(stats.pj_total);

  // §6.3: prior_source depende de cuántos partidos previos hay.
  // LOW (1-9 partidos) → PARTIAL: datos escasos, mezcla incierta.
  // MEDIUM/HIGH (≥10) → PREV_SEASON: temporada previa representativa.
  const source = quality === 'LOW' ? 'PARTIAL' : 'PREV_SEASON';

  // §6.5: mezclas principales (total con league_goals_pg)
  const attack_prior_total = mix(rates.gf_pg_total, league_goals_pg, ALPHA_PREV);
  const defense_prior_total = mix(rates.gc_pg_total, league_goals_pg, ALPHA_PREV);

  // Contexto HOME: mezcla contra baseline contextual correcto
  // Si el equipo jugó como local en la temporada anterior, usar esas tasas.
  // Si no, caer al total mezclado con el baseline contextual.
  const attack_prior_home =
    stats.pj_home > 0
      ? mix(rates.gf_pg_home, league_home_goals_pg, ALPHA_PREV)
      : mix(attack_prior_total, league_home_goals_pg, 0.5);

  const defense_prior_home =
    stats.pj_home > 0
      ? mix(rates.gc_pg_home, league_away_goals_pg, ALPHA_PREV)
      : mix(defense_prior_total, league_away_goals_pg, 0.5);

  // Contexto AWAY
  const attack_prior_away =
    stats.pj_away > 0
      ? mix(rates.gf_pg_away, league_away_goals_pg, ALPHA_PREV)
      : mix(attack_prior_total, league_away_goals_pg, 0.5);

  const defense_prior_away =
    stats.pj_away > 0
      ? mix(rates.gc_pg_away, league_home_goals_pg, ALPHA_PREV)
      : mix(defense_prior_total, league_home_goals_pg, 0.5);

  return {
    attack_prior_total,
    defense_prior_total,
    attack_prior_home,
    defense_prior_home,
    attack_prior_away,
    defense_prior_away,
    prior_quality: quality,
    prior_source: source,
  };
}

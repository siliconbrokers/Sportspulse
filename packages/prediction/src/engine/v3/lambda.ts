/**
 * lambda.ts — Motor Predictivo V3: §10 Effective Forces + §11 Lambda Computation.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §10, §11
 *
 * Función pura. Sin IO. Determinista.
 */

import {
  BETA_ATTACK,
  BETA_DEFENSE,
  BETA_RECENT,
  LAMBDA_MIN,
  LAMBDA_MAX,
} from './constants.js';

/** Clamp para el multiplicador de home advantage derivado de baselines.
 * Reducido de 1.5 a 1.3: calibración isotónica sobre 977 matches 2024-25 muestra que
 * el modelo sobreestima p_home en ~8pp y p_draw en ~6pp, mientras subestima p_away en ~7pp.
 * El cap anterior (1.5) permitía ratios demasiado agresivos para ligas como PL (~1.42).
 */
const HOME_ADV_MIN = 1.0;
const HOME_ADV_MAX = 1.3;
import type { LeagueBaselines } from './types.js';

export interface V3LambdaInputs {
  effective_attack_home: number;
  effective_defense_home: number;
  effective_attack_away: number;
  effective_defense_away: number;
  delta_attack_home: number;
  delta_defense_home: number;
  delta_attack_away: number;
  delta_defense_away: number;
  venue_split_home: boolean;
  venue_split_away: boolean;
  baselines: LeagueBaselines;
  betaRecentOverride?: number;
}

export interface V3LambdaResult {
  lambda_home: number;
  lambda_away: number;
  home_advantage_applied: boolean;
  /** Effective forces post home-advantage adjustment */
  eff_attack_home_final: number;
  eff_defense_home_final: number;
  eff_attack_away_final: number;
  eff_defense_away_final: number;
}

/**
 * Aplica recency deltas a las effective forces (§10).
 *
 * effective_attack_home_final  = effective_attack_home  × delta_attack_home
 * effective_defense_home_final = effective_defense_home × delta_defense_home
 * etc.
 *
 * Home advantage: si venueSplit = true para AMBOS equipos, las stats ya incorporan el
 * venue effect — NO se aplica multiplicador adicional.
 * Si venueSplit = false para alguno, aplicar HOME_ADVANTAGE_MULT.
 */
export function computeV3Lambdas(inputs: V3LambdaInputs): V3LambdaResult {
  const {
    effective_attack_home,
    effective_defense_home,
    effective_attack_away,
    effective_defense_away,
    delta_attack_home,
    delta_defense_home,
    delta_attack_away,
    delta_defense_away,
    venue_split_home,
    venue_split_away,
    baselines,
    betaRecentOverride,
  } = inputs;
  const betaRecent = betaRecentOverride ?? BETA_RECENT;

  // §10: Home advantage — solo cuando venue split no disponible para alguno.
  // El multiplicador se deriva del ratio real de la liga (league_home/league_away)
  // en vez de un valor fijo. Captura diferencias reales entre ligas (URU ~1.26, BL1 ~1.08).
  // Los deltas NO se aplican aquí — solo en §11 con exponent BETA_RECENT.
  let eff_attack_home  = effective_attack_home;
  let eff_defense_home = effective_defense_home;
  let eff_attack_away  = effective_attack_away;
  let eff_defense_away = effective_defense_away;

  const applyHomeAdvantage = !(venue_split_home && venue_split_away);
  if (applyHomeAdvantage) {
    const rawRatio = baselines.league_away_goals_pg > 0
      ? baselines.league_home_goals_pg / baselines.league_away_goals_pg
      : 1.12; // fallback defensivo ante división por cero
    const homeAdvMult = Math.max(HOME_ADV_MIN, Math.min(HOME_ADV_MAX, rawRatio));
    eff_attack_home  *= homeAdvMult;
    eff_defense_away *= homeAdvMult;
  }

  const { league_home_goals_pg, league_away_goals_pg, league_goals_pg } = baselines;

  // §11: Fórmula log-lineal multiplicativa
  // lambda_home = league_home_goals_pg
  //             × (eff_attack_home  / league_goals_pg) ^ BETA_ATTACK
  //             × (eff_defense_away / league_goals_pg) ^ BETA_DEFENSE
  //             × delta_attack_home  ^ BETA_RECENT
  //             × delta_defense_away ^ BETA_RECENT
  //
  // Los deltas aparecen SOLO aquí con exponente BETA_RECENT=0.45.
  // No se aplican a eff_* antes de este punto (bug de doble-conteo corregido).

  const safeDiv = (n: number, d: number): number => (d > 0 ? n / d : 1.0);

  const rawLambdaHome =
    league_home_goals_pg *
    Math.pow(safeDiv(eff_attack_home, league_goals_pg), BETA_ATTACK) *
    Math.pow(safeDiv(eff_defense_away, league_goals_pg), BETA_DEFENSE) *
    Math.pow(delta_attack_home, betaRecent) *
    Math.pow(delta_defense_away, betaRecent);

  const rawLambdaAway =
    league_away_goals_pg *
    Math.pow(safeDiv(eff_attack_away, league_goals_pg), BETA_ATTACK) *
    Math.pow(safeDiv(eff_defense_home, league_goals_pg), BETA_DEFENSE) *
    Math.pow(delta_attack_away, betaRecent) *
    Math.pow(delta_defense_home, betaRecent);

  // §11: Clip de seguridad
  const lambda_home = Math.max(LAMBDA_MIN, Math.min(LAMBDA_MAX, rawLambdaHome));
  const lambda_away = Math.max(LAMBDA_MIN, Math.min(LAMBDA_MAX, rawLambdaAway));

  return {
    lambda_home,
    lambda_away,
    home_advantage_applied: applyHomeAdvantage,
    eff_attack_home_final: eff_attack_home,
    eff_defense_home_final: eff_defense_home,
    eff_attack_away_final: eff_attack_away,
    eff_defense_away_final: eff_defense_away,
  };
}

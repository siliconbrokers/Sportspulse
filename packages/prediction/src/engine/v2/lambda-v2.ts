/**
 * lambda-v2.ts — Formulación multiplicativa de lambdas V2 (§11).
 *
 * Fórmula log-lineal coherente con escala log. Sin Elo.
 * Asimetría home/away es inherente al modelo (baselines distintos).
 *
 * Funciones puras. Sin IO.
 */

// ── Parámetros (§11.2) ────────────────────────────────────────────────────────

/** Beta de ataque base. §11.2 */
export const BETA_ATTACK = 1.0;
/** Beta de defensa base. §11.2 */
export const BETA_DEFENSE = 1.0;
/** Beta de recencia ofensiva. §11.2 */
export const BETA_RECENT_ATTACK = 0.35;
/** Beta de recencia defensiva. §11.2 */
export const BETA_RECENT_DEFENSE = 0.35;

// ── Guardrail (§11.3) ─────────────────────────────────────────────────────────

/** Lambda mínima tras clamp. §11.3 */
export const LAMBDA_MIN = 0.15;
/** Lambda máxima tras clamp. §11.3 */
export const LAMBDA_MAX = 3.5;

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface V2LambdaParams {
  league_home_goals_pg: number;
  league_away_goals_pg: number;
  effective_attack_home: number;
  effective_defense_home: number;
  effective_attack_away: number;
  effective_defense_away: number;
  effective_recent_attack_delta_home: number;
  effective_recent_defense_delta_home: number;
  effective_recent_attack_delta_away: number;
  effective_recent_defense_delta_away: number;
}

export interface V2LambdaResult {
  lambda_home: number;
  lambda_away: number;
  /** true si alguna lambda fue modificada por el clamp. §11.3 */
  clamped: boolean;
  raw_lambda_home: number;
  raw_lambda_away: number;
}

// ── Implementación ────────────────────────────────────────────────────────────

/**
 * Computa lambda_home y lambda_away según §11.1:
 *
 *   lambda_home =
 *     league_home_pg
 *     × (effective_attack_home  / league_home_pg)  ^ beta_attack
 *     × (effective_defense_away / league_home_pg)  ^ beta_defense
 *     × effective_recent_attack_delta_home         ^ beta_recent_attack
 *     × effective_recent_defense_delta_away        ^ beta_recent_defense
 *
 *   lambda_away =
 *     league_away_pg
 *     × (effective_attack_away  / league_away_pg)  ^ beta_attack
 *     × (effective_defense_home / league_away_pg)  ^ beta_defense
 *     × effective_recent_attack_delta_away         ^ beta_recent_attack
 *     × effective_recent_defense_delta_home        ^ beta_recent_defense
 *
 * Todos los factores se elevan con Math.pow sobre valores positivos.
 * Floor mínimo de 0.001 para evitar Math.pow(0, negativo).
 */
export function computeV2Lambdas(params: V2LambdaParams): V2LambdaResult {
  const {
    league_home_goals_pg,
    league_away_goals_pg,
    effective_attack_home,
    effective_defense_home,
    effective_attack_away,
    effective_defense_away,
    effective_recent_attack_delta_home,
    effective_recent_defense_delta_home,
    effective_recent_attack_delta_away,
    effective_recent_defense_delta_away,
  } = params;

  // Floor para divisiones y Math.pow
  const safe = (v: number) => Math.max(v, 0.001);

  const raw_lambda_home =
    safe(league_home_goals_pg) *
    Math.pow(safe(effective_attack_home) / safe(league_home_goals_pg), BETA_ATTACK) *
    Math.pow(safe(effective_defense_away) / safe(league_home_goals_pg), BETA_DEFENSE) *
    Math.pow(safe(effective_recent_attack_delta_home), BETA_RECENT_ATTACK) *
    Math.pow(safe(effective_recent_defense_delta_away), BETA_RECENT_DEFENSE);

  const raw_lambda_away =
    safe(league_away_goals_pg) *
    Math.pow(safe(effective_attack_away) / safe(league_away_goals_pg), BETA_ATTACK) *
    Math.pow(safe(effective_defense_home) / safe(league_away_goals_pg), BETA_DEFENSE) *
    Math.pow(safe(effective_recent_attack_delta_away), BETA_RECENT_ATTACK) *
    Math.pow(safe(effective_recent_defense_delta_home), BETA_RECENT_DEFENSE);

  // §11.3: clamp final
  const lambda_home = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, raw_lambda_home));
  const lambda_away = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, raw_lambda_away));

  const clamped = raw_lambda_home !== lambda_home || raw_lambda_away !== lambda_away;

  return { lambda_home, lambda_away, clamped, raw_lambda_home, raw_lambda_away };
}

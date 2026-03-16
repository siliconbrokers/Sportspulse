/**
 * constants.ts — Motor Predictivo V3: constantes del spec.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §19
 *
 * Todas las constantes son export const para que los tests puedan verificar sus valores.
 */

/** Exponential decay per day. half-life ≈ 115 días (§5, §19). */
export const DECAY_XI = 0.006;

/** Mínimo de partidos en un venue específico para usar las stats de ese venue (§5, §19). */
export const MIN_GAMES_VENUE = 5;

/** Mínimo de partidos terminados para computar baseline de liga desde datos (§4, §19). */
export const MIN_GAMES_FOR_BASELINE = 10;

/** Mínimo de partidos totales para aplicar recency delta (§9, §19). */
export const MIN_GAMES_FOR_RECENCY = 10;

/**
 * Fuerza del prior de liga en shrinkage bayesiano — equivale a K partidos (§6, §19).
 * Reducido de 5 a 3 para aliviar doble-regularización con PRIOR_EQUIV_GAMES=8.
 * Con K=5 + PRIOR_EQUIV_GAMES=8, los datos observados pesaban solo ~19% a jornada 5.
 * Con K=3, pesan ~24% a jornada 5 y los equipos se diferencian ~3 jornadas antes.
 */
export const K_SHRINK = 3;

/** El prior de temporada anterior pesa como PRIOR_EQUIV_GAMES partidos (§7, §19). */
export const PRIOR_EQUIV_GAMES = 8;

/**
 * Referencia histórica del multiplicador de home advantage (§10, §19).
 * En producción, lambda.ts deriva el multiplicador del ratio real de la liga
 * (league_home_goals_pg / league_away_goals_pg), que es más preciso por liga.
 * Este valor se mantiene como fallback defensivo ante división por cero.
 */
export const HOME_ADVANTAGE_MULT = 1.12;

/** Baseline de goles locales por partido cuando hay < MIN_GAMES_FOR_BASELINE (§4, §19). */
export const HOME_GOALS_FALLBACK = 1.45;

/** Baseline de goles visitantes por partido cuando hay < MIN_GAMES_FOR_BASELINE (§4, §19). */
export const AWAY_GOALS_FALLBACK = 1.15;

/** Parámetro de correlación Dixon-Coles para scores bajos (§12, §19). */
export const DC_RHO = -0.13;

/** Ventana de partidos recientes para recency delta (§9, §19). */
export const N_RECENT = 5;

/** Elasticidad de ataque en la fórmula log-lineal de lambdas (§11, §19). */
export const BETA_ATTACK = 1.0;

/** Elasticidad de defensa en la fórmula log-lineal de lambdas (§11, §19). */
export const BETA_DEFENSE = 1.0;

/** Elasticidad de recency en la fórmula log-lineal de lambdas (§11, §19). */
export const BETA_RECENT = 0.45;

/** Clip mínimo de lambda (§11, §19). */
export const LAMBDA_MIN = 0.3;

/** Clip máximo de lambda (§11, §19). */
export const LAMBDA_MAX = 4.0;

/** Tamaño máximo de la grilla Poisson (0..MAX_GOALS) (§13, §19). */
export const MAX_GOALS = 7;

/** Umbral de masa de cola para warning TAIL_MASS_EXCEEDED (§13, §19). */
export const MAX_TAIL_MASS = 0.02;

/** Mínimo de partidos (del equipo con menos datos) para producir probabilidades (§14, §19). */
export const THRESHOLD_NOT_ELIGIBLE = 3;

/** Mínimo de partidos para confianza plena ELIGIBLE (§14, §19). */
export const THRESHOLD_ELIGIBLE = 7;

/** Margen mínimo entre max y second para declarar un ganador (§18, §19). */
export const TOO_CLOSE_THRESHOLD = 0.05;

/** Milisegundos por día (constante auxiliar para cálculo de decay). */
export const MS_PER_DAY = 86_400_000;

/** Mínimo de partidos del equipo en prevSeason para calidad PREV_SEASON (§7). */
export const PREV_SEASON_MIN_GAMES = 15;

/** Mínimo de partidos del equipo en prevSeason para calidad PARTIAL (§7). */
export const PARTIAL_MIN_GAMES = 5;

/** Mínimo de partidos del rival para considerar rival_adjustment disponible (§8). */
export const RA_MIN_RIVAL_GAMES = 3;

/** Clip inferior para recency delta (§9). */
export const RECENCY_DELTA_MIN = 0.5;

/** Clip superior para recency delta (§9). */
export const RECENCY_DELTA_MAX = 2.0;

// ── T3 Constants (§MKT-T3-00) ─────────────────────────────────────────────

/** Coverage threshold below which XG_PARTIAL_COVERAGE warning fires (§T3-01). */
export const XG_PARTIAL_COVERAGE_THRESHOLD = 0.5;

/** Lambda reduction per unit of weighted absence score (§T3-02). */
export const ABSENCE_IMPACT_FACTOR = 0.04;

/** Maximum lambda penalty from absences — mult floor (§T3-02). */
export const ABSENCE_MULT_MIN = 0.85;

/** Default importance for a regular starter detected missing only via lineup diff (§T3-03). */
export const LINEUP_MISSING_STARTER_IMPORTANCE = 0.4;

/** Weight factor for DOUBTFUL players vs 1.0 for confirmed absent (§T3-02). */
export const DOUBTFUL_WEIGHT = 0.5;

/** Weight of market odds in the 1X2 blend — 0 = pure model, 1 = pure market (§T3-04). */
export const MARKET_WEIGHT = 0.15;

/** Hard ceiling for market weight — safety (§T3-04). */
export const MARKET_WEIGHT_MAX = 0.30;

/** Tolerance for market odds sum validation (§T3-04). */
export const MARKET_ODDS_SUM_TOLERANCE = 1e-4;

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
 * Optimizado K=3→4 vía backtest walk-forward 2025-26 (PD+PL+BL1, 806 partidos).
 * K=4 con PRIOR_EQUIV_GAMES=12 mejora accuracy total +1.4pp vs config original.
 */
export const K_SHRINK = 4;

/**
 * El prior de temporada anterior pesa como PRIOR_EQUIV_GAMES partidos (§7, §19).
 * Optimizado 8→12 vía backtest walk-forward 2025-26.
 * Más peso al prior estabiliza predicciones: LaLiga +3pp, BL1 +2pp.
 */
export const PRIOR_EQUIV_GAMES = 12;

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

/**
 * Elasticidad de recency en la fórmula log-lineal de lambdas (§11, §19).
 * Optimizado 0.45→0.15 vía backtest walk-forward 2025-26.
 * Menos peso de recency reduce ruido y mejora accuracy +1.3pp en todas las ligas.
 */
export const BETA_RECENT = 0.15;

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

/**
 * Margen mínimo de favorite_margin para mantener confianza HIGH.
 * Si la diferencia entre la probabilidad ganadora y la segunda es < este umbral,
 * se degrada HIGH → MEDIUM para reflejar incertidumbre real del partido.
 * Backtest evidence: partidos con margin < 0.12 etiquetados HIGH tienen accuracy
 * 5-10pp menor que LOW confidence en PL — el label es engañoso.
 */
export const MARGIN_FOR_HIGH_CONFIDENCE = 0.12;

// ── Draw Affinity (§DRAW-AFFINITY) ────────────────────────────────────────────

/**
 * Intensidad del boost de probabilidad de empate basado en balance de fuerzas.
 *
 * El modelo Poisson subestima empates estructuralmente cuando hay home advantage
 * (las distribuciones se separan). Este boost compensa ese sesgo.
 *
 * La señal combinada es:
 *   balance_component = (min(λ)/max(λ))^POWER
 *   low_scoring_component = max(0, (THRESHOLD - avg_λ) / (THRESHOLD - 0.5))
 *   draw_mult = 1 + ALPHA × (balance_component + LOW_SCORING_BETA × low_scoring_component)
 *
 * Con alpha=0.70, power=2, low_beta=0.5:
 *   λh=0.9, λa=0.8 (muy bajo, equilibrado):  draw_mult ≈ 1.80 → p_draw +80%
 *   λh=1.3, λa=1.2 (moderado, equilibrado):  draw_mult ≈ 1.74
 *   λh=1.6, λa=1.5 (alto, equilibrado):      draw_mult ≈ 1.66
 *   λh=1.8, λa=1.0 (imbalanced):             draw_mult ≈ 1.22
 *
 * Optimizado 0.45→0.70 vía backtest walk-forward 2025-26 (PD+PL+BL1, 806 partidos).
 * Mayor ALPHA compensa las señales débiles de early-season (propensity/H2H/table
 * tienen pocas jornadas disponibles); el balance ratio + low-scoring trabajan solos.
 */
export const DRAW_AFFINITY_ALPHA = 0.70;

/**
 * Exponente para el boost de draw affinity.
 * Power=2 → cuadrático: el boost es fuerte solo cuando los equipos son muy parejos.
 * Evita boostar demasiado partidos con diferencia de fuerzas real.
 */
export const DRAW_AFFINITY_POWER = 2.0;

/**
 * Bonus adicional al boost cuando el partido es de bajo marcador esperado.
 * avg_λ < DRAW_LOW_SCORING_THRESHOLD → partidos donde 0-0 y 1-1 dominan.
 * Factor multiplicativo sobre el componente de balance.
 */
export const DRAW_LOW_SCORING_BETA = 0.50;

/**
 * Umbral de lambda promedio por debajo del cual se considera partido de bajo marcador.
 * avg_λ < THRESHOLD → aplica bonus de low-scoring draw.
 * Basado en la media de goles esperados: partidos <1.6 avg goles = propensos a empate.
 */
export const DRAW_LOW_SCORING_THRESHOLD = 1.6;

/**
 * Peso del factor de propensidad histórica de empate en la señal combinada.
 * La propensidad se normaliza contra DRAW_LEAGUE_AVG_RATE para que teams con
 * alta tasa de empate amplifiquen el boost y los demás no lo reduzcan.
 */
export const DRAW_PROPENSITY_WEIGHT = 1.0; // Multiplicativo sobre draw_signal (ya embebido en la fórmula)

/**
 * Tasa promedio de empate en una liga de fútbol de primer nivel.
 * Usada para normalizar la propensidad de cada equipo.
 * Valor típico: 25-27% en Europa top-5.
 */
export const DRAW_LEAGUE_AVG_RATE = 0.25;

// ── Draw Floor Rule (decision policy) ────────────────────────────────────────

/**
 * Umbral mínimo de p_draw para activar la regla de piso de empate.
 * Si p_draw >= DRAW_FLOOR y max(p_home, p_away) - p_draw <= DRAW_MARGIN,
 * se predice DRAW aunque no sea el argmax estricto.
 *
 * Captura partidos equilibrados donde el modelo sabe que hay alta incertidumbre
 * pero el argmax siempre elegiría HOME_WIN por el home advantage estructural.
 *
 * FLOOR=0.34 calibrado vía backtest walk-forward 2025-26 (PD+PL+BL1, 806 partidos).
 * p_draw >= 0.34 tiene draw rate real ≈31-33% (encima del base rate ~26%).
 */
export const DRAW_FLOOR = 0.34;

/**
 * Margen máximo entre el líder y p_draw para activar la regla de piso.
 * Si max(p_home, p_away) - p_draw <= DRAW_MARGIN → predecir DRAW.
 * MARGIN=0.12: captura partidos donde p_home ≤ 0.46 con p_draw = 0.34.
 * Resultado final: DRAW recall = 40.1%, accuracy global = 48.6%, DRAW precision ≈ 32.5%.
 * Calibrado vía backtest walk-forward 2025-26 (PD+PL+BL1, 806 partidos).
 */
export const DRAW_MARGIN = 0.12;

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
 * Optimizado K=4→3 vía hyperparameter sweep 2025-26 (PD+PL+BL1, ~580 partidos).
 * K=3 con PRIOR_EQUIV_GAMES=16 mejora score compuesto +0.028 vs config anterior.
 */
export const K_SHRINK = 3;

/**
 * El prior de temporada anterior pesa como PRIOR_EQUIV_GAMES partidos (§7, §19).
 * Optimizado 12→16 vía hyperparameter sweep 2025-26.
 * Más prior estabiliza varianza en temporada temprana: DRAW recall +4.2pp.
 */
export const PRIOR_EQUIV_GAMES = 16;

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

/**
 * Parámetro de correlación Dixon-Coles para scores bajos (§12, §19).
 * Optimizado -0.13→-0.15 vía DC_RHO sweep 2025-26 (K=3/PEG=16/β=0.20).
 * RHO=-0.15 fijo supera al estimador empírico: DR +4.5pp, DP +1.5pp, acc +0.3pp.
 * El estimador empírico (estimateDcRho) converge a valores sub-óptimos porque
 * usa lambdas promedio de liga en vez de lambdas per-partido.
 */
export const DC_RHO = -0.15;

/**
 * Rho óptimo por liga (estimado via grid search walk-forward 2025-26, step 0.01).
 * Fallback: DC_RHO (-0.15) para ligas no listadas o cuando leagueCode no se provee.
 *
 * Valores se populan después de correr tools/sweep-rho-per-league.ts.
 * Si el sweep no muestra mejora >0.003 composite score sobre global, mantener vacío
 * y usar DC_RHO como único valor global (sin overhead per-liga).
 *
 * Uso en v3-engine.ts:
 *   const leagueRho = (input.leagueCode && DC_RHO_PER_LEAGUE[input.leagueCode]) ?? DC_RHO;
 *   const estimatedRho = dcRhoOverride ?? leagueRho;
 */
export const DC_RHO_PER_LEAGUE: Record<string, number> = {
  // Optimizado via sweep-rho-per-league.ts 2026-03-17 (walk-forward 2025-26, step 0.01).
  // Mejora composite score (acc + 0.6×DR + 0.4×DP) sobre DC_RHO=-0.15 global:
  //   PD:  -0.25 → +0.048  (PD más correlacionado en scores bajos: más 0-0 y 1-1)
  //   PL:  -0.19 → +0.016  (PL suave mejora: ligeramente menos correlacionado que PD)
  //   BL1: -0.14 → +0.011  (BL1 goleadora: menor corrección Dixon-Coles necesaria)
  // Nota: PD=-0.25 es el límite del rango buscado. No se exploró < -0.25 por diseño.
  'PD':  -0.25,
  'PL':  -0.19,
  'BL1': -0.14,
};

/** Ventana de partidos recientes para recency delta (§9, §19). */
export const N_RECENT = 5;

/** Elasticidad de ataque en la fórmula log-lineal de lambdas (§11, §19). */
export const BETA_ATTACK = 1.0;

/** Elasticidad de defensa en la fórmula log-lineal de lambdas (§11, §19). */
export const BETA_DEFENSE = 1.0;

/**
 * Elasticidad de recency en la fórmula log-lineal de lambdas (§11, §19).
 * Optimizado 0.15→0.20 vía hyperparameter sweep 2025-26 (con calibración activa).
 * Con calibración isotónica, BETA_RECENT=0.20 mejora DRAW recall +0.6pp sobre 0.15.
 */
export const BETA_RECENT = 0.20;

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

/**
 * Sensibilidad del ponderador SoS (Strength of Schedule) en recency delta (§SP-V4-05).
 *
 * Pondera los N_RECENT partidos por la calidad del rival enfrentado:
 *   weight_i = 1 + SOS_SENSITIVITY * (rival_strength_i − 1.0)
 * donde rival_strength_i = (opp_attack_eff + opp_defense_eff) / 2
 *
 * SOS_SENSITIVITY = 0 → promedio uniforme (comportamiento pre-SP-V4-05, backward-compatible).
 * SOS_SENSITIVITY > 0 → partidos contra rivales más fuertes tienen mayor peso.
 *
 * Valor optimizado vía sweep walk-forward 2025-26 (PD+PL+BL1, ~590 partidos).
 * Ver docs/audits/PE-audit-2026-03-17.md §SP-V4-05 para resultados del sweep.
 */
export const SOS_SENSITIVITY = 0.0;

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

// ── SP-V4-12: Importance threshold ────────────────────────────────────────────

/**
 * Minimum importance threshold for including a player in the absence model (§SP-V4-12).
 * Players with importance < MIN_IMPORTANCE_THRESHOLD are treated as squad depth
 * and excluded from the absence score computation.
 * Threshold: 0.3 = at least 30% of possible minutes played = regular starter.
 * Fallback: when importance cannot be derived from real data, use the raw value
 * as supplied (or 0.5 default). This threshold only applies when computed from
 * minutes played in injury-source.ts.
 */
export const MIN_IMPORTANCE_THRESHOLD = 0.3;

// ── SP-V4-13: Positional impact factors ───────────────────────────────────────

/**
 * Per-position impact on attack lambda and defense lambda when a player is absent (§SP-V4-13).
 *
 * attackFactor:  reduction per unit importance applied to the team's scoring lambda
 *                (lambda for goals SCORED by this team).
 * defenseFactor: reduction per unit importance applied to the team's conceding lambda
 *                (lambda for goals CONCEDED by this team = goals SCORED by the opponent).
 *
 * These replace ABSENCE_IMPACT_FACTOR when a player's position is known.
 * Backward compatibility: if position is unknown, ABSENCE_IMPACT_FACTOR is used for both.
 *
 * Rationale:
 *   GK  — absent goalkeeper hurts the back line; minimal effect on attack.
 *   DEF — absent defender hurts defense; minimal effect on attack.
 *   MID — balanced role; moderate contribution to both phases.
 *   FWD — absent forward is primarily an attacking loss; minimal defensive effect.
 */
export const POSITION_IMPACT: Record<string, { attackFactor: number; defenseFactor: number }> = {
  GK:  { attackFactor: 0.01, defenseFactor: 0.06 },
  DEF: { attackFactor: 0.01, defenseFactor: 0.035 },
  MID: { attackFactor: 0.03, defenseFactor: 0.02 },
  FWD: { attackFactor: 0.05, defenseFactor: 0.01 },
};

/** Hard ceiling for market weight — safety (§T3-04). */
export const MARKET_WEIGHT_MAX = 0.30;

/** Tolerance for market odds sum validation (§T3-04). */
export const MARKET_ODDS_SUM_TOLERANCE = 1e-4;

// ── SP-V4-21: Ensemble weights ────────────────────────────────────────────────

/**
 * Pesos por defecto para el ensemble combinator (§SP-V4-21).
 *
 * Estos pesos definen la contribución relativa de cada componente al output final.
 * En SP-V4-23 (integración), el engine usará estos pesos cuando ENSEMBLE_ENABLED=true.
 * Optimización de pesos: SP-V4-22 (tools/sweep-ensemble-weights.ts).
 *
 * Valores iniciales:
 *   w_poisson  = 0.70 — modelo principal (mayor peso mientras logistic esté sin entrenar)
 *   w_market   = 0.15 — odds de mercado (solo si T3-04 disponible)
 *   w_logistic = 0.15 — modelo logístico (solo si ENSEMBLE_ENABLED=true y coefs entrenados)
 */
export const ENSEMBLE_WEIGHTS_DEFAULT = {
  w_poisson:  0.70,
  w_market:   0.15,
  w_logistic: 0.15,
} as const;

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
 * Con calibración isotónica activa (pipeline: Poisson→MarketBlend→Calibration→DrawAffinity),
 * ALPHA=0.50 es el óptimo vía backtest walk-forward 2025-26 (PD+PL+BL1, ~580 partidos).
 * Con K=3/PEG=16/β=0.20 + MARGIN=0.15: acc=49.0%, DRAW recall=51.3%, DRAW prec=32.1%
 *   Por liga (MIXTA): PD 51.0% / BL1 57.1% / PL 36.5% DRAW recall
 *
 * ALPHA>0.60 sobre-predice BL1 (55-62%) y colapsa PL (29-36%) → descartado.
 * Sin calibración el óptimo era 0.70; con calibración el punto óptimo baja a 0.50
 * porque la calibración ya corrige el sesgo HOME/AWAY, quedando menos trabajo
 * para la affinity (solo diferenciación por balance de fuerzas).
 */
export const DRAW_AFFINITY_ALPHA = 0.50;

/**
 * Exponente para el boost de draw affinity.
 * Power=2 → cuadrático: el boost es fuerte solo cuando los equipos son muy parejos.
 * Evita boostar demasiado partidos con diferencia de fuerzas real.
 *
 * Valor confirmado vía sweep POWER×BETA 2026-03-17 (25 combos, PD+PL+BL1, ~590 partidos).
 * POWER=2.0 retiene acc=50.7% y AR=19.6% cuando BETA=1.0 — punto que maximiza DP
 * sin violar los floors de acc (>49.5%) ni DR (>48%).
 * POWER=1.0 mejora composite score pero hunde acc (-1.9pp) → descartado.
 */
export const DRAW_AFFINITY_POWER = 2.0;

/**
 * Bonus adicional al boost cuando el partido es de bajo marcador esperado.
 * avg_λ < DRAW_LOW_SCORING_THRESHOLD → partidos donde 0-0 y 1-1 dominan.
 * Factor multiplicativo sobre el componente de balance.
 *
 * Optimizado 0.50→1.00 vía sweep POWER×BETA 2026-03-17.
 * Con POWER=2.0/BETA=1.00: acc=50.7%, DR=51.6%, DP=35.1% (+0.8pp vs anterior).
 * BETA=0.50 era subóptimo: bajo marcador esperado es señal real de empate y
 * la fórmula se beneficia de un peso mayor sobre esa componente.
 */
export const DRAW_LOW_SCORING_BETA = 1.00;

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
 * Con calibración activa, p_draw post-affinity tiene p50≈0.311, p75≈0.371.
 * MARGIN es el constraint binding. FLOOR=0.27 es efectivamente no-restrictivo:
 * resultados con FLOOR=0.20–0.28 son idénticos con el mismo MARGIN.
 */
export const DRAW_FLOOR = 0.27;

/**
 * Margen máximo entre el líder y p_draw para activar la regla de piso.
 * Si max(p_home, p_away) - p_draw <= DRAW_MARGIN → predecir DRAW.
 * Con calibración activa + K=3/PEG=16/β=0.20:
 *   MARGIN=0.12 → acc=49.8%, DRAW recall=46.8%, DRAW prec=32.7%
 *   MARGIN=0.15 fue testeado pero sacrifica -1.6pp accuracy y -2.1pp DRAW prec
 *   por +4.5pp DR — tradeoff desfavorable para la utopía.
 * MARGIN=0.12 retenido: mejor balance acc/DR/DP.
 */
export const DRAW_MARGIN = 0.12;

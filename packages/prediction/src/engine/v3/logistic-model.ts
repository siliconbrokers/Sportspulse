/**
 * logistic-model.ts — Motor Predictivo V4: §SP-V4-20 Modelo Logístico.
 *
 * Spec: SP-PRED-V4.md §SP-V4-20
 *
 * Modelo de regresión logística multinomial (softmax) que actúa como componente
 * complementario al modelo Poisson en el ensemble V4 (§SP-V4-21).
 *
 * Cuando los coeficientes son todos cero (DEFAULT_LOGISTIC_COEFFICIENTS), produce
 * probabilidades uniformes (33.3% cada clase) — semánticamente correcto: sin datos
 * de entrenamiento, la prior es uniforme.
 *
 * INVARIANTES:
 *   - Función pura. Sin IO. Sin Date.now(). Sin Math.random().
 *   - probHome + probDraw + probAway = 1.0 (garantizado por softmax).
 *   - rest_days clipped a [0, 14].
 *   - balance_ratio ∈ (0, 1].
 *   - home_dominance ∈ [0, 1].
 *
 * @module logistic-model
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Vector de features para el modelo logístico multinomial.
 * Todas las features son numéricas y están normalizadas o acotadas.
 *
 * §SP-V4-20
 */
export interface LogisticFeatureVector {
  /** Lambda home final (post-todos los ajustes del pipeline). */
  lambda_home: number;
  /** Lambda away final (post-todos los ajustes del pipeline). */
  lambda_away: number;
  /** min(λh,λa) / max(λh,λa) ∈ (0,1] — cuán parejos son los equipos. */
  balance_ratio: number;
  /** λh − λa — diferencia firmada de fuerzas. */
  lambda_diff: number;
  /** Días desde último partido del equipo local, clipped a [0, 14]. */
  rest_days_home: number;
  /** Días desde último partido del equipo visitante, clipped a [0, 14]. */
  rest_days_away: number;
  /** Multiplicador H2H del equipo local (1.0 = neutral). */
  h2h_mult_home: number;
  /** Multiplicador H2H del equipo visitante (1.0 = neutral). */
  h2h_mult_away: number;
  /** Multiplicador de ausencia del equipo local (≤ 1.0 — ausencias penalizan). */
  absence_score_home: number;
  /** Multiplicador de ausencia del equipo visitante (≤ 1.0). */
  absence_score_away: number;
  /** Fracción [0,1] de partidos del historial con xG disponible. */
  xg_coverage: number;
  /** One-hot: 1 si la liga es LaLiga (PD), else 0. */
  league_pd: number;
  /** One-hot: 1 si la liga es Premier League (PL), else 0. */
  league_pl: number;
  /** One-hot: 1 si la liga es Bundesliga (BL1), else 0. */
  league_bl1: number;
  /** λh + λa — goles totales esperados en el partido. */
  total_goals_expected: number;
  /** λh / (λh + λa) ∈ [0,1] — dominancia ofensiva del local. */
  home_dominance: number;
  /** Implied prob home win del mercado (Pinnacle/Bet365, normalizada). 1/3 cuando no disponible. */
  market_imp_home: number;
  /** Implied prob empate del mercado. 1/3 cuando no disponible. */
  market_imp_draw: number;
  /** Implied prob away win del mercado. 1/3 cuando no disponible. */
  market_imp_away: number;
  /**
   * §SP-DRAW-V1: Tasa de empate Bayesian-smoothed del equipo local jugando como local.
   * Rango ∈ (0, 1). Default 0.25 cuando no hay datos.
   */
  home_draw_rate: number;
  /**
   * §SP-DRAW-V1: Tasa de empate Bayesian-smoothed del equipo visitante jugando como visitante.
   * Rango ∈ (0, 1). Default 0.25 cuando no hay datos.
   */
  away_draw_rate: number;
  /**
   * §SP-DRAW-V1: Fracción de empates en el historial H2H entre estos dos equipos.
   * Default 0.25 cuando hay < 2 partidos H2H.
   */
  h2h_draw_rate: number;
  /**
   * §SP-DRAW-V1: Diferencia normalizada de ppg entre los dos equipos.
   * ≈0 = muy parejo (más propenso a empate), ≈1 = muy distinto.
   * Fórmula: 1 - 1/(1+|ppgHome-ppgAway|) → ∈ [0,1).
   */
  table_proximity: number;
}

/** Lista ordenada de keys del feature vector — usada para iterar sobre pesos. */
export const LOGISTIC_FEATURE_KEYS: ReadonlyArray<keyof LogisticFeatureVector> = [
  'lambda_home',
  'lambda_away',
  'balance_ratio',
  'lambda_diff',
  'rest_days_home',
  'rest_days_away',
  'h2h_mult_home',
  'h2h_mult_away',
  'absence_score_home',
  'absence_score_away',
  'xg_coverage',
  'league_pd',
  'league_pl',
  'league_bl1',
  'total_goals_expected',
  'home_dominance',
  'market_imp_home',
  'market_imp_draw',
  'market_imp_away',
  // §SP-DRAW-V1: draw-propensity features
  'home_draw_rate',
  'away_draw_rate',
  'h2h_draw_rate',
  'table_proximity',
] as const;

/**
 * Coeficientes del modelo logístico multinomial.
 * Softmax sobre 3 clases: home_win (0), draw (1), away_win (2).
 *
 * §SP-V4-20
 */
export interface LogisticCoefficients {
  /** Pesos para la clase HOME_WIN. */
  home: {
    bias: number;
    weights: Record<keyof LogisticFeatureVector, number>;
  };
  /** Pesos para la clase DRAW. */
  draw: {
    bias: number;
    weights: Record<keyof LogisticFeatureVector, number>;
  };
  /** Pesos para la clase AWAY_WIN. */
  away: {
    bias: number;
    weights: Record<keyof LogisticFeatureVector, number>;
  };
  /** Número de partidos usados para entrenar. */
  trained_on_matches: number;
  /** ISO-8601 UTC timestamp de cuando se entrenó. */
  trained_at: string;
  /** Parámetro de regularización L2 usado en el entrenamiento. */
  regularization_lambda: number;
}

// ── Default coefficients ───────────────────────────────────────────────────────

/**
 * Crea un Record de pesos inicializado en cero para todos los keys del feature vector.
 * §SP-V4-20: default = todos ceros → softmax produce 33.3% uniform.
 */
function makeZeroWeights(): Record<keyof LogisticFeatureVector, number> {
  const weights = {} as Record<keyof LogisticFeatureVector, number>;
  for (const key of LOGISTIC_FEATURE_KEYS) {
    weights[key] = 0;
  }
  return weights;
}

/**
 * Coeficientes por defecto — todos ceros.
 * Con bias=0 y weights=0, softmax(0,0,0) = uniform (33.3%).
 * Semánticamente correcto: sin entrenamiento, la prior es uniforme.
 *
 * §SP-V4-20
 */
export const DEFAULT_LOGISTIC_COEFFICIENTS: LogisticCoefficients = {
  home: { bias: 0, weights: makeZeroWeights() },
  draw: { bias: 0, weights: makeZeroWeights() },
  away: { bias: 0, weights: makeZeroWeights() },
  trained_on_matches: 0,
  trained_at: '2026-01-01T00:00:00Z',
  regularization_lambda: 0.01,
};

// ── Feature extraction ─────────────────────────────────────────────────────────

/**
 * Extrae el vector de features logísticas a partir de las variables intermedias
 * del pipeline V3.
 *
 * Función pura: mismos inputs → mismo output.
 *
 * §SP-V4-20
 */
export function extractLogisticFeatures(params: {
  lambdaHome: number;
  lambdaAway: number;
  restDaysHome: number;
  restDaysAway: number;
  h2hMultHome: number;
  h2hMultAway: number;
  absenceScoreHome: number;
  absenceScoreAway: number;
  xgCoverage: number;
  leagueCode?: string;
  /** Implied prob home win del mercado (normalizada). Defaults a 1/3. */
  marketImpHome?: number;
  /** Implied prob draw del mercado (normalizada). Defaults a 1/3. */
  marketImpDraw?: number;
  /** Implied prob away win del mercado (normalizada). Defaults a 1/3. */
  marketImpAway?: number;
  /**
   * §SP-DRAW-V1: Tasa de empate Bayesian-smoothed del local en rol local.
   * Defaults a 0.25 cuando no hay datos.
   */
  homeDrawRate?: number;
  /**
   * §SP-DRAW-V1: Tasa de empate Bayesian-smoothed del visitante en rol visitante.
   * Defaults a 0.25 cuando no hay datos.
   */
  awayDrawRate?: number;
  /**
   * §SP-DRAW-V1: Fracción de empates en el H2H histórico.
   * Defaults a 0.25 cuando hay < 2 partidos H2H.
   */
  h2hDrawRate?: number;
  /**
   * §SP-DRAW-V1: Diferencia normalizada de ppg.
   * 1 - 1/(1+|ppgHome-ppgAway|) → ∈ [0,1). Default 0.5.
   */
  tableProximity?: number;
}): LogisticFeatureVector {
  const {
    lambdaHome,
    lambdaAway,
    restDaysHome,
    restDaysAway,
    h2hMultHome,
    h2hMultAway,
    absenceScoreHome,
    absenceScoreAway,
    xgCoverage,
    leagueCode,
    marketImpHome,
    marketImpDraw,
    marketImpAway,
    homeDrawRate,
    awayDrawRate,
    h2hDrawRate,
    tableProximity,
  } = params;

  // §SP-V4-20: balance_ratio = min(λh,λa) / max(λh,λa)
  // Ambos 0 → ratio indefinido → 1.0 (perfectamente equilibrado).
  const maxLambda = Math.max(lambdaHome, lambdaAway);
  const balance_ratio = maxLambda > 0
    ? Math.min(lambdaHome, lambdaAway) / maxLambda
    : 1.0;

  // §SP-V4-20: lambda_diff = λh - λa (signed)
  const lambda_diff = lambdaHome - lambdaAway;

  // §SP-V4-20: total_goals_expected = λh + λa
  const total_goals_expected = lambdaHome + lambdaAway;

  // §SP-V4-20: home_dominance = λh / (λh + λa)
  // Suma 0 → 0.5 (igual de dominantes).
  const home_dominance = total_goals_expected > 0
    ? lambdaHome / total_goals_expected
    : 0.5;

  // §SP-V4-20: rest_days clipped a [0, 14]
  const rest_days_home = Math.max(0, Math.min(14, restDaysHome));
  const rest_days_away = Math.max(0, Math.min(14, restDaysAway));

  // §SP-V4-20: league one-hot — solo PD/PL/BL1 reconocidos
  const league_pd  = leagueCode === 'PD'  ? 1 : 0;
  const league_pl  = leagueCode === 'PL'  ? 1 : 0;
  const league_bl1 = leagueCode === 'BL1' ? 1 : 0;

  return {
    lambda_home: lambdaHome,
    lambda_away: lambdaAway,
    balance_ratio,
    lambda_diff,
    rest_days_home,
    rest_days_away,
    h2h_mult_home: h2hMultHome,
    h2h_mult_away: h2hMultAway,
    absence_score_home: absenceScoreHome,
    absence_score_away: absenceScoreAway,
    xg_coverage: xgCoverage,
    league_pd,
    league_pl,
    league_bl1,
    total_goals_expected,
    home_dominance,
    market_imp_home: marketImpHome ?? (1 / 3),
    market_imp_draw: marketImpDraw ?? (1 / 3),
    market_imp_away: marketImpAway ?? (1 / 3),
    // §SP-DRAW-V1: draw-propensity features — default 0.25 (league-average prior)
    // With DEFAULT_LOGISTIC_COEFFICIENTS (all zeros), these features have zero effect
    // and the output is bit-exact to pre-SP-DRAW-V1 (backward-compatible).
    home_draw_rate: homeDrawRate ?? 0.25,
    away_draw_rate: awayDrawRate ?? 0.25,
    h2h_draw_rate:  h2hDrawRate  ?? 0.25,
    // table_proximity: 1 - 1/(1+|ppgH-ppgA|) where 0.5 default → |ppgH-ppgA|=1 (moderate gap)
    table_proximity: tableProximity ?? 0.5,
  };
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Predice probabilidades 1X2 usando el modelo logístico multinomial (softmax).
 *
 * score_k = bias_k + sum(weights_k[f] * features[f])
 * prob_k  = exp(score_k) / (exp(score_home) + exp(score_draw) + exp(score_away))
 *
 * Garantiza: probHome + probDraw + probAway = 1.0 y cada prob ∈ [0,1].
 *
 * §SP-V4-20
 */
export function predictLogistic(
  features: LogisticFeatureVector,
  coefficients: LogisticCoefficients,
): { probHome: number; probDraw: number; probAway: number } {
  // Calcular score lineal para cada clase
  // §SP-V4-20: score_k = bias_k + sum_f(weights_k[f] * features[f])
  function linearScore(
    classCoeffs: { bias: number; weights: Record<keyof LogisticFeatureVector, number> },
  ): number {
    let score = classCoeffs.bias;
    for (const key of LOGISTIC_FEATURE_KEYS) {
      score += (classCoeffs.weights[key] ?? 0) * features[key];
    }
    return score;
  }

  const scoreHome = linearScore(coefficients.home);
  const scoreDraw = linearScore(coefficients.draw);
  const scoreAway = linearScore(coefficients.away);

  // Softmax con estabilidad numérica: restar max antes de exp
  // (evita overflow para scores grandes)
  const maxScore = Math.max(scoreHome, scoreDraw, scoreAway);
  const expHome = Math.exp(scoreHome - maxScore);
  const expDraw = Math.exp(scoreDraw - maxScore);
  const expAway = Math.exp(scoreAway - maxScore);
  const total = expHome + expDraw + expAway;

  // §SP-V4-20: garantía de suma = 1.0
  return {
    probHome: expHome / total,
    probDraw:  expDraw  / total,
    probAway:  expAway  / total,
  };
}

/**
 * ensemble.ts — Motor Predictivo V4: §SP-V4-21 Ensemble Combinator.
 *
 * Spec: SP-PRED-V4.md §SP-V4-21
 *
 * Combina probabilidades 1X2 de hasta 3 componentes:
 *   - Poisson (siempre disponible)
 *   - Market odds (opcional — solo cuando T3-04 tiene odds válidas)
 *   - Logistic (opcional — solo cuando ENSEMBLE_ENABLED=true en SP-V4-23)
 *
 * Cuando un componente no está disponible, su peso se redistribuye
 * proporcionalmente entre los componentes disponibles.
 *
 * INVARIANTES:
 *   - Función pura. Sin IO. Determinista.
 *   - weights_used.w_poisson + weights_used.w_market + weights_used.w_logistic = 1.0
 *   - probHome + probDraw + probAway = 1.0 (garantizado por renormalización final)
 *   - Cada prob ∈ [0, 1]
 *   - Poisson siempre disponible — si market y logistic ausentes, retorna Poisson directo.
 *
 * @module ensemble
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Probabilidades 1X2 de un componente del ensemble. §SP-V4-21 */
export interface Prob1X2 {
  probHome: number;
  probDraw: number;
  probAway: number;
}

/**
 * Input del combinator de ensemble.
 * Poisson es siempre requerido; market y logistic son opcionales.
 *
 * §SP-V4-21
 */
export interface EnsembleInput {
  /** Probabilidades del modelo Poisson+DC (siempre disponible). */
  poisson: Prob1X2;
  /** Probabilidades implícitas del mercado (de-vigged). undefined si no hay odds. */
  market?: Prob1X2;
  /** Probabilidades del modelo logístico. undefined si ENSEMBLE_ENABLED=false. */
  logistic?: Prob1X2;
}

/**
 * Pesos efectivos usados en la combinación.
 * Los pesos efectivos suman 1.0 (después del fallback de redistribución).
 *
 * §SP-V4-21
 */
export interface EnsembleWeights {
  /** Peso del componente Poisson. Default: 0.70. */
  w_poisson: number;
  /** Peso del componente de mercado. Default: 0.15 (si hay odds, else 0). */
  w_market: number;
  /** Peso del componente logístico. Default: 0.15 (si hay logistic, else 0). */
  w_logistic: number;
}

/**
 * Resultado del ensemble combinator.
 *
 * §SP-V4-21
 */
export interface EnsembleResult {
  probHome: number;
  probDraw: number;
  probAway: number;
  /** Los pesos efectivos después del fallback de redistribución. Siempre suman 1.0. */
  weights_used: EnsembleWeights;
}

// ── Combinator ────────────────────────────────────────────────────────────────

/**
 * Combina múltiples fuentes de probabilidades 1X2 en un ensemble ponderado.
 *
 * Lógica de redistribución de pesos:
 *   1. Si market=undefined: w_market se redistribuye a poisson y logistic
 *      proporcional a sus pesos relativos (si logistic también undefined → todo a poisson).
 *   2. Si logistic=undefined: w_logistic se redistribuye a poisson y market
 *      proporcional a sus pesos relativos.
 *   3. Los pesos se normalizan para garantizar suma=1.
 *   4. El resultado se renormaliza (defensivo — errores de punto flotante).
 *
 * §SP-V4-21
 */
export function combineEnsemble(
  input: EnsembleInput,
  weights: EnsembleWeights,
): EnsembleResult {
  const { poisson, market, logistic } = input;

  // ── Paso 1: Determinar disponibilidad de componentes ─────────────────────
  const hasMarket   = market   !== undefined;
  const hasLogistic = logistic !== undefined;

  // ── Paso 2: Normalizar pesos de entrada (los del caller pueden no sumar 1) ─
  // §SP-V4-21: pesos que no suman 1 → se normalizan antes de operar.
  const inputSum = weights.w_poisson + weights.w_market + weights.w_logistic;
  let wPoisson  = inputSum > 0 ? weights.w_poisson  / inputSum : 1.0;
  let wMarket   = inputSum > 0 ? weights.w_market   / inputSum : 0.0;
  let wLogistic = inputSum > 0 ? weights.w_logistic / inputSum : 0.0;

  // ── Paso 3: Redistribuir pesos de componentes no disponibles ─────────────
  // §SP-V4-21: si market=undefined → redistribuir w_market proporcional entre poisson y logistic
  if (!hasMarket) {
    const weightToRedistribute = wMarket;
    wMarket = 0;
    // Redistribuir entre poisson y logistic proporcionalmente
    const availableWeight = wPoisson + wLogistic;
    if (availableWeight > 0) {
      wPoisson  += weightToRedistribute * (wPoisson  / availableWeight);
      wLogistic += weightToRedistribute * (wLogistic / availableWeight);
    } else {
      // Fallback defensivo: todo a poisson
      wPoisson += weightToRedistribute;
    }
  }

  // §SP-V4-21: si logistic=undefined → redistribuir w_logistic proporcional entre poisson y market
  if (!hasLogistic) {
    const weightToRedistribute = wLogistic;
    wLogistic = 0;
    // Redistribuir entre poisson y market proporcionalmente
    const availableWeight = wPoisson + wMarket;
    if (availableWeight > 0) {
      wPoisson += weightToRedistribute * (wPoisson / availableWeight);
      wMarket  += weightToRedistribute * (wMarket  / availableWeight);
    } else {
      // Fallback defensivo: todo a poisson (market tampoco disponible)
      wPoisson += weightToRedistribute;
    }
  }

  // ── Paso 4: Renormalizar pesos efectivos ──────────────────────────────────
  // Defensivo: garantizar suma exactamente 1.0 después de redistribución.
  const effectiveSum = wPoisson + wMarket + wLogistic;
  const wEffPoisson  = effectiveSum > 0 ? wPoisson  / effectiveSum : 1.0;
  const wEffMarket   = effectiveSum > 0 ? wMarket   / effectiveSum : 0.0;
  const wEffLogistic = effectiveSum > 0 ? wLogistic / effectiveSum : 0.0;

  // ── Paso 5: Calcular probabilidades combinadas ────────────────────────────
  // result = w_eff_poisson * poisson + w_eff_market * market + w_eff_logistic * logistic
  const mkt   = market   ?? { probHome: 0, probDraw: 0, probAway: 0 };
  const log   = logistic ?? { probHome: 0, probDraw: 0, probAway: 0 };

  const rawHome = wEffPoisson * poisson.probHome + wEffMarket * mkt.probHome + wEffLogistic * log.probHome;
  const rawDraw = wEffPoisson * poisson.probDraw + wEffMarket * mkt.probDraw + wEffLogistic * log.probDraw;
  const rawAway = wEffPoisson * poisson.probAway + wEffMarket * mkt.probAway + wEffLogistic * log.probAway;

  // ── Paso 6: Renormalizar resultado ────────────────────────────────────────
  // §SP-V4-21: defensivo — errores de punto flotante pueden causar suma ≠ 1.
  const resultSum = rawHome + rawDraw + rawAway;
  const probHome = resultSum > 0 ? rawHome / resultSum : 1 / 3;
  const probDraw = resultSum > 0 ? rawDraw / resultSum : 1 / 3;
  const probAway = resultSum > 0 ? rawAway / resultSum : 1 / 3;

  return {
    probHome,
    probDraw,
    probAway,
    weights_used: {
      w_poisson:  wEffPoisson,
      w_market:   wEffMarket,
      w_logistic: wEffLogistic,
    },
  };
}

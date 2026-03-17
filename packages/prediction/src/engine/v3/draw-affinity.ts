/**
 * draw-affinity.ts — Draw probability boost based on lambda balance.
 *
 * El modelo Poisson bivariate subestima sistemáticamente la probabilidad de
 * empate cuando hay home advantage: al separar λh > λa, las distribuciones se
 * alejan y las diagonales (0-0, 1-1, 2-2...) suman menos.
 *
 * Este módulo aplica un multiplicador post-Poisson a p_draw proporcional a
 * cuán equilibradas están las fuerzas de ambos equipos. El exceso se retira
 * proporcionalmente de p_home y p_away y se renormaliza.
 *
 * Fórmula:
 *   balance_ratio = min(λh, λa) / max(λh, λa)  ∈ [0, 1]
 *   draw_mult     = 1 + ALPHA × balance_ratio ^ POWER
 *   p_draw_new    = p_draw × draw_mult
 *   excess        = p_draw_new − p_draw
 *   p_home_new    = p_home − excess × p_home / (p_home + p_away)
 *   p_away_new    = p_away − excess × p_away / (p_home + p_away)
 *   renormalizar → suma = 1
 *
 * Función pura. Sin IO. Determinista.
 */

import {
  DRAW_AFFINITY_ALPHA,
  DRAW_AFFINITY_POWER,
  DRAW_LOW_SCORING_BETA,
  DRAW_LOW_SCORING_THRESHOLD,
  DRAW_PROPENSITY_WEIGHT,
  DRAW_LEAGUE_AVG_RATE,
} from './constants.js';

export interface DrawAffinityResult {
  prob_home: number;
  prob_draw: number;
  prob_away: number;
  /** Multiplicador aplicado a p_draw (1.0 = sin boost). */
  draw_mult_applied: number;
  /** min(λh, λa) / max(λh, λa) — cuán equilibradas están las fuerzas. */
  balance_ratio: number;
}

/**
 * Aplica el boost de draw affinity a las probabilidades 1X2 post-Poisson.
 *
 * Combina tres señales independientes:
 *   1. Balance de lambdas: min/max ∈ [0,1] — fuerzas parejas → más empates
 *   2. Bajo marcador esperado: avg_λ bajo → 0-0 y 1-1 dominan
 *   3. Propensidad histórica: qué tan seguido empata cada equipo en su rol
 *
 * @param probHome         Probabilidad de victoria local (Poisson raw)
 * @param probDraw         Probabilidad de empate (Poisson raw)
 * @param probAway         Probabilidad de victoria visitante (Poisson raw)
 * @param lambdaHome       Lambda local final (después de todos los ajustes)
 * @param lambdaAway       Lambda visitante final
 * @param homeDrawRate     Tasa de empate del equipo local jugando como local [0,1] (Bayesian-smoothed)
 * @param awayDrawRate     Tasa de empate del equipo visitante jugando de visita [0,1] (Bayesian-smoothed)
 * @param tableProximity   Proximidad en la tabla: 1/(1+|ppg_H - ppg_A|) ∈ (0,1]
 * @param h2hDrawRate      Tasa de empate en el H2H específico de este cruce [0,1]
 */
export interface DrawAffinityOverrides {
  DRAW_AFFINITY_POWER?: number;
  DRAW_LOW_SCORING_BETA?: number;
  DRAW_AFFINITY_ALPHA?: number;
}

export function applyDrawAffinity(
  probHome: number,
  probDraw: number,
  probAway: number,
  lambdaHome: number,
  lambdaAway: number,
  homeDrawRate?: number,
  awayDrawRate?: number,
  tableProximity?: number,
  h2hDrawRate?: number,
  overrides?: DrawAffinityOverrides,
): DrawAffinityResult {
  // Guardia: lambdas inválidas → no-op
  if (lambdaHome <= 0 || lambdaAway <= 0) {
    return {
      prob_home: probHome,
      prob_draw: probDraw,
      prob_away: probAway,
      draw_mult_applied: 1.0,
      balance_ratio: 0,
    };
  }

  // balance_ratio ∈ (0, 1]: 1 = fuerzas iguales, cerca de 0 = un equipo domina
  const balance = Math.min(lambdaHome, lambdaAway) / Math.max(lambdaHome, lambdaAway);

  // Componente 1: balance de fuerzas (cuadrático → fuerte solo cuando muy equilibrados)
  const effectivePower = overrides?.DRAW_AFFINITY_POWER ?? DRAW_AFFINITY_POWER;
  const balanceComponent = Math.pow(balance, effectivePower);

  // Componente 2: bonus por bajo marcador esperado
  // Cuando avg_λ < THRESHOLD, los marcadores 0-0 y 1-1 dominan → empates más probables.
  // Normalizado: 1.0 cuando avg=0.5, 0.0 cuando avg=THRESHOLD.
  const avgLambda = (lambdaHome + lambdaAway) / 2;
  const lowScoringFactor = Math.max(
    0,
    (DRAW_LOW_SCORING_THRESHOLD - avgLambda) / (DRAW_LOW_SCORING_THRESHOLD - 0.5),
  );

  // Componente 3: propensidad histórica de empate de cada equipo en su rol.
  // Si el local empata mucho en casa Y el visitante empata mucho de visita,
  // el partido es genuinamente propenso a empate (no solo "incierto").
  // Normalizado contra la tasa promedio de la liga.
  let propensityFactor = 1.0;
  if (homeDrawRate !== undefined && awayDrawRate !== undefined) {
    // Normalizar contra la tasa promedio de liga.
    // Flooreamos cada componente en 0.6 para evitar penalización excesiva
    // cuando un equipo tiene pocas observaciones (aunque con Bayesian smoothing
    // en el caller, los valores extremos ya son suavizados).
    const homeRel = Math.max(0.6, homeDrawRate / DRAW_LEAGUE_AVG_RATE);
    const awayRel = Math.max(0.6, awayDrawRate / DRAW_LEAGUE_AVG_RATE);
    // Media aritmética: más estable que geométrica cuando los valores son extremos
    propensityFactor = (homeRel + awayRel) / 2;
    // Clip superior para evitar over-boost en equipos con run de empates
    propensityFactor = Math.min(1.8, propensityFactor);
  }

  // Componente 4: proximidad en la tabla (ppg similar → equipos realmente parejos).
  // tableProximity ∈ (0,1]: 1 = mismo ppg. Señal complementaria al balance de lambdas:
  // captura casos donde un equipo fuerte "de papel" está en racha mientras el rival no.
  let tableProxFactor = 1.0;
  if (tableProximity !== undefined) {
    // Normalizar: tableProximity=1.0 → factor=1+BETA, tableProximity=0.5 → factor≈1
    // Usamos un multiplicador suave: factor = 1 + 0.4 × (tableProximity - 0.5) cuando > 0.5
    const tableBonus = Math.max(0, tableProximity - 0.5) * 0.4;
    tableProxFactor = 1.0 + tableBonus;
  }

  // Componente 5: tasa de empate H2H para este cruce específico.
  // Algunos emparejamientos tienen historial sistemático de empates (derbis, etc.).
  let h2hFactor = 1.0;
  if (h2hDrawRate !== undefined) {
    const h2hRel = Math.max(0.5, h2hDrawRate / DRAW_LEAGUE_AVG_RATE);
    h2hFactor = Math.min(1.8, h2hRel);
  }

  // Señal combinada: balance × low-scoring × propensity × table × h2h
  const effectiveLowScoringBeta = overrides?.DRAW_LOW_SCORING_BETA ?? DRAW_LOW_SCORING_BETA;
  const drawSignal =
    balanceComponent *
    (1 + effectiveLowScoringBeta * lowScoringFactor) *
    propensityFactor *
    tableProxFactor *
    h2hFactor;

  // Multiplicador final
  const effectiveAlpha = overrides?.DRAW_AFFINITY_ALPHA ?? DRAW_AFFINITY_ALPHA;
  const drawMult = 1.0 + effectiveAlpha * drawSignal;

  // Cap: boostedDraw no puede superar el 99% de la probabilidad total (probDraw + probHome + probAway ≈ 1).
  // Sin este cap, con ALPHA alto y todos los señales al máximo, boostedDraw > 1 → homeAdj/awayAdj negativos.
  const rawBoostedDraw = probDraw * drawMult;
  const boostedDraw = Math.min(rawBoostedDraw, 0.99);
  const excess = boostedDraw - probDraw;

  // Retirar exceso proporcionalmente de home y away.
  // Clamp a 0: si el exceso supera la suma home+away, ambos se llevan a 0
  // (el remanente se absorbe en la renormalización final).
  const homeAwaySum = probHome + probAway;
  const homeAdj = homeAwaySum > 0
    ? Math.max(0, probHome - excess * (probHome / homeAwaySum))
    : probHome;
  const awayAdj = homeAwaySum > 0
    ? Math.max(0, probAway - excess * (probAway / homeAwaySum))
    : probAway;

  // Renormalizar para garantizar suma = 1 (absorbe errores de punto flotante)
  const total = homeAdj + boostedDraw + awayAdj;
  if (total <= 0) {
    return {
      prob_home: probHome,
      prob_draw: probDraw,
      prob_away: probAway,
      draw_mult_applied: 1.0,
      balance_ratio: balance,
    };
  }

  return {
    prob_home: homeAdj / total,
    prob_draw: boostedDraw / total,
    prob_away: awayAdj / total,
    draw_mult_applied: drawMult,
    balance_ratio: balance,
  };
}

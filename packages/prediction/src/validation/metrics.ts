/**
 * metrics.ts — Métricas de evaluación predictiva para walk-forward V2 (§17).
 *
 * Todas las funciones son puras. Sin IO.
 *
 * Métricas implementadas:
 *   - Log Loss 1X2
 *   - Multi-class Brier Score 1X2  [rango: 0..2, naive baseline = 2/3]
 *   - Accuracy (argmax prediction)
 *   - Draw rate: predicha vs real
 *   - Goals comparison: lambda_home+away vs actual
 *   - Calibration buckets (10 buckets × 3 clases: global, home, draw, away)
 *
 * NOT_ELIGIBLE se excluye de TODAS las métricas pero se trackea.
 *
 * Baselines naive (referencia):
 *   NAIVE_LOG_LOSS = ln(3) ≈ 1.099  — modelo uniforme 1/3
 *   NAIVE_BRIER    = 2/3   ≈ 0.667  — modelo uniforme 1/3  [escala 0..2]
 */

import type { WFPrediction, Outcome } from './walk-forward.js';

// ── Naive baselines ───────────────────────────────────────────────────────────

/**
 * Log Loss de un modelo que asigna 1/3 a cada outcome.
 * Perfecta = 0. Este valor es el techo esperado sin información predictiva.
 */
export const NAIVE_LOG_LOSS: number = Math.log(3); // ≈ 1.0986

/**
 * Brier Score multiclase (1X2) de un modelo que asigna 1/3 a cada outcome.
 * Rango del Brier multiclase 1X2: [0, 2] (NO [0, 1] como el binario estándar).
 * El baseline uniforme 1/3 produce: 3 × (1/3 - i)^2 promediado = 2/3.
 */
export const NAIVE_BRIER: number = 2 / 3; // ≈ 0.6667

// ── Helpers ───────────────────────────────────────────────────────────────────

const EPSILON = 1e-7;

function evaluable(preds: WFPrediction[]): WFPrediction[] {
  return preds.filter((p) => p.eligibility_status !== 'NOT_ELIGIBLE');
}

// ── Métricas escalares ────────────────────────────────────────────────────────

/**
 * Log Loss 1X2.
 * Perfecta = 0. Naive baseline ≈ ln(3) ≈ 1.099.
 */
export function computeLogLoss(preds: WFPrediction[]): number {
  const ev = evaluable(preds);
  if (ev.length === 0) return NaN;

  let sum = 0;
  for (const p of ev) {
    const pActual =
      p.actual_outcome === 'H'
        ? p.prob_home_win
        : p.actual_outcome === 'D'
          ? p.prob_draw
          : p.prob_away_win;
    sum += Math.log(Math.max(pActual, EPSILON));
  }
  return -(sum / ev.length);
}

/**
 * Multi-class Brier Score.
 * Suma de errores cuadráticos sobre los 3 outcomes.
 * Perfecta = 0. Baseline uniforme = 2/3 ≈ 0.667.
 */
export function computeBrierScore(preds: WFPrediction[]): number {
  const ev = evaluable(preds);
  if (ev.length === 0) return NaN;

  let sum = 0;
  for (const p of ev) {
    const iH = p.actual_outcome === 'H' ? 1 : 0;
    const iD = p.actual_outcome === 'D' ? 1 : 0;
    const iA = p.actual_outcome === 'A' ? 1 : 0;
    sum += (p.prob_home_win - iH) ** 2 + (p.prob_draw - iD) ** 2 + (p.prob_away_win - iA) ** 2;
  }
  return sum / ev.length;
}

/**
 * Accuracy: fracción donde argmax(probs) == resultado real.
 */
export function computeAccuracy(preds: WFPrediction[]): number {
  const ev = evaluable(preds);
  if (ev.length === 0) return NaN;

  let correct = 0;
  for (const p of ev) {
    const predicted: Outcome =
      p.prob_home_win >= p.prob_draw && p.prob_home_win >= p.prob_away_win
        ? 'H'
        : p.prob_draw >= p.prob_away_win
          ? 'D'
          : 'A';
    if (predicted === p.actual_outcome) correct++;
  }
  return correct / ev.length;
}

// ── Draw rate ─────────────────────────────────────────────────────────────────

export interface DrawRateResult {
  predicted_mean: number;
  actual_rate: number;
  n: number;
}

export function computeDrawRate(preds: WFPrediction[]): DrawRateResult {
  const ev = evaluable(preds);
  if (ev.length === 0) return { predicted_mean: NaN, actual_rate: NaN, n: 0 };

  const predictedMean = ev.reduce((s, p) => s + p.prob_draw, 0) / ev.length;
  const actualDraws = ev.filter((p) => p.actual_outcome === 'D').length;
  return {
    predicted_mean: predictedMean,
    actual_rate: actualDraws / ev.length,
    n: ev.length,
  };
}

// ── Goals comparison ──────────────────────────────────────────────────────────

export interface GoalsResult {
  predicted_total_pg: number;
  actual_total_pg: number;
  predicted_home_pg: number;
  actual_home_pg: number;
  predicted_away_pg: number;
  actual_away_pg: number;
  n: number;
}

export function computeGoalsComparison(preds: WFPrediction[]): GoalsResult {
  const ev = evaluable(preds);
  const n = ev.length;
  if (n === 0) {
    return {
      predicted_total_pg: NaN,
      actual_total_pg: NaN,
      predicted_home_pg: NaN,
      actual_home_pg: NaN,
      predicted_away_pg: NaN,
      actual_away_pg: NaN,
      n: 0,
    };
  }
  const predHome = ev.reduce((s, p) => s + p.lambda_home, 0) / n;
  const predAway = ev.reduce((s, p) => s + p.lambda_away, 0) / n;
  const actHome = ev.reduce((s, p) => s + p.actual_home_goals, 0) / n;
  const actAway = ev.reduce((s, p) => s + p.actual_away_goals, 0) / n;
  return {
    predicted_total_pg: predHome + predAway,
    actual_total_pg: actHome + actAway,
    predicted_home_pg: predHome,
    actual_home_pg: actHome,
    predicted_away_pg: predAway,
    actual_away_pg: actAway,
    n,
  };
}

// ── Calibration ───────────────────────────────────────────────────────────────

/** Calibration bucket para walk-forward V2. Distinto de CalibrationBucket de V1 (metrics/). */
export interface WFCalibrationBucket {
  /** "[0%, 10%)" */
  bucket_label: string;
  p_min: number;
  p_max: number;
  /** Pares (outcome, prob) que caen en este bucket. */
  n_pairs: number;
  mean_predicted_prob: number;
  actual_hit_rate: number;
}

/**
 * Calibración en 10 buckets.
 *
 * Para cada partido evaluable se generan 3 pares (outcome, predicted_prob).
 * Se agrupa por bucket de probabilidad y se compara la probabilidad media
 * predicha con la tasa de aciertos real.
 *
 * Un modelo perfectamente calibrado tiene mean_predicted_prob ≈ actual_hit_rate
 * en cada bucket.
 */
export function computeCalibration(preds: WFPrediction[], nBuckets = 10): WFCalibrationBucket[] {
  const ev = evaluable(preds);
  const step = 1 / nBuckets;

  const buckets = Array.from({ length: nBuckets }, (_, i) => ({
    p_min: i * step,
    p_max: (i + 1) * step,
    sum_prob: 0,
    hits: 0,
    count: 0,
  }));

  for (const p of ev) {
    const pairs: [number, boolean][] = [
      [p.prob_home_win, p.actual_outcome === 'H'],
      [p.prob_draw, p.actual_outcome === 'D'],
      [p.prob_away_win, p.actual_outcome === 'A'],
    ];
    for (const [prob, hit] of pairs) {
      const idx = Math.min(Math.floor(prob / step), nBuckets - 1);
      buckets[idx].sum_prob += prob;
      if (hit) buckets[idx].hits++;
      buckets[idx].count++;
    }
  }

  return buckets.map((b) => ({
    bucket_label: `[${(b.p_min * 100).toFixed(0)}%,${(b.p_max * 100).toFixed(0)}%)`,
    p_min: b.p_min,
    p_max: b.p_max,
    n_pairs: b.count,
    mean_predicted_prob: b.count > 0 ? b.sum_prob / b.count : 0,
    actual_hit_rate: b.count > 0 ? b.hits / b.count : 0,
  }));
}

// ── Per-class calibration ─────────────────────────────────────────────────────

/**
 * Calibración separada por clase (home / draw / away).
 *
 * Cada clase usa un par (prob_class, outcome === class) por partido,
 * agrupado en nBuckets buckets de probabilidad.
 *
 * Expone sesgos por clase que la calibración global oculta.
 * Ejemplo: el Poisson básico tiende a sobreestimar empates —
 * la calibración por clase lo detecta sin diluirse en los otros outcomes.
 */
export interface PerClassCalibrationBuckets {
  home: WFCalibrationBucket[];
  draw: WFCalibrationBucket[];
  away: WFCalibrationBucket[];
}

export function computePerClassCalibration(
  preds: WFPrediction[],
  nBuckets = 10,
): PerClassCalibrationBuckets {
  const ev = evaluable(preds);
  const step = 1 / nBuckets;

  const makeBuckets = () =>
    Array.from({ length: nBuckets }, (_, i) => ({
      p_min: i * step,
      p_max: (i + 1) * step,
      sum_prob: 0,
      hits: 0,
      count: 0,
    }));

  const homeBuckets = makeBuckets();
  const drawBuckets = makeBuckets();
  const awayBuckets = makeBuckets();

  const fill = (buckets: ReturnType<typeof makeBuckets>, prob: number, hit: boolean) => {
    const idx = Math.min(Math.floor(prob / step), nBuckets - 1);
    buckets[idx].sum_prob += prob;
    if (hit) buckets[idx].hits++;
    buckets[idx].count++;
  };

  for (const p of ev) {
    fill(homeBuckets, p.prob_home_win, p.actual_outcome === 'H');
    fill(drawBuckets, p.prob_draw, p.actual_outcome === 'D');
    fill(awayBuckets, p.prob_away_win, p.actual_outcome === 'A');
  }

  const toResult = (b: ReturnType<typeof makeBuckets>[number]): WFCalibrationBucket => ({
    bucket_label: `[${(b.p_min * 100).toFixed(0)}%,${(b.p_max * 100).toFixed(0)}%)`,
    p_min: b.p_min,
    p_max: b.p_max,
    n_pairs: b.count,
    mean_predicted_prob: b.count > 0 ? b.sum_prob / b.count : 0,
    actual_hit_rate: b.count > 0 ? b.hits / b.count : 0,
  });

  return {
    home: homeBuckets.map(toResult),
    draw: drawBuckets.map(toResult),
    away: awayBuckets.map(toResult),
  };
}

// ── Outcome distribution ──────────────────────────────────────────────────────

export interface OutcomeDistribution {
  H: number;
  D: number;
  A: number;
  H_pct: number;
  D_pct: number;
  A_pct: number;
  n: number;
}

export function computeOutcomeDistribution(preds: WFPrediction[]): OutcomeDistribution {
  const ev = evaluable(preds);
  const n = ev.length;
  if (n === 0) return { H: 0, D: 0, A: 0, H_pct: 0, D_pct: 0, A_pct: 0, n: 0 };
  const H = ev.filter((p) => p.actual_outcome === 'H').length;
  const D = ev.filter((p) => p.actual_outcome === 'D').length;
  const A = ev.filter((p) => p.actual_outcome === 'A').length;
  return {
    H,
    D,
    A,
    H_pct: H / n,
    D_pct: D / n,
    A_pct: A / n,
    n,
  };
}

// ── Full metrics bundle ───────────────────────────────────────────────────────

export interface MetricBundle {
  n_total: number;
  n_evaluated: number;
  n_not_eligible: number;
  n_limited: number;
  log_loss: number;
  brier_score: number;
  accuracy: number;
  draw_rate: DrawRateResult;
  goals: GoalsResult;
  /** Calibración global: todos los outcomes mezclados (3 pares por partido). */
  calibration_buckets: WFCalibrationBucket[];
  /** Calibración por clase: home / draw / away separados. */
  per_class_calibration_buckets: PerClassCalibrationBuckets;
  outcome_distribution: OutcomeDistribution;
}

export function computeAllMetrics(preds: WFPrediction[]): MetricBundle {
  const ev = evaluable(preds);
  return {
    n_total: preds.length,
    n_evaluated: ev.length,
    n_not_eligible: preds.filter((p) => p.eligibility_status === 'NOT_ELIGIBLE').length,
    n_limited: preds.filter((p) => p.eligibility_status === 'LIMITED').length,
    log_loss: computeLogLoss(preds),
    brier_score: computeBrierScore(preds),
    accuracy: computeAccuracy(preds),
    draw_rate: computeDrawRate(preds),
    goals: computeGoalsComparison(preds),
    calibration_buckets: computeCalibration(preds),
    per_class_calibration_buckets: computePerClassCalibration(preds),
    outcome_distribution: computeOutcomeDistribution(preds),
  };
}

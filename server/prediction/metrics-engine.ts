/**
 * metrics-engine.ts — computes all mandatory evaluation metrics on-demand.
 *
 * Metrics are recomputed fresh on every call to computeMetrics().
 * No incremental state, no cached metric results.
 *
 * Rationale: bounded dataset (30–100 records), O(n) computation, ground truth
 * changes over time — on-demand guarantees metrics always reflect current state.
 *
 * Coverage funnel (5 stages):
 *   Stage 1 — In scope:           all EvaluationRecord entries
 *   Stage 2 — Pregame snapshot:   record_status ∈ {SNAPSHOT_FROZEN, COMPLETE}
 *   Stage 3 — Ground truth:       ground_truth_status = 'CAPTURED'
 *   Stage 4 — Fully evaluable:    evaluation_eligible = true
 *   Stage 5 — UI render recorded: ui_render_result ≠ null
 *
 * Metric denominators always use Stage 4 (evaluation_eligible = true).
 * NOT_ELIGIBLE, ABNORMAL_END, NO_PREGAME_SNAPSHOT, MISSING_PROBS are counted
 * in Stage 1 but excluded from Stage 4.
 *
 * OE-4 — PE Observation & Evaluation Plan v1.1
 */

import type { EvaluationRecord } from './evaluation-store.js';

// ── Output types ──────────────────────────────────────────────────────────────

export interface CoverageFunnel {
  // 5-stage funnel
  total_in_scope: number;            // Stage 1
  with_pregame_snapshot: number;     // Stage 2
  with_ground_truth: number;         // Stage 3
  fully_evaluable: number;           // Stage 4
  with_ui_observation: number;       // Stage 5

  // Exclusion breakdown
  NOT_ELIGIBLE_count: number;
  NO_PREGAME_SNAPSHOT_count: number;
  MISSING_PROBS_count: number;
  ABNORMAL_END_count: number;

  // Lifecycle breakdown
  status_distribution: Record<string, number>;   // by record_status
  mode_distribution: Record<string, number>;      // by mode
}

export interface PerformanceMetrics {
  accuracy_total: number | null;
  confusion_matrix: Record<string, Record<string, number>> | null;
  brier_score_total: number | null;
  log_loss_total: number | null;
  by_mode: Record<string, ModeMetrics>;
  by_calibration_mode: Record<string, CalibrationMetrics>;
  baseline_b_accuracy: number | null;
}

export interface ModeMetrics {
  count: number;
  accuracy: number | null;
  brier: number | null;
  log_loss: number | null;
}

export interface CalibrationMetrics {
  count: number;
  accuracy: number | null;
  brier: number | null;
}

export interface OperationalMetrics {
  runtime_error_count: number;
  endpoint_miss_count: number;
  snapshot_miss_count: number;
  scope_mismatch_count: number;
}

export interface EvaluationMetrics {
  coverage_funnel: CoverageFunnel;
  performance: PerformanceMetrics;
  operational: OperationalMetrics;
  computed_at: string;
  total_records: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const OUTCOMES = ['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const;
type Outcome = (typeof OUTCOMES)[number];

function nullableAvg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function indicator(actual: Outcome, target: Outcome): number {
  return actual === target ? 1 : 0;
}

function brierComponent(p_home: number, p_draw: number, p_away: number, actual: Outcome): number {
  return (
    Math.pow(p_home - indicator(actual, 'HOME_WIN'), 2) +
    Math.pow(p_draw - indicator(actual, 'DRAW'), 2) +
    Math.pow(p_away - indicator(actual, 'AWAY_WIN'), 2)
  );
}

const EPSILON = 1e-15;

function logLossComponent(p_home: number, p_draw: number, p_away: number, actual: Outcome): number {
  const p = actual === 'HOME_WIN' ? p_home : actual === 'DRAW' ? p_draw : p_away;
  return -Math.log(Math.max(p, EPSILON));
}

type RecordWithProbs = EvaluationRecord & {
  p_home_win: number;
  p_draw: number;
  p_away_win: number;
  actual_result: Outcome;
};

function hasValidProbs(r: EvaluationRecord): r is RecordWithProbs {
  return (
    r.evaluation_eligible &&
    r.actual_result !== null &&
    typeof r.p_home_win === 'number' &&
    typeof r.p_draw === 'number' &&
    typeof r.p_away_win === 'number'
  );
}

function computeAccuracy(records: EvaluationRecord[]): number | null {
  const evaluable = records.filter(
    (r) => r.evaluation_eligible && r.actual_result !== null && r.predicted_result !== null,
  );
  if (evaluable.length === 0) return null;
  const hits = evaluable.filter((r) => r.predicted_result === r.actual_result).length;
  return hits / evaluable.length;
}

function computeBrier(records: EvaluationRecord[]): number | null {
  const probRecords = records.filter(hasValidProbs);
  if (probRecords.length === 0) return null;
  return nullableAvg(
    probRecords.map((r) => brierComponent(r.p_home_win, r.p_draw, r.p_away_win, r.actual_result)),
  );
}

function computeLogLoss(records: EvaluationRecord[]): number | null {
  const probRecords = records.filter(hasValidProbs);
  if (probRecords.length === 0) return null;
  return nullableAvg(
    probRecords.map((r) => logLossComponent(r.p_home_win, r.p_draw, r.p_away_win, r.actual_result)),
  );
}

function computeConfusionMatrix(
  records: EvaluationRecord[],
): Record<string, Record<string, number>> | null {
  const evaluable = records.filter(
    (r) => r.evaluation_eligible && r.actual_result !== null && r.predicted_result !== null,
  );
  if (evaluable.length === 0) return null;

  const matrix: Record<string, Record<string, number>> = {};
  for (const pred of OUTCOMES) {
    matrix[pred] = {};
    for (const actual of OUTCOMES) matrix[pred][actual] = 0;
  }

  for (const r of evaluable) {
    const pred = r.predicted_result!;
    const actual = r.actual_result!;
    if (!matrix[pred]) matrix[pred] = {};
    matrix[pred][actual] = (matrix[pred][actual] ?? 0) + 1;
  }
  return matrix;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function computeMetrics(records: EvaluationRecord[]): EvaluationMetrics {

  // ── Coverage funnel ───────────────────────────────────────────────────────

  // Stage 1: all records
  const total_in_scope = records.length;

  // Stage 2: has valid pre-kickoff snapshot (SNAPSHOT_FROZEN or COMPLETE)
  const withPregame = records.filter(
    (r) => r.record_status === 'SNAPSHOT_FROZEN' || r.record_status === 'COMPLETE',
  );

  // Stage 3: ground truth captured
  const withGroundTruth = records.filter((r) => r.ground_truth_status === 'CAPTURED');

  // Stage 4: fully evaluable
  const fullyEvaluable = records.filter((r) => r.evaluation_eligible);

  // Stage 5: UI render recorded
  const withUiObservation = records.filter((r) => r.ui_render_result !== null);

  // Exclusion breakdown
  const NOT_ELIGIBLE_count = records.filter((r) => r.excluded_reason === 'NOT_ELIGIBLE').length;
  const NO_PREGAME_SNAPSHOT_count = records.filter((r) => r.excluded_reason === 'NO_PREGAME_SNAPSHOT').length;
  const MISSING_PROBS_count = records.filter((r) => r.excluded_reason === 'MISSING_PROBS').length;
  const ABNORMAL_END_count = records.filter((r) => r.excluded_reason === 'ABNORMAL_END').length;

  // Lifecycle breakdown
  const status_distribution: Record<string, number> = {};
  const mode_distribution: Record<string, number> = {};
  for (const r of records) {
    status_distribution[r.record_status] = (status_distribution[r.record_status] ?? 0) + 1;
    mode_distribution[r.mode] = (mode_distribution[r.mode] ?? 0) + 1;
  }

  const coverage_funnel: CoverageFunnel = {
    total_in_scope,
    with_pregame_snapshot: withPregame.length,
    with_ground_truth: withGroundTruth.length,
    fully_evaluable: fullyEvaluable.length,
    with_ui_observation: withUiObservation.length,
    NOT_ELIGIBLE_count,
    NO_PREGAME_SNAPSHOT_count,
    MISSING_PROBS_count,
    ABNORMAL_END_count,
    status_distribution,
    mode_distribution,
  };

  // ── Categorical performance (Stage 4 denominator) ─────────────────────────

  const accuracy_total = computeAccuracy(fullyEvaluable);
  const confusion_matrix = computeConfusionMatrix(fullyEvaluable);
  const brier_score_total = computeBrier(fullyEvaluable);
  const log_loss_total = computeLogLoss(fullyEvaluable);

  // ── Segmented by mode ─────────────────────────────────────────────────────

  const by_mode: Record<string, ModeMetrics> = {};
  for (const mode of ['FULL_MODE', 'LIMITED_MODE']) {
    const modeRecords = fullyEvaluable.filter((r) => r.mode === mode);
    by_mode[mode] = {
      count: modeRecords.length,
      accuracy: computeAccuracy(modeRecords),
      brier: computeBrier(modeRecords),
      log_loss: computeLogLoss(modeRecords),
    };
  }

  // ── Segmented by calibration_mode ─────────────────────────────────────────

  const calibrationKeys = new Set(fullyEvaluable.map((r) => r.calibration_mode ?? '__null__'));
  const by_calibration_mode: Record<string, CalibrationMetrics> = {};
  for (const key of calibrationKeys) {
    const calRecords = fullyEvaluable.filter(
      (r) => (r.calibration_mode ?? '__null__') === key,
    );
    by_calibration_mode[key === '__null__' ? 'null' : key] = {
      count: calRecords.length,
      accuracy: computeAccuracy(calRecords),
      brier: computeBrier(calRecords),
    };
  }

  // ── Baseline B: naïve most-frequent class ─────────────────────────────────
  // Only Baseline B is computed. Baseline A (argmax of model probabilities) is
  // tautologically equivalent to the model's own predicted_result field.

  let baseline_b_accuracy: number | null = null;
  const groundTruthEvaluable = fullyEvaluable.filter((r) => r.actual_result !== null);
  if (groundTruthEvaluable.length > 0) {
    const freq: Record<string, number> = {};
    for (const r of groundTruthEvaluable) {
      freq[r.actual_result!] = (freq[r.actual_result!] ?? 0) + 1;
    }
    const mostCommon = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] as Outcome | undefined;
    if (mostCommon) {
      baseline_b_accuracy =
        groundTruthEvaluable.filter((r) => r.actual_result === mostCommon).length /
        groundTruthEvaluable.length;
    }
  }

  const performance: PerformanceMetrics = {
    accuracy_total,
    confusion_matrix,
    brier_score_total,
    log_loss_total,
    by_mode,
    by_calibration_mode,
    baseline_b_accuracy,
  };

  // ── Operational quality ───────────────────────────────────────────────────

  const operational: OperationalMetrics = {
    runtime_error_count: records.filter(
      (r) => r.runtime_issue !== null && r.runtime_issue !== 'NONE',
    ).length,
    endpoint_miss_count: records.filter(
      (r) => r.ui_render_result === 'NO_RENDER' && r.prediction_available,
    ).length,
    snapshot_miss_count: records.filter((r) => !r.prediction_available).length,
    scope_mismatch_count: records.filter((r) => r.runtime_issue === 'SCOPE_MISMATCH').length,
  };

  return {
    coverage_funnel,
    performance,
    operational,
    computed_at: new Date().toISOString(),
    total_records: total_in_scope,
  };
}

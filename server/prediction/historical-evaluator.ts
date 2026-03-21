/**
 * historical-evaluator.ts — interpretable evaluation of historical backtest snapshots.
 *
 * Reads HistoricalBacktestSnapshot[] produced by H3 (HistoricalBacktestRunner) and
 * produces a HistoricalEvaluationReport with:
 *   - Explicit denominator and exclusion breakdown
 *   - Confusion matrix (rows=actual, cols=predicted)
 *   - Brier score and log loss
 *   - Naive baselines: MOST_FREQUENT_CLASS and ALWAYS_HOME_WIN
 *   - Mode-separated metrics (FULL_MODE / LIMITED_MODE)
 *   - Symmetry evidence (historical Elo vs baseline)
 *
 * Storage: cache/predictions/historical-evaluation.json
 *
 * H4/H4b — Historical Evaluation Layer + Probabilistic Diagnostics
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CACHE_BASE } from '../cache-dir.js';

import type { HistoricalBacktestSnapshot } from './historical-backtest-store.js';

// ── Constants ──────────────────────────────────────────────────────────────

const EPSILON = 1e-15;
const OUTCOMES = ['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const;
type Outcome = (typeof OUTCOMES)[number];

const DEFAULT_FILE_PATH = path.join(CACHE_BASE, 'predictions/historical-evaluation.json');

// ── Sub-types ─────────────────────────────────────────────────────────────

export interface ExclusionBreakdown {
  /** build_status = NOT_ELIGIBLE — validation layer said model can't run. */
  not_eligible: number;
  /** build_status = ERROR — pipeline threw. */
  error: number;
  /**
   * mode = LIMITED_MODE and predicted_result = null.
   * LIMITED_MODE has no calibrated probs → decision policy cannot produce a result.
   * Still has expected_goals_home/away but not evaluable for accuracy.
   */
  limited_mode_no_prediction: number;
  /**
   * mode = FULL_MODE and predicted_result = null.
   * Decision policy abstained (|top1 - top2| < too_close_threshold).
   */
  too_close: number;

  total_excluded: number;
  total_snapshots: number;
  /** Denominator for all accuracy/Brier/log-loss computations. */
  evaluable: number;
}

/**
 * Confusion matrix: rows = actual result, columns = predicted result.
 *
 *          pred HOME_WIN  pred DRAW  pred AWAY_WIN
 * act HOME_WIN   ...
 * act DRAW       ...
 * act AWAY_WIN   ...
 */
export interface ConfusionMatrix {
  HOME_WIN: { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
  DRAW:     { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
  AWAY_WIN: { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
}

export interface SliceMetrics {
  /** Evaluable records in this slice. This is the denominator. */
  denominator: number;
  /** Correct predictions / denominator. */
  accuracy: number;
  /** Correct predictions count. */
  correct: number;
  /**
   * Multi-class Brier score (per record):
   *   BS = Σ_{outcome} (p_outcome - I_outcome)²
   * Null when probabilities are absent (LIMITED_MODE records).
   */
  brier_score: number | null;
  /**
   * Single-class log loss:
   *   LL = -log(p_actual_class), clipped at epsilon.
   * Null when probabilities are absent.
   */
  log_loss: number | null;
  /** Records with probability scores (brier/log-loss denominator). */
  prob_denominator: number;
  confusion_matrix: ConfusionMatrix;
}

export interface BaselineResult {
  strategy: 'MOST_FREQUENT_CLASS' | 'ALWAYS_HOME_WIN';
  /** The single class this baseline always predicts. */
  always_predicts: Outcome;
  denominator: number;
  correct: number;
  accuracy: number;
  confusion_matrix: ConfusionMatrix;
}

/**
 * Probabilistic baseline: assigns a fixed probability vector to every record.
 *
 * Two variants:
 *   - UNIFORM: (1/3, 1/3, 1/3) — maximally ignorant
 *   - EMPIRICAL_FREQ: actual class frequencies computed from the evaluated slice
 *
 * Brier and log-loss are computed on the same FULL_MODE prob-denominator used
 * by the model (records with non-null p_home_win, i.e., all FULL_MODE evaluable).
 */
export interface ProbabilisticBaselineResult {
  strategy: 'UNIFORM' | 'EMPIRICAL_FREQ';
  /** Fixed probability vector applied to every record. */
  probs: { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
  /** Records with probabilities available (matches model prob_denominator). */
  prob_denominator: number;
  brier_score: number | null;
  log_loss: number | null;
}

/**
 * How many times the model predicted each class (over evaluable records).
 * Used to diagnose class collapse (e.g., zero DRAW predictions).
 */
export interface PredictionClassDistribution {
  HOME_WIN: number;
  DRAW: number;
  AWAY_WIN: number;
}

/**
 * Actual outcome distribution within the evaluated slice.
 */
export interface ActualClassDistribution {
  HOME_WIN: number;
  DRAW: number;
  AWAY_WIN: number;
  total: number;
}

export interface HistoricalEvaluationReport {
  source_type: 'HISTORICAL_BACKTEST';
  competition_code: string;
  generated_at: string;

  exclusion_breakdown: ExclusionBreakdown;

  /**
   * FULL_MODE only: calibrated probs + decision policy applied.
   * This is the primary slice for Brier/log-loss (probs available).
   */
  full_mode_metrics: SliceMetrics | null;

  /**
   * LIMITED_MODE only: no calibrated probs → accuracy computed from predicted_result
   * when non-null; Brier/log-loss always null.
   */
  limited_mode_metrics: SliceMetrics | null;

  /**
   * Combined: all evaluable records (FULL + LIMITED with non-null predicted_result).
   * This is the headline accuracy metric.
   * denominator = exclusion_breakdown.evaluable.
   */
  combined_metrics: SliceMetrics | null;

  /** Actual outcome distribution within the evaluable set. */
  actual_class_distribution: ActualClassDistribution | null;

  /** How many times the model predicted each class. */
  prediction_class_distribution: PredictionClassDistribution | null;

  /** Categorical naive baselines (same evaluable set as combined_metrics). */
  baselines: {
    most_frequent_class: BaselineResult;
    always_home_win: BaselineResult;
  } | null;

  /**
   * Probabilistic baselines computed over FULL_MODE records with probs.
   * Denominator matches combined_metrics.prob_denominator.
   */
  probabilistic_baselines: {
    uniform: ProbabilisticBaselineResult;
    empirical_freq: ProbabilisticBaselineResult;
  } | null;

  /** Categorical comparisons */
  beats_most_frequent_class: boolean | null;
  beats_always_home_win: boolean | null;

  /**
   * Probabilistic comparisons (lower Brier/log-loss = better).
   * null when either the model or the baseline has no prob score.
   */
  beats_uniform_brier: boolean | null;
  beats_uniform_log_loss: boolean | null;
  beats_empirical_brier: boolean | null;
  beats_empirical_log_loss: boolean | null;

  /**
   * Symmetry evidence: how many SUCCESS records have different probs
   * from their symmetric baseline (1500/1500 no home advantage).
   */
  elo_breaks_symmetry: number;
  elo_breaks_symmetry_denominator: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyConfusion(): ConfusionMatrix {
  return {
    HOME_WIN: { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 },
    DRAW:     { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 },
    AWAY_WIN: { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 },
  };
}

function computeSliceMetrics(records: HistoricalBacktestSnapshot[]): SliceMetrics {
  const confusion = emptyConfusion();
  let correct = 0;
  let totalBrier = 0, brierN = 0;
  let totalLogLoss = 0, llN = 0;

  for (const s of records) {
    const actual = s.actual_result as Outcome;
    const predicted = s.predicted_result as Outcome;

    confusion[actual][predicted]++;
    if (predicted === actual) correct++;

    // Probabilistic metrics (require calibrated probs — only FULL_MODE)
    if (s.p_home_win !== null && s.p_draw !== null && s.p_away_win !== null) {
      const probs: Record<Outcome, number> = {
        HOME_WIN: s.p_home_win,
        DRAW:     s.p_draw,
        AWAY_WIN: s.p_away_win,
      };

      // Multi-class Brier: sum of squared errors over all outcomes
      let brier = 0;
      for (const outcome of OUTCOMES) {
        const indicator = outcome === actual ? 1 : 0;
        brier += (probs[outcome] - indicator) ** 2;
      }
      totalBrier += brier;
      brierN++;

      // Single-class log loss: -log(p_actual), clipped
      totalLogLoss += -Math.log(Math.max(probs[actual], EPSILON));
      llN++;
    }
  }

  return {
    denominator: records.length,
    accuracy: records.length > 0 ? correct / records.length : 0,
    correct,
    brier_score: brierN > 0 ? totalBrier / brierN : null,
    log_loss: llN > 0 ? totalLogLoss / llN : null,
    prob_denominator: brierN,
    confusion_matrix: confusion,
  };
}

function computeBaseline(
  records: HistoricalBacktestSnapshot[],
  strategy: 'MOST_FREQUENT_CLASS' | 'ALWAYS_HOME_WIN',
): BaselineResult {
  // Determine which class this baseline always predicts
  let alwaysPredicts: Outcome;
  if (strategy === 'ALWAYS_HOME_WIN') {
    alwaysPredicts = 'HOME_WIN';
  } else {
    // Find most frequent actual class in the evaluable set
    const freq: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
    for (const s of records) freq[s.actual_result as Outcome]++;
    alwaysPredicts = (Object.entries(freq) as [Outcome, number][])
      .sort((a, b) => b[1] - a[1])[0][0];
  }

  const confusion = emptyConfusion();
  let correct = 0;
  for (const s of records) {
    const actual = s.actual_result as Outcome;
    confusion[actual][alwaysPredicts]++;
    if (actual === alwaysPredicts) correct++;
  }

  return {
    strategy,
    always_predicts: alwaysPredicts,
    denominator: records.length,
    correct,
    accuracy: records.length > 0 ? correct / records.length : 0,
    confusion_matrix: confusion,
  };
}

/**
 * Compute Brier and log-loss for a fixed probability vector applied to every record.
 * Only processes records that have actual probabilities (FULL_MODE with non-null probs).
 */
function computeProbabilisticBaseline(
  records: HistoricalBacktestSnapshot[],
  strategy: 'UNIFORM' | 'EMPIRICAL_FREQ',
  probs: { HOME_WIN: number; DRAW: number; AWAY_WIN: number },
): ProbabilisticBaselineResult {
  // Only include records that have calibrated probs (FULL_MODE)
  const withProbs = records.filter(
    (s) => s.p_home_win !== null && s.p_draw !== null && s.p_away_win !== null,
  );

  let totalBrier = 0;
  let totalLogLoss = 0;

  for (const s of withProbs) {
    const actual = s.actual_result as Outcome;
    let brier = 0;
    for (const outcome of OUTCOMES) {
      const indicator = outcome === actual ? 1 : 0;
      brier += (probs[outcome] - indicator) ** 2;
    }
    totalBrier += brier;
    totalLogLoss += -Math.log(Math.max(probs[actual], EPSILON));
  }

  return {
    strategy,
    probs,
    prob_denominator: withProbs.length,
    brier_score: withProbs.length > 0 ? totalBrier / withProbs.length : null,
    log_loss: withProbs.length > 0 ? totalLogLoss / withProbs.length : null,
  };
}

// ── Main computation ───────────────────────────────────────────────────────

export function computeHistoricalEvaluation(
  snapshots: HistoricalBacktestSnapshot[],
  competitionCode: string,
): HistoricalEvaluationReport {
  // ── Partition by exclusion reason ──────────────────────────────────────
  let not_eligible = 0;
  let error = 0;
  let limited_mode_no_prediction = 0;
  let too_close = 0;

  const fullModeEval: HistoricalBacktestSnapshot[] = [];
  const limitedModeEval: HistoricalBacktestSnapshot[] = [];

  for (const s of snapshots) {
    if (s.build_status === 'NOT_ELIGIBLE') { not_eligible++; continue; }
    if (s.build_status === 'ERROR')        { error++; continue; }

    if (s.mode === 'LIMITED_MODE' && s.predicted_result === null) {
      limited_mode_no_prediction++;
      continue;
    }
    if (s.mode === 'FULL_MODE' && s.predicted_result === null) {
      too_close++;
      continue;
    }

    // Evaluable
    if (s.mode === 'FULL_MODE')      fullModeEval.push(s);
    else if (s.mode === 'LIMITED_MODE') limitedModeEval.push(s);
    // If mode is something else and predicted_result is non-null, include in combined
  }

  const evaluable = fullModeEval.length + limitedModeEval.length;
  const totalExcluded = not_eligible + error + limited_mode_no_prediction + too_close;

  const exclusion_breakdown: ExclusionBreakdown = {
    not_eligible,
    error,
    limited_mode_no_prediction,
    too_close,
    total_excluded: totalExcluded,
    total_snapshots: snapshots.length,
    evaluable,
  };

  // ── Per-mode metrics ───────────────────────────────────────────────────
  const full_mode_metrics = fullModeEval.length > 0
    ? computeSliceMetrics(fullModeEval)
    : null;
  const limited_mode_metrics = limitedModeEval.length > 0
    ? computeSliceMetrics(limitedModeEval)
    : null;

  const allEval = [...fullModeEval, ...limitedModeEval];
  const combined_metrics = allEval.length > 0
    ? computeSliceMetrics(allEval)
    : null;

  // ── Actual class distribution (within evaluable set) ──────────────────
  let actual_class_distribution: ActualClassDistribution | null = null;
  let prediction_class_distribution: PredictionClassDistribution | null = null;

  if (allEval.length > 0) {
    const acd: ActualClassDistribution = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0, total: allEval.length };
    const pcd: PredictionClassDistribution = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
    for (const s of allEval) {
      acd[s.actual_result as Outcome]++;
      pcd[s.predicted_result as Outcome]++;
    }
    actual_class_distribution = acd;
    prediction_class_distribution = pcd;
  }

  // ── Categorical baselines (same evaluable set as combined) ─────────────
  let baselines: HistoricalEvaluationReport['baselines'] = null;
  if (allEval.length > 0) {
    baselines = {
      most_frequent_class: computeBaseline(allEval, 'MOST_FREQUENT_CLASS'),
      always_home_win:     computeBaseline(allEval, 'ALWAYS_HOME_WIN'),
    };
  }

  const beats_most_frequent_class =
    combined_metrics && baselines
      ? combined_metrics.accuracy > baselines.most_frequent_class.accuracy
      : null;
  const beats_always_home_win =
    combined_metrics && baselines
      ? combined_metrics.accuracy > baselines.always_home_win.accuracy
      : null;

  // ── Probabilistic baselines (FULL_MODE prob-denominator only) ─────────
  let probabilistic_baselines: HistoricalEvaluationReport['probabilistic_baselines'] = null;
  let beats_uniform_brier: boolean | null = null;
  let beats_uniform_log_loss: boolean | null = null;
  let beats_empirical_brier: boolean | null = null;
  let beats_empirical_log_loss: boolean | null = null;

  if (allEval.length > 0) {
    // Empirical class frequencies from the evaluated slice
    const freq = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
    for (const s of allEval) freq[s.actual_result as Outcome]++;
    const n = allEval.length;
    const empiricalProbs = {
      HOME_WIN: freq.HOME_WIN / n,
      DRAW:     freq.DRAW / n,
      AWAY_WIN: freq.AWAY_WIN / n,
    };

    const uniformBaseline = computeProbabilisticBaseline(
      allEval, 'UNIFORM', { HOME_WIN: 1/3, DRAW: 1/3, AWAY_WIN: 1/3 },
    );
    const empiricalBaseline = computeProbabilisticBaseline(
      allEval, 'EMPIRICAL_FREQ', empiricalProbs,
    );

    probabilistic_baselines = { uniform: uniformBaseline, empirical_freq: empiricalBaseline };

    const modelBrier = full_mode_metrics?.brier_score ?? null;
    const modelLogLoss = full_mode_metrics?.log_loss ?? null;

    // Lower is better for both metrics
    beats_uniform_brier =
      modelBrier !== null && uniformBaseline.brier_score !== null
        ? modelBrier < uniformBaseline.brier_score : null;
    beats_uniform_log_loss =
      modelLogLoss !== null && uniformBaseline.log_loss !== null
        ? modelLogLoss < uniformBaseline.log_loss : null;
    beats_empirical_brier =
      modelBrier !== null && empiricalBaseline.brier_score !== null
        ? modelBrier < empiricalBaseline.brier_score : null;
    beats_empirical_log_loss =
      modelLogLoss !== null && empiricalBaseline.log_loss !== null
        ? modelLogLoss < empiricalBaseline.log_loss : null;
  }

  // ── Symmetry evidence ─────────────────────────────────────────────────
  const successRecords = snapshots.filter((s) => s.build_status === 'SUCCESS');
  const eloBreaks = successRecords.filter(
    (s) =>
      s.p_home_win !== s.baseline_p_home_win ||
      s.p_draw !== s.baseline_p_draw ||
      s.p_away_win !== s.baseline_p_away_win,
  ).length;

  return {
    source_type: 'HISTORICAL_BACKTEST',
    competition_code: competitionCode,
    generated_at: new Date().toISOString(),
    exclusion_breakdown,
    full_mode_metrics,
    limited_mode_metrics,
    combined_metrics,
    actual_class_distribution,
    prediction_class_distribution,
    baselines,
    probabilistic_baselines,
    beats_most_frequent_class,
    beats_always_home_win,
    beats_uniform_brier,
    beats_uniform_log_loss,
    beats_empirical_brier,
    beats_empirical_log_loss,
    elo_breaks_symmetry: eloBreaks,
    elo_breaks_symmetry_denominator: successRecords.length,
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

interface EvalFileDoc {
  version: 1;
  savedAt: string;
  reports: HistoricalEvaluationReport[];
}

export function persistEvaluationReport(
  report: HistoricalEvaluationReport,
  filePath: string = DEFAULT_FILE_PATH,
): void {
  // Load existing reports so we can replace/add for this competition
  let existingReports: HistoricalEvaluationReport[] = [];
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const doc = JSON.parse(raw) as unknown;
      if (
        doc !== null &&
        typeof doc === 'object' &&
        (doc as Record<string, unknown>)['version'] === 1 &&
        Array.isArray((doc as Record<string, unknown>)['reports'])
      ) {
        existingReports = (doc as EvalFileDoc).reports;
      }
    }
  } catch { /* ignore read errors — overwrite clean */ }

  // Replace report for this competition
  const updated = [
    ...existingReports.filter((r) => r.competition_code !== report.competition_code),
    report,
  ];

  const doc: EvalFileDoc = {
    version: 1,
    savedAt: new Date().toISOString(),
    reports: updated,
  };

  const tmpPath = filePath.replace(/\.json$/, '.tmp');
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    console.log(`[HistoricalEvaluator] Saved evaluation report → ${filePath}`);
  } catch (err) {
    console.error('[HistoricalEvaluator] persist failed:', err);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

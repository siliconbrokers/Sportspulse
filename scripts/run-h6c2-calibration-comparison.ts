/**
 * H6c2 — Offline calibration method comparison.
 *
 * Compares multiple calibration strategies to find one that materially
 * improves the DRAW channel without severely degrading log-loss or Brier.
 *
 * Context: H6c showed OVR_ISOTONIC recovers DRAW (predD: 0→12) but
 * catastrophically worsens log-loss (+0.9438). H6c2 tests smoother
 * alternatives: temperature scaling and draw-boosted temperature.
 *
 * Variants:
 *   A. RAW_BASELINE              — raw Poisson probs, no calibration
 *   B. IDENTITY_CURRENT          — identity calibration (= RAW, explicit ref)
 *   C. OVR_ISOTONIC_CURRENT      — H6c control (one-vs-rest isotonic PAVA)
 *   D. TEMPERATURE_SCALING       — T fit by NLL grid search on train set
 *   E. DRAW_BOOSTED_TEMPERATURE  — separate T_D > T for DRAW channel only
 *
 * Acceptance thresholds (vs RAW_BASELINE):
 *   Hard rejection:  Δ log-loss > +0.50 OR Δ Brier > +0.050
 *   PROMISING:       DRAW improved AND Δ log-loss ≤ +0.15 AND Δ Brier ≤ +0.015
 *   ACCEPTABLE:      DRAW improved AND not hard-rejected
 *   NO_GAIN:         predD = 0 AND p_draw_avg Δ < +1pp
 *
 * Final classification: NO_CALIBRATION_METHOD_ACCEPTABLE /
 *                       ONE_METHOD_PROMISING / MULTIPLE_METHODS_PROMISING
 *
 * Hard constraints (same as H6c):
 *   - No production defaults changed
 *   - No TOO_CLOSE threshold changes
 *   - No raw generator changes
 *   - No portal rollout
 *   - Fully offline + reversible
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-h6c2-calibration-comparison.ts
 */
import 'dotenv/config';

import { FootballDataSource } from '../server/football-data-source.js';
import { PredictionService } from '../server/prediction/prediction-service.js';
import { HistoricalStateService } from '../server/prediction/historical-state-service.js';
import { HistoricalBacktestStore } from '../server/prediction/historical-backtest-store.js';
import { HistoricalBacktestRunner } from '../server/prediction/historical-backtest-runner.js';
import {
  fitOneVsRestCalibrators,
  applyOneVsRestCalibration,
  IsotonicCalibrator,
} from '@sportpulse/prediction';

// ── Constants ──────────────────────────────────────────────────────────────

/** Production decision-policy v1.0 threshold. §16.12. Do NOT change. */
const TOO_CLOSE_THRESHOLD = 0.02;

/** Temporal split: train fraction. Eval fraction = 1 - TRAIN_FRACTION. */
const TRAIN_FRACTION = 0.60;

const EPSILON_LL = 1e-15;

/** Temperature grid for uniform scaling. */
const TEMP_GRID = [0.5, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0, 4.0, 5.0];

/** T_D multipliers relative to T_fixed for draw-boosted search. */
const T_D_MULTS = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.0, 10.0];

// ── Types ─────────────────────────────────────────────────────────────────

type Outcome = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';

interface EvalRecord {
  actual: Outcome;
  kickoff_utc: string;
  match_id: string;
  raw_home: number;
  raw_draw: number;
  raw_away: number;
}

interface Probs1x2 {
  home: number;
  draw: number;
  away: number;
}

interface VariantResult {
  label: string;
  n_eval: number;
  actual_dist: Record<Outcome, number>;
  accuracy: number | null;
  n_correct: number;
  n_evaluable: number;
  n_too_close: number;
  brier: number;
  log_loss: number;
  pred_dist: Record<Outcome, number>;
  n_too_close_pred: number;
  // DRAW-specific
  draw_n: number;
  draw_pred_count: number;
  draw_p_avg: number | null;
  draw_p_median: number | null;
  draw_p_max: number | null;
  draw_p_gt25: number;
  draw_p_gt30: number;
  draw_avg_sel_minus_draw: number | null;
  draw_top1_count: number;
  // Non-DRAW channels
  home_hit_rate: number | null;
  home_avg_p: number | null;
  away_hit_rate: number | null;
  away_avg_p: number | null;
}

type VerdictCode = 'PROMISING' | 'ACCEPTABLE' | 'REJECTED' | 'NO_GAIN' | 'BASELINE';

interface Verdict {
  code: VerdictCode;
  reason: string;
}

// ── Temperature scaling ────────────────────────────────────────────────────

/** Uniform temperature scaling: (pH^(1/T), pD^(1/T), pA^(1/T)) / Σ */
function applyTempScaling(p: Probs1x2, T: number): Probs1x2 {
  const exp = 1 / T;
  const h = Math.pow(Math.max(p.home, EPSILON_LL), exp);
  const d = Math.pow(Math.max(p.draw, EPSILON_LL), exp);
  const a = Math.pow(Math.max(p.away, EPSILON_LL), exp);
  const sum = h + d + a;
  return { home: h / sum, draw: d / sum, away: a / sum };
}

/** Draw-boosted temperature: DRAW gets T_D, HOME+AWAY share T. T_D ≥ T. */
function applyDrawBoostedTemp(p: Probs1x2, T: number, T_D: number): Probs1x2 {
  const expT = 1 / T;
  const expTD = 1 / T_D;
  const h = Math.pow(Math.max(p.home, EPSILON_LL), expT);
  const d = Math.pow(Math.max(p.draw, EPSILON_LL), expTD);
  const a = Math.pow(Math.max(p.away, EPSILON_LL), expT);
  const sum = h + d + a;
  return { home: h / sum, draw: d / sum, away: a / sum };
}

/** Average NLL on a record set given a prob function. */
function avgNll(records: EvalRecord[], probsFn: (r: EvalRecord) => Probs1x2): number {
  let sum = 0;
  for (const r of records) {
    const p = probsFn(r);
    const pActual =
      r.actual === 'HOME_WIN' ? p.home :
      r.actual === 'DRAW' ? p.draw : p.away;
    sum += -Math.log(Math.max(pActual, EPSILON_LL));
  }
  return records.length === 0 ? 0 : sum / records.length;
}

/** Count of actual DRAW train records where DRAW is top-1 after transform. */
function drawTop1OnTrain(records: EvalRecord[], probsFn: (r: EvalRecord) => Probs1x2): number {
  const drawRecs = records.filter((r) => r.actual === 'DRAW');
  return drawRecs.filter((r) => {
    const p = probsFn(r);
    return p.draw >= p.home && p.draw >= p.away;
  }).length;
}

interface TempFitResult {
  T: number;
  trainNll: number;
  drawTop1Train: number;
}

/** Grid search T by NLL minimization on train set. */
function fitTemperature(trainSet: EvalRecord[]): TempFitResult {
  let best: TempFitResult = { T: 1.0, trainNll: Infinity, drawTop1Train: 0 };
  for (const T of TEMP_GRID) {
    const trainNll = avgNll(trainSet, (r) =>
      applyTempScaling({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }, T),
    );
    const drawTop1 = drawTop1OnTrain(trainSet, (r) =>
      applyTempScaling({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }, T),
    );
    if (trainNll < best.trainNll) {
      best = { T, trainNll, drawTop1Train: drawTop1 };
    }
  }
  return best;
}

interface DrawBoostedFitResult {
  T: number;
  T_D: number;
  trainNll: number;
  drawTop1Train: number;
}

/**
 * Grid search T_D with T_fixed.
 * Objective: maximize DRAW top-1 on training draws.
 * Tiebreak: minimize train NLL.
 */
function fitDrawBoostedTemp(trainSet: EvalRecord[], T_fixed: number): DrawBoostedFitResult {
  let best: DrawBoostedFitResult = {
    T: T_fixed,
    T_D: T_fixed,
    trainNll: Infinity,
    drawTop1Train: -1,
  };
  for (const mult of T_D_MULTS) {
    const T_D = T_fixed * mult;
    const fn = (r: EvalRecord) =>
      applyDrawBoostedTemp({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }, T_fixed, T_D);
    const trainNll = avgNll(trainSet, fn);
    const drawTop1 = drawTop1OnTrain(trainSet, fn);
    const better =
      drawTop1 > best.drawTop1Train ||
      (drawTop1 === best.drawTop1Train && trainNll < best.trainNll);
    if (better) {
      best = { T: T_fixed, T_D, trainNll, drawTop1Train: drawTop1 };
    }
  }
  return best;
}

// ── Statistics helpers ─────────────────────────────────────────────────────

function medianSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function avgArr(arr: number[]): number | null {
  return arr.length === 0 ? null : arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ── Decision rule (apply TOO_CLOSE but do NOT change the constant) ─────────

function decisionPrediction(probs: Probs1x2): { cls: Outcome | null; margin: number } {
  const pairs: [Outcome, number][] = [
    ['HOME_WIN', probs.home],
    ['DRAW', probs.draw],
    ['AWAY_WIN', probs.away],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  const top1 = pairs[0]!;
  const top2 = pairs[1]!;
  const margin = top1[1] - top2[1];
  if (margin < TOO_CLOSE_THRESHOLD) return { cls: null, margin };
  return { cls: top1[0], margin };
}

// ── Scoring metrics ────────────────────────────────────────────────────────

function brierScore(probs: Probs1x2, actual: Outcome): number {
  const iH = actual === 'HOME_WIN' ? 1 : 0;
  const iD = actual === 'DRAW' ? 1 : 0;
  const iA = actual === 'AWAY_WIN' ? 1 : 0;
  return (probs.home - iH) ** 2 + (probs.draw - iD) ** 2 + (probs.away - iA) ** 2;
}

function logLoss(probs: Probs1x2, actual: Outcome): number {
  const p =
    actual === 'HOME_WIN' ? probs.home :
    actual === 'DRAW' ? probs.draw : probs.away;
  return -Math.log(Math.max(p, EPSILON_LL));
}

function top1Class(probs: Probs1x2): Outcome {
  if (probs.home >= probs.draw && probs.home >= probs.away) return 'HOME_WIN';
  if (probs.draw >= probs.home && probs.draw >= probs.away) return 'DRAW';
  return 'AWAY_WIN';
}

function selectedMinusDraw(probs: Probs1x2): number {
  const t = top1Class(probs);
  const top1P = t === 'HOME_WIN' ? probs.home : t === 'DRAW' ? probs.draw : probs.away;
  return top1P - probs.draw;
}

// ── Evaluate variant ───────────────────────────────────────────────────────

function evaluateVariant(
  label: string,
  evalRecords: EvalRecord[],
  probsFn: (r: EvalRecord) => Probs1x2,
): VariantResult {
  const n = evalRecords.length;
  const actualDist: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  const predDist: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  let nCorrect = 0, nEvaluable = 0, nTooClose = 0;
  let brierSum = 0, llSum = 0;

  const drawRecords: Array<{ probs: Probs1x2 }> = [];
  const homeRecords: Array<{ probs: Probs1x2; hit: boolean }> = [];
  const awayRecords: Array<{ probs: Probs1x2; hit: boolean }> = [];

  for (const rec of evalRecords) {
    actualDist[rec.actual]++;
    const probs = probsFn(rec);
    brierSum += brierScore(probs, rec.actual);
    llSum += logLoss(probs, rec.actual);
    const { cls } = decisionPrediction(probs);
    if (cls === null) {
      nTooClose++;
    } else {
      predDist[cls]++;
      nEvaluable++;
      if (cls === rec.actual) nCorrect++;
    }
    if (rec.actual === 'DRAW') {
      drawRecords.push({ probs });
    } else if (rec.actual === 'HOME_WIN') {
      homeRecords.push({ probs, hit: cls === 'HOME_WIN' });
    } else {
      awayRecords.push({ probs, hit: cls === 'AWAY_WIN' });
    }
  }

  const drawPVals = drawRecords.map((r) => r.probs.draw).sort((a, b) => a - b);
  const drawSMD = drawRecords.map((r) => selectedMinusDraw(r.probs));

  return {
    label,
    n_eval: n,
    actual_dist: actualDist,
    accuracy: nEvaluable === 0 ? null : nCorrect / nEvaluable,
    n_correct: nCorrect,
    n_evaluable: nEvaluable,
    n_too_close: nTooClose,
    brier: n === 0 ? 0 : brierSum / n,
    log_loss: n === 0 ? 0 : llSum / n,
    pred_dist: predDist,
    n_too_close_pred: nTooClose,
    draw_n: drawRecords.length,
    draw_pred_count: predDist.DRAW,
    draw_p_avg: avgArr(drawPVals),
    draw_p_median: medianSorted(drawPVals),
    draw_p_max: drawPVals.length > 0 ? drawPVals[drawPVals.length - 1]! : null,
    draw_p_gt25: drawPVals.filter((v) => v > 0.25).length,
    draw_p_gt30: drawPVals.filter((v) => v > 0.30).length,
    draw_avg_sel_minus_draw: avgArr(drawSMD),
    draw_top1_count: drawRecords.filter((r) => top1Class(r.probs) === 'DRAW').length,
    home_hit_rate: homeRecords.length === 0 ? null :
      homeRecords.filter((r) => r.hit).length / homeRecords.length,
    home_avg_p: avgArr(homeRecords.map((r) => r.probs.home)),
    away_hit_rate: awayRecords.length === 0 ? null :
      awayRecords.filter((r) => r.hit).length / awayRecords.length,
    away_avg_p: avgArr(awayRecords.map((r) => r.probs.away)),
  };
}

// ── Per-variant acceptance verdict ────────────────────────────────────────

function computeVerdict(v: VariantResult, baseline: VariantResult, isBaseline: boolean): Verdict {
  if (isBaseline) return { code: 'BASELINE', reason: 'reference' };

  const dLL = v.log_loss - baseline.log_loss;
  const dBrier = v.brier - baseline.brier;
  const drawGain =
    v.draw_pred_count > 0 ||
    (v.draw_p_avg ?? 0) > (baseline.draw_p_avg ?? 0) + 0.01;

  // Hard rejection: severely degrades probabilistic quality
  if (dLL > 0.50 || dBrier > 0.050) {
    return {
      code: 'REJECTED',
      reason: `LL Δ=${dLL >= 0 ? '+' : ''}${dLL.toFixed(3)}, Brier Δ=${dBrier >= 0 ? '+' : ''}${dBrier.toFixed(4)}`,
    };
  }

  if (!drawGain) {
    return { code: 'NO_GAIN', reason: `predD=0, p_avg Δ<1pp` };
  }

  // PROMISING: DRAW improved with minimal quality degradation
  if (dLL <= 0.15 && dBrier <= 0.015) {
    return {
      code: 'PROMISING',
      reason: `predD=${v.draw_pred_count}, LL Δ=${dLL >= 0 ? '+' : ''}${dLL.toFixed(3)}`,
    };
  }

  // ACCEPTABLE: DRAW improved, moderate quality cost but not rejected
  return {
    code: 'ACCEPTABLE',
    reason: `predD=${v.draw_pred_count}, LL Δ=${dLL >= 0 ? '+' : ''}${dLL.toFixed(3)}`,
  };
}

function verdictPad(v: Verdict): string {
  const icons: Record<VerdictCode, string> = {
    PROMISING: '✓ PROMISING',
    ACCEPTABLE: '~ ACCEPTABLE',
    REJECTED: '✗ REJECTED',
    NO_GAIN: '  NO_GAIN',
    BASELINE: '  (ref)',
  };
  return (icons[v.code] ?? '').padEnd(14);
}

// ── Formatting ─────────────────────────────────────────────────────────────

function pct(v: number | null, d = 1): string {
  if (v === null) return '   n/a';
  return (v * 100).toFixed(d).padStart(6) + '%';
}
function num(v: number, d = 3): string {
  return v.toFixed(d).padStart(7);
}
function pad(s: string | number, w: number, right = false): string {
  const str = String(s);
  return right ? str.padEnd(w) : str.padStart(w);
}
function sign(v: number): string {
  return v >= 0 ? '+' : '';
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const apiToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!apiToken) { console.error('FOOTBALL_DATA_TOKEN not set'); process.exit(1); }

  const CODE = 'PD';
  const COMP_ID = `comp:football-data:${CODE}`;

  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  H6c2 — Calibration Method Comparison — LaLiga (PD) 2025-26               ║');
  console.log('║  Variants: RAW | IDENTITY | OVR_ISOTONIC | TEMP_SCALING | DRAW_BOOSTED     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  // ── Run historical backtest ───────────────────────────────────────────────
  process.stdout.write('Running historical backtest to collect raw probs...\n');
  const ds = new FootballDataSource(apiToken);
  await ds.fetchCompetition(CODE);

  const store = new HistoricalBacktestStore();
  const runner = new HistoricalBacktestRunner(
    ds,
    new PredictionService(),
    new HistoricalStateService({ apiToken }),
    store,
  );
  await runner.run(COMP_ID, '2025-26', { verbose: false });

  const snapshots = store.findByCompetition(CODE);
  console.log(`Total snapshots: ${snapshots.length}\n`);

  // ── Filter: need raw probs ────────────────────────────────────────────────
  const enriched: EvalRecord[] = [];
  let nExcluded = 0;
  for (const s of snapshots) {
    if (
      s.raw_p_home_win != null && s.raw_p_draw != null && s.raw_p_away_win != null &&
      s.kickoff_utc
    ) {
      const actual: Outcome =
        s.actual_result === 'HOME_WIN' ? 'HOME_WIN' :
        s.actual_result === 'AWAY_WIN' ? 'AWAY_WIN' : 'DRAW';
      enriched.push({
        actual,
        kickoff_utc: s.kickoff_utc,
        match_id: s.snapshot_id,
        raw_home: s.raw_p_home_win,
        raw_draw: s.raw_p_draw,
        raw_away: s.raw_p_away_win,
      });
    } else {
      nExcluded++;
    }
  }

  // Sort chronologically
  enriched.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));

  const N = enriched.length;
  const nTrain = Math.floor(N * TRAIN_FRACTION);
  const nEval = N - nTrain;

  console.log(`Evaluable (raw probs available): ${N}  |  Excluded: ${nExcluded}`);
  console.log(`Temporal split: ${TRAIN_FRACTION * 100}% train / ${(1 - TRAIN_FRACTION) * 100}% eval`);
  console.log(
    `  Train: ${nTrain} matches` +
    `  [${enriched[0]!.kickoff_utc.slice(0, 10)} → ${enriched[nTrain - 1]!.kickoff_utc.slice(0, 10)}]`,
  );
  console.log(
    `  Eval:  ${nEval} matches` +
    `  [${enriched[nTrain]!.kickoff_utc.slice(0, 10)} → ${enriched[N - 1]!.kickoff_utc.slice(0, 10)}]`,
  );

  const trainSet = enriched.slice(0, nTrain);
  const evalSet = enriched.slice(nTrain);

  // Anti-leakage guard
  const trainCutoffMs = new Date(enriched[nTrain - 1]!.kickoff_utc).getTime() + 1;
  const firstEvalMs = new Date(enriched[nTrain]!.kickoff_utc).getTime();
  if (firstEvalMs <= trainCutoffMs - 1) {
    console.error('ANTI-LEAKAGE VIOLATION: eval match overlaps train set. Aborting.');
    process.exit(1);
  }

  const trainActual = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const r of trainSet) trainActual[r.actual]++;
  console.log(
    `  Train class dist: HOME=${trainActual.HOME_WIN} (${(trainActual.HOME_WIN / nTrain * 100).toFixed(1)}%)` +
    `  DRAW=${trainActual.DRAW} (${(trainActual.DRAW / nTrain * 100).toFixed(1)}%)` +
    `  AWAY=${trainActual.AWAY_WIN} (${(trainActual.AWAY_WIN / nTrain * 100).toFixed(1)}%)`,
  );
  console.log('');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — Fit OVR_ISOTONIC (H6c control — variant C)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('--- STEP 1: Fit OVR_ISOTONIC calibrators (H6c control) ---');
  const trainSamples = trainSet.map((r) => ({
    raw_home: r.raw_home,
    raw_draw: r.raw_draw,
    raw_away: r.raw_away,
    actual_outcome: (
      r.actual === 'HOME_WIN' ? 'HOME' :
      r.actual === 'AWAY_WIN' ? 'AWAY' : 'DRAW'
    ) as 'HOME' | 'DRAW' | 'AWAY',
    match_timestamp_ms: new Date(r.kickoff_utc).getTime(),
    match_id: r.match_id,
  }));
  const ovrCalibrators = fitOneVsRestCalibrators(trainSamples, trainCutoffMs);
  console.log(`  OVR_ISOTONIC fitted on n=${nTrain} samples.\n`);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — Temperature scaling: grid search T
  // ══════════════════════════════════════════════════════════════════════════
  console.log('--- STEP 2: Temperature scaling — T grid search on train NLL ---');
  console.log('  T         trainNLL   drawTop1/train');
  console.log('  ──────────────────────────────────');
  let tempBestNll = { T: 1.0, trainNll: Infinity, drawTop1Train: 0 };
  for (const T of TEMP_GRID) {
    const fn = (r: EvalRecord) =>
      applyTempScaling({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }, T);
    const trainNll = avgNll(trainSet, fn);
    const dt1 = drawTop1OnTrain(trainSet, fn);
    const marker = T === 1.0 ? ' (identity)' : '';
    console.log(`  T=${String(T).padEnd(5)}   ${trainNll.toFixed(4).padStart(7)}   ${String(dt1).padStart(4)}/${trainActual.DRAW}${marker}`);
    if (trainNll < tempBestNll.trainNll) {
      tempBestNll = { T, trainNll, drawTop1Train: dt1 };
    }
  }
  console.log(`  → Best T by NLL: T=${tempBestNll.T} (train NLL=${tempBestNll.trainNll.toFixed(4)}, drawTop1=${tempBestNll.drawTop1Train}/${trainActual.DRAW})\n`);

  const T_fixed = tempBestNll.T;

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — Draw-boosted temperature: grid search T_D with T_fixed
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`--- STEP 3: Draw-boosted T — T_D grid search (T_fixed=${T_fixed}) ---`);
  console.log('  T_D       trainNLL   drawTop1/train  (objective: max drawTop1, tiebreak min NLL)');
  console.log('  ───────────────────────────────────────────────────────────────────────────────');
  let drawBoostedBest: DrawBoostedFitResult = {
    T: T_fixed,
    T_D: T_fixed,
    trainNll: Infinity,
    drawTop1Train: -1,
  };
  for (const mult of T_D_MULTS) {
    const T_D = T_fixed * mult;
    const fn = (r: EvalRecord) =>
      applyDrawBoostedTemp({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }, T_fixed, T_D);
    const trainNll = avgNll(trainSet, fn);
    const dt1 = drawTop1OnTrain(trainSet, fn);
    const marker = mult === 1.0 ? ' (= TEMP_SCALING baseline)' : '';
    console.log(
      `  T_D=${String(T_D.toFixed(2)).padEnd(6)}  ${trainNll.toFixed(4).padStart(7)}   ${String(dt1).padStart(4)}/${trainActual.DRAW}${marker}`,
    );
    const better =
      dt1 > drawBoostedBest.drawTop1Train ||
      (dt1 === drawBoostedBest.drawTop1Train && trainNll < drawBoostedBest.trainNll);
    if (better) {
      drawBoostedBest = { T: T_fixed, T_D, trainNll, drawTop1Train: dt1 };
    }
  }
  console.log(
    `  → Best T_D: T_D=${drawBoostedBest.T_D.toFixed(2)} (train NLL=${drawBoostedBest.trainNll.toFixed(4)}, drawTop1=${drawBoostedBest.drawTop1Train}/${trainActual.DRAW})\n`,
  );

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — Evaluate all 5 variants on eval set
  // ══════════════════════════════════════════════════════════════════════════
  console.log('--- STEP 4: Evaluating all variants on eval set ---\n');

  const identityCalibrators = {
    home: IsotonicCalibrator.createIdentity(),
    draw: IsotonicCalibrator.createIdentity(),
    away: IsotonicCalibrator.createIdentity(),
  };

  const T_temp = T_fixed;
  const T_D_draw = drawBoostedBest.T_D;

  const variantA = evaluateVariant(
    'A. RAW_BASELINE',
    evalSet,
    (r) => ({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }),
  );
  const variantB = evaluateVariant(
    'B. IDENTITY_CURRENT',
    evalSet,
    (r) => applyOneVsRestCalibration(r.raw_home, r.raw_draw, r.raw_away, identityCalibrators),
  );
  const variantC = evaluateVariant(
    'C. OVR_ISOTONIC',
    evalSet,
    (r) => applyOneVsRestCalibration(r.raw_home, r.raw_draw, r.raw_away, ovrCalibrators),
  );
  const variantD = evaluateVariant(
    `D. TEMP_SCALING(T=${T_temp})`,
    evalSet,
    (r) => applyTempScaling({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }, T_temp),
  );
  const variantE = evaluateVariant(
    `E. DRAW_BOOST(T=${T_fixed},TD=${T_D_draw.toFixed(1)})`,
    evalSet,
    (r) => applyDrawBoostedTemp(
      { home: r.raw_home, draw: r.raw_draw, away: r.raw_away },
      T_fixed,
      T_D_draw,
    ),
  );

  const variants = [variantA, variantB, variantC, variantD, variantE];
  const baselineVariants = new Set(['A. RAW_BASELINE', 'B. IDENTITY_CURRENT']);
  const baseline = variantA;

  const verdicts = variants.map((v) => computeVerdict(v, baseline, baselineVariants.has(v.label)));

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 1: Global metrics
  // ══════════════════════════════════════════════════════════════════════════
  const evalActual = evalSet.reduce(
    (acc, r) => { acc[r.actual]++; return acc; },
    { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 },
  );
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TABLE 1 — Global Metrics by Variant   (eval n=${nEval} matches)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    `  Actual distribution: HOME=${evalActual.HOME_WIN} (${pct(evalActual.HOME_WIN / nEval)})` +
    `  DRAW=${evalActual.DRAW} (${pct(evalActual.DRAW / nEval)})` +
    `  AWAY=${evalActual.AWAY_WIN} (${pct(evalActual.AWAY_WIN / nEval)})`,
  );
  console.log('');
  console.log(
    '  Variant                              Acc       Brier    LogLoss  predH  predD  predA  TooC  Verdict',
  );
  console.log(
    '  ────────────────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!;
    const vd = verdicts[i]!;
    console.log(
      `  ${pad(v.label, 36, true)}  ${pct(v.accuracy)}  ${num(v.brier)}  ${num(v.log_loss)}` +
      `  ${pad(v.pred_dist.HOME_WIN, 4)}   ${pad(v.pred_dist.DRAW, 4)}   ${pad(v.pred_dist.AWAY_WIN, 4)}` +
      `  ${pad(v.n_too_close_pred, 4)}  ${verdictPad(vd)}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 2: DRAW channel diagnostics
  // ══════════════════════════════════════════════════════════════════════════
  const drawN = evalActual.DRAW;
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TABLE 2 — DRAW Channel Diagnostics (on actual DRAW matches, n=${drawN})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Variant                              predD  p_avg   p_med   p_max   >25%  >30%  top1  avgSMD',
  );
  console.log(
    '  ──────────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (const v of variants) {
    console.log(
      `  ${pad(v.label, 36, true)}  ${pad(v.draw_pred_count, 4)}  ` +
      `${pct(v.draw_p_avg)}  ${pct(v.draw_p_median)}  ${pct(v.draw_p_max)}  ` +
      `${pad(v.draw_p_gt25, 4)}  ${pad(v.draw_p_gt30, 4)}  ` +
      `${pad(v.draw_top1_count, 4)}  ${pct(v.draw_avg_sel_minus_draw)}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 3: Damage check
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 3 — Damage Check: HOME_WIN and AWAY_WIN Channels');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Variant                              HOME hitrate  HOME avg_p  AWAY hitrate  AWAY avg_p',
  );
  console.log(
    '  ─────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (const v of variants) {
    console.log(
      `  ${pad(v.label, 36, true)}  ${pct(v.home_hit_rate)}          ` +
      `${pct(v.home_avg_p)}      ${pct(v.away_hit_rate)}          ${pct(v.away_avg_p)}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 4: Δ vs RAW_BASELINE with verdict
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 4 — Δ vs RAW_BASELINE  (positive = better)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Variant                              Δ Acc(pp)  Δ Brier   Δ LogLoss  Δ predD  Δ p_draw_avg  Verdict',
  );
  console.log(
    '  ─────────────────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!;
    const vd = verdicts[i]!;
    const dAcc = (v.accuracy ?? 0) - (baseline.accuracy ?? 0);
    const dBrier = v.brier - baseline.brier;
    const dLL = v.log_loss - baseline.log_loss;
    const dPredD = v.draw_pred_count - baseline.draw_pred_count;
    const dPDrawAvg = ((v.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;
    console.log(
      `  ${pad(v.label, 36, true)}  ` +
      `${sign(dAcc * 100) + (dAcc * 100).toFixed(1).padStart(5)}pp   ` +
      `${sign(dBrier) + dBrier.toFixed(4).padStart(7)}   ` +
      `${sign(dLL) + dLL.toFixed(4).padStart(7)}    ` +
      `${sign(dPredD) + String(dPredD).padStart(4)}    ` +
      `${sign(dPDrawAvg) + dPDrawAvg.toFixed(2).padStart(6)}pp    ` +
      verdictPad(vd),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL CLASSIFICATION
  // ══════════════════════════════════════════════════════════════════════════

  // Only non-baseline variants count toward classification
  const candidateVerdicts = verdicts.slice(2); // C, D, E
  const candidateVariants = variants.slice(2);

  const promisingCount = candidateVerdicts.filter(
    (v) => v.code === 'PROMISING' || v.code === 'ACCEPTABLE',
  ).length;

  type FinalClass =
    | 'NO_CALIBRATION_METHOD_ACCEPTABLE'
    | 'ONE_METHOD_PROMISING'
    | 'MULTIPLE_METHODS_PROMISING';

  let classification: FinalClass;
  if (promisingCount === 0) {
    classification = 'NO_CALIBRATION_METHOD_ACCEPTABLE';
  } else if (promisingCount === 1) {
    classification = 'ONE_METHOD_PROMISING';
  } else {
    classification = 'MULTIPLE_METHODS_PROMISING';
  }

  // Best non-baseline method
  const bestIdx = candidateVerdicts.findIndex(
    (v) => v.code === 'PROMISING',
  );
  const bestVariant = bestIdx >= 0 ? candidateVariants[bestIdx]! : null;
  const bestVariantFallback = candidateVerdicts.findIndex(
    (v) => v.code === 'ACCEPTABLE',
  );
  const bestVariantAcceptable = bestVariantFallback >= 0 ? candidateVariants[bestVariantFallback]! : null;
  const recommendedVariant = bestVariant ?? bestVariantAcceptable;

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FINAL CLASSIFICATION AND RECOMMENDATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('  Acceptance thresholds (vs RAW_BASELINE):');
  console.log('    Hard rejection:  Δ log-loss > +0.50 OR Δ Brier > +0.050');
  console.log('    PROMISING:       DRAW improved AND Δ log-loss ≤ +0.15 AND Δ Brier ≤ +0.015');
  console.log('    ACCEPTABLE:      DRAW improved AND not hard-rejected');
  console.log('    NO_GAIN:         predD = 0 AND p_draw_avg Δ < +1pp\n');

  console.log('  Per-variant verdicts (candidates only):');
  for (let i = 0; i < candidateVariants.length; i++) {
    const cv = candidateVariants[i]!;
    const vd = candidateVerdicts[i]!;
    console.log(`    ${cv.label}: ${vd.code} — ${vd.reason}`);
  }
  console.log(`  Promising/Acceptable candidates: ${promisingCount}/3\n`);

  const classWidth = 42;
  console.log('  ┌─────────────────────────────────────────────────────────────────────────┐');
  console.log(`  │  CLASSIFICATION: ${classification.padEnd(classWidth + 15)}│`);
  console.log('  └─────────────────────────────────────────────────────────────────────────┘\n');

  // One-paragraph conclusion
  const evalPeriod = `${evalSet[0]!.kickoff_utc.slice(0, 10)} – ${evalSet[nEval - 1]!.kickoff_utc.slice(0, 10)}`;
  const trainPeriod = `${trainSet[0]!.kickoff_utc.slice(0, 10)} – ${trainSet[nTrain - 1]!.kickoff_utc.slice(0, 10)}`;
  const drawRate = (evalActual.DRAW / nEval * 100).toFixed(1);

  console.log('  CONCLUSION:');
  console.log(`  Train [${trainPeriod}] n=${nTrain} → Eval [${evalPeriod}] n=${nEval}.`);
  console.log(`  Eval actual DRAW rate: ${drawRate}% (${evalActual.DRAW}/${nEval}).`);
  console.log(
    `  Temperature scaling (T=${T_temp}) selected by NLL grid search.` +
    ` Draw-boosted variant uses T_D=${drawBoostedBest.T_D.toFixed(2)}.`,
  );

  if (classification === 'NO_CALIBRATION_METHOD_ACCEPTABLE') {
    console.log('');
    console.log('  None of the three non-baseline calibration methods (OVR_ISOTONIC,');
    console.log('  TEMPERATURE_SCALING, DRAW_BOOSTED_TEMPERATURE) met the acceptance');
    console.log('  criteria. All variants either fail to recover DRAW predictions, or');
    console.log('  recover DRAW at the cost of severe log-loss degradation beyond the');
    console.log('  ±0.50 threshold. The DRAW collapse is structural in the Poisson');
    console.log('  generator (confirmed H6a+H6b). A calibration-layer intervention is');
    console.log('  insufficient; a model-level change is required (Dixon-Coles rho,');
    console.log('  lambda deflation, or explicit draw prior).');
  } else if (classification === 'ONE_METHOD_PROMISING') {
    const bv = recommendedVariant!;
    const dLL_bv = bv.log_loss - baseline.log_loss;
    const dBrier_bv = bv.brier - baseline.brier;
    console.log('');
    console.log(`  One method meets the acceptance bar: ${bv.label}.`);
    console.log(
      `  DRAW recovered: predD=${bv.draw_pred_count} (was 0),` +
      ` p_draw avg=${pct(bv.draw_p_avg).trim()} (was ${pct(baseline.draw_p_avg).trim()}).`,
    );
    console.log(
      `  Quality cost: Δ log-loss=${sign(dLL_bv)}${dLL_bv.toFixed(4)},` +
      ` Δ Brier=${sign(dBrier_bv)}${dBrier_bv.toFixed(4)}.`,
    );
    console.log('  Recommendation: adopt this calibration method as candidate for H7');
    console.log('  (integration into production pipeline), subject to further validation');
    console.log('  on additional seasons and competition codes.');
  } else {
    // MULTIPLE
    console.log('');
    const bvs = candidateVariants.filter(
      (_, i) => candidateVerdicts[i]!.code === 'PROMISING' || candidateVerdicts[i]!.code === 'ACCEPTABLE',
    );
    console.log(`  ${promisingCount} methods meet the acceptance bar:`);
    for (const bv of bvs) {
      const dLL_bv = bv.log_loss - baseline.log_loss;
      console.log(
        `    ${bv.label}: predD=${bv.draw_pred_count}, Δ LL=${sign(dLL_bv)}${dLL_bv.toFixed(4)}`,
      );
    }
    console.log('  Recommendation: prefer the method with lowest Δ log-loss for H7.');
    console.log('  Multiple viable candidates improve robustness confidence.');
    console.log('  Validate on additional seasons before production integration.');
  }
  console.log('');
}

main().catch((err) => {
  console.error('[H6c2] Fatal:', err);
  process.exit(1);
});

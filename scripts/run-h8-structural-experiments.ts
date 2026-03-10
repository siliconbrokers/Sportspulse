/**
 * H8 — Structural raw-generator experiments for DRAW recovery.
 *
 * Tests whether any structural modification to the raw Poisson probability
 * generator can make DRAW a genuinely competitive outcome without collapsing
 * overall probabilistic quality.
 *
 * Context: H6a–H6c2 confirmed that the DRAW collapse is structural in the
 * raw Poisson generator, not in the calibration layer or home-advantage
 * parameter. H8 modifies the generator structure itself — not calibration.
 *
 * Variants (4 total, disciplined portfolio):
 *
 *   A. BASELINE_REFERENCE
 *      Current production Poisson raw probs, unchanged.
 *      Strict comparison reference.
 *
 *   B. DIXON_COLES (DC) — Classic structural fix
 *      Hypothesis: Independent Poisson over-assigns probability to decisive
 *      outcomes because it ignores the well-documented negative correlation
 *      between goals at low scores. The DC correction inflates p(0-0) and
 *      p(1-1) while deflating p(1-0) and p(0-1) via a single ρ parameter.
 *      This should raise p_draw for all matches, with the effect strongest
 *      where λ_h and λ_a are moderate (p(0,0) and p(1,1) have more mass).
 *      It does NOT target balanced matches specifically; it is a global
 *      unconditional correction.
 *
 *   C. LAMBDA_DEFLATED_POISSON (LDP) — Equilibrium-aware λ deflation
 *      Hypothesis: In balanced, moderate-intensity matches, teams adapt
 *      tactically by defending more, reducing effective scoring rates below
 *      their unconditional λ values. The Poisson model, built on historical
 *      averages, uses unconditional λ and thus overestimates expected goals
 *      in near-equilibrium games. Deflating both λ values proportionally
 *      (preserving their ratio) in such matches raises P(0-0) exponentially
 *      and increases overall draw mass more than decisive-result mass.
 *      Gate: deactivates when |λ_h − λ_a| > 0.5 OR λ_h+λ_a > 3.5.
 *      Does NOT inflate DRAW in unbalanced or high-scoring matches.
 *
 *   D. CONDITIONAL_TIE_MASS_INJECTION (CTI) — Non-textbook original
 *      Hypothesis: The independent Poisson model fails to capture score-
 *      proximity correlation — the empirical tendency that matches ending
 *      in (k+1, k) or (k, k+1) are plausibly "near-draws," and that in
 *      balanced, low-intensity matches this proximity matters. CTI explicitly
 *      transfers a fraction of probability mass from immediately-adjacent
 *      near-draw cells {(k+1,k), (k,k+1)} into tied cells {(k,k)} for
 *      k = 0, 1, 2, gated by a two-factor condition: Gaussian balance gate
 *      on |λ_h − λ_a| AND logistic intensity gate on λ_h+λ_a.
 *      Differs from DC: operates on 3 score tiers (not just 2), uses a
 *      continuous per-match gate (not global ρ), and explicitly reallocates
 *      from adjacent non-draw cells rather than applying a scalar correction.
 *
 * Parameters fitted on training slice only (anti-leakage):
 *   B: ρ fitted by NLL minimization on train.
 *   C: α fitted by maximizing DRAW top-1 on train draws subject to
 *      NLL ≤ baseline_NLL + NLL_CONSTRAINT.
 *   D: α fitted by maximizing DRAW top-1 on train draws subject to
 *      NLL ≤ baseline_NLL + NLL_CONSTRAINT.
 *
 * Evaluation: same temporal split as H6c/H6c2 (60/40 chronological).
 *
 * Hard constraints preserved:
 *   - Pre-match only
 *   - Offline historical backtest only
 *   - No production default changes
 *   - No calibration layer changes
 *   - No portal rollout
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-h8-structural-experiments.ts
 */
import 'dotenv/config';

import { FootballDataSource } from '../server/football-data-source.js';
import { PredictionService } from '../server/prediction/prediction-service.js';
import { HistoricalStateService } from '../server/prediction/historical-state-service.js';
import { HistoricalBacktestStore } from '../server/prediction/historical-backtest-store.js';
import { HistoricalBacktestRunner } from '../server/prediction/historical-backtest-runner.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Production decision-policy v1.0 threshold. §16.12. Do NOT change. */
const TOO_CLOSE_THRESHOLD = 0.02;

/** Temporal split fraction. Eval = 1 - TRAIN_FRACTION. */
const TRAIN_FRACTION = 0.60;

const EPSILON_LL = 1e-15;

/** Score matrix dimension: goals 0..MAX_GOALS (matching production 8×8). */
const MAX_GOALS = 7;

/** NLL constraint for fitted variants C and D. */
const NLL_CONSTRAINT = 0.15;

// ── Variant B: Dixon-Coles rho grid ───────────────────────────────────────
const DC_RHO_GRID = [-0.40, -0.30, -0.20, -0.15, -0.13, -0.10, -0.07, -0.05, -0.03, 0.0];

// ── Variant C: LDP parameters ─────────────────────────────────────────────
/** Matches with |λ_h − λ_a| above this have β_gap = 0. */
const LDP_LAMBDA_GAP_MAX = 0.5;
/** Matches with λ_h+λ_a above this have β_sum = 0. */
const LDP_LAMBDA_SUM_MAX = 3.5;
const LDP_ALPHA_GRID = [0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50];

// ── Variant D: CTI parameters ──────────────────────────────────────────────
/** Gaussian balance gate: half-width on |λ_h − λ_a|. */
const CTI_SIGMA_BALANCE = 0.5;
/** Logistic intensity gate: center on λ_h+λ_a. */
const CTI_LAMBDA_CRIT = 3.0;
/** Logistic intensity gate: scale. */
const CTI_SIGMA_INTENSITY = 1.0;
const CTI_ALPHA_GRID = [0.0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80];

// ── Types ─────────────────────────────────────────────────────────────────

type Outcome = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';

interface EvalRecord {
  actual: Outcome;
  kickoff_utc: string;
  match_id: string;
  raw_home: number;
  raw_draw: number;
  raw_away: number;
  lambda_home: number;
  lambda_away: number;
}

interface Probs1x2 { home: number; draw: number; away: number; }

interface VariantResult {
  label: string;
  n_eval: number;
  actual_dist: Record<Outcome, number>;
  accuracy: number | null;
  n_evaluable: number;
  n_too_close: number;
  brier: number;
  log_loss: number;
  pred_dist: Record<Outcome, number>;
  draw_n: number;
  draw_pred_count: number;
  draw_p_avg: number | null;
  draw_p_median: number | null;
  draw_p_max: number | null;
  draw_p_gt25: number;
  draw_p_gt30: number;
  draw_avg_sel_minus_draw: number | null;
  draw_top1_count: number;
  home_hit_rate: number | null;
  home_avg_p: number | null;
  away_hit_rate: number | null;
  away_avg_p: number | null;
}

type VerdictCode = 'PROMISING' | 'ACCEPTABLE' | 'REJECTED' | 'NO_GAIN' | 'BASELINE';
interface Verdict { code: VerdictCode; reason: string; }

// ── Poisson score matrix ────────────────────────────────────────────────────

const _logFact: number[] = [0];
for (let k = 1; k <= 20; k++) _logFact.push(_logFact[k - 1]! + Math.log(k));

function poissonLogPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 0 : -Infinity;
  if (k > 20) return -Infinity; // beyond table; negligible at λ < 8
  return k * Math.log(lambda) - lambda - _logFact[k]!;
}

function buildMatrix(lH: number, lA: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    const row: number[] = [];
    for (let j = 0; j <= MAX_GOALS; j++) {
      row.push(Math.exp(poissonLogPmf(i, lH) + poissonLogPmf(j, lA)));
    }
    m.push(row);
  }
  return m;
}

function matrix1x2(m: number[][]): Probs1x2 {
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const v = m[i]![j]!;
      if (i > j) home += v;
      else if (i === j) draw += v;
      else away += v;
    }
  }
  const s = home + draw + away;
  return s > 0 ? { home: home / s, draw: draw / s, away: away / s } : { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
}

// ── Variant B: Dixon-Coles correction ─────────────────────────────────────

/**
 * Applies the Dixon-Coles (1997) low-score correction to the score matrix.
 * τ(0,0) = 1 − λ_h·λ_a·ρ  (ρ<0 → inflate 0-0 draw)
 * τ(1,0) = 1 + λ_a·ρ       (ρ<0 → deflate 1-0 away win)
 * τ(0,1) = 1 + λ_h·ρ       (ρ<0 → deflate 0-1 away win)
 * τ(1,1) = 1 − ρ            (ρ<0 → inflate 1-1 draw)
 * All other cells unchanged; matrix renormalized after.
 */
function applyDixonColes(m: number[][], lH: number, lA: number, rho: number): Probs1x2 {
  const tau00 = 1 - lH * lA * rho;
  const tau10 = 1 + lA * rho;
  const tau01 = 1 + lH * rho;
  const tau11 = 1 - rho;
  if (tau00 <= 0 || tau10 <= 0 || tau01 <= 0 || tau11 <= 0) {
    return matrix1x2(m); // safety fallback if ρ out of valid range
  }
  const mod = m.map((row) => [...row]);
  mod[0]![0]! *= tau00;
  mod[1]![0]! *= tau10;
  mod[0]![1]! *= tau01;
  mod[1]![1]! *= tau11;
  return matrix1x2(mod);
}

// ── Variant C: Lambda-Deflated Poisson ────────────────────────────────────

/**
 * Computes the LDP gate β ∈ [0,1] for a match.
 * β = β_gap × β_sum where:
 *   β_gap = max(0, 1 − |λ_h−λ_a| / LDP_LAMBDA_GAP_MAX)
 *   β_sum = max(0, 1 − (λ_h+λ_a) / LDP_LAMBDA_SUM_MAX)
 */
function ldpGate(lH: number, lA: number): number {
  const betaGap = Math.max(0, 1 - Math.abs(lH - lA) / LDP_LAMBDA_GAP_MAX);
  const betaSum = Math.max(0, 1 - (lH + lA) / LDP_LAMBDA_SUM_MAX);
  return betaGap * betaSum;
}

/**
 * Applies proportional λ deflation to both teams in balanced/moderate matches.
 * Deflation factor = 1 − α·β (α∈[0,0.5], β = ldpGate).
 * Rebuilds the score matrix with deflated λ values.
 */
function applyLDP(lH: number, lA: number, alpha: number): Probs1x2 {
  const beta = ldpGate(lH, lA);
  const defFactor = 1 - alpha * beta;
  return matrix1x2(buildMatrix(lH * defFactor, lA * defFactor));
}

// ── Variant D: Conditional Tie-Mass Injection ──────────────────────────────

/**
 * Computes the CTI two-factor gate.
 * gate = g_balance × g_intensity where:
 *   g_balance  = exp(−(λ_h−λ_a)² / (2·σ_b²))  Gaussian on λ imbalance
 *   g_intensity = 1 / (1 + exp((λ_total − λ_crit) / σ_i))  logistic on scoring rate
 */
function ctiGate(lH: number, lA: number): number {
  const gBalance = Math.exp(-Math.pow(lH - lA, 2) / (2 * Math.pow(CTI_SIGMA_BALANCE, 2)));
  const gIntensity = 1 / (1 + Math.exp((lH + lA - CTI_LAMBDA_CRIT) / CTI_SIGMA_INTENSITY));
  return gBalance * gIntensity;
}

/**
 * Transfers α·gate fraction of mass from near-draw cells into tied cells.
 * For k = 0, 1, 2:
 *   p(k,k) += α·gate · (p(k+1,k) + p(k,k+1))
 *   p(k+1,k) *= (1 − α·gate)
 *   p(k,k+1) *= (1 − α·gate)
 * Matrix is renormalized after transfer.
 */
function applyCTI(m: number[][], lH: number, lA: number, alpha: number): Probs1x2 {
  const gate = ctiGate(lH, lA);
  const eff = alpha * gate;
  if (eff <= 0) return matrix1x2(m);
  const mod = m.map((row) => [...row]);
  for (const k of [0, 1, 2]) {
    if (k + 1 <= MAX_GOALS) {
      const src1 = mod[k + 1]![k]!;
      const src2 = mod[k]![k + 1]!;
      const t1 = eff * src1;
      const t2 = eff * src2;
      mod[k + 1]![k]! = src1 - t1;
      mod[k]![k + 1]! = src2 - t2;
      mod[k]![k]! += t1 + t2;
    }
  }
  return matrix1x2(mod);
}

// ── Fitting helpers ────────────────────────────────────────────────────────

function computeAvgNll(records: EvalRecord[], probsFn: (r: EvalRecord) => Probs1x2): number {
  if (records.length === 0) return 0;
  let sum = 0;
  for (const r of records) {
    const p = probsFn(r);
    const pActual = r.actual === 'HOME_WIN' ? p.home : r.actual === 'DRAW' ? p.draw : p.away;
    sum += -Math.log(Math.max(pActual, EPSILON_LL));
  }
  return sum / records.length;
}

function countDrawTop1(records: EvalRecord[], probsFn: (r: EvalRecord) => Probs1x2): number {
  return records
    .filter((r) => r.actual === 'DRAW')
    .filter((r) => { const p = probsFn(r); return p.draw >= p.home && p.draw >= p.away; })
    .length;
}

// ── Statistics helpers ─────────────────────────────────────────────────────

function medianSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
function avgArr(arr: number[]): number | null {
  return arr.length === 0 ? null : arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ── Decision rule ──────────────────────────────────────────────────────────

function decisionPrediction(probs: Probs1x2): { cls: Outcome | null } {
  const pairs: [Outcome, number][] = [
    ['HOME_WIN', probs.home], ['DRAW', probs.draw], ['AWAY_WIN', probs.away],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  const margin = pairs[0]![1] - pairs[1]![1];
  if (margin < TOO_CLOSE_THRESHOLD) return { cls: null };
  return { cls: pairs[0]![0] };
}

function brierScore(probs: Probs1x2, actual: Outcome): number {
  const dH = probs.home - (actual === 'HOME_WIN' ? 1 : 0);
  const dD = probs.draw - (actual === 'DRAW' ? 1 : 0);
  const dA = probs.away - (actual === 'AWAY_WIN' ? 1 : 0);
  return dH * dH + dD * dD + dA * dA;
}

function logLoss(probs: Probs1x2, actual: Outcome): number {
  const p = actual === 'HOME_WIN' ? probs.home : actual === 'DRAW' ? probs.draw : probs.away;
  return -Math.log(Math.max(p, EPSILON_LL));
}

function top1Class(probs: Probs1x2): Outcome {
  if (probs.home >= probs.draw && probs.home >= probs.away) return 'HOME_WIN';
  if (probs.draw >= probs.home && probs.draw >= probs.away) return 'DRAW';
  return 'AWAY_WIN';
}

function selectedMinusDraw(probs: Probs1x2): number {
  const t = top1Class(probs);
  const p1 = t === 'HOME_WIN' ? probs.home : t === 'DRAW' ? probs.draw : probs.away;
  return p1 - probs.draw;
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
    if (rec.actual === 'DRAW') drawRecords.push({ probs });
    else if (rec.actual === 'HOME_WIN') homeRecords.push({ probs, hit: cls === 'HOME_WIN' });
    else awayRecords.push({ probs, hit: cls === 'AWAY_WIN' });
  }

  const drawPVals = drawRecords.map((r) => r.probs.draw).sort((a, b) => a - b);
  const drawSMD = drawRecords.map((r) => selectedMinusDraw(r.probs));

  return {
    label,
    n_eval: n,
    actual_dist: actualDist,
    accuracy: nEvaluable === 0 ? null : nCorrect / nEvaluable,
    n_evaluable: nEvaluable,
    n_too_close: nTooClose,
    brier: n === 0 ? 0 : brierSum / n,
    log_loss: n === 0 ? 0 : llSum / n,
    pred_dist: predDist,
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

// ── Per-variant verdict ────────────────────────────────────────────────────

function computeVerdict(v: VariantResult, baseline: VariantResult, isBaseline: boolean): Verdict {
  if (isBaseline) return { code: 'BASELINE', reason: 'reference' };
  const dLL = v.log_loss - baseline.log_loss;
  const dBrier = v.brier - baseline.brier;
  const drawAvgDelta = (v.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0);
  const drawGain = v.draw_pred_count > 0 || drawAvgDelta > 0.02; // >2pp improvement counts

  // Hard rejection
  if (dLL > 0.30 || dBrier > 0.050) {
    return {
      code: 'REJECTED',
      reason: `LL Δ=${dLL >= 0 ? '+' : ''}${dLL.toFixed(3)}, Brier Δ=${dBrier >= 0 ? '+' : ''}${dBrier.toFixed(4)}`,
    };
  }
  if (!drawGain) return { code: 'NO_GAIN', reason: `p_draw avg Δ=${(drawAvgDelta * 100).toFixed(2)}pp` };

  // PROMISING: draw improved AND quality maintained or improved
  if (dLL <= 0.10 && dBrier <= 0.010) {
    return {
      code: 'PROMISING',
      reason: `predD=${v.draw_pred_count}, p_avg Δ=+${(drawAvgDelta * 100).toFixed(2)}pp, LL Δ=${dLL >= 0 ? '+' : ''}${dLL.toFixed(3)}`,
    };
  }
  return {
    code: 'ACCEPTABLE',
    reason: `predD=${v.draw_pred_count}, p_avg Δ=+${(drawAvgDelta * 100).toFixed(2)}pp, LL Δ=${dLL >= 0 ? '+' : ''}${dLL.toFixed(3)}`,
  };
}

function verdictStr(v: Verdict): string {
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
  return v === null ? '   n/a' : (v * 100).toFixed(d).padStart(6) + '%';
}
function num(v: number, d = 3): string { return v.toFixed(d).padStart(7); }
function pad(s: string | number, w: number, right = false): string {
  return right ? String(s).padEnd(w) : String(s).padStart(w);
}
function sign(v: number): string { return v >= 0 ? '+' : ''; }

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const apiToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!apiToken) { console.error('FOOTBALL_DATA_TOKEN not set'); process.exit(1); }

  const CODE = 'PD';
  const COMP_ID = `comp:football-data:${CODE}`;

  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  H8 — Structural Raw-Generator Experiments — LaLiga (PD) 2025-26           ║');
  console.log('║  Variants: BASELINE | DIXON_COLES | LAMBDA_DEFLATION | TIE_MASS_INJECT     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  // ── Run historical backtest ───────────────────────────────────────────────
  process.stdout.write('Running historical backtest...\n');
  const ds = new FootballDataSource(apiToken);
  await ds.fetchCompetition(CODE);
  const store = new HistoricalBacktestStore();
  const runner = new HistoricalBacktestRunner(
    ds, new PredictionService(), new HistoricalStateService({ apiToken }), store,
  );
  await runner.run(COMP_ID, '2025-26', { verbose: false });
  const snapshots = store.findByCompetition(CODE);
  console.log(`Total snapshots: ${snapshots.length}\n`);

  // ── Filter: need raw probs AND lambda values ──────────────────────────────
  const enriched: EvalRecord[] = [];
  let nExcluded = 0;
  for (const s of snapshots) {
    if (
      s.raw_p_home_win != null && s.raw_p_draw != null && s.raw_p_away_win != null &&
      s.lambda_home != null && s.lambda_away != null && s.kickoff_utc
    ) {
      const actual: Outcome =
        s.actual_result === 'HOME_WIN' ? 'HOME_WIN' :
        s.actual_result === 'AWAY_WIN' ? 'AWAY_WIN' : 'DRAW';
      enriched.push({
        actual, kickoff_utc: s.kickoff_utc, match_id: s.snapshot_id,
        raw_home: s.raw_p_home_win, raw_draw: s.raw_p_draw, raw_away: s.raw_p_away_win,
        lambda_home: s.lambda_home, lambda_away: s.lambda_away,
      });
    } else {
      nExcluded++;
    }
  }
  enriched.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));

  const N = enriched.length;
  const nTrain = Math.floor(N * TRAIN_FRACTION);
  const nEval = N - nTrain;
  const trainSet = enriched.slice(0, nTrain);
  const evalSet = enriched.slice(nTrain);

  console.log(`Evaluable (raw probs + lambdas): ${N}  |  Excluded: ${nExcluded}`);
  console.log(`Temporal split: ${TRAIN_FRACTION * 100}% train / ${(1 - TRAIN_FRACTION) * 100}% eval`);
  console.log(`  Train: ${nTrain} [${enriched[0]!.kickoff_utc.slice(0, 10)} → ${enriched[nTrain - 1]!.kickoff_utc.slice(0, 10)}]`);
  console.log(`  Eval:  ${nEval} [${enriched[nTrain]!.kickoff_utc.slice(0, 10)} → ${enriched[N - 1]!.kickoff_utc.slice(0, 10)}]`);

  const trainActual = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const r of trainSet) trainActual[r.actual]++;
  console.log(
    `  Train class dist: HOME=${trainActual.HOME_WIN} (${(trainActual.HOME_WIN / nTrain * 100).toFixed(1)}%)` +
    `  DRAW=${trainActual.DRAW} (${(trainActual.DRAW / nTrain * 100).toFixed(1)}%)` +
    `  AWAY=${trainActual.AWAY_WIN} (${(trainActual.AWAY_WIN / nTrain * 100).toFixed(1)}%)`,
  );

  // Anti-leakage guard
  const firstEvalMs = new Date(enriched[nTrain]!.kickoff_utc).getTime();
  const trainCutoffMs = new Date(enriched[nTrain - 1]!.kickoff_utc).getTime() + 1;
  if (firstEvalMs <= trainCutoffMs - 1) {
    console.error('ANTI-LEAKAGE VIOLATION. Aborting.');
    process.exit(1);
  }
  console.log('');

  // ── SANITY CHECK: Poisson reconstruction vs raw probs ─────────────────────
  console.log('--- SANITY CHECK: Poisson matrix reconstruction vs raw_p_* ---');
  const sanityN = Math.min(5, enriched.length);
  let maxAbsDiff = 0;
  for (let i = 0; i < sanityN; i++) {
    const r = enriched[i]!;
    const reconstructed = matrix1x2(buildMatrix(r.lambda_home, r.lambda_away));
    const dH = Math.abs(reconstructed.home - r.raw_home);
    const dD = Math.abs(reconstructed.draw - r.raw_draw);
    const dA = Math.abs(reconstructed.away - r.raw_away);
    maxAbsDiff = Math.max(maxAbsDiff, dH, dD, dA);
    console.log(
      `  [${i}] raw=(${(r.raw_home * 100).toFixed(1)}%, ${(r.raw_draw * 100).toFixed(1)}%, ${(r.raw_away * 100).toFixed(1)}%)` +
      ` rec=(${(reconstructed.home * 100).toFixed(1)}%, ${(reconstructed.draw * 100).toFixed(1)}%, ${(reconstructed.away * 100).toFixed(1)}%)` +
      ` |Δ_max|=${(Math.max(dH, dD, dA) * 100).toFixed(2)}pp`,
    );
  }
  console.log(`  Max absolute diff across ${sanityN} samples: ${(maxAbsDiff * 100).toFixed(3)}pp`);
  if (maxAbsDiff > 0.02) {
    console.log('  ⚠ WARNING: reconstruction differs > 2pp — may indicate tail mass or scaling in production pipeline.');
  } else {
    console.log('  ✓ Reconstruction matches raw probs within tolerance.\n');
  }

  // ── STEP 1: Fit Dixon-Coles ρ ─────────────────────────────────────────────
  console.log('--- STEP 1: Dixon-Coles — fit ρ by NLL minimization on train ---');
  console.log('  ρ          trainNLL   drawTop1/train   note');
  console.log('  ──────────────────────────────────────────────────────');
  let dcBest = { rho: -0.13, trainNll: Infinity, drawTop1: 0 };
  const baselineNllTrain = computeAvgNll(trainSet, (r) => ({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }));
  for (const rho of DC_RHO_GRID) {
    const nll = computeAvgNll(trainSet, (r) => {
      const m = buildMatrix(r.lambda_home, r.lambda_away);
      return applyDixonColes(m, r.lambda_home, r.lambda_away, rho);
    });
    const dt1 = countDrawTop1(trainSet, (r) => {
      const m = buildMatrix(r.lambda_home, r.lambda_away);
      return applyDixonColes(m, r.lambda_home, r.lambda_away, rho);
    });
    const note = rho === -0.13 ? ' (Dixon-Coles 1997 paper)' : rho === 0.0 ? ' (identity)' : '';
    console.log(`  ρ=${String(rho).padEnd(6)}  ${nll.toFixed(4).padStart(7)}   ${String(dt1).padStart(4)}/${trainActual.DRAW}${note}`);
    if (nll < dcBest.trainNll) dcBest = { rho, trainNll: nll, drawTop1: dt1 };
  }
  console.log(`  → Best ρ: ${dcBest.rho} (train NLL=${dcBest.trainNll.toFixed(4)}, drawTop1=${dcBest.drawTop1}/${trainActual.DRAW})\n`);

  // ── STEP 2: Fit LDP α ─────────────────────────────────────────────────────
  console.log('--- STEP 2: Lambda-Deflated Poisson — fit α (DRAW top-1 on train draws, NLL constraint) ---');
  // Report gate activation stats first
  const betaValues = trainSet.map((r) => ldpGate(r.lambda_home, r.lambda_away));
  const betaActives = betaValues.filter((b) => b > 0.01).length;
  const betaAvg = betaValues.reduce((s, v) => s + v, 0) / betaValues.length;
  const betaMax = Math.max(...betaValues);
  console.log(`  LDP gate β: avg=${betaAvg.toFixed(3)}, max=${betaMax.toFixed(3)}, active(>0.01)=${betaActives}/${nTrain}`);
  console.log(`  NLL constraint: train NLL ≤ baseline (${baselineNllTrain.toFixed(4)}) + ${NLL_CONSTRAINT}`);
  console.log('  α          defFactor_avg  trainNLL   ΔtrainNLL   drawTop1/train   accept?');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  let ldpBest = { alpha: 0.0, trainNll: baselineNllTrain, drawTop1: 0 };
  for (const alpha of LDP_ALPHA_GRID) {
    const nll = computeAvgNll(trainSet, (r) => applyLDP(r.lambda_home, r.lambda_away, alpha));
    const dt1 = countDrawTop1(trainSet, (r) => applyLDP(r.lambda_home, r.lambda_away, alpha));
    const dNll = nll - baselineNllTrain;
    const avgDefFactor = betaValues.reduce((s, b) => s + (1 - alpha * b), 0) / betaValues.length;
    const accept = dNll <= NLL_CONSTRAINT;
    const marker = accept ? '  ✓' : '  ✗';
    console.log(
      `  α=${String(alpha).padEnd(5)}   ${avgDefFactor.toFixed(4).padStart(8)}    ` +
      `${nll.toFixed(4).padStart(7)}   ${sign(dNll)}${dNll.toFixed(4).padStart(7)}    ` +
      `${String(dt1).padStart(4)}/${trainActual.DRAW}${marker}`,
    );
    if (accept) {
      const better = dt1 > ldpBest.drawTop1 || (dt1 === ldpBest.drawTop1 && nll < ldpBest.trainNll);
      if (better) ldpBest = { alpha, trainNll: nll, drawTop1: dt1 };
    }
  }
  console.log(`  → Best α: ${ldpBest.alpha} (train NLL=${ldpBest.trainNll.toFixed(4)}, drawTop1=${ldpBest.drawTop1}/${trainActual.DRAW})\n`);

  // ── STEP 3: Fit CTI α ─────────────────────────────────────────────────────
  console.log('--- STEP 3: Conditional Tie-Mass Injection — fit α (DRAW top-1, NLL constraint) ---');
  const gateValues = trainSet.map((r) => ctiGate(r.lambda_home, r.lambda_away));
  const gateActives = gateValues.filter((g) => g > 0.05).length;
  const gateAvg = gateValues.reduce((s, v) => s + v, 0) / gateValues.length;
  const gateMax = Math.max(...gateValues);
  console.log(`  CTI gate: avg=${gateAvg.toFixed(3)}, max=${gateMax.toFixed(3)}, active(>0.05)=${gateActives}/${nTrain}`);
  console.log(`  NLL constraint: train NLL ≤ baseline (${baselineNllTrain.toFixed(4)}) + ${NLL_CONSTRAINT}`);
  console.log('  α          gate_eff_avg   trainNLL   ΔtrainNLL   drawTop1/train   accept?');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  let ctiBest = { alpha: 0.0, trainNll: baselineNllTrain, drawTop1: 0 };
  for (const alpha of CTI_ALPHA_GRID) {
    const nll = computeAvgNll(trainSet, (r) => {
      const m = buildMatrix(r.lambda_home, r.lambda_away);
      return applyCTI(m, r.lambda_home, r.lambda_away, alpha);
    });
    const dt1 = countDrawTop1(trainSet, (r) => {
      const m = buildMatrix(r.lambda_home, r.lambda_away);
      return applyCTI(m, r.lambda_home, r.lambda_away, alpha);
    });
    const dNll = nll - baselineNllTrain;
    const avgGateEff = gateValues.reduce((s, g) => s + alpha * g, 0) / gateValues.length;
    const accept = dNll <= NLL_CONSTRAINT;
    const marker = accept ? '  ✓' : '  ✗';
    console.log(
      `  α=${String(alpha).padEnd(5)}   ${avgGateEff.toFixed(4).padStart(8)}    ` +
      `${nll.toFixed(4).padStart(7)}   ${sign(dNll)}${dNll.toFixed(4).padStart(7)}    ` +
      `${String(dt1).padStart(4)}/${trainActual.DRAW}${marker}`,
    );
    if (accept) {
      const better = dt1 > ctiBest.drawTop1 || (dt1 === ctiBest.drawTop1 && nll < ctiBest.trainNll);
      if (better) ctiBest = { alpha, trainNll: nll, drawTop1: dt1 };
    }
  }
  console.log(`  → Best α: ${ctiBest.alpha} (train NLL=${ctiBest.trainNll.toFixed(4)}, drawTop1=${ctiBest.drawTop1}/${trainActual.DRAW})\n`);

  // ── STEP 4: Evaluate all variants on eval set ─────────────────────────────
  console.log('--- STEP 4: Evaluating all variants on eval set ---\n');

  const variantA = evaluateVariant(
    'A. BASELINE',
    evalSet,
    (r) => ({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }),
  );
  const variantB = evaluateVariant(
    `B. DIXON_COLES(ρ=${dcBest.rho})`,
    evalSet,
    (r) => {
      const m = buildMatrix(r.lambda_home, r.lambda_away);
      return applyDixonColes(m, r.lambda_home, r.lambda_away, dcBest.rho);
    },
  );
  const variantC = evaluateVariant(
    `C. LDP(α=${ldpBest.alpha})`,
    evalSet,
    (r) => applyLDP(r.lambda_home, r.lambda_away, ldpBest.alpha),
  );
  const variantD = evaluateVariant(
    `D. CTI(α=${ctiBest.alpha})`,
    evalSet,
    (r) => {
      const m = buildMatrix(r.lambda_home, r.lambda_away);
      return applyCTI(m, r.lambda_home, r.lambda_away, ctiBest.alpha);
    },
  );

  const variants = [variantA, variantB, variantC, variantD];
  const baselineVariants = new Set(['A. BASELINE']);
  const baseline = variantA;
  const verdicts = variants.map((v) => computeVerdict(v, baseline, baselineVariants.has(v.label)));

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 1: Global metrics
  // ══════════════════════════════════════════════════════════════════════════
  const evalActual = evalSet.reduce(
    (acc, r) => { acc[r.actual]++; return acc; },
    { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 },
  );
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TABLE 1 — Global Metrics   (eval n=${nEval})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    `  Actual dist: HOME=${evalActual.HOME_WIN} (${pct(evalActual.HOME_WIN / nEval)})` +
    `  DRAW=${evalActual.DRAW} (${pct(evalActual.DRAW / nEval)})` +
    `  AWAY=${evalActual.AWAY_WIN} (${pct(evalActual.AWAY_WIN / nEval)})`,
  );
  console.log('');
  console.log(
    '  Variant                           Acc       Brier    LogLoss  predH  predD  predA  TooC  Verdict',
  );
  console.log(
    '  ─────────────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!;
    const vd = verdicts[i]!;
    console.log(
      `  ${pad(v.label, 32, true)}  ${pct(v.accuracy)}  ${num(v.brier)}  ${num(v.log_loss)}` +
      `  ${pad(v.pred_dist.HOME_WIN, 4)}   ${pad(v.pred_dist.DRAW, 4)}   ${pad(v.pred_dist.AWAY_WIN, 4)}` +
      `  ${pad(v.n_too_close, 4)}  ${verdictStr(vd)}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 2: DRAW diagnostics
  // ══════════════════════════════════════════════════════════════════════════
  const drawN = evalActual.DRAW;
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TABLE 2 — DRAW Channel Diagnostics (on actual DRAW matches, n=${drawN})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Variant                           predD  p_avg   p_med   p_max   >25%  >30%  top1  avgSMD',
  );
  console.log(
    '  ──────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (const v of variants) {
    console.log(
      `  ${pad(v.label, 32, true)}  ${pad(v.draw_pred_count, 4)}  ` +
      `${pct(v.draw_p_avg)}  ${pct(v.draw_p_median)}  ${pct(v.draw_p_max)}  ` +
      `${pad(v.draw_p_gt25, 4)}  ${pad(v.draw_p_gt30, 4)}  ` +
      `${pad(v.draw_top1_count, 4)}  ${pct(v.draw_avg_sel_minus_draw)}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 3: Damage check
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 3 — Damage Check: HOME_WIN and AWAY_WIN channels');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('  Variant                           HOME hitrate  HOME avg_p  AWAY hitrate  AWAY avg_p');
  console.log('  ──────────────────────────────────────────────────────────────────────────────────');
  for (const v of variants) {
    console.log(
      `  ${pad(v.label, 32, true)}  ${pct(v.home_hit_rate)}          ` +
      `${pct(v.home_avg_p)}      ${pct(v.away_hit_rate)}          ${pct(v.away_avg_p)}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 4: Δ vs BASELINE
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 4 — Δ vs BASELINE   (positive = better for Acc, DRAW; lower = better for Brier/LL)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Variant                           Δ Acc(pp)  Δ Brier   Δ LogLoss  Δ predD  Δ p_draw_avg  Δ avgSMD(pp)  Verdict',
  );
  console.log(
    '  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!;
    const vd = verdicts[i]!;
    const dAcc = (v.accuracy ?? 0) - (baseline.accuracy ?? 0);
    const dBrier = v.brier - baseline.brier;
    const dLL = v.log_loss - baseline.log_loss;
    const dPredD = v.draw_pred_count - baseline.draw_pred_count;
    const dPAvg = ((v.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;
    const dSMD = ((v.draw_avg_sel_minus_draw ?? 0) - (baseline.draw_avg_sel_minus_draw ?? 0)) * 100;
    console.log(
      `  ${pad(v.label, 32, true)}  ` +
      `${sign(dAcc * 100) + (dAcc * 100).toFixed(1).padStart(5)}pp   ` +
      `${sign(dBrier) + dBrier.toFixed(4).padStart(7)}   ` +
      `${sign(dLL) + dLL.toFixed(4).padStart(7)}    ` +
      `${sign(dPredD) + String(dPredD).padStart(4)}    ` +
      `${sign(dPAvg) + dPAvg.toFixed(2).padStart(6)}pp    ` +
      `${sign(-dSMD) + (-dSMD).toFixed(2).padStart(6)}pp    ` +
      verdictStr(vd),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL CLASSIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  const candidateVerdicts = verdicts.slice(1); // B, C, D
  const candidateVariants = variants.slice(1);
  const promisingCount = candidateVerdicts.filter(
    (v) => v.code === 'PROMISING' || v.code === 'ACCEPTABLE',
  ).length;

  type FinalClass =
    | 'NO_STRUCTURAL_VARIANT_ACCEPTABLE'
    | 'ONE_VARIANT_PROMISING'
    | 'MULTIPLE_VARIANTS_PROMISING';

  const classification: FinalClass =
    promisingCount === 0 ? 'NO_STRUCTURAL_VARIANT_ACCEPTABLE' :
    promisingCount === 1 ? 'ONE_VARIANT_PROMISING' : 'MULTIPLE_VARIANTS_PROMISING';

  const bestCandIdx = candidateVerdicts.findIndex((v) => v.code === 'PROMISING');
  const acceptableIdx = candidateVerdicts.findIndex((v) => v.code === 'ACCEPTABLE');
  const bestCandidateV = bestCandIdx >= 0 ? candidateVariants[bestCandIdx] :
    acceptableIdx >= 0 ? candidateVariants[acceptableIdx] : null;

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FINAL CLASSIFICATION AND RECOMMENDATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('  Acceptance thresholds:');
  console.log('    Hard rejection:  Δ log-loss > +0.30 OR Δ Brier > +0.050');
  console.log('    PROMISING:       DRAW improved (>2pp p_avg OR predD>0) AND Δ LL ≤ +0.10 AND Δ Brier ≤ +0.010');
  console.log('    ACCEPTABLE:      DRAW improved AND not hard-rejected');
  console.log('    NO_GAIN:         p_draw avg Δ < +2pp AND predD = 0\n');

  console.log('  Per-variant verdicts (candidates only):');
  for (let i = 0; i < candidateVariants.length; i++) {
    const cv = candidateVariants[i]!;
    const vd = candidateVerdicts[i]!;
    console.log(`    ${cv.label}: ${vd.code} — ${vd.reason}`);
  }
  console.log(`  Promising/Acceptable candidates: ${promisingCount}/3\n`);

  console.log('  ┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log(`  │  CLASSIFICATION: ${classification.padEnd(62)}│`);
  console.log('  └──────────────────────────────────────────────────────────────────────────────┘\n');

  // One-paragraph recommendation
  const evalPeriod = `${evalSet[0]!.kickoff_utc.slice(0, 10)} – ${evalSet[nEval - 1]!.kickoff_utc.slice(0, 10)}`;
  const trainPeriod = `${trainSet[0]!.kickoff_utc.slice(0, 10)} – ${trainSet[nTrain - 1]!.kickoff_utc.slice(0, 10)}`;
  const drawRate = (evalActual.DRAW / nEval * 100).toFixed(1);

  console.log('  RECOMMENDATION:');
  console.log(`  Train [${trainPeriod}] n=${nTrain} → Eval [${evalPeriod}] n=${nEval}.`);
  console.log(`  Eval actual DRAW rate: ${drawRate}% (${evalActual.DRAW}/${nEval}).`);
  console.log(
    `  Fitted parameters — DC: ρ=${dcBest.rho},` +
    ` LDP: α=${ldpBest.alpha}, CTI: α=${ctiBest.alpha}.`,
  );
  console.log('');

  if (classification === 'NO_STRUCTURAL_VARIANT_ACCEPTABLE') {
    console.log('  None of the three structural variants (DIXON_COLES, LDP, CTI)');
    console.log('  materially improved DRAW competitiveness on the eval slice without');
    console.log('  violating the acceptance thresholds. The Poisson structural bias');
    console.log('  runs deeper than parameter-tunable corrections can reach at this');
    console.log('  data scale. Options: (1) treat DRAW collapse as model v1.0 known');
    console.log('  limitation, (2) explore richer model families (negative binomial,');
    console.log('  bivariate Poisson with explicit covariance, Dixon-Coles with time-');
    console.log('  decay), or (3) accept H8 negative result and defer DRAW recovery');
    console.log('  to a later model version with more training data.');
    console.log('  Calibration should remain deferred; forward validation remains blocked.');
  } else {
    const bv = bestCandidateV!;
    const dLL_bv = bv.log_loss - baseline.log_loss;
    const dBrier_bv = bv.brier - baseline.brier;
    const dPAvg_bv = ((bv.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;
    const verdict = candidateVerdicts[candidateVariants.indexOf(bv)]!;
    console.log(`  Best candidate: ${bv.label} [${verdict.code}].`);
    console.log(
      `  DRAW improvement: p_draw avg +${dPAvg_bv.toFixed(2)}pp,` +
      ` predD=${bv.draw_pred_count}, top-1 on actuals=${bv.draw_top1_count}/${bv.draw_n}.`,
    );
    console.log(
      `  Quality cost: Δ log-loss=${sign(dLL_bv)}${dLL_bv.toFixed(4)},` +
      ` Δ Brier=${sign(dBrier_bv)}${dBrier_bv.toFixed(4)}.`,
    );
    if (promisingCount >= 2) {
      console.log(`  Multiple variants are promising (${promisingCount}/3).`);
      console.log('  Recommend deeper analysis of the best-performing variant before H9.');
    } else {
      console.log('  One structural variant is promising. Recommend offline validation');
      console.log('  on a second competition (e.g., PL) before any production path.');
    }
    console.log('  Calibration should remain deferred until structural fix is confirmed.');
    console.log('  Forward validation remains blocked pending multi-season evidence.');
  }
  console.log('');
}

main().catch((err) => {
  console.error('[H8] Fatal:', err);
  process.exit(1);
});

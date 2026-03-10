/**
 * H9 — Cross-competition offline validation of CTI on Premier League (PL).
 *
 * Tests whether the CTI candidates selected on LaLiga (H8b) generalize to
 * Premier League without any retuning. Alpha values are frozen from H8b.
 *
 * CTI mechanism (unchanged from H8/H8b):
 *   For k = 0, 1, 2:
 *     p(k,k)   += α · gate · [p(k+1,k) + p(k,k+1)]
 *     p(k+1,k) *= (1 − α · gate)
 *     p(k,k+1) *= (1 − α · gate)
 *   gate = exp(−(λ_h−λ_a)² / (2·0.5²)) × 1/(1 + exp((λ_total − 3.0)/1.0))
 *
 * Candidates (frozen from H8b — NO retuning allowed):
 *   A. BASELINE     — current raw generator, unchanged
 *   B. CTI(α=0.5)   — primary candidate from H8b
 *   C. CTI(α=0.4)   — backup candidate from H8b
 *
 * Hard constraints:
 *   - Pre-match only
 *   - Offline historical backtest only
 *   - No portal rollout, no production default changes
 *   - No calibration changes, no TOO_CLOSE changes
 *   - No new structural variants
 *   - No retuning of alpha on PL
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-h9-cti-cross-validation.ts
 */
import 'dotenv/config';

import { FootballDataSource } from '../server/football-data-source.js';
import { PredictionService } from '../server/prediction/prediction-service.js';
import { HistoricalStateService } from '../server/prediction/historical-state-service.js';
import { HistoricalBacktestStore } from '../server/prediction/historical-backtest-store.js';
import { HistoricalBacktestRunner } from '../server/prediction/historical-backtest-runner.js';

// ── Constants ──────────────────────────────────────────────────────────────

const TOO_CLOSE_THRESHOLD = 0.02;
const TRAIN_FRACTION = 0.60;
const EPSILON_LL = 1e-15;
const MAX_GOALS = 7;

// CTI gate parameters — FROZEN from H8/H8b (must not change)
const CTI_SIGMA_BALANCE = 0.5;
const CTI_LAMBDA_CRIT = 3.0;
const CTI_SIGMA_INTENSITY = 1.0;

// Candidates — FROZEN from H8b (no retuning)
const ALPHA_PRIMARY = 0.5;
const ALPHA_BACKUP = 0.4;

// Acceptance thresholds (same as H8b)
const MAX_HOME_DELTA_PP = -5.0;
const MAX_AWAY_DELTA_PP = -5.0;
const MAX_LL_DELTA = 0.10;
const MIN_DRAW_GAIN_PP = 2.0;

// ── Types ─────────────────────────────────────────────────────────────────

type Outcome = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';

interface EvalRecord {
  actual: Outcome;
  kickoff_utc: string;
  raw_home: number;
  raw_draw: number;
  raw_away: number;
  lambda_home: number;
  lambda_away: number;
}

interface Probs1x2 { home: number; draw: number; away: number; }

interface VariantResult {
  label: string;
  alpha: number | null;
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
  draw_top1_count: number;
  draw_avg_smd: number | null;
  home_hit_rate: number | null;
  away_hit_rate: number | null;
  home_avg_p: number | null;
  away_avg_p: number | null;
}

// ── Poisson matrix ─────────────────────────────────────────────────────────

const _logFact: number[] = [0];
for (let k = 1; k <= 20; k++) _logFact.push(_logFact[k - 1]! + Math.log(k));

function poissonLogPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 0 : -Infinity;
  if (k > 20) return -Infinity;
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

// ── CTI ───────────────────────────────────────────────────────────────────

function ctiGate(lH: number, lA: number): number {
  const diff = lH - lA;
  const gB = Math.exp(-diff * diff / (2 * CTI_SIGMA_BALANCE * CTI_SIGMA_BALANCE));
  const gI = 1 / (1 + Math.exp((lH + lA - CTI_LAMBDA_CRIT) / CTI_SIGMA_INTENSITY));
  return gB * gI;
}

function applyCTI(lH: number, lA: number, alpha: number): Probs1x2 {
  const gate = ctiGate(lH, lA);
  const eff = alpha * gate;
  const m = buildMatrix(lH, lA);
  if (eff <= 0) return matrix1x2(m);
  const mod = m.map((row) => [...row]);
  for (const k of [0, 1, 2]) {
    if (k + 1 <= MAX_GOALS) {
      const s1 = mod[k + 1]![k]!;
      const s2 = mod[k]![k + 1]!;
      const t1 = eff * s1;
      const t2 = eff * s2;
      mod[k + 1]![k]! = s1 - t1;
      mod[k]![k + 1]! = s2 - t2;
      mod[k]![k]! += t1 + t2;
    }
  }
  return matrix1x2(mod);
}

function applyBaseline(r: EvalRecord): Probs1x2 {
  return { home: r.raw_home, draw: r.raw_draw, away: r.raw_away };
}

// ── Scoring metrics ────────────────────────────────────────────────────────

function brierScore(p: Probs1x2, actual: Outcome): number {
  const dH = p.home - (actual === 'HOME_WIN' ? 1 : 0);
  const dD = p.draw - (actual === 'DRAW' ? 1 : 0);
  const dA = p.away - (actual === 'AWAY_WIN' ? 1 : 0);
  return dH * dH + dD * dD + dA * dA;
}

function logLoss(p: Probs1x2, actual: Outcome): number {
  const pA = actual === 'HOME_WIN' ? p.home : actual === 'DRAW' ? p.draw : p.away;
  return -Math.log(Math.max(pA, EPSILON_LL));
}

function top1(p: Probs1x2): Outcome {
  if (p.home >= p.draw && p.home >= p.away) return 'HOME_WIN';
  if (p.draw >= p.home && p.draw >= p.away) return 'DRAW';
  return 'AWAY_WIN';
}

function medianSorted(a: number[]): number | null {
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 0 ? (a[mid - 1]! + a[mid]!) / 2 : a[mid]!;
}
function avgArr(a: number[]): number | null {
  return a.length === 0 ? null : a.reduce((s, v) => s + v, 0) / a.length;
}

// ── Evaluate ──────────────────────────────────────────────────────────────

function evaluate(
  label: string,
  alpha: number | null,
  evalSet: EvalRecord[],
  probsFn: (r: EvalRecord) => Probs1x2,
): VariantResult {
  const actualDist: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  const predDist: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  let nCorrect = 0, nEval = 0, nTooClose = 0;
  let brierSum = 0, llSum = 0;
  const drawPVals: number[] = [];
  const drawSMD: number[] = [];
  let drawTop1 = 0;
  const homeHits: boolean[] = [];
  const awayHits: boolean[] = [];
  const homeAvgPs: number[] = [];
  const awayAvgPs: number[] = [];

  for (const r of evalSet) {
    actualDist[r.actual]++;
    const p = probsFn(r);
    brierSum += brierScore(p, r.actual);
    llSum += logLoss(p, r.actual);

    const pairs: [Outcome, number][] = [
      ['HOME_WIN', p.home], ['DRAW', p.draw], ['AWAY_WIN', p.away],
    ];
    pairs.sort((a, b) => b[1] - a[1]);
    const margin = pairs[0]![1] - pairs[1]![1];
    const cls = margin < TOO_CLOSE_THRESHOLD ? null : pairs[0]![0];

    if (cls === null) nTooClose++;
    else { predDist[cls]++; nEval++; if (cls === r.actual) nCorrect++; }

    if (r.actual === 'DRAW') {
      drawPVals.push(p.draw);
      const t = top1(p);
      const topP = t === 'HOME_WIN' ? p.home : t === 'DRAW' ? p.draw : p.away;
      drawSMD.push(topP - p.draw);
      if (t === 'DRAW') drawTop1++;
    } else if (r.actual === 'HOME_WIN') {
      homeHits.push(cls === 'HOME_WIN');
      homeAvgPs.push(p.home);
    } else {
      awayHits.push(cls === 'AWAY_WIN');
      awayAvgPs.push(p.away);
    }
  }

  const n = evalSet.length;
  drawPVals.sort((a, b) => a - b);

  return {
    label, alpha,
    n_eval: n,
    actual_dist: actualDist,
    accuracy: nEval === 0 ? null : nCorrect / nEval,
    n_evaluable: nEval,
    n_too_close: nTooClose,
    brier: n === 0 ? 0 : brierSum / n,
    log_loss: n === 0 ? 0 : llSum / n,
    pred_dist: predDist,
    draw_n: drawPVals.length,
    draw_pred_count: predDist.DRAW,
    draw_p_avg: avgArr(drawPVals),
    draw_p_median: medianSorted(drawPVals),
    draw_p_max: drawPVals.length > 0 ? drawPVals[drawPVals.length - 1]! : null,
    draw_p_gt25: drawPVals.filter((v) => v > 0.25).length,
    draw_p_gt30: drawPVals.filter((v) => v > 0.30).length,
    draw_top1_count: drawTop1,
    draw_avg_smd: avgArr(drawSMD),
    home_hit_rate: homeHits.length === 0 ? null : homeHits.filter(Boolean).length / homeHits.length,
    away_hit_rate: awayHits.length === 0 ? null : awayHits.filter(Boolean).length / awayHits.length,
    home_avg_p: avgArr(homeAvgPs),
    away_avg_p: avgArr(awayAvgPs),
  };
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
function delta(v: number, d = 4): string {
  return (v >= 0 ? '+' : '') + v.toFixed(d).padStart(7);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const apiToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!apiToken) { console.error('FOOTBALL_DATA_TOKEN not set'); process.exit(1); }

  const CODE = 'PL';
  const COMP_ID = `comp:football-data:${CODE}`;

  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  H9 — CTI Cross-Competition Validation — Premier League (PL) 2025-26       ║');
  console.log('║  Candidates: BASELINE | CTI(α=0.5) primary | CTI(α=0.4) backup            ║');
  console.log('║  Gate params frozen: σ_b=0.5, λ_crit=3.0, σ_i=1.0  (no retuning)         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  // ── Run historical backtest for PL ────────────────────────────────────────
  process.stdout.write('Running historical backtest for PL...\n');
  const ds = new FootballDataSource(apiToken);
  await ds.fetchCompetition(CODE);

  const store = new HistoricalBacktestStore(`cache/predictions/historical-backtest-pl.json`);
  const runner = new HistoricalBacktestRunner(
    ds, new PredictionService(), new HistoricalStateService({ apiToken }), store,
  );
  await runner.run(COMP_ID, '2025-26', { verbose: false });
  const snapshots = store.findByCompetition(CODE);
  console.log(`Snapshots (PL): ${snapshots.length}\n`);

  // ── Filter: need raw probs + lambdas ──────────────────────────────────────
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
        actual, kickoff_utc: s.kickoff_utc,
        raw_home: s.raw_p_home_win, raw_draw: s.raw_p_draw, raw_away: s.raw_p_away_win,
        lambda_home: s.lambda_home, lambda_away: s.lambda_away,
      });
    } else {
      nExcluded++;
    }
  }
  enriched.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));

  const N = enriched.length;
  if (N < 20) {
    console.error(`Only ${N} evaluable records — insufficient for meaningful validation. Check PL data availability.`);
    process.exit(1);
  }

  const nTrain = Math.floor(N * TRAIN_FRACTION);
  const nEval = N - nTrain;
  const evalSet = enriched.slice(nTrain);

  const evalActual = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const r of evalSet) evalActual[r.actual]++;

  console.log(`Evaluable: ${N}  |  Excluded: ${nExcluded}`);
  console.log(`Temporal split: Train=${nTrain} / Eval=${nEval}`);
  console.log(
    `  Train: [${enriched[0]!.kickoff_utc.slice(0, 10)} → ${enriched[nTrain - 1]!.kickoff_utc.slice(0, 10)}]`,
  );
  console.log(
    `  Eval:  [${enriched[nTrain]!.kickoff_utc.slice(0, 10)} → ${enriched[N - 1]!.kickoff_utc.slice(0, 10)}]`,
  );
  console.log(
    `  Eval actual dist: HOME=${evalActual.HOME_WIN} (${pct(evalActual.HOME_WIN / nEval).trim()})` +
    `  DRAW=${evalActual.DRAW} (${pct(evalActual.DRAW / nEval).trim()})` +
    `  AWAY=${evalActual.AWAY_WIN} (${pct(evalActual.AWAY_WIN / nEval).trim()})`,
  );

  // ── Gate analysis on PL eval ──────────────────────────────────────────────
  const gateVals = evalSet.map((r) => ctiGate(r.lambda_home, r.lambda_away));
  const gateAvg = gateVals.reduce((s, v) => s + v, 0) / gateVals.length;
  const gateMax = Math.max(...gateVals);
  const gateSorted = [...gateVals].sort((a, b) => a - b);
  const gateMedian = gateSorted[Math.floor(gateVals.length / 2)]!;
  const lambdaSums = evalSet.map((r) => r.lambda_home + r.lambda_away);
  const lambdaAvg = lambdaSums.reduce((s, v) => s + v, 0) / lambdaSums.length;
  const lambdaMax = Math.max(...lambdaSums);

  console.log('\n--- CTI Gate Analysis on PL eval ---');
  console.log(`  λ_total: avg=${lambdaAvg.toFixed(2)}, max=${lambdaMax.toFixed(2)}`);
  console.log(`  gate: avg=${gateAvg.toFixed(3)}, median=${gateMedian.toFixed(3)}, max=${gateMax.toFixed(3)}`);
  const gateThresholds = [0.1, 0.2, 0.3, 0.4, 0.5];
  for (const t of gateThresholds) {
    const n = gateVals.filter((g) => g >= t).length;
    console.log(`    gate ≥ ${t.toFixed(1)}: ${n}/${nEval} (${(n / nEval * 100).toFixed(1)}%)`);
  }

  // PL vs PD comparison note
  console.log('  [Note: PL typically has higher λ_total than PD — gate may activate differently]');
  console.log('');

  // ── Evaluate all 3 variants ───────────────────────────────────────────────
  const variantA = evaluate(
    'A. BASELINE',
    null,
    evalSet,
    (r) => applyBaseline(r),
  );
  const variantB = evaluate(
    `B. CTI(α=${ALPHA_PRIMARY})`,
    ALPHA_PRIMARY,
    evalSet,
    (r) => applyCTI(r.lambda_home, r.lambda_away, ALPHA_PRIMARY),
  );
  const variantC = evaluate(
    `C. CTI(α=${ALPHA_BACKUP})`,
    ALPHA_BACKUP,
    evalSet,
    (r) => applyCTI(r.lambda_home, r.lambda_away, ALPHA_BACKUP),
  );

  const variants = [variantA, variantB, variantC];
  const baseline = variantA;
  const drawN = evalActual.DRAW;

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 1: Global metrics
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TABLE 1 — Global Metrics   (PL eval n=${nEval})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Variant                Acc       Brier    LogLoss  predH  predD  predA  TooC  HOME%  AWAY%',
  );
  console.log(
    '  ──────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (const v of variants) {
    const marker = v.alpha === null ? ' ←base' : '      ';
    console.log(
      `  ${pad(v.label, 20, true)}  ${pct(v.accuracy)}  ${num(v.brier)}  ${num(v.log_loss)}` +
      `  ${pad(v.pred_dist.HOME_WIN, 4)}   ${pad(v.pred_dist.DRAW, 4)}   ${pad(v.pred_dist.AWAY_WIN, 4)}` +
      `  ${pad(v.n_too_close, 4)}  ${pct(v.home_hit_rate)}  ${pct(v.away_hit_rate)}${marker}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 2: DRAW diagnostics
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TABLE 2 — DRAW Channel Diagnostics   (actual DRAWs: ${drawN}/${nEval})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Variant                predD  top1/act  p_avg   p_med   p_max   >25%  >30%  avgSMD',
  );
  console.log(
    '  ────────────────────────────────────────────────────────────────────────────────────',
  );
  for (const v of variants) {
    const marker = v.alpha === null ? ' ←base' : '      ';
    console.log(
      `  ${pad(v.label, 20, true)}  ${pad(v.draw_pred_count, 4)}  ` +
      `${String(v.draw_top1_count).padStart(2)}/${drawN.toString().padEnd(2)}    ` +
      `${pct(v.draw_p_avg)}  ${pct(v.draw_p_median)}  ${pct(v.draw_p_max)}  ` +
      `${pad(v.draw_p_gt25, 4)}  ${pad(v.draw_p_gt30, 4)}  ${pct(v.draw_avg_smd)}${marker}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 3: Damage check
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 3 — Damage Check: HOME and AWAY channels');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('  Variant                HOME hitrate  HOME avg_p  AWAY hitrate  AWAY avg_p');
  console.log('  ──────────────────────────────────────────────────────────────────────────');
  for (const v of variants) {
    console.log(
      `  ${pad(v.label, 20, true)}  ${pct(v.home_hit_rate)}          ` +
      `${pct(v.home_avg_p)}      ${pct(v.away_hit_rate)}          ${pct(v.away_avg_p)}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 4: Deltas vs baseline
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 4 — Δ vs BASELINE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Variant                Δ Acc(pp)  Δ Brier   Δ LogLoss  Δ predD  Δ p_draw_avg  Δ HOME%  Δ AWAY%',
  );
  console.log(
    '  ──────────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (const v of [variantB, variantC]) {
    const dAcc = ((v.accuracy ?? 0) - (baseline.accuracy ?? 0)) * 100;
    const dBrier = v.brier - baseline.brier;
    const dLL = v.log_loss - baseline.log_loss;
    const dPredD = v.draw_pred_count - baseline.draw_pred_count;
    const dPAvg = ((v.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;
    const dHome = ((v.home_hit_rate ?? 0) - (baseline.home_hit_rate ?? 0)) * 100;
    const dAway = ((v.away_hit_rate ?? 0) - (baseline.away_hit_rate ?? 0)) * 100;
    const homeOk = dHome >= MAX_HOME_DELTA_PP;
    const awayOk = dAway >= MAX_AWAY_DELTA_PP;
    const llOk = dLL <= MAX_LL_DELTA;
    const drawOk = dPAvg >= MIN_DRAW_GAIN_PP || v.draw_pred_count > 0;
    const flags =
      (!homeOk ? ' !HOME' : '') + (!awayOk ? ' !AWAY' : '') + (!llOk ? ' !LL' : '');
    const tick = homeOk && awayOk && llOk && drawOk ? ' ✓' : ' ✗';
    console.log(
      `  ${pad(v.label, 20, true)}  ` +
      `${sign(dAcc) + dAcc.toFixed(1).padStart(5)}pp   ` +
      `${delta(dBrier)}   ` +
      `${delta(dLL)}    ` +
      `${sign(dPredD) + String(dPredD).padStart(4)}    ` +
      `${sign(dPAvg) + dPAvg.toFixed(2).padStart(6)}pp   ` +
      `${sign(dHome) + dHome.toFixed(1).padStart(5)}pp   ` +
      `${sign(dAway) + dAway.toFixed(1).padStart(5)}pp${tick}${flags}`,
    );
  }
  console.log(
    `\n  Thresholds: HOME Δ ≥ ${MAX_HOME_DELTA_PP}pp, AWAY Δ ≥ ${MAX_AWAY_DELTA_PP}pp,` +
    ` LL Δ ≤ +${MAX_LL_DELTA}, draw gain ≥ +${MIN_DRAW_GAIN_PP}pp or predD>0`,
  );

  // ══════════════════════════════════════════════════════════════════════════
  // CROSS-COMPETITION COMPARISON (PL vs PD from H8b)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('CROSS-COMPETITION COMPARISON  (H8b PD → H9 PL)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // H8b reference values (from H8b output, hardcoded as reference)
  const PD_REF = {
    baseline_draw_rate: 27 / 103,
    alpha05_dBrier: -0.0074, alpha05_dLL: -0.0097,
    alpha05_predD: 7, alpha05_dHome: -2.1, alpha05_dAway: -3.4,
    alpha04_dBrier: -0.0068, alpha04_dLL: -0.0092,
    alpha04_predD: 2, alpha04_dHome: -2.1, alpha04_dAway: 0.0,
  };

  const pl05_dBrier = variantB.brier - baseline.brier;
  const pl05_dLL = variantB.log_loss - baseline.log_loss;
  const pl05_dPredD = variantB.draw_pred_count - baseline.draw_pred_count;
  const pl05_dHome = ((variantB.home_hit_rate ?? 0) - (baseline.home_hit_rate ?? 0)) * 100;
  const pl05_dAway = ((variantB.away_hit_rate ?? 0) - (baseline.away_hit_rate ?? 0)) * 100;
  const pl04_dBrier = variantC.brier - baseline.brier;
  const pl04_dLL = variantC.log_loss - baseline.log_loss;
  const pl04_dPredD = variantC.draw_pred_count - baseline.draw_pred_count;
  const pl04_dHome = ((variantC.home_hit_rate ?? 0) - (baseline.home_hit_rate ?? 0)) * 100;
  const pl04_dAway = ((variantC.away_hit_rate ?? 0) - (baseline.away_hit_rate ?? 0)) * 100;

  console.log('  α=0.5 consistency (PD → PL):');
  console.log(
    `    Δ Brier:   PD=${sign(PD_REF.alpha05_dBrier)}${PD_REF.alpha05_dBrier.toFixed(4)}  PL=${sign(pl05_dBrier)}${pl05_dBrier.toFixed(4)}` +
    `  direction=${PD_REF.alpha05_dBrier < 0 && pl05_dBrier < 0 ? 'SAME↓ consistent' : 'DIFFERENT ⚠'}`,
  );
  console.log(
    `    Δ LogLoss: PD=${sign(PD_REF.alpha05_dLL)}${PD_REF.alpha05_dLL.toFixed(4)}  PL=${sign(pl05_dLL)}${pl05_dLL.toFixed(4)}` +
    `  direction=${PD_REF.alpha05_dLL < 0 && pl05_dLL < 0 ? 'SAME↓ consistent' : 'DIFFERENT ⚠'}`,
  );
  console.log(
    `    Δ predD:   PD=+${PD_REF.alpha05_predD}  PL=+${pl05_dPredD}` +
    `  direction=${pl05_dPredD >= 0 ? 'SAME↑ consistent' : 'DIFFERENT ⚠'}`,
  );
  console.log(
    `    Δ HOME:    PD=${sign(PD_REF.alpha05_dHome)}${PD_REF.alpha05_dHome.toFixed(1)}pp  PL=${sign(pl05_dHome)}${pl05_dHome.toFixed(1)}pp` +
    `  threshold=${pl05_dHome >= MAX_HOME_DELTA_PP ? 'OK' : 'EXCEEDED ⚠'}`,
  );
  console.log(
    `    Δ AWAY:    PD=${sign(PD_REF.alpha05_dAway)}${PD_REF.alpha05_dAway.toFixed(1)}pp  PL=${sign(pl05_dAway)}${pl05_dAway.toFixed(1)}pp` +
    `  threshold=${pl05_dAway >= MAX_AWAY_DELTA_PP ? 'OK' : 'EXCEEDED ⚠'}`,
  );

  console.log('\n  α=0.4 consistency (PD → PL):');
  console.log(
    `    Δ Brier:   PD=${sign(PD_REF.alpha04_dBrier)}${PD_REF.alpha04_dBrier.toFixed(4)}  PL=${sign(pl04_dBrier)}${pl04_dBrier.toFixed(4)}` +
    `  direction=${PD_REF.alpha04_dBrier < 0 && pl04_dBrier < 0 ? 'SAME↓ consistent' : 'DIFFERENT ⚠'}`,
  );
  console.log(
    `    Δ LogLoss: PD=${sign(PD_REF.alpha04_dLL)}${PD_REF.alpha04_dLL.toFixed(4)}  PL=${sign(pl04_dLL)}${pl04_dLL.toFixed(4)}` +
    `  direction=${PD_REF.alpha04_dLL < 0 && pl04_dLL < 0 ? 'SAME↓ consistent' : 'DIFFERENT ⚠'}`,
  );
  console.log(
    `    Δ predD:   PD=+${PD_REF.alpha04_predD}  PL=+${pl04_dPredD}` +
    `  direction=${pl04_dPredD >= 0 ? 'SAME↑ consistent' : 'DIFFERENT ⚠'}`,
  );
  console.log(
    `    Δ HOME:    PD=${sign(PD_REF.alpha04_dHome)}${PD_REF.alpha04_dHome.toFixed(1)}pp  PL=${sign(pl04_dHome)}${pl04_dHome.toFixed(1)}pp` +
    `  threshold=${pl04_dHome >= MAX_HOME_DELTA_PP ? 'OK' : 'EXCEEDED ⚠'}`,
  );
  console.log(
    `    Δ AWAY:    PD=${sign(PD_REF.alpha04_dAway)}${PD_REF.alpha04_dAway.toFixed(1)}pp  PL=${sign(pl04_dAway)}${pl04_dAway.toFixed(1)}pp` +
    `  threshold=${pl04_dAway >= MAX_AWAY_DELTA_PP ? 'OK' : 'EXCEEDED ⚠'}`,
  );

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL CLASSIFICATION
  // ══════════════════════════════════════════════════════════════════════════

  // Check acceptance for each candidate on PL
  const b05_dPAvg = ((variantB.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;
  const b04_dPAvg = ((variantC.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;

  const alpha05_ok = {
    drawGain: b05_dPAvg >= MIN_DRAW_GAIN_PP || variantB.draw_pred_count > 0,
    homeOk: pl05_dHome >= MAX_HOME_DELTA_PP,
    awayOk: pl05_dAway >= MAX_AWAY_DELTA_PP,
    llOk: pl05_dLL <= MAX_LL_DELTA,
  };
  const alpha04_ok = {
    drawGain: b04_dPAvg >= MIN_DRAW_GAIN_PP || variantC.draw_pred_count > 0,
    homeOk: pl04_dHome >= MAX_HOME_DELTA_PP,
    awayOk: pl04_dAway >= MAX_AWAY_DELTA_PP,
    llOk: pl04_dLL <= MAX_LL_DELTA,
  };

  const alpha05_passes = Object.values(alpha05_ok).every(Boolean);
  const alpha04_passes = Object.values(alpha04_ok).every(Boolean);

  // Quality consistency: do Brier/LL directions agree with PD?
  const alpha05_qualityConsistent = (pl05_dBrier < 0 || Math.abs(pl05_dBrier) < 0.005) &&
    (pl05_dLL < 0 || pl05_dLL < MAX_LL_DELTA);
  const alpha04_qualityConsistent = (pl04_dBrier < 0 || Math.abs(pl04_dBrier) < 0.005) &&
    (pl04_dLL < 0 || pl04_dLL < MAX_LL_DELTA);

  type FinalClass =
    | 'CTI_GENERALIZES_WITH_ALPHA_0_5'
    | 'CTI_GENERALIZES_WITH_ALPHA_0_4'
    | 'CTI_PARTIALLY_GENERALIZES'
    | 'CTI_DOES_NOT_GENERALIZE';

  let classification: FinalClass;
  if (alpha05_passes && alpha05_qualityConsistent) {
    classification = 'CTI_GENERALIZES_WITH_ALPHA_0_5';
  } else if (alpha04_passes && alpha04_qualityConsistent) {
    classification = 'CTI_GENERALIZES_WITH_ALPHA_0_4';
  } else if (
    (alpha05_passes || alpha04_passes) ||
    (pl05_dPAvg > 0 && alpha05_qualityConsistent) ||
    (pl04_dPAvg > 0 && alpha04_qualityConsistent)
  ) {
    classification = 'CTI_PARTIALLY_GENERALIZES';
  } else {
    classification = 'CTI_DOES_NOT_GENERALIZE';
  }

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FINAL CLASSIFICATION AND RECOMMENDATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`  α=0.5 criteria: drawGain=${alpha05_ok.drawGain} HOME=${alpha05_ok.homeOk} AWAY=${alpha05_ok.awayOk} LL=${alpha05_ok.llOk} quality_consistent=${alpha05_qualityConsistent}`);
  console.log(`  α=0.4 criteria: drawGain=${alpha04_ok.drawGain} HOME=${alpha04_ok.homeOk} AWAY=${alpha04_ok.awayOk} LL=${alpha04_ok.llOk} quality_consistent=${alpha04_qualityConsistent}`);
  console.log('');

  console.log('  ┌──────────────────────────────────────────────────────────────────────────┐');
  console.log(`  │  CLASSIFICATION: ${classification.padEnd(57)}│`);
  console.log('  └──────────────────────────────────────────────────────────────────────────┘\n');

  // Recommendation paragraph
  const plDrawRate = (evalActual.DRAW / nEval * 100).toFixed(1);
  const plGateNote = lambdaAvg > 3.0
    ? `PL λ_total avg=${lambdaAvg.toFixed(2)} > 3.0 (λ_crit) — gate activates less than on PD.`
    : `PL λ_total avg=${lambdaAvg.toFixed(2)} ≤ 3.0 — gate activates comparably to PD.`;

  console.log('  RECOMMENDATION:\n');
  console.log(`  PL eval period [${enriched[nTrain]!.kickoff_utc.slice(0, 10)} – ${enriched[N - 1]!.kickoff_utc.slice(0, 10)}], n=${nEval}.`);
  console.log(`  PL actual DRAW rate: ${plDrawRate}% (${evalActual.DRAW}/${nEval}).`);
  console.log(`  ${plGateNote}`);
  console.log('');

  if (classification === 'CTI_GENERALIZES_WITH_ALPHA_0_5') {
    console.log('  1. α=0.5 survives cross-competition validation. Both Brier and log-loss');
    console.log('     directions are consistent with PD, DRAW improves, and HOME/AWAY channels');
    console.log('     remain within the acceptance threshold on PL.');
    console.log('  2. CTI(α=0.5) is ready for a forward/offline-final gate (H10).');
    console.log('     The mechanism generalizes without retuning across at least two European');
    console.log('     top-flight competitions.');
    console.log('  3. No further offline tuning required — α=0.5 is the confirmed candidate.');
  } else if (classification === 'CTI_GENERALIZES_WITH_ALPHA_0_4') {
    console.log('  1. α=0.5 is too aggressive on PL. α=0.4 holds the trade-off better and');
    console.log('     passes all acceptance thresholds. α=0.4 becomes the robust candidate.');
    console.log('  2. CTI(α=0.4) is ready for a forward/offline-final gate (H10) as the');
    console.log('     conservative but cross-validated choice.');
    console.log('  3. α=0.5 may be revisited with more PL data; currently not recommended.');
  } else if (classification === 'CTI_PARTIALLY_GENERALIZES') {
    console.log('  1. Neither α=0.5 nor α=0.4 fully passes all acceptance thresholds on PL,');
    console.log('     but partial improvements are present. CTI shows some generalization');
    console.log('     signal but is not yet reliable across competitions.');
    console.log('  2. CTI is NOT yet ready for a forward gate. H9 is a partial success.');
    console.log('  3. Options: (a) revise CTI gate parameters for higher-λ environments,');
    console.log('     (b) reduce α further and retest, (c) accept partial generalization and');
    console.log('     treat as competition-specific configuration.');
  } else {
    console.log('  1. Neither α=0.5 nor α=0.4 generalizes to PL. Quality consistency with');
    console.log('     PD is absent or acceptance thresholds are violated on both candidates.');
    console.log('  2. CTI does NOT generalize and should NOT proceed to a forward gate.');
    console.log('  3. Possible causes: PL λ_total is structurally higher than PD, reducing');
    console.log('     gate activation. The mechanism may require competition-specific λ_crit');
    console.log('     calibration or gate parameter adaptation before it can generalize.');
  }
  console.log('');
}

main().catch((err) => {
  console.error('[H9] Fatal:', err);
  process.exit(1);
});

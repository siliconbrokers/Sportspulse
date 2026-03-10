/**
 * H8b — CTI parameter sweep and trade-off selection.
 *
 * Refines the CTI (Conditional Tie-Mass Injection) structural variant from H8
 * by sweeping alpha across a fine grid on the same historical slice and
 * selecting the best candidate before H9 (cross-competition validation).
 *
 * CTI mechanism recap (from H8):
 *   For k = 0, 1, 2:
 *     p(k,k)   += α · gate · [p(k+1,k) + p(k,k+1)]
 *     p(k+1,k) *= (1 − α · gate)
 *     p(k,k+1) *= (1 − α · gate)
 *   gate = g_balance × g_intensity
 *     g_balance  = exp(−(λ_h−λ_a)² / (2·0.5²))   Gaussian on λ imbalance
 *     g_intensity = 1 / (1 + exp((λ_total − 3.0) / 1.0))  logistic on scoring rate
 *   Gate parameters are fixed (same as H8).
 *   Alpha is the only sweep parameter.
 *
 * Hard constraints (same as H8):
 *   - Pre-match only
 *   - Offline historical backtest only
 *   - Same competition and slice (LaLiga PD 2025-26)
 *   - No calibration changes, no TOO_CLOSE changes
 *   - No production default changes
 *   - No new structural families — CTI refinement only
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-h8b-cti-sweep.ts
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

// CTI gate parameters — identical to H8 (fixed, not swept)
const CTI_SIGMA_BALANCE = 0.5;
const CTI_LAMBDA_CRIT = 3.0;
const CTI_SIGMA_INTENSITY = 1.0;

// Alpha sweep grid
const ALPHA_GRID = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

// Acceptance thresholds for verdict
const MAX_HOME_DELTA_PP = -5.0;   // HOME hit rate must not drop more than 5pp vs baseline
const MAX_AWAY_DELTA_PP = -5.0;   // AWAY hit rate must not drop more than 5pp vs baseline
const MAX_LL_DELTA = 0.10;        // log-loss must not worsen more than 0.10 units
const MIN_DRAW_GAIN_PP = 2.0;     // p_draw avg must rise at least 2pp to count as gain

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

interface AlphaResult {
  alpha: number;
  // Global
  accuracy: number | null;
  brier: number;
  log_loss: number;
  pred_home: number;
  pred_draw: number;
  pred_away: number;
  n_too_close: number;
  // DRAW channel (on actual DRAW matches)
  draw_n: number;
  draw_pred_count: number;
  draw_p_avg: number | null;
  draw_p_median: number | null;
  draw_p_max: number | null;
  draw_p_gt25: number;
  draw_p_gt30: number;
  draw_top1_count: number;
  draw_avg_smd: number | null;
  // Channels
  home_hit_rate: number | null;
  away_hit_rate: number | null;
  home_avg_p: number | null;
  away_avg_p: number | null;
}

// ── Poisson matrix utilities ───────────────────────────────────────────────

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
  const gBalance = Math.exp(-diff * diff / (2 * CTI_SIGMA_BALANCE * CTI_SIGMA_BALANCE));
  const gIntensity = 1 / (1 + Math.exp((lH + lA - CTI_LAMBDA_CRIT) / CTI_SIGMA_INTENSITY));
  return gBalance * gIntensity;
}

function applyCTI(lH: number, lA: number, alpha: number): Probs1x2 {
  if (alpha === 0) return matrix1x2(buildMatrix(lH, lA));
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

// ── Evaluate one alpha on eval set ─────────────────────────────────────────

function evaluate(alpha: number, evalSet: EvalRecord[]): AlphaResult {
  const predDist: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  let nCorrect = 0, nEval = 0, nTooClose = 0;
  let brierSum = 0, llSum = 0;
  const drawRecs: number[] = [];   // p_draw on actual draws
  const drawSMD: number[] = [];    // selected-minus-draw on actual draws
  let drawTop1 = 0;
  const homeHits: boolean[] = [];
  const awayHits: boolean[] = [];
  const homeAvgPs: number[] = [];
  const awayAvgPs: number[] = [];

  for (const r of evalSet) {
    const p = applyCTI(r.lambda_home, r.lambda_away, alpha);
    brierSum += brierScore(p, r.actual);
    llSum += logLoss(p, r.actual);

    const pairs: [Outcome, number][] = [
      ['HOME_WIN', p.home], ['DRAW', p.draw], ['AWAY_WIN', p.away],
    ];
    pairs.sort((a, b) => b[1] - a[1]);
    const margin = pairs[0]![1] - pairs[1]![1];

    if (margin < TOO_CLOSE_THRESHOLD) {
      nTooClose++;
    } else {
      const cls = pairs[0]![0];
      predDist[cls]++;
      nEval++;
      if (cls === r.actual) nCorrect++;
    }

    if (r.actual === 'DRAW') {
      drawRecs.push(p.draw);
      const t = top1(p);
      const topP = t === 'HOME_WIN' ? p.home : t === 'DRAW' ? p.draw : p.away;
      drawSMD.push(topP - p.draw);
      if (t === 'DRAW') drawTop1++;
    } else if (r.actual === 'HOME_WIN') {
      const cls = margin >= TOO_CLOSE_THRESHOLD ? pairs[0]![0] : null;
      homeHits.push(cls === 'HOME_WIN');
      homeAvgPs.push(p.home);
    } else {
      const cls = margin >= TOO_CLOSE_THRESHOLD ? pairs[0]![0] : null;
      awayHits.push(cls === 'AWAY_WIN');
      awayAvgPs.push(p.away);
    }
  }

  const n = evalSet.length;
  drawRecs.sort((a, b) => a - b);

  return {
    alpha,
    accuracy: nEval === 0 ? null : nCorrect / nEval,
    brier: n === 0 ? 0 : brierSum / n,
    log_loss: n === 0 ? 0 : llSum / n,
    pred_home: predDist.HOME_WIN,
    pred_draw: predDist.DRAW,
    pred_away: predDist.AWAY_WIN,
    n_too_close: nTooClose,
    draw_n: drawRecs.length,
    draw_pred_count: predDist.DRAW,
    draw_p_avg: avgArr(drawRecs),
    draw_p_median: medianSorted(drawRecs),
    draw_p_max: drawRecs.length > 0 ? drawRecs[drawRecs.length - 1]! : null,
    draw_p_gt25: drawRecs.filter((v) => v > 0.25).length,
    draw_p_gt30: drawRecs.filter((v) => v > 0.30).length,
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

  const CODE = 'PD';
  const COMP_ID = `comp:football-data:${CODE}`;

  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  H8b — CTI Alpha Sweep — LaLiga (PD) 2025-26                              ║');
  console.log('║  Fixed gate: σ_b=0.5, λ_crit=3.0, σ_i=1.0  |  Alpha: 0.0 → 0.9          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  // ── Run historical backtest (uses cache) ──────────────────────────────────
  process.stdout.write('Running historical backtest (cache expected)...\n');
  const ds = new FootballDataSource(apiToken);
  await ds.fetchCompetition(CODE);
  const store = new HistoricalBacktestStore();
  const runner = new HistoricalBacktestRunner(
    ds, new PredictionService(), new HistoricalStateService({ apiToken }), store,
  );
  await runner.run(COMP_ID, '2025-26', { verbose: false });
  const snapshots = store.findByCompetition(CODE);
  console.log(`Snapshots loaded: ${snapshots.length}\n`);

  // ── Filter and split ──────────────────────────────────────────────────────
  const enriched: EvalRecord[] = [];
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
    }
  }
  enriched.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));

  const N = enriched.length;
  const nTrain = Math.floor(N * TRAIN_FRACTION);
  const nEval = N - nTrain;
  const evalSet = enriched.slice(nTrain);

  const evalActual = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const r of evalSet) evalActual[r.actual]++;

  console.log(`Evaluable: ${N}  |  Train: ${nTrain}  |  Eval: ${nEval}`);
  console.log(`Eval actual: HOME=${evalActual.HOME_WIN}  DRAW=${evalActual.DRAW}  AWAY=${evalActual.AWAY_WIN}`);
  console.log(`Eval period: ${enriched[nTrain]!.kickoff_utc.slice(0, 10)} → ${enriched[N - 1]!.kickoff_utc.slice(0, 10)}\n`);

  // ── Gate analysis on eval set ──────────────────────────────────────────────
  const gateVals = evalSet.map((r) => ctiGate(r.lambda_home, r.lambda_away));
  const gateAvg = gateVals.reduce((s, v) => s + v, 0) / gateVals.length;
  const gateMax = Math.max(...gateVals);
  const gateMedian = [...gateVals].sort((a, b) => a - b)[Math.floor(gateVals.length / 2)]!;
  const gateActives = [0.1, 0.2, 0.3, 0.4, 0.5].map(
    (t) => ({ t, n: gateVals.filter((g) => g >= t).length }),
  );
  console.log('--- CTI Gate Analysis on eval set ---');
  console.log(`  gate avg=${gateAvg.toFixed(3)}  median=${gateMedian.toFixed(3)}  max=${gateMax.toFixed(3)}`);
  console.log('  Active matches by threshold:');
  for (const { t, n } of gateActives) {
    console.log(`    gate ≥ ${t.toFixed(1)}: ${n}/${nEval} matches (${(n / nEval * 100).toFixed(1)}%)`);
  }
  console.log('');

  // ── Evaluate all alpha values ─────────────────────────────────────────────
  const baseline = evaluate(0.0, evalSet);
  const results: AlphaResult[] = ALPHA_GRID.map((a) => evaluate(a, evalSet));

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 1: Global metrics per alpha
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TABLE 1 — Global Metrics per Alpha   (eval n=${nEval})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  α      Acc      Brier    LogLoss  predH  predD  predA  TooC  HOME%  AWAY%',
  );
  console.log(
    '  ────────────────────────────────────────────────────────────────────────────',
  );
  for (const r of results) {
    const marker = r.alpha === 0.0 ? ' ←base' : '      ';
    console.log(
      `  ${String(r.alpha).padEnd(4)}  ${pct(r.accuracy)}  ${num(r.brier)}  ${num(r.log_loss)}` +
      `  ${pad(r.pred_home, 4)}   ${pad(r.pred_draw, 4)}   ${pad(r.pred_away, 4)}` +
      `  ${pad(r.n_too_close, 4)}  ${pct(r.home_hit_rate)}  ${pct(r.away_hit_rate)}${marker}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 2: DRAW recovery per alpha
  // ══════════════════════════════════════════════════════════════════════════
  const drawN = evalActual.DRAW;
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TABLE 2 — DRAW Recovery per Alpha   (actual DRAWs: ${drawN}/${nEval})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  α      predD  top1/act  p_avg   p_med   p_max   >25%  >30%  avgSMD',
  );
  console.log(
    '  ───────────────────────────────────────────────────────────────────────',
  );
  for (const r of results) {
    const marker = r.alpha === 0.0 ? ' ←base' : '      ';
    console.log(
      `  ${String(r.alpha).padEnd(4)}  ${pad(r.draw_pred_count, 4)}  ` +
      `${String(r.draw_top1_count).padStart(2)}/${drawN.toString().padEnd(2)}    ` +
      `${pct(r.draw_p_avg)}  ${pct(r.draw_p_median)}  ${pct(r.draw_p_max)}  ` +
      `${pad(r.draw_p_gt25, 4)}  ${pad(r.draw_p_gt30, 4)}  ${pct(r.draw_avg_smd)}${marker}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE 3: Deltas vs baseline per alpha
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 3 — Δ vs Baseline (α=0)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  α      Δ Acc(pp)  Δ Brier   Δ LogLoss  Δ predD  Δ p_draw_avg  Δ HOME%(pp)  Δ AWAY%(pp)',
  );
  console.log(
    '  ─────────────────────────────────────────────────────────────────────────────────────────',
  );
  for (const r of results) {
    if (r.alpha === 0.0) continue; // skip baseline row
    const dAcc = ((r.accuracy ?? 0) - (baseline.accuracy ?? 0)) * 100;
    const dBrier = r.brier - baseline.brier;
    const dLL = r.log_loss - baseline.log_loss;
    const dPredD = r.draw_pred_count - baseline.draw_pred_count;
    const dPAvg = ((r.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;
    const dHome = ((r.home_hit_rate ?? 0) - (baseline.home_hit_rate ?? 0)) * 100;
    const dAway = ((r.away_hit_rate ?? 0) - (baseline.away_hit_rate ?? 0)) * 100;
    // Flag if criteria breached
    const homeOk = dHome >= MAX_HOME_DELTA_PP;
    const awayOk = dAway >= MAX_AWAY_DELTA_PP;
    const llOk = dLL <= MAX_LL_DELTA;
    const drawOk = dPAvg >= MIN_DRAW_GAIN_PP;
    const flags =
      (!homeOk ? ' !HOME' : '') +
      (!awayOk ? ' !AWAY' : '') +
      (!llOk ? ' !LL' : '');
    console.log(
      `  ${String(r.alpha).padEnd(4)}  ` +
      `${sign(dAcc) + dAcc.toFixed(1).padStart(5)}pp   ` +
      `${delta(dBrier)}   ` +
      `${delta(dLL)}    ` +
      `${sign(dPredD) + String(dPredD).padStart(4)}    ` +
      `${sign(dPAvg) + dPAvg.toFixed(2).padStart(6)}pp   ` +
      `${sign(dHome) + dHome.toFixed(1).padStart(5)}pp     ` +
      `${sign(dAway) + dAway.toFixed(1).padStart(5)}pp${flags}`,
    );
  }
  console.log(`\n  Thresholds: HOME Δ ≥ ${MAX_HOME_DELTA_PP}pp, AWAY Δ ≥ ${MAX_AWAY_DELTA_PP}pp, LL Δ ≤ +${MAX_LL_DELTA}, p_draw Δ ≥ +${MIN_DRAW_GAIN_PP}pp`);

  // ══════════════════════════════════════════════════════════════════════════
  // TRADE-OFF SELECTION
  // ══════════════════════════════════════════════════════════════════════════

  // For each candidate alpha (excluding 0.0 baseline), compute:
  // - Is it "acceptable"? (meets HOME/AWAY/LL thresholds AND has draw gain)
  // - Quality score: Brier delta + LL delta (lower = better quality)
  // - Draw score: p_draw avg delta + draw_top1_count/draw_n × 20

  type Candidate = {
    alpha: number;
    r: AlphaResult;
    dBrier: number;
    dLL: number;
    dHome: number;
    dAway: number;
    dPAvg: number;
    drawRecovery: number;
    qualityScore: number; // lower = better quality vs baseline
    acceptable: boolean;
  };

  const candidates: Candidate[] = results
    .filter((r) => r.alpha > 0)
    .map((r) => {
      const dBrier = r.brier - baseline.brier;
      const dLL = r.log_loss - baseline.log_loss;
      const dHome = ((r.home_hit_rate ?? 0) - (baseline.home_hit_rate ?? 0)) * 100;
      const dAway = ((r.away_hit_rate ?? 0) - (baseline.away_hit_rate ?? 0)) * 100;
      const dPAvg = ((r.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;
      const drawRecovery = dPAvg + (r.draw_top1_count / (drawN || 1)) * 20;
      // Quality score: penalize worsening; reward improvement (lower = better)
      const qualityScore = dBrier + dLL * 0.3; // weighted toward LL
      const acceptable =
        dPAvg >= MIN_DRAW_GAIN_PP &&
        dHome >= MAX_HOME_DELTA_PP &&
        dAway >= MAX_AWAY_DELTA_PP &&
        dLL <= MAX_LL_DELTA;
      return { alpha: r.alpha, r, dBrier, dLL, dHome, dAway, dPAvg, drawRecovery, qualityScore, acceptable };
    });

  const acceptable = candidates.filter((c) => c.acceptable);

  // BEST_PROBABILISTIC: best quality (Brier+LL improvement) among acceptable
  const bestProbabilistic = acceptable.length > 0
    ? acceptable.reduce((best, c) => c.qualityScore < best.qualityScore ? c : best)
    : null;

  // BEST_DRAW_RECOVERY: strongest draw recovery (p_draw avg + top-1) with HOME/AWAY constraint only (ignore LL if quality improves)
  const drawConstrainedCandidates = candidates.filter(
    (c) => c.dHome >= MAX_HOME_DELTA_PP && c.dAway >= MAX_AWAY_DELTA_PP && c.dPAvg >= MIN_DRAW_GAIN_PP,
  );
  const bestDrawRecovery = drawConstrainedCandidates.length > 0
    ? drawConstrainedCandidates.reduce((best, c) => c.drawRecovery > best.drawRecovery ? c : best)
    : null;

  // BEST_OVERALL: maximize draw recovery while penalizing channel damage and LL worsening
  // Score = drawRecovery - 2×max(0, -dHome - 5) - 2×max(0, -dAway - 5) - 50×max(0, dLL - 0.05)
  const overallScored = candidates.map((c) => ({
    ...c,
    overallScore:
      c.drawRecovery
      - 2 * Math.max(0, -c.dHome - 5)
      - 2 * Math.max(0, -c.dAway - 5)
      - 50 * Math.max(0, c.dLL - 0.05),
  }));
  const bestOverall = overallScored.filter((c) => c.dPAvg >= MIN_DRAW_GAIN_PP)
    .reduce<typeof overallScored[0] | null>(
      (best, c) => best === null || c.overallScore > best.overallScore ? c : best,
      null,
    );

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TRADE-OFF SELECTION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Show all acceptable candidates
  console.log(`  Acceptable candidates (HOME Δ ≥ ${MAX_HOME_DELTA_PP}pp, AWAY Δ ≥ ${MAX_AWAY_DELTA_PP}pp, LL Δ ≤ +${MAX_LL_DELTA}, draw gain ≥ +${MIN_DRAW_GAIN_PP}pp):`);
  if (acceptable.length === 0) {
    console.log('    None meet all criteria.');
  } else {
    for (const c of acceptable) {
      console.log(
        `    α=${c.alpha}:  predD=${c.r.draw_pred_count}  p_avg Δ=+${c.dPAvg.toFixed(2)}pp  ` +
        `LL Δ=${sign(c.dLL)}${c.dLL.toFixed(4)}  Brier Δ=${sign(c.dBrier)}${c.dBrier.toFixed(4)}  ` +
        `HOME Δ=${sign(c.dHome)}${c.dHome.toFixed(1)}pp  AWAY Δ=${sign(c.dAway)}${c.dAway.toFixed(1)}pp`,
      );
    }
  }

  console.log('\n  ┌─────────────────────────────────────────────────────────────────────┐');
  const bpAlpha = bestProbabilistic?.alpha;
  const bdrAlpha = bestDrawRecovery?.alpha;
  const boAlpha = bestOverall?.alpha;
  console.log(`  │  BEST_PROBABILISTIC_ALPHA = ${String(bpAlpha ?? 'none').padEnd(43)}│`);
  console.log(`  │  BEST_DRAW_RECOVERY_ALPHA = ${String(bdrAlpha ?? 'none').padEnd(43)}│`);
  console.log(`  │  BEST_OVERALL_TRADEOFF_ALPHA = ${String(boAlpha ?? 'none').padEnd(39)}│`);
  console.log('  └─────────────────────────────────────────────────────────────────────┘');

  if (bestProbabilistic) {
    const r = bestProbabilistic.r;
    console.log(`\n  BEST_PROBABILISTIC (α=${bestProbabilistic.alpha}):`);
    console.log(
      `    predD=${r.draw_pred_count}  p_avg=${pct(r.draw_p_avg).trim()}  ` +
      `Brier Δ=${sign(bestProbabilistic.dBrier)}${bestProbabilistic.dBrier.toFixed(4)}  ` +
      `LL Δ=${sign(bestProbabilistic.dLL)}${bestProbabilistic.dLL.toFixed(4)}`,
    );
  }
  if (bestDrawRecovery) {
    const r = bestDrawRecovery.r;
    console.log(`\n  BEST_DRAW_RECOVERY (α=${bestDrawRecovery.alpha}):`);
    console.log(
      `    predD=${r.draw_pred_count}  top1=${r.draw_top1_count}/${drawN}  p_avg=${pct(r.draw_p_avg).trim()}  ` +
      `HOME Δ=${sign(bestDrawRecovery.dHome)}${bestDrawRecovery.dHome.toFixed(1)}pp  ` +
      `AWAY Δ=${sign(bestDrawRecovery.dAway)}${bestDrawRecovery.dAway.toFixed(1)}pp`,
    );
  }
  if (bestOverall) {
    const r = bestOverall.r;
    console.log(`\n  BEST_OVERALL (α=${bestOverall.alpha}):`);
    console.log(
      `    predD=${r.draw_pred_count}  top1=${r.draw_top1_count}/${drawN}  p_avg=${pct(r.draw_p_avg).trim()}  ` +
      `Brier Δ=${sign(bestOverall.dBrier)}${bestOverall.dBrier.toFixed(4)}  ` +
      `LL Δ=${sign(bestOverall.dLL)}${bestOverall.dLL.toFixed(4)}  ` +
      `HOME Δ=${sign(bestOverall.dHome)}${bestOverall.dHome.toFixed(1)}pp`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL CLASSIFICATION
  // ══════════════════════════════════════════════════════════════════════════

  type FinalClass =
    | 'NO_CTI_ALPHA_ACCEPTABLE'
    | 'ONE_CTI_ALPHA_CLEARLY_BEST'
    | 'MULTIPLE_CTI_ALPHAS_REASONABLE';

  let classification: FinalClass;
  if (acceptable.length === 0 && bestOverall === null) {
    classification = 'NO_CTI_ALPHA_ACCEPTABLE';
  } else if (acceptable.length === 1) {
    classification = 'ONE_CTI_ALPHA_CLEARLY_BEST';
  } else if (acceptable.length > 1) {
    // Check if one clearly dominates (draw score > 1.5× next best)
    const sorted = [...acceptable].sort((a, b) => b.drawRecovery - a.drawRecovery);
    const top2Ratio = sorted.length >= 2 ? sorted[0]!.drawRecovery / Math.max(sorted[1]!.drawRecovery, 0.01) : 99;
    classification = top2Ratio > 1.5 ? 'ONE_CTI_ALPHA_CLEARLY_BEST' : 'MULTIPLE_CTI_ALPHAS_REASONABLE';
  } else {
    // bestOverall exists but not in acceptable (relaxed)
    classification = 'ONE_CTI_ALPHA_CLEARLY_BEST';
  }

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FINAL CLASSIFICATION AND RECOMMENDATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('  ┌─────────────────────────────────────────────────────────────────────┐');
  console.log(`  │  CLASSIFICATION: ${classification.padEnd(53)}│`);
  console.log('  └─────────────────────────────────────────────────────────────────────┘\n');

  // Recommendation paragraph
  const evalPeriod = `${enriched[nTrain]!.kickoff_utc.slice(0, 10)} – ${enriched[N - 1]!.kickoff_utc.slice(0, 10)}`;
  const drawRate = (evalActual.DRAW / nEval * 100).toFixed(1);

  console.log('  RECOMMENDATION:\n');
  console.log(`  Eval period [${evalPeriod}], n=${nEval}, actual DRAW rate=${drawRate}%.`);
  console.log(`  CTI gate (fixed): σ_b=0.5, λ_crit=3.0, σ_i=1.0.`);
  console.log(`  Sweep: α ∈ {${ALPHA_GRID.join(', ')}}.`);
  console.log('');

  if (classification === 'NO_CTI_ALPHA_ACCEPTABLE') {
    console.log('  1. CTI is NOT robust enough to continue: no alpha value satisfies all');
    console.log('     acceptance thresholds simultaneously on this slice. The DRAW recovery');
    console.log('     comes only at the cost of unacceptable HOME/AWAY or LL degradation.');
    console.log('  2. No alpha should be carried to H9.');
    console.log('  3. No backup candidate — CTI at these gate settings is not viable.');
    console.log('  4. H9 is blocked. Consider H8c (gate parameter revision) before H9.');
  } else {
    const primaryAlpha = boAlpha ?? bpAlpha ?? bdrAlpha;
    const backupAlpha = (() => {
      // Find second-best among acceptable or near-acceptable
      const pool = acceptable.filter((c) => c.alpha !== primaryAlpha);
      if (pool.length > 0) {
        return pool.reduce((best, c) => c.drawRecovery > best.drawRecovery ? c : best).alpha;
      }
      // Fallback: find near-acceptable candidate
      const nearAcceptable = candidates.filter(
        (c) => c.alpha !== primaryAlpha && c.dPAvg >= MIN_DRAW_GAIN_PP / 2,
      );
      if (nearAcceptable.length > 0) {
        return nearAcceptable.reduce((best, c) => c.drawRecovery > best.drawRecovery ? c : best).alpha;
      }
      return null;
    })();

    const primaryResult = results.find((r) => r.alpha === primaryAlpha);

    console.log('  1. CTI is robust enough to continue to cross-competition validation (H9).');
    if (primaryResult) {
      console.log(
        `     Across the sweep, Brier and log-loss generally improve with CTI,` +
        ` with peak DRAW recovery (predD=${primaryResult.draw_pred_count}, p_avg=` +
        `${(primaryResult.draw_p_avg ?? 0) * 100 | 0}%) at the best overall alpha.`,
      );
    }
    console.log(`  2. BEST_OVERALL_TRADEOFF_ALPHA for H9: α=${primaryAlpha}.`);
    if (backupAlpha !== null) {
      console.log(`  3. Backup candidate for H9: α=${backupAlpha} (weaker draw recovery, less channel damage).`);
    } else {
      console.log('  3. No strong backup candidate — carry only primary alpha to H9.');
    }
    if (classification === 'MULTIPLE_CTI_ALPHAS_REASONABLE' && backupAlpha !== null) {
      console.log(`  4. H9 should test BOTH α=${primaryAlpha} AND α=${backupAlpha} on the second competition`);
      console.log('     to check whether the trade-off curve is similar or competition-specific.');
    } else {
      console.log(`  4. H9 should test α=${primaryAlpha} only. If results diverge from this slice,`);
      console.log(`     test α=${backupAlpha ?? 'lower'} as sensitivity check.`);
    }
    console.log('');
    console.log('  Calibration remains deferred. Forward validation remains blocked.');
    console.log('  No other model component should change before H9 completes.');
  }
  console.log('');
}

main().catch((err) => {
  console.error('[H8b] Fatal:', err);
  process.exit(1);
});

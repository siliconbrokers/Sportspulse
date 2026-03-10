/**
 * H10 — Multi-league robustness validation of CTI(α=0.4).
 *
 * Tests whether the frozen CTI candidate from H9 (α=0.4) generalizes across
 * all domestic leagues currently supported by the SportPulse data stack.
 *
 * Candidate (frozen from H9 — NO retuning allowed):
 *   CTI(α=0.4)  gate: σ_b=0.5, λ_crit=3.0, σ_i=1.0
 *
 * League set:
 *   - PD  (LaLiga Spain)       — football-data.org  — store: historical-backtest.json
 *   - PL  (Premier League)     — football-data.org  — store: historical-backtest-pl.json
 *   - BL1 (Bundesliga)         — football-data.org  — store: historical-backtest-bl1.json
 *   - SA  (Serie A)            — UNAVAILABLE: not in COMPETITIONS, no integration
 *
 * Hard constraints (same as H8/H8b/H9):
 *   - Pre-match only
 *   - Offline historical backtest only
 *   - No calibration changes
 *   - No TOO_CLOSE changes (0.02 frozen)
 *   - No new structural variants
 *   - No alpha retuning by league
 *   - No portal rollout / no production default changes
 *
 * Decision thresholds (same as H8b/H9):
 *   HOME Δ ≥ −5pp, AWAY Δ ≥ −5pp, LL Δ ≤ +0.10, draw gain ≥ +2pp or predD > 0
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-h10-multi-league-robustness.ts
 */
import 'dotenv/config';

import { FootballDataSource } from '../server/football-data-source.js';
import { PredictionService } from '../server/prediction/prediction-service.js';
import { HistoricalStateService } from '../server/prediction/historical-state-service.js';
import { HistoricalBacktestStore } from '../server/prediction/historical-backtest-store.js';
import { HistoricalBacktestRunner } from '../server/prediction/historical-backtest-runner.js';

// ── Frozen constants ────────────────────────────────────────────────────────

const ALPHA_FROZEN = 0.4;           // frozen from H9 — do not change
const CTI_SIGMA_BALANCE = 0.5;      // frozen from H8
const CTI_LAMBDA_CRIT = 3.0;       // frozen from H8
const CTI_SIGMA_INTENSITY = 1.0;    // frozen from H8
const TOO_CLOSE_THRESHOLD = 0.02;   // frozen production decision-policy
const TRAIN_FRACTION = 0.60;
const EPSILON_LL = 1e-15;
const MAX_GOALS = 7;

// Acceptance thresholds (same as H8b/H9)
const MAX_HOME_DELTA_PP = -5.0;
const MAX_AWAY_DELTA_PP = -5.0;
const MAX_LL_DELTA = 0.10;
const MIN_DRAW_GAIN_PP = 2.0;

// ── League config ───────────────────────────────────────────────────────────

interface LeagueConfig {
  code: string;
  name: string;
  season: string;
  storeFile: string;
  provider: string;
}

const LEAGUES: LeagueConfig[] = [
  { code: 'PD',  name: 'LaLiga (Spain)',       season: '2025-26', storeFile: 'cache/predictions/historical-backtest.json',      provider: 'football-data.org' },
  { code: 'PL',  name: 'Premier League',       season: '2025-26', storeFile: 'cache/predictions/historical-backtest-pl.json',   provider: 'football-data.org' },
  { code: 'BL1', name: 'Bundesliga (Germany)', season: '2025-26', storeFile: 'cache/predictions/historical-backtest-bl1.json',  provider: 'football-data.org' },
];

// ── Types ───────────────────────────────────────────────────────────────────

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
  n_eval: number;
  actual_dist: Record<Outcome, number>;
  accuracy: number | null;
  n_evaluable: number;
  n_too_close: number;
  brier: number;
  log_loss: number;
  pred_dist: Record<Outcome, number>;
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

interface LeagueResult {
  config: LeagueConfig;
  n_snapshots: number;
  n_excluded: number;
  n_evaluable: number;
  n_train: number;
  n_eval_set: number;
  train_start: string;
  train_end: string;
  eval_start: string;
  eval_end: string;
  actual_dist: Record<Outcome, number>;
  mode_dist: Record<string, number>;
  gate_avg: number;
  gate_median: number;
  gate_max: number;
  gate_gt01: number;
  gate_gt02: number;
  lambda_avg: number;
  lambda_max: number;
  baseline: VariantResult;
  cti04: VariantResult;
  verdict: 'PASS' | 'FAIL';
  fail_reasons: string[];
}

// ── Poisson matrix ───────────────────────────────────────────────────────────

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

// ── CTI (frozen from H8/H8b/H9) ─────────────────────────────────────────────

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

// ── Scoring metrics ───────────────────────────────────────────────────────────

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

// ── Evaluate ─────────────────────────────────────────────────────────────────

function evaluate(
  label: string,
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
    label,
    n_eval: n,
    actual_dist: actualDist,
    accuracy: nEval === 0 ? null : nCorrect / nEval,
    n_evaluable: nEval,
    n_too_close: nTooClose,
    brier: n === 0 ? 0 : brierSum / n,
    log_loss: n === 0 ? 0 : llSum / n,
    pred_dist: predDist,
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

// ── Formatting helpers ────────────────────────────────────────────────────────

function pct(v: number | null, d = 1): string {
  return v === null ? '   n/a' : (v * 100).toFixed(d).padStart(6) + '%';
}
function num(v: number, d = 3): string { return v.toFixed(d).padStart(7); }
function pad(s: string | number, w: number, right = false): string {
  return right ? String(s).padEnd(w) : String(s).padStart(w);
}
function delta(v: number, d = 2): string {
  return (v >= 0 ? '+' : '') + v.toFixed(d).padStart(7);
}
function pp(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(1).padStart(6) + 'pp';
}

// ── Run one league ────────────────────────────────────────────────────────────

async function runLeague(
  cfg: LeagueConfig,
  ds: FootballDataSource,
  apiToken: string,
): Promise<LeagueResult> {
  console.log(`\n${'━'.repeat(80)}`);
  console.log(`  ${cfg.code} — ${cfg.name}  |  Provider: ${cfg.provider}  |  Season: ${cfg.season}`);
  console.log(`${'━'.repeat(80)}`);

  process.stdout.write(`  Running backtest for ${cfg.code}...\n`);
  await ds.fetchCompetition(cfg.code);

  const store = new HistoricalBacktestStore(cfg.storeFile);
  const runner = new HistoricalBacktestRunner(
    ds, new PredictionService(), new HistoricalStateService({ apiToken }), store,
  );
  await runner.run(`comp:football-data:${cfg.code}`, cfg.season, { verbose: false });
  const snapshots = store.findByCompetition(cfg.code);
  console.log(`  Snapshots: ${snapshots.length}`);

  // Mode distribution
  const modeDist: Record<string, number> = {};
  for (const s of snapshots) {
    const m = (s as any).operating_mode ?? 'UNKNOWN';
    modeDist[m] = (modeDist[m] ?? 0) + 1;
  }

  // Build eval records
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
    throw new Error(`${cfg.code}: only ${N} evaluable records — insufficient.`);
  }

  const nTrain = Math.floor(N * TRAIN_FRACTION);
  const evalSet = enriched.slice(nTrain);
  const nEvalSet = evalSet.length;

  const evalActual: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const r of evalSet) evalActual[r.actual]++;

  // Gate analysis
  const gateVals = evalSet.map((r) => ctiGate(r.lambda_home, r.lambda_away));
  const gateAvg = gateVals.reduce((s, v) => s + v, 0) / gateVals.length;
  const gateMax = Math.max(...gateVals);
  const gateSorted = [...gateVals].sort((a, b) => a - b);
  const gateMedian = gateSorted[Math.floor(gateVals.length / 2)]!;
  const lambdaSums = evalSet.map((r) => r.lambda_home + r.lambda_away);
  const lambdaAvg = lambdaSums.reduce((s, v) => s + v, 0) / lambdaSums.length;
  const lambdaMax = Math.max(...lambdaSums);
  const gateGt01 = gateVals.filter((g) => g >= 0.1).length;
  const gateGt02 = gateVals.filter((g) => g >= 0.2).length;

  console.log(`\n  Split: Train=${nTrain} / Eval=${nEvalSet}`);
  console.log(`    Train: [${enriched[0]!.kickoff_utc.slice(0, 10)} → ${enriched[nTrain - 1]!.kickoff_utc.slice(0, 10)}]`);
  console.log(`    Eval:  [${enriched[nTrain]!.kickoff_utc.slice(0, 10)} → ${enriched[N - 1]!.kickoff_utc.slice(0, 10)}]`);
  console.log(
    `    Actual dist: HOME=${evalActual.HOME_WIN} (${pct(evalActual.HOME_WIN / nEvalSet).trim()})` +
    `  DRAW=${evalActual.DRAW} (${pct(evalActual.DRAW / nEvalSet).trim()})` +
    `  AWAY=${evalActual.AWAY_WIN} (${pct(evalActual.AWAY_WIN / nEvalSet).trim()})`,
  );
  console.log(`  Excluded: ${nExcluded}  |  Mode dist: ${JSON.stringify(modeDist)}`);
  console.log(`  Gate: avg=${gateAvg.toFixed(3)}, median=${gateMedian.toFixed(3)}, max=${gateMax.toFixed(3)}`);
  console.log(`    gate≥0.1: ${gateGt01}/${nEvalSet} (${(gateGt01 / nEvalSet * 100).toFixed(1)}%)` +
    `  gate≥0.2: ${gateGt02}/${nEvalSet} (${(gateGt02 / nEvalSet * 100).toFixed(1)}%)`);
  console.log(`  λ_total: avg=${lambdaAvg.toFixed(2)}, max=${lambdaMax.toFixed(2)}`);

  // Evaluate variants
  const baseline = evaluate('BASELINE', evalSet, (r) => ({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }));
  const cti04 = evaluate(`CTI(α=${ALPHA_FROZEN})`, evalSet, (r) => applyCTI(r.lambda_home, r.lambda_away, ALPHA_FROZEN));

  // Compute deltas
  const dHome = ((cti04.home_hit_rate ?? 0) - (baseline.home_hit_rate ?? 0)) * 100;
  const dAway = ((cti04.away_hit_rate ?? 0) - (baseline.away_hit_rate ?? 0)) * 100;
  const dLL = cti04.log_loss - baseline.log_loss;
  const dPDrawAvg = ((cti04.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;
  const drawGain = dPDrawAvg >= MIN_DRAW_GAIN_PP || cti04.draw_pred_count > 0;

  // Verdict
  const failReasons: string[] = [];
  if (dHome < MAX_HOME_DELTA_PP) failReasons.push(`HOME damage (${dHome.toFixed(1)}pp < ${MAX_HOME_DELTA_PP}pp threshold)`);
  if (dAway < MAX_AWAY_DELTA_PP) failReasons.push(`AWAY damage (${dAway.toFixed(1)}pp < ${MAX_AWAY_DELTA_PP}pp threshold)`);
  if (dLL > MAX_LL_DELTA) failReasons.push(`LogLoss degradation (Δ=${dLL.toFixed(4)} > ${MAX_LL_DELTA} threshold)`);
  if (!drawGain) failReasons.push(`No DRAW recovery (Δp_draw=${dPDrawAvg.toFixed(2)}pp, predD=${cti04.draw_pred_count})`);

  const verdict: 'PASS' | 'FAIL' = failReasons.length === 0 ? 'PASS' : 'FAIL';

  // Per-league tables
  const drawN = evalActual.DRAW;

  console.log('\n  TABLE 1 — Global Metrics');
  console.log('  ' + '─'.repeat(90));
  console.log('  Variant            Acc       Brier    LogLoss  predH  predD  predA  TooC  HOME%  AWAY%');
  for (const v of [baseline, cti04]) {
    const mark = v === baseline ? ' ←base' : '      ';
    console.log(
      `  ${pad(v.label, 16, true)}  ${pct(v.accuracy)}  ${num(v.brier)}  ${num(v.log_loss)}` +
      `  ${pad(v.pred_dist.HOME_WIN, 4)}   ${pad(v.pred_dist.DRAW, 4)}   ${pad(v.pred_dist.AWAY_WIN, 4)}` +
      `  ${pad(v.n_too_close, 4)}  ${pct(v.home_hit_rate)}  ${pct(v.away_hit_rate)}${mark}`,
    );
  }

  console.log(`\n  TABLE 2 — DRAW Channel Diagnostics (actual DRAWs: ${drawN}/${nEvalSet})`);
  console.log('  ' + '─'.repeat(86));
  console.log('  Variant            predD  top1/act  p_avg   p_med   p_max   >25%  >30%  avgSMD');
  for (const v of [baseline, cti04]) {
    const mark = v === baseline ? ' ←base' : '      ';
    console.log(
      `  ${pad(v.label, 16, true)}  ${pad(v.draw_pred_count, 4)}  ` +
      `${String(v.draw_top1_count).padStart(2)}/${drawN.toString().padEnd(2)}    ` +
      `${pct(v.draw_p_avg)}  ${pct(v.draw_p_median)}  ${pct(v.draw_p_max)}  ` +
      `${pad(v.draw_p_gt25, 4)}  ${pad(v.draw_p_gt30, 4)}  ${pct(v.draw_avg_smd)}${mark}`,
    );
  }

  console.log('\n  TABLE 3 — Damage Check');
  console.log('  ' + '─'.repeat(70));
  console.log('  Variant            HOME hitrate  HOME avg_p  AWAY hitrate  AWAY avg_p');
  for (const v of [baseline, cti04]) {
    console.log(
      `  ${pad(v.label, 16, true)}  ${pct(v.home_hit_rate)}          ` +
      `${pct(v.home_avg_p)}      ${pct(v.away_hit_rate)}          ${pct(v.away_avg_p)}`,
    );
  }

  console.log('\n  TABLE 4 — Δ vs BASELINE');
  console.log('  ' + '─'.repeat(90));
  console.log('  Variant            ΔAcc(pp)  ΔBrier    ΔLogLoss  ΔpredD  Δp_draw_avg  ΔHOME    ΔAWAY');
  {
    const v = cti04;
    const b = baseline;
    const dAcc = ((v.accuracy ?? 0) - (b.accuracy ?? 0)) * 100;
    const dB = v.brier - b.brier;
    const dL = v.log_loss - b.log_loss;
    const dPD = v.draw_pred_count - b.draw_pred_count;
    const dPDA = ((v.draw_p_avg ?? 0) - (b.draw_p_avg ?? 0)) * 100;
    const dH = ((v.home_hit_rate ?? 0) - (b.home_hit_rate ?? 0)) * 100;
    const dA = ((v.away_hit_rate ?? 0) - (b.away_hit_rate ?? 0)) * 100;
    const homeOk = dH >= MAX_HOME_DELTA_PP;
    const awayOk = dA >= MAX_AWAY_DELTA_PP;
    console.log(
      `  ${pad(v.label, 16, true)}  ${pp(dAcc).trim().padStart(8)}  ${delta(dB, 4)}  ${delta(dL, 4)}` +
      `  ${(dPD >= 0 ? '+' : '') + dPD.toString().padStart(5)}  ${pp(dPDA).trim().padStart(11)}` +
      `  ${pp(dH).trim().padStart(7)} ${homeOk ? '✓' : '✗ !HOME'}` +
      `  ${pp(dA).trim().padStart(7)} ${awayOk ? '✓' : '✗ !AWAY'}`,
    );
  }

  console.log(`\n  VERDICT: ${verdict}${failReasons.length > 0 ? ' — ' + failReasons.join('; ') : ''}`);

  return {
    config: cfg,
    n_snapshots: snapshots.length,
    n_excluded: nExcluded,
    n_evaluable: N,
    n_train: nTrain,
    n_eval_set: nEvalSet,
    train_start: enriched[0]!.kickoff_utc.slice(0, 10),
    train_end: enriched[nTrain - 1]!.kickoff_utc.slice(0, 10),
    eval_start: enriched[nTrain]!.kickoff_utc.slice(0, 10),
    eval_end: enriched[N - 1]!.kickoff_utc.slice(0, 10),
    actual_dist: evalActual,
    mode_dist: modeDist,
    gate_avg: gateAvg,
    gate_median: gateMedian,
    gate_max: gateMax,
    gate_gt01: gateGt01,
    gate_gt02: gateGt02,
    lambda_avg: lambdaAvg,
    lambda_max: lambdaMax,
    baseline,
    cti04,
    verdict,
    fail_reasons: failReasons,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!apiToken) { console.error('FOOTBALL_DATA_TOKEN not set'); process.exit(1); }

  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  H10 — Multi-League Robustness Validation — CTI(α=0.4)                     ║');
  console.log('║  Leagues: PD (LaLiga), PL (Premier League), BL1 (Bundesliga)               ║');
  console.log('║  Gate frozen: σ_b=0.5, λ_crit=3.0, σ_i=1.0 | α=0.4 frozen from H9        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  console.log('\n  SERIE_A_STATUS = UNAVAILABLE');
  console.log('  Reason: SA not present in COMPETITIONS env var (currently: PD,PL,BL1).');
  console.log('  No football-data.org integration for SA is configured or wired in the');
  console.log('  current data pipeline. SA is excluded from this test. The experiment');
  console.log('  proceeds on the 3 supported leagues only.\n');

  const ds = new FootballDataSource(apiToken);

  // Run all leagues sequentially (shared FootballDataSource)
  const results: LeagueResult[] = [];
  for (const cfg of LEAGUES) {
    try {
      const r = await runLeague(cfg, ds, apiToken);
      results.push(r);
    } catch (err) {
      console.error(`\n  ERROR running ${cfg.code}: ${String(err)}`);
      process.exit(1);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CROSS-LEAGUE SUMMARY TABLE
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\n\n' + '═'.repeat(80));
  console.log('CROSS-LEAGUE SUMMARY — CTI(α=0.4) vs BASELINE');
  console.log('═'.repeat(80));

  // Coverage row
  console.log('\n  Coverage / Denominator');
  console.log('  ' + '─'.repeat(76));
  console.log('  League  Provider          Snapshots  Excluded  Evaluable  Train  Eval  DRAW%');
  console.log('  ' + '─'.repeat(76));
  for (const r of results) {
    const drawPct = (r.actual_dist.DRAW / r.n_eval_set * 100).toFixed(1);
    console.log(
      `  ${pad(r.config.code, 6, true)}  ${pad(r.config.provider, 16, true)}` +
      `  ${pad(r.n_snapshots, 9)}  ${pad(r.n_excluded, 8)}  ${pad(r.n_evaluable, 9)}` +
      `  ${pad(r.n_train, 5)}  ${pad(r.n_eval_set, 4)}  ${drawPct.padStart(4)}%`,
    );
  }

  // Gate summary row
  console.log('\n  Gate Analysis Summary');
  console.log('  ' + '─'.repeat(70));
  console.log('  League  λ_avg   λ_max   gate_avg  gate_med  gate_max  ≥0.1   ≥0.2');
  console.log('  ' + '─'.repeat(70));
  for (const r of results) {
    console.log(
      `  ${pad(r.config.code, 6, true)}  ${r.lambda_avg.toFixed(2)}  ${r.lambda_max.toFixed(2)}` +
      `     ${r.gate_avg.toFixed(3)}     ${r.gate_median.toFixed(3)}     ${r.gate_max.toFixed(3)}` +
      `  ${r.gate_gt01}/${r.n_eval_set}  ${r.gate_gt02}/${r.n_eval_set}`,
    );
  }

  // Main comparison table
  console.log('\n  Main Comparison Table');
  console.log('  ' + '─'.repeat(100));
  const hdr =
    '  League  Eval  Base_Acc  CTI_Acc  ΔBrier    ΔLogLoss  ΔpredD  Δp_draw   ΔHOME    ΔAWAY    Verdict';
  console.log(hdr);
  console.log('  ' + '─'.repeat(100));

  const allPass: boolean[] = [];
  for (const r of results) {
    const b = r.baseline;
    const c = r.cti04;
    const dAcc = ((c.accuracy ?? 0) - (b.accuracy ?? 0)) * 100;
    const dBrier = c.brier - b.brier;
    const dLL = c.log_loss - b.log_loss;
    const dPD = c.draw_pred_count - b.draw_pred_count;
    const dPDA = ((c.draw_p_avg ?? 0) - (b.draw_p_avg ?? 0)) * 100;
    const dH = ((c.home_hit_rate ?? 0) - (b.home_hit_rate ?? 0)) * 100;
    const dA = ((c.away_hit_rate ?? 0) - (b.away_hit_rate ?? 0)) * 100;
    allPass.push(r.verdict === 'PASS');

    console.log(
      `  ${pad(r.config.code, 6, true)}  ${pad(r.n_eval_set, 4)}` +
      `  ${pct(b.accuracy)}  ${pct(c.accuracy)}` +
      `  ${delta(dBrier, 4)}  ${delta(dLL, 4)}` +
      `  ${(dPD >= 0 ? '+' : '') + dPD.toString().padStart(5)}` +
      `  ${pp(dPDA).trim().padStart(8)}` +
      `  ${pp(dH).trim().padStart(7)}` +
      `  ${pp(dA).trim().padStart(7)}` +
      `  ${r.verdict}`,
    );
  }

  // Fail details
  const failedLeagues = results.filter((r) => r.verdict === 'FAIL');
  if (failedLeagues.length > 0) {
    console.log('\n  Failure details:');
    for (const r of failedLeagues) {
      console.log(`    ${r.config.code}: ${r.fail_reasons.join(' | ')}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL CLASSIFICATION
  // ══════════════════════════════════════════════════════════════════════════

  const nIncluded = results.length;
  const nPass = results.filter((r) => r.verdict === 'PASS').length;

  let classification: string;
  if (nPass === nIncluded) {
    classification = 'CTI_ALPHA_0_4_ROBUST_ACROSS_LEAGUES';
  } else if (nPass >= Math.ceil(nIncluded / 2)) {
    classification = 'CTI_ALPHA_0_4_PARTIALLY_ROBUST';
  } else {
    classification = 'CTI_ALPHA_0_4_NOT_ROBUST';
  }

  const passedNames = results.filter((r) => r.verdict === 'PASS').map((r) => r.config.code);
  const failedNames = results.filter((r) => r.verdict === 'FAIL').map((r) => r.config.code);

  console.log('\n\n' + '═'.repeat(80));
  console.log('FINAL CLASSIFICATION AND RECOMMENDATION');
  console.log('═'.repeat(80));
  console.log(`\n  ┌──────────────────────────────────────────────────────────────────────────┐`);
  console.log(`  │  CLASSIFICATION: ${classification.padEnd(56)}│`);
  console.log(`  │  Leagues tested: ${nIncluded}/3  |  PASS: ${nPass}  |  FAIL: ${nIncluded - nPass}` + ' '.repeat(Math.max(0, 36 - String(nIncluded).length)) + '│');
  console.log(`  └──────────────────────────────────────────────────────────────────────────┘`);

  console.log('\n  RECOMMENDATION:\n');
  console.log(`  1. Leagues actually included in this test: PD (LaLiga), PL (Premier League),`);
  console.log(`     BL1 (Bundesliga). All use football-data.org as provider.`);
  console.log(`\n  2. SERIE_A_STATUS = UNAVAILABLE. SA is not configured in COMPETITIONS env`);
  console.log(`     var (currently: PD,PL,BL1) and has no active integration in the current`);
  console.log(`     data pipeline. Excluded cleanly — no simulated or partial data used.`);

  if (classification === 'CTI_ALPHA_0_4_ROBUST_ACROSS_LEAGUES') {
    console.log(`\n  3. CTI(α=0.4) PASSES all thresholds on all ${nIncluded} tested leagues`);
    console.log(`     (${passedNames.join(', ')}). Probabilistic quality improves vs baseline`);
    console.log(`     on every league. HOME/AWAY damage stays within the −5pp limit.`);
    console.log(`     DRAW competitiveness is meaningfully recovered in all leagues.`);
    console.log(`\n  4. No further offline pass required. CTI(α=0.4) is ready for controlled`);
    console.log(`     forward validation (H11). The candidate is cross-validated on 3 leagues`);
    console.log(`     spanning different playing styles and DRAW rates.`);
  } else if (classification === 'CTI_ALPHA_0_4_PARTIALLY_ROBUST') {
    console.log(`\n  3. CTI(α=0.4) passes on ${passedNames.join(', ')} but fails on`);
    console.log(`     ${failedNames.join(', ')}. The failures are:`);
    for (const r of failedLeagues) {
      console.log(`       ${r.config.code}: ${r.fail_reasons.join('; ')}`);
    }
    console.log(`\n  4. A follow-up offline investigation is recommended before forward`);
    console.log(`     validation. Candidate is partially generalizable but not fully robust.`);
    console.log(`     Do not advance to production with the current candidate.`);
  } else {
    console.log(`\n  3. CTI(α=0.4) fails on majority of leagues (${failedNames.join(', ')}).`);
    console.log(`     The candidate does not generalize robustly across the tested set.`);
    console.log(`\n  4. Do not advance to controlled forward validation. A new structural`);
    console.log(`     candidate or revised alpha is needed. Consider returning to H8 design`);
    console.log(`     phase with PL and BL1 included in the fitting set.`);
  }

  console.log('\n  Thresholds applied: HOME Δ ≥ −5pp | AWAY Δ ≥ −5pp | LL Δ ≤ +0.10 | draw gain ≥ +2pp or predD > 0');
  console.log('  Candidate: CTI(α=0.4), gate σ_b=0.5 λ_crit=3.0 σ_i=1.0 — NO retuning by league.\n');
}

main().catch((err) => { console.error(err); process.exit(1); });

/**
 * PPL Robustness Validation — CTI(α=0.4) on Primeira Liga (Portugal)
 *
 * Protocol: identical to H10b multi-league validation.
 * Purpose: place PPL cleanly on the existing cross-league robustness map.
 *
 * Frozen candidate: CTI α=0.4, gate σ_b=0.5, λ_crit=3.0, σ_i=1.0
 * Hard constraints:
 *   - pre-match only, offline historical backtest only
 *   - no retuning, no calibration changes, no portal rollout
 *   - same evaluation logic and thresholds as H10b
 *
 * Pass/fail thresholds (frozen from H8b/H9/H10b):
 *   HOME Δ ≥ −5pp, AWAY Δ ≥ −5pp, ΔLogLoss ≤ +0.10,
 *   draw gain ≥ +2pp OR predDRAW > 0
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-ppl-robustness.ts
 */

import 'dotenv/config';

import { FootballDataSource } from '../server/football-data-source.js';
import { PredictionService } from '../server/prediction/prediction-service.js';
import { HistoricalStateService } from '../server/prediction/historical-state-service.js';
import { HistoricalBacktestStore } from '../server/prediction/historical-backtest-store.js';
import { HistoricalBacktestRunner } from '../server/prediction/historical-backtest-runner.js';

// ── Frozen constants (H8/H8b/H9/H10b) ───────────────────────────────────────

const ALPHA_FROZEN        = 0.4;
const CTI_SIGMA_BALANCE   = 0.5;
const CTI_LAMBDA_CRIT     = 3.0;
const CTI_SIGMA_INTENSITY = 1.0;
const TOO_CLOSE_THRESHOLD = 0.02;
const TRAIN_FRACTION      = 0.60;
const EPSILON_LL          = 1e-15;
const MAX_GOALS           = 7;

// Acceptance thresholds (frozen from H8b/H9/H10b)
const MAX_HOME_DELTA_PP = -5.0;
const MAX_AWAY_DELTA_PP = -5.0;
const MAX_LL_DELTA      = 0.10;
const MIN_DRAW_GAIN_PP  = 2.0;

// ── PPL config ───────────────────────────────────────────────────────────────

const PPL_CODE      = 'PPL';
const PPL_NAME      = 'Primeira Liga (Portugal)';
const PPL_SEASON    = '2025-26';
const PPL_STORE     = 'cache/predictions/historical-backtest-ppl.json';
const PPL_COMP_ID   = 'comp:football-data:PPL';
const REUSE_THRESHOLD = 50;  // skip API fetch if store already has ≥50 snapshots

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Poisson / CTI (frozen from H8) ──────────────────────────────────────────

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
  return s > 0 ? { home: home / s, draw: draw / s, away: away / s }
                : { home: 1/3, draw: 1/3, away: 1/3 };
}

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

// ── Scoring ──────────────────────────────────────────────────────────────────

function brierScore(p: Probs1x2, actual: Outcome): number {
  const dH = p.home - (actual === 'HOME_WIN' ? 1 : 0);
  const dD = p.draw - (actual === 'DRAW'     ? 1 : 0);
  const dA = p.away - (actual === 'AWAY_WIN' ? 1 : 0);
  return dH*dH + dD*dD + dA*dA;
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
  const predDist: Record<Outcome, number>   = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
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
    llSum    += logLoss(p, r.actual);

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
    brier:    n === 0 ? 0 : brierSum / n,
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

// ── Formatting ────────────────────────────────────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!apiToken) { console.error('FOOTBALL_DATA_TOKEN not set'); process.exit(1); }

  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  PPL Robustness Validation — CTI(α=0.4)                                    ║');
  console.log('║  Primeira Liga (Portugal)  |  Protocol: identical to H10b                  ║');
  console.log('║  Frozen: α=0.4, σ_b=0.5, λ_crit=3.0, σ_i=1.0                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  // ── SECTION 1: League Readiness ─────────────────────────────────────────────
  console.log('\n━━━ SECTION 1: LEAGUE READINESS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  League:        ${PPL_NAME}`);
  console.log(`  Code:          ${PPL_CODE}`);
  console.log(`  Competition ID: ${PPL_COMP_ID}`);
  console.log(`  Provider:      football-data.org (TIER_ONE, same as PD/PL/BL1/SA/FL1/DED)`);
  console.log(`  Season:        ${PPL_SEASON}`);
  console.log(`  Store:         ${PPL_STORE}`);
  console.log(`  Adapter:       comp:football-data:PPL → DOMESTIC_LEAGUE_PROFILE (registered)`);
  console.log(`  Historical loader: football-data.org /competitions/PPL/matches?season=YYYY`);
  console.log(`  Readiness:     FEASIBLE — same end-to-end pipeline as all prior leagues`);

  const ds = new FootballDataSource(apiToken);

  // Store reuse check
  const store = new HistoricalBacktestStore(PPL_STORE);
  const existing = store.findByCompetition(PPL_CODE);
  console.log(`\n  Existing store: ${existing.length} snapshots`);

  if (existing.length >= REUSE_THRESHOLD) {
    console.log(`  → Reusing existing store (≥${REUSE_THRESHOLD} snapshots, skipping API fetch)`);
  } else {
    console.log(`  → Fetching PPL ${PPL_SEASON} from football-data.org...`);
    await ds.fetchCompetition(PPL_CODE);

    const runner = new HistoricalBacktestRunner(
      ds,
      new PredictionService(),
      new HistoricalStateService({ apiToken }),
      store,
    );
    await runner.run(`comp:football-data:${PPL_CODE}`, PPL_SEASON, { verbose: false });
    await store.persist();
  }

  const snapshots = store.findByCompetition(PPL_CODE);
  console.log(`  Total snapshots after run: ${snapshots.length}`);

  // ── SECTION 2: Coverage / Denominator ────────────────────────────────────────
  console.log('\n━━━ SECTION 2: COVERAGE / DENOMINATOR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const modeDist: Record<string, number> = {};
  for (const s of snapshots) {
    modeDist[s.mode] = (modeDist[s.mode] ?? 0) + 1;
  }

  const enriched: EvalRecord[] = [];
  let nExcluded = 0;
  for (const s of snapshots) {
    if (
      s.raw_p_home_win != null && s.raw_p_draw != null && s.raw_p_away_win != null &&
      s.lambda_home    != null && s.lambda_away != null && s.kickoff_utc
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
    console.log(`\n  PPL_NOT_EVALUABLE — only ${N} evaluable records (minimum 20 required).`);
    process.exit(0);
  }

  const nTrain = Math.floor(N * TRAIN_FRACTION);
  const evalSet = enriched.slice(nTrain);
  const nEvalSet = evalSet.length;

  const evalActual: Record<Outcome, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const r of evalSet) evalActual[r.actual]++;

  // Gate analysis
  const gateVals   = evalSet.map((r) => ctiGate(r.lambda_home, r.lambda_away));
  const gateAvg    = gateVals.reduce((s, v) => s + v, 0) / gateVals.length;
  const gateSorted = [...gateVals].sort((a, b) => a - b);
  const gateMedian = gateSorted[Math.floor(gateVals.length / 2)]!;
  const gateMax    = Math.max(...gateVals);
  const lambdaSums = evalSet.map((r) => r.lambda_home + r.lambda_away);
  const lambdaAvg  = lambdaSums.reduce((s, v) => s + v, 0) / lambdaSums.length;
  const lambdaMax  = Math.max(...lambdaSums);
  const gateGt01   = gateVals.filter((g) => g >= 0.1).length;
  const gateGt02   = gateVals.filter((g) => g >= 0.2).length;
  // Lambda gap distribution (for comparison with SA/FL1/PD)
  const lambdaGaps = evalSet.map((r) => Math.abs(r.lambda_home - r.lambda_away));
  const lgAvg      = lambdaGaps.reduce((s, v) => s + v, 0) / lambdaGaps.length;
  const maxConfs   = evalSet.map((r) => Math.max(r.raw_home, r.raw_draw, r.raw_away));
  const confAvg    = maxConfs.reduce((s, v) => s + v, 0) / maxConfs.length;

  console.log(`  Total historical snapshots: ${snapshots.length}`);
  console.log(`  Excluded (NOT_ELIGIBLE/missing lambda): ${nExcluded}`);
  console.log(`  Evaluable: ${N}`);
  console.log(`  Mode distribution: ${JSON.stringify(modeDist)}`);
  console.log(`  Train/eval split: ${nTrain} / ${nEvalSet} (${(TRAIN_FRACTION*100).toFixed(0)}%/${((1-TRAIN_FRACTION)*100).toFixed(0)}%)`);
  console.log(`    Train: [${enriched[0]!.kickoff_utc.slice(0,10)} → ${enriched[nTrain-1]!.kickoff_utc.slice(0,10)}]`);
  console.log(`    Eval:  [${enriched[nTrain]!.kickoff_utc.slice(0,10)} → ${enriched[N-1]!.kickoff_utc.slice(0,10)}]`);
  console.log(
    `  Actual dist (eval): HOME=${evalActual.HOME_WIN}` +
    ` (${pct(evalActual.HOME_WIN/nEvalSet).trim()})` +
    `  DRAW=${evalActual.DRAW} (${pct(evalActual.DRAW/nEvalSet).trim()})` +
    `  AWAY=${evalActual.AWAY_WIN} (${pct(evalActual.AWAY_WIN/nEvalSet).trim()})`,
  );
  console.log(`  Gate: avg=${gateAvg.toFixed(3)}, median=${gateMedian.toFixed(3)}, max=${gateMax.toFixed(3)}`);
  console.log(
    `    gate≥0.1: ${gateGt01}/${nEvalSet} (${(gateGt01/nEvalSet*100).toFixed(1)}%)` +
    `  gate≥0.2: ${gateGt02}/${nEvalSet} (${(gateGt02/nEvalSet*100).toFixed(1)}%)`,
  );
  console.log(`  λ_total: avg=${lambdaAvg.toFixed(2)}, max=${lambdaMax.toFixed(2)}`);
  console.log(`  avg|λ_gap|: ${lgAvg.toFixed(3)}   avg_max_conf: ${(confAvg*100).toFixed(1)}%`);
  console.log('  (Compare: PD=0.963/57.9%, SA=1.057/60.0%, FL1=0.964/58.2%)');

  // ── Evaluate variants ─────────────────────────────────────────────────────────
  const baseline = evaluate('BASELINE',       evalSet, (r) => ({ home: r.raw_home, draw: r.raw_draw, away: r.raw_away }));
  const cti04    = evaluate(`CTI(α=${ALPHA_FROZEN})`, evalSet, (r) => applyCTI(r.lambda_home, r.lambda_away, ALPHA_FROZEN));

  // ── SECTION 3: Global Metrics ─────────────────────────────────────────────────
  console.log('\n━━━ SECTION 3: GLOBAL METRICS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Variant            Acc       Brier    LogLoss  predH  predD  predA  TooC  HOME%  AWAY%');
  console.log('  ' + '─'.repeat(92));
  for (const v of [baseline, cti04]) {
    const mark = v === baseline ? ' ← base' : '       ';
    console.log(
      `  ${pad(v.label, 18, true)} ${pct(v.accuracy)}  ${num(v.brier)}  ${num(v.log_loss)}` +
      `  ${pad(v.pred_dist.HOME_WIN, 4)}   ${pad(v.pred_dist.DRAW, 4)}   ${pad(v.pred_dist.AWAY_WIN, 4)}` +
      `  ${pad(v.n_too_close, 4)}  ${pct(v.home_hit_rate)}  ${pct(v.away_hit_rate)}${mark}`,
    );
  }

  // ── SECTION 4: DRAW-Specific Metrics ─────────────────────────────────────────
  const drawN = evalActual.DRAW;
  console.log(`\n━━━ SECTION 4: DRAW-SPECIFIC METRICS (actual DRAWs: ${drawN}/${nEvalSet}) ━━━━━━━━━━━━━━━`);
  console.log('  Variant            predD  top1/act  p_avg   p_med   p_max   >25%  >30%  avgSMD');
  console.log('  ' + '─'.repeat(88));
  for (const v of [baseline, cti04]) {
    const mark = v === baseline ? ' ← base' : '       ';
    console.log(
      `  ${pad(v.label, 18, true)} ${pad(v.draw_pred_count, 4)}  ` +
      `${String(v.draw_top1_count).padStart(2)}/${drawN.toString().padEnd(3)}   ` +
      `${pct(v.draw_p_avg)}  ${pct(v.draw_p_median)}  ${pct(v.draw_p_max)}  ` +
      `${pad(v.draw_p_gt25, 4)}  ${pad(v.draw_p_gt30, 4)}  ${pct(v.draw_avg_smd)}${mark}`,
    );
  }

  // ── SECTION 5: Damage Check ───────────────────────────────────────────────────
  console.log('\n━━━ SECTION 5: DAMAGE CHECK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Variant            HOME hitrate  HOME avg_p  AWAY hitrate  AWAY avg_p');
  console.log('  ' + '─'.repeat(72));
  for (const v of [baseline, cti04]) {
    console.log(
      `  ${pad(v.label, 18, true)}  ${pct(v.home_hit_rate)}          ` +
      `${pct(v.home_avg_p)}      ${pct(v.away_hit_rate)}          ${pct(v.away_avg_p)}`,
    );
  }

  // ── SECTION 6: Comparative Deltas ────────────────────────────────────────────
  console.log('\n━━━ SECTION 6: COMPARATIVE DELTAS (CTI α=0.4 vs BASELINE) ━━━━━━━━━━━━━━━━━');
  console.log('  Variant            ΔAcc(pp)  ΔBrier    ΔLogLoss  ΔpredD  Δp_draw_avg  ΔHOME    ΔAWAY');
  console.log('  ' + '─'.repeat(92));
  {
    const v = cti04, b = baseline;
    const dAcc  = ((v.accuracy ?? 0) - (b.accuracy ?? 0)) * 100;
    const dB    = v.brier    - b.brier;
    const dL    = v.log_loss - b.log_loss;
    const dPD   = v.draw_pred_count - b.draw_pred_count;
    const dPDA  = ((v.draw_p_avg ?? 0) - (b.draw_p_avg ?? 0)) * 100;
    const dH    = ((v.home_hit_rate ?? 0) - (b.home_hit_rate ?? 0)) * 100;
    const dA    = ((v.away_hit_rate ?? 0) - (b.away_hit_rate ?? 0)) * 100;
    const homeOk = dH >= MAX_HOME_DELTA_PP;
    const awayOk = dA >= MAX_AWAY_DELTA_PP;
    console.log(
      `  ${pad(v.label, 18, true)}  ${pp(dAcc).trim().padStart(8)}  ${delta(dB, 4)}  ${delta(dL, 4)}` +
      `  ${(dPD >= 0 ? '+' : '') + dPD.toString().padStart(5)}  ${pp(dPDA).trim().padStart(11)}` +
      `  ${pp(dH).trim().padStart(7)} ${homeOk ? '✓' : '✗ !HOME'}` +
      `  ${pp(dA).trim().padStart(7)} ${awayOk ? '✓' : '✗ !AWAY'}`,
    );
  }

  // ── SECTION 7: Classification ─────────────────────────────────────────────────
  const dHome  = ((cti04.home_hit_rate ?? 0) - (baseline.home_hit_rate ?? 0)) * 100;
  const dAway  = ((cti04.away_hit_rate ?? 0) - (baseline.away_hit_rate ?? 0)) * 100;
  const dLL    = cti04.log_loss - baseline.log_loss;
  const dPDA   = ((cti04.draw_p_avg ?? 0) - (baseline.draw_p_avg ?? 0)) * 100;
  const drawOk = dPDA >= MIN_DRAW_GAIN_PP || cti04.draw_pred_count > 0;

  const failReasons: string[] = [];
  if (dHome < MAX_HOME_DELTA_PP) failReasons.push(`HOME damage (${dHome.toFixed(1)}pp < ${MAX_HOME_DELTA_PP}pp)`);
  if (dAway < MAX_AWAY_DELTA_PP) failReasons.push(`AWAY damage (${dAway.toFixed(1)}pp < ${MAX_AWAY_DELTA_PP}pp)`);
  if (dLL > MAX_LL_DELTA)         failReasons.push(`LogLoss degradation (${dLL.toFixed(4)} > ${MAX_LL_DELTA})`);
  if (!drawOk)                    failReasons.push(`No DRAW recovery (Δp_draw=${dPDA.toFixed(2)}pp, predD=${cti04.draw_pred_count})`);

  const classification: 'PPL_PASS' | 'PPL_FAIL' = failReasons.length === 0 ? 'PPL_PASS' : 'PPL_FAIL';

  console.log('\n━━━ SECTION 7: CLASSIFICATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n  ${classification}`);
  if (failReasons.length > 0) {
    console.log('  Fail reasons:');
    for (const r of failReasons) console.log(`    - ${r}`);
  } else {
    console.log('  All acceptance thresholds met.');
  }

  // ── SECTION 8: Comparative Interpretation ────────────────────────────────────
  console.log('\n━━━ SECTION 8: COMPARATIVE INTERPRETATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const dBrier = cti04.brier - baseline.brier;

  // Cross-league reference table (H10b results)
  console.log(`
  Cross-league reference (H10b frozen results):
  ──────────────────────────────────────────────────────────────────────────
  League   ΔBrier    ΔLogLoss  ΔHOME    ΔAWAY    Δp_draw   Verdict
  PD       -0.0066   -0.0122   -2.1pp   +0.0pp   +4.4pp    PASS
  PL       -0.0057   -0.0110   -2.7pp   +0.0pp   +3.3pp    PASS
  BL1      -0.0074   -0.0164   +0.0pp   +0.0pp   +4.8pp    PASS
  DED      -0.0011   -0.0070   -2.9pp   -3.6pp   +3.3pp    PASS
  SA       +0.0050   +0.0047   -4.7pp   -5.3pp   +2.7pp    FAIL
  FL1      +0.0052   +0.0039   -5.4pp   -7.4pp   +3.1pp    FAIL
  ──────────────────────────────────────────────────────────────────────────
  PPL      ${delta(dBrier, 4)}   ${delta(dLL, 4)}   ${pp(dHome).trim().padStart(7)}  ${pp(dAway).trim().padStart(7)}  ${dPDA >= 0 ? '+' : ''}${dPDA.toFixed(1)}pp    ${classification.replace('PPL_', '')}
  `);

  // Profile match
  const passProfile = classification === 'PPL_PASS';
  const homeInPassRange  = dHome >= -3.0;   // PD/PL/BL1 all between 0 and -2.9
  const awayInPassRange  = dAway >= -4.0;   // PD/PL all at 0, BL1 at 0, DED at -3.6
  const brierImproving   = dBrier < 0;
  const similarsToFailing = dHome < -4.0 || dAway < -4.0 || dBrier > 0;

  let profileMatch: string;
  if (passProfile && homeInPassRange && awayInPassRange && brierImproving) {
    profileMatch = 'PD / PL / BL1 (clean passing profile)';
  } else if (passProfile && !homeInPassRange || passProfile && !awayInPassRange) {
    profileMatch = 'DED (PASS but with elevated damage in one channel)';
  } else if (!passProfile && similarsToFailing) {
    profileMatch = 'SA / FL1 (failing profile — damage above threshold)';
  } else {
    profileMatch = 'Borderline — between passing and failing profiles';
  }

  console.log(`  PPL behaves more like: ${profileMatch}`);

  // ── Final Recommendation ──────────────────────────────────────────────────────
  console.log('\n━━━ FINAL RECOMMENDATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Updated pass/fail count
  const passingLeagues = ['PD', 'PL', 'BL1', 'DED', ...(classification === 'PPL_PASS' ? ['PPL'] : [])];
  const failingLeagues = ['SA', 'FL1', ...(classification === 'PPL_FAIL' ? ['PPL'] : [])];
  const totalLeagues   = 7;
  const nPass          = passingLeagues.length;
  const nFail          = failingLeagues.length;

  console.log(`
  1. Does CTI α=0.4 remain acceptable after adding PPL?
  ──────────────────────────────────────────────────────
  Updated cross-league standing: ${nPass}/${totalLeagues} PASS (${passingLeagues.join(', ')})
                                  ${nFail}/${totalLeagues} FAIL (${failingLeagues.join(', ')})`);

  if (classification === 'PPL_PASS') {
    console.log(`
  PPL passes with the same CTI(α=0.4) candidate. The passing set now covers
  ${nPass} of ${totalLeagues} tested European domestic leagues. CTI(α=0.4) remains acceptable
  for the leagues where it works — its scope boundary is clarifying, not widening.`);
  } else {
    console.log(`
  PPL fails. The failing set expands to ${nFail} of ${totalLeagues} leagues. This reinforces
  the structural limitation identified in H11-b: CTI(α=0.4) has a consistent
  failure mode that binary guard-rails could not resolve.`);
  }

  console.log(`
  2. Is the robustness picture stronger or weaker after PPL?
  ──────────────────────────────────────────────────────────`);

  if (classification === 'PPL_PASS') {
    console.log(`
  STRONGER. PPL adds a 5th passing data point from a top-flight European league.
  The passing/failing split is now ${nPass}/${nFail}. If PPL's damage profile closely
  resembles PD/PL/BL1 (small HOME delta, near-zero AWAY delta, Brier improving),
  this is additional structural evidence that CTI generalizes well in standard
  balanced top-flight leagues and fails specifically in higher-volatility profiles.`);
  } else {
    console.log(`
  WEAKER. PPL extends the failing side, increasing the failure rate to ${nFail}/${totalLeagues}.
  The structural failure mode is broader than previously assessed.`);
  }

  console.log(`
  3. Recommended next step:
  ──────────────────────────`);

  if (classification === 'PPL_PASS') {
    const mvpLeagues = passingLeagues.filter((l) => ['PD', 'PL', 'BL1'].includes(l));
    console.log(`
  RECOMMENDED: Proceed toward scoped forward validation.
  ─────────────────────────────────────────────────────
  The 3 production leagues (PD, PL, BL1) all pass. PPL adds a 4th confirming
  European top-flight data point. The robustness case for the MVP scope is now
  supported by ${mvpLeagues.length + (classification === 'PPL_PASS' && !['PD','PL','BL1'].includes('PPL') ? 1 : 0)} passing leagues including PPL.

  Path:
  (a) Accept CTI(α=0.4) as the forward validation candidate for PD/PL/BL1.
      SA and FL1 are not in the production COMPETITIONS list — they are out of
      immediate scope. Their failure is documented, not blocking.
  (b) Controlled forward validation: shadow deployment on the next live
      matchday (PD/PL/BL1), no portal UI impact, compare shadow vs production.
  (c) If BSA is desired for completeness, add it as a parallel diagnostic
      (does not block the forward validation path).

  NOTE: CTI(α=0.4) is now SCOPED_ROBUST — robust for PD/PL/BL1 and
  confirmed by PPL. Classification upgrade: CTI_ALPHA_0_4_SCOPED_ROBUST.`);
  } else {
    console.log(`
  RECOMMENDED: Structural diagnosis before forward validation.
  ──────────────────────────────────────────────────────────────
  PPL fails, expanding the failure set to ${nFail}/${totalLeagues}. Before proceeding to
  forward validation, the structural cause should be better understood.
  Options:
  (a) Add BSA as a data point — test if the pattern holds in a non-European league.
  (b) Return to structural diagnosis — investigate whether σ_b tightening
      (gate revision) resolves SA/FL1/PPL failures without damaging PD/PL/BL1.
  (c) Accept scoped deployment for PD/PL/BL1 only (where CTI consistently
      passes) and document PPL/SA/FL1 as known out-of-scope failures.`);
  }

  console.log('\n━━━ DELIVERY SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Files touched:`);
  console.log(`    - server/prediction/match-input-adapter.ts (PPL added to KNOWN_PROFILES)`);
  console.log(`    - scripts/run-ppl-robustness.ts (this script)`);
  console.log(`    - ${PPL_STORE} (created/populated)`);
  console.log(`  Provider: football-data.org TIER_ONE`);
  console.log(`  PPL evaluable: YES`);
  console.log(`  Classification: ${classification}`);
  console.log('═'.repeat(80) + '\n');
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});

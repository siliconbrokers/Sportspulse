/**
 * H6b — DRAW probability diagnosis: raw vs calibrated layer.
 *
 * Primary question: is the DRAW collapse already present in the raw Poisson
 * probability layer, or does it survive because the calibration/decision layer
 * suppresses an otherwise competitive draw probability?
 *
 * Runs the full historical backtest once (in memory) to capture the complete
 * PredictionResponse including internals, then performs analyses A–E.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-h6b-draw-diagnosis.ts
 *
 * Hard constraints:
 *   - diagnosis only
 *   - no production default changes
 *   - no calibration training
 *   - no TOO_CLOSE changes
 *   - source_type = HISTORICAL_BACKTEST only
 */
import 'dotenv/config';

import { FootballDataSource } from '../server/football-data-source.js';
import { PredictionService } from '../server/prediction/prediction-service.js';
import { HistoricalStateService } from '../server/prediction/historical-state-service.js';
import { HistoricalBacktestStore } from '../server/prediction/historical-backtest-store.js';
import { HistoricalBacktestRunner } from '../server/prediction/historical-backtest-runner.js';
import type { HistoricalBacktestSnapshot } from '../server/prediction/historical-backtest-store.js';

// ── Formatting helpers ─────────────────────────────────────────────────────

function pct(v: number | null, d = 1): string {
  if (v === null) return '   n/a';
  return (v * 100).toFixed(d).padStart(6) + '%';
}
function num(v: number | null, d = 3): string {
  return v === null ? '    n/a' : v.toFixed(d).padStart(7);
}
function pad(s: string | number, w: number, right = false): string {
  const str = String(s);
  return right ? str.padEnd(w) : str.padStart(w);
}

// ── Enriched record type ───────────────────────────────────────────────────

interface EnrichedRecord {
  // ground truth
  actual_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  // calibrated (from predictions.core)
  predicted_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;
  cal_p_home: number;
  cal_p_draw: number;
  cal_p_away: number;
  // raw (from internals.raw_1x2_probs)
  raw_p_home: number;
  raw_p_draw: number;
  raw_p_away: number;
  // lambdas and Elos
  lambda_home: number;
  lambda_away: number;
  effective_elo_home: number;
  effective_elo_away: number;
  // derived
  abs_elo_gap: number;
  abs_lambda_gap: number;
  raw_top1: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  cal_top1: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  raw_selected_minus_draw: number;
  cal_selected_minus_draw: number;
  delta_draw: number; // calibrated_p_draw - raw_p_draw
  calibration_mode: string;
}

function top1(h: number, d: number, a: number): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (h >= d && h >= a) return 'HOME_WIN';
  if (d >= h && d >= a) return 'DRAW';
  return 'AWAY_WIN';
}

function selectedMinusDraw(h: number, d: number, a: number): number {
  const t = top1(h, d, a);
  const top1Prob = t === 'HOME_WIN' ? h : t === 'DRAW' ? d : a;
  return top1Prob - d;
}

function enrich(snap: HistoricalBacktestSnapshot): EnrichedRecord | null {
  // Require raw + calibrated probs + lambdas + Elos
  if (
    snap.raw_p_home_win == null || snap.raw_p_draw == null || snap.raw_p_away_win == null ||
    snap.p_home_win == null || snap.p_draw == null || snap.p_away_win == null ||
    snap.lambda_home == null || snap.lambda_away == null ||
    snap.effective_elo_home == null || snap.effective_elo_away == null
  ) {
    return null;
  }
  const rH = snap.raw_p_home_win;
  const rD = snap.raw_p_draw;
  const rA = snap.raw_p_away_win;
  const cH = snap.p_home_win;
  const cD = snap.p_draw;
  const cA = snap.p_away_win;

  // Normalize predicted_result to canonical form
  let predicted: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null = null;
  if (snap.predicted_result === 'HOME_WIN') predicted = 'HOME_WIN';
  else if (snap.predicted_result === 'AWAY_WIN') predicted = 'AWAY_WIN';
  else if (snap.predicted_result === 'DRAW') predicted = 'DRAW';

  const absEloGap = Math.abs(snap.effective_elo_home - snap.effective_elo_away);
  const absLambdaGap = Math.abs(snap.lambda_home - snap.lambda_away);

  return {
    actual_result: snap.actual_result,
    predicted_result: predicted,
    cal_p_home: cH,
    cal_p_draw: cD,
    cal_p_away: cA,
    raw_p_home: rH,
    raw_p_draw: rD,
    raw_p_away: rA,
    lambda_home: snap.lambda_home,
    lambda_away: snap.lambda_away,
    effective_elo_home: snap.effective_elo_home,
    effective_elo_away: snap.effective_elo_away,
    abs_elo_gap: absEloGap,
    abs_lambda_gap: absLambdaGap,
    raw_top1: top1(rH, rD, rA),
    cal_top1: top1(cH, cD, cA),
    raw_selected_minus_draw: selectedMinusDraw(rH, rD, rA),
    cal_selected_minus_draw: selectedMinusDraw(cH, cD, cA),
    delta_draw: cD - rD,
    calibration_mode: snap.calibration_mode ?? 'unknown',
  };
}

// ── Statistical helpers ────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}
function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
function max(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const apiToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!apiToken) { console.error('FOOTBALL_DATA_TOKEN not set'); process.exit(1); }

  const CODE = 'PD';
  const COMP_ID = `comp:football-data:${CODE}`;

  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  H6b — DRAW Probability Diagnosis: Raw vs Calibrated — LaLiga (PD)  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // ── Run backtest (captures internals with raw probs) ─────────────────────
  process.stdout.write('Running backtest to capture raw + calibrated + internals...\n');
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
  console.log(`\nTotal snapshots: ${snapshots.length}`);

  // ── Enrich records ───────────────────────────────────────────────────────
  const allEnriched: EnrichedRecord[] = [];
  let enrichFailed = 0;

  for (const snap of snapshots) {
    const rec = enrich(snap);
    if (rec) {
      allEnriched.push(rec);
    } else {
      enrichFailed++;
    }
  }

  const N = allEnriched.length;
  console.log(`Evaluable (raw+calibrated probs present): ${N}`);
  console.log(`Excluded (NOT_ELIGIBLE / LIMITED_MODE / missing fields): ${enrichFailed}`);

  // Class distributions
  const actualDist = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  const rawTop1Dist = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  const calTop1Dist = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  const calPredDist = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0, TOO_CLOSE: 0 };

  for (const r of allEnriched) {
    actualDist[r.actual_result]++;
    rawTop1Dist[r.raw_top1]++;
    calTop1Dist[r.cal_top1]++;
    if (r.predicted_result) calPredDist[r.predicted_result]++;
    else calPredDist.TOO_CLOSE++;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLE 1: Summary — actual vs raw top-1 vs calibrated top-1 vs decision
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 1 — Class Distribution: Actual vs Raw Top-1 vs Calibrated Top-1 vs Decision');
  console.log(`Evaluated denominator: ${N} matches`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('  Outcome     Actual       Raw top-1    Cal top-1    Decision (policy)');
  console.log('  ─────────────────────────────────────────────────────────────────────');
  for (const cls of ['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const) {
    const a = actualDist[cls];
    const r = rawTop1Dist[cls];
    const c = calTop1Dist[cls];
    const d = calPredDist[cls];
    console.log(
      `  ${pad(cls, 10, true)}  ${pad(a, 4)} ${pct(a / N)}  ` +
      `${pad(r, 4)} ${pct(r / N)}  ` +
      `${pad(c, 4)} ${pct(c / N)}  ` +
      `${pad(d, 4)} ${pct(d / N)}`,
    );
  }
  const tooClose = calPredDist.TOO_CLOSE;
  console.log(
    `  ${'TOO_CLOSE'.padEnd(10)}  ${'—'.padStart(4)}  ${'—'.padStart(7)}  ` +
    `${'—'.padStart(4)}  ${'—'.padStart(7)}  ` +
    `${'—'.padStart(4)}  ${'—'.padStart(7)}  ` +
    `${pad(tooClose, 4)} ${pct(tooClose / N)}`,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYSIS A: DRAW-only diagnosis
  // ═══════════════════════════════════════════════════════════════════════════
  const actualDraws = allEnriched.filter((r) => r.actual_result === 'DRAW');
  const drawN = actualDraws.length;

  const rawPDrawVals = actualDraws.map((r) => r.raw_p_draw);
  const calPDrawVals = actualDraws.map((r) => r.cal_p_draw);

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`TABLE 2 — DRAW-Only Diagnosis (n=${drawN} actual DRAW matches in evaluable set)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const rawTop1DrawCount = actualDraws.filter((r) => r.raw_top1 === 'DRAW').length;
  const calTop1DrawCount = actualDraws.filter((r) => r.cal_top1 === 'DRAW').length;
  const rawGt25 = rawPDrawVals.filter((v) => v > 0.25).length;
  const rawGt30 = rawPDrawVals.filter((v) => v > 0.30).length;
  const calGt25 = calPDrawVals.filter((v) => v > 0.25).length;
  const calGt30 = calPDrawVals.filter((v) => v > 0.30).length;

  const avgRawSMD = avg(actualDraws.map((r) => r.raw_selected_minus_draw));
  const avgCalSMD = avg(actualDraws.map((r) => r.cal_selected_minus_draw));

  console.log(`  Metric                                    Raw         Calibrated`);
  console.log(`  ──────────────────────────────────────────────────────────────`);
  console.log(`  p_draw avg                            ${pct(avg(rawPDrawVals))}      ${pct(avg(calPDrawVals))}`);
  console.log(`  p_draw median                         ${pct(median(rawPDrawVals))}      ${pct(median(calPDrawVals))}`);
  console.log(`  p_draw max                            ${pct(max(rawPDrawVals))}      ${pct(max(calPDrawVals))}`);
  console.log(`  p_draw > 0.25 (count / ${drawN})          ${pad(rawGt25, 6)}      ${pad(calGt25, 6)}`);
  console.log(`  p_draw > 0.30 (count / ${drawN})          ${pad(rawGt30, 6)}      ${pad(calGt30, 6)}`);
  console.log(`  DRAW is top-1 class (count / ${drawN})     ${pad(rawTop1DrawCount, 6)}      ${pad(calTop1DrawCount, 6)}`);
  console.log(`  avg selected_minus_draw               ${pct(avgRawSMD)}      ${pct(avgCalSMD)}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYSIS C: Calibration effect on DRAW channel
  // ═══════════════════════════════════════════════════════════════════════════
  const deltaDrawVals = actualDraws.map((r) => r.delta_draw);
  const calIncreasesCount = actualDraws.filter((r) => r.delta_draw > 0.001).length;
  const calDecreasesCount = actualDraws.filter((r) => r.delta_draw < -0.001).length;
  const calNeutralCount = actualDraws.length - calIncreasesCount - calDecreasesCount;

  const rawTop1SameAsCal = actualDraws.filter((r) => r.raw_top1 === r.cal_top1).length;

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`ANALYSIS C — Calibration Effect on DRAW Channel (n=${drawN} actual DRAWs)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  avg delta_draw (cal - raw):           ${pct(avg(deltaDrawVals))}`);
  console.log(`  median delta_draw:                    ${pct(median(deltaDrawVals))}`);
  console.log(`  calibration increases p_draw:         ${pad(calIncreasesCount, 4)} / ${drawN} (${(calIncreasesCount / drawN * 100).toFixed(1)}%)`);
  console.log(`  calibration decreases p_draw:         ${pad(calDecreasesCount, 4)} / ${drawN} (${(calDecreasesCount / drawN * 100).toFixed(1)}%)`);
  console.log(`  calibration negligible (|Δ| ≤ 0.001):${pad(calNeutralCount, 4)} / ${drawN} (${(calNeutralCount / drawN * 100).toFixed(1)}%)`);
  console.log(`  raw top-1 = calibrated top-1:         ${pad(rawTop1SameAsCal, 4)} / ${drawN} (${(rawTop1SameAsCal / drawN * 100).toFixed(1)}%)`);

  // Same analysis on full evaluable set
  const deltaDrawAll = allEnriched.map((r) => r.delta_draw);
  const allCalIncreases = allEnriched.filter((r) => r.delta_draw > 0.001).length;
  const allCalDecreases = allEnriched.filter((r) => r.delta_draw < -0.001).length;
  console.log(`\n  On full evaluable set (n=${N}):`);
  console.log(`  avg delta_draw (cal - raw):           ${pct(avg(deltaDrawAll))}`);
  console.log(`  calibration increases p_draw:         ${pad(allCalIncreases, 4)} / ${N}`);
  console.log(`  calibration decreases p_draw:         ${pad(allCalDecreases, 4)} / ${N}`);
  console.log(`  calibration_mode distribution:`);
  const modeCounts: Record<string, number> = {};
  for (const r of allEnriched) {
    modeCounts[r.calibration_mode] = (modeCounts[r.calibration_mode] ?? 0) + 1;
  }
  for (const [mode, count] of Object.entries(modeCounts)) {
    console.log(`    ${mode}: ${count} / ${N} (${(count / N * 100).toFixed(1)}%)`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLE 3: Equilibrium buckets by abs_elo_gap
  // ═══════════════════════════════════════════════════════════════════════════

  const eloBuckets: Array<{ label: string; lo: number; hi: number }> = [
    { label: '0–24', lo: 0, hi: 25 },
    { label: '25–49', lo: 25, hi: 50 },
    { label: '50–99', lo: 50, hi: 100 },
    { label: '100+', lo: 100, hi: Infinity },
  ];

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 3 — Equilibrium Buckets by abs_elo_gap (effective Elo gap incl. home adv)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Elo-gap   n    actDRAW% raw_pDraw  cal_pDraw  rawDtop1 calDtop1',
  );
  console.log(
    '  ─────────────────────────────────────────────────────────────────',
  );
  for (const bucket of eloBuckets) {
    const recs = allEnriched.filter(
      (r) => r.abs_elo_gap >= bucket.lo && r.abs_elo_gap < bucket.hi,
    );
    if (recs.length === 0) continue;
    const n = recs.length;
    const draws = recs.filter((r) => r.actual_result === 'DRAW').length;
    const rawPDrawAvg = avg(recs.map((r) => r.raw_p_draw));
    const calPDrawAvg = avg(recs.map((r) => r.cal_p_draw));
    const rawDTop1 = recs.filter((r) => r.raw_top1 === 'DRAW').length;
    const calDTop1 = recs.filter((r) => r.cal_top1 === 'DRAW').length;
    console.log(
      `  ${pad(bucket.label, 7, true)}  ${pad(n, 3)}  ` +
      `${pct(draws / n)}   ${pct(rawPDrawAvg)}  ${pct(calPDrawAvg)}  ` +
      `${pad(rawDTop1, 7)}  ${pad(calDTop1, 7)}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLE 4: Equilibrium buckets by abs_lambda_gap
  // ═══════════════════════════════════════════════════════════════════════════

  const lambdaBuckets: Array<{ label: string; lo: number; hi: number }> = [
    { label: '0.00–0.09', lo: 0, hi: 0.10 },
    { label: '0.10–0.19', lo: 0.10, hi: 0.20 },
    { label: '0.20–0.39', lo: 0.20, hi: 0.40 },
    { label: '0.40+', lo: 0.40, hi: Infinity },
  ];

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 4 — Equilibrium Buckets by abs_lambda_gap (|lambda_home - lambda_away|)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  λ-gap       n    actDRAW% raw_pDraw  cal_pDraw  rawDtop1 calDtop1',
  );
  console.log(
    '  ───────────────────────────────────────────────────────────────────',
  );
  for (const bucket of lambdaBuckets) {
    const recs = allEnriched.filter(
      (r) => r.abs_lambda_gap >= bucket.lo && r.abs_lambda_gap < bucket.hi,
    );
    if (recs.length === 0) continue;
    const n = recs.length;
    const draws = recs.filter((r) => r.actual_result === 'DRAW').length;
    const rawPDrawAvg = avg(recs.map((r) => r.raw_p_draw));
    const calPDrawAvg = avg(recs.map((r) => r.cal_p_draw));
    const rawDTop1 = recs.filter((r) => r.raw_top1 === 'DRAW').length;
    const calDTop1 = recs.filter((r) => r.cal_top1 === 'DRAW').length;
    console.log(
      `  ${pad(bucket.label, 10, true)}  ${pad(n, 3)}  ` +
      `${pct(draws / n)}   ${pct(rawPDrawAvg)}  ${pct(calPDrawAvg)}  ` +
      `${pad(rawDTop1, 7)}  ${pad(calDTop1, 7)}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYSIS E: Final diagnosis and classification
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ANALYSIS E — Diagnosis and Classification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Decision logic
  const rawDrawTop1GlobalCount = allEnriched.filter((r) => r.raw_top1 === 'DRAW').length;
  const calDrawTop1GlobalCount = allEnriched.filter((r) => r.cal_top1 === 'DRAW').length;
  const avgRawPDrawAll = avg(allEnriched.map((r) => r.raw_p_draw))!;
  const avgCalPDrawAll = avg(allEnriched.map((r) => r.cal_p_draw))!;
  const avgAbsDeltaDraw = avg(allEnriched.map((r) => Math.abs(r.delta_draw)))!;

  const rawDrawIsNeverTop1 = rawDrawTop1GlobalCount === 0;
  const rawDrawIsRarelyTop1 = rawDrawTop1GlobalCount < N * 0.02; // < 2%
  const calSuppressesDraw = (avg(deltaDrawAll) ?? 0) < -0.01; // calibration lowers p_draw by >1pp avg
  const calAmplifiesdraw = (avg(deltaDrawAll) ?? 0) > 0.01;
  const calibrationIsIdentity = avgAbsDeltaDraw < 0.001; // virtually no difference

  console.log(`  Raw layer (full set, n=${N}):`);
  console.log(`    DRAW is top-1 in raw:   ${pad(rawDrawTop1GlobalCount, 4)} / ${N} (${(rawDrawTop1GlobalCount / N * 100).toFixed(1)}%)`);
  console.log(`    avg raw_p_draw:         ${pct(avgRawPDrawAll)}`);
  console.log(`    avg cal_p_draw:         ${pct(avgCalPDrawAll)}`);
  console.log(`    avg |delta_draw|:       ${pct(avgAbsDeltaDraw)}`);
  console.log('');
  console.log(`  On actual DRAW matches (n=${drawN}):`);
  console.log(`    DRAW top-1 in raw:      ${rawTop1DrawCount} / ${drawN} (${(rawTop1DrawCount / drawN * 100).toFixed(1)}%)`);
  console.log(`    DRAW top-1 in cal:      ${calTop1DrawCount} / ${drawN} (${(calTop1DrawCount / drawN * 100).toFixed(1)}%)`);
  console.log(`    avg raw_p_draw:         ${pct(avg(rawPDrawVals))}`);
  console.log(`    avg cal_p_draw:         ${pct(avg(calPDrawVals))}`);
  console.log(`    avg raw sel-draw gap:   ${pct(avgRawSMD)}`);
  console.log(`    avg cal sel-draw gap:   ${pct(avgCalSMD)}`);
  console.log('');

  let classification: 'RAW_PROBABILITY_PROBLEM' | 'CALIBRATION_LAYER_PROBLEM' | 'MIXED_PROBLEM';
  let explanation: string;
  let recommendation: string;

  if (calibrationIsIdentity) {
    // Identity calibration → calibrated = raw → collapse fully in raw layer
    classification = 'RAW_PROBABILITY_PROBLEM';
    explanation =
      'Current calibration is IDENTITY (bootstrap mode: |Δ_draw| < 0.001). ' +
      'Calibrated probabilities are structurally equal to raw probabilities. ' +
      'The DRAW collapse is therefore 100% attributable to the raw Poisson layer: ' +
      'the independent Poisson model with current Elo ranges systematically assigns ' +
      'p_draw < max(p_home, p_away) for virtually all LaLiga matches.';
    recommendation =
      'The next step is to address the raw probability layer. Options: ' +
      '(a) train an isotonic calibration specifically on the DRAW channel using this ' +
      'historical slice to lift p_draw toward empirical frequencies, or ' +
      '(b) investigate whether a modified lambda computation (e.g. draw-bias correction, ' +
      'lambda deflation, or a Dixon-Coles correction term) closes the gap. ' +
      'A calibration-only fix (H7) is the lower-risk path given the model is already ' +
      'operational: supervised isotonic calibration can increase p_draw on near-balanced ' +
      'matches without altering the overall accuracy on home/away outcomes.';
  } else if (rawDrawIsNeverTop1 && calSuppressesDraw) {
    classification = 'MIXED_PROBLEM';
    explanation =
      'DRAW is never top-1 in the raw layer AND calibration further suppresses p_draw. ' +
      'Both layers contribute to the collapse.';
    recommendation =
      'Address both: (a) investigate raw lambda computation for draw-bias, ' +
      '(b) train draw-channel isotonic calibration. Start with calibration as it is lower-risk.';
  } else if (rawDrawIsNeverTop1 && !calSuppressesDraw) {
    classification = 'RAW_PROBABILITY_PROBLEM';
    explanation =
      'DRAW is never (or extremely rarely) top-1 in the raw layer. ' +
      'Calibration does not meaningfully suppress p_draw further. ' +
      'Root cause is in the raw Poisson probability generation.';
    recommendation =
      'Focus on raw probability layer: draw-specific calibration or lambda correction.';
  } else if (!rawDrawIsRarelyTop1 && calSuppressesDraw) {
    classification = 'CALIBRATION_LAYER_PROBLEM';
    explanation =
      'DRAW is competitive in the raw layer but calibration suppresses it. ' +
      'The raw model is closer to correct; calibration worsens DRAW prediction.';
    recommendation =
      'Re-train calibration with draw-channel preservation. ' +
      'Do not reduce raw lambdas.';
  } else {
    classification = 'MIXED_PROBLEM';
    explanation =
      'Both raw and calibrated layers show partial DRAW suppression. ' +
      'Neither alone is the dominant cause.';
    recommendation =
      'Investigate both layers. Start with calibration training on the draw channel.';
  }

  console.log('  ┌─────────────────────────────────────────────────────────────────┐');
  console.log(`  │  CLASSIFICATION: ${classification.padEnd(47)}│`);
  console.log('  └─────────────────────────────────────────────────────────────────┘\n');
  console.log('  EXPLANATION:');
  // Word-wrap explanation
  const explanationWords = explanation.split(' ');
  let line = '    ';
  for (const word of explanationWords) {
    if (line.length + word.length > 78) {
      console.log(line);
      line = '    ' + word + ' ';
    } else {
      line += word + ' ';
    }
  }
  if (line.trim()) console.log(line);

  console.log('\n  RECOMMENDATION:');
  const recWords = recommendation.split(' ');
  line = '    ';
  for (const word of recWords) {
    if (line.length + word.length > 78) {
      console.log(line);
      line = '    ' + word + ' ';
    } else {
      line += word + ' ';
    }
  }
  if (line.trim()) console.log(line);

  console.log('\n');

  // Summary answers to the three required questions
  console.log('  ANSWERS TO PRIMARY QUESTIONS:');
  console.log(`  Q1. Is DRAW collapse already present in raw probabilities?`);
  if (calibrationIsIdentity) {
    console.log(`      YES — raw top-1 DRAW = ${rawDrawTop1GlobalCount}/${N} (${(rawDrawTop1GlobalCount/N*100).toFixed(1)}%) globally. ` +
      `On actual draws: ${rawTop1DrawCount}/${drawN} top-1 (${(rawTop1DrawCount/drawN*100).toFixed(1)}%).`);
  } else {
    console.log(`      Raw DRAW top-1: ${rawDrawTop1GlobalCount}/${N} globally, ${rawTop1DrawCount}/${drawN} on actual draws.`);
  }
  console.log(`  Q2. Does current calibration materially worsen/improve DRAW?`);
  if (calibrationIsIdentity) {
    console.log(`      NO MATERIAL EFFECT — calibration is identity (bootstrap mode).`);
    console.log(`      avg |Δ_draw| = ${(avgAbsDeltaDraw * 100).toFixed(4)}pp. Calibrated ≡ Raw.`);
  } else if (calSuppressesDraw) {
    console.log(`      WORSENS: calibration lowers p_draw by avg ${pct(avg(deltaDrawAll))}.`);
  } else if (calAmplifiesdraw) {
    console.log(`      IMPROVES: calibration raises p_draw by avg ${pct(avg(deltaDrawAll))}.`);
  }
  console.log(`  Q3. Most likely next step?`);
  if (calibrationIsIdentity) {
    console.log(`      (a) calibration change: train isotonic calibration on DRAW channel.`);
    console.log(`      This is the fastest path to recovering DRAW predictions.`);
    console.log(`      Model/probability generation change can follow as H8 if calibration`);
    console.log(`      alone is insufficient.`);
  }

  console.log('');
}

main().catch((err) => {
  console.error('[H6b] Fatal:', err);
  process.exit(1);
});

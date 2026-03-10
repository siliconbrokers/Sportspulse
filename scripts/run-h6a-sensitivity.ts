/**
 * H6a — Structural sensitivity test for DRAW collapse.
 *
 * Varies HOME_ADVANTAGE_ELO_DELTA ∈ {100, 75, 50, 25, 0} on the same
 * historical PD slice and reports whether the home-advantage parameter
 * is the dominant cause of the confirmed DRAW collapse.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.server.json scripts/run-h6a-sensitivity.ts
 *
 * Output: two comparison tables — one for categorical/coverage metrics,
 * one for DRAW-specific diagnostics.
 *
 * CONSTRAINT: This script does NOT modify the production default
 * HOME_ADVANTAGE_ELO_DELTA constant. The override is passed per-call only.
 */
import 'dotenv/config';

import { FootballDataSource } from '../server/football-data-source.js';
import { PredictionService } from '../server/prediction/prediction-service.js';
import { HistoricalStateService } from '../server/prediction/historical-state-service.js';
import { HistoricalBacktestStore } from '../server/prediction/historical-backtest-store.js';
import { HistoricalBacktestRunner } from '../server/prediction/historical-backtest-runner.js';
import { computeHistoricalEvaluation } from '../server/prediction/historical-evaluator.js';

// ── Formatting helpers ─────────────────────────────────────────────────────

function pct(v: number | null, d = 1): string {
  return v === null ? '   n/a' : (v * 100).toFixed(d).padStart(6) + '%';
}
function num(v: number | null, d = 3): string {
  return v === null ? '  n/a ' : v.toFixed(d).padStart(7);
}
function pad(s: string | number, w: number): string {
  return String(s).padStart(w);
}

// ── Draw diagnostics ───────────────────────────────────────────────────────

interface DrawDiagnostics {
  real_draws: number;
  real_draws_with_probs: number;
  predicted_draws: number;
  p_draw_avg: number | null;
  p_draw_median: number | null;
  p_draw_max: number | null;
  p_draw_gt25: number;
  p_draw_gt30: number;
}

function computeDrawDiagnostics(
  snapshots: ReturnType<HistoricalBacktestStore['findByCompetition']>,
): DrawDiagnostics {
  const realDraws = snapshots.filter((s) => s.actual_result === 'DRAW');
  const withProbs = realDraws.filter((s) => s.p_draw !== null);
  const pDrawValues = withProbs.map((s) => s.p_draw!).sort((a, b) => a - b);

  const avg =
    pDrawValues.length > 0
      ? pDrawValues.reduce((acc, v) => acc + v, 0) / pDrawValues.length
      : null;

  let median: number | null = null;
  if (pDrawValues.length > 0) {
    const mid = Math.floor(pDrawValues.length / 2);
    median =
      pDrawValues.length % 2 === 0
        ? (pDrawValues[mid - 1]! + pDrawValues[mid]!) / 2
        : pDrawValues[mid]!;
  }

  const max = pDrawValues.length > 0 ? pDrawValues[pDrawValues.length - 1]! : null;

  const predicted_draws = snapshots.filter(
    (s) => s.predicted_result === 'DRAW',
  ).length;

  return {
    real_draws: realDraws.length,
    real_draws_with_probs: withProbs.length,
    predicted_draws,
    p_draw_avg: avg,
    p_draw_median: median,
    p_draw_max: max,
    p_draw_gt25: pDrawValues.filter((v) => v > 0.25).length,
    p_draw_gt30: pDrawValues.filter((v) => v > 0.30).length,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

interface VariantResult {
  delta: number;
  denominator: number;
  accuracy: number | null;
  pred_home: number;
  pred_draw: number;
  pred_away: number;
  brier: number | null;
  log_loss: number | null;
  draw_diag: DrawDiagnostics;
}

async function runVariant(
  ds: FootballDataSource,
  apiToken: string,
  delta: number,
): Promise<VariantResult> {
  const CODE = 'PD';
  const COMP_ID = `comp:football-data:${CODE}`;

  const store = new HistoricalBacktestStore();
  const runner = new HistoricalBacktestRunner(
    ds,
    new PredictionService(),
    new HistoricalStateService({ apiToken }),
    store,
  );

  await runner.run(COMP_ID, '2025-26', {
    verbose: false,
    homeAdvantageDeltaOverride: delta,
  });

  const snapshots = store.findByCompetition(CODE);
  const report = computeHistoricalEvaluation(snapshots, CODE);

  // Predicted class distribution
  const pcd = report.prediction_class_distribution;
  const fm = report.full_mode_metrics;
  const cm = report.combined_metrics;

  const denominator = cm?.denominator ?? 0;
  const accuracy = cm?.accuracy ?? null;
  const predHome = pcd?.HOME_WIN ?? 0;
  const predDraw = pcd?.DRAW ?? 0;
  const predAway = pcd?.AWAY_WIN ?? 0;
  const brier = fm?.brier_score ?? null;
  const logLoss = fm?.log_loss ?? null;

  const draw_diag = computeDrawDiagnostics(snapshots);

  return {
    delta,
    denominator,
    accuracy,
    pred_home: predHome,
    pred_draw: predDraw,
    pred_away: predAway,
    brier,
    log_loss: logLoss,
    draw_diag,
  };
}

async function main() {
  const apiToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!apiToken) {
    console.error('FOOTBALL_DATA_TOKEN not set');
    process.exit(1);
  }

  const CODE = 'PD';
  const COMP_ID = `comp:football-data:${CODE}`;
  const DELTAS = [100, 75, 50, 25, 0];

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  H6a — HOME_ADVANTAGE_ELO_DELTA Sensitivity Test — LaLiga (PD)  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  console.log('Fetching competition data (one fetch, reused across all variants)...');

  // Fetch once, reuse DataSource across all runs
  const ds = new FootballDataSource(apiToken);
  await ds.fetchCompetition(CODE);

  const seasonId = ds.getSeasonId(COMP_ID);
  const allMatches = ds.getMatches(seasonId!);
  const finished = allMatches.filter((m) => m.status === 'FINISHED');
  console.log(`Competition loaded: ${finished.length} FINISHED matches\n`);

  const results: VariantResult[] = [];

  for (const delta of DELTAS) {
    process.stdout.write(`  Running delta=${delta}... `);
    const result = await runVariant(ds, apiToken, delta);
    results.push(result);
    process.stdout.write(
      `done. n=${result.denominator}, acc=${pct(result.accuracy)}, drawPred=${result.pred_draw}\n`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TABLE 1: Categorical & probabilistic metrics per variant
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 1 — Categorical & Probabilistic Metrics by Home-Advantage Delta');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Delta    n-eval   Accuracy   pred-H   pred-D   pred-A    Brier    LogLoss',
  );
  console.log(
    '  ─────────────────────────────────────────────────────────────────────────',
  );
  for (const r of results) {
    const marker = r.delta === 100 ? ' ◄prod' : '      ';
    console.log(
      `  ${pad(r.delta, 3)}      ${pad(r.denominator, 5)}   ${pct(r.accuracy)}  ` +
        `${pad(r.pred_home, 6)}   ${pad(r.pred_draw, 6)}   ${pad(r.pred_away, 6)}  ` +
        `${num(r.brier)}  ${num(r.log_loss)}${marker}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TABLE 2: DRAW-specific diagnostics per variant
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TABLE 2 — DRAW Diagnostics (on actual DRAW matches) by Delta');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(
    '  Delta   predD  p_draw_avg  p_draw_med  p_draw_max  p>0.25  p>0.30',
  );
  console.log(
    '  ───────────────────────────────────────────────────────────────────',
  );
  for (const r of results) {
    const d = r.draw_diag;
    const marker = r.delta === 100 ? ' ◄prod' : '      ';
    console.log(
      `  ${pad(r.delta, 3)}       ${pad(d.predicted_draws, 4)}  ` +
        `${pct(d.p_draw_avg)}      ${pct(d.p_draw_median)}      ` +
        `${pct(d.p_draw_max)}   ` +
        `${pad(d.p_draw_gt25, 5)}   ${pad(d.p_draw_gt30, 5)}${marker}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ANALYSIS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const prod = results.find((r) => r.delta === 100)!;
  const zero = results.find((r) => r.delta === 0)!;

  const drawCollapseAtZero = zero.pred_draw === 0;
  const drawCollapseAtProd = prod.pred_draw === 0;
  const maxDrawPred = Math.max(...results.map((r) => r.pred_draw));
  const deltaWithMaxDraw = results.find((r) => r.pred_draw === maxDrawPred);

  console.log(`  Home-advantage delta range tested: ${DELTAS.join(', ')}`);
  console.log(`  Production delta (100): pred_DRAW = ${prod.pred_draw}`);
  console.log(`  Zero delta (0):         pred_DRAW = ${zero.pred_draw}`);
  console.log(`  Max pred_DRAW seen:     ${maxDrawPred} at delta=${deltaWithMaxDraw?.delta}`);
  console.log('');

  if (drawCollapseAtProd && drawCollapseAtZero) {
    console.log('  CONCLUSION: DRAW collapse persists even at delta=0 (no home advantage).');
    console.log('  → Home-advantage delta is NOT the dominant cause of DRAW collapse.');
    console.log('  → Root cause is structural: Poisson model systematically underestimates');
    console.log('    draw probability independent of home-advantage parameter.');
    if (maxDrawPred > 0) {
      console.log(`  → Some draws predicted at delta=${deltaWithMaxDraw?.delta},`);
      console.log('    suggesting partial dependency but not dominant causality.');
    }
  } else if (drawCollapseAtProd && !drawCollapseAtZero) {
    console.log('  CONCLUSION: Reducing delta to 0 recovers DRAW predictions.');
    console.log('  → Home-advantage delta IS a contributing cause of DRAW collapse.');
    console.log('  → However, decision-policy threshold (TOO_CLOSE) may also play a role.');
    console.log('  → Reducing delta below current production value is a viable mitigation.');
  } else {
    console.log('  CONCLUSION: DRAW predictions are partially present across delta values.');
    console.log('  → Partial contribution from home-advantage parameter confirmed.');
  }

  // Accuracy trend
  const accValues = results
    .map((r) => ({ delta: r.delta, acc: r.accuracy }))
    .filter((r) => r.acc !== null);
  if (accValues.length >= 2) {
    const first = accValues[0]!;
    const last = accValues[accValues.length - 1]!;
    const accDiff = (last.acc! - first.acc!) * 100;
    console.log('');
    console.log(`  Accuracy change from delta=${first.delta} to delta=${last.delta}: ${accDiff >= 0 ? '+' : ''}${accDiff.toFixed(1)}pp`);
    if (Math.abs(accDiff) < 2) {
      console.log('  → Accuracy is insensitive to home-advantage delta (< 2pp range).');
    } else {
      console.log(`  → Accuracy shifts ${Math.abs(accDiff).toFixed(1)}pp — moderate sensitivity.`);
    }
  }

  // Brier trend
  const brierValues = results
    .map((r) => ({ delta: r.delta, brier: r.brier }))
    .filter((r) => r.brier !== null);
  if (brierValues.length >= 2) {
    const first = brierValues[0]!;
    const last = brierValues[brierValues.length - 1]!;
    const brierDiff = last.brier! - first.brier!;
    console.log(`  Brier change from delta=${first.delta} to delta=${last.delta}: ${brierDiff >= 0 ? '+' : ''}${brierDiff.toFixed(4)}`);
    if (Math.abs(brierDiff) < 0.01) {
      console.log('  → Brier score is insensitive to home-advantage delta (< 0.01 range).');
    }
  }

  // p_draw max trend on real draws
  const maxPdrawValues = results.map((r) => ({ delta: r.delta, max: r.draw_diag.p_draw_max }));
  console.log('');
  console.log('  p_draw (max on real draws) per delta:');
  for (const v of maxPdrawValues) {
    console.log(`    delta=${v.delta}: max p_draw = ${v.max !== null ? (v.max * 100).toFixed(1) + '%' : 'n/a'}`);
  }

  const allMaxes = maxPdrawValues.filter((v) => v.max !== null).map((v) => v.max!);
  if (allMaxes.length > 0) {
    const range = Math.max(...allMaxes) - Math.min(...allMaxes);
    console.log(`  → p_draw max range across deltas: ${(range * 100).toFixed(1)}pp`);
    if (range < 0.05) {
      console.log('  → p_draw distribution on real draws is insensitive to home-advantage delta.');
      console.log('  → Model structurally underestimates draws regardless of delta setting.');
    } else {
      console.log('  → p_draw distribution shifts meaningfully with delta.');
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('[H6a] Fatal:', err);
  process.exit(1);
});

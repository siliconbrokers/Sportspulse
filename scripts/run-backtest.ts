/**
 * Historical backtest + evaluation — H3 + H4.
 * Processes all FINISHED matches for LaLiga (PD) current season.
 * Runs probabilistic diagnostic to determine if the model has any edge.
 *
 * Usage: npx tsx --tsconfig tsconfig.server.json scripts/run-backtest.ts
 */
import 'dotenv/config';

import { FootballDataSource } from '../server/football-data-source.js';
import { PredictionService } from '../server/prediction/prediction-service.js';
import { HistoricalStateService } from '../server/prediction/historical-state-service.js';
import { HistoricalBacktestStore } from '../server/prediction/historical-backtest-store.js';
import { HistoricalBacktestRunner } from '../server/prediction/historical-backtest-runner.js';
import {
  computeHistoricalEvaluation,
  persistEvaluationReport,
} from '../server/prediction/historical-evaluator.js';

// ── Formatting ────────────────────────────────────────────────────────────

function pct(v: number | null, d = 1): string {
  return v === null ? '   n/a' : (v * 100).toFixed(d).padStart(6) + '%';
}
function num(v: number | null, d = 3): string {
  return v === null ? '  n/a ' : v.toFixed(d).padStart(7);
}
function bar(v: number, total: number, width = 20): string {
  const filled = total > 0 ? Math.round((v / total) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled) + ` ${v}/${total}`;
}

function printConfusion(m: {
  HOME_WIN: { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
  DRAW:     { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
  AWAY_WIN: { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
}): void {
  console.log('               │  pred H  pred D  pred A');
  console.log('  ─────────────┼──────────────────────────');
  for (const row of ['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const) {
    const r = m[row];
    const label = row === 'HOME_WIN' ? 'act HOME' : row === 'DRAW' ? 'act DRAW' : 'act AWAY';
    console.log(`  ${label}     │  ${String(r.HOME_WIN).padStart(5)}  ${String(r.DRAW).padStart(5)}  ${String(r.AWAY_WIN).padStart(5)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const apiToken = process.env.FOOTBALL_DATA_TOKEN ?? '';
  if (!apiToken) { console.error('FOOTBALL_DATA_TOKEN not set'); process.exit(1); }

  const CODE = 'PD';
  const COMP_ID = `comp:football-data:${CODE}`;

  const ds = new FootballDataSource(apiToken);
  await ds.fetchCompetition(CODE);

  const seasonId = ds.getSeasonId(COMP_ID);
  const allMatches = ds.getMatches(seasonId!);
  const finished = allMatches.filter(m => m.status === 'FINISHED');
  console.log(`[Backtest] seasonId=${seasonId}  finished=${finished.length} matches`);

  const store = new HistoricalBacktestStore();
  const runner = new HistoricalBacktestRunner(
    ds,
    new PredictionService(),
    new HistoricalStateService({ apiToken }),
    store,
  );

  // ── H3: build all historical snapshots (no maxMatches limit) ─────────────
  await runner.run(COMP_ID, '2025-26', { verbose: false });

  // ── H4: evaluate ──────────────────────────────────────────────────────────
  const snapshots = store.findByCompetition(CODE);
  const report = computeHistoricalEvaluation(snapshots, CODE);
  persistEvaluationReport(report);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log(`║  HISTORICAL EVALUATION — ${CODE} (${report.generated_at.slice(0,10)})                ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  // ── Denominator breakdown ──────────────────────────────────────────────
  const ex = report.exclusion_breakdown;
  console.log('\n1. DENOMINATOR BREAKDOWN');
  console.log(`   Total snapshots processed:        ${ex.total_snapshots}`);
  console.log(`   NOT_ELIGIBLE (validation):        ${ex.not_eligible}`);
  console.log(`   ERROR (pipeline):                 ${ex.error}`);
  console.log(`   LIMITED_MODE no prediction:       ${ex.limited_mode_no_prediction}`);
  console.log(`   TOO_CLOSE (model abstained):      ${ex.too_close}`);
  console.log(`   ── Total excluded:                ${ex.total_excluded}`);
  console.log(`   ▶ Evaluable (denominator):        ${ex.evaluable}`);

  // ── Actual vs predicted class distribution ────────────────────────────
  const acd = report.actual_class_distribution;
  const pcd = report.prediction_class_distribution;
  if (acd && pcd) {
    console.log('\n2. CLASS DISTRIBUTION (evaluable set, n=' + acd.total + ')');
    console.log('   Outcome    Actual                       Predicted');
    for (const cls of ['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const) {
      const aBar = bar(acd[cls], acd.total);
      const pBar = bar(pcd[cls], acd.total);
      const label = cls === 'HOME_WIN' ? 'HOME_WIN ' : cls === 'DRAW' ? 'DRAW     ' : 'AWAY_WIN ';
      console.log(`   ${label}  ${aBar.padEnd(28)} ${pBar}`);
    }
    if (pcd.DRAW === 0) {
      console.log('   ⚠ MODEL PREDICTS ZERO DRAWS — class collapse confirmed.');
    }
  }

  // ── Categorical metrics table ──────────────────────────────────────────
  const cm = report.combined_metrics;
  const fm = report.full_mode_metrics;
  const mfc = report.baselines?.most_frequent_class;
  const ahw = report.baselines?.always_home_win;

  console.log('\n3. CATEGORICAL ACCURACY');
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   Model (combined)            ${pct(cm?.accuracy ?? null)}  n=${cm?.denominator ?? 0}`);
  console.log(`   Model (FULL_MODE only)      ${pct(fm?.accuracy ?? null)}  n=${fm?.denominator ?? 0}`);
  console.log(`   Baseline: MOST_FREQ_CLASS   ${pct(mfc?.accuracy ?? null)}  (always "${mfc?.always_predicts ?? '?'}")`);
  console.log(`   Baseline: ALWAYS_HOME_WIN   ${pct(ahw?.accuracy ?? null)}`);
  console.log(`   Beats MOST_FREQ_CLASS:      ${report.beats_most_frequent_class ?? 'n/a'}`);
  console.log(`   Beats ALWAYS_HOME_WIN:      ${report.beats_always_home_win ?? 'n/a'}`);

  if (fm) {
    console.log('\n   Confusion matrix (FULL_MODE, rows=actual, cols=predicted):');
    printConfusion(fm.confusion_matrix);
  }

  // ── Probabilistic metrics table ────────────────────────────────────────
  const pb = report.probabilistic_baselines;
  const ub = pb?.uniform;
  const eb = pb?.empirical_freq;

  console.log('\n4. PROBABILISTIC METRICS (Brier ↓ better, log-loss ↓ better)');
  console.log('   Denominator: FULL_MODE records with calibrated probs');
  console.log(`   n=${fm?.prob_denominator ?? 0}`);
  console.log('   ─────────────────────────────────────────────────────');
  console.log('                               Brier      Log-Loss');
  console.log(`   Model                    ${num(fm?.brier_score ?? null)}   ${num(fm?.log_loss ?? null)}`);
  console.log(`   Baseline: UNIFORM (1/3)  ${num(ub?.brier_score ?? null)}   ${num(ub?.log_loss ?? null)}`);
  if (eb) {
    const empLabel = eb.probs
      ? `(H=${eb.probs.HOME_WIN.toFixed(2)} D=${eb.probs.DRAW.toFixed(2)} A=${eb.probs.AWAY_WIN.toFixed(2)})`
      : '';
    console.log(`   Baseline: EMPIRICAL_FREQ ${num(eb.brier_score)}   ${num(eb.log_loss)}  ${empLabel}`);
  }
  console.log('   ─────────────────────────────────────────────────────');
  console.log(`   Beats UNIFORM    (Brier):     ${report.beats_uniform_brier ?? 'n/a'}`);
  console.log(`   Beats UNIFORM    (log-loss):  ${report.beats_uniform_log_loss ?? 'n/a'}`);
  console.log(`   Beats EMPIRICAL  (Brier):     ${report.beats_empirical_brier ?? 'n/a'}`);
  console.log(`   Beats EMPIRICAL  (log-loss):  ${report.beats_empirical_log_loss ?? 'n/a'}`);

  // ── Symmetry ───────────────────────────────────────────────────────────
  console.log('\n5. ELO SYMMETRY EVIDENCE');
  console.log(`   Records where historical Elo ≠ symmetric baseline:`);
  console.log(
    `   ${report.elo_breaks_symmetry}/${report.elo_breaks_symmetry_denominator}` +
    (report.elo_breaks_symmetry_denominator > 0
      ? `  (${pct(report.elo_breaks_symmetry / report.elo_breaks_symmetry_denominator)})`
      : ''),
  );

  // ── Verdict ───────────────────────────────────────────────────────────
  console.log('\n6. VERDICT');
  const hasAccEdge = report.beats_most_frequent_class || report.beats_always_home_win;
  const hasProbEdge = report.beats_uniform_brier || report.beats_uniform_log_loss;

  if (hasAccEdge) {
    console.log('   ✓ Categorical: model beats naive baselines.');
  } else {
    console.log('   ✗ Categorical: model does NOT beat naive baselines.');
  }
  if (hasProbEdge) {
    console.log('   ✓ Probabilistic: model beats uniform baseline on at least one metric.');
    console.log('     → The model has a probabilistic edge worth investigating.');
  } else {
    console.log('   ✗ Probabilistic: model does NOT beat uniform baseline.');
    console.log('     → No edge detected on current slice.');
  }
  if (!pcd || pcd.DRAW === 0) {
    console.log('   ⚠ Draw collapse: model predicts 0 DRAWs (decision policy threshold issue).');
    console.log('     → TOO_CLOSE margin blocks all draw calls at identity calibration.');
  }

  // ── Deferred ──────────────────────────────────────────────────────────
  console.log('\n7. DEFERRED');
  console.log('   Calibration training     → H6 (after more data collected)');
  console.log('   Forward validation       → H7');
  console.log('   UI display               → H5');
  console.log('   Multi-competition run    → extend COMP_ID list in this script');
  console.log('');
}

main().catch(err => { console.error('[Backtest] Fatal:', err); process.exit(1); });

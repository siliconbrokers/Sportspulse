/**
 * run-track-a-observation.ts — Track A Backend Runtime Observation Orchestrator
 *
 * Entry point for automated Track A observation:
 *   1. Runs the observation collector (real backend evidence only)
 *   2. Appends new rows to the CSV (no synthetic or gap rows)
 *   3. Runs the evaluator (formal B1..B8 coverage + Track A status)
 *   4. Prints a concise execution summary
 *
 * Scheduling recommendation:
 *   Every 10 minutes via cron (example):
 *   crontab: 10min cadence, cd SportsPulse && pnpm tsx scripts/run-track-a-observation.ts
 *
 * Run manually:
 *   pnpm tsx scripts/run-track-a-observation.ts
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collect, appendRowsToCSV, CSV_PATH, REPORT_PATH } from './track-a-observation-collector.js';
import { evaluate } from './track-a-evaluator.js';

const CWD = process.cwd();

async function main(): Promise<void> {
  const nowUtc = new Date().toISOString();
  console.log(`\n=== Track A Automated Observation === ${nowUtc}`);

  // Ensure ops directory exists
  fs.mkdirSync(path.resolve(CWD, 'ops'), { recursive: true });

  // ── Step 1: Collect ────────────────────────────────────────────────────────
  process.stdout.write('[ collect ] Scanning runtime sources...');
  const collResult = await collect();
  console.log(` done.`);
  console.log(`           new rows:         ${collResult.newRows.length}`);
  console.log(`           skipped (no-op):  ${collResult.skippedRedundant}`);
  console.log(`           effective scope:  ${collResult.effectiveScope.join(', ')}`);
  if (collResult.excludedCompetitions.length > 0) {
    console.log(`           excluded:         ${collResult.excludedCompetitions.join(', ')} (broken runtime source)`);
  }

  // ── Step 2: Append to CSV ─────────────────────────────────────────────────
  if (collResult.newRows.length > 0) {
    appendRowsToCSV(CSV_PATH, collResult.newRows);
    console.log(`[ csv     ] Appended ${collResult.newRows.length} row(s) to ${CSV_PATH}`);
    for (const row of collResult.newRows) {
      const caseTag = row.covered_case_ids || '—';
      console.log(`             + ${row.observation_id} [${row.competition_code}] ${row.actual_backend_outcome} verdict=${row.row_verdict} cases=${caseTag}`);
    }
  } else {
    console.log(`[ csv     ] No new rows — observable state unchanged.`);
  }

  // ── Step 3: Evaluate ──────────────────────────────────────────────────────
  process.stdout.write('[ evaluate] Computing B1..B8 coverage...');
  const evalResult = evaluate(nowUtc);
  console.log(` done.`);

  const coveredCases = Object.entries(evalResult.coverage)
    .filter(([, v]) => v.covered)
    .map(([k]) => k);
  const openCases = Object.entries(evalResult.coverage)
    .filter(([, v]) => !v.covered)
    .map(([k]) => k);

  console.log(`           valid rows:       ${evalResult.validRows}`);
  console.log(`           FAIL rows:        ${evalResult.failRows}`);
  console.log(`           covered cases:    ${evalResult.coveredCount}/8 [${coveredCases.join(', ') || 'none'}]`);
  console.log(`           open cases:       ${openCases.join(', ') || 'none'}`);
  if (evalResult.blockingIssues.length > 0) {
    console.log(`           blocking issues:  ${evalResult.blockingIssues.length}`);
    for (const issue of evalResult.blockingIssues) {
      console.log(`             - ${issue.id} [${issue.competition}]: ${issue.reason.slice(0, 70)}...`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n══ Track A Status: ${evalResult.trackAStatus} ══`);
  console.log(`   report: ${REPORT_PATH}`);
  console.log(`   csv:    ${CSV_PATH}\n`);

  if (evalResult.trackAStatus === 'FAIL') {
    process.exit(1); // Non-zero exit so cron/CI can detect failures
  }
}

main().catch((err: unknown) => {
  console.error('[TrackA] Fatal error:', err);
  process.exit(1);
});

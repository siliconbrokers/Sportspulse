/**
 * reset-forward-validation.ts — H11-fix migration: FULL_RESET of forward store.
 *
 * Reads the existing forward-validation.json, reports counts, archives it,
 * and writes a fresh empty store under the v2_window_based freeze policy.
 *
 * Run once after deploying H11-fix:
 *   pnpm tsx scripts/reset-forward-validation.ts
 *
 * After this script completes, the runner will rebuild forward records on the
 * next refresh cycle using the corrected window-based freeze policy.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import 'dotenv/config';

// ── Paths ──────────────────────────────────────────────────────────────────

const STORE_PATH = path.resolve(process.cwd(), 'cache/predictions/forward-validation.json');
const BACKUP_PATH = path.resolve(
  process.cwd(),
  'cache/predictions/forward-validation.backup-pre-h11fix.json',
);

// ── Types (inline to avoid importing from store) ───────────────────────────

interface OldRecord {
  record_id: string;
  variant: string;
  competition_code: string;
  match_id: string;
  kickoff_utc: string;
  snapshot_frozen_at: string;
  actual_result: string | null;
  excluded_reason: string | null;
}

interface StoreFileDoc {
  version: number;
  savedAt: string;
  freeze_policy?: string;
  records: OldRecord[];
}

// ── Main ───────────────────────────────────────────────────────────────────

function run(): void {
  console.log('=== H11-fix: FULL_RESET — Forward Validation Store Migration ===\n');

  // ── 1. Read existing store ───────────────────────────────────────────────

  let existingRecords: OldRecord[] = [];
  let existingPolicy = 'unknown';

  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const doc = JSON.parse(raw) as StoreFileDoc;
      existingRecords = doc.records ?? [];
      existingPolicy = doc.freeze_policy ?? 'v1_legacy';
      console.log(`Read ${existingRecords.length} records from ${STORE_PATH}`);
      console.log(`Existing freeze_policy: ${existingPolicy}`);
    } catch (err) {
      console.error('Could not read existing store:', err);
      process.exit(1);
    }
  } else {
    console.log('No existing store found — nothing to reset.');
    writeEmptyStore();
    process.exit(0);
  }

  // ── 2. Report existing records ───────────────────────────────────────────

  const total = existingRecords.length;
  const completed = existingRecords.filter((r) => r.actual_result !== null);
  const pending = existingRecords.filter((r) => r.actual_result === null);
  const byVariant: Record<string, number> = {};
  const byComp: Record<string, number> = {};

  for (const r of existingRecords) {
    byVariant[r.variant] = (byVariant[r.variant] ?? 0) + 1;
    byComp[r.competition_code] = (byComp[r.competition_code] ?? 0) + 1;
  }

  // Analyze freeze timing for baseline records
  const now = new Date();
  const leadHoursDistribution = existingRecords
    .filter((r) => r.variant === 'BASELINE_REFERENCE' && r.snapshot_frozen_at)
    .map((r) => {
      const ko = new Date(r.kickoff_utc);
      const frozen = new Date(r.snapshot_frozen_at);
      return (ko.getTime() - frozen.getTime()) / (60 * 60 * 1000);
    })
    .sort((a, b) => a - b);

  const withinWindow = leadHoursDistribution.filter((h) => h >= 0.5 && h <= 48).length;
  const tooEarly = leadHoursDistribution.filter((h) => h > 48).length;
  const tooLate = leadHoursDistribution.filter((h) => h < 0.5).length;

  console.log('\n── Existing records report ─────────────────────────────────');
  console.log(`  Total:     ${total}`);
  console.log(`  Completed: ${completed.length} (actual_result set)`);
  console.log(`  Pending:   ${pending.length} (actual_result null)`);
  console.log(`  By variant: ${JSON.stringify(byVariant)}`);
  console.log(`  By competition: ${JSON.stringify(byComp)}`);
  if (leadHoursDistribution.length > 0) {
    const med = leadHoursDistribution[Math.floor(leadHoursDistribution.length / 2)]!;
    console.log(`\n  Freeze lead-time distribution (BASELINE records, n=${leadHoursDistribution.length}):`);
    console.log(`    min:    ${leadHoursDistribution[0]!.toFixed(1)}h`);
    console.log(`    median: ${med.toFixed(1)}h`);
    console.log(`    max:    ${leadHoursDistribution[leadHoursDistribution.length - 1]!.toFixed(1)}h`);
    console.log(`    within valid window (0.5h–48h): ${withinWindow}`);
    console.log(`    too early (>48h):               ${tooEarly}  ← INVALID`);
    console.log(`    too late  (<0.5h):              ${tooLate}   ← INVALID`);
  }

  // ── 3. Evaluate completed records ───────────────────────────────────────

  if (completed.length > 0) {
    console.log(`\n⚠  ${completed.length} completed records found.`);
    const completedInWindow = completed.filter((r) => {
      const ko = new Date(r.kickoff_utc);
      const frozen = new Date(r.snapshot_frozen_at);
      const lead = (ko.getTime() - frozen.getTime()) / (60 * 60 * 1000);
      return lead >= 0.5 && lead <= 48;
    });
    console.log(
      `   Of those, ${completedInWindow.length} were frozen within the valid 0.5h–48h window.`,
    );
    console.log(
      `   Decision: DISCARD ALL — policy was v1_legacy, not trustworthy as controlled evidence.\n`,
    );
  }

  // ── 4. Archive existing store ────────────────────────────────────────────

  console.log(`\n── Archiving existing store ────────────────────────────────`);
  try {
    fs.copyFileSync(STORE_PATH, BACKUP_PATH);
    console.log(`  Archived to: ${BACKUP_PATH}`);
  } catch (err) {
    console.error('  Archive failed:', err);
    console.error('  Aborting — no records deleted.');
    process.exit(1);
  }

  // ── 5. Write fresh empty store ───────────────────────────────────────────

  writeEmptyStore();

  // ── 6. Summary ──────────────────────────────────────────────────────────

  console.log('\n── Migration summary ───────────────────────────────────────');
  console.log(`  Policy reset:  v1_legacy → v2_window_based`);
  console.log(`  Records removed:    ${total} (${byVariant['BASELINE_REFERENCE'] ?? 0} BASELINE + ${byVariant['CTI_ALPHA_0_4'] ?? 0} CTI)`);
  console.log(`  Completed removed:  ${completed.length}`);
  console.log(`  Pending removed:    ${pending.length}`);
  console.log(`  Archive:            ${BACKUP_PATH}`);
  console.log(`  New store:          ${STORE_PATH} (0 records, v2_window_based)`);
  console.log('\n  ✓ H11-fix FULL_RESET complete.');
  console.log('  Previous H11 forward records should be considered INVALID for analytical use.');
  console.log('  The runner will rebuild under the corrected policy on the next refresh cycle.\n');

  // Timing sanity: what matches are currently in the freeze window?
  console.log('── Post-reset readiness ────────────────────────────────────');
  console.log(`  Current time: ${now.toISOString()}`);
  console.log(`  Freeze window: [kickoff - 48h, kickoff - 30min]`);
  console.log(`  Matches frozen under old policy that fall within the valid window: ${withinWindow}`);
  console.log(`  → These will be re-frozen when the next runner cycle fires.`);
}

function writeEmptyStore(): void {
  const emptyDoc = {
    version: 1,
    freeze_policy: 'v2_window_based',
    savedAt: new Date().toISOString(),
    records: [],
  };
  const tmpPath = STORE_PATH.replace(/\.json$/, '.tmp');
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(emptyDoc, null, 2), 'utf-8');
    fs.renameSync(tmpPath, STORE_PATH);
    console.log(`\n  Wrote empty store to: ${STORE_PATH}`);
    console.log('  freeze_policy: v2_window_based');
    console.log('  records: []');
  } catch (err) {
    console.error('  Failed to write empty store:', err);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    process.exit(1);
  }
}

run();

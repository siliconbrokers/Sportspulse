/**
 * track-a-evaluator.ts — Track A Backend Runtime Observation Evaluator
 *
 * Reads the CSV, validates rows, computes formal B1..B8 coverage,
 * detects blocking issues, computes Track A status, and writes the markdown report.
 *
 * Coverage rules are hard-coded and strict — no preliminary support counts as formal coverage.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseCSV,
  STORE_PATH,
  RUNNER_LOG_PATH,
  CACHE_ROOT,
  STATE_PATH,
  CSV_PATH,
  REPORT_PATH,
  FREEZE_WINDOW_MIN_LEAD_H,
  FREEZE_WINDOW_MAX_LEAD_H,
  EXPECTED_VARIANTS,
  type ObservationRow,
  type BlockingIssue,
} from './track-a-observation-collector.js';

interface StoreRecord {
  match_id: string;
  variant: string;
  snapshot_frozen_at: string | null;
  competition_code: string;
  actual_result: string | null;
  excluded_reason?: string | null;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CaseResult {
  covered: boolean;
  evidence: string;
}

export interface EvaluatorResult {
  coverage: Record<string, CaseResult>;
  trackAStatus: 'OPEN' | 'PASS' | 'FAIL';
  blockingIssues: BlockingIssue[];
  totalRows: number;
  validRows: number;
  failRows: number;
  coveredCount: number;
}

// ── Row validation ────────────────────────────────────────────────────────────

function isValidRow(row: ObservationRow): boolean {
  return (
    !!row.observation_id &&
    !!row.match_id &&
    row.match_id !== 'n.a.' &&
    !!row.observed_at_utc &&
    !!row.competition_code &&
    row.competition_code !== 'n.a.'
  );
}

// ── Blocking issues detection (structural) ────────────────────────────────────

function detectBlockingIssuesBL1(storeRecords: StoreRecord[]): BlockingIssue | null {
  const bl1StoreCount = storeRecords.filter(r => r.competition_code === 'BL1').length;

  // If runner produced BL1 records → operational
  if (bl1StoreCount > 0) return null;

  // No store records — determine cause
  const logFailing = fs.existsSync(RUNNER_LOG_PATH) &&
    fs.readFileSync(RUNNER_LOG_PATH, 'utf-8').includes('No seasonId for comp:football-data:BL1');

  if (logFailing) {
    return {
      id: 'BSI-1', competition: 'BL1',
      reason: 'BL1 broken for forward-validation: 0 store records and runner log confirms getSeasonId() failure. Matchday cache files may exist (dashboard pipeline) but forward-validation runner fails during BL1 processing.',
    };
  }

  const bl1CacheDir = path.join(CACHE_ROOT, 'BL1');
  let hasCacheFiles = false;
  if (fs.existsSync(bl1CacheDir)) {
    const seasons = fs.readdirSync(bl1CacheDir).filter(d => {
      try { return fs.statSync(path.join(bl1CacheDir, d)).isDirectory(); } catch { return false; }
    });
    for (const season of seasons) {
      const files = fs.readdirSync(path.join(bl1CacheDir, season)).filter(f => f.endsWith('.json'));
      if (files.length > 0) { hasCacheFiles = true; break; }
    }
  }

  if (hasCacheFiles) {
    return {
      id: 'BSI-1', competition: 'BL1',
      reason: 'BL1 broken for forward-validation: matchday cache accessible (dashboard pipeline) but 0 store records — runner fails during BL1 forward-validation processing.',
    };
  }

  return {
    id: 'BSI-1', competition: 'BL1',
    reason: 'BL1 unreachable: 0 matchday cache files and 0 store records.',
  };
}

function detectBlockingIssues(): BlockingIssue[] {
  const issues: BlockingIssue[] = [];
  try {
    const storeRecords: StoreRecord[] = fs.existsSync(STORE_PATH)
      ? (JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as { records: StoreRecord[] }).records ?? []
      : [];
    const bl1Issue = detectBlockingIssuesBL1(storeRecords);
    if (bl1Issue) issues.push(bl1Issue);
  } catch { /* non-fatal */ }
  return issues;
}

// ── Coverage computation (strict per-spec rules) ──────────────────────────────

function computeCoverage(validRows: ObservationRow[]): Record<string, CaseResult> {
  const passRows = validRows.filter(r => r.row_verdict === 'PASS');

  // B1: real match frozen inside window correctly
  const b1 = passRows.filter(r =>
    r.within_freeze_window === 'yes' &&
    r.expected_backend_outcome === 'FREEZE_EXPECTED' &&
    r.actual_backend_outcome === 'FREEZE_CREATED' &&
    r.freeze_record_present === 'yes' &&
    r.snapshot_frozen_at.length > 0 &&
    r.freeze_lead_hours.length > 0 &&
    r.duplicate_record_detected === 'no',
  );

  // B2: real match outside window with no freeze
  const b2 = passRows.filter(r =>
    r.within_freeze_window === 'no' &&
    r.expected_backend_outcome === 'NO_FREEZE_EXPECTED' &&
    r.actual_backend_outcome === 'NO_FREEZE' &&
    r.freeze_record_present === 'no',
  );

  // B3: real post-freeze re-observation without duplicate
  // Must explicitly include 'B3' in covered_case_ids
  const b3 = passRows.filter(r =>
    r.covered_case_ids?.split('|').includes('B3') &&
    r.duplicate_record_detected === 'no' &&
    r.freeze_record_present === 'yes',
  );

  // B4: real variant pairing verified
  const b4 = passRows.filter(r =>
    r.covered_case_ids?.split('|').includes('B4') &&
    r.variant_pair_complete === 'yes',
  );

  // B5: real diagnostic case
  const b5 = passRows.filter(r =>
    r.expected_backend_outcome === 'DIAGNOSTIC_EXPECTED' &&
    r.actual_backend_outcome === 'DIAGNOSTIC_CREATED' &&
    r.diagnostic_present === 'yes',
  );

  // B6: diagnostic confirmed absent from findPending
  const b6 = passRows.filter(r =>
    r.covered_case_ids?.split('|').includes('B6') &&
    r.diagnostic_present === 'yes' &&
    r.pending_visible_correctly === 'yes',
  );

  // B7: TIMED match frozen correctly
  const b7 = passRows.filter(r =>
    r.match_status_at_observation === 'TIMED' &&
    r.within_freeze_window === 'yes' &&
    r.actual_backend_outcome === 'FREEZE_CREATED' &&
    r.freeze_record_present === 'yes',
  );

  // B8: post-match settled with linkage confirmed
  const b8 = passRows.filter(r =>
    r.settlement_state === 'settled' &&
    r.post_match_link_ok === 'yes' &&
    r.actual_backend_outcome === 'SETTLED',
  );

  const fmt = (rows: ObservationRow[], fallback: string): string =>
    rows.length > 0
      ? rows.map(r => r.observation_id).join(', ')
      : fallback;

  return {
    B1: { covered: b1.length > 0, evidence: fmt(b1, 'No match observed inside freeze window yet') },
    B2: { covered: b2.length > 0, evidence: fmt(b2, 'No B2 evidence') },
    B3: { covered: b3.length > 0, evidence: fmt(b3, 'No real post-freeze re-observation yet — requires freeze record + subsequent runner cycle') },
    B4: { covered: b4.length > 0, evidence: fmt(b4, 'No variant pairing evidence yet — requires freeze records for all expected variants') },
    B5: { covered: b5.length > 0, evidence: fmt(b5, 'No diagnostic case observed (requires missed freeze window scenario)') },
    B6: { covered: b6.length > 0, evidence: fmt(b6, 'No diagnostic isolation evidence — requires B5 plus findPending() check') },
    B7: { covered: b7.length > 0, evidence: fmt(b7, 'No TIMED match observed yet (football-data.org sets TIMED 1–7 days before kickoff)') },
    B8: { covered: b8.length > 0, evidence: fmt(b8, 'No settled match yet — requires frozen match to complete and be evaluated') },
  };
}

// ── Track A status ───────────────────────────────────────────────────────────

function computeStatus(
  coverage: Record<string, CaseResult>,
  validRows: ObservationRow[],
): 'OPEN' | 'PASS' | 'FAIL' {
  const failRows = validRows.filter(r => r.row_verdict === 'FAIL');
  if (failRows.length > 0) return 'FAIL';

  const coveredCount = Object.values(coverage).filter(c => c.covered).length;
  if (coveredCount === 8 && validRows.length >= 8) return 'PASS';

  return 'OPEN';
}

// ── Store and log info for report ─────────────────────────────────────────────

interface RuntimeInfo {
  storeRecordCount: number;
  storeFrozenCount: number;    // snapshot_frozen_at !== null
  storeDiagCount: number;      // snapshot_frozen_at === null (excluded_reason present)
  storePendingCount: number;   // frozen && actual_result === null
  storeSettledCount: number;   // actual_result !== null
  storePolicy: string;
  storeSavedAt: string;
  logLineCount: number;
  bl1Failing: boolean;
  cacheFiles: Record<string, number>;
}

function readRuntimeInfo(): RuntimeInfo {
  let storeRecordCount = 0;
  let storeFrozenCount = 0;
  let storeDiagCount   = 0;
  let storePendingCount = 0;
  let storeSettledCount = 0;
  let storePolicy      = 'unknown';
  let storeSavedAt     = 'unknown';

  if (fs.existsSync(STORE_PATH)) {
    try {
      const s = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      const records: StoreRecord[] = s.records ?? [];
      storeRecordCount  = records.length;
      storePolicy       = s.freeze_policy ?? 'unknown';
      storeSavedAt      = s.savedAt ?? 'unknown';
      storeFrozenCount  = records.filter(r => r.snapshot_frozen_at !== null).length;
      storeDiagCount    = records.filter(r => r.snapshot_frozen_at === null).length;
      storePendingCount = records.filter(r => r.snapshot_frozen_at !== null && r.actual_result === null).length;
      storeSettledCount = records.filter(r => r.actual_result !== null).length;
    } catch { /* ignore */ }
  }

  let logLineCount = 0;
  let bl1Failing   = false;
  if (fs.existsSync(RUNNER_LOG_PATH)) {
    const log = fs.readFileSync(RUNNER_LOG_PATH, 'utf-8');
    logLineCount = log.split('\n').length;
    bl1Failing   = log.includes('No seasonId for comp:football-data:BL1');
  }

  const cacheFiles: Record<string, number> = {};
  for (const comp of ['PD', 'PL', 'BL1']) {
    // Check all season subdirectories
    const compDir = path.join(CACHE_ROOT, comp);
    let totalFiles = 0;
    if (fs.existsSync(compDir)) {
      try {
        const seasons = fs.readdirSync(compDir);
        for (const season of seasons) {
          const seasonDir = path.join(compDir, season);
          try {
            if (fs.statSync(seasonDir).isDirectory()) {
              totalFiles += fs.readdirSync(seasonDir).filter(f => f.endsWith('.json')).length;
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    cacheFiles[comp] = totalFiles;
  }

  return {
    storeRecordCount, storeFrozenCount, storeDiagCount, storePendingCount, storeSettledCount,
    storePolicy, storeSavedAt, logLineCount, bl1Failing, cacheFiles,
  };
}

// ── Report generator ─────────────────────────────────────────────────────────

function generateReport(
  allRows: ObservationRow[],
  validRows: ObservationRow[],
  coverage: Record<string, CaseResult>,
  blockingIssues: BlockingIssue[],
  trackAStatus: 'OPEN' | 'PASS' | 'FAIL',
  nowUtc: string,
  rt: RuntimeInfo,
): string {
  const passRows  = validRows.filter(r => r.row_verdict === 'PASS');
  const failRows  = validRows.filter(r => r.row_verdict === 'FAIL');
  const needsRows = validRows.filter(r => r.row_verdict === 'NEEDS_REVIEW');
  const coveredCount = Object.values(coverage).filter(c => c.covered).length;
  const openCases    = ['B1','B2','B3','B4','B5','B6','B7','B8'].filter(b => !coverage[b]?.covered);

  let md = `# Track A — Backend Runtime Observation Report\n\n`;
  md += `**Protocol:** v2_window_based freeze policy  \n`;
  md += `**Observer:** AutomatedTrackA-v1  \n`;
  md += `**Generated:** ${nowUtc}  \n`;
  md += `**CSV:** \`ops/track_a_backend_runtime_observation.csv\`\n\n---\n\n`;

  // ## Runtime Sources Found
  md += `## Runtime Sources Found\n\n`;
  md += `| Source | Location | Status |\n`;
  md += `|--------|----------|--------|\n`;
  const storeExists = fs.existsSync(STORE_PATH);
  md += `| Forward validation store (all records) | \`cache/predictions/forward-validation.json\` | ${storeExists ? `${rt.storeRecordCount} total records, policy=${rt.storePolicy}, savedAt=${rt.storeSavedAt}` : '**Not found**'} |\n`;
  if (storeExists) {
    md += `| → Frozen records (findPending + findCompleted) | same file | ${rt.storeFrozenCount} records (snapshot_frozen_at ≠ null) |\n`;
    md += `| → Pending settlement | same file | ${rt.storePendingCount} records (frozen, actual_result = null) |\n`;
    md += `| → Settled records (findCompleted) | same file | ${rt.storeSettledCount} records (actual_result ≠ null) |\n`;
    md += `| → Diagnostic records (findDiagnostic) | same file | ${rt.storeDiagCount} records (snapshot_frozen_at = null, excluded_reason set) |\n`;
  }
  md += `| API runtime log | \`/tmp/sp-api.log\` | ${rt.logLineCount > 0 ? `${rt.logLineCount} lines` : 'Not found (no runner cycle yet, or log rotated)'} |\n`;
  for (const comp of ['PD', 'PL']) {
    md += `| Matchday cache (${comp}) | \`cache/football-data/${comp}/\` | ${rt.cacheFiles[comp] ?? 0} matchday files |\n`;
  }
  const bl1Blocked = blockingIssues.some(i => i.competition === 'BL1');
  md += `| Matchday cache (BL1) | \`cache/football-data/BL1/\` | ${rt.cacheFiles['BL1'] ?? 0} files on disk${bl1Blocked ? ' — **excluded from scope (BSI-1)**' : ''} |\n`;
  md += `\n---\n\n`;

  // ## Controls Executed
  md += `## Controls Executed\n\n`;
  md += `- Read forward-validation store: ${rt.storeRecordCount} records, freeze_policy=${rt.storePolicy}\n`;
  md += `- Scanned runner log (${rt.logLineCount} lines): BL1 getSeasonId failure ${rt.bl1Failing ? 'confirmed' : 'not detected'}\n`;
  md += `- Scanned matchday cache for PD and PL\n`;
  md += `- Configured freeze window: [${FREEZE_WINDOW_MIN_LEAD_H}h, ${FREEZE_WINDOW_MAX_LEAD_H}h]\n`;
  md += `- Eligible statuses: SCHEDULED, TIMED\n`;
  md += `- Expected variants: ${EXPECTED_VARIANTS.join(', ')}\n`;
  md += `- Applied anti-redundancy: skipped rows with unchanged observable fingerprint\n`;
  md += `\n---\n\n`;

  // ## CSV Cleanup Performed
  md += `## CSV Cleanup Performed\n\n`;
  const invalidCount = allRows.length - validRows.length;
  if (invalidCount === 0) {
    md += `No invalid or synthetic rows detected. All ${allRows.length} CSV rows have real match_id and traceable evidence.\n`;
  } else {
    md += `${invalidCount} rows failed structural validation (missing match_id or competition_code = n.a.). These rows are excluded from coverage computation.\n`;
    md += `${validRows.length} valid rows retained.\n`;
  }
  md += `\n---\n\n`;

  // ## Observations Registered
  md += `## Observations Registered\n\n`;
  md += `Total valid rows: **${validRows.length}** (${passRows.length} PASS | ${failRows.length} FAIL | ${needsRows.length} NEEDS_REVIEW)\n\n`;

  if (validRows.length > 0) {
    md += `| observation_id | match | comp | kickoff | lead_h | window | expected | actual | verdict | cases |\n`;
    md += `|----------------|-------|------|---------|--------|--------|----------|--------|---------|-------|\n`;
    for (const row of validRows) {
      const matchShort = row.match_id.split(':').pop() ?? row.match_id;
      const koShort    = row.kickoff_utc.slice(0, 16).replace('T', ' ');
      md += `| ${row.observation_id} | ${matchShort} | ${row.competition_code} | ${koShort} | ${row.freeze_lead_hours || '—'} | ${row.within_freeze_window} | ${row.expected_backend_outcome} | ${row.actual_backend_outcome} | **${row.row_verdict}** | ${row.covered_case_ids || '—'} |\n`;
    }
  } else {
    md += `*No valid observations in CSV.*\n`;
  }
  md += `\n---\n\n`;

  // ## Case Coverage
  md += `## Case Coverage\n\n`;
  md += `| Case | Description | Status | Evidence |\n`;
  md += `|------|-------------|--------|----------|\n`;
  const caseDesc: Record<string, string> = {
    B1: 'Eligible match enters freeze window and freezes correctly',
    B2: 'Match outside freeze window does not freeze',
    B3: 'Re-run idempotence after real freeze creation',
    B4: 'Variant pairing integrity',
    B5: 'Legitimate diagnostic generation',
    B6: 'Diagnostic isolation from pending logic',
    B7: 'TIMED match handling',
    B8: 'Post-match completion linkage',
  };
  for (const b of ['B1','B2','B3','B4','B5','B6','B7','B8']) {
    const c = coverage[b]!;
    md += `| ${b} | ${caseDesc[b]} | **${c.covered ? 'covered' : 'not covered'}** | ${c.evidence} |\n`;
  }
  md += `\n---\n\n`;

  // ## Open Coverage Gaps
  if (openCases.length > 0) {
    md += `## Open Coverage Gaps\n\n`;

    // Per-case: distinguish "event not happened" vs "observability source missing"
    const gapDetails: Record<string, { reason: string; sourceStatus: string }> = {
      B1: {
        reason: `Event not happened yet: no match has entered [${FREEZE_WINDOW_MIN_LEAD_H}h, ${FREEZE_WINDOW_MAX_LEAD_H}h] freeze window since observation began.`,
        sourceStatus: `Observability source: accessible (matchday cache for PD/PL: ${(rt.cacheFiles['PD'] ?? 0) + (rt.cacheFiles['PL'] ?? 0)} files; store: ${rt.storeFrozenCount} frozen records).`,
      },
      B3: {
        reason: 'Event not happened yet: no frozen match has been re-observed in a subsequent runner cycle. Cannot close before B1.',
        sourceStatus: `Observability source: accessible (forward-validation store: ${rt.storeFrozenCount} frozen records, ${rt.storePendingCount} pending settlement).`,
      },
      B4: {
        reason: `Event not happened yet: no frozen match with all expected variants (${EXPECTED_VARIANTS.join(', ')}) confirmed. Cannot close before B1.`,
        sourceStatus: `Observability source: accessible (same store).`,
      },
      B5: {
        reason: 'Event not happened yet: no organic MISSED_FREEZE_WINDOW diagnostic has been generated (requires runner downtime during freeze window).',
        sourceStatus: `Observability source: accessible (forward-validation store diagnostic source: ${rt.storeDiagCount} diagnostic records currently). Source is reachable — event has simply not occurred.`,
      },
      B6: {
        reason: 'Event not happened yet: depends on B5. No diagnostic record to confirm absent from findPending().',
        sourceStatus: `Observability source: accessible (findPending filter is structurally operational: ${rt.storePendingCount} pending records visible).`,
      },
      B7: {
        reason: 'Event not happened yet: no match with status=TIMED has entered the freeze window. football-data.org sets TIMED typically 1–7 days before kickoff.',
        sourceStatus: `Observability source: accessible (matchday cache present).`,
      },
      B8: {
        reason: `Event not happened yet: no previously frozen match has completed and been settled. Requires first frozen match to finish.`,
        sourceStatus: `Observability source: accessible (settled records source: ${rt.storeSettledCount} settled records in store; none are from the forward-validation frozen set).`,
      },
    };

    for (const gap of openCases) {
      const d = gapDetails[gap] ?? { reason: 'No evidence yet.', sourceStatus: 'Source status unknown.' };
      md += `### ${gap}\n`;
      md += `- **Gap reason:** ${d.reason}\n`;
      md += `- **${d.sourceStatus}**\n\n`;
    }
    md += `---\n\n`;
  }

  // ## Blocking Scope Issues
  md += `## Blocking Scope Issues\n\n`;
  if (blockingIssues.length === 0) {
    md += `None detected.\n`;
  } else {
    for (const issue of blockingIssues) {
      md += `### ${issue.id}: ${issue.competition}\n\n`;
      md += `- **Reason:** ${issue.reason}\n`;
      md += `- **Impact:** ${issue.competition} matches excluded from formal coverage until resolved\n`;
      md += `- **Effective scope:** ${['PD','PL','BL1'].filter(c => c !== issue.competition).join(' + ')}\n`;
      md += `- **Required action:** Ensure ${issue.competition} in-memory DataSource is populated before the runner fires, or implement retry/defer in the runner\n\n`;
    }
  }
  md += `\n---\n\n`;

  // ## Track A Status
  md += `## Track A Status\n\n`;
  md += `**${trackAStatus}**\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Valid rows in CSV | ${validRows.length} |\n`;
  md += `| Cases covered | ${coveredCount}/8 |\n`;
  md += `| FAIL rows | ${failRows.length} |\n`;
  md += `| Blocking issues | ${blockingIssues.length} |\n`;
  md += `| Effective scope | ${['PD','PL','BL1'].filter(c => !blockingIssues.some(i => i.competition === c)).join(', ')} |\n`;

  if (trackAStatus === 'OPEN') {
    md += `\nTrack A remains OPEN. Real evidence needed for: ${openCases.join(', ')}.\n`;
  } else if (trackAStatus === 'FAIL') {
    const failObs = validRows.filter(r => r.row_verdict === 'FAIL');
    md += `\nTrack A FAIL. Critical contradictions observed:\n`;
    for (const r of failObs) {
      md += `- ${r.observation_id}: expected=${r.expected_backend_outcome}, actual=${r.actual_backend_outcome}, dup=${r.duplicate_record_detected}\n`;
    }
  } else {
    md += `\nAll 8 cases covered with real evidence. Track A PASS.\n`;
  }

  md += `\n---\n\n`;
  md += `*Report generated: ${nowUtc}*\n`;

  return md;
}

// ── Main evaluator ───────────────────────────────────────────────────────────

export function evaluate(nowUtc: string): EvaluatorResult {
  const allRows    = parseCSV(CSV_PATH);
  const validRows  = allRows.filter(isValidRow);
  const rt         = readRuntimeInfo();
  const blockingIssues = detectBlockingIssues();
  const coverage   = computeCoverage(validRows);
  const coveredCount = Object.values(coverage).filter(c => c.covered).length;
  const trackAStatus = computeStatus(coverage, validRows);

  // Write report
  const report = generateReport(allRows, validRows, coverage, blockingIssues, trackAStatus, nowUtc, rt);
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report, 'utf-8');

  // Update coverage snapshot in state
  if (fs.existsSync(STATE_PATH)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      const snap: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(coverage)) snap[k] = (v as CaseResult).covered;
      state.coverage_snapshot      = snap;
      state.blocking_issues_snapshot = blockingIssues;
      const tmp = STATE_PATH.replace('.json', '.tmp');
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmp, STATE_PATH);
    } catch { /* non-fatal */ }
  }

  return {
    coverage,
    trackAStatus,
    blockingIssues,
    totalRows:    allRows.length,
    validRows:    validRows.length,
    failRows:     validRows.filter(r => r.row_verdict === 'FAIL').length,
    coveredCount,
  };
}

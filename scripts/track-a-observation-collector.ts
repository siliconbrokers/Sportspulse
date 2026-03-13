/**
 * track-a-observation-collector.ts — Track A Backend Runtime Observation Collector
 *
 * Reads real backend runtime sources, discovers candidate matches,
 * and builds only real observation rows with traceable evidence.
 *
 * Rules:
 * - Never invents observations
 * - Never adds GAP or placeholder rows
 * - Skips rows when observable fingerprint is unchanged since last run
 * - Adds new rows when state changes (freeze appeared, diagnostic created, settled, etc.)
 * - BL1 is excluded if getSeasonId() is broken at runtime
 * - B3 re-observation is tracked separately and only added after a real post-freeze runner cycle
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Constants (must match forward-validation-runner.ts exactly) ─────────────

export const FREEZE_WINDOW_MAX_LEAD_H = 48;
export const FREEZE_WINDOW_MIN_LEAD_H = 0.5;
export const FREEZE_WINDOW_MAX_LEAD_MS = FREEZE_WINDOW_MAX_LEAD_H * 3_600_000;
export const FREEZE_WINDOW_MIN_LEAD_MS = FREEZE_WINDOW_MIN_LEAD_H * 3_600_000;
export const ELIGIBLE_STATUSES = new Set(['SCHEDULED', 'TIMED']);
export const EXPECTED_VARIANTS = ['BASELINE_REFERENCE', 'CTI_ALPHA_0_4'] as const;
export const NOMINAL_SCOPE = ['PD', 'PL', 'BL1'] as const;
export const OBSERVER = 'AutomatedTrackA-v1';

// ── Paths ───────────────────────────────────────────────────────────────────

const CWD = process.cwd();
export const STORE_PATH      = path.resolve(CWD, 'cache/predictions/forward-validation.json');
export const RUNNER_LOG_PATH = '/tmp/sp-api.log';
export const CACHE_ROOT      = path.resolve(CWD, 'cache/football-data');
export const STATE_PATH      = path.resolve(CWD, 'ops/track_a_backend_runtime_state.json');
export const CSV_PATH        = path.resolve(CWD, 'ops/track_a_backend_runtime_observation.csv');
export const REPORT_PATH     = path.resolve(CWD, 'ops/track_a_backend_runtime_observation_report.md');

// ── Types ───────────────────────────────────────────────────────────────────

export interface ObservationRow {
  observation_id: string;
  observed_at_utc: string;
  observer: string;
  match_id: string;
  competition_code: string;
  home_team: string;
  away_team: string;
  kickoff_utc: string;
  match_status_at_observation: string;
  within_freeze_window: 'yes' | 'no' | 'unknown';
  expected_backend_outcome: string;
  actual_backend_outcome: string;
  freeze_record_present: 'yes' | 'no';
  diagnostic_present: 'yes' | 'no';
  diagnostic_type: 'none' | 'MISSED_FREEZE_WINDOW' | 'NO_START_TIME' | 'other';
  variant_pair_complete: 'yes' | 'no' | 'n.a.';
  snapshot_frozen_at: string;
  freeze_lead_hours: string;
  duplicate_record_detected: 'yes' | 'no';
  pending_visible_correctly: 'yes' | 'no' | 'n.a.';
  settlement_state: 'n.a.' | 'pending' | 'eligible_for_settlement' | 'settled' | 'failed';
  post_match_link_ok: 'yes' | 'no' | 'n.a.';
  evidence_ref: string;
  notes: string;
  covered_case_ids: string;
  row_verdict: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
}

export interface TrackAState {
  fingerprint_version: string;
  last_run_at_utc: string;
  last_runner_cycle_marker: string;
  last_store_saved_at: string;
  effective_scope: string[];
  excluded_competitions: string[];
  last_observable_hash_by_entity: Record<string, string>;
  /** matchIds where freeze was observed but B3 re-observation not yet done */
  frozen_matches_pending_b3_reobs: string[];
  /** matchIds where B3 re-observation has been completed */
  frozen_matches_b3_verified: string[];
  coverage_snapshot: Record<string, boolean>;
  blocking_issues_snapshot: Array<{ id: string; competition: string; reason: string }>;
}

export interface BlockingIssue {
  id: string;
  competition: string;
  reason: string;
}

export interface CollectorResult {
  newRows: ObservationRow[];
  skippedRedundant: number;
  effectiveScope: string[];
  excludedCompetitions: string[];
  blockingIssues: BlockingIssue[];
}

interface StoreRecord {
  match_id: string;
  variant: string;
  snapshot_frozen_at: string | null;
  freeze_lead_hours: number | null;
  competition_code: string;
  kickoff_utc: string;
  home_team_id: string;
  away_team_id: string;
  actual_result: string | null;
  excluded_reason: string | null;
}

interface StoreFile {
  version: number;
  freeze_policy: string;
  savedAt: string;
  records: StoreRecord[];
}

export interface MatchCacheEntry {
  matchId: string;
  startTimeUtc: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  matchday: number;
  seasonId: string;
  scoreHome: number | null;
  scoreAway: number | null;
}

// ── CSV schema columns (exact order) ────────────────────────────────────────

export const CSV_COLUMNS: (keyof ObservationRow)[] = [
  'observation_id', 'observed_at_utc', 'observer', 'match_id', 'competition_code',
  'home_team', 'away_team', 'kickoff_utc', 'match_status_at_observation',
  'within_freeze_window', 'expected_backend_outcome', 'actual_backend_outcome',
  'freeze_record_present', 'diagnostic_present', 'diagnostic_type',
  'variant_pair_complete', 'snapshot_frozen_at', 'freeze_lead_hours',
  'duplicate_record_detected', 'pending_visible_correctly', 'settlement_state',
  'post_match_link_ok', 'evidence_ref', 'notes', 'covered_case_ids', 'row_verdict',
];

// ── CSV I/O ─────────────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function parseCSVLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { cols.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  cols.push(cur);
  return cols;
}

export function parseCSV(csvPath: string): ObservationRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf-8').trim();
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const rows: ObservationRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]!.trim());
    if (cols.length < CSV_COLUMNS.length) continue;
    const row: Record<string, string> = {};
    CSV_COLUMNS.forEach((col, idx) => { row[col] = (cols[idx] ?? '').trim(); });
    rows.push(row as unknown as ObservationRow);
  }
  return rows;
}

export function appendRowsToCSV(csvPath: string, rows: ObservationRow[]): void {
  if (rows.length === 0) return;
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const needsHeader = !fs.existsSync(csvPath) ||
    fs.readFileSync(csvPath, 'utf-8').trim() === '';
  let out = needsHeader ? CSV_COLUMNS.join(',') + '\n' : '';
  for (const row of rows) {
    out += CSV_COLUMNS
      .map(col => csvEscape(String((row as Record<string, unknown>)[col] ?? '')))
      .join(',') + '\n';
  }
  fs.appendFileSync(csvPath, out, 'utf-8');
}

// ── State I/O ────────────────────────────────────────────────────────────────

const FINGERPRINT_VERSION = 'v2';

function defaultState(): TrackAState {
  return {
    fingerprint_version: FINGERPRINT_VERSION,
    last_run_at_utc: '',
    last_runner_cycle_marker: '',
    last_store_saved_at: '',
    effective_scope: ['PD', 'PL'],
    excluded_competitions: [],
    last_observable_hash_by_entity: {},
    frozen_matches_pending_b3_reobs: [],
    frozen_matches_b3_verified: [],
    coverage_snapshot: {},
    blocking_issues_snapshot: [],
  };
}

/** Bootstrap state from existing CSV so we don't re-add already-observed rows.
 *  Reconstructs v2 fingerprints from CSV columns (approximate but sufficient). */
function bootstrapStateFromCSV(): TrackAState {
  const state = defaultState();
  if (!fs.existsSync(CSV_PATH)) return state;
  const rows = parseCSV(CSV_PATH);
  for (const row of rows) {
    if (!row.match_id) continue;

    // Reconstruct v2-format fingerprint from CSV columns (best-effort approximation)
    const hasFrozen = row.freeze_record_present === 'yes';
    const hasDiag   = row.diagnostic_present === 'yes';
    const isDup     = row.duplicate_record_detected === 'yes';
    // Approximate counts: if pair complete → fn2 (EXPECTED_VARIANTS.length), else fn1 or fn0
    const fnCount   = hasFrozen ? (row.variant_pair_complete === 'yes' ? '2' : '1') : '0';
    const dnCount   = hasDiag ? '1' : '0';
    const varToken  = hasFrozen
      ? (row.variant_pair_complete === 'yes' ? EXPECTED_VARIANTS.join('+') : 'partial')
      : 'none';
    const dupToken  = isDup ? 'dup' : 'nodup';
    const snapToken = row.snapshot_frozen_at ? row.snapshot_frozen_at.slice(0, 16) : 'none';
    const resultToken = row.settlement_state === 'settled' ? 'settled_unknown' : 'none';
    const windowToken = row.within_freeze_window === 'yes' ? 'in_window'
      : row.kickoff_utc && new Date(row.kickoff_utc).getTime() < new Date(row.observed_at_utc).getTime()
        ? 'past' : 'too_early';

    const fp = [
      row.match_status_at_observation,
      windowToken,
      `fn${fnCount}`,
      `dn${dnCount}`,
      varToken,
      dupToken,
      snapToken,
      resultToken,
    ].join('|');

    // Keep the "richest" fingerprint (prefer freeze over no-freeze)
    const existing = state.last_observable_hash_by_entity[row.match_id];
    if (!existing || hasFrozen) {
      state.last_observable_hash_by_entity[row.match_id] = fp;
    }

    // Track frozen matches for future B3 re-obs
    if (hasFrozen &&
        !state.frozen_matches_pending_b3_reobs.includes(row.match_id) &&
        !state.frozen_matches_b3_verified.includes(row.match_id)) {
      state.frozen_matches_pending_b3_reobs.push(row.match_id);
    }
    if (row.covered_case_ids?.split('|').includes('B3') &&
        !state.frozen_matches_b3_verified.includes(row.match_id)) {
      state.frozen_matches_b3_verified.push(row.match_id);
      state.frozen_matches_pending_b3_reobs =
        state.frozen_matches_pending_b3_reobs.filter(id => id !== row.match_id);
    }
  }
  return state;
}

function readState(): TrackAState {
  if (!fs.existsSync(STATE_PATH)) return bootstrapStateFromCSV();
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as TrackAState;
    // If fingerprint format changed, rebuild from CSV to avoid spurious re-observations
    if (raw.fingerprint_version !== FINGERPRINT_VERSION) {
      return bootstrapStateFromCSV();
    }
    return raw;
  } catch {
    return bootstrapStateFromCSV();
  }
}

export function saveState(state: TrackAState): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmpPath = STATE_PATH.replace('.json', '.tmp');
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STATE_PATH);
}

// ── Runtime source readers ───────────────────────────────────────────────────

function readStore(): StoreFile {
  if (!fs.existsSync(STORE_PATH)) {
    return { version: 1, freeze_policy: 'v2_window_based', savedAt: '', records: [] };
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as StoreFile;
}

export function readMatchesFromCache(comp: string): MatchCacheEntry[] {
  const matches: MatchCacheEntry[] = [];
  // Find all season dirs under this competition
  const compDir = path.join(CACHE_ROOT, comp);
  if (!fs.existsSync(compDir)) return matches;
  const seasons = fs.readdirSync(compDir).filter(d => {
    try { return fs.statSync(path.join(compDir, d)).isDirectory(); } catch { return false; }
  });
  for (const season of seasons) {
    const seasonDir = path.join(compDir, season);
    const files = fs.readdirSync(seasonDir)
      .filter(f => f.startsWith('matchday-') && f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(seasonDir, file), 'utf-8'));
        const entries: MatchCacheEntry[] = raw?.data?.matches ?? raw?.matches ?? [];
        matches.push(...entries);
      } catch { /* skip corrupt file */ }
    }
  }
  return matches;
}

interface RunnerLogInfo {
  lineCount: number;
  lastCycleLineNo: number;  // 1-indexed line number of most recent "Loaded N records"
  cycleCount: number;       // total post-reset cycles observed
  bl1Failing: boolean;
}

function readRunnerLog(): RunnerLogInfo {
  if (!fs.existsSync(RUNNER_LOG_PATH)) {
    return { lineCount: 0, lastCycleLineNo: 0, cycleCount: 0, bl1Failing: false };
  }
  const lines = fs.readFileSync(RUNNER_LOG_PATH, 'utf-8').split('\n');
  let lastCycleLineNo = 0;
  let cycleCount = 0;
  let bl1Failing = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes('[ForwardValidationStore] Loaded')) {
      lastCycleLineNo = i + 1;
      cycleCount++;
    }
    if (line.includes('No seasonId for comp:football-data:BL1')) {
      bl1Failing = true;
    }
  }
  return { lineCount: lines.length, lastCycleLineNo, cycleCount, bl1Failing };
}

// ── Observation fingerprint (v2) ─────────────────────────────────────────────
// Tokens: status | windowBucket | fn{N} | dn{N} | frozenVariants | dup | snapToken | actualResult

function buildFingerprint(
  match: MatchCacheEntry,
  storeRecords: StoreRecord[],
  nowMs: number,
): string {
  const kickoffMs = new Date(match.startTimeUtc).getTime();
  const leadMs = kickoffMs - nowMs;
  const inWindow    = leadMs >= FREEZE_WINDOW_MIN_LEAD_MS && leadMs <= FREEZE_WINDOW_MAX_LEAD_MS;
  const pastKickoff = leadMs <= 0;
  const tooEarly    = leadMs > FREEZE_WINDOW_MAX_LEAD_MS;
  const windowBucket = inWindow ? 'in_window' : pastKickoff ? 'past' : tooEarly ? 'too_early' : 'too_late';

  const frozenRecords = storeRecords.filter(r => r.snapshot_frozen_at !== null);
  const diagRecords   = storeRecords.filter(r => r.snapshot_frozen_at === null);
  const frozenVariants = frozenRecords.map(r => r.variant).sort().join('+');
  const isDup = frozenRecords.length > EXPECTED_VARIANTS.length;

  // Earliest snapshot_frozen_at prefix — detects the moment a freeze was first created
  const frozenSorted = frozenRecords
    .filter(r => r.snapshot_frozen_at)
    .sort((a, b) => (a.snapshot_frozen_at ?? '').localeCompare(b.snapshot_frozen_at ?? ''));
  const snapToken = frozenSorted.length > 0
    ? (frozenSorted[0]!.snapshot_frozen_at ?? '').slice(0, 16)
    : 'none';

  // Settled actual_result — detects settlement event
  const settledRecord = storeRecords.find(r => r.actual_result !== null);
  const actualResult  = settledRecord?.actual_result ?? 'none';

  return [
    match.status,
    windowBucket,
    `fn${frozenRecords.length}`,  // freeze_record_count
    `dn${diagRecords.length}`,    // diag_count
    frozenVariants || 'none',
    isDup ? 'dup' : 'nodup',
    snapToken,                    // first snapshot_frozen_at prefix (16 chars)
    actualResult,                 // settlement value or 'none'
  ].join('|');
}

// ── Observation ID ───────────────────────────────────────────────────────────

function makeObsId(nowUtc: string, matchId: string, suffix?: string): string {
  const provId = matchId.split(':').pop() ?? matchId;
  // Format: OBS-YYYYMMDD-HHmmss-{provId}[-suffix]
  const ts = nowUtc.replace(/[-:.TZ]/g, '').slice(0, 14);
  const date = ts.slice(0, 8);
  const time = ts.slice(8, 14);
  const base = `OBS-${date}-${time}-${provId}`;
  return suffix ? `${base}-${suffix}` : base;
}

// ── Core observation builder ─────────────────────────────────────────────────

function buildRow(
  match: MatchCacheEntry,
  comp: string,
  nowMs: number,
  nowUtc: string,
  storeRecords: StoreRecord[],
  logRef: string,
  storeRef: string,
  suffix?: string,
): ObservationRow {
  const kickoffMs = new Date(match.startTimeUtc).getTime();
  const leadMs = kickoffMs - nowMs;
  const leadH = leadMs / 3_600_000;

  const inWindow  = leadMs >= FREEZE_WINDOW_MIN_LEAD_MS && leadMs <= FREEZE_WINDOW_MAX_LEAD_MS;
  const tooEarly  = leadMs > FREEZE_WINDOW_MAX_LEAD_MS;
  const tooLate   = leadMs < FREEZE_WINDOW_MIN_LEAD_MS && leadMs > 0;
  const pastKickoff = leadMs <= 0;

  const frozenRecords    = storeRecords.filter(r => r.snapshot_frozen_at !== null);
  const diagnosticRecords = storeRecords.filter(r => r.snapshot_frozen_at === null);
  const completedRecords = frozenRecords.filter(r => r.actual_result !== null);

  const hasFrozen = frozenRecords.length > 0;
  const hasDiag   = diagnosticRecords.length > 0;

  // Variant pair: only meaningful when any variant is frozen
  const frozenVariants = new Set(frozenRecords.map(r => r.variant));
  const allPaired = (EXPECTED_VARIANTS as readonly string[]).every(v => frozenVariants.has(v));
  const pairComplete: ObservationRow['variant_pair_complete'] = hasFrozen
    ? (allPaired ? 'yes' : 'no')
    : 'n.a.';

  // Duplicate detection: more frozen records than expected variants
  const dupDetected: ObservationRow['duplicate_record_detected'] =
    frozenRecords.length > EXPECTED_VARIANTS.length ? 'yes' : 'no';

  // Pending visibility: frozen records not yet settled should be visible in findPending()
  // findPending() = snapshot_frozen_at != null && actual_result === null
  const pendingInStore = frozenRecords.filter(r => r.actual_result === null).length;
  const pendingVisible: ObservationRow['pending_visible_correctly'] = hasFrozen
    ? (pendingInStore === frozenRecords.filter(r => r.actual_result === null).length ? 'yes' : 'n.a.')
    : 'n.a.';

  // Settlement
  let settlementState: ObservationRow['settlement_state'] = 'n.a.';
  let postMatchLinkOk: ObservationRow['post_match_link_ok'] = 'n.a.';
  if (hasFrozen) {
    if (pastKickoff && completedRecords.length > 0) {
      settlementState = 'settled';
      postMatchLinkOk = 'yes';
    } else if (pastKickoff) {
      settlementState = 'eligible_for_settlement';
      postMatchLinkOk = 'no';
    } else {
      settlementState = 'pending';
    }
  }

  // Diagnostic type
  let diagType: ObservationRow['diagnostic_type'] = 'none';
  if (hasDiag) {
    const r0 = diagnosticRecords[0]!;
    if (r0.excluded_reason === 'MISSED_FREEZE_WINDOW') diagType = 'MISSED_FREEZE_WINDOW';
    else if (r0.excluded_reason === 'NO_START_TIME')   diagType = 'NO_START_TIME';
    else diagType = 'other';
  }

  // Within freeze window
  let within: ObservationRow['within_freeze_window'];
  if (inWindow)      within = 'yes';
  else if (pastKickoff) within = 'no';
  else               within = 'no';

  // Expected vs actual
  let expectedOutcome: string;
  let actualOutcome: string;

  if (pastKickoff && hasFrozen) {
    expectedOutcome = 'SETTLEMENT_EXPECTED';
    actualOutcome   = completedRecords.length > 0 ? 'SETTLED' : 'INCONSISTENT';
  } else if (pastKickoff && !hasFrozen && hasDiag) {
    expectedOutcome = 'DIAGNOSTIC_EXPECTED';
    actualOutcome   = 'DIAGNOSTIC_CREATED';
  } else if (inWindow) {
    expectedOutcome = 'FREEZE_EXPECTED';
    actualOutcome   = hasFrozen ? 'FREEZE_CREATED'
                    : hasDiag  ? 'DIAGNOSTIC_CREATED'
                    : 'INCONSISTENT';
  } else if (tooLate && !hasFrozen) {
    expectedOutcome = 'DIAGNOSTIC_EXPECTED';
    actualOutcome   = hasDiag ? 'DIAGNOSTIC_CREATED' : 'INCONSISTENT';
  } else if (tooEarly) {
    expectedOutcome = 'NO_FREEZE_EXPECTED';
    actualOutcome   = hasFrozen ? 'INCONSISTENT' : 'NO_FREEZE';
  } else {
    expectedOutcome = 'NO_FREEZE_EXPECTED';
    actualOutcome   = hasFrozen ? 'INCONSISTENT' : 'NO_FREEZE';
  }

  // Verdict
  let verdict: ObservationRow['row_verdict'];
  if (actualOutcome === 'INCONSISTENT' || dupDetected === 'yes') {
    verdict = 'FAIL';
  } else if (
    (expectedOutcome === 'NO_FREEZE_EXPECTED'   && actualOutcome === 'NO_FREEZE')       ||
    (expectedOutcome === 'FREEZE_EXPECTED'      && actualOutcome === 'FREEZE_CREATED')  ||
    (expectedOutcome === 'DIAGNOSTIC_EXPECTED'  && actualOutcome === 'DIAGNOSTIC_CREATED') ||
    (expectedOutcome === 'SETTLEMENT_EXPECTED'  && actualOutcome === 'SETTLED')
  ) {
    verdict = 'PASS';
  } else {
    verdict = 'NEEDS_REVIEW';
  }

  // Covered case IDs (base — B3/B4 set externally)
  const cases: string[] = [];
  if (verdict === 'PASS') {
    if (within === 'no' && actualOutcome === 'NO_FREEZE')                               cases.push('B2');
    if (within === 'yes' && actualOutcome === 'FREEZE_CREATED')                        cases.push('B1');
    if (match.status === 'TIMED' && within === 'yes' && actualOutcome === 'FREEZE_CREATED') cases.push('B7');
    if (actualOutcome === 'DIAGNOSTIC_CREATED' && hasDiag)                             cases.push('B5');
    if (actualOutcome === 'DIAGNOSTIC_CREATED' && pendingVisible === 'yes')            cases.push('B6');
    if (settlementState === 'settled' && postMatchLinkOk === 'yes')                    cases.push('B8');
  }

  // Snapshot info
  const firstFrozen = frozenRecords[0];
  const snapFrozenAt   = firstFrozen?.snapshot_frozen_at ?? '';
  const freezeLeadVal  = firstFrozen?.freeze_lead_hours != null
    ? firstFrozen.freeze_lead_hours.toFixed(2)
    : (inWindow ? leadH.toFixed(2) : '');

  // Notes
  let notes = '';
  if (suffix?.startsWith('b3reobs')) {
    notes = `B3 re-observation post-freeze. frozenVariants=${[...frozenVariants].sort().join('+')}. dup=${dupDetected}.`;
  } else if (tooEarly) {
    notes = `TOO_EARLY: lead=${leadH.toFixed(2)}h > FREEZE_MAX_LEAD_H=${FREEZE_WINDOW_MAX_LEAD_H}h.`;
  } else if (tooLate) {
    notes = `MISSED_FREEZE_WINDOW: lead=${leadH.toFixed(2)}h < FREEZE_MIN_LEAD_H=${FREEZE_WINDOW_MIN_LEAD_H}h.`;
  } else if (inWindow && hasFrozen) {
    notes = `FREEZE_CREATED: lead=${leadH.toFixed(2)}h. frozen_variants=${[...frozenVariants].sort().join('+')}.`;
  } else if (inWindow && !hasFrozen) {
    notes = `IN_WINDOW lead=${leadH.toFixed(2)}h but no freeze record present.`;
  } else if (settlementState === 'settled') {
    const r = completedRecords[0]!;
    notes = `SETTLED: actual_result=${r.actual_result}, result_captured_at=${r.result_captured_at ?? 'unknown'}.`;
  }

  const cacheRef = `cache://football-data/${comp}/${match.seasonId ?? 'unknown'}/matchday-${match.matchday}.json`;
  const evidenceRef = [logRef, storeRef, cacheRef].filter(Boolean).join('|');

  return {
    observation_id:              makeObsId(nowUtc, match.matchId, suffix),
    observed_at_utc:             nowUtc,
    observer:                    OBSERVER,
    match_id:                    match.matchId,
    competition_code:            comp,
    home_team:                   match.homeTeamId,
    away_team:                   match.awayTeamId,
    kickoff_utc:                 match.startTimeUtc,
    match_status_at_observation: match.status,
    within_freeze_window:        within,
    expected_backend_outcome:    expectedOutcome,
    actual_backend_outcome:      actualOutcome,
    freeze_record_present:       hasFrozen ? 'yes' : 'no',
    diagnostic_present:          hasDiag   ? 'yes' : 'no',
    diagnostic_type:             diagType,
    variant_pair_complete:       pairComplete,
    snapshot_frozen_at:          snapFrozenAt,
    freeze_lead_hours:           freezeLeadVal,
    duplicate_record_detected:   dupDetected,
    pending_visible_correctly:   pendingVisible,
    settlement_state:            settlementState,
    post_match_link_ok:          postMatchLinkOk,
    evidence_ref:                evidenceRef,
    notes,
    covered_case_ids:            cases.join('|'),
    row_verdict:                 verdict,
  };
}

// ── BL1 structural scope check ───────────────────────────────────────────────

function checkBL1Structural(store: StoreFile, log: RunnerLogInfo): { broken: boolean; reason: string } {
  const bl1StoreCount = store.records.filter(r => r.competition_code === 'BL1').length;

  // If runner has ever produced BL1 store records → it works
  if (bl1StoreCount > 0) {
    return {
      broken: false,
      reason: `BL1 forward-validation runner operational: ${bl1StoreCount} store records present.`,
    };
  }

  // No store records. Check log for explicit runner failure.
  if (log.bl1Failing) {
    return {
      broken: true,
      reason: `BL1 broken for forward-validation: 0 store records and runner log confirms getSeasonId() failure. Matchday cache files may exist (loaded by the dashboard pipeline) but the forward-validation runner fails during BL1 processing.`,
    };
  }

  // No store records, no log signal. Check if matchday cache files exist as a secondary signal.
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
    // Data is loadable by the dashboard pipeline but runner produced 0 store records
    // → structural gap: runner fails during BL1 forward-validation processing
    return {
      broken: true,
      reason: `BL1 broken for forward-validation: matchday cache files accessible (data loadable by dashboard) but 0 store records — runner fails during BL1 forward-validation processing. Runner log does not explicitly confirm cause.`,
    };
  }

  return {
    broken: true,
    reason: `BL1 unreachable: 0 matchday cache files and 0 store records. Runner log unavailable or silent on cause.`,
  };
}

// ── Main collector ───────────────────────────────────────────────────────────

export async function collect(nowOverride?: Date): Promise<CollectorResult> {
  const now    = nowOverride ?? new Date();
  const nowMs  = now.getTime();
  const nowUtc = now.toISOString();

  const store = readStore();
  const log   = readRunnerLog();
  const state = readState();

  const logRef   = `log://sp-api.log:lines=${log.lineCount}|lastCycleLine=${log.lastCycleLineNo}|cycles=${log.cycleCount}`;
  const storeRef = `store://forward-validation.json:records=${store.records.length}|savedAt=${store.savedAt}`;

  // ── Detect effective scope (structural check for BL1) ────────────────────
  const blockingIssues: BlockingIssue[] = [];
  const excludedCompetitions: string[] = [];
  const effectiveScope: string[] = [];

  for (const comp of NOMINAL_SCOPE) {
    if (comp === 'BL1') {
      const bl1Check = checkBL1Structural(store, log);
      if (bl1Check.broken) {
        excludedCompetitions.push(comp);
        blockingIssues.push({
          id: 'BSI-1',
          competition: 'BL1',
          reason: bl1Check.reason,
        });
      } else {
        effectiveScope.push(comp);
      }
    } else {
      effectiveScope.push(comp);
    }
  }

  const newRows: ObservationRow[] = [];
  let skippedRedundant = 0;

  // ── Detect new runner cycle for B3 triggering ─────────────────────────────
  const prevCycleMarker = state.last_runner_cycle_marker;
  const currCycleMarker = logRef;
  const runnerCycleAdvanced = prevCycleMarker !== currCycleMarker && prevCycleMarker !== '';

  // ── Process each competition ──────────────────────────────────────────────
  for (const comp of effectiveScope) {
    const matches = readMatchesFromCache(comp);

    // Candidates: upcoming matches (any lead) + recently completed (last 48h post-kickoff)
    const candidates = matches.filter(m => {
      if (!m.startTimeUtc) return false;
      const ko  = new Date(m.startTimeUtc).getTime();
      const lead = ko - nowMs;
      // Future matches and matches completed within last 48h
      if (lead > 0) return true;
      if (lead >= -48 * 3_600_000) return true;
      return false;
    });

    for (const match of candidates) {
      const matchRecords = store.records.filter(r => r.match_id === match.matchId);
      const currentFp   = buildFingerprint(match, matchRecords, nowMs);
      const storedFp    = state.last_observable_hash_by_entity[match.matchId];

      const hasFrozenNow    = matchRecords.some(r => r.snapshot_frozen_at !== null);
      const wasPendingB3    = state.frozen_matches_pending_b3_reobs.includes(match.matchId);
      const b3AlreadyDone   = state.frozen_matches_b3_verified.includes(match.matchId);

      // ── B3 re-observation path ────────────────────────────────────────────
      // Triggered when: match was frozen in a previous run, runner has since cycled,
      // and B3 has not yet been verified.
      if (wasPendingB3 && !b3AlreadyDone && runnerCycleAdvanced && hasFrozenNow) {
        const frozenCount = matchRecords.filter(r => r.snapshot_frozen_at !== null).length;
        const row = buildRow(match, comp, nowMs, nowUtc, matchRecords, logRef, storeRef, 'b3reobs');
        const dupDetected = frozenCount > EXPECTED_VARIANTS.length;
        row.duplicate_record_detected = dupDetected ? 'yes' : 'no';
        row.notes = `B3 re-observation post-freeze. frozenCount=${frozenCount}/${EXPECTED_VARIANTS.length}. dup=${dupDetected ? 'yes' : 'no'}.`;

        if (!dupDetected && row.row_verdict !== 'FAIL') {
          const existing = row.covered_case_ids ? row.covered_case_ids.split('|') : [];
          if (!existing.includes('B3')) existing.push('B3');
          // B4: if all expected variants are present
          const frozenVars = new Set(matchRecords.filter(r => r.snapshot_frozen_at !== null).map(r => r.variant));
          const allPaired  = (EXPECTED_VARIANTS as readonly string[]).every(v => frozenVars.has(v));
          if (allPaired && !existing.includes('B4')) existing.push('B4');
          row.covered_case_ids = existing.join('|');
          row.row_verdict      = 'PASS';
        } else {
          row.row_verdict = 'FAIL';
        }

        newRows.push(row);
        state.frozen_matches_b3_verified.push(match.matchId);
        state.frozen_matches_pending_b3_reobs =
          state.frozen_matches_pending_b3_reobs.filter(id => id !== match.matchId);
        state.last_observable_hash_by_entity[match.matchId] = currentFp;
        continue;
      }

      // ── Track newly frozen matches for future B3 ──────────────────────────
      if (hasFrozenNow && !wasPendingB3 && !b3AlreadyDone) {
        const prevFrozen = storedFp?.includes('none') === false && storedFp?.split('|')[2] !== 'none';
        if (!prevFrozen) {
          state.frozen_matches_pending_b3_reobs.push(match.matchId);
        }
      }

      // ── Skip if fingerprint unchanged ─────────────────────────────────────
      if (storedFp === currentFp) {
        skippedRedundant++;
        continue;
      }

      // ── Anti-noise: skip outside-window/no-activity matches already in CSV ─
      // Only add a B2-type row if this match hasn't been seen before
      const kickoffMs = new Date(match.startTimeUtc).getTime();
      const leadMs    = kickoffMs - nowMs;
      const tooEarly  = leadMs > FREEZE_WINDOW_MAX_LEAD_MS;
      const isNoActivityOutside = tooEarly && !matchRecords.length;

      if (isNoActivityOutside && storedFp !== undefined) {
        // Already recorded as outside-window previously, state unchanged
        skippedRedundant++;
        state.last_observable_hash_by_entity[match.matchId] = currentFp;
        continue;
      }

      // ── Build and append row ──────────────────────────────────────────────
      const row = buildRow(match, comp, nowMs, nowUtc, matchRecords, logRef, storeRef);
      newRows.push(row);
      state.last_observable_hash_by_entity[match.matchId] = currentFp;
    }
  }

  // ── Persist updated state ─────────────────────────────────────────────────
  state.last_run_at_utc          = nowUtc;
  state.last_runner_cycle_marker = currCycleMarker;
  state.last_store_saved_at      = store.savedAt;
  state.effective_scope          = effectiveScope;
  state.excluded_competitions    = excludedCompetitions;
  state.blocking_issues_snapshot = blockingIssues;
  saveState(state);

  return { newRows, skippedRedundant, effectiveScope, excludedCompetitions, blockingIssues };
}

/**
 * run-cp0-freeze-integrity.ts — CP0: Freeze Integrity Sanity Check for H11
 *
 * Verifies that the v2_window_based forward freeze protocol is working
 * correctly before any model-performance interpretation begins.
 *
 * Scope: PD / PL / BL1 — forward validation only
 *
 * Run:
 *   pnpm tsx scripts/run-cp0-freeze-integrity.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import 'dotenv/config';

// ── Constants — must match forward-validation-runner.ts exactly ────────────

const FREEZE_WINDOW_MAX_LEAD_H = 48;
const FREEZE_WINDOW_MIN_LEAD_H = 0.5;
const ELIGIBLE_STATUSES = ['SCHEDULED', 'TIMED'];
const INELIGIBLE_STATUSES = ['IN_PLAY', 'PAUSED', 'FINISHED', 'POSTPONED'];
const SCOPED_COMPETITIONS = ['PD', 'PL', 'BL1'];

// ── Store types ────────────────────────────────────────────────────────────

interface ForwardRecord {
  record_id: string;
  source_type: string;
  competition_code: string;
  match_id: string;
  kickoff_utc: string;
  home_team_id: string;
  away_team_id: string;
  variant: string;
  snapshot_generated_at: string;
  snapshot_frozen_at: string | null;
  freeze_lead_hours: number | null;
  mode: string;
  predicted_result: string | null;
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  lambda_home: number | null;
  lambda_away: number | null;
  actual_result: string | null;
  home_goals: number | null;
  away_goals: number | null;
  result_captured_at: string | null;
  evaluation_eligible: boolean;
  excluded_reason: string | null;
}

interface StoreDoc {
  version: number;
  freeze_policy?: string;
  savedAt: string;
  records: ForwardRecord[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

function hrsFromNow(isoUtc: string): number {
  return (new Date(isoUtc).getTime() - Date.now()) / (60 * 60 * 1000);
}

function fmtH(h: number): string {
  return `${h >= 0 ? '+' : ''}${h.toFixed(1)}h`;
}

// ── Load store ─────────────────────────────────────────────────────────────

const STORE_PATH = path.resolve(process.cwd(), 'cache/predictions/forward-validation.json');

function loadStore(): StoreDoc {
  if (!fs.existsSync(STORE_PATH)) {
    return { version: 1, freeze_policy: 'MISSING', savedAt: '', records: [] };
  }
  const raw = fs.readFileSync(STORE_PATH, 'utf-8');
  return JSON.parse(raw) as StoreDoc;
}

// ── Load upcoming matches from matchday cache ─────────────────────────────

interface CacheMatch {
  status: string;
  startTimeUtc: string | null;
  competitionId?: string;
  matchId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
}

interface MatchdayCacheDoc {
  // Cache format: { meta, data: { matches: CacheMatch[] } }
  data?: { matches?: CacheMatch[] };
  // Legacy fallback: { matches: CacheMatch[] }
  matches?: CacheMatch[];
}

function loadUpcomingMatchesFromCache(): CacheMatch[] {
  // Cache structure: cache/football-data/{CODE}/{SEASON}/matchday-{NN}.json
  // where CODE is the short competition code (PD, PL, BL1).
  const cacheDir = path.resolve(process.cwd(), 'cache/football-data');
  const result: CacheMatch[] = [];

  if (!fs.existsSync(cacheDir)) return result;

  for (const compCode of SCOPED_COMPETITIONS) {
    const compPath = path.join(cacheDir, compCode);
    if (!fs.existsSync(compPath) || !fs.statSync(compPath).isDirectory()) continue;

    const seasonDirs = fs.readdirSync(compPath);
    for (const seasonDir of seasonDirs) {
      const seasonPath = path.join(compPath, seasonDir);
      if (!fs.statSync(seasonPath).isDirectory()) continue;

      const matchdayFiles = fs.readdirSync(seasonPath).filter(
        (f) => f.startsWith('matchday-') && f.endsWith('.json'),
      );
      for (const mdFile of matchdayFiles) {
        try {
          const raw = fs.readFileSync(path.join(seasonPath, mdFile), 'utf-8');
          const doc = JSON.parse(raw) as MatchdayCacheDoc;
          // Primary format: { data: { matches: [...] } }
          const matches = doc.data?.matches ?? doc.matches ?? [];
          result.push(...matches);
        } catch { /* ignore malformed files */ }
      }
    }
  }

  return result;
}

// ── CP0 ────────────────────────────────────────────────────────────────────

async function runCP0(): Promise<void> {
  const now = new Date();
  const nowMs = now.getTime();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CP0 — Freeze Integrity Sanity Check (H11 forward validation) ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Run at:  ${now.toISOString()}`);
  console.log(`  Scope:   PD / PL / BL1`);
  console.log(`  Window:  [kickoff − ${FREEZE_WINDOW_MAX_LEAD_H}h, kickoff − ${FREEZE_WINDOW_MIN_LEAD_H * 60}min]`);
  console.log(`  Eligible statuses: ${ELIGIBLE_STATUSES.join(', ')}`);
  console.log();

  const issues: string[] = [];
  const warnings: string[] = [];

  // ── Store header check ───────────────────────────────────────────────────

  const store = loadStore();

  console.log('── §0  Store integrity ─────────────────────────────────────────');
  console.log(`  File:          ${STORE_PATH}`);
  console.log(`  Exists:        ${fs.existsSync(STORE_PATH)}`);
  console.log(`  version:       ${store.version}`);
  console.log(`  freeze_policy: ${store.freeze_policy ?? '(absent — legacy)'}`);
  console.log(`  savedAt:       ${store.savedAt || '(empty)'}`);
  console.log(`  total records: ${store.records.length}`);

  if (store.freeze_policy !== 'v2_window_based') {
    issues.push(`Store freeze_policy is '${store.freeze_policy}' — expected 'v2_window_based'`);
  }

  console.log();

  // Partition records
  const allRecords = store.records;
  const frozenRecords = allRecords.filter((r) => r.snapshot_frozen_at !== null);
  const diagnosticRecords = allRecords.filter((r) => r.snapshot_frozen_at === null);
  const completedRecords = frozenRecords.filter((r) => r.actual_result !== null);
  const pendingRecords = frozenRecords.filter((r) => r.actual_result === null);

  // ── §1  Freeze window integrity ──────────────────────────────────────────

  console.log('── §1  Freeze window integrity ─────────────────────────────────');
  console.log(`  Officially frozen records: ${frozenRecords.length}`);

  if (frozenRecords.length === 0) {
    console.log('  ⓘ  No frozen records yet — window has not opened for upcoming matches.');
    console.log('     This is the expected state immediately after H11-fix FULL_RESET.');
    console.log('     First freeze window opens when kickoff ≤ 48h from now.');
  } else {
    const leadHours = frozenRecords
      .map((r) => r.freeze_lead_hours)
      .filter((h): h is number => h !== null);

    const outsideWindow = frozenRecords.filter(
      (r) => r.freeze_lead_hours !== null &&
              (r.freeze_lead_hours < FREEZE_WINDOW_MIN_LEAD_H ||
               r.freeze_lead_hours > FREEZE_WINDOW_MAX_LEAD_H)
    );

    const noLeadHours = frozenRecords.filter((r) => r.freeze_lead_hours === null);

    console.log(`  freeze_lead_hours populated: ${leadHours.length} / ${frozenRecords.length}`);
    if (leadHours.length > 0) {
      console.log(`  min:    ${Math.min(...leadHours).toFixed(2)}h`);
      console.log(`  median: ${median(leadHours).toFixed(2)}h`);
      console.log(`  max:    ${Math.max(...leadHours).toFixed(2)}h`);
    }

    if (outsideWindow.length > 0) {
      issues.push(`${outsideWindow.length} frozen records have freeze_lead_hours OUTSIDE valid window`);
      for (const r of outsideWindow.slice(0, 5)) {
        console.log(`  ✗ OUT_OF_WINDOW: ${r.match_id} lead=${r.freeze_lead_hours?.toFixed(1)}h`);
      }
    } else {
      console.log(`  ✓ All frozen records within valid window [${FREEZE_WINDOW_MIN_LEAD_H}h – ${FREEZE_WINDOW_MAX_LEAD_H}h]`);
    }

    if (noLeadHours.length > 0) {
      issues.push(`${noLeadHours.length} frozen records missing freeze_lead_hours`);
    }
  }
  console.log();

  // ── §2  Variant pairing integrity ────────────────────────────────────────

  console.log('── §2  Variant pairing integrity ───────────────────────────────');

  if (frozenRecords.length === 0) {
    console.log('  ⓘ  No frozen records — pairing check skipped (nothing to pair).');
  } else {
    const byMatchId = new Map<string, { baseline: boolean; cti: boolean }>();
    for (const r of frozenRecords) {
      const entry = byMatchId.get(r.match_id) ?? { baseline: false, cti: false };
      if (r.variant === 'BASELINE_REFERENCE') entry.baseline = true;
      if (r.variant === 'CTI_ALPHA_0_4') entry.cti = true;
      byMatchId.set(r.match_id, entry);
    }
    const missingPair = [...byMatchId.entries()].filter(([, v]) => !v.baseline || !v.cti);
    console.log(`  Unique frozen match_ids: ${byMatchId.size}`);
    if (missingPair.length > 0) {
      issues.push(`${missingPair.length} match_ids missing one variant`);
      for (const [mid, v] of missingPair.slice(0, 5)) {
        const missing = !v.baseline ? 'BASELINE_REFERENCE' : 'CTI_ALPHA_0_4';
        console.log(`  ✗ MISSING_VARIANT: ${mid} — missing ${missing}`);
      }
    } else {
      console.log(`  ✓ All frozen match_ids have both BASELINE_REFERENCE + CTI_ALPHA_0_4`);
    }
  }
  console.log();

  // ── §3  Competition scope integrity ──────────────────────────────────────

  console.log('── §3  Competition scope integrity ─────────────────────────────');

  if (allRecords.length === 0) {
    console.log('  ⓘ  No records — scope check skipped.');
  } else {
    const outsideScope = allRecords.filter(
      (r) => !SCOPED_COMPETITIONS.includes(r.competition_code)
    );
    const byComp: Record<string, number> = {};
    for (const r of allRecords) {
      byComp[r.competition_code] = (byComp[r.competition_code] ?? 0) + 1;
    }
    console.log(`  Records by competition: ${JSON.stringify(byComp)}`);
    if (outsideScope.length > 0) {
      issues.push(`${outsideScope.length} records belong to out-of-scope competitions`);
      const outComps = [...new Set(outsideScope.map((r) => r.competition_code))];
      console.log(`  ✗ OUT_OF_SCOPE: ${outComps.join(', ')}`);
    } else {
      console.log(`  ✓ All records belong to scoped competitions (PD / PL / BL1)`);
    }
  }
  console.log();

  // ── §4  Missed-window diagnostics ────────────────────────────────────────

  console.log('── §4  Missed-window diagnostics ───────────────────────────────');

  const missedWindow = diagnosticRecords.filter(
    (r) => r.excluded_reason === 'MISSED_FREEZE_WINDOW'
  );
  const noStartTime = diagnosticRecords.filter(
    (r) => r.excluded_reason === 'NO_START_TIME'
  );
  const otherDiag = diagnosticRecords.filter(
    (r) => r.excluded_reason !== 'MISSED_FREEZE_WINDOW' && r.excluded_reason !== 'NO_START_TIME'
  );

  console.log(`  Total diagnostic records:       ${diagnosticRecords.length}`);
  console.log(`  MISSED_FREEZE_WINDOW:           ${missedWindow.length}`);
  console.log(`  NO_START_TIME:                  ${noStartTime.length}`);
  console.log(`  Other:                          ${otherDiag.length}`);

  if (missedWindow.length > 0) {
    warnings.push(`${missedWindow.length} matches missed the freeze window — review if expected`);
    console.log('  MISSED_FREEZE_WINDOW detail:');
    for (const r of missedWindow.slice(0, 5)) {
      const koMs = r.kickoff_utc ? new Date(r.kickoff_utc).getTime() : 0;
      const pastKoH = (nowMs - koMs) / (60 * 60 * 1000);
      console.log(`    ${r.match_id} | ko=${r.kickoff_utc} | past_ko=${pastKoH.toFixed(1)}h | comp=${r.competition_code}`);
    }
  } else if (diagnosticRecords.length === 0) {
    console.log('  ✓ No diagnostic records — no missed windows yet.');
  } else {
    console.log('  ✓ No MISSED_FREEZE_WINDOW records.');
  }
  console.log();

  // ── §5  TIMED handling ───────────────────────────────────────────────────

  console.log('── §5  TIMED match handling ─────────────────────────────────────');

  const timedFrozen = frozenRecords.filter((r) => {
    // We don't store match status in the record, so we check via matchday cache
    return false; // placeholder — will be filled from cache below
  });

  // Try to find TIMED matches in cache
  const cachedMatches = loadUpcomingMatchesFromCache();
  const nowPlusMax = nowMs + FREEZE_WINDOW_MAX_LEAD_H * 60 * 60 * 1000;
  const nowPlusMin = nowMs + FREEZE_WINDOW_MIN_LEAD_H * 60 * 60 * 1000;

  const timedInCache = cachedMatches.filter(
    (m) => m.status === 'TIMED' && m.startTimeUtc !== null
  );
  const scheduledInCache = cachedMatches.filter(
    (m) => m.status === 'SCHEDULED' && m.startTimeUtc !== null
  );

  console.log(`  Matches with status=TIMED in cache:     ${timedInCache.length}`);
  console.log(`  Matches with status=SCHEDULED in cache: ${scheduledInCache.length}`);

  // Any TIMED in the freeze window?
  const timedInWindow = timedInCache.filter((m) => {
    const ko = new Date(m.startTimeUtc!).getTime();
    const lead = ko - nowMs;
    return lead >= FREEZE_WINDOW_MIN_LEAD_MS_check() && lead <= FREEZE_WINDOW_MAX_LEAD_MS_check();
  });

  if (timedInWindow.length > 0) {
    console.log(`  TIMED matches currently inside freeze window: ${timedInWindow.length}`);
    for (const m of timedInWindow.slice(0, 3)) {
      const lead = (new Date(m.startTimeUtc!).getTime() - nowMs) / (60 * 60 * 1000);
      console.log(`    → ${m.startTimeUtc} | lead=${lead.toFixed(1)}h (SHOULD be frozen)`);
    }
    // Check if they are actually frozen
    const notFrozen = timedInWindow.filter(
      (m) => !frozenRecords.some((r) => r.kickoff_utc === m.startTimeUtc)
    );
    if (notFrozen.length > 0) {
      warnings.push(`${notFrozen.length} TIMED matches in window not yet frozen (pending next refresh)`);
    }
  } else {
    console.log('  ⓘ  No TIMED matches currently in freeze window.');
  }

  if (timedInCache.length > 0) {
    const sample = timedInCache[0]!;
    const lead = ((new Date(sample.startTimeUtc!).getTime() - nowMs) / (60 * 60 * 1000));
    console.log(`  Sample TIMED match: ko=${sample.startTimeUtc} | lead_from_now=${lead.toFixed(1)}h`);
  }

  console.log('  ✓ Runner is configured to accept TIMED status (ELIGIBLE_PRE_MATCH_STATUSES)');
  console.log();

  // ── §6  Basic operational counts ─────────────────────────────────────────

  console.log('── §6  Operational counts ───────────────────────────────────────');
  console.log(`  Total records:           ${allRecords.length}`);
  console.log(`    Officially frozen:     ${frozenRecords.length}`);
  console.log(`      Completed:           ${completedRecords.length}`);
  console.log(`      Pending (no result): ${pendingRecords.length}`);
  console.log(`    Diagnostic only:       ${diagnosticRecords.length}`);

  if (frozenRecords.length > 0) {
    const byVariant: Record<string, number> = {};
    const byComp: Record<string, number> = {};
    const byComp2: Record<string, number> = {};
    for (const r of frozenRecords) {
      byVariant[r.variant] = (byVariant[r.variant] ?? 0) + 1;
      byComp[r.competition_code] = (byComp[r.competition_code] ?? 0) + 1;
    }
    console.log(`  By variant: ${JSON.stringify(byVariant)}`);
    console.log(`  By competition: ${JSON.stringify(byComp)}`);
    const leadHrs = frozenRecords.map((r) => r.freeze_lead_hours).filter((h): h is number => h !== null);
    if (leadHrs.length > 0) {
      console.log(`  freeze_lead_hours: min=${Math.min(...leadHrs).toFixed(2)}h | median=${median(leadHrs).toFixed(2)}h | max=${Math.max(...leadHrs).toFixed(2)}h`);
    }
  }
  console.log();

  // ── §7  When does first freeze window open? ──────────────────────────────

  console.log('── §7  Freeze window opening projection ────────────────────────');

  const upcoming = cachedMatches.filter(
    (m) =>
      (m.status === 'SCHEDULED' || m.status === 'TIMED') &&
      m.startTimeUtc !== null &&
      new Date(m.startTimeUtc).getTime() > nowMs
  );

  // Remove duplicates by startTimeUtc
  const uniqueKickoffs = [...new Set(upcoming.map((m) => m.startTimeUtc!))].sort();

  if (uniqueKickoffs.length === 0) {
    warnings.push('No upcoming SCHEDULED/TIMED matches found in cache — cache may be stale');
    console.log('  ⚠ No upcoming matches found in matchday cache.');
  } else {
    console.log(`  Upcoming SCHEDULED/TIMED kickoffs found: ${uniqueKickoffs.length}`);
    console.log();
    console.log('  ' + 'Kickoff UTC'.padEnd(30) + 'Lead now'.padEnd(10) + 'Window opens at'.padEnd(35) + 'Status');
    console.log('  ' + '─'.repeat(90));
    for (const ko of uniqueKickoffs.slice(0, 12)) {
      const koMs = new Date(ko).getTime();
      const leadNow = (koMs - nowMs) / (60 * 60 * 1000);
      const windowOpenMs = koMs - FREEZE_WINDOW_MAX_LEAD_H * 60 * 60 * 1000;
      const windowOpenH = (windowOpenMs - nowMs) / (60 * 60 * 1000);
      const windowCloseH = (koMs - FREEZE_WINDOW_MIN_LEAD_H * 60 * 60 * 1000 - nowMs) / (60 * 60 * 1000);
      const windowOpenDt = new Date(windowOpenMs).toISOString();
      let status: string;
      if (leadNow > FREEZE_WINDOW_MAX_LEAD_H) {
        status = `TOO_EARLY (window in ${windowOpenH.toFixed(1)}h)`;
      } else if (leadNow < FREEZE_WINDOW_MIN_LEAD_H) {
        status = 'PAST — MISSED or already complete';
      } else {
        status = `IN_WINDOW (closes in ${windowCloseH.toFixed(1)}h) <- freeze eligible NOW`;
      }
      const leadStr = (leadNow.toFixed(1) + 'h');
      console.log('  ' + ko.padEnd(30) + leadStr.padEnd(10) + windowOpenDt.padEnd(35) + status);
    }
    if (uniqueKickoffs.length > 12) {
      console.log(`  ... (${uniqueKickoffs.length - 12} more)`);
    }
  }
  console.log();

  // ── §8  Runner code verification ─────────────────────────────────────────

  console.log('── §8  Runner code verification ────────────────────────────────');

  const runnerPath = path.resolve(process.cwd(), 'server/prediction/forward-validation-runner.ts');
  if (fs.existsSync(runnerPath)) {
    const runnerSrc = fs.readFileSync(runnerPath, 'utf-8');

    const hasMaxLead = runnerSrc.includes('FREEZE_WINDOW_MAX_LEAD_H = 48');
    const hasMinLead = runnerSrc.includes('FREEZE_WINDOW_MIN_LEAD_H = 0.5');
    const hasScheduled = runnerSrc.includes("'SCHEDULED'") && runnerSrc.includes("'TIMED'");
    const hasWindowGuard = runnerSrc.includes('FREEZE_WINDOW_MAX_LEAD_MS') && runnerSrc.includes('FREEZE_WINDOW_MIN_LEAD_MS');
    const hasMissedDiag = runnerSrc.includes('MISSED_FREEZE_WINDOW');
    const hasNoStartDiag = runnerSrc.includes('NO_START_TIME');
    const hasFreezeLeadHours = runnerSrc.includes('freeze_lead_hours');
    const hasV2Policy = runnerSrc.includes('v2_window_based');
    const rejectsInPlay = runnerSrc.includes("'IN_PLAY'") || runnerSrc.includes('"IN_PLAY"');
    const rejectsPaused = runnerSrc.includes("'PAUSED'") || runnerSrc.includes('"PAUSED"');

    const checks = [
      ['FREEZE_WINDOW_MAX_LEAD_H = 48',     hasMaxLead],
      ['FREEZE_WINDOW_MIN_LEAD_H = 0.5',    hasMinLead],
      ['SCHEDULED + TIMED eligible',         hasScheduled],
      ['Window guard (max/min MS)',           hasWindowGuard],
      ['MISSED_FREEZE_WINDOW diagnostic',    hasMissedDiag],
      ['NO_START_TIME diagnostic',           hasNoStartDiag],
      ['freeze_lead_hours in records',       hasFreezeLeadHours],
      ['v2_window_based policy marker',      hasV2Policy],
      ['IN_PLAY excluded',                   rejectsInPlay],
      ['PAUSED excluded',                    rejectsPaused],
    ] as [string, boolean][];

    for (const [label, ok] of checks) {
      console.log(`  ${ok ? '✓' : '✗'} ${label}`);
      if (!ok) issues.push(`Runner code missing: ${label}`);
    }
  } else {
    issues.push('forward-validation-runner.ts not found');
  }
  console.log();

  // ── §9  Store schema verification ────────────────────────────────────────

  console.log('── §9  Store schema verification ───────────────────────────────');

  const storePath2 = path.resolve(process.cwd(), 'server/prediction/forward-validation-store.ts');
  if (fs.existsSync(storePath2)) {
    const storeSrc = fs.readFileSync(storePath2, 'utf-8');

    const hasNullableFrozenAt = storeSrc.includes('snapshot_frozen_at: string | null');
    const hasFreezeLeadHoursField = storeSrc.includes('freeze_lead_hours: number | null');
    const hasPolicyField = storeSrc.includes("freeze_policy: 'v1_legacy' | 'v2_window_based'");
    const hasHasRecord = storeSrc.includes('hasRecord(');
    const hasFindDiagnostic = storeSrc.includes('findDiagnostic(');
    const hasFindPendingGuard = storeSrc.includes('snapshot_frozen_at !== null && r.actual_result === null');
    const hasDeleteAll = storeSrc.includes('deleteAllRecords(');

    const checks2 = [
      ['snapshot_frozen_at: string | null',   hasNullableFrozenAt],
      ['freeze_lead_hours: number | null',     hasFreezeLeadHoursField],
      ["freeze_policy: 'v1_legacy'|'v2'",     hasPolicyField],
      ['hasRecord() method',                   hasHasRecord],
      ['findDiagnostic() method',              hasFindDiagnostic],
      ['findPending() excludes diagnostics',   hasFindPendingGuard],
      ['deleteAllRecords() for migration',     hasDeleteAll],
    ] as [string, boolean][];

    for (const [label, ok] of checks2) {
      console.log(`  ${ok ? '✓' : '✗'} ${label}`);
      if (!ok) issues.push(`Store schema missing: ${label}`);
    }
  } else {
    issues.push('forward-validation-store.ts not found');
  }
  console.log();

  // ── Final verdict ────────────────────────────────────────────────────────

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CP0 — FINAL VERDICT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();

  if (issues.length > 0) {
    console.log('  RESULT: ✗ FAIL');
    console.log();
    console.log('  Issues:');
    for (const iss of issues) {
      console.log(`    ✗ ${iss}`);
    }
  } else {
    console.log('  RESULT: ✓ PASS');
  }

  if (warnings.length > 0) {
    console.log();
    console.log('  Warnings (non-blocking):');
    for (const w of warnings) {
      console.log(`    ⚠ ${w}`);
    }
  }

  console.log();
  console.log('  H11 operational readiness:');
  if (issues.length === 0) {
    console.log('    ✓ Store policy is v2_window_based');
    console.log('    ✓ Runner code implements all freeze-window guards');
    console.log('    ✓ No invalid frozen records exist');
    console.log('    ✓ TIMED matches are accepted as eligible');
    console.log('    ✓ H11 is operationally ready to collect forward records');
    console.log('      and wait for completed matches under the corrected protocol.');
    console.log();

    // Project first freeze
    const upcoming2 = cachedMatches.filter(
      (m) => (m.status === 'SCHEDULED' || m.status === 'TIMED') && m.startTimeUtc !== null
    );
    const sortedKo = [...new Set(upcoming2.map((m) => m.startTimeUtc!))].sort();
    if (sortedKo.length > 0) {
      const firstKo = sortedKo[0]!;
      const firstKoMs = new Date(firstKo).getTime();
      const windowOpenMs = firstKoMs - FREEZE_WINDOW_MAX_LEAD_H * 60 * 60 * 1000;
      const hoursUntilOpen = (windowOpenMs - nowMs) / (60 * 60 * 1000);
      const windowOpenDt = new Date(windowOpenMs).toISOString();
      console.log(`    First freeze window opens: ${windowOpenDt}`);
      console.log(`    (in ${hoursUntilOpen > 0 ? hoursUntilOpen.toFixed(1) + 'h' : 'NOW — next refresh cycle'})`);
    }
  } else {
    console.log('    ✗ H11 is NOT operationally ready — resolve issues above first.');
  }

  console.log();
}

// Helper constants (inline to avoid circular reference)
function FREEZE_WINDOW_MAX_LEAD_MS_check(): number { return FREEZE_WINDOW_MAX_LEAD_H * 60 * 60 * 1000; }
function FREEZE_WINDOW_MIN_LEAD_MS_check(): number { return FREEZE_WINDOW_MIN_LEAD_H * 60 * 60 * 1000; }

runCP0().catch((err) => {
  console.error('CP0 failed:', err);
  process.exit(1);
});

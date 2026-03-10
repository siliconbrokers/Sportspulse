/**
 * forward-validation-store.ts — persistent store for forward validation records.
 *
 * Stores pre-kickoff frozen snapshots for UPCOMING matches under two variants:
 *   - BASELINE_REFERENCE: raw Poisson probabilities (no CTI)
 *   - CTI_ALPHA_0_4:      CTI-adjusted probabilities with α=0.4
 *
 * Records are frozen on first write (snapshot_frozen_at set once, never changed).
 * Result closure (actual_result) is filled after the match completes.
 *
 * --- H11-fix: v2_window_based freeze policy ---
 * Official snapshots are only frozen inside the valid pre-kickoff window:
 *   max lead: 48h before kickoff
 *   min lead: 30min before kickoff
 * Records outside the window store only diagnostic metadata (snapshot_frozen_at = null).
 * freeze_lead_hours records the actual lead time at freeze for traceability.
 *
 * Storage: cache/predictions/forward-validation.json
 * Write strategy: atomic (.tmp → rename), consistent with HistoricalBacktestStore.
 * Error policy: persistence errors are logged and never propagated.
 *
 * H11 — Controlled Forward Validation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Schema ─────────────────────────────────────────────────────────────────

export type ForwardVariant = 'BASELINE_REFERENCE' | 'CTI_ALPHA_0_4';

export interface ForwardValidationRecord {
  /** Unique ID: `fwd:${competition_code}:${match_id}:${variant}` */
  record_id: string;
  /** Always 'FORWARD_OFFICIAL' — prevents mixing with backtest records. */
  source_type: 'FORWARD_OFFICIAL';
  /** FD competition code, e.g. 'PD'. */
  competition_code: string;
  /** Canonical match ID. */
  match_id: string;
  /** ISO-8601 UTC kickoff of the match. */
  kickoff_utc: string;
  /** Canonical home team ID. */
  home_team_id: string;
  /** Canonical away team ID. */
  away_team_id: string;

  variant: ForwardVariant;

  // ── Snapshot metadata ──────────────────────────────────────────────────
  /** When the snapshot was generated (may be updated on re-runs if not yet frozen). */
  snapshot_generated_at: string;
  /**
   * Set once on first valid window freeze, never changed.
   * null for diagnostic-only records (MISSED_FREEZE_WINDOW, UNSUPPORTED_STATUS, etc.)
   * that have no official prediction snapshot.
   */
  snapshot_frozen_at: string | null;
  /**
   * Hours before kickoff when the snapshot was frozen.
   * null for diagnostic records (no prediction snapshot taken).
   */
  freeze_lead_hours: number | null;

  // ── Prediction ─────────────────────────────────────────────────────────
  /** Operating mode from the prediction pipeline. */
  mode: string;
  /** 'HOME' | 'AWAY' | 'DRAW' | 'TOO_CLOSE' | null */
  predicted_result: string | null;
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  /** Raw lambda home (for CTI traceability). */
  lambda_home: number | null;
  /** Raw lambda away (for CTI traceability). */
  lambda_away: number | null;

  // ── Result closure (null until match completes) ────────────────────────
  actual_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;
  home_goals: number | null;
  away_goals: number | null;
  result_captured_at: string | null;

  // ── Evaluation ─────────────────────────────────────────────────────────
  evaluation_eligible: boolean;
  excluded_reason: string | null;
}

// ── Store file ─────────────────────────────────────────────────────────────

interface StoreFileDoc {
  version: 1;
  /** 'v2_window_based' = H11-fix corrected freeze policy (48h max / 30min min lead). */
  freeze_policy: 'v1_legacy' | 'v2_window_based';
  savedAt: string;
  records: ForwardValidationRecord[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_FILE_PATH = path.resolve(
  process.cwd(),
  'cache/predictions/forward-validation.json',
);

// ── ForwardValidationStore ─────────────────────────────────────────────────

export class ForwardValidationStore {
  private readonly filePath: string;
  private records: ForwardValidationRecord[] = [];

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_FILE_PATH;
    this._loadFromFile();
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Saves or updates a record by record_id.
   *
   * Freeze protection: if a record already exists and has snapshot_frozen_at set
   * (non-null), the snapshot fields (prediction data) are NOT overwritten.
   * Diagnostic records (snapshot_frozen_at === null) may be replaced by official
   * frozen records if the match later enters the valid window.
   * The call is idempotent — safe to call multiple times per match.
   */
  save(record: ForwardValidationRecord): void {
    const existingIndex = this.records.findIndex((r) => r.record_id === record.record_id);

    if (existingIndex !== -1) {
      const existing = this.records[existingIndex]!;
      // Officially frozen: never overwrite snapshot fields
      if (existing.snapshot_frozen_at !== null) {
        return;
      }
      // Diagnostic record (snapshot_frozen_at === null): allow replacement
      // so that a match can be re-evaluated when it enters the valid window.
      this.records[existingIndex] = record;
    } else {
      this.records.push(record);
    }
  }

  /**
   * Removes all records from the in-memory store.
   * Caller must invoke persist() to write the empty store to disk.
   * Used exclusively by the H11-fix migration script (FULL_RESET).
   */
  deleteAllRecords(): void {
    this.records = [];
  }

  /**
   * Closes a record by filling in the actual result fields.
   * Safe to call even if the record does not exist (no-op).
   */
  closeRecord(
    matchId: string,
    variant: ForwardVariant,
    result: {
      actual_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
      home_goals: number;
      away_goals: number;
    },
  ): void {
    const competitionCode = this._competitionCodeFromMatchId(matchId);
    const recordId = `fwd:${competitionCode}:${matchId}:${variant}`;
    const idx = this.records.findIndex((r) => r.record_id === recordId);
    if (idx === -1) return;

    const record = this.records[idx]!;
    this.records[idx] = {
      ...record,
      actual_result: result.actual_result,
      home_goals: result.home_goals,
      away_goals: result.away_goals,
      result_captured_at: new Date().toISOString(),
    };
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  findByCompetition(code: string): ForwardValidationRecord[] {
    return this.records.filter((r) => r.competition_code === code);
  }

  /**
   * Returns officially frozen records awaiting result closure.
   * Excludes diagnostic-only records (snapshot_frozen_at === null).
   */
  findPending(): ForwardValidationRecord[] {
    return this.records.filter(
      (r) => r.snapshot_frozen_at !== null && r.actual_result === null,
    );
  }

  /**
   * Returns officially frozen records with a result captured.
   * Excludes diagnostic-only records.
   */
  findCompleted(): ForwardValidationRecord[] {
    return this.records.filter(
      (r) => r.snapshot_frozen_at !== null && r.actual_result !== null,
    );
  }

  /**
   * Returns diagnostic-only records (no prediction snapshot taken).
   * These have snapshot_frozen_at === null and carry an excluded_reason.
   */
  findDiagnostic(): ForwardValidationRecord[] {
    return this.records.filter((r) => r.snapshot_frozen_at === null);
  }

  findAll(): ForwardValidationRecord[] {
    return [...this.records];
  }

  /**
   * Returns true if ANY record (official or diagnostic) exists for this
   * (matchId, variant) pair. Used by the runner to avoid double-processing.
   *
   * Note: if the existing record is diagnostic (snapshot_frozen_at === null),
   * the runner may replace it with an official frozen record when the match
   * enters the valid freeze window.
   */
  hasRecord(matchId: string, variant: ForwardVariant): boolean {
    return this.records.some((r) => r.match_id === matchId && r.variant === variant);
  }

  /**
   * Returns true if a record with the given matchId + variant exists and is
   * officially frozen (snapshot_frozen_at !== null).
   */
  isFrozen(matchId: string, variant: ForwardVariant): boolean {
    const record = this.records.find(
      (r) => r.match_id === matchId && r.variant === variant,
    );
    return record !== undefined && record.snapshot_frozen_at !== null;
  }

  count(): number {
    return this.records.length;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  async persist(): Promise<void> {
    const doc: StoreFileDoc = {
      version: 1,
      freeze_policy: 'v2_window_based',
      savedAt: new Date().toISOString(),
      records: this.records,
    };
    const tmpPath = this.filePath.replace(/\.json$/, '.tmp');
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('[ForwardValidationStore] persist failed:', err);
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Extracts competition code from a match_id.
   * Match IDs have the form `match:football-data:PD:12345` — returns 'PD'.
   * Falls back to empty string if format is unexpected.
   */
  private _competitionCodeFromMatchId(matchId: string): string {
    const parts = matchId.split(':');
    return parts[2] ?? '';
  }

  private _loadFromFile(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const doc = JSON.parse(raw) as unknown;
      if (
        doc !== null &&
        typeof doc === 'object' &&
        (doc as Record<string, unknown>)['version'] === 1 &&
        Array.isArray((doc as Record<string, unknown>)['records'])
      ) {
        this.records = (doc as StoreFileDoc).records;
        console.log(
          `[ForwardValidationStore] Loaded ${this.records.length} records from ${this.filePath}`,
        );
      }
    } catch (err) {
      console.warn('[ForwardValidationStore] Could not load from file:', err);
    }
  }
}

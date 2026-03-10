/**
 * EvaluationStore — persisted store for pre-kickoff evaluation records.
 *
 * Lifecycle model:
 *   PENDING          → match is in-scope (SCHEDULED), registered, no snapshot yet
 *   SNAPSHOT_FROZEN  → valid pre-kickoff snapshot attached; awaiting ground truth
 *   COMPLETE         → snapshot + ground truth captured (match FINISHED with valid score)
 *   EXCLUDED         → will not contribute to metrics (see excluded_reason)
 *
 * Uniqueness: one record per match_id, enforced at store level.
 * Freeze is permanent: once a record reaches SNAPSHOT_FROZEN, it cannot be overwritten
 * by a later snapshot.
 *
 * Storage: cache/predictions/evaluations.json
 * Write strategy: atomic (.tmp → rename), same pattern as PredictionStore.
 *
 * OE-1 + hardening — PE Observation & Evaluation Plan v1.1
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PredictionSnapshot } from './prediction-store.js';

// ── EvaluationRecord ──────────────────────────────────────────────────────────

/**
 * Lifecycle status of an evaluation record.
 *
 * Transitions:
 *   registerMatch()     → PENDING
 *   freezeSnapshot()    → SNAPSHOT_FROZEN  (if pre-kickoff snapshot exists)
 *                       → EXCLUDED/NO_PREGAME_SNAPSHOT (if snapshot is post-kickoff)
 *   captureGroundTruth()→ COMPLETE         (from SNAPSHOT_FROZEN)
 *                       → EXCLUDED/NO_PREGAME_SNAPSHOT (from PENDING, match FINISHED without snapshot)
 *   markAbnormalEnd()   → EXCLUDED/ABNORMAL_END
 */
export type RecordStatus = 'PENDING' | 'SNAPSHOT_FROZEN' | 'COMPLETE' | 'EXCLUDED';

/**
 * Why this record is excluded from metric denominators.
 * null = not excluded (evaluation_eligible may be true).
 *
 * Scoring eligibility rules per excluded_reason:
 *   null              → eligible (if COMPLETE + mode FULL/LIMITED + predicted_result not null)
 *   NOT_ELIGIBLE      → mode=NOT_ELIGIBLE; counted in coverage, excluded from accuracy+Brier
 *   NO_PREGAME_SNAPSHOT → no valid pre-kickoff snapshot existed; excluded from all metrics
 *   MISSING_PROBS     → snapshot exists but predicted_result is null; excluded from metrics
 *   ABNORMAL_END      → match CANCELED/POSTPONED; excluded from all metrics
 */
export type ExcludedReason =
  | 'NOT_ELIGIBLE'
  | 'NO_PREGAME_SNAPSHOT'
  | 'MISSING_PROBS'
  | 'ABNORMAL_END'
  | null;

export interface EvaluationRecord {
  // Identity
  match_id: string;
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_kickoff_utc: string;

  // Lifecycle
  record_status: RecordStatus;

  // Snapshot metadata (null when no snapshot available)
  snapshot_id: string | null;              // `eval:${match_id}:${snapshot_generated_at}` or null
  snapshot_frozen_at: string | null;       // when the evaluation record was frozen
  snapshot_generated_at: string | null;    // original snapshot generated_at (must be < kickoff)
  engine_version: string | null;
  spec_version: string | null;
  prediction_available: boolean;           // true only if valid pre-kickoff snapshot exists

  // Eligibility
  evaluation_eligible: boolean;           // true = usable in metric denominators right now
  excluded_reason: ExcludedReason;

  // Prediction content (null when prediction_available=false or mode=NOT_ELIGIBLE)
  mode: string;                           // FULL_MODE | LIMITED_MODE | NOT_ELIGIBLE | UNKNOWN
  calibration_mode: string | null;
  predicted_result: string | null;
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  reasons: string[];

  // Ground truth
  ground_truth_status: 'PENDING' | 'CAPTURED' | 'UNAVAILABLE';
  ground_truth_captured_at: string | null;
  final_home_goals: number | null;
  final_away_goals: number | null;
  actual_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;

  // Track A runtime observation (filled via observation log or manual inspection)
  ui_render_result:
    | 'NO_RENDER'
    | 'NOT_ELIGIBLE_RENDER'
    | 'LIMITED_MODE_RENDER'
    | 'FULL_MODE_RENDER'
    | null;
  ui_clear_or_confusing: 'CLEAR' | 'CONFUSING' | null;
  runtime_issue:
    | 'NONE'           // observed successfully
    | 'FETCH_ERROR'    // frontend fetch to /api/ui/predictions/experimental failed
    | 'SNAPSHOT_MISS'  // endpoint returned 404 (flag on, but no snapshot)
    | 'SCOPE_MISMATCH' // flag/competition mismatch
    | 'RENDER_CRASH'   // component crashed mid-render
    | 'OTHER'
    | null;
  runtime_notes: string | null;
}

// ── Match shape needed for store operations ───────────────────────────────────

export interface MatchForFreeze {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  startTimeUtc: string | null;
  status: string;
}

// ── File structure ─────────────────────────────────────────────────────────────

interface StoreFileDoc {
  version: 2;
  savedAt: string;
  records: EvaluationRecord[];
}

// ── Persistence path ──────────────────────────────────────────────────────────

const DEFAULT_FILE_PATH = path.resolve(process.cwd(), 'cache/predictions/evaluations.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractPredictionFields(snapshot: PredictionSnapshot): {
  predicted_result: string | null;
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  reasons: string[];
} {
  try {
    const response = JSON.parse(snapshot.response_payload_json) as Record<string, unknown>;
    const predictions = response['predictions'] as Record<string, unknown> | undefined;
    const core = predictions?.['core'] as Record<string, unknown> | undefined;

    function num(v: unknown): number | null { return typeof v === 'number' ? v : null; }
    function str(v: unknown): string | null { return typeof v === 'string' ? v : null; }

    const rawReasons = JSON.parse(snapshot.reasons_json) as unknown;
    const reasons = Array.isArray(rawReasons)
      ? rawReasons.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)))
      : [];

    return {
      predicted_result:    str(core?.['predicted_result']),
      p_home_win:          num(core?.['p_home_win']),
      p_draw:              num(core?.['p_draw']),
      p_away_win:          num(core?.['p_away_win']),
      expected_goals_home: num(core?.['expected_goals_home']),
      expected_goals_away: num(core?.['expected_goals_away']),
      reasons,
    };
  } catch {
    return {
      predicted_result: null, p_home_win: null, p_draw: null, p_away_win: null,
      expected_goals_home: null, expected_goals_away: null, reasons: [],
    };
  }
}

/**
 * Derives excluded_reason from record state.
 * Called whenever record fields change that affect eligibility.
 */
function deriveExcludedReason(
  record_status: RecordStatus,
  mode: string,
  prediction_available: boolean,
  predicted_result: string | null,
  existing_excluded_reason: ExcludedReason,
): ExcludedReason {
  // EXCLUDED records keep their reason
  if (record_status === 'EXCLUDED') return existing_excluded_reason;
  // No valid pre-kickoff snapshot
  if (!prediction_available) return 'NO_PREGAME_SNAPSHOT';
  // Engine rated match as not eligible
  if (mode === 'NOT_ELIGIBLE') return 'NOT_ELIGIBLE';
  // Snapshot exists but decision policy produced no prediction
  if (predicted_result === null) return 'MISSING_PROBS';
  return null;
}

/**
 * Derives evaluation_eligible from current record state.
 *
 * Scoring eligibility rules:
 *   FULL_MODE   + pre-kickoff snap + FINISHED + predicted_result ≠ null → true
 *   LIMITED_MODE + pre-kickoff snap + FINISHED + predicted_result ≠ null → true
 *   NOT_ELIGIBLE  → false (excluded_reason = 'NOT_ELIGIBLE')
 *   No snapshot   → false (excluded_reason = 'NO_PREGAME_SNAPSHOT')
 *   MISSING_PROBS → false (excluded_reason = 'MISSING_PROBS')
 *   ABNORMAL_END  → false (excluded_reason = 'ABNORMAL_END')
 *   PENDING / SNAPSHOT_FROZEN → false (no ground truth yet)
 */
function deriveEligible(
  record_status: RecordStatus,
  excluded_reason: ExcludedReason,
  actual_result: string | null,
): boolean {
  return (
    record_status === 'COMPLETE' &&
    excluded_reason === null &&
    actual_result !== null
  );
}

function nullPredFields() {
  return {
    predicted_result: null as string | null,
    p_home_win: null as number | null,
    p_draw: null as number | null,
    p_away_win: null as number | null,
    expected_goals_home: null as number | null,
    expected_goals_away: null as number | null,
    reasons: [] as string[],
  };
}

// ── EvaluationStore ───────────────────────────────────────────────────────────

export interface EvaluationStoreOptions {
  filePath?: string;
}

export class EvaluationStore {
  private readonly filePath: string;
  private records: Map<string, EvaluationRecord> = new Map();

  constructor(options: EvaluationStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    this._loadFromFile();
  }

  // ── Write: lifecycle methods ──────────────────────────────────────────────

  /**
   * Registers a PENDING placeholder record for a scheduled in-scope match.
   * This ensures every in-scope match gets an EvaluationRecord even before
   * any prediction snapshot exists.
   *
   * No-op if a record already exists for match_id (any status).
   */
  registerMatch(competitionId: string, match: MatchForFreeze): void {
    if (this.records.has(match.matchId)) return;
    if (!match.startTimeUtc) return;

    const record: EvaluationRecord = {
      match_id: match.matchId,
      competition_id: competitionId,
      home_team_id: match.homeTeamId,
      away_team_id: match.awayTeamId,
      scheduled_kickoff_utc: match.startTimeUtc,
      record_status: 'PENDING',

      snapshot_id: null,
      snapshot_frozen_at: null,
      snapshot_generated_at: null,
      engine_version: null,
      spec_version: null,
      prediction_available: false,

      evaluation_eligible: false,
      excluded_reason: null,

      mode: 'UNKNOWN',
      calibration_mode: null,
      ...nullPredFields(),

      ground_truth_status: 'PENDING',
      ground_truth_captured_at: null,
      final_home_goals: null,
      final_away_goals: null,
      actual_result: null,

      ui_render_result: null,
      ui_clear_or_confusing: null,
      runtime_issue: null,
      runtime_notes: null,
    };

    this.records.set(match.matchId, record);
  }

  /**
   * Attaches an official evaluation snapshot to a record.
   *
   * Freeze cutoff rule: snapshot.generated_at must be strictly less than
   * match.startTimeUtc (ISO string comparison, both UTC).
   *
   * Behavior:
   * - If record is already SNAPSHOT_FROZEN, COMPLETE, or EXCLUDED → no-op (freeze is permanent).
   * - If record is PENDING and snapshot is pre-kickoff → upgrade to SNAPSHOT_FROZEN.
   * - If record is PENDING and snapshot is post-kickoff → upgrade to EXCLUDED (NO_PREGAME_SNAPSHOT).
   * - If no record exists yet → creates one directly (registerMatch + freeze in one step).
   * - Only processes snapshots with generation_status === 'ok'.
   */
  freezeSnapshot(
    competitionId: string,
    match: MatchForFreeze,
    snapshot: PredictionSnapshot,
  ): void {
    if (snapshot.generation_status !== 'ok') return;
    if (!match.startTimeUtc) return;

    // Ensure a record exists
    this.registerMatch(competitionId, match);

    const record = this.records.get(match.matchId)!;

    // Freeze is permanent for SNAPSHOT_FROZEN, COMPLETE, EXCLUDED
    if (record.record_status !== 'PENDING') return;

    const kickoffUtc = match.startTimeUtc;
    const isPregame = snapshot.generated_at < kickoffUtc;

    if (!isPregame) {
      // Post-kickoff snapshot → cannot use for evaluation
      record.record_status = 'EXCLUDED';
      record.prediction_available = false;
      record.excluded_reason = 'NO_PREGAME_SNAPSHOT';
      record.evaluation_eligible = false;
      console.log(
        `[EvaluationStore] Post-kickoff snapshot rejected: ${match.matchId} (snap=${snapshot.generated_at}, kickoff=${kickoffUtc})`,
      );
      return;
    }

    const predFields = extractPredictionFields(snapshot);
    const mode = snapshot.mode;
    const excluded_reason = deriveExcludedReason(
      'SNAPSHOT_FROZEN', mode, true, predFields.predicted_result, null,
    );

    record.record_status = 'SNAPSHOT_FROZEN';
    record.snapshot_id = `eval:${match.matchId}:${snapshot.generated_at}`;
    record.snapshot_frozen_at = new Date().toISOString();
    record.snapshot_generated_at = snapshot.generated_at;
    record.engine_version = snapshot.engine_version;
    record.spec_version = snapshot.spec_version;
    record.prediction_available = true;
    record.mode = mode;
    record.calibration_mode = snapshot.calibration_mode;
    record.excluded_reason = excluded_reason;
    record.evaluation_eligible = false; // will become true only when COMPLETE
    Object.assign(record, predFields);

    console.log(
      `[EvaluationStore] Snapshot frozen: ${match.matchId} (mode=${mode}, excluded_reason=${String(excluded_reason)})`,
    );
  }

  /**
   * Fills ground truth once a match reaches FINISHED.
   *
   * Transitions:
   *   SNAPSHOT_FROZEN → COMPLETE (and recomputes evaluation_eligible)
   *   PENDING         → EXCLUDED (match finished before any snapshot was generated)
   *
   * No-op if already COMPLETE or EXCLUDED.
   * Returns true if state changed, false otherwise.
   */
  captureGroundTruth(
    matchId: string,
    finalHomeGoals: number,
    finalAwayGoals: number,
  ): boolean {
    const record = this.records.get(matchId);
    if (!record) return false;
    if (record.record_status === 'COMPLETE' || record.record_status === 'EXCLUDED') return false;

    const actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' =
      finalHomeGoals > finalAwayGoals ? 'HOME_WIN'
      : finalHomeGoals < finalAwayGoals ? 'AWAY_WIN'
      : 'DRAW';

    record.final_home_goals = finalHomeGoals;
    record.final_away_goals = finalAwayGoals;
    record.actual_result = actualResult;
    record.ground_truth_captured_at = new Date().toISOString();
    record.ground_truth_status = 'CAPTURED';

    if (record.record_status === 'PENDING') {
      // Finished before any pre-kickoff snapshot was generated
      record.record_status = 'EXCLUDED';
      record.excluded_reason = 'NO_PREGAME_SNAPSHOT';
      record.evaluation_eligible = false;
    } else {
      // SNAPSHOT_FROZEN → COMPLETE
      record.record_status = 'COMPLETE';
      // Re-derive excluded_reason now that we have ground truth
      record.excluded_reason = deriveExcludedReason(
        'COMPLETE', record.mode, record.prediction_available,
        record.predicted_result, record.excluded_reason,
      );
      record.evaluation_eligible = deriveEligible(
        record.record_status, record.excluded_reason, actualResult,
      );
    }

    return true;
  }

  /**
   * Marks a record as EXCLUDED due to a non-FINISHED terminal match status
   * (CANCELED or POSTPONED in canonical model).
   *
   * Ground truth is set to UNAVAILABLE. Record will not contribute to metrics.
   * No-op if already COMPLETE or EXCLUDED.
   */
  markAbnormalEnd(matchId: string): boolean {
    const record = this.records.get(matchId);
    if (!record) return false;
    if (record.record_status === 'COMPLETE' || record.record_status === 'EXCLUDED') return false;

    record.record_status = 'EXCLUDED';
    record.excluded_reason = 'ABNORMAL_END';
    record.ground_truth_status = 'UNAVAILABLE';
    record.evaluation_eligible = false;
    console.log(`[EvaluationStore] Abnormal end: ${matchId}`);
    return true;
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  findByMatch(matchId: string): EvaluationRecord | undefined {
    return this.records.get(matchId);
  }

  findByCompetition(competitionId: string): EvaluationRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.competition_id === competitionId,
    );
  }

  findAll(): EvaluationRecord[] {
    return Array.from(this.records.values());
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  async persist(): Promise<void> {
    const doc: StoreFileDoc = {
      version: 2,
      savedAt: new Date().toISOString(),
      records: Array.from(this.records.values()),
    };

    const tmpPath = this.filePath.replace(/\.json$/, '.tmp');

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('[EvaluationStore] persist failed:', err);
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _loadFromFile(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const doc = JSON.parse(raw) as unknown;
      if (!doc || typeof doc !== 'object') return;

      const d = doc as Record<string, unknown>;

      // Support both v1 (legacy, field names differ) and v2
      if (d['version'] === 2 && Array.isArray(d['records'])) {
        const records = d['records'] as EvaluationRecord[];
        for (const r of records) {
          this.records.set(r.match_id, r);
        }
        console.log(`[EvaluationStore] Loaded ${this.records.size} records (v2) from ${this.filePath}`);
      } else if (d['version'] === 1 && Array.isArray(d['records'])) {
        // v1 migration: add missing fields
        const records = d['records'] as Record<string, unknown>[];
        for (const r of records) {
          const migrated = this._migrateV1Record(r);
          this.records.set(migrated.match_id, migrated);
        }
        console.log(`[EvaluationStore] Migrated ${this.records.size} records from v1`);
      }
    } catch (err) {
      console.warn('[EvaluationStore] Could not load from file, starting empty:', err);
    }
  }

  private _migrateV1Record(r: Record<string, unknown>): EvaluationRecord {
    const isSnapshotFrozen = r['prediction_available'] === true;
    const record_status: RecordStatus = isSnapshotFrozen ? 'SNAPSHOT_FROZEN' : 'PENDING';
    return {
      match_id: String(r['match_id'] ?? ''),
      competition_id: String(r['competition_id'] ?? ''),
      home_team_id: String(r['home_team_id'] ?? ''),
      away_team_id: String(r['away_team_id'] ?? ''),
      scheduled_kickoff_utc: String(r['scheduled_kickoff_utc'] ?? ''),
      record_status,
      snapshot_id: r['snapshot_id'] as string | null ?? null,
      snapshot_frozen_at: r['snapshot_frozen_at'] as string | null ?? null,
      snapshot_generated_at: r['snapshot_generated_at'] as string | null ?? null,
      engine_version: r['engine_version'] as string | null ?? null,
      spec_version: r['spec_version'] as string | null ?? null,
      prediction_available: Boolean(r['prediction_available']),
      evaluation_eligible: Boolean(r['evaluation_eligible']),
      excluded_reason: r['excluded_reason'] as ExcludedReason ?? null,
      mode: String(r['mode'] ?? 'UNKNOWN'),
      calibration_mode: r['calibration_mode'] as string | null ?? null,
      predicted_result: r['predicted_result'] as string | null ?? null,
      p_home_win: r['p_home_win'] as number | null ?? null,
      p_draw: r['p_draw'] as number | null ?? null,
      p_away_win: r['p_away_win'] as number | null ?? null,
      expected_goals_home: r['expected_goals_home'] as number | null ?? null,
      expected_goals_away: r['expected_goals_away'] as number | null ?? null,
      reasons: Array.isArray(r['reasons']) ? r['reasons'] as string[] : [],
      ground_truth_status: (r['ground_truth_status'] as 'PENDING' | 'CAPTURED' | 'UNAVAILABLE') ?? 'PENDING',
      ground_truth_captured_at: r['ground_truth_captured_at'] as string | null ?? null,
      final_home_goals: r['final_home_goals'] as number | null ?? null,
      final_away_goals: r['final_away_goals'] as number | null ?? null,
      actual_result: r['actual_result'] as 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null ?? null,
      ui_render_result: r['ui_render_result'] as EvaluationRecord['ui_render_result'] ?? null,
      ui_clear_or_confusing: r['ui_clear_or_confusing'] as 'CLEAR' | 'CONFUSING' | null ?? null,
      runtime_issue: r['runtime_issue'] as EvaluationRecord['runtime_issue'] ?? null,
      runtime_notes: r['runtime_notes'] as string | null ?? null,
    };
  }
}

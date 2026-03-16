/**
 * PredictionStore — dedicated in-memory + file-based store for prediction engine outputs.
 *
 * Isolated from portal production structures. Supports inspection endpoint (PE-75).
 *
 * Storage: cache/predictions/snapshots.json (relative to process.cwd())
 * Write strategy: atomic (tmp → rename), consistent with server/matchday-cache.ts
 * Error policy: persistence errors are logged and never propagated.
 *
 * PE-73
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Schema ────────────────────────────────────────────────────────────────────

/**
 * A persisted record of one prediction engine run (success or error).
 *
 * Multiple runs for the same match are distinguished by generated_at.
 */
export interface PredictionSnapshot {
  match_id: string;
  competition_id: string;
  /** ISO-8601 UTC timestamp of when this prediction was generated. */
  generated_at: string;
  /**
   * Stable identifier of the algorithm that generated this snapshot.
   * 'v1_elo_poisson' = V1 engine (Elo + Poisson, spec v1.3)
   * 'v2_structural_attack_defense' = V2 engine (attack/defense + Bayesian shrinkage)
   * Snapshots loaded from disk without this field are retroactively assigned 'v1_elo_poisson'.
   */
  engine_id: 'v1_elo_poisson' | 'v2_structural_attack_defense' | 'v3_unified';
  /** Engine version at generation time. '1.3' for V1. */
  engine_version: string;
  /** Spec version at generation time. Always '1.3' in current implementation. */
  spec_version: string;
  /** JSON.stringify of the MatchInput passed to the engine. */
  request_payload_json: string;
  /** JSON.stringify of the PredictionResponse returned by the engine. */
  response_payload_json: string;
  /** Eligibility status from the response (e.g. 'ELIGIBLE', 'NOT_ELIGIBLE'). */
  mode: string;
  /** Calibration mode from response.internals, or null if not available. */
  calibration_mode: string | null;
  /** JSON.stringify of the reasons array from the response. */
  reasons_json: string;
  /** JSON.stringify of the data_integrity_flags object, or JSON.stringify([]) if absent. */
  degradation_flags_json: string;
  generation_status: 'ok' | 'error';
  /** Error detail string, only present when generation_status = 'error'. */
  error_detail?: string;
}

// ── Persistence file structure ─────────────────────────────────────────────────

interface StoreFileDoc {
  version: 1;
  savedAt: string;
  snapshots: PredictionSnapshot[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ENGINE_VERSION = '1.3';
const SPEC_VERSION = '1.3';

const DEFAULT_FILE_PATH = path.resolve(process.cwd(), 'cache/predictions/snapshots.json');

// ── Helper: extract fields from a PredictionResponse (any shape) ──────────────

interface ExtractedSnapshotFields {
  mode: string;
  calibration_mode: string | null;
  reasons_json: string;
  degradation_flags_json: string;
}

function extractSnapshotFields(response: unknown): ExtractedSnapshotFields {
  const r = response as Record<string, unknown> | null | undefined;

  // Use operating_mode (FULL_MODE / LIMITED_MODE / NOT_ELIGIBLE) from the top-level
  // response field, NOT eligibility_status ('ELIGIBLE' / 'NOT_ELIGIBLE'). The
  // evaluation store segments metrics by mode and eligibility rules depend on
  // FULL_MODE/LIMITED_MODE distinction. Falls back to eligibility_status when
  // operating_mode is absent (older response shapes).
  const internals = r?.['internals'] as Record<string, unknown> | null | undefined;
  const mode = typeof r?.['operating_mode'] === 'string'
    ? (r['operating_mode'] as string)
    : typeof r?.['eligibility_status'] === 'string'
      ? (r['eligibility_status'] as string) // fallback for NOT_ELIGIBLE responses
      : 'UNKNOWN';

  const calibration_mode = typeof internals?.['calibration_mode'] === 'string'
    ? (internals['calibration_mode'] as string)
    : null;

  const rawReasons = r?.['reasons'];
  const reasons_json = JSON.stringify(Array.isArray(rawReasons) ? rawReasons : []);

  const rawFlags = r?.['data_integrity_flags'];
  const degradation_flags_json = JSON.stringify(
    rawFlags !== null && rawFlags !== undefined ? rawFlags : [],
  );

  return { mode, calibration_mode, reasons_json, degradation_flags_json };
}

// ── buildSnapshot exported helper ─────────────────────────────────────────────

/**
 * Builds a PredictionSnapshot from a successful engine run.
 *
 * Callers may pass the MatchInput and PredictionResponse as `unknown`
 * (the store does not depend on the prediction package types directly).
 */
export function buildSnapshot(
  matchId: string,
  competitionId: string,
  requestPayload: unknown,
  response: unknown,
  engineId: 'v1_elo_poisson' | 'v2_structural_attack_defense' | 'v3_unified' = 'v1_elo_poisson',
): PredictionSnapshot {
  const { mode, calibration_mode, reasons_json, degradation_flags_json } =
    extractSnapshotFields(response);

  return {
    match_id: matchId,
    competition_id: competitionId,
    generated_at: new Date().toISOString(),
    engine_id: engineId,
    engine_version: ENGINE_VERSION,
    spec_version: SPEC_VERSION,
    request_payload_json: JSON.stringify(requestPayload),
    response_payload_json: JSON.stringify(response),
    mode,
    calibration_mode,
    reasons_json,
    degradation_flags_json,
    generation_status: 'ok',
  };
}

// ── PredictionStore ────────────────────────────────────────────────────────────

export interface PredictionStoreOptions {
  /** Absolute path to the JSON file used for persistence. */
  filePath?: string;
}

/**
 * In-memory store for PredictionSnapshot records, with optional file-based persistence.
 *
 * Thread-safety note: Node.js is single-threaded; concurrent async calls to persist()
 * are safe because the atomic write (tmp → rename) is the only FS operation that
 * can race, and the last rename wins deterministically.
 */
export class PredictionStore {
  private readonly filePath: string;
  private snapshots: PredictionSnapshot[] = [];

  constructor(options: PredictionStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    this._loadFromFile();
  }

  // ── Write ────────────────────────────────────────────────────────────────────

  /**
   * Saves a successful prediction snapshot to the in-memory store.
   * Does NOT automatically persist to disk — call persist() explicitly.
   */
  save(snapshot: PredictionSnapshot): void {
    this.snapshots.push(snapshot);
  }

  /**
   * Records a failed prediction attempt.
   * Does NOT automatically persist to disk — call persist() explicitly.
   */
  saveError(matchId: string, competitionId: string, error: unknown, engineId: PredictionSnapshot['engine_id'] = 'v1_elo_poisson'): void {
    const errorDetail =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);

    const snapshot: PredictionSnapshot = {
      match_id: matchId,
      competition_id: competitionId,
      generated_at: new Date().toISOString(),
      engine_id: engineId,
      engine_version: ENGINE_VERSION,
      spec_version: SPEC_VERSION,
      request_payload_json: '{}',
      response_payload_json: '{}',
      mode: 'ERROR',
      calibration_mode: null,
      reasons_json: '[]',
      degradation_flags_json: '[]',
      generation_status: 'error',
      error_detail: errorDetail,
    };

    this.snapshots.push(snapshot);
  }

  // ── Query ────────────────────────────────────────────────────────────────────

  /**
   * Returns all snapshots for the given matchId, sorted by generated_at descending
   * (most recent first).
   */
  findByMatch(matchId: string): PredictionSnapshot[] {
    return this.snapshots
      .filter((s) => s.match_id === matchId)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  }

  /**
   * Returns snapshots for the given competitionId, sorted by generated_at descending,
   * capped at `limit` entries (default: all).
   */
  findByCompetition(competitionId: string, limit?: number): PredictionSnapshot[] {
    const filtered = this.snapshots
      .filter((s) => s.competition_id === competitionId)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at));

    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }

  /**
   * Returns all snapshots sorted by generated_at descending,
   * capped at `limit` entries (default: all).
   */
  findAll(limit?: number): PredictionSnapshot[] {
    const sorted = [...this.snapshots].sort((a, b) =>
      b.generated_at.localeCompare(a.generated_at),
    );
    return limit !== undefined ? sorted.slice(0, limit) : sorted;
  }

  // ── Persistence ───────────────────────────────────────────────────────────────

  /**
   * Persists the current in-memory store to the JSON file atomically.
   *
   * Fire-and-forget from the caller's perspective: errors are logged but never thrown.
   * Uses tmp → rename pattern consistent with server/matchday-cache.ts.
   */
  async persist(): Promise<void> {
    const doc: StoreFileDoc = {
      version: 1,
      savedAt: new Date().toISOString(),
      snapshots: this.snapshots,
    };

    const tmpPath = this.filePath.replace(/\.json$/, '.tmp');

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('[PredictionStore] persist failed:', err);
      // Clean up orphaned .tmp if it exists
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      // Do NOT propagate — callers must not crash due to store write failures.
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  /**
   * Loads snapshots from the file into memory at construction time.
   * Failures are silent — the store starts empty if the file is missing or corrupt.
   */
  private _loadFromFile(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const doc = JSON.parse(raw) as unknown;

      if (
        doc !== null &&
        typeof doc === 'object' &&
        (doc as Record<string, unknown>)['version'] === 1 &&
        Array.isArray((doc as Record<string, unknown>)['snapshots'])
      ) {
        this.snapshots = (doc as StoreFileDoc).snapshots.map((s) => ({
          ...s,
          // Retroactive default: snapshots persisted before engine_id was added
          // were all generated by V1. Safe assumption — V2 was never wired to this store.
          engine_id: (s.engine_id ?? 'v1_elo_poisson') as PredictionSnapshot['engine_id'],
        }));
        console.log(
          `[PredictionStore] Loaded ${this.snapshots.length} snapshots from ${this.filePath}`,
        );
      }
    } catch (err) {
      console.warn('[PredictionStore] Could not load from file, starting empty:', err);
    }
  }
}

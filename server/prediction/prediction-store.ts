/**
 * PredictionStore — dedicated in-memory + file-based store for prediction engine outputs.
 *
 * Isolated from portal production structures. Supports inspection endpoint (PE-75).
 *
 * Storage strategy (two-tier):
 *   Hot file:   cache/predictions/snapshots.json   — snapshots de los últimos HOT_RETENTION_DAYS días
 *   Archive:    cache/predictions/archive/YYYY-MM.json — snapshots más antiguos, uno por mes, write-once
 *
 * El archivo hot se reescribe en cada ciclo. Los archivos de archive son inmutables una vez escritos.
 * En startup solo se carga el archivo hot — el archive es read-only y se consulta a demanda.
 *
 * Write strategy: atomic (tmp → rename), consistent with server/matchday-cache.ts
 * Error policy: persistence errors are logged and never propagated.
 *
 * PE-73
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CACHE_BASE } from '../cache-dir.js';

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

const DEFAULT_FILE_PATH = path.join(CACHE_BASE, 'predictions/snapshots.json');
const DEFAULT_ARCHIVE_DIR = path.join(CACHE_BASE, 'predictions/archive');

/** Snapshots con generated_at más antiguos que esto se archivan fuera del archivo hot. */
const HOT_RETENTION_DAYS = 90;

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
  // V3 engine uses `eligibility: 'ELIGIBLE' | 'LIMITED' | 'NOT_ELIGIBLE'` — map to OperatingMode
  const v3Eligibility = typeof r?.['eligibility'] === 'string' ? (r['eligibility'] as string) : null;
  const v3ModeFromEligibility = v3Eligibility === 'ELIGIBLE'
    ? 'FULL_MODE'
    : v3Eligibility === 'LIMITED'
      ? 'LIMITED_MODE'
      : v3Eligibility === 'NOT_ELIGIBLE'
        ? 'NOT_ELIGIBLE'
        : null;
  const mode = typeof r?.['operating_mode'] === 'string'
    ? (r['operating_mode'] as string)
    : v3ModeFromEligibility                   // V3 uses 'eligibility' field
      ?? (typeof r?.['mode'] === 'string' ? (r['mode'] as string) : null)
      ?? (typeof r?.['eligibility_status'] === 'string' ? (r['eligibility_status'] as string) : null)
      ?? 'UNKNOWN';

  // calibration_mode: spec stores under internals; V3 stores at root level
  const calibration_mode = typeof internals?.['calibration_mode'] === 'string'
    ? (internals['calibration_mode'] as string)
    : typeof r?.['calibration_mode'] === 'string'
      ? (r['calibration_mode'] as string)
      : null;

  // reasons: spec uses 'reasons'; V3 uses 'warnings' — fall back to warnings if reasons absent
  const rawReasons = r?.['reasons'] ?? r?.['warnings'];
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
  /** Directory for monthly archive files. Defaults to cache/predictions/archive/. */
  archiveDir?: string;
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
  private readonly archiveDir: string;
  private snapshots: PredictionSnapshot[] = [];

  constructor(options: PredictionStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    this.archiveDir = options.archiveDir ?? DEFAULT_ARCHIVE_DIR;
    this._loadFromFile();
  }

  // ── Write ────────────────────────────────────────────────────────────────────

  /**
   * Saves a successful prediction snapshot to the in-memory store (upsert by match_id+engine_id).
   * Replaces the existing snapshot for the same match+engine combination so the store
   * stays bounded at O(matches × engines) rather than growing unboundedly on each refresh cycle.
   * Does NOT automatically persist to disk — call persist() explicitly.
   */
  save(snapshot: PredictionSnapshot): void {
    const idx = this.snapshots.findIndex(
      (s) => s.match_id === snapshot.match_id && s.engine_id === snapshot.engine_id,
    );
    if (idx >= 0) {
      this.snapshots[idx] = snapshot;
    } else {
      this.snapshots.push(snapshot);
    }
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
   * Persists the current in-memory store to disk, with pruning:
   *
   * - Snapshots de los últimos HOT_RETENTION_DAYS días → archivo hot (snapshots.json)
   * - Snapshots más antiguos → archivados en archive/YYYY-MM.json (write-once por mes)
   *
   * Los archivos de archive son inmutables una vez escritos. Si ya existe el archivo
   * de un mes, se omite (los snapshots de ese mes son idempotentes por el upsert).
   * El array en memoria se reduce a solo los snapshots hot después de archivar.
   *
   * Fire-and-forget desde la perspectiva del caller: errores se loguean y nunca se propagan.
   * Usa tmp → rename para escritura atómica.
   */
  async persist(): Promise<void> {
    try {
      const cutoffMs = Date.now() - HOT_RETENTION_DAYS * 24 * 3600_000;
      const hot: PredictionSnapshot[] = [];
      const coldByMonth = new Map<string, PredictionSnapshot[]>();

      for (const s of this.snapshots) {
        if (new Date(s.generated_at).getTime() >= cutoffMs) {
          hot.push(s);
        } else {
          const month = s.generated_at.slice(0, 7); // 'YYYY-MM'
          const bucket = coldByMonth.get(month) ?? [];
          bucket.push(s);
          coldByMonth.set(month, bucket);
        }
      }

      // Escribir archivo hot (JSON compacto, sin pretty-print)
      const doc: StoreFileDoc = {
        version: 1,
        savedAt: new Date().toISOString(),
        snapshots: hot,
      };
      const tmpPath = this.filePath.replace(/\.json$/, '.tmp');
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(doc), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);

      // Archivar snapshots cold por mes (write-once: si el archivo existe, ya están archivados)
      if (coldByMonth.size > 0) {
        fs.mkdirSync(this.archiveDir, { recursive: true });
        for (const [month, snapshots] of coldByMonth) {
          const archivePath = path.join(this.archiveDir, `${month}.json`);
          if (!fs.existsSync(archivePath)) {
            const archiveDoc = { version: 1, month, count: snapshots.length, snapshots };
            const archiveTmp = `${archivePath}.tmp`;
            fs.writeFileSync(archiveTmp, JSON.stringify(archiveDoc), 'utf-8');
            fs.renameSync(archiveTmp, archivePath);
            console.log(`[PredictionStore] Archived ${snapshots.length} snapshots → archive/${month}.json`);
          }
        }
        // Reducir memoria a solo snapshots hot
        this.snapshots = hot;
      }
    } catch (err) {
      console.error('[PredictionStore] persist failed:', err);
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

        // Report archive state so ops can see the full track record size at a glance
        let archiveMonths = 0;
        try {
          if (fs.existsSync(this.archiveDir)) {
            archiveMonths = fs.readdirSync(this.archiveDir).filter((f) => f.endsWith('.json')).length;
          }
        } catch { /* non-fatal */ }

        console.log(
          `[PredictionStore] Loaded ${this.snapshots.length} hot snapshots` +
          (archiveMonths > 0 ? ` + ${archiveMonths} archive month(s) on disk` : ''),
        );
      }
    } catch (err) {
      console.warn('[PredictionStore] Could not load from file, starting empty:', err);
    }
  }
}

/**
 * historical-backtest-store.ts — persistent store for historical backtest snapshots.
 *
 * Strictly segregated from forward evaluation records (PredictionStore /
 * EvaluationStore). Backtest snapshots carry source_type = 'HISTORICAL_BACKTEST'
 * and are written to a separate file.
 *
 * Storage: cache/predictions/historical-backtest.json
 * Write strategy: atomic (.tmp → rename), consistent with prediction-store.ts
 * Error policy: persistence errors are logged and never propagated.
 *
 * H3 — Historical Snapshot Builder
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CACHE_BASE } from '../cache-dir.js';

// ── Schema ─────────────────────────────────────────────────────────────────

/**
 * A single synthetic historical pre-match prediction snapshot.
 *
 * Produced by running the real prediction pipeline with pre-match Elo state
 * reconstructed as-of kickoff_utc using H2 historical team state.
 */
export interface HistoricalBacktestSnapshot {
  /** Unique ID for this backtest snapshot. */
  snapshot_id: string;
  /** Always 'HISTORICAL_BACKTEST' — prevents mixing with forward records. */
  source_type: 'HISTORICAL_BACKTEST';
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

  // ── Ground truth (from canonical data) ────────────────────────────────
  /** Actual result from the canonical match data. */
  actual_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  home_goals: number;
  away_goals: number;

  // ── H2 quality metadata ────────────────────────────────────────────────
  /**
   * Quality of the historical dataset used for reconstruction.
   * FULL: ≥300 matches, PARTIAL: 1-299, BOOTSTRAP: 0 matches.
   */
  as_of_quality: 'FULL' | 'PARTIAL' | 'BOOTSTRAP';
  /** Home team Elo immediately before kickoff. */
  elo_home_pre: number;
  /** Away team Elo immediately before kickoff. */
  elo_away_pre: number;
  /** Number of Elo updates applied to home team (proxy for experience). */
  elo_home_update_count: number;
  /** Number of Elo updates applied to away team. */
  elo_away_update_count: number;
  /** Completed matches in the 365d window before kickoff, home team. */
  matches_365d_home: number;
  /** Completed matches in the 365d window before kickoff, away team. */
  matches_365d_away: number;
  /** Total historical matches used in the Elo replay. */
  total_historical_matches: number;

  // ── Prediction output (with historical Elo) ────────────────────────────
  /** Operating mode: FULL_MODE, LIMITED_MODE, or NOT_ELIGIBLE. */
  mode: string;
  /** Predicted result, or null if NOT_ELIGIBLE / TOO_CLOSE. */
  predicted_result: string | null;
  /** Calibrated home win probability, or null if NOT_ELIGIBLE. */
  p_home_win: number | null;
  /** Calibrated draw probability, or null if NOT_ELIGIBLE. */
  p_draw: number | null;
  /** Calibrated away win probability, or null if NOT_ELIGIBLE. */
  p_away_win: number | null;
  /** Expected goals home (lambda_home), or null if NOT_ELIGIBLE. */
  expected_goals_home: number | null;
  /** Expected goals away (lambda_away), or null if NOT_ELIGIBLE. */
  expected_goals_away: number | null;
  /** Reason codes from the validation layer. */
  reasons: string[];

  // ── Raw probability layer (before calibration) — H6b ──────────────────
  /** Raw home win probability from Poisson engine, before calibration. Null if NOT_ELIGIBLE. */
  raw_p_home_win?: number | null;
  /** Raw draw probability from Poisson engine, before calibration. Null if NOT_ELIGIBLE. */
  raw_p_draw?: number | null;
  /** Raw away win probability from Poisson engine, before calibration. Null if NOT_ELIGIBLE. */
  raw_p_away_win?: number | null;
  /** Lambda home from Poisson engine (= expected_goals_home before pipeline). */
  lambda_home?: number | null;
  /** Lambda away from Poisson engine (= expected_goals_away before pipeline). */
  lambda_away?: number | null;
  /** Effective Elo for home team used in lambda computation (includes home advantage delta). */
  effective_elo_home?: number | null;
  /** Effective Elo for away team used in lambda computation (no home advantage). */
  effective_elo_away?: number | null;
  /** Calibration mode applied: 'bootstrap' | 'trained' | 'not_applied'. */
  calibration_mode?: string | null;

  // ── Baseline comparison (bootstrap: DEFAULT_ELO 1500/1500, no home adv) ─
  /**
   * What the model would predict at DEFAULT_ELO for both teams.
   * Used as symmetry evidence: if baseline = historical prediction → Elo has
   * no effect; if different → historical Elo is influencing the output.
   */
  baseline_predicted_result: string | null;
  baseline_p_home_win: number | null;
  baseline_p_draw: number | null;
  baseline_p_away_win: number | null;

  // ── Pipeline status ─────────────────────────────────────────────────────
  build_status: 'SUCCESS' | 'NOT_ELIGIBLE' | 'ERROR';
  error_detail?: string;
  /** When this snapshot was generated. */
  generated_at: string;
}

// ── Store file ─────────────────────────────────────────────────────────────

interface StoreFileDoc {
  version: 1;
  savedAt: string;
  snapshots: HistoricalBacktestSnapshot[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_FILE_PATH = path.join(CACHE_BASE, 'predictions/historical-backtest.json');

// ── HistoricalBacktestStore ────────────────────────────────────────────────

export class HistoricalBacktestStore {
  private readonly filePath: string;
  private snapshots: HistoricalBacktestSnapshot[] = [];

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_FILE_PATH;
    this._loadFromFile();
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  save(snapshot: HistoricalBacktestSnapshot): void {
    this.snapshots.push(snapshot);
  }

  /** Replaces all snapshots for a given competition (idempotent re-run). */
  replaceForCompetition(
    competitionCode: string,
    newSnapshots: HistoricalBacktestSnapshot[],
  ): void {
    this.snapshots = [
      ...this.snapshots.filter((s) => s.competition_code !== competitionCode),
      ...newSnapshots,
    ];
  }

  /**
   * Replaces snapshots for a given competition + season only.
   * Season boundary: kickoff_utc >= `${seasonStartYear}-07-01` and
   *                  kickoff_utc <  `${seasonStartYear + 1}-07-01`.
   * Other competitions and other seasons are preserved.
   */
  replaceForCompetitionSeason(
    competitionCode: string,
    seasonStartYear: number,
    newSnapshots: HistoricalBacktestSnapshot[],
  ): void {
    const lo = `${seasonStartYear}-07-01`;
    const hi = `${seasonStartYear + 1}-07-01`;
    this.snapshots = [
      ...this.snapshots.filter(
        (s) =>
          s.competition_code !== competitionCode ||
          s.kickoff_utc < lo ||
          s.kickoff_utc >= hi,
      ),
      ...newSnapshots,
    ];
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  findByCompetition(competitionCode: string): HistoricalBacktestSnapshot[] {
    return this.snapshots.filter((s) => s.competition_code === competitionCode);
  }

  findAll(): HistoricalBacktestSnapshot[] {
    return [...this.snapshots];
  }

  count(): number {
    return this.snapshots.length;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

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
      console.error('[HistoricalBacktestStore] persist failed:', err);
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

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
        this.snapshots = (doc as StoreFileDoc).snapshots;
        console.log(
          `[HistoricalBacktestStore] Loaded ${this.snapshots.length} snapshots from ${this.filePath}`,
        );
      }
    } catch (err) {
      console.warn('[HistoricalBacktestStore] Could not load from file:', err);
    }
  }
}

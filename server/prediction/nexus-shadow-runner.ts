/**
 * nexus-shadow-runner.ts — NEXUS (PE v2) Shadow Runner.
 *
 * Runs NEXUS predictions out-of-band for all eligible pre-kickoff fixtures
 * in competitions enabled by the PREDICTION_NEXUS_SHADOW_ENABLED flag.
 *
 * Spec authority:
 *   - master spec S8.1: shadow mode semantics (never exposed to end users)
 *   - master spec S8.2: feature flags (NEXUS_SHADOW_ENABLED)
 *   - master spec S8.4: data isolation (NEXUS ≠ V3 state)
 *   - evaluation-and-promotion spec S6.2: live_shadow requires buildNowUtc < kickoffUtc
 *   - evaluation-and-promotion spec S6.6: live_shadow condition for promotion gate
 *
 * CRITICAL RULES:
 *   1. NEVER exposes NEXUS output via /api/ui/* — shadow only.
 *   2. NEVER modifies V3 state or output.
 *   3. NEVER propagates errors to caller — full fault isolation.
 *   4. Only records predictions when buildNowUtc < kickoffUtc (strict pre-kickoff).
 *
 * Storage:
 *   cache/nexus-shadow/{competitionId}/{matchId}.json
 *   Written atomically: .tmp → rename (same pattern as matchday-cache).
 *
 * Shadow snapshot schema (NexusShadowSnapshot):
 *   matchId, competitionId, buildNowUtc, kickoffUtc,
 *   probs, weights, track4Status, calibrationSource,
 *   ensembleConfidence, createdAtUtc
 *
 * Flag format:
 *   NEXUS_SHADOW_ENABLED=comp:football-data:PD,comp:football-data:PL,...
 *   (master spec §S8.2 defines the canonical env var name as NEXUS_SHADOW_ENABLED)
 *
 * @module server/prediction/nexus-shadow-runner
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DataSource } from '@sportpulse/snapshot';
import type { NexusModelWeights } from './nexus-model-loader.js';
import { CACHE_BASE } from '../cache-dir.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Persisted NEXUS shadow snapshot for one match prediction.
 *
 * Evaluation-and-promotion spec S5.3: each scorecard entry must be traceable
 * back to the prediction that produced it. This snapshot is the audit trail.
 *
 * buildNowUtc is always the semantic time anchor (core invariant).
 * createdAtUtc is the wall-clock time the file was written (audit metadata).
 *
 * NEXUS-0 §S9.2 requires 8 fingerprint fields:
 *   matchId, buildNowUtc, kickoffUtc, featureSchemaVersion, datasetWindow,
 *   modelVersion, calibrationVersion, ensembleVersion.
 */
export interface NexusShadowSnapshot {
  matchId: string;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  /** buildNowUtc: semantic time anchor — the "now" when the prediction was made. */
  buildNowUtc: string;
  kickoffUtc: string;
  // ── Prediction fingerprint fields (NEXUS-0 §S9.2) ────────────────────────
  /** Feature schema version — tracks which features were available at prediction time. */
  featureSchemaVersion: string;
  /** Dataset window used for training (ISO interval). */
  datasetWindow: string;
  /** Model version identifier (tracks the NEXUS model release). */
  modelVersion: string;
  /** Calibration version identifier (bootstrap or trained). */
  calibrationVersion: string;
  // ─────────────────────────────────────────────────────────────────────────
  /** Calibrated 1X2 probabilities from the NEXUS meta-ensemble. */
  probs: { home: number; draw: number; away: number };
  /** Ensemble weight vector applied (after Track 4 redistribution if needed). */
  weights: { track12: number; track3: number; track4: number };
  /** Track 4 activation status. */
  track4Status: string;
  /** Whether per-league or global calibration was applied. */
  calibrationSource: string;
  /** Ensemble confidence tier: 'HIGH' | 'MEDIUM' | 'LOW'. */
  ensembleConfidence: string;
  /** Wall-clock ISO UTC timestamp when this snapshot was written. */
  createdAtUtc: string;
}

// ── NEXUS version constants (NEXUS-0 §S9.2 fingerprint fields) ────────────────

/** Feature schema version — bump when the feature set used by Track 3 changes. */
const NEXUS_FEATURE_SCHEMA_VERSION = '1.0.0';

/**
 * Dataset window for the bootstrap phase (no trained calibration yet).
 * This covers the historical data used in Track 1+2 Elo replay.
 * Update when expanding to earlier seasons.
 */
const NEXUS_DATASET_WINDOW = '2023-24+2024-25';

/** Model version — identifies this NEXUS release. Bump on Track 3 weight changes. */
const NEXUS_MODEL_VERSION = 'nexus-v2.0.0';

/**
 * Calibration version for the bootstrap phase.
 * Will be replaced by a trained date (e.g. 'trained-2026-03-20') once
 * walk-forward calibration accumulates ≥300 samples (taxonomy spec §S8.3).
 */
const NEXUS_CALIBRATION_VERSION = 'bootstrap-1.0';

// ── Flag parsing ───────────────────────────────────────────────────────────────

function parseNexusShadowFlag(): ReadonlySet<string> {
  // FINDING-001 fix: master spec §S8.2 defines the flag as NEXUS_SHADOW_ENABLED.
  const envVal = process.env.NEXUS_SHADOW_ENABLED;
  if (!envVal) return new Set();
  return new Set(
    envVal
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

let _nexusShadowEnabledCache: ReadonlySet<string> | null = null;

/** Returns true if NEXUS shadow is enabled for the given competitionId. */
function isNexusShadowEnabled(competitionId: string): boolean {
  if (_nexusShadowEnabledCache === null) {
    _nexusShadowEnabledCache = parseNexusShadowFlag();
  }
  return _nexusShadowEnabledCache.has(competitionId);
}

// ── Storage helpers ────────────────────────────────────────────────────────────

const NEXUS_SHADOW_BASE = path.join(CACHE_BASE, 'nexus-shadow');

function snapshotFilePath(competitionId: string, matchId: string): string {
  const safeCompId = competitionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const safeMatchId = matchId.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(NEXUS_SHADOW_BASE, safeCompId, `${safeMatchId}.json`);
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    throw err;
  }
}

/** Returns true if a snapshot already exists for this match. */
function snapshotExists(competitionId: string, matchId: string): boolean {
  return fs.existsSync(snapshotFilePath(competitionId, matchId));
}

// ── NEXUS engine instantiation ─────────────────────────────────────────────────

/**
 * Attempt to load the NEXUS ensemble components for a prediction.
 *
 * The NEXUS pipeline requires:
 *   - Feature store (historical match data, xG, injuries, lineups)
 *   - Weight registry (learned ensemble weights)
 *   - Calibration tables (per-liga or global)
 *   - Track outputs (Track 1+2, Track 3, Track 4)
 *
 * In Phase 4, the weight registry and calibration tables start as bootstrap
 * values. The ensemble still runs and produces valid (though bootstrap-calibrated)
 * predictions. As data accumulates, the bootstrap tables are replaced by
 * learned tables via the training pipeline.
 *
 * This function returns null if the NEXUS pipeline cannot produce a prediction
 * for this match (e.g., no historical data for either team). The caller catches
 * this and skips the match without crashing.
 */
async function runNexusPrediction(
  matchId: string,
  homeTeamId: string,
  awayTeamId: string,
  kickoffUtc: string,
  buildNowUtc: string,
  competitionId: string,
  dataSource: DataSource,
  loadedWeights: NexusModelWeights | null,
): Promise<NexusShadowSnapshot | null> {
  // Lazy import to avoid loading NEXUS modules when shadow is disabled
  const {
    runNexusEnsemble,
    buildBootstrapCalibrationTable,
    computeTrack1,
    computeTrack2,
  } = await import('@sportpulse/prediction');

  // ── Track 1+2: Real NEXUS pipeline using canonical match data ──────────────
  // taxonomy spec S4.2 (master S8.0): canonical match data is shared with V3.
  // Track 1 replays match history to estimate Elo ratings and team strengths.
  // Track 2 converts strengths to a Poisson/Dixon-Coles goals distribution.
  // Phase 1B inputs (injuries, lineups) are not wired — injuryDataAvailable = false.

  const seasonId = dataSource.getSeasonId?.(competitionId);
  if (!seasonId) return null;

  const allMatches = dataSource.getMatches(seasonId);
  const finishedMatches = allMatches.filter(
    (m) =>
      m.status === 'FINISHED' &&
      m.startTimeUtc !== null &&
      m.startTimeUtc < buildNowUtc &&
      m.scoreHome !== null &&
      m.scoreAway !== null,
  );

  // Need at least 1 finished match for each team to compute meaningful strength.
  // taxonomy spec S3.5: fewer than THRESHOLD_NOT_ELIGIBLE → NOT_ELIGIBLE.
  const homeHistory = finishedMatches.filter(
    (m) => m.homeTeamId === homeTeamId || m.awayTeamId === homeTeamId,
  );
  const awayHistory = finishedMatches.filter(
    (m) => m.homeTeamId === awayTeamId || m.awayTeamId === awayTeamId,
  );

  if (homeHistory.length === 0 || awayHistory.length === 0) {
    return null; // Insufficient history for either team
  }

  // Map canonical match data to HistoricalMatch shape required by Track 1.
  // SPEC-DEVIATION (FINDING-006): Taxonomy spec §S3.2 prohibits defaulting isNeutralVenue.
  // However, the canonical DataSource.getMatches() DTO does not expose a neutralVenue field.
  // Until the canonical DTO is extended to include neutralVenue, defaulting to false for
  // domestic league matches (where neutral venue is extremely rare). A formal spec amendment
  // is required to authorize this default — tracked as a pending spec change request.
  const historicalMatches = finishedMatches.map((m) => ({
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    utcDate: m.startTimeUtc!,
    homeGoals: m.scoreHome!,
    awayGoals: m.scoreAway!,
    // SPEC-DEVIATION: canonical DTO does not expose neutralVenue — defaulting to false
    // pending DTO extension. See taxonomy spec §S3.2 + audit FINDING-006.
    isNeutralVenue: false,
  }));

  // Extract league code from competitionId (e.g. "comp:football-data:PD" → "PD").
  const leagueCode = extractLeagueCode(competitionId);

  // Step 1: Track 1 — compute team strength estimates via Elo replay.
  // taxonomy spec S3.1–S3.5.
  const track1Output = computeTrack1(
    homeTeamId,
    awayTeamId,
    historicalMatches,
    false, // isNeutralVenue — standard venue for domestic league matches
    leagueCode,
    buildNowUtc,
    // phase1bOptions omitted: Phase 1B (injuries, lineup) not wired in this phase
  );

  // Step 2: Track 2 — bivariate Poisson + Dixon-Coles goals model.
  // taxonomy spec S4.1–S4.7.
  const track2Output = computeTrack2(track1Output, leagueCode);

  // Log SCORELINE_SUM_VIOLATION if pre-normalization sum was outside [0.999, 1.001].
  // taxonomy spec S4.4: "must be logged as SCORELINE_SUM_VIOLATION."
  if (track2Output._scorelineSumViolation) {
    console.warn(
      `[NexusShadow] SCORELINE_SUM_VIOLATION for ${matchId}: ` +
      `lambdaHome=${track2Output.lambdaHome.toFixed(4)}, ` +
      `lambdaAway=${track2Output.lambdaAway.toFixed(4)}`,
    );
  }

  // Combined Track 1+2 output for the ensemble.
  // taxonomy spec S7.2: "Track 1+2 is a single ensemble member."
  const track12 = {
    probs: {
      home: track2Output.p_home,
      draw: track2Output.p_draw,
      away: track2Output.p_away,
    },
  };

  // Track 3: Logistic context model (active when weights are loaded)
  // taxonomy spec S5.1–S5.7: contextual features + logistic softmax.
  // When weights are absent (loadedWeights?.track3Global is null),
  // track3 = null and the ensemble falls back to Track 1+2 only per taxonomy spec S9.3.
  let track3: { probs: { home: number; draw: number; away: number } } | null = null;
  if (loadedWeights?.track3Global != null) {
    try {
      const { computeTrack3 } = await import('@sportpulse/prediction');

      // Derive table position proxies — unavailable in shadow mode (no standings API)
      // Position = 0 signals unavailable; competitiveImportance defaults to NEUTRAL.
      const track3Output = computeTrack3(
        homeTeamId,
        awayTeamId,
        buildNowUtc,
        historicalMatches,  // already built above (anti-lookahead filtered inside computeTrack3)
        track1Output.homeStrength.eloRating,
        track1Output.awayStrength.eloRating,
        0, // homePosition: unavailable in shadow mode
        0, // awayPosition: unavailable in shadow mode
        20, // totalTeams: conservative default for European leagues
        0,  // matchday: unavailable; seasonPhase defaults to EARLY (neutral)
        loadedWeights.track3Global,
      );

      track3 = { probs: track3Output.probs };
    } catch (err: unknown) {
      // Fault-isolated: Track 3 failure must never crash the shadow runner
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[NexusShadow] Track 3 failed for ${matchId}: ${msg}`);
      track3 = null;
    }
  }

  // Track 4: Not wired in Phase 4 (requires live odds feed to be connected)
  const track4 = { status: 'DEACTIVATED' as const };

  // Weight registry: Bootstrap values until walk-forward training accumulates
  const bootstrapWeightRegistry = buildBootstrapWeightRegistry();

  // Calibration tables: Bootstrap until >= 300 samples accumulated
  const calibTables = new Map([
    ['global', buildBootstrapCalibrationTable()],
  ]);

  // Determine prediction horizon
  const msToKickoff = new Date(kickoffUtc).getTime() - new Date(buildNowUtc).getTime();
  const hoursToKickoff = msToKickoff / (1000 * 3600);
  const horizon = hoursToKickoff > 48 ? 'FAR' : hoursToKickoff > 24 ? 'MEDIUM' : 'NEAR';

  // Data quality tier: MINIMAL in Phase 4 (no xG, injuries, or lineup data)
  const quality = 'MINIMAL' as const;

  // leagueCode already extracted above (before Track 1 call)

  // Run the full NEXUS meta-ensemble
  const output = runNexusEnsemble(
    track12,
    track3,
    track4,
    bootstrapWeightRegistry,
    calibTables,
    leagueCode,
    horizon,
    quality,
  );

  return {
    matchId,
    competitionId,
    homeTeamId,
    awayTeamId,
    buildNowUtc,
    kickoffUtc,
    // NEXUS-0 §S9.2 prediction fingerprint fields (FINDING-002 fix)
    featureSchemaVersion: NEXUS_FEATURE_SCHEMA_VERSION,
    datasetWindow: NEXUS_DATASET_WINDOW,
    modelVersion: NEXUS_MODEL_VERSION,
    calibrationVersion: NEXUS_CALIBRATION_VERSION,
    probs: output.probs,
    weights: {
      track12: output.weights.track12,
      track3: output.weights.track3,
      track4: output.weights.track4,
    },
    track4Status: output.track4_status,
    calibrationSource: output.calibration_source,
    ensembleConfidence: output.ensemble_confidence,
    createdAtUtc: new Date().toISOString(),
  };
}

// ── Bootstrap helpers (Phase 4) ───────────────────────────────────────────────

const DECAY_XI = 0.006; // per day, same as V3 / radar
const MS_PER_DAY = 86_400_000;
const HOME_ADV = 1.15;

interface TeamStrength {
  attack: number;
  defense: number;
  games: number;
}

function computeBootstrapStrength(
  teamId: string,
  matches: Array<{
    homeTeamId: string;
    awayTeamId: string;
    startTimeUtc: string | null;
    scoreHome: number | null;
    scoreAway: number | null;
  }>,
  buildNowUtc: string,
): TeamStrength {
  const buildMs = new Date(buildNowUtc).getTime();
  let wAttack = 0, wDefense = 0, wTotal = 0, games = 0;

  for (const m of matches) {
    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;
    if (!isHome && !isAway) continue;
    if (!m.startTimeUtc || m.scoreHome === null || m.scoreAway === null) continue;

    const scored = isHome ? m.scoreHome : m.scoreAway;
    const conceded = isHome ? m.scoreAway : m.scoreHome;
    const daysAgo = (buildMs - new Date(m.startTimeUtc).getTime()) / MS_PER_DAY;
    const w = Math.exp(-DECAY_XI * daysAgo);

    wAttack += scored * w;
    wDefense += conceded * w;
    wTotal += w;
    games++;
  }

  return {
    attack: wTotal > 0 ? wAttack / wTotal : 1.3,
    defense: wTotal > 0 ? wDefense / wTotal : 1.1,
    games,
  };
}

function strengthToProbs(
  home: TeamStrength,
  away: TeamStrength,
): { home: number; draw: number; away: number } {
  const lh = ((home.attack + away.defense) / 2) * HOME_ADV;
  const la = (away.attack + home.defense) / 2;

  let hw = 0, dr = 0, aw = 0;
  const maxGoals = 7;

  for (let h = 0; h <= maxGoals; h++) {
    const ph = poissonPmf(lh, h);
    for (let a = 0; a <= maxGoals; a++) {
      const p = ph * poissonPmf(la, a);
      if (h > a) hw += p;
      else if (h === a) dr += p;
      else aw += p;
    }
  }

  const total = hw + dr + aw || 1;
  return { home: hw / total, draw: dr / total, away: aw / total };
}

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function buildBootstrapWeightRegistry(): import('@sportpulse/prediction').WeightRegistry {
  // Bootstrap weights: Track 1+2 gets full weight (Track 3 and 4 inactive in Phase 4)
  const bootstrapVector = { track12: 1.0, track3: 0.0, track4: 0.0 };
  return {
    segments: {},
    global: bootstrapVector,
    ensembleVersion: 'nexus-ensemble-bootstrap-v1.0',
    // FINDING-007 fix: use the actual startup time rather than a hardcoded past date.
    // For bootstrap weights (known constants, not trained), learnedAt reflects
    // when the registry was instantiated, which is the best available proxy for
    // "when these weights became active on this server instance."
    learnedAt: new Date().toISOString(),
  };
}

function extractLeagueCode(competitionId: string): string {
  // "comp:football-data:PD" → "PD"
  const parts = competitionId.split(':');
  return parts[parts.length - 1] ?? competitionId;
}

// ── Main runner ───────────────────────────────────────────────────────────────

/**
 * Run NEXUS shadow predictions for all eligible pre-kickoff fixtures.
 *
 * Called fire-and-forget from the server's refresh cycle.
 * Never throws — all errors are caught, logged, and the server continues.
 *
 * Eligibility criteria:
 *   1. PREDICTION_NEXUS_SHADOW_ENABLED includes this competitionId.
 *   2. Match status is SCHEDULED.
 *   3. kickoffUtc > buildNowUtc (strict pre-kickoff).
 *   4. No existing snapshot for this match (idempotent).
 *
 * @param dataSource     DataSource with canonical match data.
 * @param competitionIds Competition IDs to process.
 * @param loadedWeights  Optional pre-loaded NEXUS model weights. When null, Track 3 is deactivated.
 */
export async function runNexusShadow(
  dataSource: DataSource,
  competitionIds: string[],
  loadedWeights?: NexusModelWeights | null,
): Promise<void> {
  try {
    const buildNowUtc = new Date().toISOString();

    for (const competitionId of competitionIds) {
      // ── 1. Flag check ─────────────────────────────────────────────────────
      if (!isNexusShadowEnabled(competitionId)) continue;

      // ── 2. Get season data ────────────────────────────────────────────────
      const seasonId = dataSource.getSeasonId?.(competitionId);
      if (!seasonId) {
        console.warn(`[NexusShadow] No seasonId for ${competitionId}`);
        continue;
      }

      const allMatches = dataSource.getMatches(seasonId);

      // ── 3. Filter eligible pre-kickoff fixtures ───────────────────────────
      const eligible = allMatches.filter(
        (m) =>
          m.status === 'SCHEDULED' &&
          m.startTimeUtc !== null &&
          m.startTimeUtc > buildNowUtc, // strict pre-kickoff (spec S6.2)
      );

      if (eligible.length === 0) continue;

      let predicted = 0;

      // ── 4. Predict each eligible match ────────────────────────────────────
      for (const match of eligible) {
        if (!match.startTimeUtc) continue;

        // Idempotency: skip if snapshot already persisted
        if (snapshotExists(competitionId, match.matchId)) continue;

        try {
          const snapshot = await runNexusPrediction(
            match.matchId,
            match.homeTeamId,
            match.awayTeamId,
            match.startTimeUtc,
            buildNowUtc,
            competitionId,
            dataSource,
            loadedWeights ?? null,
          );

          if (snapshot === null) {
            // Insufficient data for this match — not an error
            continue;
          }

          // ── 5. Pre-kickoff guard (defense in depth) ───────────────────────
          // Already guaranteed by eligible filter above, but re-check here
          // to satisfy the spec requirement at the persistence layer.
          if (snapshot.buildNowUtc >= snapshot.kickoffUtc) {
            console.warn(
              `[NexusShadow] Pre-kickoff guard rejected ${match.matchId}: ` +
              `buildNowUtc=${snapshot.buildNowUtc} >= kickoffUtc=${snapshot.kickoffUtc}`,
            );
            continue;
          }

          // ── 6. Persist atomically ─────────────────────────────────────────
          const filePath = snapshotFilePath(competitionId, match.matchId);
          atomicWriteJson(filePath, snapshot);
          predicted++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[NexusShadow] prediction failed for ${match.matchId}: ${msg}`);
          // Continue with next match — per-match fault isolation
        }
      }

      if (predicted > 0) {
        console.log(
          `[NexusShadow] ${competitionId}: ${predicted}/${eligible.length} predictions stored`,
        );
      }
    }
  } catch (err: unknown) {
    // Outer fault isolation: never crash the server
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[NexusShadow] unexpected outer error: ${msg}`);
  }
}

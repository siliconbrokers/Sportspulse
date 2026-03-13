/**
 * global-calibrator-store.ts — Loads the trained global isotonic calibrator.
 *
 * Reads the artifact produced by scripts/train-global-calibrator.ts from:
 *   cache/calibration/global-isotonic-v1.json
 *
 * Returns a CalibrationRegistry suitable for injection into PredictionService.
 *
 * Failure modes:
 *   - File not found → returns null (caller falls back to identity)
 *   - Parse error    → returns null + logs warning
 *   - Insufficient samples → returns null
 *
 * The server never crashes due to missing calibrator — it degrades gracefully
 * to identity (raw probabilities pass through unchanged).
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IsotonicCalibrator,
  deserializeOneVsRestCalibrators,
} from '@sportpulse/prediction';
import type {
  CalibrationRegistry,
  OneVsRestCalibrators,
  SerializedOneVsRestCalibrators,
} from '@sportpulse/prediction';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, '../..');
const ARTIFACT    = path.join(ROOT, 'cache', 'calibration', 'global-isotonic-v1.json');

// ── Artifact schema ────────────────────────────────────────────────────────

interface GlobalCalibratorArtifact {
  version:              string;
  trained_at:           string;
  n_samples:            number;
  n_files:              number;
  prediction_cutoff_ms: number;
  calibrators:          SerializedOneVsRestCalibrators;
}

// ── Identity fallback ──────────────────────────────────────────────────────

function createIdentityCalibrators(): OneVsRestCalibrators {
  return {
    home: IsotonicCalibrator.createIdentity(),
    draw: IsotonicCalibrator.createIdentity(),
    away: IsotonicCalibrator.createIdentity(),
  };
}

function createIdentityRegistry(): CalibrationRegistry {
  return {
    segments: new Map(),
    global: {
      segment_id:   'global',
      calibrators:  createIdentityCalibrators(),
      sample_count: 0,
    },
  };
}

// ── Loader ─────────────────────────────────────────────────────────────────

/**
 * Attempts to load the trained global calibrator artifact.
 *
 * @returns CalibrationRegistry with trained calibrators, or null if unavailable.
 */
export function loadGlobalCalibratorRegistry(): CalibrationRegistry | null {
  if (!fs.existsSync(ARTIFACT)) {
    console.warn(
      '[GlobalCalibrator] Artifact not found at',
      ARTIFACT,
      '— using identity calibration. Run: pnpm train:calibrator',
    );
    return null;
  }

  let artifact: GlobalCalibratorArtifact;
  try {
    artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')) as GlobalCalibratorArtifact;
  } catch (err) {
    console.warn('[GlobalCalibrator] Failed to parse artifact:', err);
    return null;
  }

  if (!artifact.calibrators || artifact.n_samples < 100) {
    console.warn(
      '[GlobalCalibrator] Artifact invalid or insufficient samples:',
      artifact.n_samples,
    );
    return null;
  }

  let calibrators: OneVsRestCalibrators;
  try {
    calibrators = deserializeOneVsRestCalibrators(artifact.calibrators);
  } catch (err) {
    console.warn('[GlobalCalibrator] Failed to deserialize calibrators:', err);
    return null;
  }

  console.info(
    `[GlobalCalibrator] Loaded global-isotonic-v1 — ${artifact.n_samples} samples,`,
    `trained ${artifact.trained_at}`,
  );

  return {
    segments: new Map(),
    global: {
      segment_id:   'global',
      calibrators,
      sample_count: artifact.n_samples,
    },
  };
}

/**
 * Returns the best available CalibrationRegistry.
 *
 * Falls back to identity registry if the trained artifact is unavailable.
 */
export function getBestCalibrationRegistry(): CalibrationRegistry {
  return loadGlobalCalibratorRegistry() ?? createIdentityRegistry();
}

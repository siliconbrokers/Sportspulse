/**
 * nexus-model-loader.ts — Load NEXUS learned model weights at server startup.
 *
 * Reads pre-trained model weight files from the cache directory.
 * Designed for graceful degradation: if a file is absent or corrupt,
 * the corresponding entry is null and the shadow runner continues without
 * that track (Track 3 remains null in the ensemble).
 *
 * Spec authority:
 *   - master spec S8.1: shadow mode semantics — predictions still valid
 *     when Track 3 weights are absent (ensemble falls back to Track 1+2 only).
 *   - taxonomy spec S5.4b: missingness policy — explicit null, not silent imputation.
 *   - NEXUS-0 S6.1: MISSING sentinel — presence of weights must be explicit.
 *
 * Fault isolation:
 *   All file I/O errors are caught and result in null returns.
 *   Never throws — server startup must not be blocked by missing model files.
 *
 * @module server/prediction/nexus-model-loader
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LogisticWeights } from '@sportpulse/prediction';

// ── Public types ───────────────────────────────────────────────────────────

/**
 * Container for all NEXUS learned model weights.
 *
 * Each field is either the loaded weights object or null.
 * null means "file absent or unreadable" — not an error.
 * The shadow runner checks each field before using the corresponding track.
 */
export interface NexusModelWeights {
  /** Global Track 3 logistic weights. null if cache/nexus-models/track3-weights-global.json absent. */
  track3Global: LogisticWeights | null;
  /**
   * Metadata about the loaded file (for logging / audit).
   * Only populated when track3Global !== null.
   */
  track3Meta: {
    version: string;
    trainedAt: string;
    samples: number;
    leagues: string[];
    finalLoss: number;
    trainAccuracy: number;
  } | null;
}

// ── File schema (mirrors tools/train-track3.ts output) ────────────────────

interface Track3WeightsFile {
  version: string;
  trainedAt: string;
  samples: number;
  leagues: string[];
  finalLoss: number;
  trainAccuracy: number;
  weights: LogisticWeights;
}

/** Minimal structural validation of the weights file content. */
function isValidTrack3WeightsFile(obj: unknown): obj is Track3WeightsFile {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  if (typeof o['version'] !== 'string') return false;
  if (typeof o['trainedAt'] !== 'string') return false;
  if (typeof o['samples'] !== 'number') return false;
  if (!Array.isArray(o['leagues'])) return false;
  if (typeof o['weights'] !== 'object' || o['weights'] === null) return false;

  // Spot-check a few required weight fields
  const w = o['weights'] as Record<string, unknown>;
  const requiredFields: (keyof LogisticWeights)[] = [
    'intercept_home', 'intercept_draw', 'intercept_away',
    'eloDiff_home', 'eloDiff_draw', 'eloDiff_away',
  ];
  for (const field of requiredFields) {
    if (typeof w[field] !== 'number') return false;
  }

  return true;
}

// ── Main loader function ───────────────────────────────────────────────────

/**
 * Load NEXUS model weights from the cache directory.
 *
 * @param cacheDir - Absolute path to the cache directory (process.cwd()/cache).
 * @returns NexusModelWeights — with null entries for any missing/corrupt files.
 */
export async function loadNexusModelWeights(cacheDir: string): Promise<NexusModelWeights> {
  const track3FilePath = path.join(cacheDir, 'nexus-models', 'track3-weights-global.json');

  let track3Global: LogisticWeights | null = null;
  let track3Meta: NexusModelWeights['track3Meta'] = null;

  // ── Track 3 global weights ───────────────────────────────────────────────
  if (fs.existsSync(track3FilePath)) {
    try {
      const raw = fs.readFileSync(track3FilePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (isValidTrack3WeightsFile(parsed)) {
        track3Global = parsed.weights;
        track3Meta = {
          version: parsed.version,
          trainedAt: parsed.trainedAt,
          samples: parsed.samples,
          leagues: parsed.leagues,
          finalLoss: parsed.finalLoss,
          trainAccuracy: parsed.trainAccuracy,
        };
        console.log(
          `[NexusModelLoader] Track 3 weights loaded: v${parsed.version}, ` +
          `${parsed.samples} samples, ` +
          `leagues=[${parsed.leagues.join(',')}], ` +
          `trainAcc=${(parsed.trainAccuracy * 100).toFixed(1)}%`,
        );
      } else {
        console.warn(
          `[NexusModelLoader] Track 3 weights file invalid (failed structural validation): ${track3FilePath}`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[NexusModelLoader] Failed to read Track 3 weights: ${msg}`);
      // track3Global remains null — graceful degradation
    }
  } else {
    // File absent: normal state when train-track3 hasn't been run yet
    console.log(`[NexusModelLoader] Track 3 weights not found (${track3FilePath}) — Track 3 will be null in ensemble`);
  }

  return { track3Global, track3Meta };
}

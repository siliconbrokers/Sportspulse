/**
 * Radar SportPulse v2 — Snapshot Writer
 * Spec: spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md §11, §12, §13
 *
 * Atomic write via temp-file rename.
 * Writes to data/radar-v2/ to avoid contaminating v1 history.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RadarV2Snapshot } from './radar-v2-types.js';

const DATA_DIR = path.join(process.cwd(), 'data', 'radar-v2');

/**
 * Builds the directory path for a given v2 radar scope.
 */
export function radarV2ScopeDir(
  competitionKey: string,
  seasonKey: string,
  matchday: number | string,
): string {
  return path.join(DATA_DIR, competitionKey, String(seasonKey), `matchday_${matchday}`);
}

/**
 * Writes a radar v2 snapshot atomically.
 * Single file per scope (index.json contains everything including cards).
 */
export async function writeV2Snapshot(
  snapshot: RadarV2Snapshot,
  dir: string,
): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  await writeAtomicJson(path.join(dir, 'index.json'), snapshot);
}

/**
 * Updates an existing snapshot with verdict data.
 * Read-modify-write atomically.
 */
export async function updateV2SnapshotVerdicts(
  dir: string,
  updater: (snapshot: RadarV2Snapshot) => RadarV2Snapshot,
): Promise<RadarV2Snapshot | null> {
  const filePath = path.join(dir, 'index.json');
  const existing = await readJsonFile<RadarV2Snapshot>(filePath);
  if (!existing) return null;

  const updated = updater(existing);
  await writeAtomicJson(filePath, updated);
  return updated;
}

/**
 * Atomic write: write to .tmp, validate JSON, rename to target.
 */
async function writeAtomicJson(targetPath: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  // Validate JSON round-trip
  JSON.parse(json);

  const tmpPath = `${targetPath}.tmp`;
  await fs.promises.writeFile(tmpPath, json, 'utf8');
  await fs.promises.rename(tmpPath, targetPath);
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

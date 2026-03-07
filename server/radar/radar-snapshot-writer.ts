/**
 * Radar SportPulse — Snapshot Writer
 * Spec: radar-03-json-contracts-and-lifecycle.md §11, §12, §13
 *
 * Atomic write via temp-file rename.
 * Write order: match files first, index last (spec §11).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RadarIndexSnapshot, RadarMatchSnapshot } from './radar-types.js';

const DATA_DIR = path.join(process.cwd(), 'data', 'radar');

/**
 * Builds the directory path for a given radar scope.
 */
export function radarScopeDir(competitionKey: string, seasonKey: string, matchday: number): string {
  return path.join(DATA_DIR, competitionKey, seasonKey, `matchday_${matchday}`);
}

/**
 * Writes a radar-match snapshot atomically.
 */
export async function writeMatchSnapshot(
  snapshot: RadarMatchSnapshot,
  dir: string,
): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = `match_${snapshot.matchId}.json`;
  await writeAtomicJson(path.join(dir, filename), snapshot);
}

/**
 * Writes the radar-index snapshot atomically.
 * Must be called AFTER all match snapshots are written.
 */
export async function writeIndexSnapshot(
  snapshot: RadarIndexSnapshot,
  dir: string,
): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  await writeAtomicJson(path.join(dir, 'index.json'), snapshot);
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

/**
 * Updates only the post-match fields of an existing match snapshot.
 * Reads current file, merges, writes atomically.
 */
export async function updateMatchSnapshotVerdict(
  dir: string,
  matchId: string,
  updates: Partial<RadarMatchSnapshot>,
): Promise<void> {
  const filePath = path.join(dir, `match_${matchId}.json`);
  const existing = await readJsonFile<RadarMatchSnapshot>(filePath);
  if (!existing) throw new Error(`Match snapshot not found: ${filePath}`);

  const updated: RadarMatchSnapshot = { ...existing, ...updates };
  await writeAtomicJson(filePath, updated);
}

/**
 * Updates the radar-index snapshot with card state and module state.
 */
export async function updateIndexSnapshot(
  dir: string,
  updates: Partial<RadarIndexSnapshot>,
): Promise<void> {
  const filePath = path.join(dir, 'index.json');
  const existing = await readJsonFile<RadarIndexSnapshot>(filePath);
  if (!existing) throw new Error(`Index snapshot not found: ${filePath}`);

  const updated: RadarIndexSnapshot = { ...existing, ...updates };
  await writeAtomicJson(filePath, updated);
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

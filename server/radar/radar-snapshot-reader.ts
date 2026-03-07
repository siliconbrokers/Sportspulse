/**
 * Radar SportPulse — Snapshot Reader
 * Spec: radar-03-json-contracts-and-lifecycle.md §14, §15
 */

import path from 'node:path';
import type { RadarIndexSnapshot, RadarMatchSnapshot } from './radar-types.js';
import { radarScopeDir, readJsonFile } from './radar-snapshot-writer.js';

export interface RadarReadResult {
  index: RadarIndexSnapshot | null;
  matchSnapshots: Map<string, RadarMatchSnapshot>;
  /** true if index exists but some detail files are missing */
  degraded: boolean;
  /** true if the index JSON was corrupt */
  corrupt: boolean;
}

/**
 * Reads the full radar snapshot for a given scope.
 * Returns degraded state if detail files are missing.
 * Returns corrupt=true and null index if JSON is invalid.
 */
export async function readRadarSnapshot(
  competitionKey: string,
  seasonKey: string,
  matchday: number,
): Promise<RadarReadResult> {
  const dir = radarScopeDir(competitionKey, seasonKey, matchday);
  const indexPath = path.join(dir, 'index.json');

  const index = await readJsonFile<RadarIndexSnapshot>(indexPath);

  if (!index) {
    return { index: null, matchSnapshots: new Map(), degraded: false, corrupt: false };
  }

  // Validate minimal structure
  if (!index.schemaVersion || !index.cards || !Array.isArray(index.cards)) {
    return { index: null, matchSnapshots: new Map(), degraded: false, corrupt: true };
  }

  const matchSnapshots = new Map<string, RadarMatchSnapshot>();
  let degraded = false;

  for (const card of index.cards) {
    if (!card.detailFile) continue;
    const detailPath = path.join(dir, card.detailFile);
    const detail = await readJsonFile<RadarMatchSnapshot>(detailPath);
    if (detail) {
      matchSnapshots.set(card.matchId, detail);
    } else {
      degraded = true;
      // Log but continue — index.json can still render minimal card
      console.warn(`[RadarReader] Missing detail file: ${detailPath}`);
    }
  }

  return { index, matchSnapshots, degraded, corrupt: false };
}

/**
 * Checks if a snapshot exists for a given scope (fast check, no full read).
 */
export async function snapshotExists(
  competitionKey: string,
  seasonKey: string,
  matchday: number,
): Promise<boolean> {
  const dir = radarScopeDir(competitionKey, seasonKey, matchday);
  const index = await readJsonFile<RadarIndexSnapshot>(path.join(dir, 'index.json'));
  return index !== null;
}

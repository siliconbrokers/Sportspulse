/**
 * Radar SportPulse v2 — Snapshot Reader
 * Spec: spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md §14, §15
 */

import path from 'node:path';
import type { RadarV2Snapshot } from './radar-v2-types.js';
import { radarV2ScopeDir, readJsonFile } from './radar-v2-snapshot-writer.js';

export interface RadarV2ReadResult {
  snapshot: RadarV2Snapshot | null;
  corrupt: boolean;
}

/**
 * Reads the v2 radar snapshot for a given scope.
 */
export async function readV2Snapshot(
  competitionKey: string,
  seasonKey: string,
  matchday: number | string,
): Promise<RadarV2ReadResult> {
  const dir = radarV2ScopeDir(competitionKey, seasonKey, matchday);
  const indexPath = path.join(dir, 'index.json');

  const snapshot = await readJsonFile<RadarV2Snapshot>(indexPath);

  if (!snapshot) {
    return { snapshot: null, corrupt: false };
  }

  // Minimal structural validation
  if (
    snapshot.schemaVersion !== '2.0.0' ||
    !Array.isArray(snapshot.cards)
  ) {
    return { snapshot: null, corrupt: true };
  }

  return { snapshot, corrupt: false };
}

/**
 * Checks if a v2 snapshot exists for a given scope (fast check).
 */
export async function v2SnapshotExists(
  competitionKey: string,
  seasonKey: string,
  matchday: number | string,
): Promise<boolean> {
  const dir = radarV2ScopeDir(competitionKey, seasonKey, matchday);
  const snapshot = await readJsonFile<RadarV2Snapshot>(path.join(dir, 'index.json'));
  return snapshot !== null && snapshot.schemaVersion === '2.0.0';
}

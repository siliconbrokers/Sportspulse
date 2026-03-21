import * as fs from 'node:fs';
import * as path from 'node:path';
import { SNAPSHOT_SCHEMA_VERSION } from '../dto/snapshot-header.js';
import type { DashboardSnapshotDTO } from '../dto/dashboard-snapshot.js';

// ---------------------------------------------------------------------------
// Seed file format
// ---------------------------------------------------------------------------

export interface SnapshotSeedFile {
  version: 1;
  savedAt: string;
  snapshotSchemaVersion: number;
  policyKey: string;
  policyVersion: number;
  competitionId: string;
  snapshot: DashboardSnapshotDTO;
}

export interface ValidatedSeed {
  competitionId: string;
  snapshot: DashboardSnapshotDTO;
}

// ---------------------------------------------------------------------------
// Seed file path helper
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path for a seed file given the seedDir, competitionId,
 * and schema version. The file is scoped by schema version so incompatible seeds
 * are naturally segregated.
 *
 * Path: {seedDir}/{competitionId}-{snapshotSchemaVersion}.seed.json
 * The competitionId is sanitized so special chars (`:`) become `-`.
 */
export function buildSeedPath(seedDir: string, competitionId: string): string {
  const safeId = competitionId.replace(/[^a-zA-Z0-9_.-]/g, '-');
  return path.join(seedDir, `${safeId}-${SNAPSHOT_SCHEMA_VERSION}.seed.json`);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a raw (parsed JSON) seed file against current runtime expectations.
 * Returns the validated seed on success, null on any mismatch or missing field.
 * Emits a structured warning log on rejection so issues are traceable.
 */
export function validateSeed(
  raw: unknown,
  currentPolicyKey: string,
  currentPolicyVersion: number,
): ValidatedSeed | null {
  if (!raw || typeof raw !== 'object') {
    console.warn('[SnapshotSeedStore] Rejected seed: not an object');
    return null;
  }

  const obj = raw as Record<string, unknown>;

  if (obj['version'] !== 1) {
    console.warn(`[SnapshotSeedStore] Rejected seed: unsupported version=${obj['version']}`);
    return null;
  }

  if (
    typeof obj['snapshotSchemaVersion'] !== 'number' ||
    obj['snapshotSchemaVersion'] !== SNAPSHOT_SCHEMA_VERSION
  ) {
    console.warn(
      `[SnapshotSeedStore] Rejected seed: snapshotSchemaVersion mismatch ` +
        `(seed=${obj['snapshotSchemaVersion']}, current=${SNAPSHOT_SCHEMA_VERSION})`,
    );
    return null;
  }

  if (typeof obj['policyKey'] !== 'string' || obj['policyKey'] !== currentPolicyKey) {
    console.warn(
      `[SnapshotSeedStore] Rejected seed: policyKey mismatch ` +
        `(seed=${obj['policyKey']}, current=${currentPolicyKey})`,
    );
    return null;
  }

  if (typeof obj['policyVersion'] !== 'number' || obj['policyVersion'] !== currentPolicyVersion) {
    console.warn(
      `[SnapshotSeedStore] Rejected seed: policyVersion mismatch ` +
        `(seed=${obj['policyVersion']}, current=${currentPolicyVersion})`,
    );
    return null;
  }

  if (typeof obj['competitionId'] !== 'string' || !obj['competitionId']) {
    console.warn('[SnapshotSeedStore] Rejected seed: missing competitionId');
    return null;
  }

  if (!obj['snapshot'] || typeof obj['snapshot'] !== 'object') {
    console.warn('[SnapshotSeedStore] Rejected seed: missing or invalid snapshot payload');
    return null;
  }

  const snapshot = obj['snapshot'] as DashboardSnapshotDTO;
  if (!snapshot.header || !snapshot.teams || !snapshot.warnings) {
    console.warn('[SnapshotSeedStore] Rejected seed: snapshot payload missing required fields');
    return null;
  }

  return {
    competitionId: obj['competitionId'] as string,
    snapshot,
  };
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

/**
 * Atomically persists a seed file to disk (.tmp → rename).
 * Never throws — errors are caught and logged so they never block the response path.
 */
export async function persistSeed(
  competitionId: string,
  snapshot: DashboardSnapshotDTO,
  seedDir: string,
): Promise<void> {
  try {
    await fs.promises.mkdir(seedDir, { recursive: true });

    const seedFile: SnapshotSeedFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      policyKey: snapshot.header.policyKey,
      policyVersion: snapshot.header.policyVersion,
      competitionId,
      snapshot,
    };

    const targetPath = buildSeedPath(seedDir, competitionId);
    const tmpPath = `${targetPath}.tmp`;

    await fs.promises.writeFile(tmpPath, JSON.stringify(seedFile), 'utf8');
    await fs.promises.rename(tmpPath, targetPath);
  } catch (err) {
    console.error(`[SnapshotSeedStore] Failed to persist seed for ${competitionId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Reads all seed files from seedDir, validates each, and returns the valid ones.
 * Invalid or corrupt files are skipped with a structured warning — never throw.
 * Returns an empty array if the directory does not exist or is unreadable.
 */
export async function loadSeeds(
  seedDir: string,
  currentPolicyKey: string,
  currentPolicyVersion: number,
): Promise<ValidatedSeed[]> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(seedDir);
  } catch {
    // Directory may not exist yet (first startup before any successful build)
    return [];
  }

  const seedFiles = entries.filter((e) => e.endsWith('.seed.json'));
  const results: ValidatedSeed[] = [];

  for (const filename of seedFiles) {
    const filePath = path.join(seedDir, filename);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      const validated = validateSeed(parsed, currentPolicyKey, currentPolicyVersion);
      if (validated) {
        results.push(validated);
        console.log(
          `[SnapshotSeedStore] Loaded seed for ${validated.competitionId} from ${filename}`,
        );
      }
    } catch (err) {
      console.warn(`[SnapshotSeedStore] Skipping corrupt seed file ${filename}:`, err);
    }
  }

  return results;
}

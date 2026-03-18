/**
 * NEXUS Raw Odds Store — Append-Only Immutable File Store
 *
 * Spec authority:
 *   market-signal-policy S11.3 (weight traceability / reproducibility)
 *   market-signal-policy S8.3 (auditability — oddsEffectiveAt, oddsSource per prediction)
 *   NEXUS-0 S3.1 (as-of semantics — all reads are as-of buildNowUtc)
 *   NEXUS-0 S9.3 (reproducibility — given buildNowUtc, reconstruct exact feature set)
 *
 * DESIGN: APPEND-ONLY, IMMUTABLE
 *
 * Rationale:
 *   The canonical serving view (canonical-serving-view.ts) is purely derived
 *   from the raw store. If records were overwritten, the ability to reconstruct
 *   the as-of state at any past buildNowUtc would be destroyed, breaking:
 *     1. Training/serving parity (NEXUS-0 S9.4).
 *     2. Anti-circular audit trails (MSP S8.3).
 *     3. Reproducibility of historical predictions (NEXUS-0 S9.3).
 *
 * FILE LAYOUT (partition by match_id / provider / snapshot):
 *   {cacheDir}/odds-raw/{match_id}/{provider}/{snapshot_utc_safe}.json
 *
 *   snapshot_utc_safe = snapshot_utc with ':' replaced by '-' for FS safety.
 *   Example: "2025-01-15T10:00:00Z" → "2025-01-15T10-00-00Z"
 *
 * IDEMPOTENCY:
 *   Writing the same (match_id, provider, snapshot_utc) twice is a no-op.
 *   The file is not overwritten. Even if the caller passes a record with
 *   different odds values but the same key, the first write wins.
 *   Rationale: snapshot_utc identifies a specific market state. If we receive
 *   conflicting data for the same snapshot moment, the first ingestion is the
 *   canonical record. Conflicts are logged externally (FeatureConflictEvent
 *   pattern from NEXUS-0 S4.6) but not silently resolved by overwriting.
 *
 * ATOMIC WRITE:
 *   All writes go to a .tmp file first, then are renamed atomically.
 *   This prevents partial reads if the process is interrupted mid-write.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { OddsRecord, OddsProvider } from './types.js';

// ── Path construction ──────────────────────────────────────────────────────

/**
 * Convert a snapshot_utc string to a filesystem-safe filename component.
 * Replaces ':' (illegal in some filesystems) with '-'.
 *
 * Example: "2025-01-15T10:00:00Z" → "2025-01-15T10-00-00Z"
 */
function safeSnapshotFilename(snapshotUtc: string): string {
  return snapshotUtc.replace(/:/g, '-');
}

/**
 * Derive the full file path for a given odds record.
 *
 * Layout: {cacheDir}/odds-raw/{match_id}/{provider}/{snapshot_utc_safe}.json
 *
 * The partition by match_id / provider allows loadOddsRecordsForProvider
 * to list a single directory rather than scanning the full store.
 */
function deriveRecordPath(record: OddsRecord, cacheDir: string): string {
  const filename = safeSnapshotFilename(record.snapshot_utc) + '.json';
  return path.join(
    cacheDir,
    'odds-raw',
    record.match_id,
    record.provider,
    filename,
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Append an OddsRecord to the raw store.
 *
 * IDEMPOTENT: If a file already exists at the derived path (same
 * match_id + provider + snapshot_utc), this function is a no-op.
 * The existing file is never overwritten.
 *
 * ATOMIC: New records are written to a .tmp file and then renamed.
 * If the process crashes between write and rename, the .tmp file
 * is abandoned (safe to garbage-collect; the final path remains absent).
 *
 * @param record   The OddsRecord to persist.
 * @param cacheDir Root cache directory (e.g., process.cwd() + '/cache').
 */
export async function appendOddsRecord(record: OddsRecord, cacheDir: string): Promise<void> {
  const targetPath = deriveRecordPath(record, cacheDir);
  const targetDir = path.dirname(targetPath);

  // Guard: if the target file already exists, this is a duplicate snapshot.
  // First write wins — do not overwrite. (IDEMPOTENCY invariant)
  try {
    await fs.access(targetPath);
    // File exists — no-op.
    return;
  } catch {
    // File does not exist — proceed with write.
  }

  // Ensure the partition directory exists.
  await fs.mkdir(targetDir, { recursive: true });

  const tmpPath = targetPath + '.tmp';
  const serialized = JSON.stringify(record, null, 2);

  // Atomic write: .tmp → rename.
  await fs.writeFile(tmpPath, serialized, 'utf8');
  await fs.rename(tmpPath, targetPath);
}

/**
 * Load all OddsRecords for a match from all providers.
 *
 * Scans the partition tree: {cacheDir}/odds-raw/{matchId}/
 * across all provider subdirectories.
 *
 * Returns an array sorted by snapshot_utc ASC (oldest first).
 * Returns [] when no records exist (not an error).
 *
 * @param matchId  The canonical match identifier.
 * @param cacheDir Root cache directory.
 */
export async function loadOddsRecords(matchId: string, cacheDir: string): Promise<OddsRecord[]> {
  const matchDir = path.join(cacheDir, 'odds-raw', matchId);

  let providerEntries: string[];
  try {
    const dirents = await fs.readdir(matchDir, { withFileTypes: true });
    providerEntries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    // Directory does not exist — no records for this match.
    return [];
  }

  const allRecords: OddsRecord[] = [];

  for (const provider of providerEntries) {
    const providerDir = path.join(matchDir, provider);
    const providerRecords = await loadRecordsFromDir(providerDir);
    allRecords.push(...providerRecords);
  }

  // Sort by snapshot_utc ASC. ISO-8601 strings are lexicographically
  // comparable, so string sort is semantically correct here.
  allRecords.sort((a, b) => a.snapshot_utc.localeCompare(b.snapshot_utc));

  return allRecords;
}

/**
 * Load all OddsRecords for a match from a specific provider.
 *
 * Scans only: {cacheDir}/odds-raw/{matchId}/{provider}/
 *
 * Returns an array sorted by snapshot_utc ASC (oldest first).
 * Returns [] when no records exist (not an error).
 *
 * @param matchId  The canonical match identifier.
 * @param provider The bookmaker to filter by.
 * @param cacheDir Root cache directory.
 */
export async function loadOddsRecordsForProvider(
  matchId: string,
  provider: OddsProvider,
  cacheDir: string,
): Promise<OddsRecord[]> {
  const providerDir = path.join(cacheDir, 'odds-raw', matchId, provider);
  const records = await loadRecordsFromDir(providerDir);

  // Sort by snapshot_utc ASC.
  records.sort((a, b) => a.snapshot_utc.localeCompare(b.snapshot_utc));

  return records;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Read and parse all .json files in a directory as OddsRecord objects.
 * Skips .tmp files and non-JSON files. Throws on malformed JSON (data
 * integrity violation — caller should handle).
 */
async function loadRecordsFromDir(dir: string): Promise<OddsRecord[]> {
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    // Directory does not exist — no records.
    return [];
  }

  const records: OddsRecord[] = [];

  for (const file of files) {
    if (!file.endsWith('.json') || file.endsWith('.tmp')) {
      continue;
    }
    const filePath = path.join(dir, file);
    const raw = await fs.readFile(filePath, 'utf8');
    const record = JSON.parse(raw) as OddsRecord;
    records.push(record);
  }

  return records;
}

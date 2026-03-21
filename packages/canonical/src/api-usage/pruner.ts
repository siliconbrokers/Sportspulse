/**
 * pruner.ts — Data retention for api_usage_events.
 * Deletes events older than 7 days and orphaned rollups older than 90 days.
 * Run at startup and daily.
 */

import type Database from 'better-sqlite3';

const EVENTS_RETENTION_DAYS = 7;
const ROLLUPS_RETENTION_DAYS = 90;

function daysAgoUtc(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function runRetentionPruner(db: Database.Database): void {
  const eventsCutoff = daysAgoUtc(EVENTS_RETENTION_DAYS);
  const rollupsCutoff = daysAgoUtc(ROLLUPS_RETENTION_DAYS);

  const eventsResult = db
    .prepare('DELETE FROM api_usage_events WHERE usage_date_local < ?')
    .run(eventsCutoff);

  const rollupsResult = db
    .prepare('DELETE FROM api_usage_daily_rollups WHERE usage_date_local < ?')
    .run(rollupsCutoff);

  if (eventsResult.changes > 0 || rollupsResult.changes > 0) {
    console.log(
      `[ApiUsageLedger] Retention pruner: removed ${eventsResult.changes} events (>${EVENTS_RETENTION_DAYS}d), ` +
        `${rollupsResult.changes} rollup rows (>${ROLLUPS_RETENTION_DAYS}d)`,
    );
  }

  // Checkpoint the WAL after the DELETE so the WAL file does not grow unboundedly.
  // TRUNCATE mode forces all dirty pages to the main db file and truncates the WAL to zero bytes.
  try {
    const result = db.pragma('wal_checkpoint(TRUNCATE)');
    console.log('[ApiUsageLedger] WAL checkpoint after pruning: %o', result);
  } catch (err) {
    console.warn('[ApiUsageLedger] WAL checkpoint failed: %s', err);
  }
}

/**
 * migrations.ts — SQLite schema migrations for the API Usage Ledger.
 * Spec: SPEC-SPORTPULSE-OPS-API-USAGE-GOVERNANCE §11
 *
 * Runs synchronously on startup. Idempotent — safe to run on every startup.
 */

import type Database from 'better-sqlite3';

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version    INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_quota_config (
        provider_key                    TEXT PRIMARY KEY,
        display_name                    TEXT NOT NULL,
        unit_type                       TEXT NOT NULL DEFAULT 'REQUEST',
        daily_limit                     INTEGER NOT NULL DEFAULT 0,
        timezone                        TEXT NOT NULL DEFAULT 'UTC',
        warning_threshold_pct           INTEGER NOT NULL DEFAULT 75,
        critical_threshold_pct          INTEGER NOT NULL DEFAULT 90,
        hard_stop_threshold_pct         INTEGER NOT NULL DEFAULT 95,
        allow_noncritical_when_low      INTEGER NOT NULL DEFAULT 1,
        brake_live_threshold            INTEGER NOT NULL DEFAULT 0,
        is_active                       INTEGER NOT NULL DEFAULT 1,
        notes                           TEXT,
        created_at_utc                  TEXT NOT NULL,
        updated_at_utc                  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_usage_events (
        id                    TEXT PRIMARY KEY,
        provider_key          TEXT NOT NULL,
        usage_date_local      TEXT NOT NULL,
        unit_type             TEXT NOT NULL DEFAULT 'REQUEST',
        usage_units           INTEGER NOT NULL DEFAULT 1,
        consumer_type         TEXT NOT NULL,
        consumer_id           TEXT,
        module_key            TEXT NOT NULL,
        operation_key         TEXT NOT NULL,
        request_method        TEXT NOT NULL DEFAULT 'GET',
        endpoint_template     TEXT NOT NULL,
        status_code           INTEGER,
        success               INTEGER NOT NULL DEFAULT 1,
        rate_limited          INTEGER NOT NULL DEFAULT 0,
        cache_hit             INTEGER NOT NULL DEFAULT 0,
        started_at_utc        TEXT NOT NULL,
        finished_at_utc       TEXT NOT NULL,
        latency_ms            INTEGER NOT NULL,
        remote_limit          INTEGER,
        remote_remaining      INTEGER,
        remote_reset_at_utc   TEXT,
        error_code            TEXT,
        error_class           TEXT,
        request_id            TEXT,
        metadata_json         TEXT,
        created_at_utc        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_usage_events_provider_date
        ON api_usage_events(provider_key, usage_date_local);

      CREATE INDEX IF NOT EXISTS idx_usage_events_consumer
        ON api_usage_events(consumer_type, usage_date_local);

      CREATE INDEX IF NOT EXISTS idx_usage_events_created
        ON api_usage_events(created_at_utc DESC);

      CREATE TABLE IF NOT EXISTS api_usage_daily_rollups (
        provider_key              TEXT NOT NULL,
        usage_date_local          TEXT NOT NULL,
        consumer_type             TEXT NOT NULL,
        used_units                INTEGER NOT NULL DEFAULT 0,
        success_count             INTEGER NOT NULL DEFAULT 0,
        error_count               INTEGER NOT NULL DEFAULT 0,
        rate_limited_count        INTEGER NOT NULL DEFAULT 0,
        cache_hit_count           INTEGER NOT NULL DEFAULT 0,
        last_remote_limit         INTEGER,
        last_remote_remaining     INTEGER,
        last_remote_reset_at_utc  TEXT,
        last_seen_at_utc          TEXT NOT NULL,
        PRIMARY KEY (provider_key, usage_date_local, consumer_type)
      );
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create migrations table first (outside transaction, idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const getApplied = db.prepare<[], { version: number }>(
    'SELECT version FROM _schema_migrations ORDER BY version',
  );
  const appliedVersions = new Set(getApplied.all().map((r) => r.version));

  const insertMigration = db.prepare(
    'INSERT INTO _schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;

    const runMigration = db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.version, new Date().toISOString());
    });

    runMigration();
    console.log(`[ApiUsageLedger] Migration v${migration.version} applied`);
  }
}

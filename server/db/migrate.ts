/**
 * server/db/migrate.ts — Idempotent SQL migration runner (WP-17-b)
 *
 * Reads all *.sql files from packages/api/migrations/ in lexicographic order.
 * Maintains a schema_migrations table so each file is applied at most once.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';

/** Absolute path to the migrations directory. */
const MIGRATIONS_DIR = resolve(
  new URL('../../packages/api/migrations', import.meta.url).pathname,
);

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename      text        PRIMARY KEY,
    applied_at    timestamptz NOT NULL DEFAULT NOW()
  );
`;

/**
 * Runs all pending SQL migrations in lexicographic order.
 * Already-applied migrations are skipped (idempotent).
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Ensure the tracking table exists.
    await client.query(CREATE_MIGRATIONS_TABLE);

    // Discover migration files sorted lexicographically.
    const allFiles = await readdir(MIGRATIONS_DIR);
    const sqlFiles = allFiles
      .filter((f) => f.endsWith('.sql'))
      .sort(); // lexicographic — 0007 < 0008 < 0009 < 0010

    // Load already-applied filenames.
    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.filename));

    for (const filename of sqlFiles) {
      if (applied.has(filename)) {
        continue; // already applied — skip
      }

      const filePath = join(MIGRATIONS_DIR, filename);
      const sql = await readFile(filePath, 'utf8');

      // Run within a transaction so a partial failure leaves no residue.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
        console.log(`[Migrations] Applied: ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          `[Migrations] Failed to apply ${filename}: ${(err as Error).message}`,
        );
      }
    }

    console.log(`[Migrations] All migrations up to date (${sqlFiles.length} total, ${sqlFiles.length - applied.size} applied this run).`);
  } finally {
    client.release();
  }
}

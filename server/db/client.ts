/**
 * server/db/client.ts — PostgreSQL connection pool (WP-17-a)
 *
 * Lazy-initialised: the pool is not created at import time.
 * The pool is only constructed on the first call to getPool(), which allows
 * the server to start without DATABASE_URL when ENABLE_V2_ROUTES is not set.
 */

import { Pool } from 'pg';

let _pool: Pool | null = null;

/**
 * Returns the shared Pool instance, creating it on first call.
 * Throws a descriptive error if DATABASE_URL is not set.
 */
export function getPool(): Pool {
  if (_pool) return _pool;

  const url = process.env['DATABASE_URL'];
  if (!url || url.trim() === '') {
    throw new Error(
      '[DB] DATABASE_URL is not set. ' +
        'Provide a PostgreSQL connection string when ENABLE_V2_ROUTES is enabled.',
    );
  }

  _pool = new Pool({ connectionString: url });

  _pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });

  return _pool;
}

/**
 * Exported for use in tests or explicit composition — prefer getPool() in app code.
 * Allows injecting a pre-configured Pool (e.g. a test pool) before the lazy init fires.
 */
export function setPool(pool: Pool): void {
  _pool = pool;
}

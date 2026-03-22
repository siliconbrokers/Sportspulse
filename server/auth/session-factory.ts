/**
 * server/auth/session-factory.ts — Session adapter factory (WP-04A)
 *
 * Returns the correct SessionAdapter based on the runtime environment:
 *   - DATABASE_URL present → PgSessionAdapter (production / staging)
 *   - DATABASE_URL absent  → InMemorySessionAdapter (local dev / tests)
 *
 * The singleton is lazily initialised on first call to getSessionAdapter().
 * Tests can override it with setSessionAdapter() before calling any route.
 */

import type { SessionAdapter } from './session-adapter.js';
import { InMemorySessionAdapter } from './session-adapter-memory.js';
import { PgSessionAdapter } from './session-adapter-pg.js';
import { getPool } from '../db/client.js';

let _adapter: SessionAdapter | null = null;

/**
 * Returns the shared SessionAdapter instance, creating it on first call.
 * In production (DATABASE_URL set) this is PgSessionAdapter.
 * In dev / tests this is InMemorySessionAdapter.
 */
export function getSessionAdapter(): SessionAdapter {
  if (_adapter) return _adapter;
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl && dbUrl.trim() !== '') {
    _adapter = new PgSessionAdapter(getPool());
  } else {
    _adapter = new InMemorySessionAdapter();
  }
  return _adapter;
}

/**
 * Overrides the adapter singleton — for use in tests only.
 * Call this before registering any routes under test.
 */
export function setSessionAdapter(adapter: SessionAdapter): void {
  _adapter = adapter;
}

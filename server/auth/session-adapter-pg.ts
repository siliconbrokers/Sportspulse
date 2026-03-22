/**
 * server/auth/session-adapter-pg.ts — PostgreSQL session adapter (WP-17-d)
 *
 * Backed by the web_sessions table (migration 0007).
 * - Absolute session max: 30 days from issuedAtUtc (set at createSession time).
 * - Idle TTL: 14 days from lastSeenAtUtc. A session with no activity for 14 days
 *   is treated as inactive even if the 30-day absolute max has not yet elapsed.
 *   Both constraints are enforced directly in getSession.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { SessionAdapter, SessionRecord } from './session-adapter.js';

/** Row shape as returned by pg (snake_case column names). */
interface SessionRow {
  session_id: string;
  user_id: string;
  email: string;
  tier: string;
  is_pro: boolean;
  issued_at_utc: Date;
  last_seen_at_utc: Date;
  expires_at_utc: Date;
  revoked_at_utc: Date | null;
}

function rowToRecord(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    tier: row.tier,
    isPro: row.is_pro,
    issuedAtUtc: row.issued_at_utc,
    lastSeenAtUtc: row.last_seen_at_utc,
    expiresAtUtc: row.expires_at_utc,
    revokedAtUtc: row.revoked_at_utc,
  };
}

/** Absolute session lifetime in milliseconds (30 days). */
const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export class PgSessionAdapter implements SessionAdapter {
  constructor(private readonly pool: Pool) {}

  /**
   * Returns the session if it exists, is not revoked, has not exceeded the
   * absolute 30-day max (expires_at_utc), and has not been idle for more than
   * 14 days (last_seen_at_utc). Returns null if any constraint is violated.
   */
  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT *
         FROM web_sessions
        WHERE session_id = $1
          AND revoked_at_utc IS NULL
          AND expires_at_utc > NOW()
          AND last_seen_at_utc > NOW() - INTERVAL '14 days'`,
      [sessionId],
    );
    if (rows.length === 0) return null;
    return rowToRecord(rows[0]!);
  }

  async createSession(
    data: Omit<SessionRecord, 'sessionId' | 'issuedAtUtc' | 'lastSeenAtUtc' | 'revokedAtUtc'>,
  ): Promise<SessionRecord> {
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAtUtc = new Date(now.getTime() + SESSION_MAX_MS);

    const { rows } = await this.pool.query<SessionRow>(
      `INSERT INTO web_sessions
         (session_id, user_id, email, tier, is_pro, issued_at_utc, last_seen_at_utc, expires_at_utc, revoked_at_utc)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
       RETURNING *`,
      [sessionId, data.userId, data.email, data.tier, data.isPro, now, now, expiresAtUtc],
    );

    return rowToRecord(rows[0]!);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE web_sessions
          SET revoked_at_utc = NOW()
        WHERE session_id = $1`,
      [sessionId],
    );
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE web_sessions
          SET last_seen_at_utc = NOW()
        WHERE session_id = $1`,
      [sessionId],
    );
  }
}

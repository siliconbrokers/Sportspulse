/**
 * server/auth/session-adapter.ts — Session persistence adapter interface (WP-17-c)
 *
 * Defines the canonical shape of a session record and the operations that any
 * session store must implement. Concrete adapters:
 *   - InMemorySessionAdapter  (local dev / tests)
 *   - PgSessionAdapter        (PostgreSQL — prod / staging)
 */

export interface SessionRecord {
  sessionId: string;
  userId: string;
  email: string;
  tier: string;
  isPro: boolean;
  issuedAtUtc: Date;
  lastSeenAtUtc: Date;
  expiresAtUtc: Date;
  revokedAtUtc: Date | null;
}

export interface SessionAdapter {
  /** Returns the session or null if not found, revoked, or expired. */
  getSession(sessionId: string): Promise<SessionRecord | null>;

  /**
   * Creates a new session. The adapter sets sessionId, issuedAtUtc,
   * lastSeenAtUtc, and revokedAtUtc (null). The caller supplies the
   * remaining fields.
   */
  createSession(
    data: Omit<SessionRecord, 'sessionId' | 'issuedAtUtc' | 'lastSeenAtUtc' | 'revokedAtUtc'>,
  ): Promise<SessionRecord>;

  /** Marks the session as revoked (soft delete — record is kept). */
  revokeSession(sessionId: string): Promise<void>;

  /** Updates lastSeenAtUtc to now (sliding idle window). */
  touchSession(sessionId: string): Promise<void>;
}

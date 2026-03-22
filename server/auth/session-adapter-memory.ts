/**
 * server/auth/session-adapter-memory.ts — In-memory session adapter (WP-17-c)
 *
 * Used in local dev (when DATABASE_URL is absent) and in unit tests.
 * Not suitable for production: state is lost on process restart.
 */

import { randomUUID } from 'node:crypto';
import type { SessionAdapter, SessionRecord } from './session-adapter.js';

/** Mirrors the SQL predicate: last_seen_at_utc > NOW() - INTERVAL '14 days' */
const IDLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export class InMemorySessionAdapter implements SessionAdapter {
  private readonly store = new Map<string, SessionRecord>();

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const record = this.store.get(sessionId);
    if (!record) return null;
    if (record.revokedAtUtc !== null) return null;
    const now = new Date();
    if (record.expiresAtUtc < now) return null;
    if (now.getTime() - record.lastSeenAtUtc.getTime() > IDLE_TTL_MS) return null;
    return record;
  }

  async createSession(
    data: Omit<SessionRecord, 'sessionId' | 'issuedAtUtc' | 'lastSeenAtUtc' | 'revokedAtUtc'>,
  ): Promise<SessionRecord> {
    const now = new Date();
    const record: SessionRecord = {
      sessionId: randomUUID(),
      issuedAtUtc: now,
      lastSeenAtUtc: now,
      revokedAtUtc: null,
      ...data,
    };
    this.store.set(record.sessionId, record);
    return record;
  }

  async revokeSession(sessionId: string): Promise<void> {
    const record = this.store.get(sessionId);
    if (record) {
      // Mutate in place — record remains in the store for audit purposes.
      record.revokedAtUtc = new Date();
    }
  }

  async touchSession(sessionId: string): Promise<void> {
    const record = this.store.get(sessionId);
    if (record) {
      record.lastSeenAtUtc = new Date();
    }
  }
}

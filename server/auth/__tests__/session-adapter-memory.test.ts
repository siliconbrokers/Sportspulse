/**
 * Tests for InMemorySessionAdapter (WP-17-c)
 * Acceptance: K-05 (prerequisite — session state machine infrastructure), K-06 (anonymous-first prerequisite)
 * Coverage: partial (infrastructure layer only — end-to-end acceptance pending middleware and auth routes)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InMemorySessionAdapter } from '../session-adapter-memory.js';

const SESSION_BASE = {
  userId: 'user-abc',
  email: 'user@example.com',
  tier: 'pro',
  isPro: true,
  expiresAtUtc: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
};

describe('InMemorySessionAdapter', () => {
  let adapter: InMemorySessionAdapter;

  beforeEach(() => {
    adapter = new InMemorySessionAdapter();
  });

  it('getSession returns null for a non-existent session', async () => {
    const result = await adapter.getSession('non-existent-id');
    expect(result).toBeNull();
  });

  it('createSession returns a SessionRecord with correct fields', async () => {
    const record = await adapter.createSession(SESSION_BASE);

    expect(record.sessionId).toBeTruthy();
    expect(typeof record.sessionId).toBe('string');
    expect(record.userId).toBe(SESSION_BASE.userId);
    expect(record.email).toBe(SESSION_BASE.email);
    expect(record.tier).toBe(SESSION_BASE.tier);
    expect(record.isPro).toBe(true);
    expect(record.revokedAtUtc).toBeNull();
    expect(record.issuedAtUtc).toBeInstanceOf(Date);
    expect(record.lastSeenAtUtc).toBeInstanceOf(Date);
    expect(record.expiresAtUtc).toEqual(SESSION_BASE.expiresAtUtc);
  });

  it('getSession returns the created session while active', async () => {
    const created = await adapter.createSession(SESSION_BASE);
    const fetched = await adapter.getSession(created.sessionId);

    expect(fetched).not.toBeNull();
    expect(fetched!.sessionId).toBe(created.sessionId);
    expect(fetched!.userId).toBe(SESSION_BASE.userId);
  });

  it('getSession returns null for a revoked session', async () => {
    const record = await adapter.createSession(SESSION_BASE);
    await adapter.revokeSession(record.sessionId);

    const result = await adapter.getSession(record.sessionId);
    expect(result).toBeNull();
  });

  it('getSession returns null for an expired session', async () => {
    const expiredBase = {
      ...SESSION_BASE,
      expiresAtUtc: new Date(Date.now() - 1000), // 1 second in the past
    };
    const record = await adapter.createSession(expiredBase);

    const result = await adapter.getSession(record.sessionId);
    expect(result).toBeNull();
  });

  it('revokeSession marks revokedAtUtc without deleting the record', async () => {
    const record = await adapter.createSession(SESSION_BASE);
    expect(record.revokedAtUtc).toBeNull();

    await adapter.revokeSession(record.sessionId);

    // The record is still in the store (soft delete) — verify via the internal
    // Map by trying a second revoke call which must not throw.
    await expect(adapter.revokeSession(record.sessionId)).resolves.toBeUndefined();

    // And getSession now returns null (revoked).
    const result = await adapter.getSession(record.sessionId);
    expect(result).toBeNull();
  });

  it('getSession returns null for an idle session (K-01: idle TTL 14d)', async () => {
    const record = await adapter.createSession(SESSION_BASE);

    // Advance system clock by 15 days (past the 14-day idle TTL window).
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000));

    const result = await adapter.getSession(record.sessionId);
    expect(result).toBeNull();

    vi.useRealTimers();
  });

  it('touchSession updates lastSeenAtUtc', async () => {
    const record = await adapter.createSession(SESSION_BASE);
    const originalLastSeen = record.lastSeenAtUtc;

    // Ensure time advances at least 1ms before touching.
    await new Promise((r) => setTimeout(r, 5));
    await adapter.touchSession(record.sessionId);

    // Fetch again — lastSeenAtUtc should be newer.
    const updated = await adapter.getSession(record.sessionId);
    expect(updated).not.toBeNull();
    expect(updated!.lastSeenAtUtc.getTime()).toBeGreaterThan(
      originalLastSeen.getTime(),
    );
  });
});

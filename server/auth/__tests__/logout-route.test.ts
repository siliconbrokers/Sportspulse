/**
 * server/auth/__tests__/logout-route.test.ts
 *
 * WP-04C — POST /api/logout + expired-session handling
 * Acceptance: WP-04C (no direct K-series ID — logout is a prerequisite for K-04, K-06)
 * Note: session-auth-contract v1.0.0 §5.4 is the governing authority for this behavior.
 * A dedicated acceptance matrix entry should be added (e.g., K-09) in a future matrix update.
 * Coverage: logout idempotent, cookie cleanup, session revocation
 * Version impact: none — no policyVersion/layoutAlgorithmVersion/snapshotSchemaVersion bump
 *
 * Strategy: build a minimal Fastify instance per test, inject
 * InMemorySessionAdapter via setSessionAdapter, and use Fastify's
 * inject() helper — no real network I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerLogoutRoute } from '../logout-route.js';
import { InMemorySessionAdapter } from '../session-adapter-memory.js';
import { setSessionAdapter } from '../session-factory.js';
import { COOKIE_NAME } from '../cookie-config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a future expiry date (30 days from now). */
function futureExpiry(): Date {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/** Creates a session record via the adapter and returns its sessionId. */
async function seedSession(
  adapter: InMemorySessionAdapter,
  overrides: Partial<{
    userId: string;
    email: string;
    tier: string;
    isPro: boolean;
    expiresAtUtc: Date;
  }> = {},
): Promise<string> {
  const record = await adapter.createSession({
    userId: overrides.userId ?? 'usr_test_001',
    email: overrides.email ?? 'test@example.com',
    tier: overrides.tier ?? 'free',
    isPro: overrides.isPro ?? false,
    expiresAtUtc: overrides.expiresAtUtc ?? futureExpiry(),
  });
  return record.sessionId;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('POST /api/logout', () => {
  let app: ReturnType<typeof fastify>;
  let adapter: InMemorySessionAdapter;

  beforeEach(async () => {
    app = fastify({ logger: false });
    adapter = new InMemorySessionAdapter();
    setSessionAdapter(adapter);
    await app.register(fastifyCookie);
    await registerLogoutRoute(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── 1. no-cookie ───────────────────────────────────────────────────────────

  it('no-cookie: returns 204 when no cookie is present', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/logout' });

    expect(res.statusCode).toBe(204);
  });

  // ── 2. active-session-revoked ──────────────────────────────────────────────

  it('active-session-revoked: returns 204 and session is revoked afterwards', async () => {
    const sessionId = await seedSession(adapter, { userId: 'usr_active' });

    // Confirm session is active before logout
    const before = await adapter.getSession(sessionId);
    expect(before).not.toBeNull();

    const res = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { [COOKIE_NAME]: sessionId },
    });

    expect(res.statusCode).toBe(204);

    // getSession returns null for revoked sessions
    const after = await adapter.getSession(sessionId);
    expect(after).toBeNull();
  });

  // ── 3. cookie-cleared ──────────────────────────────────────────────────────

  it('cookie-cleared: Set-Cookie header expires sp_session after logout', async () => {
    const sessionId = await seedSession(adapter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { [COOKIE_NAME]: sessionId },
    });

    expect(res.statusCode).toBe(204);

    const setCookieHeader = res.headers['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.join('; ')
      : String(setCookieHeader ?? '');
    expect(cookieStr).toContain('sp_session=');
    expect(cookieStr.toLowerCase()).toMatch(/max-age=0|expires=.*1970/);
  });

  // ── 4. idempotent-revoked ─────────────────────────────────────────────────

  it('idempotent-revoked: returns 204 when cookie maps to an already-revoked session', async () => {
    const sessionId = await seedSession(adapter);

    // Revoke the session directly via the adapter first
    await adapter.revokeSession(sessionId);

    // Now call logout — must not throw, must return 204
    const res = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { [COOKIE_NAME]: sessionId },
    });

    expect(res.statusCode).toBe(204);
  });

  // ── 5. idempotent-no-session ──────────────────────────────────────────────

  it('idempotent-no-session: returns 204 when cookie does not map to any session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { [COOKIE_NAME]: 'non-existent-session-id' },
    });

    expect(res.statusCode).toBe(204);
  });

  // ── 6. cache-control ──────────────────────────────────────────────────────

  it('cache-control: Cache-Control: no-store is always present (no cookie)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/logout' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('cache-control: Cache-Control: no-store is always present (with cookie)', async () => {
    const sessionId = await seedSession(adapter);
    const res = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { [COOKIE_NAME]: sessionId },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

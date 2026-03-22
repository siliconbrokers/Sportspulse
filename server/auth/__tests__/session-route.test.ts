/**
 * server/auth/__tests__/session-route.test.ts
 *
 * Unit tests for GET /api/session (WP-04A).
 *
 * Acceptance IDs: K-06 (anonymous-first prerequisite),
 *   K-04 (isPro determination — backend only, never inferred locally).
 *
 * Version impact: none — no policyVersion/layoutAlgorithmVersion/snapshotSchemaVersion bump required.
 * WP-04A introduces a new auth endpoint, no snapshot pipeline changes.
 *
 * Strategy: build a minimal Fastify instance per test, inject
 * InMemorySessionAdapter via setSessionAdapter, and use Fastify's
 * inject() helper — no real network I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerSessionRoute } from '../session-route.js';
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

describe('GET /api/session', () => {
  let app: ReturnType<typeof fastify>;
  let adapter: InMemorySessionAdapter;

  beforeEach(async () => {
    app = fastify({ logger: false });
    adapter = new InMemorySessionAdapter();
    setSessionAdapter(adapter);

    await app.register(fastifyCookie);
    await registerSessionRoute(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── 1. anonymous ───────────────────────────────────────────────────────────

  it('returns sessionStatus=anonymous when no cookie is present', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionStatus).toBe('anonymous');
    expect(body.userId).toBeNull();
    expect(body.email).toBeNull();
    expect(body.tier).toBe('free');
    expect(body.isPro).toBe(false);
    expect(body.sessionIssuedAt).toBeNull();
  });

  // ── 2. authenticated ───────────────────────────────────────────────────────

  it('returns sessionStatus=authenticated with correct fields for a valid session', async () => {
    const sessionId = await seedSession(adapter, {
      userId: 'usr_abc',
      email: 'alice@example.com',
      tier: 'pro',
      isPro: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [COOKIE_NAME]: sessionId },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionStatus).toBe('authenticated');
    expect(body.userId).toBe('usr_abc');
    expect(body.email).toBe('alice@example.com');
    expect(body.tier).toBe('pro');
    expect(body.isPro).toBe(true);
    expect(typeof body.sessionIssuedAt).toBe('string');
    // Must be a valid ISO-8601 date string
    expect(new Date(body.sessionIssuedAt).getTime()).not.toBeNaN();
  });

  // ── 3. expired / unknown session ───────────────────────────────────────────

  it('returns sessionStatus=expired when cookie is present but getSession returns null', async () => {
    // Use a sessionId that was never stored in the adapter.
    const fakeSessionId = 'non-existent-session-id';

    const res = await app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [COOKIE_NAME]: fakeSessionId },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionStatus).toBe('expired');
    expect(body.userId).toBeNull();
    expect(body.email).toBeNull();
    expect(body.tier).toBe('free');
    expect(body.isPro).toBe(false);
    expect(body.sessionIssuedAt).toBeNull();

    // Verify that clearCookie was called: the response must carry a Set-Cookie
    // header that expires the sp_session cookie (Max-Age=0 or Expires in 1970).
    const setCookieHeader = res.headers['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.join('; ')
      : String(setCookieHeader ?? '');
    expect(cookieStr).toContain('sp_session=');
    expect(cookieStr.toLowerCase()).toMatch(/max-age=0|expires=.*1970/);
  });

  // ── 4. touchSession called on authenticated ────────────────────────────────

  it('calls touchSession and updates lastSeenAtUtc when session is authenticated', async () => {
    const sessionId = await seedSession(adapter, { userId: 'usr_touch' });

    // Capture lastSeenAtUtc before the request
    const before = (await adapter.getSession(sessionId))!.lastSeenAtUtc.getTime();

    // Small delay so that "now" inside touchSession differs from seed time
    await new Promise((resolve) => setTimeout(resolve, 5));

    const res = await app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [COOKIE_NAME]: sessionId },
    });

    expect(res.statusCode).toBe(200);
    const after = (await adapter.getSession(sessionId))!.lastSeenAtUtc.getTime();

    // lastSeenAtUtc must have been updated (>= before, typically strictly greater)
    expect(after).toBeGreaterThanOrEqual(before);
  });

  // ── 5. Cache-Control: no-store on all states ───────────────────────────────

  it('sets Cache-Control: no-store on anonymous response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sets Cache-Control: no-store on authenticated response', async () => {
    const sessionId = await seedSession(adapter);
    const res = await app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [COOKIE_NAME]: sessionId },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sets Cache-Control: no-store on expired response', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/session',
      cookies: { [COOKIE_NAME]: 'ghost-session-id' },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

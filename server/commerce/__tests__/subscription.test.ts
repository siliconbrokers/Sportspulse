/**
 * server/commerce/__tests__/subscription.test.ts
 *
 * Unit tests for GET /api/subscription/status and
 * POST /api/subscription/refresh-entitlement (WP-06C).
 *
 * Governing spec: subscription-checkout-contract v1.0.0, api.contract v1.1.0 §6.2, §6.4
 * Acceptance: K-04, K-05, K-07
 * Version impact: none
 *
 * Strategy: minimal Fastify instance per test, InMemorySessionAdapter +
 * MemoryEntitlementStore injected (no real DB calls). All assertions via inject().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerCommerceRouter } from '../commerce-router.js';
import { InMemorySessionAdapter } from '../../auth/session-adapter-memory.js';
import { setSessionAdapter } from '../../auth/session-factory.js';
import { COOKIE_NAME } from '../../auth/cookie-config.js';
import { MemoryCheckoutStore, setCheckoutStore, setCheckoutProvider } from '../checkout-service.js';
import {
  MemoryEntitlementStore,
  setEntitlementStore,
  upsertEntitlement,
} from '../subscription-service.js';
import { setStripeStatusProvider } from '../reconcile-service.js';
import type { SessionRecord } from '../../auth/session-adapter.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFutureDate(offsetMs = 30 * 24 * 60 * 60 * 1000): Date {
  return new Date(Date.now() + offsetMs);
}

async function seedSession(
  adapter: InMemorySessionAdapter,
  overrides: Partial<
    Omit<SessionRecord, 'sessionId' | 'issuedAtUtc' | 'lastSeenAtUtc' | 'revokedAtUtc'>
  > = {},
): Promise<string> {
  const session = await adapter.createSession({
    userId: 'usr_test_sub',
    email: 'sub@example.com',
    tier: 'free',
    isPro: false,
    expiresAtUtc: makeFutureDate(),
    ...overrides,
  });
  return session.sessionId;
}

// ── Suite: GET /api/subscription/status ──────────────────────────────────────

describe('GET /api/subscription/status', () => {
  let app: ReturnType<typeof fastify>;
  let sessionAdapter: InMemorySessionAdapter;
  let entitlementStore: MemoryEntitlementStore;

  beforeEach(async () => {
    app = fastify({ logger: false });
    sessionAdapter = new InMemorySessionAdapter();
    entitlementStore = new MemoryEntitlementStore();

    setSessionAdapter(sessionAdapter);
    setCheckoutStore(new MemoryCheckoutStore());
    setEntitlementStore(entitlementStore);
    setCheckoutProvider({
      async createCheckoutSession() {
        return { checkoutSessionId: 'cs_unused', checkoutUrl: 'http://unused' };
      },
    });
    setStripeStatusProvider({ async getCheckoutStatus() { return 'paid'; } });

    await app.register(fastifyCookie);
    await registerCommerceRouter(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── 1. status-no-session ──────────────────────────────────────────────────

  it('status-no-session: no cookie → 401 SESSION_REQUIRED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/subscription/status',
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('SESSION_REQUIRED');
    expect(body.error.details.retryable).toBe(false);
  });

  it('status-no-session: invalid session cookie → 401 SESSION_REQUIRED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/subscription/status',
      headers: { cookie: `${COOKIE_NAME}=ghost_session` },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('SESSION_REQUIRED');
  });

  // ── 2. status-success ─────────────────────────────────────────────────────

  it('status-success: valid session with no entitlement → 200 with free/inactive defaults', async () => {
    const sessionId = await seedSession(sessionAdapter);

    const res = await app.inject({
      method: 'GET',
      url: '/api/subscription/status',
      headers: { cookie: `${COOKIE_NAME}=${sessionId}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.userId).toBe('usr_test_sub');
    expect(body.tier).toBe('free');
    expect(body.state).toBe('inactive');
    expect(typeof body.entitlementUpdatedAt).toBe('string');
    expect(new Date(body.entitlementUpdatedAt).getTime()).not.toBeNaN();
  });

  it('status-success: valid session with pro entitlement → 200 with pro/active', async () => {
    const sessionId = await seedSession(sessionAdapter);

    // Pre-seed an entitlement directly.
    await upsertEntitlement('usr_test_sub', 'pro', 'active', { store: entitlementStore });

    const res = await app.inject({
      method: 'GET',
      url: '/api/subscription/status',
      headers: { cookie: `${COOKIE_NAME}=${sessionId}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.userId).toBe('usr_test_sub');
    expect(body.tier).toBe('pro');
    expect(body.state).toBe('active');
  });

  // ── Cache-Control ─────────────────────────────────────────────────────────

  it('response always carries Cache-Control: no-store', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/subscription/status',
    });

    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// ── Suite: POST /api/subscription/refresh-entitlement ────────────────────────

describe('POST /api/subscription/refresh-entitlement', () => {
  let app: ReturnType<typeof fastify>;
  let sessionAdapter: InMemorySessionAdapter;
  let entitlementStore: MemoryEntitlementStore;

  beforeEach(async () => {
    app = fastify({ logger: false });
    sessionAdapter = new InMemorySessionAdapter();
    entitlementStore = new MemoryEntitlementStore();

    setSessionAdapter(sessionAdapter);
    setCheckoutStore(new MemoryCheckoutStore());
    setEntitlementStore(entitlementStore);
    setCheckoutProvider({
      async createCheckoutSession() {
        return { checkoutSessionId: 'cs_unused', checkoutUrl: 'http://unused' };
      },
    });
    setStripeStatusProvider({ async getCheckoutStatus() { return 'paid'; } });

    await app.register(fastifyCookie);
    await registerCommerceRouter(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── 3. refresh-no-session ─────────────────────────────────────────────────

  it('refresh-no-session: no cookie → 401 SESSION_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/subscription/refresh-entitlement',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('SESSION_REQUIRED');
    expect(body.error.details.retryable).toBe(false);
  });

  it('refresh-no-session: invalid session cookie → 401 SESSION_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/subscription/refresh-entitlement',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=bad_session`,
      },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('SESSION_REQUIRED');
  });

  // ── 4. refresh-success ────────────────────────────────────────────────────

  it('refresh-success: valid session with no entitlement → 200 with free/inactive', async () => {
    const sessionId = await seedSession(sessionAdapter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/subscription/refresh-entitlement',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.userId).toBe('usr_test_sub');
    expect(body.tier).toBe('free');
    expect(body.state).toBe('inactive');
    expect(typeof body.entitlementUpdatedAt).toBe('string');
    expect(new Date(body.entitlementUpdatedAt).getTime()).not.toBeNaN();
  });

  it('refresh-success: valid session with pro entitlement → 200 with pro/active', async () => {
    const sessionId = await seedSession(sessionAdapter);
    await upsertEntitlement('usr_test_sub', 'pro', 'active', { store: entitlementStore });

    const res = await app.inject({
      method: 'POST',
      url: '/api/subscription/refresh-entitlement',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tier).toBe('pro');
    expect(body.state).toBe('active');
  });

  it('refresh-success: response shape matches api.contract v1.1.0 §6.4', async () => {
    const sessionId = await seedSession(sessionAdapter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/subscription/refresh-entitlement',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('userId');
    expect(body).toHaveProperty('tier');
    expect(body).toHaveProperty('state');
    expect(body).toHaveProperty('entitlementUpdatedAt');
  });

  // ── Cache-Control ─────────────────────────────────────────────────────────

  it('response always carries Cache-Control: no-store', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/subscription/refresh-entitlement',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.headers['cache-control']).toBe('no-store');
  });
});

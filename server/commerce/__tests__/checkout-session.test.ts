/**
 * server/commerce/__tests__/checkout-session.test.ts
 *
 * Unit tests for POST /api/checkout/session (WP-06A).
 *
 * WP-06A — POST /api/checkout/session
 * Governing spec: subscription-checkout-contract v1.0.0, api.contract v1.1.0 §6.1
 * Acceptance: K-04 (Pro depth paywall — checkout init), K-05 (subscription entitlement gating)
 * Version impact: none
 *
 * Strategy: minimal Fastify instance per test, InMemorySessionAdapter injected
 * (no real DB calls), MockCheckoutProvider / FailingCheckoutProvider for
 * success and error paths. All assertions use Fastify inject() — no real network I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerCommerceRouter } from '../commerce-router.js';
import { InMemorySessionAdapter } from '../../auth/session-adapter-memory.js';
import { setSessionAdapter } from '../../auth/session-factory.js';
import { COOKIE_NAME } from '../../auth/cookie-config.js';
import {
  MemoryCheckoutStore,
  setCheckoutStore,
  setCheckoutProvider,
  CheckoutProviderUnavailableError,
} from '../checkout-service.js';
import type { CheckoutProvider } from '../stripe-client.js';
import type { SessionRecord } from '../../auth/session-adapter.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFutureDate(offsetMs = 30 * 24 * 60 * 60 * 1000): Date {
  return new Date(Date.now() + offsetMs);
}

/** Seeds a session into the adapter and returns the sessionId. */
async function seedSession(
  adapter: InMemorySessionAdapter,
  overrides: Partial<Omit<SessionRecord, 'sessionId' | 'issuedAtUtc' | 'lastSeenAtUtc' | 'revokedAtUtc'>> = {},
): Promise<string> {
  const session = await adapter.createSession({
    userId: 'usr_test_abc123',
    email: 'alice@example.com',
    tier: 'free',
    isPro: false,
    expiresAtUtc: makeFutureDate(),
    ...overrides,
  });
  return session.sessionId;
}

// ── Failing provider (for error path tests) ───────────────────────────────────

class FailingCheckoutProvider implements CheckoutProvider {
  async createCheckoutSession(): Promise<{ checkoutSessionId: string; checkoutUrl: string }> {
    throw new Error('Stripe is unavailable');
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('POST /api/checkout/session', () => {
  let app: ReturnType<typeof fastify>;
  let sessionAdapter: InMemorySessionAdapter;
  let checkoutStore: MemoryCheckoutStore;

  beforeEach(async () => {
    app = fastify({ logger: false });
    sessionAdapter = new InMemorySessionAdapter();
    checkoutStore = new MemoryCheckoutStore();

    // Inject test doubles
    setSessionAdapter(sessionAdapter);
    setCheckoutStore(checkoutStore);
    // Default: use the mock (non-failing) provider
    setCheckoutProvider({
      async createCheckoutSession(params) {
        return {
          checkoutSessionId: `cs_mock_${Date.now()}`,
          checkoutUrl: `${params.returnUrl}?mock=true`,
        };
      },
    });

    await app.register(fastifyCookie);
    await registerCommerceRouter(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── 1. no-session ──────────────────────────────────────────────────────────

  it('no-session: missing cookie returns 401 SESSION_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planKey: 'pro_monthly' }),
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('SESSION_REQUIRED');
    expect(body.error.details.retryable).toBe(false);
  });

  // ── 2. invalid-session ─────────────────────────────────────────────────────

  it('invalid-session: cookie present but session not found returns 401 SESSION_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=nonexistent_session_id`,
      },
      body: JSON.stringify({ planKey: 'pro_monthly' }),
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('SESSION_REQUIRED');
    expect(body.error.details.retryable).toBe(false);
  });

  // ── 3. invalid-plan-key ────────────────────────────────────────────────────

  it('invalid-plan-key: unknown planKey returns 400 INVALID_PLAN_KEY', async () => {
    const sessionId = await seedSession(sessionAdapter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ planKey: 'enterprise_annual' }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_PLAN_KEY');
    expect(body.error.details.retryable).toBe(false);
  });

  it('invalid-plan-key: missing planKey returns 400 INVALID_PLAN_KEY', async () => {
    const sessionId = await seedSession(sessionAdapter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_PLAN_KEY');
  });

  // ── 4. already-entitled ────────────────────────────────────────────────────

  it('already-entitled: isPro=true session returns 409 ALREADY_ENTITLED', async () => {
    const sessionId = await seedSession(sessionAdapter, { isPro: true, tier: 'pro' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ planKey: 'pro_monthly' }),
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('ALREADY_ENTITLED');
    expect(body.error.details.retryable).toBe(false);
  });

  // ── 5. success ─────────────────────────────────────────────────────────────

  it('success: valid session + pro_monthly returns 200 with checkoutSessionId and checkoutUrl', async () => {
    const sessionId = await seedSession(sessionAdapter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({
        planKey: 'pro_monthly',
        returnContext: {
          returnTo: '/pro',
          intent: { type: 'checkout_return' },
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.checkoutSessionId).toBe('string');
    expect(body.checkoutSessionId.length).toBeGreaterThan(0);
    expect(typeof body.checkoutUrl).toBe('string');
    expect(body.checkoutUrl.length).toBeGreaterThan(0);
  });

  it('success: reconciliation record is persisted after successful checkout', async () => {
    const sessionId = await seedSession(sessionAdapter);

    await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ planKey: 'pro_monthly' }),
    });

    const records = checkoutStore.getAll();
    expect(records).toHaveLength(1);
    expect(records[0]!.planKey).toBe('pro_monthly');
    expect(records[0]!.email).toBe('alice@example.com');
  });

  // ── 6. provider-error ──────────────────────────────────────────────────────

  it('provider-error: provider throws returns 503 CHECKOUT_PROVIDER_UNAVAILABLE', async () => {
    setCheckoutProvider(new FailingCheckoutProvider());

    const sessionId = await seedSession(sessionAdapter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ planKey: 'pro_monthly' }),
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('CHECKOUT_PROVIDER_UNAVAILABLE');
    expect(body.error.details.retryable).toBe(true);
  });

  // ── 7. error envelope shape ────────────────────────────────────────────────

  it('error envelope matches api.contract v1.1.0 §2.2 for SESSION_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planKey: 'pro_monthly' }),
    });

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('error.code');
    expect(body).toHaveProperty('error.message');
    expect(body).toHaveProperty('error.details.reason');
    expect(typeof body.error.details.retryable).toBe('boolean');
  });

  // ── 8. Cache-Control header ────────────────────────────────────────────────

  it('response always includes Cache-Control: no-store', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/session',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planKey: 'pro_monthly' }),
    });

    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// ── CheckoutProviderUnavailableError unit test ────────────────────────────────

describe('CheckoutProviderUnavailableError', () => {
  it('wraps original Error message', () => {
    const err = new CheckoutProviderUnavailableError(new Error('timeout'));
    expect(err.name).toBe('CheckoutProviderUnavailableError');
    expect(err.message).toContain('timeout');
  });

  it('wraps non-Error value as string', () => {
    const err = new CheckoutProviderUnavailableError('network failure');
    expect(err.message).toContain('network failure');
  });
});

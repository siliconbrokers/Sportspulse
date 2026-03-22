/**
 * server/commerce/__tests__/reconcile.test.ts
 *
 * Unit tests for POST /api/checkout/return/reconcile (WP-06B).
 *
 * Governing spec: subscription-checkout-contract v1.0.0, api.contract v1.1.0 §6.3
 * Acceptance: K-04, K-05
 * Version impact: none
 *
 * Strategy: minimal Fastify instance per test, InMemorySessionAdapter +
 * MemoryCheckoutStore + MemoryEntitlementStore injected (no real DB calls).
 * MockStripeStatusProvider overridden per test. All assertions via inject().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerCommerceRouter } from '../commerce-router.js';
import { InMemorySessionAdapter } from '../../auth/session-adapter-memory.js';
import { setSessionAdapter } from '../../auth/session-factory.js';
import { COOKIE_NAME } from '../../auth/cookie-config.js';
import { MemoryCheckoutStore, setCheckoutStore, setCheckoutProvider } from '../checkout-service.js';
import { MemoryEntitlementStore, setEntitlementStore } from '../subscription-service.js';
import { setStripeStatusProvider } from '../reconcile-service.js';
import type { StripeStatusProvider, PaymentStatus } from '../reconcile-service.js';
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
    userId: 'usr_test_abc123',
    email: 'alice@example.com',
    tier: 'free',
    isPro: false,
    expiresAtUtc: makeFutureDate(),
    ...overrides,
  });
  return session.sessionId;
}

/** Seeds a checkout record via POST /api/checkout/session and returns the checkoutSessionId. */
async function seedCheckout(
  app: ReturnType<typeof fastify>,
  sessionId: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/checkout/session',
    headers: {
      'content-type': 'application/json',
      cookie: `${COOKIE_NAME}=${sessionId}`,
    },
    body: JSON.stringify({ planKey: 'pro_monthly' }),
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as { checkoutSessionId: string };
  return body.checkoutSessionId;
}

// ── Status provider that returns a fixed status ───────────────────────────────

function makeStatusProvider(status: PaymentStatus): StripeStatusProvider {
  return {
    async getCheckoutStatus(_id: string): Promise<PaymentStatus> {
      return status;
    },
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('POST /api/checkout/return/reconcile', () => {
  let app: ReturnType<typeof fastify>;
  let sessionAdapter: InMemorySessionAdapter;
  let checkoutStore: MemoryCheckoutStore;
  let entitlementStore: MemoryEntitlementStore;

  beforeEach(async () => {
    app = fastify({ logger: false });
    sessionAdapter = new InMemorySessionAdapter();
    checkoutStore = new MemoryCheckoutStore();
    entitlementStore = new MemoryEntitlementStore();

    setSessionAdapter(sessionAdapter);
    setCheckoutStore(checkoutStore);
    setEntitlementStore(entitlementStore);

    // Default checkout provider: mock that deterministically creates sessions.
    let counter = 0;
    setCheckoutProvider({
      async createCheckoutSession() {
        counter += 1;
        return {
          checkoutSessionId: `cs_mock_test_${counter}`,
          checkoutUrl: `http://localhost/pro?mock=true&n=${counter}`,
        };
      },
    });

    // Default status provider: always paid (overridden per test as needed).
    setStripeStatusProvider(makeStatusProvider('paid'));

    await app.register(fastifyCookie);
    await registerCommerceRouter(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── 1. reauth-required ────────────────────────────────────────────────────

  it('reauth-required: no cookie → result=reauth_required, sessionStatus=anonymous', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkoutSessionId: 'cs_some_id' }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result).toBe('reauth_required');
    expect(body.session.sessionStatus).toBe('anonymous');
    expect(body.session.isPro).toBe(false);
    expect(body.session.userId).toBeNull();
  });

  it('reauth-required: invalid/expired session cookie → result=reauth_required', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=nonexistent_session_id`,
      },
      body: JSON.stringify({ checkoutSessionId: 'cs_some_id' }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result).toBe('reauth_required');
    expect(body.session.sessionStatus).toBe('anonymous');
  });

  // ── 2. reconciled ─────────────────────────────────────────────────────────

  it('reconciled: paid checkout + valid session + same userId → result=reconciled, isPro=true', async () => {
    const sessionId = await seedSession(sessionAdapter);
    const checkoutSessionId = await seedCheckout(app, sessionId);

    setStripeStatusProvider(makeStatusProvider('paid'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ checkoutSessionId }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result).toBe('reconciled');
    expect(body.session.sessionStatus).toBe('authenticated');
    expect(body.session.tier).toBe('pro');
    expect(body.session.isPro).toBe(true);
    expect(body.session.userId).toBe('usr_test_abc123');
    expect(typeof body.session.sessionIssuedAt).toBe('string');
  });

  it('reconciled: entitlement store is updated to tier=pro, state=active', async () => {
    const sessionId = await seedSession(sessionAdapter);
    const checkoutSessionId = await seedCheckout(app, sessionId);

    await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ checkoutSessionId }),
    });

    const entitlement = await entitlementStore.find('usr_test_abc123');
    expect(entitlement).not.toBeNull();
    expect(entitlement!.tier).toBe('pro');
    expect(entitlement!.state).toBe('active');
  });

  // ── 3. pending ────────────────────────────────────────────────────────────

  it('pending: payment not yet confirmed → result=pending, session unchanged', async () => {
    const sessionId = await seedSession(sessionAdapter);
    const checkoutSessionId = await seedCheckout(app, sessionId);

    setStripeStatusProvider(makeStatusProvider('pending'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ checkoutSessionId }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result).toBe('pending');
    expect(body.session.sessionStatus).toBe('authenticated');
    expect(body.session.isPro).toBe(false);
    expect(body.session.tier).toBe('free');
  });

  // ── 4. not-paid ───────────────────────────────────────────────────────────

  it('not-paid: checkout abandoned/expired → 409 CHECKOUT_NOT_PAID', async () => {
    const sessionId = await seedSession(sessionAdapter);
    const checkoutSessionId = await seedCheckout(app, sessionId);

    setStripeStatusProvider(makeStatusProvider('not_paid'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ checkoutSessionId }),
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('CHECKOUT_NOT_PAID');
    expect(body.error.details.retryable).toBe(false);
  });

  it('not-found: unknown checkoutSessionId → 400 INVALID_CHECKOUT_SESSION_ID', async () => {
    const sessionId = await seedSession(sessionAdapter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({ checkoutSessionId: 'cs_does_not_exist' }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_CHECKOUT_SESSION_ID');
    expect(body.error.details.retryable).toBe(false);
  });

  it('missing checkoutSessionId in body → 400 INVALID_CHECKOUT_SESSION_ID', async () => {
    const sessionId = await seedSession(sessionAdapter);

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_CHECKOUT_SESSION_ID');
  });

  // ── 5. owner-mismatch ─────────────────────────────────────────────────────

  it('owner-mismatch: checkout userId ≠ session userId → 409 CHECKOUT_OWNER_MISMATCH', async () => {
    // Seed a checkout for user A.
    const sessionA = await seedSession(sessionAdapter, {
      userId: 'usr_owner_a',
      email: 'a@example.com',
    });
    const checkoutSessionId = await seedCheckout(app, sessionA);

    // Now authenticate as user B.
    const sessionB = await seedSession(sessionAdapter, {
      userId: 'usr_other_b',
      email: 'b@example.com',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: {
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${sessionB}`,
      },
      body: JSON.stringify({ checkoutSessionId }),
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('CHECKOUT_OWNER_MISMATCH');
    expect(body.error.details.retryable).toBe(false);
  });

  // ── Cache-Control ─────────────────────────────────────────────────────────

  it('response always carries Cache-Control: no-store', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkout/return/reconcile',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkoutSessionId: 'cs_x' }),
    });

    expect(res.headers['cache-control']).toBe('no-store');
  });
});

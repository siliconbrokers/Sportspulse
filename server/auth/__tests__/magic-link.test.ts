/**
 * server/auth/__tests__/magic-link.test.ts
 *
 * Unit tests for POST /api/auth/magic-link/start + /complete (WP-04B).
 *
 * WP-04B — POST /api/auth/magic-link/start + /complete
 * Governing spec: session-auth-contract v1.0.0, magic-link-email-delivery v1.0.0,
 *   api.contract v1.1.0
 * Acceptance: K-06 (anonymous-first auth flow), K-04 (isPro determination)
 * Version impact: none
 *
 * Strategy: minimal Fastify instance per test, LogSinkEmailAdapter injected
 * (no real Resend calls), InMemorySessionAdapter + MemoryMagicLinkStore.
 * All assertions use Fastify inject() — no real network I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { registerAuthRouter } from '../auth-router.js';
import { InMemorySessionAdapter } from '../session-adapter-memory.js';
import { setSessionAdapter } from '../session-factory.js';
import { LogSinkEmailAdapter } from '../email-sink.js';
import { setEmailAdapter } from '../email-factory.js';
import {
  MemoryMagicLinkStore,
  setMagicLinkStore,
  issueMagicLink,
} from '../magic-link-service.js';
import { COOKIE_NAME } from '../cookie-config.js';
import { rateLimitErrorBuilder } from '../rate-limit-config.js';
import { randomUUID, createHash } from 'node:crypto';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/magic-link/start + /complete', () => {
  let app: ReturnType<typeof fastify>;
  let sessionAdapter: InMemorySessionAdapter;
  let emailAdapter: LogSinkEmailAdapter;
  let store: MemoryMagicLinkStore;

  beforeEach(async () => {
    app = fastify({ logger: false });
    sessionAdapter = new InMemorySessionAdapter();
    emailAdapter = new LogSinkEmailAdapter();
    store = new MemoryMagicLinkStore();

    // Inject test doubles
    setSessionAdapter(sessionAdapter);
    setEmailAdapter(emailAdapter);
    setMagicLinkStore(store);

    await app.register(fastifyCookie);
    await registerAuthRouter(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── 1. start-valid ─────────────────────────────────────────────────────────

  it('start-valid: valid email returns 202 requestAccepted=true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/start',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com' }),
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.requestAccepted).toBe(true);
    expect(typeof body.cooldownSeconds).toBe('number');
    expect(body.cooldownSeconds).toBeGreaterThan(0);
  });

  // ── 2. start-invalid-email ─────────────────────────────────────────────────

  it('start-invalid-email: malformed email returns 400 INVALID_EMAIL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/start',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_EMAIL');
  });

  it('start-invalid-email: missing email field returns 400 INVALID_EMAIL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/start',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_EMAIL');
  });

  // ── 3. start-invalid-return-context ───────────────────────────────────────

  it('start-invalid-return-context: returnTo with :// returns 400 INVALID_RETURN_CONTEXT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/start',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        returnContext: { returnTo: 'https://evil.com/steal?token=x' },
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_RETURN_CONTEXT');
  });

  it('start-invalid-return-context: returnTo not starting with / returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/start',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        returnContext: { returnTo: 'dashboard' },
      }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_RETURN_CONTEXT');
  });

  // ── 4. complete-valid ──────────────────────────────────────────────────────

  it('complete-valid: valid token returns 200 with session.sessionStatus=authenticated and correct returnTo', async () => {
    // Issue a token directly via the service (populates store)
    const token = randomUUID();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAtUtc = new Date(now.getTime() + 15 * 60 * 1000);

    await store.save({
      magicLinkId: randomUUID(),
      email: 'alice@example.com',
      tokenHash,
      returnContext: { returnTo: '/predicciones?matchId=match_123', intent: { type: 'pro_depth' } },
      issuedAtUtc: now,
      expiresAtUtc,
      consumedAtUtc: null,
      providerMessageId: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/complete',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.session.sessionStatus).toBe('authenticated');
    expect(body.session.email).toBe('alice@example.com');
    expect(body.session.tier).toBe('free');
    expect(body.session.isPro).toBe(false);
    expect(typeof body.session.sessionIssuedAt).toBe('string');
    expect(new Date(body.session.sessionIssuedAt).getTime()).not.toBeNaN();
    expect(body.resume.returnTo).toBe('/predicciones?matchId=match_123');
  });

  // ── 5. complete-invalid-token ──────────────────────────────────────────────

  it('complete-invalid-token: unknown token returns 400 INVALID_TOKEN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/complete',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: randomUUID() }),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  // ── 6. complete-expired ────────────────────────────────────────────────────

  it('complete-expired: expired token returns 410 TOKEN_EXPIRED', async () => {
    const token = randomUUID();
    const tokenHash = hashToken(token);
    const past = new Date(Date.now() - 1000); // already expired

    await store.save({
      magicLinkId: randomUUID(),
      email: 'bob@example.com',
      tokenHash,
      returnContext: null,
      issuedAtUtc: new Date(Date.now() - 20 * 60 * 1000),
      expiresAtUtc: past,
      consumedAtUtc: null,
      providerMessageId: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/complete',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    expect(res.statusCode).toBe(410);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('TOKEN_EXPIRED');
  });

  // ── 7. complete-already-used ───────────────────────────────────────────────

  it('complete-already-used: consumed token returns 409 TOKEN_ALREADY_USED', async () => {
    const token = randomUUID();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAtUtc = new Date(now.getTime() + 15 * 60 * 1000);

    await store.save({
      magicLinkId: randomUUID(),
      email: 'carol@example.com',
      tokenHash,
      returnContext: null,
      issuedAtUtc: now,
      expiresAtUtc,
      consumedAtUtc: new Date(), // already consumed
      providerMessageId: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/complete',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('TOKEN_ALREADY_USED');
  });

  // ── 8. complete-sets-cookie ────────────────────────────────────────────────

  it('complete-sets-cookie: successful complete sets sp_session cookie', async () => {
    const token = randomUUID();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAtUtc = new Date(now.getTime() + 15 * 60 * 1000);

    await store.save({
      magicLinkId: randomUUID(),
      email: 'dave@example.com',
      tokenHash,
      returnContext: { returnTo: '/dashboard' },
      issuedAtUtc: now,
      expiresAtUtc,
      consumedAtUtc: null,
      providerMessageId: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/complete',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    expect(res.statusCode).toBe(200);

    const setCookieHeader = res.headers['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.join('; ')
      : String(setCookieHeader ?? '');
    expect(cookieStr).toContain(`${COOKIE_NAME}=`);
    // Verify HttpOnly is set
    expect(cookieStr.toLowerCase()).toContain('httponly');
  });

  // ── 9. single-use enforcement ──────────────────────────────────────────────

  it('single-use: completing same token twice returns 409 on second attempt', async () => {
    const token = randomUUID();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAtUtc = new Date(now.getTime() + 15 * 60 * 1000);

    await store.save({
      magicLinkId: randomUUID(),
      email: 'eve@example.com',
      tokenHash,
      returnContext: null,
      issuedAtUtc: now,
      expiresAtUtc,
      consumedAtUtc: null,
      providerMessageId: null,
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/complete',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/complete',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(second.statusCode).toBe(409);
    const body = JSON.parse(second.body);
    expect(body.error.code).toBe('TOKEN_ALREADY_USED');
  });

  // ── 10. error envelope shape ───────────────────────────────────────────────

  it('error envelope has correct shape for INVALID_EMAIL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link/start',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bad' }),
    });

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('error.code');
    expect(body).toHaveProperty('error.message');
    expect(body).toHaveProperty('error.details.reason');
    expect(typeof body.error.details.retryable).toBe('boolean');
  });

  // ── 11. rate-limit error builder ───────────────────────────────────────────
  // Strategy: unit-test the errorResponseBuilder directly (no Fastify instance
  // needed). The builder is registered via errorResponseBuilder in server/index.ts
  // and exported from rate-limit-config.ts for testability.
  // Per api.contract v1.1.0 §5.2 the 429 must emit MAGIC_LINK_RATE_LIMITED.
});

describe('rateLimitErrorBuilder — 429 envelope (unit)', () => {
  it('returns MAGIC_LINK_RATE_LIMITED code', () => {
    const result = rateLimitErrorBuilder(null, { ttl: 45000 });
    expect(result.error.code).toBe('MAGIC_LINK_RATE_LIMITED');
  });

  it('retryable is true', () => {
    const result = rateLimitErrorBuilder(null, { ttl: 45000 });
    expect(result.error.details.retryable).toBe(true);
  });

  it('retryAfter rounds up from milliseconds to whole seconds', () => {
    const result = rateLimitErrorBuilder(null, { ttl: 45000 });
    expect(result.error.details.retryAfter).toBe(45);
  });

  it('retryAfter uses Math.ceil (partial second rounds up)', () => {
    const result = rateLimitErrorBuilder(null, { ttl: 45001 });
    expect(result.error.details.retryAfter).toBe(46);
  });

  it('has reason RATE_LIMIT_EXCEEDED', () => {
    const result = rateLimitErrorBuilder(null, { ttl: 60000 });
    expect(result.error.details.reason).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('has a non-empty message string', () => {
    const result = rateLimitErrorBuilder(null, { ttl: 60000 });
    expect(typeof result.error.message).toBe('string');
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it('full envelope shape matches api.contract v1.1.0 §2.2', () => {
    const result = rateLimitErrorBuilder(null, { ttl: 30000 });
    expect(result).toHaveProperty('error.code');
    expect(result).toHaveProperty('error.message');
    expect(result).toHaveProperty('error.details.reason');
    expect(result).toHaveProperty('error.details.retryable');
    expect(result).toHaveProperty('error.details.retryAfter');
  });
});

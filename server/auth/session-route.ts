/**
 * server/auth/session-route.ts — GET /api/session handler (WP-04A)
 *
 * Acceptance IDs: K-06 (anonymous-first prerequisite),
 *   K-04 (isPro determination — backend only, never inferred locally).
 *
 * Contract (spec.sportpulse.api.contract.md v1.1.0):
 *   - Always returns HTTP 200 with a SessionDTO.
 *   - anonymous is not an error; the frontend must handle it as a normal state.
 *   - Response always carries Cache-Control: no-store.
 *   - When a session is authenticated, touchSession() is called to slide the
 *     idle TTL forward.
 *   - When a cookie is present but the session is not found (expired/revoked),
 *     clearCookie(COOKIE_NAME, { path: '/' }) is called to remove the stale cookie.
 *
 * SessionDTO shape:
 *   sessionStatus: 'anonymous' | 'authenticated' | 'expired'
 *   userId:        string | null
 *   email:         string | null
 *   tier:          'free' | 'pro' | null   (null only on error — never in normal flow)
 *   isPro:         boolean
 *   sessionIssuedAt: ISO-8601 string | null
 */

import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME } from './cookie-config.js';
import { getSessionAdapter } from './session-factory.js';

export async function registerSessionRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    const sessionId: string | undefined = request.cookies[COOKIE_NAME];

    // ── No cookie → anonymous ────────────────────────────────────────────────
    if (!sessionId) {
      return reply.send({
        sessionStatus: 'anonymous',
        userId: null,
        email: null,
        tier: 'free',
        isPro: false,
        sessionIssuedAt: null,
      });
    }

    // ── Cookie present — look up in store ────────────────────────────────────
    const adapter = getSessionAdapter();
    const session = await adapter.getSession(sessionId);

    if (!session) {
      // Cookie present but session is expired, revoked, or unknown.
      // Clear the stale cookie so the browser does not keep sending it.
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return reply.send({
        sessionStatus: 'expired',
        userId: null,
        email: null,
        tier: 'free',
        isPro: false,
        sessionIssuedAt: null,
      });
    }

    // ── Valid session — slide idle TTL then respond ───────────────────────────
    await adapter.touchSession(sessionId);

    return reply.send({
      sessionStatus: 'authenticated',
      userId: session.userId,
      email: session.email,
      tier: session.tier,
      isPro: session.isPro,
      sessionIssuedAt: session.issuedAtUtc.toISOString(),
    });
  });
}

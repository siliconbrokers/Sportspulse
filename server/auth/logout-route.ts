/**
 * server/auth/logout-route.ts — POST /api/logout handler (WP-04C)
 *
 * WP-04C — POST /api/logout + expired-session handling
 * Acceptance: WP-04C (no direct K-series ID — logout is a prerequisite for K-04, K-06)
 * Note: session-auth-contract v1.0.0 §5.4 is the governing authority for this behavior.
 * A dedicated acceptance matrix entry should be added (e.g., K-09) in a future matrix update.
 * Coverage: logout idempotent, cookie cleanup, session revocation
 * Version impact: none — no policyVersion/layoutAlgorithmVersion/snapshotSchemaVersion bump
 *
 * Contract (spec.sportpulse.api.contract.md v1.1.0, section 5.4):
 *   POST /api/logout — No request body. Returns 204.
 *
 * Behaviour (session-auth-contract v1.0.0):
 *   - Idempotent: always returns 204, never errors.
 *   - No cookie → 204 immediately (nothing to do).
 *   - Cookie present but session already revoked/expired → 204 (revokeSession is idempotent).
 *   - Cookie present with active session → revokeSession → clearCookie → 204.
 *   - Cookie is always cleared if present, regardless of session state.
 *   - Cache-Control: no-store on all responses.
 */

import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME } from './cookie-config.js';
import { getSessionAdapter } from './session-factory.js';

export async function registerLogoutRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/logout', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    const sessionId: string | undefined = request.cookies[COOKIE_NAME];

    if (sessionId) {
      const adapter = getSessionAdapter();
      // revokeSession is idempotent — silently no-ops if already revoked or unknown.
      await adapter.revokeSession(sessionId);
      // Always clear the cookie when present, regardless of session state.
      reply.clearCookie(COOKIE_NAME, { path: '/' });
    }

    return reply.status(204).send();
  });
}

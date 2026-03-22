/**
 * server/commerce/commerce-router.ts — Commerce routes (WP-06A, WP-06B, WP-06C)
 *
 * WP-06A — POST /api/checkout/session
 * WP-06B — POST /api/checkout/return/reconcile
 * WP-06C — GET  /api/subscription/status
 *          POST /api/subscription/refresh-entitlement
 *
 * Governing spec: subscription-checkout-contract v1.0.0, api.contract v1.1.0 §6.1–6.4
 * Acceptance: K-04, K-05, K-07
 * Version impact: none
 *
 * Error envelope: { error: { code, message, details: { reason, retryable } } }
 */

import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, cookieOptions } from '../auth/cookie-config.js';
import { getSessionAdapter } from '../auth/session-factory.js';
import {
  createCheckoutSession,
  CheckoutProviderUnavailableError,
} from './checkout-service.js';
import {
  reconcileCheckout,
  InvalidCheckoutSessionIdError,
  CheckoutOwnerMismatchError,
  CheckoutNotPaidError,
  ReconcileUnavailableError,
} from './reconcile-service.js';
import {
  getEntitlementStatus,
  refreshEntitlement,
  EntitlementStatusUnavailableError,
  EntitlementRefreshUnavailableError,
} from './subscription-service.js';

// ── Valid plan keys ───────────────────────────────────────────────────────────

const VALID_PLAN_KEYS = new Set(['pro_monthly']);

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorBody(
  code: string,
  message: string,
  reason: string,
  retryable: boolean,
): { error: { code: string; message: string; details: { reason: string; retryable: boolean } } } {
  return { error: { code, message, details: { reason, retryable } } };
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function registerCommerceRouter(app: FastifyInstance): Promise<void> {
  // ── POST /api/checkout/session ────────────────────────────────────────────
  app.post('/api/checkout/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    // ── 1. Authenticate session ────────────────────────────────────────────
    const sessionId = request.cookies?.[COOKIE_NAME];
    if (!sessionId || sessionId.trim() === '') {
      return reply.status(401).send(
        errorBody(
          'SESSION_REQUIRED',
          'Authentication required. Please log in to continue.',
          'no session cookie present',
          false,
        ),
      );
    }

    const sessionAdapter = getSessionAdapter();
    const session = await sessionAdapter.getSession(sessionId);

    if (!session) {
      return reply.status(401).send(
        errorBody(
          'SESSION_REQUIRED',
          'Session not found or expired. Please log in again.',
          'session not found or revoked',
          false,
        ),
      );
    }

    // ── 2. Validate request body ───────────────────────────────────────────
    const body = request.body as Record<string, unknown> | null | undefined;
    const planKey = body?.['planKey'];

    if (typeof planKey !== 'string' || !VALID_PLAN_KEYS.has(planKey)) {
      return reply.status(400).send(
        errorBody(
          'INVALID_PLAN_KEY',
          `The plan key "${String(planKey)}" is not valid.`,
          `planKey must be one of: ${[...VALID_PLAN_KEYS].join(', ')}`,
          false,
        ),
      );
    }

    // ── 3. Check entitlement ───────────────────────────────────────────────
    if (session.isPro) {
      return reply.status(409).send(
        errorBody(
          'ALREADY_ENTITLED',
          'Your account already has Pro access.',
          'user is already Pro',
          false,
        ),
      );
    }

    // ── 4. Create checkout session ────────────────────────────────────────
    const returnContextRaw = body?.['returnContext'] as Record<string, unknown> | undefined;
    const returnContext =
      returnContextRaw !== undefined && returnContextRaw !== null
        ? {
            returnTo: (returnContextRaw['returnTo'] as string | undefined) ?? '/pro',
            intent: returnContextRaw['intent'],
          }
        : null;

    try {
      const result = await createCheckoutSession(
        session.userId,
        session.email,
        planKey,
        returnContext,
      );

      return reply.status(200).send({
        checkoutSessionId: result.checkoutSessionId,
        checkoutUrl: result.checkoutUrl,
      });
    } catch (err) {
      if (err instanceof CheckoutProviderUnavailableError) {
        return reply.status(503).send(
          errorBody(
            'CHECKOUT_PROVIDER_UNAVAILABLE',
            'The checkout service is temporarily unavailable. Please try again later.',
            'checkout provider returned an error',
            true,
          ),
        );
      }
      throw err;
    }
  });

  // ── POST /api/checkout/return/reconcile ────────────────────────────────────

  app.post('/api/checkout/return/reconcile', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    const body = request.body as Record<string, unknown> | null | undefined;
    const checkoutSessionId = body?.['checkoutSessionId'];

    if (typeof checkoutSessionId !== 'string' || checkoutSessionId.trim() === '') {
      return reply.status(400).send(
        errorBody(
          'INVALID_CHECKOUT_SESSION_ID',
          'A valid checkoutSessionId is required.',
          'checkoutSessionId is missing or not a string',
          false,
        ),
      );
    }

    // ── Resolve optional session (orphaned-return policy: no 401 here) ───────
    const sessionId = request.cookies?.[COOKIE_NAME];
    const sessionAdapter = getSessionAdapter();
    const activeSession = sessionId ? await sessionAdapter.getSession(sessionId) : null;

    if (!activeSession) {
      // Orphaned return: user is not logged in — return reauth_required, not 401.
      return reply.status(200).send({
        result: 'reauth_required',
        session: {
          sessionStatus: 'anonymous',
          userId: null,
          email: null,
          tier: 'free',
          isPro: false,
          sessionIssuedAt: null,
        },
      });
    }

    // ── Reconcile ─────────────────────────────────────────────────────────────
    try {
      const reconcileResult = await reconcileCheckout(checkoutSessionId, activeSession.userId);

      // If reconciled, update the session cookie to reflect Pro tier.
      if (reconcileResult.outcome === 'reconciled') {
        const updatedSession = await sessionAdapter.createSession({
          userId: activeSession.userId,
          email: activeSession.email,
          tier: 'pro',
          isPro: true,
          expiresAtUtc: activeSession.expiresAtUtc,
        });
        await sessionAdapter.revokeSession(activeSession.sessionId);

        const isProd = process.env['NODE_ENV'] === 'production';
        reply.setCookie(COOKIE_NAME, updatedSession.sessionId, cookieOptions(isProd));

        return reply.status(200).send({
          result: 'reconciled',
          session: {
            sessionStatus: 'authenticated',
            userId: updatedSession.userId,
            email: updatedSession.email,
            tier: updatedSession.tier,
            isPro: updatedSession.isPro,
            sessionIssuedAt: updatedSession.issuedAtUtc.toISOString(),
          },
        });
      }

      // Pending: session unchanged.
      return reply.status(200).send({
        result: 'pending',
        session: {
          sessionStatus: 'authenticated',
          userId: activeSession.userId,
          email: activeSession.email,
          tier: activeSession.tier,
          isPro: activeSession.isPro,
          sessionIssuedAt: activeSession.issuedAtUtc.toISOString(),
        },
      });
    } catch (err) {
      if (err instanceof InvalidCheckoutSessionIdError) {
        return reply.status(400).send(
          errorBody(
            'INVALID_CHECKOUT_SESSION_ID',
            'The checkout session ID was not found.',
            'checkout session not found in store or Stripe',
            false,
          ),
        );
      }
      if (err instanceof CheckoutOwnerMismatchError) {
        return reply.status(409).send(
          errorBody(
            'CHECKOUT_OWNER_MISMATCH',
            'This checkout session belongs to a different account.',
            'userId of active session does not match checkout owner',
            false,
          ),
        );
      }
      if (err instanceof CheckoutNotPaidError) {
        return reply.status(409).send(
          errorBody(
            'CHECKOUT_NOT_PAID',
            'Checkout session was not paid.',
            'PAYMENT_NOT_COMPLETED',
            false,
          ),
        );
      }
      if (err instanceof ReconcileUnavailableError) {
        return reply.status(503).send(
          errorBody(
            'RECONCILE_UNAVAILABLE',
            'The reconciliation service is temporarily unavailable. Please try again later.',
            'Stripe status check failed',
            true,
          ),
        );
      }
      throw err;
    }
  });

  // ── GET /api/subscription/status ──────────────────────────────────────────

  app.get('/api/subscription/status', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    const sessionId = request.cookies?.[COOKIE_NAME];
    if (!sessionId || sessionId.trim() === '') {
      return reply.status(401).send(
        errorBody('SESSION_REQUIRED', 'Authentication required.', 'no session cookie present', false),
      );
    }

    const sessionAdapter = getSessionAdapter();
    const session = await sessionAdapter.getSession(sessionId);

    if (!session) {
      return reply.status(401).send(
        errorBody(
          'SESSION_REQUIRED',
          'Session not found or expired. Please log in again.',
          'session not found or revoked',
          false,
        ),
      );
    }

    try {
      const entitlement = await getEntitlementStatus(session.userId);
      return reply.status(200).send({
        userId: entitlement.userId,
        tier: entitlement.tier,
        state: entitlement.state,
        entitlementUpdatedAt: entitlement.entitlementUpdatedAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof EntitlementStatusUnavailableError) {
        return reply.status(503).send(
          errorBody(
            'ENTITLEMENT_STATUS_UNAVAILABLE',
            'Unable to retrieve entitlement status. Please try again later.',
            'entitlement store query failed',
            true,
          ),
        );
      }
      throw err;
    }
  });

  // ── POST /api/subscription/refresh-entitlement ───────────────────────────

  app.post('/api/subscription/refresh-entitlement', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    const sessionId = request.cookies?.[COOKIE_NAME];
    if (!sessionId || sessionId.trim() === '') {
      return reply.status(401).send(
        errorBody('SESSION_REQUIRED', 'Authentication required.', 'no session cookie present', false),
      );
    }

    const sessionAdapter = getSessionAdapter();
    const session = await sessionAdapter.getSession(sessionId);

    if (!session) {
      return reply.status(401).send(
        errorBody(
          'SESSION_REQUIRED',
          'Session not found or expired. Please log in again.',
          'session not found or revoked',
          false,
        ),
      );
    }

    try {
      const entitlement = await refreshEntitlement(session.userId);
      return reply.status(200).send({
        userId: entitlement.userId,
        tier: entitlement.tier,
        state: entitlement.state,
        entitlementUpdatedAt: entitlement.entitlementUpdatedAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof EntitlementRefreshUnavailableError) {
        return reply.status(503).send(
          errorBody(
            'ENTITLEMENT_REFRESH_UNAVAILABLE',
            'Unable to refresh entitlement status. Please try again later.',
            'entitlement store query failed',
            true,
          ),
        );
      }
      throw err;
    }
  });
}

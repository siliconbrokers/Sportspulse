/**
 * server/auth/auth-router.ts — Auth routes for magic-link flow (WP-04B)
 *
 * WP-04B — POST /api/auth/magic-link/start + /complete
 * Governing spec: session-auth-contract v1.0.0, magic-link-email-delivery v1.0.0,
 *   api.contract v1.1.0
 * Acceptance: K-06 (anonymous-first auth flow), K-04 (isPro determination — session
 *   created with tier)
 * Version impact: none
 *
 * Routes:
 *   POST /api/auth/magic-link/start    — issue a magic-link token, send email
 *   POST /api/auth/magic-link/complete — consume token, create session, set cookie
 *
 * Error envelope: { error: { code, message, details: { reason, retryable } } }
 */

import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, cookieOptions } from './cookie-config.js';
import {
  issueMagicLink,
  completeMagicLink,
  MagicLinkNotFoundError,
  MagicLinkExpiredError,
  MagicLinkAlreadyUsedError,
  EmailDeliveryUnavailableError,
} from './magic-link-service.js';

// ── Validation helpers ────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && EMAIL_RE.test(email);
}

/**
 * returnTo must be a relative path: starts with '/', no '://' substring.
 * Allows query strings and hash fragments; rejects absolute URLs and
 * protocol-relative URLs.
 */
function isValidReturnTo(returnTo: unknown): returnTo is string {
  if (typeof returnTo !== 'string') return false;
  if (!returnTo.startsWith('/')) return false;
  if (returnTo.includes('://')) return false;
  return true;
}

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

export async function registerAuthRouter(app: FastifyInstance): Promise<void> {
  // ── POST /api/auth/magic-link/start ────────────────────────────────────────
  app.post('/api/auth/magic-link/start', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    const body = request.body as Record<string, unknown> | null | undefined;

    // Validate email
    const email = body?.['email'];
    if (!isValidEmail(email)) {
      return reply.status(400).send(
        errorBody(
          'INVALID_EMAIL',
          'The provided email address is not valid.',
          'email must be a valid email address (user@domain.tld)',
          false,
        ),
      );
    }

    // Validate returnContext if provided
    const returnContextRaw = body?.['returnContext'] as Record<string, unknown> | undefined;
    if (returnContextRaw !== undefined && returnContextRaw !== null) {
      if (!isValidReturnTo(returnContextRaw['returnTo'])) {
        return reply.status(400).send(
          errorBody(
            'INVALID_RETURN_CONTEXT',
            'returnTo must be a relative path (starts with /, no :// allowed).',
            'returnTo must be a relative URL path without protocol prefix',
            false,
          ),
        );
      }
    }

    const returnContext =
      returnContextRaw !== undefined && returnContextRaw !== null
        ? {
            returnTo: returnContextRaw['returnTo'] as string,
            intent: returnContextRaw['intent'],
          }
        : null;

    try {
      const result = await issueMagicLink(email, returnContext);
      return reply.status(202).send({
        requestAccepted: true,
        cooldownSeconds: result.cooldownSeconds,
      });
    } catch (err) {
      if (err instanceof EmailDeliveryUnavailableError) {
        return reply.status(503).send(
          errorBody(
            'EMAIL_DELIVERY_UNAVAILABLE',
            'The email service is temporarily unavailable. Please try again later.',
            'email delivery service returned an error',
            true,
          ),
        );
      }
      // Unexpected error — re-throw for Fastify error handler.
      throw err;
    }
  });

  // ── POST /api/auth/magic-link/complete ─────────────────────────────────────
  app.post('/api/auth/magic-link/complete', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    const body = request.body as Record<string, unknown> | null | undefined;
    const token = body?.['token'];

    if (typeof token !== 'string' || token.trim() === '') {
      return reply.status(400).send(
        errorBody(
          'INVALID_TOKEN',
          'The provided token is missing or malformed.',
          'token must be a non-empty string',
          false,
        ),
      );
    }

    try {
      const result = await completeMagicLink(token);

      const isProd = process.env['NODE_ENV'] === 'production';
      reply.setCookie(COOKIE_NAME, result.sessionId, cookieOptions(isProd));

      return reply.status(200).send({
        session: result.session,
        resume: result.resume,
      });
    } catch (err) {
      if (err instanceof MagicLinkNotFoundError) {
        return reply.status(400).send(
          errorBody(
            'INVALID_TOKEN',
            'Token not found or malformed.',
            'token not found in store',
            false,
          ),
        );
      }
      if (err instanceof MagicLinkExpiredError) {
        return reply.status(410).send(
          errorBody(
            'TOKEN_EXPIRED',
            'The magic link has expired.',
            'token TTL elapsed',
            false,
          ),
        );
      }
      if (err instanceof MagicLinkAlreadyUsedError) {
        return reply.status(409).send(
          errorBody(
            'TOKEN_ALREADY_USED',
            'This magic link has already been used.',
            'token was already consumed',
            false,
          ),
        );
      }
      throw err;
    }
  });
}

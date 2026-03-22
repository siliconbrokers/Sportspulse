/**
 * server/auth/rate-limit-config.ts — Rate-limit configuration for auth routes (WP-16-b)
 *
 * Applied ONLY to POST /api/auth/* routes — not registered globally.
 * Limit: 5 requests per minute per IP.
 *
 * Per-email cooldown is advisory only — issueMagicLink returns cooldownSeconds=60
 * as metadata to the caller but does NOT gate re-issuance (a new token is emitted
 * on every call regardless of prior tokens for that email). IP rate-limiting
 * (5 req/min) provides volumetric abuse protection; a true per-email guard
 * should be added as a separate work package if required.
 */

import type { FastifyRequest } from 'fastify';
import type { RateLimitOptions } from '@fastify/rate-limit';

/**
 * errorResponseBuilder for @fastify/rate-limit — produces the canonical
 * api.contract v1.1.0 §2.2 / §5.2 error envelope when the IP limit is hit.
 *
 * Exported separately so it can be unit-tested without spinning up Fastify.
 */
export const rateLimitErrorBuilder = (
  _request: unknown,
  context: { ttl: number },
): { error: { code: string; message: string; details: { reason: string; retryable: boolean; retryAfter: number } } } => ({
  error: {
    code: 'MAGIC_LINK_RATE_LIMITED',
    message: 'Too many requests. Please try again later.',
    details: {
      reason: 'RATE_LIMIT_EXCEEDED',
      retryable: true,
      retryAfter: Math.ceil(context.ttl / 1000),
    },
  },
});

/**
 * Rate-limit configuration for auth endpoints.
 * Pass to @fastify/rate-limit per-route via routeOptions.config or
 * as plugin-level config scoped to the auth router.
 */
export const authRateLimitConfig: RateLimitOptions = {
  max: 5,
  timeWindow: '1 minute',
  keyGenerator(request: FastifyRequest): string {
    // Prefer the real client IP, fall back to socket remote address.
    return (
      (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      request.socket.remoteAddress ??
      'unknown'
    );
  },
};

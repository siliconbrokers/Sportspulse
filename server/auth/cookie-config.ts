/**
 * server/auth/cookie-config.ts — Cookie configuration for session management (WP-16-a)
 *
 * Spec: session-persistence-and-state-storage v1.0.0
 *   - httpOnly: true
 *   - secure: true in staging/prod (NODE_ENV=production)
 *   - sameSite: lax
 *   - signed/opaque session identifier
 */

import type { CookieSerializeOptions } from '@fastify/cookie';

/** The name of the session cookie. */
export const COOKIE_NAME = 'sp_session';

/**
 * Returns cookie serialization options.
 *
 * @param isProd - true when NODE_ENV === 'production'; sets secure: true.
 */
export function cookieOptions(isProd: boolean): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
  };
}

/**
 * server/auth/__tests__/security-plugins.test.ts — Unit tests for WP-16 security config (WP-16)
 *
 * These are pure configuration tests — no Fastify instance required.
 * WP-16 — runtime security baseline (prerequisite for K-04, K-05, K-06)
 * Coverage: cookie options, CORS config, rate-limit config (infrastructure layer only)
 */

import { describe, it, expect } from 'vitest';
import { COOKIE_NAME, cookieOptions } from '../cookie-config.js';
import { authRateLimitConfig } from '../rate-limit-config.js';
import { corsConfig } from '../cors-config.js';

describe('cookie-config', () => {
  it('COOKIE_NAME is sp_session', () => {
    expect(COOKIE_NAME).toBe('sp_session');
  });

  it('cookieOptions(true) has secure: true for production', () => {
    const opts = cookieOptions(true);
    expect(opts.secure).toBe(true);
  });

  it('cookieOptions(false) has secure: false for development', () => {
    const opts = cookieOptions(false);
    expect(opts.secure).toBe(false);
  });

  it('cookieOptions always sets httpOnly: true', () => {
    expect(cookieOptions(true).httpOnly).toBe(true);
    expect(cookieOptions(false).httpOnly).toBe(true);
  });

  it('cookieOptions always sets sameSite: lax', () => {
    expect(cookieOptions(true).sameSite).toBe('lax');
    expect(cookieOptions(false).sameSite).toBe('lax');
  });

  it('cookieOptions sets maxAge to 30 days in seconds', () => {
    const thirtyDays = 30 * 24 * 60 * 60;
    expect(cookieOptions(true).maxAge).toBe(thirtyDays);
    expect(cookieOptions(false).maxAge).toBe(thirtyDays);
  });

  it('cookieOptions sets path: /', () => {
    expect(cookieOptions(true).path).toBe('/');
  });
});

describe('rate-limit-config', () => {
  it('max is 5', () => {
    expect(authRateLimitConfig.max).toBe(5);
  });

  it('timeWindow is 1 minute', () => {
    expect(authRateLimitConfig.timeWindow).toBe('1 minute');
  });

  it('keyGenerator is defined', () => {
    expect(typeof authRateLimitConfig.keyGenerator).toBe('function');
  });
});

describe('cors-config', () => {
  it('credentials is true', () => {
    expect(corsConfig.credentials).toBe(true);
  });

  it('methods include GET, POST, OPTIONS', () => {
    expect(corsConfig.methods).toEqual(
      expect.arrayContaining(['GET', 'POST', 'OPTIONS']),
    );
  });
});

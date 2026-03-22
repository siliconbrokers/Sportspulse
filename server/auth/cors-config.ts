/**
 * server/auth/cors-config.ts — CORS configuration for V2 routes (WP-16-c)
 *
 * Applied ONLY when ENABLE_V2_ROUTES=true.
 * Origin: APP_BASE_URL env var when set; otherwise true (allow all, for local dev).
 */

import type { FastifyCorsOptions } from '@fastify/cors';

/**
 * CORS configuration for V2 routes.
 *
 * - origin: APP_BASE_URL (prod/staging) or true (dev, allow all)
 * - methods: GET, POST, OPTIONS
 * - credentials: true (needed for cookie-based sessions)
 */
export const corsConfig: FastifyCorsOptions = {
  origin: process.env['APP_BASE_URL'] ?? true,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
};

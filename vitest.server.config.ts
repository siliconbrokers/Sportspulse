/**
 * vitest.server.config.ts — Vitest config for server/ tests (WP-17)
 *
 * Run directly: pnpm vitest run --config vitest.server.config.ts
 * Included in root "test:server" script.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['server/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});

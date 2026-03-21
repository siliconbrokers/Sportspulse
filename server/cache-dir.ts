import path from 'node:path';

/**
 * Resolves the runtime cache base directory.
 * Priority: CACHE_DIR env var → RENDER=true fallback → cwd/cache
 */
export const CACHE_BASE: string =
  process.env.CACHE_DIR ??
  (process.env.RENDER === 'true'
    ? '/opt/render/project/src/cache'
    : path.join(process.cwd(), 'cache'));

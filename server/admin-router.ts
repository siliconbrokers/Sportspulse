/**
 * Admin Router — rutas de administración del portal.
 * Registra directamente en el Fastify instance después de buildApp().
 *
 * Rutas:
 *   POST /api/admin/auth       — valida ADMIN_SECRET, sin auth propia
 *   GET  /api/admin/config     — devuelve config completa (requiere auth)
 *   PUT  /api/admin/config     — actualiza config (requiere auth)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getFullConfig, updateConfig } from './portal-config-store.js';
import type { SnapshotStore } from '@sportpulse/snapshot';

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';

function validateAuth(authHeader: string | undefined): boolean {
  if (!ADMIN_SECRET) return false; // sin secret configurado → siempre rechaza
  if (!authHeader) return false;
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  return token === ADMIN_SECRET;
}

export function registerAdminRoutes(app: FastifyInstance, snapshotStore: SnapshotStore): void {
  // POST /api/admin/auth — valida token, devuelve 200 o 401
  app.post('/api/admin/auth', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { token?: string } | null;
    const token = body?.token ?? '';
    if (!ADMIN_SECRET) {
      return reply.status(503).send({ error: 'ADMIN_SECRET not configured' });
    }
    if (token === ADMIN_SECRET) {
      return reply.send({ ok: true });
    }
    return reply.status(401).send({ error: 'Unauthorized' });
  });

  // GET /api/admin/config — devuelve config completa
  app.get('/api/admin/config', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!validateAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    return reply.header('Cache-Control', 'no-store').send(getFullConfig());
  });

  // PUT /api/admin/config — actualiza config
  app.put('/api/admin/config', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!validateAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const patch = request.body as {
      competitions?: { id: string; mode?: 'portal' | 'shadow' | 'disabled'; enabled?: boolean }[];
      features?: { tv?: boolean; predictions?: boolean };
    };
    if (!patch || (patch.competitions === undefined && patch.features === undefined)) {
      return reply.status(400).send({ error: 'Empty patch' });
    }

    // Capture which competition IDs are currently active (portal or shadow) before the update
    const prevActive = new Set(
      getFullConfig().competitions.filter((c) => c.mode !== 'disabled').map((c) => c.id),
    );

    updateConfig(patch, 'admin');

    // Invalidate snapshot entries for competitions that were just disabled or moved to shadow
    if (patch.competitions) {
      const newlyDisabled = patch.competitions
        .filter((entry) => {
          const resolvedMode = entry.mode ?? (entry.enabled === false ? 'disabled' : entry.enabled === true ? 'portal' : undefined);
          return resolvedMode === 'disabled' && prevActive.has(entry.id);
        })
        .map((entry) => entry.id);

      if (newlyDisabled.length > 0) {
        console.log(`[AdminRouter] Invalidating snapshot cache for disabled competitions: ${newlyDisabled.join(', ')}`);
        snapshotStore.invalidateAll();
      }
    }

    return reply.send({ ok: true, config: getFullConfig() });
  });
}

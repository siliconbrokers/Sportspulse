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
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

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
    return reply.header('Cache-Control', 'no-store').send({
      ...getFullConfig(),
      environment: process.env.RENDER === 'true' ? 'production' : 'development',
    });
  });

  // PUT /api/admin/config — actualiza config
  app.put('/api/admin/config', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!validateAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const patch = request.body as {
      competitions?: { id: string; mode?: 'portal' | 'shadow' | 'disabled'; enabled?: boolean }[];
      features?: { tv?: boolean; predictions?: boolean };
      schedulerEnabled?: boolean;
    };
    if (!patch || (patch.competitions === undefined && patch.features === undefined && patch.schedulerEnabled === undefined)) {
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

  // GET /api/admin/disk-info — diagnóstico del disco persistente
  app.get('/api/admin/disk-info', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!validateAuth(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const cacheDir = path.join(process.cwd(), 'cache');
    let topLevel: string[] = [];
    const detail: Record<string, string[]> = {};
    try { topLevel = fs.readdirSync(cacheDir); } catch { topLevel = []; }

    // List first-level subdirs (providers)
    for (const entry of topLevel) {
      const entryPath = path.join(cacheDir, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
          detail[entry] = fs.readdirSync(entryPath);
        }
      } catch { /* ignore */ }
    }

    // Check apifootball specifically
    const afDir = path.join(cacheDir, 'apifootball');
    const afLeagues: Record<string, string[]> = {};
    try {
      for (const league of fs.readdirSync(afDir)) {
        const leagueDir = path.join(afDir, league);
        try { afLeagues[league] = fs.readdirSync(leagueDir); } catch { afLeagues[league] = []; }
      }
    } catch { /* not found */ }

    return reply.header('Cache-Control', 'no-store').send({
      cwd: process.cwd(),
      cacheDir,
      topLevel,
      afLeagues,
      env: process.env.RENDER === 'true' ? 'production' : 'development',
    });
  });

  // POST /api/admin/seed-cache — recibe un tarball base64 y lo extrae en cache/
  // Body: { data: "<base64 de tar.gz>", overwrite?: boolean }
  // El tarball debe contener rutas relativas a cache/ (ej: apifootball/268/2026/matchday-01.json)
  app.post(
    '/api/admin/seed-cache',
    { config: { rawBody: false }, bodyLimit: 32 * 1024 * 1024 },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!validateAuth(request.headers.authorization)) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const body = request.body as { data?: string; overwrite?: boolean } | null;
      if (!body?.data) {
        return reply.status(400).send({ error: 'Missing field: data (base64 tar.gz)' });
      }

      const cacheDir = path.join(process.cwd(), 'cache');
      fs.mkdirSync(cacheDir, { recursive: true });

      const tmpFile = path.join(os.tmpdir(), `cache-seed-${Date.now()}.tar.gz`);
      try {
        const buf = Buffer.from(body.data, 'base64');
        fs.writeFileSync(tmpFile, buf);

        // overwrite=false → --keep-old-files skips files already present in prod (safer default)
        // overwrite=true  → normal extract, overwrites everything
        // BusyBox tar (Render/Alpine) uses -k; GNU tar supports both -k and --keep-old-files
        const keepFlag = body.overwrite === false ? ' -k' : '';
        execSync(`tar xzf ${tmpFile} -C ${cacheDir}${keepFlag}`, { stdio: 'pipe' });

        let extractedDirs: string[] = [];
        try { extractedDirs = fs.readdirSync(cacheDir); } catch { /* ignore */ }

        console.log(`[AdminRouter] seed-cache: extracted ${buf.length} bytes → ${cacheDir} (${extractedDirs.join(',')})`);
        return reply.send({ ok: true, bytes: buf.length, cacheEntries: extractedDirs });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AdminRouter] seed-cache error:', msg);
        return reply.status(500).send({ error: 'Extraction failed', detail: msg });
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    },
  );
}

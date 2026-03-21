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
    const cacheDir = (process.env.CACHE_DIR ?? (process.env.RENDER === 'true' ? '/opt/render/project/src/cache' : path.join(process.cwd(), 'cache')));
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
  // Body: {
  //   data: "<base64 de tar.gz>",
  //   overwrite?: boolean,       // legacy — false usa -k (skip all existing). Default: true
  //   neverOverwrite?: string[]  // paths relativos a cacheDir protegidos de sobreescritura.
  //                              // Si ya existen en disco, se preservan; si no, se crean.
  //                              // Uso: predictions/snapshots.json (prod genera las suyas)
  // }
  // El tarball debe contener rutas relativas a cache/ (ej: apifootball/268/2026/matchday-01.json)
  app.post(
    '/api/admin/seed-cache',
    { config: { rawBody: false }, bodyLimit: 300 * 1024 * 1024 },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!validateAuth(request.headers.authorization)) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const body = request.body as { data?: string; overwrite?: boolean; neverOverwrite?: string[] } | null;
      if (!body?.data) {
        return reply.status(400).send({ error: 'Missing field: data (base64 tar.gz)' });
      }

      const cacheDir = (process.env.CACHE_DIR ?? (process.env.RENDER === 'true' ? '/opt/render/project/src/cache' : path.join(process.cwd(), 'cache')));
      fs.mkdirSync(cacheDir, { recursive: true });

      // neverOverwrite: archivos que producción genera por sí misma.
      // Se protegen en seeds subsiguientes pero se crean normalmente en el primer seed.
      const neverOverwritePaths = Array.isArray((body as any).neverOverwrite)
        ? (body as any).neverOverwrite as string[]
        : [];

      // Paso 1 — backup de archivos protegidos que ya existen en disco
      const tempBackups: { original: string; temp: string }[] = [];
      for (const relPath of neverOverwritePaths) {
        // sanitize: no absolute paths, no traversal
        if (relPath.startsWith('/') || relPath.includes('..')) continue;
        const original = path.join(cacheDir, relPath);
        if (fs.existsSync(original)) {
          const temp = original + '.__seedbak';
          fs.renameSync(original, temp);
          tempBackups.push({ original, temp });
        }
      }

      const tmpFile = path.join(os.tmpdir(), `cache-seed-${Date.now()}.tar.gz`);
      try {
        const buf = Buffer.from(body.data, 'base64');
        fs.writeFileSync(tmpFile, buf);

        // Paso 2 — extracción (overwrite=false legacy usa -k; por defecto overwrite completo)
        // overwrite=false → --keep-old-files skips files already present in prod (safer default)
        // overwrite=true  → normal extract, overwrites everything
        // BusyBox tar (Render/Alpine) uses -k; GNU tar supports both -k and --keep-old-files
        const keepFlag = body.overwrite === false ? ' -k' : '';
        execSync(`tar xzf ${tmpFile} -C ${cacheDir}${keepFlag}`, { stdio: 'pipe' });

        let extractedDirs: string[] = [];
        try { extractedDirs = fs.readdirSync(cacheDir); } catch { /* ignore */ }

        if (tempBackups.length > 0) {
          console.log(`[AdminRouter] seed-cache: protected (neverOverwrite): ${tempBackups.map(b => path.relative(cacheDir, b.original)).join(', ')}`);
        }
        console.log(`[AdminRouter] seed-cache: extracted ${buf.length} bytes → ${cacheDir} (${extractedDirs.join(',')})`);
        return reply.send({ ok: true, bytes: buf.length, cacheEntries: extractedDirs });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[AdminRouter] seed-cache error:', msg);
        return reply.status(500).send({ error: 'Extraction failed', detail: msg });
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        // Paso 3 — restaurar archivos protegidos (prod mantiene sus versiones)
        for (const { original, temp } of tempBackups) {
          try {
            if (fs.existsSync(original)) fs.unlinkSync(original); // borrar lo que extrajo el tar
            fs.renameSync(temp, original); // restaurar versión de prod
          } catch (restoreErr) {
            const msg = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
            console.error(`[AdminRouter] seed-cache: failed to restore ${original}: ${msg}`);
          }
        }
      }
    },
  );
}

/**
 * snapshot-stats-route.ts — Internal ops endpoint for snapshot cache diagnostics.
 *
 * Route (internal, no auth required — ops only):
 *   GET /api/internal/ops/snapshot-stats
 *
 * Boundary note: this module uses ISnapshotService as a structural interface
 * so that packages/api never imports from @sportpulse/snapshot directly.
 */

import type { FastifyInstance } from 'fastify';

// Structural interface — mirrors SnapshotServiceStats from @sportpulse/snapshot
export interface ISnapshotServiceStats {
  entries: number;
  hitCount: number;
  missCount: number;
  staleServeCount: number;
  evictionCount: number;
  buildCount: number;
  totalBuildMs: number;
  avgBuildMs: number;
}

export interface ISnapshotStatsProvider {
  getStats(): ISnapshotServiceStats;
}

export function registerSnapshotStatsRoute(
  fastify: FastifyInstance,
  snapshotService: ISnapshotStatsProvider,
): void {
  // GET /api/internal/ops/snapshot-stats
  fastify.get('/api/internal/ops/snapshot-stats', async (_req, reply) => {
    const stats = snapshotService.getStats();
    reply.header('Cache-Control', 'no-store');
    return reply.status(200).send(stats);
  });
}

/**
 * GET /api/ui/radar/v2
 * Query params: competitionId, matchday (optional, defaults to current)
 *
 * Returns Radar v2 editorial snapshot merged with live match data.
 * Spec: spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDependencies } from './types.js';

export function radarV2Route(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function radarV2RoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/radar/v2', async (request, reply) => {
        if (!deps.radarV2Service) {
          return reply.status(503).send({ error: 'Radar v2 service not available' });
        }

        const query = request.query as Record<string, unknown>;
        const competitionId = String(query.competitionId ?? '');
        const matchdayRaw = query.matchday !== undefined ? Number(query.matchday) : undefined;

        if (!competitionId) {
          return reply.status(400).send({ error: 'competitionId is required' });
        }

        // Resolve matchday
        let matchday = matchdayRaw;
        if (!matchday || isNaN(matchday)) {
          matchday = deps.dataSource.getCurrentMatchday?.(competitionId);
        }

        if (!matchday) {
          return reply.status(404).send({ error: 'No active matchday found for this competition' });
        }

        const buildNowUtc = new Date().toISOString();

        try {
          const result = await deps.radarV2Service.getRadar(competitionId, matchday, buildNowUtc);

          reply
            .header('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=600')
            .send(result);
        } catch (err) {
          fastify.log.error(err, '[RadarV2Route] Failed to get radar v2 snapshot');
          return reply.status(503).send({
            snapshot: null,
            liveData: [],
            state: 'unavailable',
          });
        }
      });
    },
    { name: 'radar-v2-route' },
  );
}

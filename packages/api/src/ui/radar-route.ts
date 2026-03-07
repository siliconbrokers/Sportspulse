/**
 * GET /api/ui/radar
 * Query params: competitionId, matchday (optional, defaults to current)
 *
 * Returns Radar editorial snapshot merged with live match data.
 * Spec: radar-03-json-contracts-and-lifecycle.md §14
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDependencies } from './types.js';

export function radarRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function radarRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/radar', async (request, reply) => {
        if (!deps.radarService) {
          return reply.status(503).send({ error: 'Radar service not available' });
        }

        const query = request.query as Record<string, unknown>;
        const competitionId = String(query.competitionId ?? '');
        const matchdayRaw = query.matchday !== undefined ? Number(query.matchday) : undefined;

        if (!competitionId) {
          return reply.status(400).send({ error: 'competitionId is required' });
        }

        // Resolve matchday: use provided value or current matchday from data source
        let matchday = matchdayRaw;
        if (!matchday || isNaN(matchday)) {
          matchday = deps.dataSource.getCurrentMatchday?.(competitionId);
        }

        if (!matchday) {
          return reply.status(404).send({ error: 'No active matchday found for this competition' });
        }

        const buildNowUtc = new Date().toISOString();

        try {
          const result = await deps.radarService.getRadar(competitionId, matchday, buildNowUtc);

          reply
            .header('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=600')
            .send(result);
        } catch (err) {
          fastify.log.error(err, '[RadarRoute] Failed to get radar snapshot');
          return reply.status(503).send({
            index: null,
            liveData: [],
            state: 'unavailable',
          });
        }
      });
    },
    { name: 'radar-route' },
  );
}

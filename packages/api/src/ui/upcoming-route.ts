import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDependencies } from './types.js';

export function upcomingRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function upcomingRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/upcoming', async (_request, reply) => {
        if (!deps.upcomingService) {
          return reply.status(503).send({ error: 'Upcoming service not configured' });
        }
        const matches = deps.upcomingService.getUpcoming(96);
        reply.header('Cache-Control', 'public, max-age=60').send({ matches });
      });
    },
    { name: 'upcoming-route' },
  );
}

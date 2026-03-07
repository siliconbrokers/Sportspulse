import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDependencies } from './types.js';

export function eventosRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function eventosRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/eventos', async (_request, reply) => {
        if (!deps.eventosService) {
          return reply.status(503).send({ error: 'Eventos service not configured' });
        }
        const result = await deps.eventosService.getEvents();
        reply.header('Cache-Control', 'no-store').send(result);
      });
    },
    { name: 'eventos-route' },
  );
}

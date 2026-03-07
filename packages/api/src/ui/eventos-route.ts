import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDependencies } from './types.js';

export function eventosRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function eventosRoutePlugin(fastify: FastifyInstance) {
      // Lista completa de eventos
      fastify.get('/api/ui/eventos', async (_request, reply) => {
        if (!deps.eventosService) {
          return reply.status(503).send({ error: 'Eventos service not configured' });
        }
        const result = await deps.eventosService.getEvents();
        reply.header('Cache-Control', 'no-store').send(result);
      });

      // Evento individual por ID — la URL de reproducción solo vive server-side
      fastify.get<{ Params: { id: string } }>(
        '/api/ui/eventos/event/:id',
        async (request, reply) => {
          if (!deps.eventosService) {
            return reply.status(503).send({ error: 'Eventos service not configured' });
          }
          const { events } = await deps.eventosService.getEvents();
          const event = events.find((e) => e.id === request.params.id);
          if (!event) return reply.status(404).send({ error: 'Event not found' });
          reply.header('Cache-Control', 'no-store').send(event);
        },
      );
    },
    { name: 'eventos-route' },
  );
}

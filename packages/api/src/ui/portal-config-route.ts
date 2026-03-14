import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDependencies } from './types.js';

export function portalConfigRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function portalConfigRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/portal-config', async (_request, reply) => {
        if (!deps.getPortalConfig) {
          // Fallback: all enabled
          return reply.send({
            competitions: [],
            features: { tv: true, predictions: true },
          });
        }
        const config = deps.getPortalConfig();
        reply.header('Cache-Control', 'no-store').send({
          competitions: config.competitions,
          features: {
            tv: config.features.tv,
            predictions: config.features.predictions,
          },
        });
      });
    },
    { name: 'portal-config-route' },
  );
}

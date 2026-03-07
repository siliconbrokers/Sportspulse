import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDependencies } from './types.js';

export function videosRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function videosRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/videos', async (_request, reply) => {
        if (!deps.videoService) {
          return reply.status(503).send({ error: 'Video service not configured' });
        }
        const feed = await deps.videoService.getVideoFeed();
        reply
          .header('Cache-Control', 'public, max-age=0, s-maxage=2700, stale-while-revalidate=5400')
          .send(feed);
      });
    },
    { name: 'videos-route' },
  );
}

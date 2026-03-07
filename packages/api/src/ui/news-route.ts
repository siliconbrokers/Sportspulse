import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDependencies } from './types.js';

export function newsRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function newsRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/news', async (_request, reply) => {
        const feed = await deps.newsService.getNewsFeed();
        reply
          .header('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=3600')
          .send(feed);
      });
    },
    { name: 'news-route' },
  );
}

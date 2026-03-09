import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { AppDependencies } from './types.js';

export function scorersRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function scorersRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/scorers', async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const competitionId = query.competitionId;

        if (!competitionId || typeof competitionId !== 'string') {
          throw new AppError(ErrorCode.BAD_REQUEST, 'Missing competitionId', 400);
        }

        if (!deps.dataSource.getTopScorers) {
          return reply
            .header('Cache-Control', 'public, max-age=0, s-maxage=3600')
            .send({ scorers: [] });
        }

        const scorers = await deps.dataSource.getTopScorers(competitionId);
        reply
          .header('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=7200')
          .send({ scorers });
      });
    },
    { name: 'scorers-route' },
  );
}

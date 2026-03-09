import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { AppDependencies } from './types.js';

export function groupStandingsRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function groupStandingsRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/group-standings', async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const competitionId = query.competitionId;

        if (!competitionId || typeof competitionId !== 'string') {
          throw new AppError(ErrorCode.BAD_REQUEST, 'Missing competitionId', 400);
        }

        if (!deps.tournamentSource) {
          throw new AppError(ErrorCode.NOT_FOUND, 'Tournament data not available', 404);
        }

        const view = deps.tournamentSource.getGroupView(competitionId);
        if (!view) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            'Group standings not found for this competition',
            404,
          );
        }

        reply
          .header('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600')
          .send(view);
      });
    },
    { name: 'group-standings-route' },
  );
}

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { AppDependencies } from './types.js';

export function tournamentMatchesRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function tournamentMatchesRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/tournament-matches', async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const competitionId = query.competitionId;

        if (!competitionId || typeof competitionId !== 'string') {
          throw new AppError(ErrorCode.BAD_REQUEST, 'Missing competitionId', 400);
        }

        if (!deps.tournamentSource) {
          throw new AppError(ErrorCode.NOT_FOUND, 'Tournament data not available', 404);
        }

        const view = deps.tournamentSource.getTournamentMatches(competitionId);
        if (!view) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            'Tournament matches not found for this competition',
            404,
          );
        }

        reply
          .header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
          .send(view);
      });
    },
    { name: 'tournament-matches-route' },
  );
}

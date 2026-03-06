import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { QueryValidationError } from '../validation/query-params.js';
import type { AppDependencies } from './types.js';

export function competitionInfoRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function competitionInfoRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/competition-info', async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const competitionId =
          typeof query.competitionId === 'string' ? query.competitionId : undefined;

        if (!competitionId) {
          throw new AppError(
            ErrorCode.BAD_REQUEST,
            'Missing required parameter: competitionId',
            400,
          );
        }

        const seasonId = deps.dataSource.getSeasonId(competitionId);
        if (!seasonId) {
          throw new AppError(ErrorCode.NOT_FOUND, `Competition not found: ${competitionId}`, 404);
        }

        const currentMatchday = deps.dataSource.getCurrentMatchday?.(competitionId);
        const lastPlayedMatchday = deps.dataSource.getLastPlayedMatchday?.(competitionId);
        const totalMatchdays = deps.dataSource.getTotalMatchdays?.(competitionId) ?? 38;

        reply
          .header('Cache-Control', 'public, max-age=60')
          .send({ currentMatchday, lastPlayedMatchday, totalMatchdays });
      });
    },
    { name: 'competition-info-route' },
  );
}

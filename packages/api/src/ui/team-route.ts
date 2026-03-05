import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { projectTeamDetail } from '@sportpulse/snapshot';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { parseTeamQuery, QueryValidationError } from '../validation/query-params.js';
import type { AppDependencies } from './types.js';

export function teamRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(async function teamRoutePlugin(fastify: FastifyInstance) {
    fastify.get('/api/ui/team', async (request, reply) => {
      let params;
      try {
        params = parseTeamQuery(request.query as Record<string, unknown>);
      } catch (err) {
        if (err instanceof QueryValidationError) {
          throw new AppError(ErrorCode.BAD_REQUEST, err.message, 400);
        }
        throw err;
      }

      const seasonId = deps.dataSource.getSeasonId(params.competitionId);
      if (!seasonId) {
        throw new AppError(ErrorCode.NOT_FOUND, `Competition not found: ${params.competitionId}`, 404);
      }

      const teams = deps.dataSource.getTeams(params.competitionId);
      const matches = deps.dataSource.getMatches(seasonId);

      let result;
      try {
        result = deps.snapshotService.serve({
          competitionId: params.competitionId,
          seasonId,
          dateLocal: params.dateLocal,
          timezone: params.timezone,
          teams,
          matches,
        });
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'SNAPSHOT_BUILD_FAILED') {
          throw new AppError(ErrorCode.SNAPSHOT_BUILD_FAILED, 'Snapshot build failed', 503);
        }
        throw err;
      }

      const detail = projectTeamDetail(
        result.snapshot,
        params.teamId,
        params.dateLocal,
        params.timezone,
      );

      if (!detail) {
        throw new AppError(ErrorCode.NOT_FOUND, `Team not found: ${params.teamId}`, 404);
      }

      reply
        .header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
        .header('X-Snapshot-Source', result.source)
        .send(detail);
    });
  }, { name: 'team-route' });
}

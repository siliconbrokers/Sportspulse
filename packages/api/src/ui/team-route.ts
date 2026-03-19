import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { projectTeamDetail } from '@sportpulse/snapshot';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { parseTeamQuery, QueryValidationError } from '../validation/query-params.js';
import { resolveDateFromMatchday } from './resolve-date.js';
import type { AppDependencies } from './types.js';

export function teamRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function teamRoutePlugin(fastify: FastifyInstance) {
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
          throw new AppError(
            ErrorCode.NOT_FOUND,
            `Competition not found: ${params.competitionId}`,
            404,
          );
        }

        const teams = deps.dataSource.getTeams(params.competitionId);
        const matches = deps.dataSource.getMatches(seasonId, params.subTournamentKey);

        // Resolve dateLocal from matchday if not provided directly
        const dateLocal =
          params.dateLocal ?? resolveDateFromMatchday(matches, params.matchday!, params.timezone);

        let result;
        try {
          result = deps.snapshotService.serve({
            competitionId: params.competitionId,
            seasonId,
            dateLocal,
            timezone: params.timezone,
            teams,
            matches,
            matchday: params.matchday,
          });
        } catch (err) {
          if (
            err &&
            typeof err === 'object' &&
            'code' in err &&
            (err as { code: string }).code === 'SNAPSHOT_BUILD_FAILED'
          ) {
            throw new AppError(ErrorCode.SNAPSHOT_BUILD_FAILED, 'Snapshot build failed', 503);
          }
          throw err;
        }

        const detail = projectTeamDetail(
          result.snapshot,
          params.teamId,
          dateLocal,
          params.timezone,
        );

        if (!detail) {
          throw new AppError(ErrorCode.NOT_FOUND, `Team not found: ${params.teamId}`, 404);
        }

        // Enrich with match goals if FINISHED and service available
        let enrichedDetail = detail;
        if (
          deps.matchEventsService &&
          detail.nextMatch?.matchStatus === 'FINISHED' &&
          detail.nextMatch.matchId
        ) {
          try {
            const goals = await deps.matchEventsService.getMatchGoals(detail.nextMatch.matchId);
            if (goals.length > 0) {
              enrichedDetail = {
                ...detail,
                nextMatch: { ...detail.nextMatch, events: goals },
              };
            }
          } catch {
            // Non-fatal: proceed without events
          }
        }

        reply
          .header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
          .header('X-Snapshot-Source', result.source)
          .send(enrichedDetail);
      });
    },
    { name: 'team-route' },
  );
}

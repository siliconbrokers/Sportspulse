import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { SnapshotBuildFailed } from '@sportpulse/snapshot';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { parseDashboardQuery, QueryValidationError } from '../validation/query-params.js';
import { resolveDateFromMatchday } from './resolve-date.js';
import type { AppDependencies } from './types.js';

export function dashboardRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function dashboardRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/dashboard', async (request, reply) => {
        let params;
        try {
          params = parseDashboardQuery(request.query as Record<string, unknown>);
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
        const matches = deps.dataSource.getMatches(seasonId);

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

        const snapshot = result.snapshot;

        // Strip signals if not requested
        if (!params.includeSignals) {
          const stripped = {
            ...snapshot,
            teams: snapshot.teams.map((t) => {
              const { signals, ...rest } = t;
              return rest;
            }),
          };
          reply
            .header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
            .header('X-Snapshot-Source', result.source)
            .send(stripped);
          return;
        }

        reply
          .header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
          .header('X-Snapshot-Source', result.source)
          .send(snapshot);
      });
    },
    { name: 'dashboard-route' },
  );
}

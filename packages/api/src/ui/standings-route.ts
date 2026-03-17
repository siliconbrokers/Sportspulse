import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { AppDependencies } from './types.js';
import { extractRecentForm } from '@sportpulse/snapshot';

export function standingsRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function standingsRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/standings', async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const competitionId = query.competitionId;

        if (!competitionId || typeof competitionId !== 'string') {
          throw new AppError(ErrorCode.BAD_REQUEST, 'Missing competitionId', 400);
        }

        if (!deps.dataSource.getStandings) {
          throw new AppError(ErrorCode.NOT_FOUND, 'Standings not available', 404);
        }

        const subTournamentKey =
          typeof query.subTournament === 'string' ? query.subTournament : undefined;

        const standings = deps.dataSource.getStandings(competitionId, subTournamentKey);
        if (standings.length === 0) {
          throw new AppError(ErrorCode.NOT_FOUND, 'Standings not found', 404);
        }

        // Compute recentForm from actual match records (same logic as DetailPanel / team-tile-builder)
        // This replaces the raw API form string which may have wrong ordering or stale data.
        const buildNowUtc = new Date().toISOString();
        const seasonId = deps.dataSource.getSeasonId(competitionId);
        const matches = seasonId ? deps.dataSource.getMatches(seasonId, subTournamentKey) : [];

        const standingsWithForm = standings.map((row) => ({
          ...row,
          recentForm: matches.length > 0
            ? extractRecentForm(row.teamId, matches, buildNowUtc)
            : undefined,
        }));

        reply
          .header('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600')
          .send({ standings: standingsWithForm });
      });
    },
    { name: 'standings-route' },
  );
}

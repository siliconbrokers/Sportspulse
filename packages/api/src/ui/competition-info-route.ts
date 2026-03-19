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

        // Datos aún no cargados (startup en progreso) — devolver defaults sin cachear.
        // Incluir activeSubTournament/subTournaments igual (desde fallback estático) para que
        // el frontend pueda pre-seleccionar el sub-torneo activo sin esperar a que cargue la data.
        if (!seasonId) {
          const activeSubTournament = deps.dataSource.getActiveSubTournament?.(competitionId);
          const subTournaments = deps.dataSource.getSubTournaments?.(competitionId) ?? [];
          reply.header('Cache-Control', 'no-cache').send({
            currentMatchday: null,
            lastPlayedMatchday: null,
            nextMatchday: null,
            totalMatchdays: 38,
            ...(activeSubTournament != null ? { activeSubTournament, subTournaments } : {}),
          });
          return;
        }

        const rawSubTournament = query.subTournamentKey ?? query.subTournament;
        const subTournamentKey =
          typeof rawSubTournament === 'string' ? rawSubTournament : undefined;

        const subTournaments = deps.dataSource.getSubTournaments?.(competitionId) ?? [];
        const activeSubTournament =
          subTournamentKey ?? deps.dataSource.getActiveSubTournament?.(competitionId);

        const currentMatchday = deps.dataSource.getCurrentMatchday?.(
          competitionId,
          activeSubTournament,
        );
        const lastPlayedMatchday = deps.dataSource.getLastPlayedMatchday?.(
          competitionId,
          activeSubTournament,
        );
        const nextMatchday = deps.dataSource.getNextMatchday?.(competitionId, activeSubTournament);
        const totalMatchdays =
          deps.dataSource.getTotalMatchdays?.(competitionId, activeSubTournament) ?? 38;

        reply.header('Cache-Control', 'public, max-age=60').send({
          currentMatchday,
          lastPlayedMatchday,
          nextMatchday,
          totalMatchdays,
          subTournaments,
          activeSubTournament,
        });
      });
    },
    { name: 'competition-info-route' },
  );
}

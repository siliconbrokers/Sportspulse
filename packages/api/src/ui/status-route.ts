import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDependencies } from './types.js';

export function statusRoute(deps: AppDependencies): FastifyPluginAsync {
  return fp(
    async function statusRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/status', async (_request, reply) => {
        const competitions: Record<string, { loaded: boolean; seasonId?: string }> = {};

        // Intentar resolver cada competición conocida del dataSource
        const competitionIds = deps.competitionIds ?? [
          // fallback legacy list if not passed
          'comp:apifootball:140', 'comp:apifootball:39', 'comp:apifootball:78',
          'comp:apifootball:268', 'comp:apifootball:128',
        ];

        for (const id of competitionIds) {
          try {
            const seasonId = deps.dataSource.getSeasonId(id);
            competitions[id] = { loaded: !!seasonId, seasonId: seasonId ?? undefined };
          } catch {
            competitions[id] = { loaded: false };
          }
        }

        const tournamentStatus: Record<string, { bracket: boolean; groups: boolean }> = {};
        if (deps.tournamentSource) {
          for (const id of [
            'comp:football-data-wc:WC',
            'comp:football-data-ca:CA',
            'comp:football-data-cli:CLI',
          ]) {
            const bracket = deps.tournamentSource.getBracketView(id);
            const groups = deps.tournamentSource.getGroupView(id);
            tournamentStatus[id] = { bracket: bracket !== null, groups: groups !== null };
          }
        }

        reply.header('Cache-Control', 'no-cache').send({
          ok: true,
          allLoaded: Object.values(competitions).every(c => c.loaded),
          uptime: Math.floor(process.uptime()),
          env: {
            FOOTBALL_DATA_TOKEN: process.env['FOOTBALL_DATA_TOKEN'] ? 'set' : 'missing',
            APIFOOTBALL_KEY:     process.env['APIFOOTBALL_KEY']     ? 'set' : 'missing',
            YOUTUBE_API_KEY:     process.env['YOUTUBE_API_KEY']     ? 'set' : 'missing',
            ADMIN_SECRET:        process.env['ADMIN_SECRET']        ? 'set' : 'missing',
          },
          competitions,
          tournaments: tournamentStatus,
          ts: new Date().toISOString(),
        });
      });
    },
    { name: 'status-route' },
  );
}

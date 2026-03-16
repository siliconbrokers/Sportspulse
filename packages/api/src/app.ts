import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { errorHandlerPlugin } from './errors/error-handler.js';
import { dashboardRoute } from './ui/dashboard-route.js';
import { teamRoute } from './ui/team-route.js';
import { standingsRoute } from './ui/standings-route.js';
import { competitionInfoRoute } from './ui/competition-info-route.js';
import { newsRoute } from './ui/news-route.js';
import { videosRoute } from './ui/videos-route.js';
import { radarRoute } from './ui/radar-route.js';
import { radarV2Route } from './ui/radar-v2-route.js';
import { eventosRoute } from './ui/eventos-route.js';
import { groupStandingsRoute } from './ui/group-standings-route.js';
import { bracketRoute } from './ui/bracket-route.js';
import { tournamentMatchesRoute } from './ui/tournament-matches-route.js';
import { scorersRoute } from './ui/scorers-route.js';
import { upcomingRoute } from './ui/upcoming-route.js';
import { predictionRoute } from './ui/prediction-route.js';
import { statusRoute } from './ui/status-route.js';
import { portalConfigRoute } from './ui/portal-config-route.js';
import type { AppDependencies } from './ui/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.register(errorHandlerPlugin);
  app.register(dashboardRoute(deps));
  app.register(teamRoute(deps));
  app.register(standingsRoute(deps));
  app.register(competitionInfoRoute(deps));
  app.register(newsRoute(deps));
  app.register(videosRoute(deps));
  app.register(radarRoute(deps));
  app.register(radarV2Route(deps));
  app.register(eventosRoute(deps));
  app.register(groupStandingsRoute(deps));
  app.register(bracketRoute(deps));
  app.register(tournamentMatchesRoute(deps));
  app.register(scorersRoute(deps));
  app.register(upcomingRoute(deps));
  app.register(predictionRoute(deps));
  app.register(statusRoute(deps));
  app.register(portalConfigRoute(deps));

  // Servir el frontend React en producción
  const webDist = join(__dirname, '../../web/dist');
  app.register(fastifyStatic, { root: webDist, prefix: '/' });
  app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));

  return app;
}

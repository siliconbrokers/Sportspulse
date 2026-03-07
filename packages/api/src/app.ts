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

  // Servir el frontend React en producción
  const webDist = join(__dirname, '../../../../packages/web/dist');
  app.register(fastifyStatic, { root: webDist, prefix: '/' });
  app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));

  return app;
}

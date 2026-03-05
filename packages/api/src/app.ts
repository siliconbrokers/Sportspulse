import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { errorHandlerPlugin } from './errors/error-handler.js';
import { dashboardRoute } from './ui/dashboard-route.js';
import { teamRoute } from './ui/team-route.js';
import type { AppDependencies } from './ui/types.js';

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.register(errorHandlerPlugin);
  app.register(dashboardRoute(deps));
  app.register(teamRoute(deps));

  return app;
}

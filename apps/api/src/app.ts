import Fastify, { FastifyServerOptions } from "fastify";
import prismaPlugin, { PrismaPluginOptions } from "./plugins/prisma";
import healthRoutes from "./modules/health/routes";

export interface BuildAppOptions {
  logger?: FastifyServerOptions["logger"];
  prisma?: PrismaPluginOptions["client"];
}

export function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  app.register(prismaPlugin, { client: opts.prisma });
  app.register(
    async (api) => {
      api.register(healthRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}

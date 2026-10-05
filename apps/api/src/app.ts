import { Prisma } from "@prisma/client";
import Fastify, { FastifyError, FastifyServerOptions } from "fastify";
import { HttpError } from "./lib/errors";
import auditPlugin from "./plugins/audit";
import authPlugin from "./plugins/auth";
import prismaPlugin, { PrismaPluginOptions } from "./plugins/prisma";
import authRoutes from "./modules/auth/routes";
import billingProvidersRoutes from "./modules/billing-providers/routes";
import importRoutes from "./modules/generators/import/routes";
import mapsRoutes from "./modules/generators/maps.routes";
import generatorsMasterRoutes from "./modules/generators/master.routes";
import measurementsRoutes from "./modules/generators/measurements.routes";
import summaryRoutes from "./modules/generators/summary.routes";
import healthRoutes from "./modules/health/routes";
import permissionsRoutes from "./modules/permissions/routes";
import pricesRoutes from "./modules/providers/prices.routes";
import providersRoutes from "./modules/providers/providers.routes";
import targetsRoutes from "./modules/providers/targets.routes";
import teamsRoutes from "./modules/teams/routes";
import usersRoutes from "./modules/users/routes";

export interface BuildAppOptions {
  logger?: FastifyServerOptions["logger"];
  prisma?: PrismaPluginOptions["client"];
}

export function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  // Valores monetários em cêntimos (BigInt) são serializados como string (CLAUDE.md §3).
  app.setReplySerializer((payload) =>
    JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  );

  app.register(prismaPlugin, { client: opts.prisma });
  app.register(auditPlugin);
  app.register(authPlugin);

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      return reply
        .code(err.statusCode)
        .send({ statusCode: err.statusCode, code: err.code, message: err.message, issues: err.issues });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return reply.code(409).send({ statusCode: 409, code: "CONFLICT", message: "Registo duplicado" });
    }
    const status = (err as FastifyError).statusCode || 500;
    if (status >= 500) req.log.error(err);
    return reply
      .code(status)
      .send({ statusCode: status, message: status >= 500 ? "Erro interno do servidor" : err.message });
  });

  app.register(
    async (api) => {
      api.register(healthRoutes);
      api.register(authRoutes);
      api.register(usersRoutes);
      api.register(permissionsRoutes);
      api.register(teamsRoutes);
      api.register(providersRoutes);
      api.register(pricesRoutes);
      api.register(targetsRoutes);
      api.register(billingProvidersRoutes);
      api.register(generatorsMasterRoutes);
      api.register(mapsRoutes);
      api.register(measurementsRoutes);
      api.register(importRoutes);
      api.register(summaryRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}

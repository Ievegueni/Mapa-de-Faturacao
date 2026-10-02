import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface PrismaPluginOptions {
  /** Cliente injectado (testes). Por omissão cria um novo. */
  client?: PrismaClient;
}

export default fp<PrismaPluginOptions>(
  async (app, opts) => {
    const prisma = opts.client ?? new PrismaClient();
    app.decorate("prisma", prisma);
    app.addHook("onClose", async () => {
      await prisma.$disconnect();
    });
  },
  { name: "prisma" },
);

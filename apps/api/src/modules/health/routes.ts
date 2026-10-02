import { FastifyPluginAsync } from "fastify";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_req, reply) => {
    let db: "up" | "down" = "up";
    try {
      await app.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      app.log.error({ err }, "health: base de dados indisponível");
      db = "down";
    }
    return reply.code(db === "up" ? 200 : 503).send({ status: db === "up" ? "ok" : "error", db });
  });
};

export default healthRoutes;

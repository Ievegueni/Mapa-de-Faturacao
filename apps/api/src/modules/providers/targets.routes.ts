import { targetsUpsertSchema, yearSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { notFound, parse } from "../../lib/errors";
import { requirePermission } from "../../plugins/rbac";

const targetsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  /** Targets do ano: linha global (providerId vazio) e linhas por provider. */
  app.get<{ Querystring: { ano?: string } }>(
    "/targets",
    { preHandler: requirePermission("prices_targets", "view") },
    async (req) => {
      const ano = parse(yearSchema, req.query.ano ?? new Date().getFullYear());
      const rows = await app.prisma.target.findMany({ where: { ano }, orderBy: [{ providerId: "asc" }, { mes: "asc" }] });
      return { ano, items: rows };
    },
  );

  /**
   * Grava as células da grelha. Um valor vazio grava `null`; uma célula com aluguer e combustível
   * vazios apaga a linha (aparece "—" na mesma).
   */
  app.put("/targets", { preHandler: requirePermission("prices_targets", "edit") }, async (req) => {
    const { ano, items } = parse(targetsUpsertSchema, req.body);

    const providerIds = Array.from(new Set(items.map((i) => i.providerId).filter((id): id is string => !!id)));
    const found = await app.prisma.provider.count({ where: { id: { in: providerIds } } });
    if (found !== providerIds.length) throw notFound("Provider não encontrado");

    const existing = await app.prisma.target.findMany({ where: { ano } });
    const key = (mes: number, providerId: string | null) => `${providerId ?? "GLOBAL"}:${mes}`;
    const byKey = new Map(existing.map((t) => [key(t.mes, t.providerId), t]));

    let changed = 0;
    await app.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const current = byKey.get(key(item.mes, item.providerId));
        const empty = item.aluguerCent === null && item.combustivelCent === null;
        const same =
          current &&
          current.aluguerCent === item.aluguerCent &&
          current.combustivelCent === item.combustivelCent;
        if (same || (!current && empty)) continue;
        changed++;
        if (current && empty) await tx.target.delete({ where: { id: current.id } });
        else if (current) {
          await tx.target.update({
            where: { id: current.id },
            data: { aluguerCent: item.aluguerCent, combustivelCent: item.combustivelCent },
          });
        } else {
          await tx.target.create({
            data: { ano, mes: item.mes, providerId: item.providerId, aluguerCent: item.aluguerCent, combustivelCent: item.combustivelCent },
          });
        }
      }
    });

    if (changed) {
      await app.audit({ userId: req.auth.id, entity: "Target", entityId: String(ano), action: "update", diff: { ano, celulas: changed } });
    }
    const rows = await app.prisma.target.findMany({ where: { ano }, orderBy: [{ providerId: "asc" }, { mes: "asc" }] });
    return { ano, items: rows };
  });
};

export default targetsRoutes;

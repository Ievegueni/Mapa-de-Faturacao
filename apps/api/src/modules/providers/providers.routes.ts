import { Prisma } from "@prisma/client";
import { providerBudgetSchema, providerCreateSchema, providerUpdateSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { conflict, notFound, parse } from "../../lib/errors";
import { diffFields } from "../../plugins/audit";
import { requirePermission } from "../../plugins/rbac";

const providerInclude = {
  budgets: {
    include: { team: { select: { id: true, nome: true, tipo: true } } },
    orderBy: [{ ano: "desc" }, { teamId: "asc" }],
  },
} satisfies Prisma.ProviderInclude;

const providersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  async function getProvider(id: string) {
    const provider = await app.prisma.provider.findUnique({ where: { id }, include: providerInclude });
    if (!provider) throw notFound("Provider não encontrado");
    return provider;
  }

  async function assertUniqueName(nome: string, exceptId?: string) {
    const other = await app.prisma.provider.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } } });
    if (other && other.id !== exceptId) throw conflict("Já existe um provider com este nome");
  }

  app.get<{ Querystring: { ativo?: string; tipo?: string } }>(
    "/providers",
    { preHandler: requirePermission("providers", "view") },
    async (req) => {
      const where: Prisma.ProviderWhereInput = {};
      if (req.query.ativo === "true" || req.query.ativo === "false") where.ativo = req.query.ativo === "true";
      if (req.query.tipo === "PROVIDERS" || req.query.tipo === "GERADORES") where.tipos = { has: req.query.tipo };
      return app.prisma.provider.findMany({ where, include: providerInclude, orderBy: { nome: "asc" } });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/providers/:id",
    { preHandler: requirePermission("providers", "view") },
    async (req) => getProvider(req.params.id),
  );

  app.post("/providers", { preHandler: requirePermission("providers", "create") }, async (req, reply) => {
    const data = parse(providerCreateSchema, req.body);
    await assertUniqueName(data.nome);
    const provider = await app.prisma.provider.create({ data, include: providerInclude });
    await app.audit({ userId: req.auth.id, entity: "Provider", entityId: provider.id, action: "create", diff: data });
    return reply.code(201).send(provider);
  });

  app.patch<{ Params: { id: string } }>(
    "/providers/:id",
    { preHandler: requirePermission("providers", "edit") },
    async (req) => {
      const data = parse(providerUpdateSchema, req.body);
      const before = await getProvider(req.params.id);
      if (data.nome) await assertUniqueName(data.nome, before.id);
      const provider = await app.prisma.provider.update({ where: { id: before.id }, data, include: providerInclude });
      const diff = diffFields(before, data, ["nome", "nif", "contacto", "email", "ativo"]) as Record<string, unknown>;
      if (data.tipos && data.tipos.join() !== before.tipos.join()) diff.tipos = [before.tipos, data.tipos];
      await app.audit({ userId: req.auth.id, entity: "Provider", entityId: provider.id, action: "update", diff: diff as Prisma.InputJsonValue });
      return provider;
    },
  );

  /** Desactivar (os mapas e facturas mantêm a referência). */
  app.delete<{ Params: { id: string } }>(
    "/providers/:id",
    { preHandler: requirePermission("providers", "delete") },
    async (req) => {
      const before = await getProvider(req.params.id);
      const provider = await app.prisma.provider.update({ where: { id: before.id }, data: { ativo: false }, include: providerInclude });
      await app.audit({ userId: req.auth.id, entity: "Provider", entityId: provider.id, action: "deactivate" });
      return provider;
    },
  );

  // ---------- PO e orçamento mensal por equipa/ano ----------

  app.get<{ Params: { id: string }; Querystring: { ano?: string } }>(
    "/providers/:id/budgets",
    { preHandler: requirePermission("providers", "view") },
    async (req) => {
      const provider = await getProvider(req.params.id);
      const ano = Number(req.query.ano);
      return ano ? provider.budgets.filter((b) => b.ano === ano) : provider.budgets;
    },
  );

  /** Cria ou actualiza a linha provider/equipa/ano (equipa vazia = todas as equipas). */
  app.put<{ Params: { id: string } }>(
    "/providers/:id/budgets",
    { preHandler: requirePermission("providers", "edit") },
    async (req) => {
      const data = parse(providerBudgetSchema, req.body);
      const provider = await getProvider(req.params.id);
      if (data.teamId && !(await app.prisma.team.findUnique({ where: { id: data.teamId } }))) {
        throw notFound("Equipa não encontrada");
      }
      const existing = await app.prisma.providerBudget.findFirst({
        where: { providerId: provider.id, teamId: data.teamId, ano: data.ano },
      });
      const values = { po: data.po, orcamentoMensalCent: data.orcamentoMensalCent };
      const budget = existing
        ? await app.prisma.providerBudget.update({ where: { id: existing.id }, data: values })
        : await app.prisma.providerBudget.create({ data: { providerId: provider.id, teamId: data.teamId, ano: data.ano, ...values } });
      await app.audit({
        userId: req.auth.id,
        entity: "ProviderBudget",
        entityId: budget.id,
        action: existing ? "update" : "create",
        diff: {
          teamId: data.teamId,
          ano: data.ano,
          po: [existing?.po ?? null, data.po],
          orcamentoMensalCent: [existing?.orcamentoMensalCent?.toString() ?? null, data.orcamentoMensalCent?.toString() ?? null],
        },
      });
      return getProvider(provider.id);
    },
  );

  app.delete<{ Params: { id: string; budgetId: string } }>(
    "/providers/:id/budgets/:budgetId",
    { preHandler: requirePermission("providers", "edit") },
    async (req) => {
      const budget = await app.prisma.providerBudget.findFirst({ where: { id: req.params.budgetId, providerId: req.params.id } });
      if (!budget) throw notFound("Orçamento não encontrado");
      await app.prisma.providerBudget.delete({ where: { id: budget.id } });
      await app.audit({ userId: req.auth.id, entity: "ProviderBudget", entityId: budget.id, action: "delete" });
      return getProvider(req.params.id);
    },
  );
};

export default providersRoutes;

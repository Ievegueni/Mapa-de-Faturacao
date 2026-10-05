import { BillingType, Prisma } from "@prisma/client";
import { BILLING_TYPES, providerBudgetSchema, providerCreateSchema, providerUpdateSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { badRequest, conflict, notFound, parse } from "../../lib/errors";
import { diffFields } from "../../plugins/audit";
import { assertBillingType, requirePermission, userBillingTypes } from "../../plugins/rbac";

const providerInclude = {
  budgets: {
    include: { team: { select: { id: true, nome: true, tipo: true } } },
    orderBy: [{ ano: "desc" }, { teamId: "asc" }],
  },
} satisfies Prisma.ProviderInclude;

const providersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  /** Parceiro de um módulo a que o utilizador tem acesso (as listas são separadas por módulo). */
  async function getProvider(id: string, user: Parameters<typeof assertBillingType>[0]) {
    const provider = await app.prisma.provider.findUnique({ where: { id }, include: providerInclude });
    if (!provider) throw notFound("Parceiro não encontrado");
    assertBillingType(user, provider.tipo);
    return provider;
  }

  async function assertUniqueName(nome: string, tipo: BillingType, exceptId?: string) {
    const other = await app.prisma.provider.findFirst({ where: { tipo, nome: { equals: nome, mode: "insensitive" } } });
    if (other && other.id !== exceptId) throw conflict("Já existe um parceiro com este nome neste módulo");
  }

  app.get<{ Querystring: { ativo?: string; tipo?: string } }>(
    "/providers",
    { preHandler: requirePermission("providers", "view") },
    async (req) => {
      const where: Prisma.ProviderWhereInput = {};
      if (req.query.ativo === "true" || req.query.ativo === "false") where.ativo = req.query.ativo === "true";
      const tipos = userBillingTypes(req.auth);
      if (BILLING_TYPES.includes(req.query.tipo as BillingType)) {
        assertBillingType(req.auth, req.query.tipo as BillingType);
        where.tipo = req.query.tipo as BillingType;
      } else {
        where.tipo = { in: tipos };
      }
      return app.prisma.provider.findMany({ where, include: providerInclude, orderBy: { nome: "asc" } });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/providers/:id",
    { preHandler: requirePermission("providers", "view") },
    async (req) => getProvider(req.params.id, req.auth),
  );

  app.post("/providers", { preHandler: requirePermission("providers", "create") }, async (req, reply) => {
    const data = parse(providerCreateSchema, req.body);
    assertBillingType(req.auth, data.tipo);
    await assertUniqueName(data.nome, data.tipo);
    const provider = await app.prisma.provider.create({ data, include: providerInclude });
    await app.audit({ userId: req.auth.id, entity: "Provider", entityId: provider.id, action: "create", diff: data });
    return reply.code(201).send(provider);
  });

  app.patch<{ Params: { id: string } }>(
    "/providers/:id",
    { preHandler: requirePermission("providers", "edit") },
    async (req) => {
      const data = parse(providerUpdateSchema, req.body);
      const before = await getProvider(req.params.id, req.auth);
      if (data.nome) await assertUniqueName(data.nome, before.tipo, before.id);
      const provider = await app.prisma.provider.update({ where: { id: before.id }, data, include: providerInclude });
      const diff = diffFields(before, data, ["nome", "nif", "contacto", "email", "ativo"]) as Record<string, unknown>;
      await app.audit({ userId: req.auth.id, entity: "Provider", entityId: provider.id, action: "update", diff: diff as Prisma.InputJsonValue });
      return provider;
    },
  );

  /** Desactivar (os mapas e facturas mantêm a referência). */
  app.delete<{ Params: { id: string } }>(
    "/providers/:id",
    { preHandler: requirePermission("providers", "delete") },
    async (req) => {
      const before = await getProvider(req.params.id, req.auth);
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
      const provider = await getProvider(req.params.id, req.auth);
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
      const provider = await getProvider(req.params.id, req.auth);
      if (provider.tipo !== "PROVIDERS") throw badRequest("PO e orçamento só existem nos parceiros da Rede Residencial");
      if (data.teamId) {
        const team = await app.prisma.team.findUnique({ where: { id: data.teamId } });
        if (!team) throw notFound("Equipa não encontrada");
        if (team.tipo !== "PROVIDERS") throw badRequest("A equipa não é da Rede Residencial");
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
      return getProvider(provider.id, req.auth);
    },
  );

  app.delete<{ Params: { id: string; budgetId: string } }>(
    "/providers/:id/budgets/:budgetId",
    { preHandler: requirePermission("providers", "edit") },
    async (req) => {
      await getProvider(req.params.id, req.auth);
      const budget = await app.prisma.providerBudget.findFirst({ where: { id: req.params.budgetId, providerId: req.params.id } });
      if (!budget) throw notFound("Orçamento não encontrado");
      await app.prisma.providerBudget.delete({ where: { id: budget.id } });
      await app.audit({ userId: req.auth.id, entity: "ProviderBudget", entityId: budget.id, action: "delete" });
      return getProvider(req.params.id, req.auth);
    },
  );
};

export default providersRoutes;

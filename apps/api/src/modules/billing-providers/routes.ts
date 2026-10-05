import { Prisma, ProviderInvoice } from "@prisma/client";
import {
  can,
  INVOICE_FIELDS_AFTER_VALIDATION,
  invoiceCreateSchema,
  invoiceUpdateSchema,
  monthlyBudgetFor,
  resolveBudget,
  summarizeProviders,
  yearSchema,
} from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { toDate, toIsoDate } from "../../lib/dates";
import { badRequest, forbidden, notFound, parse } from "../../lib/errors";
import { AuthUser } from "../../plugins/auth";
import { assertTeamAccess, requirePermission, scopeFilter } from "../../plugins/rbac";

const PAGE_SIZE = 50;

const invoiceInclude = {
  team: { select: { id: true, nome: true } },
  provider: { select: { id: true, nome: true } },
  createdBy: { select: { id: true, nome: true } },
  validatedBy: { select: { id: true, nome: true } },
} satisfies Prisma.ProviderInvoiceInclude;

type InvoiceRow = Prisma.ProviderInvoiceGetPayload<{ include: typeof invoiceInclude }>;

const toDto = (i: InvoiceRow) => ({
  ...i,
  dataFacturacao: i.dataFacturacao ? toIsoDate(i.dataFacturacao) : null,
  dataExecucao: i.dataExecucao ? toIsoDate(i.dataExecucao) : null,
  dividaCent: i.valorFTCent - i.valorPagoCent,
});

const AUDIT_FIELDS = [
  "teamId", "providerId", "ano", "mes", "po", "tipo", "numeroFactura", "dataFacturacao", "dataExecucao",
  "qtdOTs", "consumiveis", "valorFTCent", "valorPagoCent", "status", "observacao",
] as const;

function diffInvoice(before: ProviderInvoice, after: ProviderInvoice) {
  const norm = (v: unknown) => (v instanceof Date ? toIsoDate(v) : typeof v === "bigint" ? v.toString() : v ?? null);
  const diff: Record<string, [unknown, unknown]> = {};
  for (const f of AUDIT_FIELDS) {
    const a = norm(before[f]);
    const b = norm(after[f]);
    if (a !== b) diff[f] = [a, b];
  }
  return diff;
}

/** Quem não pode validar só mexe nos seus próprios rascunhos (CLAUDE.md §5.2). */
const isValidator = (user: AuthUser) => can(user.permissions, "billing_providers", "validate");

const billingProvidersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  async function getInvoice(user: AuthUser, id: string) {
    const invoice = await app.prisma.providerInvoice.findUnique({ where: { id }, include: invoiceInclude });
    if (!invoice) throw notFound("Factura não encontrada");
    assertTeamAccess(user, invoice.teamId);
    return invoice;
  }

  async function assertTeamAndProvider(user: AuthUser, teamId: string, providerId: string) {
    assertTeamAccess(user, teamId);
    const team = await app.prisma.team.findUnique({ where: { id: teamId } });
    if (!team || !team.ativo) throw badRequest("Equipa inválida ou inactiva");
    if (team.tipo !== "PROVIDERS") throw badRequest("A equipa não é do tipo Providers");
    const provider = await app.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider || !provider.ativo) throw badRequest("Parceiro inválido ou inactivo");
    if (provider.tipo !== "PROVIDERS") throw badRequest("O parceiro não está configurado para facturação de Providers");
  }

  /** PO do orçamento aplicável (equipa → por omissão) para o ano. */
  async function lookupPo(providerId: string, teamId: string, ano: number) {
    const budgets = await app.prisma.providerBudget.findMany({ where: { providerId, ano } });
    return resolveBudget(budgets, providerId, teamId, ano)?.po ?? null;
  }

  function assertCanModify(user: AuthUser, invoice: ProviderInvoice) {
    if (isValidator(user)) return;
    if (invoice.createdById !== user.id || invoice.state !== "RASCUNHO") {
      throw forbidden("Só pode alterar os seus próprios rascunhos");
    }
  }

  // ---------- Opções para o formulário (o Técnico não tem providers.view) ----------

  app.get("/billing/providers/options", { preHandler: requirePermission("billing_providers", "view") }, async (req) => {
    const teams = await app.prisma.team.findMany({
      where: { tipo: "PROVIDERS", ativo: true, ...(req.auth.role === "GESTOR" ? {} : { id: { in: req.auth.teamIds } }) },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });
    const providers = await app.prisma.provider.findMany({
      where: { ativo: true, tipo: "PROVIDERS" },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });
    return { teams, providers };
  });

  app.get<{ Querystring: { providerId?: string; teamId?: string; ano?: string } }>(
    "/billing/providers/po",
    { preHandler: requirePermission("billing_providers", "view") },
    async (req) => {
      const { providerId, teamId } = req.query;
      if (!providerId || !teamId) throw badRequest("Indique o parceiro e a equipa");
      assertTeamAccess(req.auth, teamId);
      return { po: await lookupPo(providerId, teamId, parse(yearSchema, req.query.ano)) };
    },
  );

  // ---------- Facturas ----------

  app.get<{
    Querystring: {
      teamId?: string; ano?: string; mes?: string; providerId?: string; status?: string; state?: string;
      mine?: string; q?: string; page?: string;
    };
  }>("/billing/providers/invoices", { preHandler: requirePermission("billing_providers", "view") }, async (req) => {
    const q = req.query;
    const where: Prisma.ProviderInvoiceWhereInput = { ...scopeFilter(req.auth) };
    if (q.teamId) {
      assertTeamAccess(req.auth, q.teamId);
      where.teamId = q.teamId;
    }
    if (q.ano) where.ano = Number(q.ano);
    if (q.mes) where.mes = Number(q.mes);
    if (q.providerId) where.providerId = q.providerId;
    if (q.status) where.status = { in: q.status.split(",") as ProviderInvoice["status"][] };
    if (q.state) where.state = { in: q.state.split(",") as ProviderInvoice["state"][] };
    if (q.mine === "true") where.createdById = req.auth.id;
    if (q.q) {
      where.OR = [
        { numeroFactura: { contains: q.q, mode: "insensitive" } },
        { observacao: { contains: q.q, mode: "insensitive" } },
        { po: { contains: q.q, mode: "insensitive" } },
      ];
    }
    const page = Math.max(1, Number(q.page) || 1);

    const [items, total, sums] = await Promise.all([
      app.prisma.providerInvoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: [{ ano: "desc" }, { mes: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      app.prisma.providerInvoice.count({ where }),
      app.prisma.providerInvoice.aggregate({ where, _sum: { valorFTCent: true, valorPagoCent: true } }),
    ]);
    const ft = sums._sum.valorFTCent ?? BigInt(0);
    const pago = sums._sum.valorPagoCent ?? BigInt(0);
    return {
      items: items.map(toDto),
      total,
      page,
      pageSize: PAGE_SIZE,
      totals: { valorFTCent: ft, valorPagoCent: pago, dividaCent: ft - pago },
    };
  });

  app.get<{ Params: { id: string } }>(
    "/billing/providers/invoices/:id",
    { preHandler: requirePermission("billing_providers", "view") },
    async (req) => toDto(await getInvoice(req.auth, req.params.id)),
  );

  app.post("/billing/providers/invoices", { preHandler: requirePermission("billing_providers", "create") }, async (req, reply) => {
    const data = parse(invoiceCreateSchema, req.body);
    await assertTeamAndProvider(req.auth, data.teamId, data.providerId);
    const invoice = await app.prisma.providerInvoice.create({
      data: {
        ...data,
        valorFTCent: data.valorFTCent!,
        dataFacturacao: data.dataFacturacao ? toDate(data.dataFacturacao) : null,
        dataExecucao: data.dataExecucao ? toDate(data.dataExecucao) : null,
        po: await lookupPo(data.providerId, data.teamId, data.ano),
        createdById: req.auth.id,
      },
      include: invoiceInclude,
    });
    await app.audit({ userId: req.auth.id, entity: "ProviderInvoice", entityId: invoice.id, action: "create", diff: data });
    return reply.code(201).send(toDto(invoice));
  });

  app.patch<{ Params: { id: string } }>(
    "/billing/providers/invoices/:id",
    { preHandler: requirePermission("billing_providers", "edit") },
    async (req) => {
      const data = parse(invoiceUpdateSchema, req.body);
      const before = await getInvoice(req.auth, req.params.id);
      assertCanModify(req.auth, before);

      if (before.state === "VALIDADO" || before.state === "FECHADO") {
        const extra = Object.keys(data).filter(
          (k) => !(INVOICE_FIELDS_AFTER_VALIDATION as readonly string[]).includes(k) && (data as Record<string, unknown>)[k] !== undefined,
        );
        if (extra.length) throw badRequest("Factura validada: só pode alterar o valor pago, o status e a observação");
      }

      const teamId = data.teamId ?? before.teamId;
      const providerId = data.providerId ?? before.providerId;
      const ano = data.ano ?? before.ano;
      if (data.teamId || data.providerId) await assertTeamAndProvider(req.auth, teamId, providerId);

      const update: Prisma.ProviderInvoiceUncheckedUpdateInput = {
        ...data,
        valorFTCent: data.valorFTCent ?? undefined,
        dataFacturacao: data.dataFacturacao === undefined ? undefined : data.dataFacturacao ? toDate(data.dataFacturacao) : null,
        dataExecucao: data.dataExecucao === undefined ? undefined : data.dataExecucao ? toDate(data.dataExecucao) : null,
      };
      if (teamId !== before.teamId || providerId !== before.providerId || ano !== before.ano) {
        update.po = await lookupPo(providerId, teamId, ano);
      }
      const invoice = await app.prisma.providerInvoice.update({ where: { id: before.id }, data: update, include: invoiceInclude });
      await app.audit({ userId: req.auth.id, entity: "ProviderInvoice", entityId: invoice.id, action: "update", diff: diffInvoice(before, invoice) });
      return toDto(invoice);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/billing/providers/invoices/:id",
    { preHandler: requirePermission("billing_providers", "delete") },
    async (req, reply) => {
      const invoice = await getInvoice(req.auth, req.params.id);
      assertCanModify(req.auth, invoice);
      if (invoice.state === "VALIDADO" || invoice.state === "FECHADO") throw badRequest("Não é possível eliminar uma factura validada");
      await app.prisma.providerInvoice.delete({ where: { id: invoice.id } });
      await app.audit({
        userId: req.auth.id,
        entity: "ProviderInvoice",
        entityId: invoice.id,
        action: "delete",
        diff: { providerId: invoice.providerId, ano: invoice.ano, mes: invoice.mes, numeroFactura: invoice.numeroFactura, valorFTCent: invoice.valorFTCent },
      });
      return reply.code(204).send();
    },
  );

  // ---------- Fluxo: Rascunho → Submetido → Validado ----------

  async function transition(
    user: AuthUser,
    id: string,
    from: ProviderInvoice["state"][],
    data: Prisma.ProviderInvoiceUncheckedUpdateInput,
    action: string,
  ) {
    const invoice = await getInvoice(user, id);
    if (!from.includes(invoice.state)) throw badRequest(`Operação inválida para uma factura em estado ${invoice.state.toLowerCase()}`);
    const updated = await app.prisma.providerInvoice.update({ where: { id: invoice.id }, data, include: invoiceInclude });
    await app.audit({ userId: user.id, entity: "ProviderInvoice", entityId: invoice.id, action, diff: { state: [invoice.state, updated.state] } });
    return { before: invoice, updated };
  }

  app.post<{ Params: { id: string } }>(
    "/billing/providers/invoices/:id/submit",
    { preHandler: requirePermission("billing_providers", "edit") },
    async (req) => {
      assertCanModify(req.auth, await getInvoice(req.auth, req.params.id));
      return toDto((await transition(req.auth, req.params.id, ["RASCUNHO"], { state: "SUBMETIDO" }, "submit")).updated);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/billing/providers/invoices/:id/validate",
    { preHandler: requirePermission("billing_providers", "validate") },
    async (req) => {
      const { updated } = await transition(
        req.auth,
        req.params.id,
        ["SUBMETIDO"],
        { state: "VALIDADO", validatedById: req.auth.id, validatedAt: new Date() },
        "validate",
      );
      return toDto(updated);
    },
  );

  /** Devolver ao autor para correcção. */
  app.post<{ Params: { id: string } }>(
    "/billing/providers/invoices/:id/return",
    { preHandler: requirePermission("billing_providers", "validate") },
    async (req) => toDto((await transition(req.auth, req.params.id, ["SUBMETIDO"], { state: "RASCUNHO" }, "return")).updated),
  );

  /** Reabrir uma factura validada (só o Gestor): volta a Submetido para ser corrigida e validada de novo. */
  app.post<{ Params: { id: string } }>(
    "/billing/providers/invoices/:id/reopen",
    { preHandler: requirePermission("billing_providers", "validate") },
    async (req) => {
      if (req.auth.role !== "GESTOR") throw forbidden("Só o Gestor pode reabrir facturas validadas");
      const { updated } = await transition(
        req.auth,
        req.params.id,
        ["VALIDADO"],
        { state: "SUBMETIDO", validatedById: null, validatedAt: null },
        "reopen",
      );
      return toDto(updated);
    },
  );

  // ---------- Resumo anual mês × provider ----------

  app.get<{ Querystring: { ano?: string; teamId?: string; validadas?: string } }>(
    "/billing/providers/summary",
    { preHandler: requirePermission("billing_providers", "view") },
    async (req) => {
      const ano = parse(yearSchema, req.query.ano ?? new Date().getFullYear());
      let teamIds: string[];
      if (req.query.teamId) {
        assertTeamAccess(req.auth, req.query.teamId);
        teamIds = [req.query.teamId];
      } else {
        const teams = await app.prisma.team.findMany({
          where: { tipo: "PROVIDERS", ativo: true, ...(req.auth.role === "GESTOR" ? {} : { id: { in: req.auth.teamIds } }) },
          select: { id: true },
        });
        teamIds = teams.map((t) => t.id);
      }

      const where: Prisma.ProviderInvoiceWhereInput = { ano, ...scopeFilter(req.auth) };
      if (req.query.teamId) where.teamId = req.query.teamId;
      if (req.query.validadas === "true") where.state = { in: ["VALIDADO", "FECHADO"] };

      const [invoices, budgets, activeProviders] = await Promise.all([
        app.prisma.providerInvoice.findMany({ where, select: { providerId: true, mes: true, valorFTCent: true, valorPagoCent: true } }),
        app.prisma.providerBudget.findMany({ where: { ano } }),
        app.prisma.provider.findMany({ where: { ativo: true, tipo: "PROVIDERS" }, select: { id: true } }),
      ]);

      const ids = Array.from(new Set([...activeProviders.map((p) => p.id), ...invoices.map((i) => i.providerId)]));
      const providers = await app.prisma.provider.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true }, orderBy: { nome: "asc" } });
      const summary = summarizeProviders(
        invoices,
        providers.map((p) => p.id),
        (providerId) => monthlyBudgetFor(budgets, providerId, teamIds, ano),
      );
      const names = new Map(providers.map((p) => [p.id, p.nome]));
      return {
        ano,
        teamId: req.query.teamId ?? null,
        ...summary,
        providers: summary.providers.map((p) => ({ ...p, nome: names.get(p.providerId) })),
      };
    },
  );
};

export default billingProvidersRoutes;

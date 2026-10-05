import { Prisma } from "@prisma/client";
import { can, generatorSchema, generatorUpdateSchema, siteSchema, siteUpdateSchema } from "@cf/shared";
import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { toDate, toIsoDate } from "../../lib/dates";
import { badRequest, conflict, forbidden, notFound, parse } from "../../lib/errors";
import { AuthUser } from "../../plugins/auth";
import { assertTeamAccess, requirePermission, scopeFilter } from "../../plugins/rbac";

const PAGE_SIZE = 50;

/** Dados mestre (sites e geradores): alterar exige billing_generators.edit e validate (Supervisor/Gestor). */
const requireMasterEdit = async (req: FastifyRequest) => {
  if (!can(req.auth.permissions, "billing_generators", "edit") || !can(req.auth.permissions, "billing_generators", "validate")) {
    throw forbidden("Sem permissão para alterar sites e geradores");
  }
};

const generatorInclude = {
  provider: { select: { id: true, nome: true } },
  site: { select: { id: true, nome: true, codigoPP: true, teamId: true, provincia: true, regiao: true } },
  _count: { select: { measurements: true } },
} satisfies Prisma.GeneratorInclude;

type GeneratorRow = Prisma.GeneratorGetPayload<{ include: typeof generatorInclude }>;

const generatorDto = (g: GeneratorRow) => ({
  ...g,
  dataInstalacao: g.dataInstalacao ? toIsoDate(g.dataInstalacao) : null,
  dataRemocao: g.dataRemocao ? toIsoDate(g.dataRemocao) : null,
  dataEntrada: g.dataEntrada ? toIsoDate(g.dataEntrada) : null,
});

const siteInclude = {
  team: { select: { id: true, nome: true } },
  generators: {
    select: { id: true, numeroSerie: true, potenciaKVA: true, dataRemocao: true, provider: { select: { id: true, nome: true } } },
    orderBy: { numeroSerie: "asc" },
  },
  _count: { select: { measurements: true } },
} satisfies Prisma.SiteInclude;

const dateOrNull = (v: string | null | undefined) => (v === undefined ? undefined : v ? toDate(v) : null);

const generatorsMasterRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);
  const view = requirePermission("billing_generators", "view");

  async function assertGeneratorsTeam(user: AuthUser, teamId: string) {
    assertTeamAccess(user, teamId);
    const team = await app.prisma.team.findUnique({ where: { id: teamId } });
    if (!team || !team.ativo) throw badRequest("Equipa inválida ou inactiva");
    if (team.tipo !== "GERADORES") throw badRequest("A equipa não é do tipo Geradores");
  }

  async function getSite(user: AuthUser, id: string) {
    const site = await app.prisma.site.findUnique({ where: { id }, include: siteInclude });
    if (!site) throw notFound("Site não encontrado");
    assertTeamAccess(user, site.teamId);
    return site;
  }

  async function getGenerator(user: AuthUser, id: string) {
    const g = await app.prisma.generator.findUnique({ where: { id }, include: generatorInclude });
    if (!g) throw notFound("Gerador não encontrado");
    assertTeamAccess(user, g.site.teamId);
    return g;
  }

  /** Duplicado = mesmo código P.P. e mesmo nome na equipa (o código sozinho não é único no Auto de Medição). */
  async function assertUniquePP(teamId: string, codigoPP: string | null, nome: string, exceptId?: string) {
    if (!codigoPP) return;
    const other = await app.prisma.site.findFirst({ where: { teamId, codigoPP, nome: { equals: nome, mode: "insensitive" } } });
    if (other && other.id !== exceptId) throw conflict(`Já existe o site ${nome} com o código P.P. ${codigoPP} nesta equipa`);
  }

  async function assertUniqueSerie(numeroSerie: string, exceptId?: string) {
    const other = await app.prisma.generator.findUnique({ where: { numeroSerie } });
    if (other && other.id !== exceptId) throw conflict(`Já existe um gerador com o nº de série ${numeroSerie}`);
  }

  async function assertProvider(providerId: string) {
    const p = await app.prisma.provider.findUnique({ where: { id: providerId } });
    if (!p || !p.ativo) throw badRequest("Proprietário inválido ou inactivo");
    if (p.tipo !== "GERADORES") throw badRequest("O proprietário não está configurado para Geradores");
  }

  // ---------- Opções para filtros e formulários ----------

  app.get("/generators/options", { preHandler: view }, async (req) => {
    const teamWhere = { tipo: "GERADORES" as const, ativo: true, ...(req.auth.role === "GESTOR" ? {} : { id: { in: req.auth.teamIds } }) };
    const [teams, providers, provincias, potencias] = await Promise.all([
      app.prisma.team.findMany({ where: teamWhere, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
      app.prisma.provider.findMany({ where: { ativo: true, tipo: "GERADORES" }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
      app.prisma.site.findMany({ where: scopeFilter(req.auth), distinct: ["provincia"], select: { provincia: true }, orderBy: { provincia: "asc" } }),
      app.prisma.generator.findMany({
        where: { potenciaKVA: { not: null }, site: scopeFilter(req.auth) },
        distinct: ["potenciaKVA"],
        select: { potenciaKVA: true },
        orderBy: { potenciaKVA: "asc" },
      }),
    ]);
    return { teams, providers, provincias: provincias.map((p) => p.provincia), potencias: potencias.map((p) => p.potenciaKVA) };
  });

  // ---------- Sites ----------

  app.get<{ Querystring: { q?: string; regiao?: string; provincia?: string; teamId?: string; page?: string } }>(
    "/generators/sites",
    { preHandler: view },
    async (req) => {
      const q = req.query;
      const where: Prisma.SiteWhereInput = { ...scopeFilter(req.auth) };
      if (q.teamId) {
        assertTeamAccess(req.auth, q.teamId);
        where.teamId = q.teamId;
      }
      if (q.regiao) where.regiao = q.regiao;
      if (q.provincia) where.provincia = q.provincia;
      if (q.q) {
        const term = q.q.trim();
        where.OR = [
          { nome: { contains: term, mode: "insensitive" } },
          { codigoPP: { contains: term, mode: "insensitive" } },
          { codigoLocalizacao: { contains: term, mode: "insensitive" } },
          { codigoCliente: { contains: term, mode: "insensitive" } },
          { generators: { some: { numeroSerie: { contains: term, mode: "insensitive" } } } },
        ];
      }
      const page = Math.max(1, Number(q.page) || 1);
      const [items, total] = await Promise.all([
        app.prisma.site.findMany({ where, include: siteInclude, orderBy: [{ nome: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
        app.prisma.site.count({ where }),
      ]);
      return { items, total, page, pageSize: PAGE_SIZE };
    },
  );

  app.get<{ Params: { id: string } }>("/generators/sites/:id", { preHandler: view }, async (req) => getSite(req.auth, req.params.id));

  app.post("/generators/sites", { preHandler: requireMasterEdit }, async (req, reply) => {
    const data = parse(siteSchema, req.body);
    await assertGeneratorsTeam(req.auth, data.teamId);
    await assertUniquePP(data.teamId, data.codigoPP, data.nome);
    const site = await app.prisma.site.create({ data, include: siteInclude });
    await app.audit({ userId: req.auth.id, entity: "Site", entityId: site.id, action: "create", diff: data });
    return reply.code(201).send(site);
  });

  app.patch<{ Params: { id: string } }>("/generators/sites/:id", { preHandler: requireMasterEdit }, async (req) => {
    const data = parse(siteUpdateSchema, req.body);
    const before = await getSite(req.auth, req.params.id);
    const teamId = data.teamId ?? before.teamId;
    if (data.teamId && data.teamId !== before.teamId) await assertGeneratorsTeam(req.auth, data.teamId);
    if (data.codigoPP !== undefined || data.teamId || data.nome) {
      await assertUniquePP(teamId, data.codigoPP !== undefined ? data.codigoPP : before.codigoPP, data.nome ?? before.nome, before.id);
    }
    const site = await app.prisma.site.update({ where: { id: before.id }, data, include: siteInclude });
    const diff: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(data)) {
      const prev = (before as Record<string, unknown>)[k];
      if (v !== undefined && v !== prev) diff[k] = [prev ?? null, v];
    }
    await app.audit({ userId: req.auth.id, entity: "Site", entityId: site.id, action: "update", diff });
    return site;
  });

  app.delete<{ Params: { id: string } }>(
    "/generators/sites/:id",
    { preHandler: [requirePermission("billing_generators", "delete"), requireMasterEdit] },
    async (req, reply) => {
      const site = await getSite(req.auth, req.params.id);
      if (site._count.measurements > 0) throw conflict("O site tem medições registadas e não pode ser eliminado");
      if (site.generators.length > 0) throw conflict("Remova ou mude de site os geradores antes de eliminar o site");
      await app.prisma.site.delete({ where: { id: site.id } });
      await app.audit({ userId: req.auth.id, entity: "Site", entityId: site.id, action: "delete", diff: { nome: site.nome, codigoPP: site.codigoPP } });
      return reply.code(204).send();
    },
  );

  // ---------- Geradores ----------

  app.get<{ Querystring: { q?: string; siteId?: string; providerId?: string; potencia?: string; removidos?: string; teamId?: string; page?: string } }>(
    "/generators/generators",
    { preHandler: view },
    async (req) => {
      const q = req.query;
      const site: Prisma.SiteWhereInput = { ...scopeFilter(req.auth) };
      if (q.teamId) {
        assertTeamAccess(req.auth, q.teamId);
        site.teamId = q.teamId;
      }
      const where: Prisma.GeneratorWhereInput = { site };
      if (q.siteId) where.siteId = q.siteId;
      if (q.providerId) where.providerId = q.providerId;
      if (q.potencia) where.potenciaKVA = Number(q.potencia);
      if (q.removidos === "true") where.dataRemocao = { not: null };
      if (q.removidos === "false") where.dataRemocao = null;
      if (q.q) {
        const term = q.q.trim();
        where.OR = [
          { numeroSerie: { contains: term, mode: "insensitive" } },
          { numeroActivo: { contains: term, mode: "insensitive" } },
          { site: { nome: { contains: term, mode: "insensitive" } } },
          { site: { codigoPP: { contains: term, mode: "insensitive" } } },
        ];
      }
      const page = Math.max(1, Number(q.page) || 1);
      const [items, total] = await Promise.all([
        app.prisma.generator.findMany({ where, include: generatorInclude, orderBy: { numeroSerie: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
        app.prisma.generator.count({ where }),
      ]);
      return { items: items.map(generatorDto), total, page, pageSize: PAGE_SIZE };
    },
  );

  app.get<{ Params: { id: string } }>("/generators/generators/:id", { preHandler: view }, async (req) =>
    generatorDto(await getGenerator(req.auth, req.params.id)),
  );

  app.post("/generators/generators", { preHandler: requireMasterEdit }, async (req, reply) => {
    const data = parse(generatorSchema, req.body);
    await getSite(req.auth, data.siteId);
    await assertProvider(data.providerId);
    await assertUniqueSerie(data.numeroSerie);
    const g = await app.prisma.generator.create({
      data: {
        ...data,
        dataInstalacao: dateOrNull(data.dataInstalacao),
        dataRemocao: dateOrNull(data.dataRemocao),
        dataEntrada: dateOrNull(data.dataEntrada),
      },
      include: generatorInclude,
    });
    await app.audit({ userId: req.auth.id, entity: "Generator", entityId: g.id, action: "create", diff: data });
    return reply.code(201).send(generatorDto(g));
  });

  app.patch<{ Params: { id: string } }>("/generators/generators/:id", { preHandler: requireMasterEdit }, async (req) => {
    const data = parse(generatorUpdateSchema, req.body);
    const before = await getGenerator(req.auth, req.params.id);
    if (data.siteId && data.siteId !== before.siteId) await getSite(req.auth, data.siteId);
    if (data.providerId && data.providerId !== before.providerId) await assertProvider(data.providerId);
    if (data.numeroSerie && data.numeroSerie !== before.numeroSerie) await assertUniqueSerie(data.numeroSerie, before.id);
    const inst = data.dataInstalacao !== undefined ? data.dataInstalacao : before.dataInstalacao ? toIsoDate(before.dataInstalacao) : null;
    const rem = data.dataRemocao !== undefined ? data.dataRemocao : before.dataRemocao ? toIsoDate(before.dataRemocao) : null;
    if (inst && rem && rem < inst) throw badRequest("A data de remoção não pode ser anterior à de instalação");

    const g = await app.prisma.generator.update({
      where: { id: before.id },
      data: {
        ...data,
        dataInstalacao: dateOrNull(data.dataInstalacao),
        dataRemocao: dateOrNull(data.dataRemocao),
        dataEntrada: dateOrNull(data.dataEntrada),
      },
      include: generatorInclude,
    });
    const b = generatorDto(before) as Record<string, unknown>;
    const diff: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== b[k]) diff[k] = [b[k] ?? null, v];
    await app.audit({ userId: req.auth.id, entity: "Generator", entityId: g.id, action: "update", diff });
    return generatorDto(g);
  });

  app.delete<{ Params: { id: string } }>(
    "/generators/generators/:id",
    { preHandler: [requirePermission("billing_generators", "delete"), requireMasterEdit] },
    async (req, reply) => {
      const g = await getGenerator(req.auth, req.params.id);
      if (g._count.measurements > 0) throw conflict("O gerador tem medições registadas: registe a data de remoção em vez de o eliminar");
      await app.prisma.generator.delete({ where: { id: g.id } });
      await app.audit({ userId: req.auth.id, entity: "Generator", entityId: g.id, action: "delete", diff: { numeroSerie: g.numeroSerie } });
      return reply.code(204).send();
    },
  );
};

export default generatorsMasterRoutes;

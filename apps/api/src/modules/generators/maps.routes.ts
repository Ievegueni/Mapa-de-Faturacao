import { Prisma, RecordState } from "@prisma/client";
import { can, generatorMapCreateSchema, yearSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { badRequest, conflict, forbidden, notFound, parse } from "../../lib/errors";
import { AuthUser } from "../../plugins/auth";
import { assertTeamAccess, requirePermission, scopeFilter } from "../../plugins/rbac";
import { buildMeasurementData, fieldsOf, loadMapContext, mediaLitrosBySite, syncMapState } from "./compute";

const mapInclude = {
  team: { select: { id: true, nome: true } },
  provider: { select: { id: true, nome: true } },
  closedBy: { select: { id: true, nome: true } },
} satisfies Prisma.GeneratorMonthlyMapInclude;

const isValidator = (u: AuthUser) => can(u.permissions, "billing_generators", "validate");

const mapsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);
  const view = requirePermission("billing_generators", "view");

  async function getMap(user: AuthUser, id: string) {
    const map = await app.prisma.generatorMonthlyMap.findUnique({ where: { id }, include: mapInclude });
    if (!map) throw notFound("Mapa não encontrado");
    assertTeamAccess(user, map.teamId);
    return map;
  }

  /** Totais e contagens por estado e por flag. */
  async function stats(mapIds: string[]) {
    if (!mapIds.length) return new Map<string, ReturnType<typeof emptyStats>>();
    const [sums, byState, flagRows] = await Promise.all([
      app.prisma.generatorMeasurement.groupBy({
        by: ["mapId"],
        where: { mapId: { in: mapIds } },
        _count: true,
        _sum: { totalCent: true, aluguerCent: true, combustivelCent: true, servAbastCent: true, descontoRedeCent: true, litros: true },
      }),
      app.prisma.generatorMeasurement.groupBy({ by: ["mapId", "state"], where: { mapId: { in: mapIds } }, _count: true }),
      app.prisma.$queryRaw<{ mapId: string; flag: string; n: bigint }[]>`
        SELECT "mapId", unnest(flags) AS flag, COUNT(*) AS n FROM "GeneratorMeasurement"
        WHERE "mapId" IN (${Prisma.join(mapIds)}) GROUP BY "mapId", flag`,
    ]);
    const out = new Map<string, ReturnType<typeof emptyStats>>();
    for (const id of mapIds) out.set(id, emptyStats());
    for (const s of sums) {
      Object.assign(out.get(s.mapId)!, {
        medicoes: s._count,
        totalCent: s._sum.totalCent ?? BigInt(0),
        aluguerCent: s._sum.aluguerCent ?? BigInt(0),
        combustivelCent: s._sum.combustivelCent ?? BigInt(0),
        servAbastCent: s._sum.servAbastCent ?? BigInt(0),
        descontoRedeCent: s._sum.descontoRedeCent ?? BigInt(0),
        litros: s._sum.litros?.toFixed(2) ?? "0.00",
      });
    }
    for (const s of byState) out.get(s.mapId)!.porEstado[s.state] = s._count;
    for (const f of flagRows) out.get(f.mapId)!.flags[f.flag] = Number(f.n);
    return out;
  }
  const emptyStats = () => ({
    medicoes: 0,
    totalCent: BigInt(0),
    aluguerCent: BigInt(0),
    combustivelCent: BigInt(0),
    servAbastCent: BigInt(0),
    descontoRedeCent: BigInt(0),
    litros: "0.00",
    porEstado: {} as Record<string, number>,
    flags: {} as Record<string, number>,
  });

  app.get<{ Querystring: { ano?: string; teamId?: string; providerId?: string } }>("/generators/maps", { preHandler: view }, async (req) => {
    const where: Prisma.GeneratorMonthlyMapWhereInput = { ...scopeFilter(req.auth) };
    if (req.query.ano) where.ano = parse(yearSchema, req.query.ano);
    if (req.query.teamId) {
      assertTeamAccess(req.auth, req.query.teamId);
      where.teamId = req.query.teamId;
    }
    if (req.query.providerId) where.providerId = req.query.providerId;
    const maps = await app.prisma.generatorMonthlyMap.findMany({ where, include: mapInclude, orderBy: [{ ano: "desc" }, { mes: "desc" }] });
    const st = await stats(maps.map((m) => m.id));
    return maps.map((m) => ({ ...m, stats: st.get(m.id) }));
  });

  app.get<{ Params: { id: string } }>("/generators/maps/:id", { preHandler: view }, async (req) => {
    const map = await getMap(req.auth, req.params.id);
    const ctx = await loadMapContext(app.prisma, map.id);
    const st = await stats([map.id]);
    return {
      ...map,
      stats: st.get(map.id),
      // Preços e faixas em vigor: o formulário usa-os para calcular em tempo real com a mesma função da API.
      priceTable: ctx!.priceTable,
      bands: ctx!.bands,
    };
  });

  app.post("/generators/maps", { preHandler: requirePermission("billing_generators", "create") }, async (req, reply) => {
    const data = parse(generatorMapCreateSchema, req.body);
    assertTeamAccess(req.auth, data.teamId);
    const team = await app.prisma.team.findUnique({ where: { id: data.teamId } });
    if (!team || !team.ativo || team.tipo !== "GERADORES") throw badRequest("Equipa inválida (tem de ser de Geradores e estar activa)");
    const provider = await app.prisma.provider.findUnique({ where: { id: data.providerId } });
    if (!provider || !provider.ativo || provider.tipo !== "GERADORES") throw badRequest("Provider inválido para Geradores");
    const exists = await app.prisma.generatorMonthlyMap.findUnique({ where: { teamId_providerId_ano_mes: data } });
    if (exists) throw conflict("Já existe um mapa desta equipa e provider para este mês");
    const map = await app.prisma.generatorMonthlyMap.create({ data, include: mapInclude });
    await app.audit({ userId: req.auth.id, entity: "GeneratorMonthlyMap", entityId: map.id, action: "create", diff: data });
    return reply.code(201).send(map);
  });

  app.delete<{ Params: { id: string } }>("/generators/maps/:id", { preHandler: requirePermission("billing_generators", "delete") }, async (req, reply) => {
    const map = await getMap(req.auth, req.params.id);
    const locked = await app.prisma.generatorMeasurement.count({ where: { mapId: map.id, state: { not: "RASCUNHO" } } });
    if (map.state === "FECHADO" || locked) throw conflict("Só é possível eliminar mapas com todas as medições em rascunho");
    await app.prisma.generatorMonthlyMap.delete({ where: { id: map.id } });
    await app.audit({ userId: req.auth.id, entity: "GeneratorMonthlyMap", entityId: map.id, action: "delete", diff: { ano: map.ano, mes: map.mes } });
    return reply.code(204).send();
  });

  // ---------- Fluxo: Rascunho → Submetido → Validado → Fechado ----------

  async function moveMeasurements(mapId: string, from: RecordState[], to: RecordState, extra: Prisma.GeneratorMeasurementWhereInput = {}) {
    const r = await app.prisma.generatorMeasurement.updateMany({ where: { mapId, state: { in: from }, ...extra }, data: { state: to } });
    return r.count;
  }

  async function respond(userId: string, mapId: string, action: string, count: number) {
    await syncMapState(app.prisma, mapId);
    await app.audit({ userId, entity: "GeneratorMonthlyMap", entityId: mapId, action, diff: { medicoes: count } });
    const map = await app.prisma.generatorMonthlyMap.findUnique({ where: { id: mapId }, include: mapInclude });
    const st = await stats([mapId]);
    return { ...map, stats: st.get(mapId), alteradas: count };
  }

  /** Submeter: quem não valida só submete as suas medições em rascunho. */
  app.post<{ Params: { id: string } }>("/generators/maps/:id/submit", { preHandler: requirePermission("billing_generators", "edit") }, async (req) => {
    const map = await getMap(req.auth, req.params.id);
    if (map.state === "FECHADO") throw badRequest("O mapa está fechado");
    const count = await moveMeasurements(map.id, ["RASCUNHO"], "SUBMETIDO", isValidator(req.auth) ? {} : { createdById: req.auth.id });
    if (!count) throw badRequest("Não há medições em rascunho para submeter");
    return respond(req.auth.id, map.id, "submit", count);
  });

  app.post<{ Params: { id: string } }>("/generators/maps/:id/validate", { preHandler: requirePermission("billing_generators", "validate") }, async (req) => {
    const map = await getMap(req.auth, req.params.id);
    if (map.state === "FECHADO") throw badRequest("O mapa está fechado");
    const count = await moveMeasurements(map.id, ["SUBMETIDO"], "VALIDADO");
    if (!count) throw badRequest("Não há medições submetidas para validar");
    return respond(req.auth.id, map.id, "validate", count);
  });

  /** Devolver para correcção: submetidas e validadas voltam a rascunho. */
  app.post<{ Params: { id: string } }>("/generators/maps/:id/return", { preHandler: requirePermission("billing_generators", "validate") }, async (req) => {
    const map = await getMap(req.auth, req.params.id);
    if (map.state === "FECHADO") throw badRequest("O mapa está fechado");
    const count = await moveMeasurements(map.id, ["SUBMETIDO", "VALIDADO"], "RASCUNHO");
    if (!count) throw badRequest("Não há medições submetidas ou validadas");
    return respond(req.auth.id, map.id, "return", count);
  });

  app.post<{ Params: { id: string } }>("/generators/maps/:id/close", { preHandler: requirePermission("billing_generators", "close") }, async (req) => {
    const map = await getMap(req.auth, req.params.id);
    if (map.state === "FECHADO") throw badRequest("O mapa já está fechado");
    const [total, validated] = await Promise.all([
      app.prisma.generatorMeasurement.count({ where: { mapId: map.id } }),
      app.prisma.generatorMeasurement.count({ where: { mapId: map.id, state: "VALIDADO" } }),
    ]);
    if (!total) throw badRequest("O mapa não tem medições");
    if (validated !== total) throw badRequest(`Só é possível fechar com todas as medições validadas (${validated} de ${total})`);
    await app.prisma.$transaction([
      app.prisma.generatorMeasurement.updateMany({ where: { mapId: map.id }, data: { state: "FECHADO" } }),
      app.prisma.generatorMonthlyMap.update({ where: { id: map.id }, data: { state: "FECHADO", closedById: req.auth.id, closedAt: new Date() } }),
    ]);
    return respond(req.auth.id, map.id, "close", total);
  });

  /** Reabrir (só o Gestor): volta a Validado. */
  app.post<{ Params: { id: string } }>("/generators/maps/:id/reopen", { preHandler: requirePermission("billing_generators", "close") }, async (req) => {
    if (req.auth.role !== "GESTOR") throw forbidden("Só o Gestor pode reabrir um mapa fechado");
    const map = await getMap(req.auth, req.params.id);
    if (map.state !== "FECHADO") throw badRequest("O mapa não está fechado");
    const [r] = await app.prisma.$transaction([
      app.prisma.generatorMeasurement.updateMany({ where: { mapId: map.id }, data: { state: "VALIDADO" } }),
      app.prisma.generatorMonthlyMap.update({ where: { id: map.id }, data: { state: "VALIDADO", closedById: null, closedAt: null } }),
    ]);
    return respond(req.auth.id, map.id, "reopen", r.count);
  });

  /** Recalcular: aplica os preços e faixas actuais às medições ainda não fechadas. */
  app.post<{ Params: { id: string } }>("/generators/maps/:id/recalculate", { preHandler: requirePermission("billing_generators", "edit") }, async (req) => {
    if (!isValidator(req.auth)) throw forbidden("Só quem valida pode recalcular o mapa");
    const map = await getMap(req.auth, req.params.id);
    if (map.state === "FECHADO") throw badRequest("O mapa está fechado");
    const ctx = await loadMapContext(app.prisma, map.id);
    const rows = await app.prisma.generatorMeasurement.findMany({
      where: { mapId: map.id, state: { not: "FECHADO" } },
      include: { site: { select: { subtipo: true, distanciaFacturacao: true } }, generator: { select: { potenciaKVA: true, dataRemocao: true } } },
    });
    const media = await mediaLitrosBySite(app.prisma, map.teamId, map.ano, map.mes);
    await app.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < rows.length; i += 200) {
          await Promise.all(
            rows.slice(i, i + 200).map((m) =>
              tx.generatorMeasurement.update({
                where: { id: m.id },
                data: buildMeasurementData(ctx, m.site, m.generator, fieldsOf(m), media.get(m.siteId) ?? null),
              }),
            ),
          );
        }
      },
      { timeout: 120000 },
    );
    return respond(req.auth.id, map.id, "recalculate", rows.length);
  });
};

export default mapsRoutes;

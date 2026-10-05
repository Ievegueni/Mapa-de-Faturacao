import { Prisma } from "@prisma/client";
import { can, GENERATOR_FLAGS, measurementCreateSchema, measurementUpdateSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { toIsoDate } from "../../lib/dates";
import { badRequest, forbidden, notFound, parse } from "../../lib/errors";
import { AuthUser } from "../../plugins/auth";
import { assertTeamAccess, requirePermission } from "../../plugins/rbac";
import { buildMeasurementData, fieldsOf, loadMapContext, mediaLitrosBySite, syncMapState } from "./compute";

const PAGE_SIZE = 50;

const measurementInclude = {
  site: { select: { id: true, nome: true, codigoPP: true, regiao: true, provincia: true, subtipo: true, distanciaFacturacao: true } },
  generator: { select: { id: true, numeroSerie: true, potenciaKVA: true, dataRemocao: true } },
  createdBy: { select: { id: true, nome: true } },
} satisfies Prisma.GeneratorMeasurementInclude;

type MeasurementRow = Prisma.GeneratorMeasurementGetPayload<{ include: typeof measurementInclude }>;

const dto = (m: MeasurementRow) => ({
  ...m,
  generator: { ...m.generator, dataRemocao: m.generator.dataRemocao ? toIsoDate(m.generator.dataRemocao) : null },
});

const isValidator = (u: AuthUser) => can(u.permissions, "billing_generators", "validate");

const measurementsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);
  const view = requirePermission("billing_generators", "view");

  async function getMap(user: AuthUser, id: string) {
    const map = await app.prisma.generatorMonthlyMap.findUnique({ where: { id } });
    if (!map) throw notFound("Mapa não encontrado");
    assertTeamAccess(user, map.teamId);
    return map;
  }

  /** Rascunhos: o autor ou quem valida; submetidas/validadas: só quem valida; fechadas: ninguém. */
  function assertCanModify(user: AuthUser, m: { state: string; createdById: string }) {
    if (m.state === "FECHADO") throw badRequest("A medição está fechada");
    if (isValidator(user)) return;
    if (m.state !== "RASCUNHO" || m.createdById !== user.id) throw forbidden("Só pode alterar as suas medições em rascunho");
  }

  // ---------- Lista ----------

  app.get<{ Params: { id: string }; Querystring: { q?: string; regiao?: string; flag?: string; state?: string; page?: string } }>(
    "/generators/maps/:id/measurements",
    { preHandler: view },
    async (req) => {
      const map = await getMap(req.auth, req.params.id);
      const q = req.query;
      const where: Prisma.GeneratorMeasurementWhereInput = { mapId: map.id };
      if (q.regiao) where.site = { regiao: q.regiao };
      if (q.flag === "COM_FLAGS") where.NOT = { flags: { isEmpty: true } };
      else if (q.flag === "SEM_FLAGS") where.flags = { isEmpty: true };
      else if (q.flag && (GENERATOR_FLAGS as readonly string[]).includes(q.flag)) where.flags = { has: q.flag };
      if (q.state) where.state = q.state as Prisma.EnumRecordStateFilter["equals"];
      if (q.q) {
        const t = q.q.trim();
        where.OR = [
          { site: { nome: { contains: t, mode: "insensitive" } } },
          { site: { codigoPP: { contains: t, mode: "insensitive" } } },
          { generator: { numeroSerie: { contains: t, mode: "insensitive" } } },
        ];
      }
      const page = Math.max(1, Number(q.page) || 1);
      const [items, total, sums] = await Promise.all([
        app.prisma.generatorMeasurement.findMany({
          where,
          include: measurementInclude,
          orderBy: [{ site: { nome: "asc" } }, { generator: { numeroSerie: "asc" } }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
        app.prisma.generatorMeasurement.count({ where }),
        app.prisma.generatorMeasurement.aggregate({
          where,
          _sum: { litros: true, combustivelCent: true, servAbastCent: true, aluguerCent: true, descontoRedeCent: true, totalCent: true },
        }),
      ]);
      return {
        items: items.map(dto),
        total,
        page,
        pageSize: PAGE_SIZE,
        totals: {
          litros: sums._sum.litros?.toFixed(2) ?? "0.00",
          combustivelCent: sums._sum.combustivelCent ?? BigInt(0),
          servAbastCent: sums._sum.servAbastCent ?? BigInt(0),
          aluguerCent: sums._sum.aluguerCent ?? BigInt(0),
          descontoRedeCent: sums._sum.descontoRedeCent ?? BigInt(0),
          totalCent: sums._sum.totalCent ?? BigInt(0),
        },
      };
    },
  );

  // ---------- Formulário por site ----------

  /** Geradores do mapa (sites da equipa, do provider, não removidos antes do mês), com a medição se existir. */
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>("/generators/maps/:id/generators", { preHandler: view }, async (req) => {
    const map = await getMap(req.auth, req.params.id);
    const monthStart = new Date(Date.UTC(map.ano, map.mes - 1, 1));
    const gens = await app.prisma.generator.findMany({
      where: {
        providerId: map.providerId,
        site: { teamId: map.teamId },
        OR: [{ dataRemocao: null }, { dataRemocao: { gte: monthStart } }],
      },
      select: {
        id: true,
        numeroSerie: true,
        potenciaKVA: true,
        site: { select: { id: true, nome: true, codigoPP: true, provincia: true } },
        measurements: { where: { mapId: map.id }, select: { id: true, state: true, flags: true, totalCent: true } },
      },
      orderBy: [{ site: { nome: "asc" } }, { numeroSerie: "asc" }],
    });
    return gens.map(({ measurements, ...g }) => ({ ...g, measurement: measurements[0] ?? null }));
  });

  /** Dados para o formulário de um gerador: medição existente, horas N do mês anterior e média de litros. */
  app.get<{ Params: { id: string; generatorId: string } }>("/generators/maps/:id/generators/:generatorId", { preHandler: view }, async (req) => {
    const map = await getMap(req.auth, req.params.id);
    const generator = await app.prisma.generator.findUnique({
      where: { id: req.params.generatorId },
      include: { site: true },
    });
    if (!generator || generator.site.teamId !== map.teamId) throw notFound("Gerador não encontrado neste mapa");
    const measurement = await app.prisma.generatorMeasurement.findUnique({
      where: { mapId_generatorId: { mapId: map.id, generatorId: generator.id } },
      include: measurementInclude,
    });
    const prevDate = new Date(Date.UTC(map.ano, map.mes - 2, 1));
    const previous = await app.prisma.generatorMeasurement.findFirst({
      where: { generatorId: generator.id, map: { ano: prevDate.getUTCFullYear(), mes: prevDate.getUTCMonth() + 1 } },
      select: { horasN: true },
    });
    const media = await mediaLitrosBySite(app.prisma, map.teamId, map.ano, map.mes, [generator.siteId]);
    return {
      generator: {
        id: generator.id,
        numeroSerie: generator.numeroSerie,
        potenciaKVA: generator.potenciaKVA,
        dataRemocao: generator.dataRemocao ? toIsoDate(generator.dataRemocao) : null,
      },
      site: generator.site,
      measurement: measurement ? dto(measurement) : null,
      horasNMesAnterior: previous?.horasN?.toString() ?? null,
      mediaLitros3m: media.get(generator.siteId) ?? null,
    };
  });

  /** Gravar a medição de um gerador (cria ou actualiza). */
  app.post<{ Params: { id: string } }>("/generators/maps/:id/measurements", { preHandler: requirePermission("billing_generators", "create") }, async (req, reply) => {
    const map = await getMap(req.auth, req.params.id);
    if (map.state === "FECHADO") throw badRequest("O mapa está fechado");
    const { generatorId, ...fields } = parse(measurementCreateSchema, req.body);
    const generator = await app.prisma.generator.findUnique({ where: { id: generatorId }, include: { site: true } });
    if (!generator || generator.site.teamId !== map.teamId) throw badRequest("O gerador não pertence a esta equipa");

    const existing = await app.prisma.generatorMeasurement.findUnique({ where: { mapId_generatorId: { mapId: map.id, generatorId } } });
    if (existing) {
      if (!can(req.auth.permissions, "billing_generators", "edit")) throw forbidden();
      assertCanModify(req.auth, existing);
    }
    const ctx = await loadMapContext(app.prisma, map.id);
    const media = await mediaLitrosBySite(app.prisma, map.teamId, map.ano, map.mes, [generator.siteId]);
    const data = buildMeasurementData(ctx, generator.site, generator, fields, media.get(generator.siteId) ?? null);
    const saved = existing
      ? await app.prisma.generatorMeasurement.update({ where: { id: existing.id }, data, include: measurementInclude })
      : await app.prisma.generatorMeasurement.create({
          data: { ...data, mapId: map.id, siteId: generator.siteId, generatorId, createdById: req.auth.id },
          include: measurementInclude,
        });
    await syncMapState(app.prisma, map.id);
    await app.audit({
      userId: req.auth.id,
      entity: "GeneratorMeasurement",
      entityId: saved.id,
      action: existing ? "update" : "create",
      diff: { generatorId, ...fields },
    });
    return reply.code(existing ? 200 : 201).send(dto(saved));
  });

  /** Edição em linha. */
  app.patch<{ Params: { id: string } }>("/generators/measurements/:id", { preHandler: requirePermission("billing_generators", "edit") }, async (req) => {
    const patch = parse(measurementUpdateSchema, req.body);
    const before = await app.prisma.generatorMeasurement.findUnique({
      where: { id: req.params.id },
      include: { ...measurementInclude, map: true },
    });
    if (!before) throw notFound("Medição não encontrada");
    assertTeamAccess(req.auth, before.map.teamId);
    assertCanModify(req.auth, before);
    const fields = { ...fieldsOf(before), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    const ctx = await loadMapContext(app.prisma, before.mapId);
    const media = await mediaLitrosBySite(app.prisma, before.map.teamId, before.map.ano, before.map.mes, [before.siteId]);
    const data = buildMeasurementData(ctx, before.site, before.generator as never, fields, media.get(before.siteId) ?? null);
    const saved = await app.prisma.generatorMeasurement.update({ where: { id: before.id }, data, include: measurementInclude });
    const diff: Record<string, [unknown, unknown]> = {};
    const prev = fieldsOf(before) as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && String(prev[k] ?? "") !== String(v ?? "")) diff[k] = [prev[k] ?? null, v];
    await app.audit({ userId: req.auth.id, entity: "GeneratorMeasurement", entityId: saved.id, action: "update", diff });
    return dto(saved);
  });

  app.delete<{ Params: { id: string } }>("/generators/measurements/:id", { preHandler: requirePermission("billing_generators", "delete") }, async (req, reply) => {
    const m = await app.prisma.generatorMeasurement.findUnique({ where: { id: req.params.id }, include: { map: true } });
    if (!m) throw notFound("Medição não encontrada");
    assertTeamAccess(req.auth, m.map.teamId);
    assertCanModify(req.auth, m);
    await app.prisma.generatorMeasurement.delete({ where: { id: m.id } });
    await syncMapState(app.prisma, m.mapId);
    await app.audit({ userId: req.auth.id, entity: "GeneratorMeasurement", entityId: m.id, action: "delete", diff: { generatorId: m.generatorId } });
    return reply.code(204).send();
  });
};

export default measurementsRoutes;

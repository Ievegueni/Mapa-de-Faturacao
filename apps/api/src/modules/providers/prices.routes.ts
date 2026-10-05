import { Prisma } from "@prisma/client";
import { discountRuleSchema, priceTableCreateSchema, priceTableUpdateSchema, rentPriceSchema, rentPriceUpdateSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { badRequest, conflict, notFound, parse } from "../../lib/errors";
import { toDate, toIsoDate } from "../../lib/dates";
import { assertBillingType, requirePermission } from "../../plugins/rbac";

type PriceTableRow = Prisma.PriceTableGetPayload<{ include: { rentPrices: true } }>;

const priceTableDto = (t: PriceTableRow) => ({ ...t, validFrom: toIsoDate(t.validFrom) });

const rentOrder: Prisma.RentPriceOrderByWithRelationInput[] = [
  { potenciaKVA: { sort: "asc", nulls: "last" } },
  { subtipo: { sort: "asc", nulls: "first" } },
  { distancia: { sort: "asc", nulls: "first" } },
];

const pricesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);
  // Preços e faixas de desconto pertencem ao módulo Combustível e Geradores.
  app.addHook("preHandler", async (req) => assertBillingType(req.auth, "GERADORES"));
  const view = requirePermission("prices_targets", "view");
  const edit = requirePermission("prices_targets", "edit");

  async function getTable(id: string) {
    const table = await app.prisma.priceTable.findUnique({ where: { id }, include: { rentPrices: { orderBy: rentOrder } } });
    if (!table) throw notFound("Tabela de preços não encontrada");
    return table;
  }

  async function assertFreeDate(providerId: string, validFrom: Date, exceptId?: string) {
    const other = await app.prisma.priceTable.findFirst({ where: { providerId, validFrom } });
    if (other && other.id !== exceptId) throw conflict("Já existe uma tabela de preços deste provider com esta data de início");
  }

  // ---------- Tabelas de preços (com vigência) ----------

  app.get<{ Querystring: { providerId?: string } }>("/prices", { preHandler: view }, async (req) => {
    const tables = await app.prisma.priceTable.findMany({
      where: req.query.providerId ? { providerId: req.query.providerId } : {},
      include: { rentPrices: { orderBy: rentOrder } },
      orderBy: [{ providerId: "asc" }, { validFrom: "desc" }],
    });
    return tables.map(priceTableDto);
  });

  app.get<{ Params: { id: string } }>("/prices/:id", { preHandler: view }, async (req) => priceTableDto(await getTable(req.params.id)));

  /** Nova vigência. `copyFromId` copia os preços e as linhas de aluguer de outra tabela. */
  app.post("/prices", { preHandler: edit }, async (req, reply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const data = parse(priceTableCreateSchema, body);
    const { copyFromId } = parse(z.object({ copyFromId: z.string().optional() }), { copyFromId: body.copyFromId });
    const provider = await app.prisma.provider.findUnique({ where: { id: data.providerId } });
    if (!provider) throw notFound("Parceiro não encontrado");
    if (provider.tipo !== "GERADORES") throw badRequest("Os preços só existem nos parceiros de Combustível e Geradores");
    const validFrom = toDate(data.validFrom);
    await assertFreeDate(data.providerId, validFrom);

    let source: PriceTableRow | null = null;
    if (copyFromId) {
      source = await getTable(copyFromId);
      if (source.providerId !== data.providerId) throw badRequest("Só pode copiar tabelas do mesmo provider");
    }

    const table = await app.prisma.priceTable.create({
      data: {
        providerId: data.providerId,
        validFrom,
        precoCombustivelCent: source ? source.precoCombustivelCent : data.precoCombustivelCent,
        precoServAbastCent: source ? source.precoServAbastCent : data.precoServAbastCent,
        precoManutencaoCent: source ? source.precoManutencaoCent : data.precoManutencaoCent,
        ivaPercent: source ? source.ivaPercent : data.ivaPercent,
        rentPrices: source
          ? { create: source.rentPrices.map(({ potenciaKVA, subtipo, distancia, precoDiaCent }) => ({ potenciaKVA, subtipo, distancia, precoDiaCent })) }
          : undefined,
      },
      include: { rentPrices: { orderBy: rentOrder } },
    });
    await app.audit({
      userId: req.auth.id,
      entity: "PriceTable",
      entityId: table.id,
      action: "create",
      diff: { providerId: data.providerId, validFrom: data.validFrom, copyFromId: copyFromId ?? null },
    });
    return reply.code(201).send(priceTableDto(table));
  });

  app.patch<{ Params: { id: string } }>("/prices/:id", { preHandler: edit }, async (req) => {
    const data = parse(priceTableUpdateSchema, req.body);
    const before = await getTable(req.params.id);
    const update: Prisma.PriceTableUpdateInput = {
      precoCombustivelCent: data.precoCombustivelCent,
      precoServAbastCent: data.precoServAbastCent,
      precoManutencaoCent: data.precoManutencaoCent,
      ivaPercent: data.ivaPercent,
    };
    if (data.validFrom) {
      update.validFrom = toDate(data.validFrom);
      await assertFreeDate(before.providerId, update.validFrom as Date, before.id);
    }
    const table = await app.prisma.priceTable.update({ where: { id: before.id }, data: update, include: { rentPrices: { orderBy: rentOrder } } });

    const diff: Record<string, [unknown, unknown]> = {};
    for (const key of ["precoCombustivelCent", "precoServAbastCent", "precoManutencaoCent", "ivaPercent"] as const) {
      if (data[key] === undefined) continue;
      const a = before[key]?.toString() ?? null;
      const b = data[key]?.toString() ?? null;
      if (a !== b) diff[key] = [a, b];
    }
    if (data.validFrom && data.validFrom !== toIsoDate(before.validFrom)) diff.validFrom = [toIsoDate(before.validFrom), data.validFrom];
    await app.audit({ userId: req.auth.id, entity: "PriceTable", entityId: table.id, action: "update", diff: diff as Prisma.InputJsonValue });
    return priceTableDto(table);
  });

  app.delete<{ Params: { id: string } }>("/prices/:id", { preHandler: edit }, async (req, reply) => {
    const table = await getTable(req.params.id);
    await app.prisma.priceTable.delete({ where: { id: table.id } });
    await app.audit({ userId: req.auth.id, entity: "PriceTable", entityId: table.id, action: "delete", diff: { validFrom: toIsoDate(table.validFrom) } });
    return reply.code(204).send();
  });

  // ---------- Linhas de aluguer (potência × subtipo × distância) ----------

  app.post<{ Params: { id: string } }>("/prices/:id/rent-prices", { preHandler: edit }, async (req, reply) => {
    const data = parse(rentPriceSchema, req.body);
    const table = await getTable(req.params.id);
    const rent = await app.prisma.rentPrice.create({ data: { ...data, priceTableId: table.id } });
    await app.audit({
      userId: req.auth.id,
      entity: "RentPrice",
      entityId: rent.id,
      action: "create",
      diff: { ...data, precoDiaCent: data.precoDiaCent?.toString() ?? null, priceTableId: table.id },
    });
    return reply.code(201).send(priceTableDto(await getTable(table.id)));
  });

  app.patch<{ Params: { id: string; rentId: string } }>("/prices/:id/rent-prices/:rentId", { preHandler: edit }, async (req) => {
    const data = parse(rentPriceUpdateSchema, req.body);
    const before = await app.prisma.rentPrice.findFirst({ where: { id: req.params.rentId, priceTableId: req.params.id } });
    if (!before) throw notFound("Linha de aluguer não encontrada");
    await app.prisma.rentPrice.update({ where: { id: before.id }, data });
    await app.audit({
      userId: req.auth.id,
      entity: "RentPrice",
      entityId: before.id,
      action: "update",
      diff: { ...data, precoDiaCent: data.precoDiaCent === undefined ? undefined : data.precoDiaCent?.toString() ?? null } as Prisma.InputJsonValue,
    });
    return priceTableDto(await getTable(req.params.id));
  });

  app.delete<{ Params: { id: string; rentId: string } }>("/prices/:id/rent-prices/:rentId", { preHandler: edit }, async (req) => {
    const rent = await app.prisma.rentPrice.findFirst({ where: { id: req.params.rentId, priceTableId: req.params.id } });
    if (!rent) throw notFound("Linha de aluguer não encontrada");
    await app.prisma.rentPrice.delete({ where: { id: rent.id } });
    await app.audit({ userId: req.auth.id, entity: "RentPrice", entityId: rent.id, action: "delete" });
    return priceTableDto(await getTable(req.params.id));
  });

  // ---------- Faixas de desconto da rede ----------

  const ruleDto = (r: { id: string; horasMin: number; horasMax: number; percent: Prisma.Decimal; validFrom: Date }) => ({
    ...r,
    percent: r.percent.toString(),
    validFrom: toIsoDate(r.validFrom),
  });

  async function assertNoOverlap(rule: { horasMin: number; horasMax: number; validFrom: Date }, exceptId?: string) {
    const overlapping = await app.prisma.gridDiscountRule.findFirst({
      where: {
        validFrom: rule.validFrom,
        id: exceptId ? { not: exceptId } : undefined,
        horasMin: { lte: rule.horasMax },
        horasMax: { gte: rule.horasMin },
      },
    });
    if (overlapping) {
      throw badRequest(`A faixa sobrepõe-se a ${overlapping.horasMin}–${overlapping.horasMax} h com a mesma data de início`);
    }
  }

  app.get("/discount-rules", { preHandler: view }, async () => {
    const rules = await app.prisma.gridDiscountRule.findMany({ orderBy: [{ validFrom: "desc" }, { horasMin: "asc" }] });
    return rules.map(ruleDto);
  });

  app.post("/discount-rules", { preHandler: edit }, async (req, reply) => {
    const data = parse(discountRuleSchema, req.body);
    const values = { ...data, validFrom: toDate(data.validFrom) };
    await assertNoOverlap(values);
    const rule = await app.prisma.gridDiscountRule.create({ data: values });
    await app.audit({ userId: req.auth.id, entity: "GridDiscountRule", entityId: rule.id, action: "create", diff: data });
    return reply.code(201).send(ruleDto(rule));
  });

  app.patch<{ Params: { id: string } }>("/discount-rules/:id", { preHandler: edit }, async (req) => {
    const before = await app.prisma.gridDiscountRule.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound("Faixa não encontrada");
    const data = parse(discountRuleSchema, { ...ruleDto(before), ...(req.body as object) });
    const values = { ...data, validFrom: toDate(data.validFrom) };
    await assertNoOverlap(values, before.id);
    const rule = await app.prisma.gridDiscountRule.update({ where: { id: before.id }, data: values });
    await app.audit({
      userId: req.auth.id,
      entity: "GridDiscountRule",
      entityId: rule.id,
      action: "update",
      diff: { before: ruleDto(before), after: data } as unknown as Prisma.InputJsonValue,
    });
    return ruleDto(rule);
  });

  app.delete<{ Params: { id: string } }>("/discount-rules/:id", { preHandler: edit }, async (req, reply) => {
    const rule = await app.prisma.gridDiscountRule.findUnique({ where: { id: req.params.id } });
    if (!rule) throw notFound("Faixa não encontrada");
    await app.prisma.gridDiscountRule.delete({ where: { id: rule.id } });
    await app.audit({ userId: req.auth.id, entity: "GridDiscountRule", entityId: rule.id, action: "delete", diff: ruleDto(rule) });
    return reply.code(204).send();
  });
};

export default pricesRoutes;

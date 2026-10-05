import { monthlyIndicatorsSchema, yearSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { notFound, parse } from "../../lib/errors";
import { AuthUser } from "../../plugins/auth";
import { assertTeamAccess, requirePermission } from "../../plugins/rbac";
import { computeMonthSummary, computeValidations } from "./summary.service";

const summaryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);
  const view = requirePermission("billing_generators", "view");

  async function getMap(user: AuthUser, id: string) {
    const map = await app.prisma.generatorMonthlyMap.findUnique({ where: { id }, include: { indicators: true, provider: { select: { id: true, nome: true } }, team: { select: { id: true, nome: true } } } });
    if (!map) throw notFound("Mapa não encontrado");
    assertTeamAccess(user, map.teamId);
    return map;
  }

  /** Resumo do mês (categorias × zona, com IVA) + indicadores manuais do mapa. */
  app.get<{ Params: { mapId: string } }>("/generators/summary/:mapId", { preHandler: view }, async (req) => {
    return computeMonthSummary(app.prisma, await getMap(req.auth, req.params.mapId));
  });

  /** Indicadores manuais do mês (Mapa Resumo de Validações). */
  app.put<{ Params: { id: string } }>("/generators/maps/:id/indicators", { preHandler: requirePermission("billing_generators", "validate") }, async (req) => {
    const data = parse(monthlyIndicatorsSchema, req.body);
    const map = await getMap(req.auth, req.params.id);
    const toBig = (v: string | null) => (v === null ? null : BigInt(v));
    const values = {
      sitesRedePublica: data.sitesRedePublica,
      sitesRedeConfiguradosNetEco: data.sitesRedeConfiguradosNetEco,
      sitesRedeSemGarantia: data.sitesRedeSemGarantia,
      poupancaCent: toBig(data.poupancaCent),
      transporteExtraCent: toBig(data.transporteExtraCent),
      factAluguerLuandaCent: toBig(data.factAluguerLuandaCent),
      factAluguerProvinciaCent: toBig(data.factAluguerProvinciaCent),
      factCombustivelLuandaCent: toBig(data.factCombustivelLuandaCent),
      factCombustivelProvinciaCent: toBig(data.factCombustivelProvinciaCent),
      factServAbastLuandaCent: toBig(data.factServAbastLuandaCent),
      factServAbastProvinciaCent: toBig(data.factServAbastProvinciaCent),
    };
    const saved = await app.prisma.monthlyIndicators.upsert({ where: { mapId: map.id }, create: { mapId: map.id, ...values }, update: values });
    await app.audit({ userId: req.auth.id, entity: "MonthlyIndicators", entityId: map.id, action: "update", diff: { antes: map.indicators, depois: values } });
    return saved;
  });

  /** Mapa Resumo de Validações: vista anual Jan–Dez de um provider (soma das equipas no âmbito do utilizador). */
  app.get<{ Querystring: { ano?: string; providerId?: string; teamId?: string } }>("/generators/validations", { preHandler: view }, async (req) => {
    const ano = parse(yearSchema, req.query.ano ?? new Date().getFullYear());
    return computeValidations(app.prisma, req.auth, { ano, providerId: req.query.providerId, teamId: req.query.teamId });
  });
};

export default summaryRoutes;

import { Prisma } from "@prisma/client";
import {
  escalaoHoras,
  FACTURADO_FIELDS,
  monthlyIndicatorsSchema,
  monthSummary,
  validationsYear,
  ValidationMonthInput,
  yearSchema,
} from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { badRequest, notFound, parse } from "../../lib/errors";
import { AuthUser } from "../../plugins/auth";
import { assertTeamAccess, requirePermission, scopeFilter } from "../../plugins/rbac";
import { loadMapContext } from "./compute";

const ZERO = BigInt(0);
const PENALTY_FIELDS = ["penSLACent", "penNivelCombustCent", "penAvariaCent", "penExcessoHorasCent"] as const;

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
    const map = await getMap(req.auth, req.params.mapId);
    const ctx = await loadMapContext(app.prisma, map.id);
    const rows = await app.prisma.generatorMeasurement.findMany({
      where: { mapId: map.id },
      select: {
        state: true,
        aluguerCent: true,
        descontoRedeCent: true,
        precoManutencaoCent: true,
        servExtrasCent: true,
        penSLACent: true,
        penNivelCombustCent: true,
        penAvariaCent: true,
        penExcessoHorasCent: true,
        combustivelCent: true,
        servAbastCent: true,
        siteId: true,
        site: { select: { provincia: true, ligadoRede: true } },
      },
    });
    const summary = monthSummary(
      rows.map((r) => ({
        provincia: r.site.provincia,
        validado: r.state === "VALIDADO" || r.state === "FECHADO",
        aluguerCent: r.aluguerCent,
        descontoRedeCent: r.descontoRedeCent,
        manutencaoCent: r.precoManutencaoCent,
        servExtrasCent: r.servExtrasCent,
        penalizacoesCent: PENALTY_FIELDS.reduce((s, k) => s + (r[k] ?? ZERO), ZERO),
        combustivelCent: r.combustivelCent,
        servAbastCent: r.servAbastCent,
      })),
      ctx!.priceTable?.ivaPercent?.toString() ?? null,
      Object.fromEntries(Object.entries(FACTURADO_FIELDS).map(([k, f]) => [k, map.indicators?.[f] ?? null])),
    );
    const sitesLigados = new Set(rows.filter((r) => r.site.ligadoRede).map((r) => r.siteId)).size;
    return {
      mapId: map.id,
      ivaPercent: ctx!.priceTable?.ivaPercent?.toString() ?? null,
      ...summary,
      indicadores: map.indicators,
      /** Sugestão para o indicador "sites ligados à rede pública" (sites do mapa marcados como ligados). */
      sugestoes: { sitesRedePublica: sitesLigados },
    };
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
    const providerId = req.query.providerId;
    if (!providerId) throw badRequest("Indique o provider");
    const provider = await app.prisma.provider.findUnique({ where: { id: providerId }, select: { id: true, nome: true } });
    if (!provider) throw notFound("Provider não encontrado");
    const scope: Prisma.GeneratorMonthlyMapWhereInput = { ano, ...scopeFilter(req.auth) };
    if (req.query.teamId) {
      assertTeamAccess(req.auth, req.query.teamId);
      scope.teamId = req.query.teamId;
    }

    const maps = await app.prisma.generatorMonthlyMap.findMany({ where: scope, include: { indicators: true } });
    const providerMaps = maps.filter((m) => m.providerId === providerId);
    const mesOf = new Map(maps.map((m) => [m.id, m.mes]));

    const [rows, globalSums, targets] = await Promise.all([
      app.prisma.generatorMeasurement.findMany({
        where: { mapId: { in: providerMaps.map((m) => m.id) } },
        select: {
          mapId: true,
          horasN: true,
          litros: true,
          flags: true,
          aluguerCent: true,
          descontoRedeCent: true,
          precoManutencaoCent: true,
          combustivelCent: true,
          servAbastCent: true,
          penSLACent: true,
          penNivelCombustCent: true,
          penAvariaCent: true,
          penExcessoHorasCent: true,
          generator: { select: { potenciaKVA: true } },
        },
      }),
      app.prisma.generatorMeasurement.groupBy({
        by: ["mapId"],
        where: { mapId: { in: maps.map((m) => m.id) } },
        _sum: { aluguerCent: true, descontoRedeCent: true, precoManutencaoCent: true, combustivelCent: true, servAbastCent: true },
      }),
      app.prisma.target.findMany({ where: { ano, OR: [{ providerId }, { providerId: null }] } }),
    ]);

    const cv = () => ({ n: 0, valor: ZERO });
    const months = new Map<number, ValidationMonthInput>();
    const ensure = (mes: number) => {
      if (!months.has(mes)) {
        months.set(mes, {
          mes,
          temMapa: false,
          penSLA: cv(),
          penNivelCombust: cv(),
          penAvaria: cv(),
          penExcessoHoras: cv(),
          penHoras: { "40": cv(), "60": cv(), "100": cv() },
          parqueTotal: 0,
          parquePorPotencia: {},
          aluguerCent: ZERO,
          descontoRedeCent: ZERO,
          manutencaoCent: ZERO,
          litros: "0",
          combustivelCent: ZERO,
          servAbastCent: ZERO,
          indicadores: null,
          globalAluguerManutCent: ZERO,
          globalAbastecimentoCent: ZERO,
        });
      }
      return months.get(mes)!;
    };

    for (const m of providerMaps) {
      const t = ensure(m.mes);
      t.temMapa = true;
      if (m.indicators) {
        const i = m.indicators;
        const sumN = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
        const sumB = (a: bigint | null, b: bigint | null) => (a === null && b === null ? null : (a ?? ZERO) + (b ?? ZERO));
        const cur = t.indicadores;
        t.indicadores = {
          sitesRedePublica: sumN(cur?.sitesRedePublica ?? null, i.sitesRedePublica),
          sitesRedeConfiguradosNetEco: sumN(cur?.sitesRedeConfiguradosNetEco ?? null, i.sitesRedeConfiguradosNetEco),
          sitesRedeSemGarantia: sumN(cur?.sitesRedeSemGarantia ?? null, i.sitesRedeSemGarantia),
          poupancaCent: sumB(cur?.poupancaCent ?? null, i.poupancaCent),
          transporteExtraCent: sumB(cur?.transporteExtraCent ?? null, i.transporteExtraCent),
        };
      }
    }

    const litrosH = new Map<number, Prisma.Decimal>();
    for (const r of rows) {
      const t = ensure(mesOf.get(r.mapId)!);
      const pen = (k: "penSLA" | "penNivelCombust" | "penAvaria" | "penExcessoHoras", v: bigint | null) => {
        if (v !== null && v > ZERO) {
          t[k].n++;
          t[k].valor += v;
        }
      };
      pen("penSLA", r.penSLACent);
      pen("penNivelCombust", r.penNivelCombustCent);
      pen("penAvaria", r.penAvariaCent);
      pen("penExcessoHoras", r.penExcessoHorasCent);
      const esc = escalaoHoras(r.horasN?.toString() ?? null);
      if (esc) {
        t.penHoras[esc].n++;
        t.penHoras[esc].valor += r.penExcessoHorasCent ?? ZERO;
      }
      // Parque de geradores: medições de geradores não removidos (confere com o Mapa Resumo real: 1152 em Agosto de 2026).
      if (!r.flags.includes("GERADOR_REMOVIDO")) {
        t.parqueTotal++;
        const k = r.generator.potenciaKVA ? String(r.generator.potenciaKVA) : "—";
        t.parquePorPotencia[k] = (t.parquePorPotencia[k] ?? 0) + 1;
      }
      t.aluguerCent += r.aluguerCent;
      t.descontoRedeCent += r.descontoRedeCent;
      t.manutencaoCent += r.precoManutencaoCent ?? ZERO;
      t.combustivelCent += r.combustivelCent;
      t.servAbastCent += r.servAbastCent;
      if (r.litros) litrosH.set(t.mes, (litrosH.get(t.mes) ?? new Prisma.Decimal(0)).add(r.litros));
    }
    for (const [mes, l] of litrosH) ensure(mes).litros = l.toFixed(2);

    // Totais de todos os providers por mês (target global)
    for (const g of globalSums) {
      const t = ensure(mesOf.get(g.mapId)!);
      t.globalAluguerManutCent += (g._sum.aluguerCent ?? ZERO) - (g._sum.descontoRedeCent ?? ZERO) + (g._sum.precoManutencaoCent ?? ZERO);
      t.globalAbastecimentoCent += (g._sum.combustivelCent ?? ZERO) + (g._sum.servAbastCent ?? ZERO);
    }

    const pick = (mes: number, pid: string | null) => {
      const t = targets.find((x) => x.mes === mes && x.providerId === pid);
      return { aluguerCent: t?.aluguerCent ?? null, combustivelCent: t?.combustivelCent ?? null };
    };
    const meses = validationsYear(Array.from(months.values()), {
      provider: (mes) => pick(mes, providerId),
      global: (mes) => pick(mes, null),
    });
    return { ano, provider, teamId: req.query.teamId ?? null, meses, mapas: providerMaps.map((m) => ({ id: m.id, mes: m.mes, teamId: m.teamId, state: m.state })) };
  });
};

export default summaryRoutes;

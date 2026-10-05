import { Prisma } from "@prisma/client";
import { annualBudget, BILLING_TYPES, monthlyBudgetFor, selectByValidity, monthStart, summarizeProviders, yearSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { badRequest, forbidden, parse } from "../../lib/errors";
import { AuthUser } from "../../plugins/auth";
import { assertTeamAccess, requirePermission, scopeFilter } from "../../plugins/rbac";

const ZERO = BigInt(0);

/**
 * Dashboard (CLAUDE.md §10): um pedido devolve tudo o que a página precisa, agregado na BD.
 * O Técnico recebe a versão simplificada (KPIs e avisos, sem gráficos).
 */
const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  const allowedTypes = (u: AuthUser) =>
    BILLING_TYPES.filter(
      (t) =>
        (u.role === "GESTOR" || u.teams.some((x) => x.tipo === t)) &&
        u.permissions.includes(t === "PROVIDERS" ? "billing_providers.view" : "billing_generators.view"),
    );

  app.get<{ Querystring: { tipo?: string; ano?: string; mes?: string; teamId?: string; providerId?: string } }>(
    "/dashboard",
    { preHandler: requirePermission("dashboard", "view") },
    async (req) => {
      const types = allowedTypes(req.auth);
      const tipo = (req.query.tipo as (typeof BILLING_TYPES)[number]) || types[0];
      if (!tipo) return { tipos: [], tipo: null };
      if (!types.includes(tipo)) throw forbidden("Sem acesso a este tipo de facturação");
      const ano = parse(yearSchema, req.query.ano ?? new Date().getFullYear());
      if (req.query.teamId) {
        if (req.auth.role !== "GESTOR") throw badRequest("O filtro por equipa é só para o Gestor");
        assertTeamAccess(req.auth, req.query.teamId);
      }
      const simplified = req.auth.role === "TECNICO";
      const base = { tipos: types, tipo, ano, simplificado: simplified };
      return tipo === "PROVIDERS"
        ? { ...base, providers: await providersDashboard(req.auth, ano, req.query.teamId, req.query.providerId, simplified) }
        : { ...base, geradores: await generatorsDashboard(req.auth, ano, req.query.mes ? Number(req.query.mes) : null, req.query.teamId, req.query.providerId, simplified) };
    },
  );

  // ---------------------------------------------------------------- Providers

  async function providersDashboard(user: AuthUser, ano: number, teamId: string | undefined, providerId: string | undefined, simplified: boolean) {
    const where: Prisma.ProviderInvoiceWhereInput = { ano, ...scopeFilter(user) };
    if (teamId) where.teamId = teamId;
    if (providerId) where.providerId = providerId;

    const teams = await app.prisma.team.findMany({
      where: { tipo: "PROVIDERS", ativo: true, ...(teamId ? { id: teamId } : user.role === "GESTOR" ? {} : { id: { in: user.teamIds } }) },
      select: { id: true },
    });
    const [invoices, budgets, active, pending] = await Promise.all([
      app.prisma.providerInvoice.findMany({ where, select: { providerId: true, mes: true, valorFTCent: true, valorPagoCent: true } }),
      app.prisma.providerBudget.findMany({ where: { ano } }),
      app.prisma.provider.findMany({ where: { ativo: true, tipo: "PROVIDERS", ...(providerId ? { id: providerId } : {}) }, select: { id: true } }),
      app.prisma.providerInvoice.findMany({
        where: { ...where, OR: [{ state: "SUBMETIDO" }, { status: { not: "FECHADO" } }] },
        include: { provider: { select: { nome: true } }, team: { select: { nome: true } } },
        orderBy: [{ ano: "desc" }, { mes: "desc" }],
        take: 10,
      }),
    ]);
    const ids = Array.from(new Set([...active.map((p) => p.id), ...invoices.map((i) => i.providerId)]));
    const providers = await app.prisma.provider.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true }, orderBy: { nome: "asc" } });
    const teamIds = teams.map((t) => t.id);
    const s = summarizeProviders(invoices, providers.map((p) => p.id), (pid) => monthlyBudgetFor(budgets, pid, teamIds, ano));
    const names = new Map(providers.map((p) => [p.id, p.nome]));

    const withBudget = s.providers.filter((p) => p.orcamentoAnual !== null);
    const orcamentoAnual = withBudget.length ? withBudget.reduce((a, p) => a + p.orcamentoAnual!, ZERO) : null;
    const facturadoComOrcamento = withBudget.reduce((a, p) => a + p.facturadoAno, ZERO);
    const semOrcamento = s.providers.filter((p) => p.orcamentoAnual === null).map((p) => names.get(p.providerId)!);

    return {
      kpis: {
        orcamentoAnual,
        facturado: s.totalAno,
        pago: s.pagoAno,
        divida: s.dividaAno,
        remanescente: orcamentoAnual === null ? null : orcamentoAnual - facturadoComOrcamento,
        execucaoPercent: orcamentoAnual === null || orcamentoAnual === ZERO ? null : Number((facturadoComOrcamento * BigInt(10000)) / orcamentoAnual) / 100,
      },
      porProvider: s.providers.map((p) => ({
        providerId: p.providerId,
        nome: names.get(p.providerId),
        orcamentoAnual: p.orcamentoAnual,
        facturado: p.facturadoAno,
        remanescente: p.remanescente,
        execucaoPercent: p.execucaoPercent,
        mesesAcimaOrcamento: p.mesesAcimaOrcamento,
      })),
      mensal: simplified
        ? []
        : Array.from({ length: 12 }, (_, i) => ({
            mes: i + 1,
            total: s.totalMes[i],
            porProvider: Object.fromEntries(s.providers.map((p) => [p.providerId, p.facturadoMes[i]])),
          })),
      pendentes: pending.map((i) => ({
        id: i.id,
        provider: i.provider.nome,
        equipa: i.team.nome,
        ano: i.ano,
        mes: i.mes,
        numeroFactura: i.numeroFactura,
        valorFTCent: i.valorFTCent,
        dividaCent: i.valorFTCent - i.valorPagoCent,
        status: i.status,
        state: i.state,
      })),
      avisos: semOrcamento.length ? [`Sem orçamento definido para ${ano}: ${semOrcamento.join(", ")}`] : [],
    };
  }

  // ---------------------------------------------------------------- Geradores

  async function generatorsDashboard(user: AuthUser, ano: number, mesParam: number | null, teamId: string | undefined, providerId: string | undefined, simplified: boolean) {
    const mapWhere: Prisma.GeneratorMonthlyMapWhereInput = { ano, ...scopeFilter(user) };
    if (teamId) mapWhere.teamId = teamId;
    const allMaps = await app.prisma.generatorMonthlyMap.findMany({ where: mapWhere, select: { id: true, mes: true, providerId: true, state: true } });
    const maps = providerId ? allMaps.filter((m) => m.providerId === providerId) : allMaps;
    const meses = Array.from(new Set(maps.map((m) => m.mes))).sort((a, b) => a - b);
    const mes = mesParam ?? meses[meses.length - 1] ?? new Date().getMonth() + 1;
    const monthMaps = maps.filter((m) => m.mes === mes);
    const monthIds = monthMaps.map((m) => m.id);

    // Evolução mensal (todos os meses do ano) e KPIs do mês, a partir de somas por mapa.
    const sums = maps.length
      ? await app.prisma.generatorMeasurement.groupBy({
          by: ["mapId"],
          where: { mapId: { in: maps.map((m) => m.id) } },
          _count: true,
          _sum: {
            totalCent: true, aluguerCent: true, combustivelCent: true, servAbastCent: true, descontoRedeCent: true,
            precoManutencaoCent: true, litros: true, penSLACent: true, penNivelCombustCent: true, penAvariaCent: true, penExcessoHorasCent: true,
          },
        })
      : [];
    const mesOf = new Map(allMaps.map((m) => [m.id, m]));
    type Acc = { total: bigint; aluguer: bigint; combustivel: bigint; servAbast: bigint; desconto: bigint; manutencao: bigint; litros: Prisma.Decimal; penalizacoes: bigint; geradores: number };
    const empty = (): Acc => ({ total: ZERO, aluguer: ZERO, combustivel: ZERO, servAbast: ZERO, desconto: ZERO, manutencao: ZERO, litros: new Prisma.Decimal(0), penalizacoes: ZERO, geradores: 0 });
    const byMes = new Map<number, Acc>();
    const byProviderMonth = new Map<string, Acc>();
    for (const s of sums) {
      const m = mesOf.get(s.mapId)!;
      const add = (a: Acc) => {
        a.total += s._sum.totalCent ?? ZERO;
        a.aluguer += s._sum.aluguerCent ?? ZERO;
        a.combustivel += s._sum.combustivelCent ?? ZERO;
        a.servAbast += s._sum.servAbastCent ?? ZERO;
        a.desconto += s._sum.descontoRedeCent ?? ZERO;
        a.manutencao += s._sum.precoManutencaoCent ?? ZERO;
        a.litros = a.litros.add(s._sum.litros ?? 0);
        a.penalizacoes += (s._sum.penSLACent ?? ZERO) + (s._sum.penNivelCombustCent ?? ZERO) + (s._sum.penAvariaCent ?? ZERO) + (s._sum.penExcessoHorasCent ?? ZERO);
        a.geradores += s._count;
      };
      if (!byMes.has(m.mes)) byMes.set(m.mes, empty());
      add(byMes.get(m.mes)!);
      if (m.mes === mes) {
        if (!byProviderMonth.has(m.providerId)) byProviderMonth.set(m.providerId, empty());
        add(byProviderMonth.get(m.providerId)!);
      }
    }
    const aluguerManut = (a: Acc) => a.aluguer - a.desconto + a.manutencao;
    const cur = byMes.get(mes) ?? empty();

    // Targets do mês: por provider e global (global compara com todos os providers no âmbito, mesmo com filtro de provider).
    const [targets, providers] = await Promise.all([
      app.prisma.target.findMany({ where: { ano, mes } }),
      app.prisma.provider.findMany({ where: { id: { in: Array.from(new Set(monthMaps.map((m) => m.providerId))) } }, select: { id: true, nome: true } }),
    ]);
    let globalAll = { aluguerManut: ZERO, abastecimento: ZERO };
    if (providerId) {
      const ids = allMaps.filter((m) => m.mes === mes).map((m) => m.id);
      if (ids.length) {
        const g = await app.prisma.generatorMeasurement.aggregate({
          where: { mapId: { in: ids } },
          _sum: { aluguerCent: true, descontoRedeCent: true, precoManutencaoCent: true, combustivelCent: true, servAbastCent: true },
        });
        globalAll = {
          aluguerManut: (g._sum.aluguerCent ?? ZERO) - (g._sum.descontoRedeCent ?? ZERO) + (g._sum.precoManutencaoCent ?? ZERO),
          abastecimento: (g._sum.combustivelCent ?? ZERO) + (g._sum.servAbastCent ?? ZERO),
        };
      }
    } else {
      globalAll = { aluguerManut: aluguerManut(cur), abastecimento: cur.combustivel + cur.servAbast };
    }
    const tgt = (pid: string | null) => targets.find((t) => t.providerId === pid) ?? null;
    const cmp = (valor: bigint, target: bigint | null) => ({
      valor,
      target,
      percent: target === null || target === ZERO ? null : Number((valor * BigInt(10000)) / target) / 100,
    });
    const g = tgt(null);
    const comparacao = {
      global: {
        aluguerManut: cmp(globalAll.aluguerManut, g?.aluguerCent ?? null),
        abastecimento: cmp(globalAll.abastecimento, g?.combustivelCent ?? null),
      },
      providers: providers.map((p) => {
        const a = byProviderMonth.get(p.id) ?? empty();
        const t = tgt(p.id);
        return {
          providerId: p.id,
          nome: p.nome,
          aluguerManut: cmp(aluguerManut(a), t?.aluguerCent ?? null),
          abastecimento: cmp(a.combustivel + a.servAbast, t?.combustivelCent ?? null),
        };
      }),
    };

    // Distribuições, top 10 e flags (mês seleccionado), agregados em SQL.
    let regioes: { regiao: string; total: bigint; litros: string; geradores: number }[] = [];
    let potencias: { potencia: string; geradores: number }[] = [];
    let topSites: { siteId: string; nome: string; codigoPP: string | null; provincia: string; litros: string }[] = [];
    let flags: { flag: string; n: number }[] = [];
    if (monthIds.length) {
      const ids = Prisma.join(monthIds);
      const flagRows = await app.prisma.$queryRaw<{ flag: string; n: bigint }[]>`
        SELECT unnest(flags) AS flag, COUNT(*) AS n FROM "GeneratorMeasurement" WHERE "mapId" IN (${ids}) GROUP BY flag ORDER BY n DESC`;
      flags = flagRows.map((f) => ({ flag: f.flag, n: Number(f.n) }));
      if (!simplified) {
        const [r, p, t] = await Promise.all([
          app.prisma.$queryRaw<{ regiao: string; total: bigint; litros: Prisma.Decimal | null; n: bigint }[]>`
            SELECT s.regiao, SUM(m."totalCent")::bigint AS total, SUM(m.litros) AS litros, COUNT(*) AS n
            FROM "GeneratorMeasurement" m JOIN "Site" s ON s.id = m."siteId"
            WHERE m."mapId" IN (${ids}) GROUP BY s.regiao ORDER BY total DESC`,
          app.prisma.$queryRaw<{ potencia: number | null; n: bigint }[]>`
            SELECT g."potenciaKVA" AS potencia, COUNT(*) AS n
            FROM "GeneratorMeasurement" m JOIN "Generator" g ON g.id = m."generatorId"
            WHERE m."mapId" IN (${ids}) AND NOT ('GERADOR_REMOVIDO' = ANY(m.flags))
            GROUP BY g."potenciaKVA" ORDER BY g."potenciaKVA" NULLS LAST`,
          app.prisma.$queryRaw<{ siteId: string; nome: string; codigoPP: string | null; provincia: string; litros: Prisma.Decimal }[]>`
            SELECT s.id AS "siteId", s.nome, s."codigoPP", s.provincia, SUM(m.litros) AS litros
            FROM "GeneratorMeasurement" m JOIN "Site" s ON s.id = m."siteId"
            WHERE m."mapId" IN (${ids}) AND m.litros IS NOT NULL
            GROUP BY s.id ORDER BY litros DESC LIMIT 10`,
        ]);
        regioes = r.map((x) => ({ regiao: x.regiao, total: x.total, litros: x.litros ? new Prisma.Decimal(x.litros).toFixed(2) : "0.00", geradores: Number(x.n) }));
        potencias = p.map((x) => ({ potencia: x.potencia === null ? "—" : String(x.potencia), geradores: Number(x.n) }));
        topSites = t.map((x) => ({ ...x, litros: new Prisma.Decimal(x.litros).toFixed(2) }));
      }
    }

    // Avisos: preços e targets em falta no mês.
    const avisos: string[] = [];
    const ref = monthStart(ano, mes);
    for (const p of providers) {
      const tables = await app.prisma.priceTable.findMany({ where: { providerId: p.id }, select: { validFrom: true, precoCombustivelCent: true, precoServAbastCent: true, ivaPercent: true, _count: { select: { rentPrices: true } } } });
      const pt = selectByValidity(tables, ref);
      if (!pt) avisos.push(`${p.nome}: sem tabela de preços em vigor`);
      else {
        const miss = [!pt.precoCombustivelCent && "combustível", !pt.precoServAbastCent && "serviço de abastecimento", !pt._count.rentPrices && "aluguer", !pt.ivaPercent && "IVA"].filter(Boolean);
        if (miss.length) avisos.push(`${p.nome}: preços em falta (${miss.join(", ")})`);
      }
      const t = tgt(p.id);
      if (!t || (t.aluguerCent === null && t.combustivelCent === null)) avisos.push(`${p.nome}: sem target para o mês`);
    }
    if (monthMaps.length && (!g || (g.aluguerCent === null && g.combustivelCent === null))) avisos.push("Sem target global para o mês");

    return {
      mes,
      mesesComDados: meses,
      kpis: {
        total: cur.total,
        aluguer: cur.aluguer,
        combustivel: cur.combustivel,
        servAbast: cur.servAbast,
        litros: cur.litros.toFixed(2),
        descontoRede: cur.desconto,
        penalizacoes: cur.penalizacoes,
        geradores: cur.geradores,
        mapas: monthMaps.length,
        porValidar: monthMaps.filter((m) => m.state !== "VALIDADO" && m.state !== "FECHADO").length,
      },
      comparacao,
      evolucao: simplified
        ? []
        : Array.from({ length: 12 }, (_, i) => {
            const a = byMes.get(i + 1);
            return a
              ? { mes: i + 1, total: a.total, aluguerManut: aluguerManut(a), abastecimento: a.combustivel + a.servAbast, litros: a.litros.toFixed(2) }
              : { mes: i + 1, total: null, aluguerManut: null, abastecimento: null, litros: null };
          }),
      regioes,
      potencias,
      topSites,
      flags,
      avisos,
    };
  }
};

export default dashboardRoutes;

import { Prisma } from "@prisma/client";
import {
  can,
  formatDecimal,
  GENERATOR_FLAG_LABELS,
  GeneratorFlag,
  INVOICE_STATUS_LABELS,
  monthlyBudgetFor,
  MONTHS,
  MONTHS_FULL,
  RECORD_STATE_LABELS,
  REGIOES,
  reportModel,
  ReportCell,
  ReportChart,
  ReportData,
  ReportSection,
  summarizeProviders,
  withTotals,
  yearSchema,
} from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { toIsoDate } from "../../lib/dates";
import { badRequest, forbidden, notFound, parse } from "../../lib/errors";
import { AuthUser } from "../../plugins/auth";
import { assertTeamAccess, requirePermission, scopeFilter } from "../../plugins/rbac";
import { computeMonthSummary, computeValidations } from "../generators/summary.service";

const ZERO = BigInt(0);
const s = (v: bigint | number | null | undefined): ReportCell => (v === null || v === undefined ? null : v.toString());

interface Filters {
  tipo: "PROVIDERS" | "GERADORES";
  modelo: string;
  ano: number;
  mes?: number;
  teamId?: string;
  providerId?: string;
  regiao?: string;
  provincia?: string;
}

const viewPerm = (tipo: string) => (tipo === "PROVIDERS" ? "billing_providers" : "billing_generators");

/** A API só fornece os dados agregados; o PDF e o Excel são montados no browser (CLAUDE.md §11). */
const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  app.get<{ Querystring: Record<string, string | undefined> }>("/reports/data", { preHandler: requirePermission("reports", "view") }, async (req) => {
    const q = req.query;
    const def = reportModel(q.tipo ?? "", q.modelo ?? "");
    if (!def) throw badRequest("Escolha o tipo de facturação e o modelo do relatório");
    if (!can(req.auth.permissions, viewPerm(def.tipo), "view")) throw forbidden();
    if (req.auth.role !== "GESTOR" && !req.auth.teams.some((t) => t.tipo === def.tipo)) throw forbidden("Sem equipas deste tipo de facturação");
    const f: Filters = {
      tipo: def.tipo,
      modelo: def.modelo,
      ano: parse(yearSchema, q.ano ?? new Date().getFullYear()),
      mes: q.mes ? parse(z.coerce.number().int().min(1).max(12), q.mes) : undefined,
      teamId: q.teamId || undefined,
      providerId: q.providerId || undefined,
      regiao: q.regiao || undefined,
      provincia: q.provincia || undefined,
    };
    const need = { mes: f.mes, provider: f.providerId, ano: f.ano } as Record<string, unknown>;
    for (const o of def.obrigatorios) if (o !== "equipa" && o !== "regiao" && o !== "provincia" && !need[o]) throw badRequest(`Preencha o filtro: ${o === "mes" ? "mês" : o}`);
    if (f.teamId) assertTeamAccess(req.auth, f.teamId);

    const [team, provider] = await Promise.all([
      f.teamId ? app.prisma.team.findUnique({ where: { id: f.teamId }, select: { nome: true, tipo: true } }) : null,
      f.providerId ? app.prisma.provider.findUnique({ where: { id: f.providerId }, select: { nome: true, tipo: true } }) : null,
    ]);
    // Módulos separados: equipa e parceiro têm de ser do mesmo módulo do relatório.
    if (f.providerId && (!provider || provider.tipo !== def.tipo)) throw notFound("Parceiro não encontrado neste módulo");
    if (f.teamId && (!team || team.tipo !== def.tipo)) throw notFound("Equipa não encontrada neste módulo");
    const filtros: Record<string, string> = { Ano: String(f.ano) };
    if (f.mes) filtros["Mês"] = MONTHS_FULL[f.mes - 1];
    filtros["Equipa"] = team?.nome ?? (req.auth.role === "GESTOR" ? "Todas" : "As suas equipas");
    if (def.filtros.includes("provider")) filtros["Parceiro"] = provider?.nome ?? "Todos";
    if (f.regiao) filtros["Região"] = f.regiao;
    if (f.provincia) filtros["Província"] = f.provincia;

    const base = {
      tipo: def.tipo,
      modelo: def.modelo,
      titulo: def.nome,
      periodo: f.mes ? `${MONTHS_FULL[f.mes - 1]} de ${f.ano}` : String(f.ano),
      filtros,
      orientacao: def.orientacao,
      avisos: [] as string[],
    };
    const body = await build(req.auth, f, provider?.nome ?? null);
    return { ...base, ...body, avisos: [...base.avisos, ...(body.avisos ?? [])] } satisfies ReportData;
  });

  /** Regista a exportação e verifica a permissão (o browser só gera o ficheiro se este pedido for aceite). */
  app.post<{ Body: { tipo?: string; modelo?: string; formato?: string; filtros?: Record<string, string> } }>(
    "/reports/log",
    { preHandler: requirePermission("reports", "export") },
    async (req) => {
      const b = req.body ?? {};
      const def = reportModel(b.tipo ?? "", b.modelo ?? "");
      if (!def) throw badRequest("Relatório desconhecido");
      if (!can(req.auth.permissions, viewPerm(def.tipo), "export")) throw forbidden("Sem permissão para exportar este tipo de facturação");
      const formato = b.formato === "xlsx" ? "xlsx" : b.formato === "pdf" ? "pdf" : null;
      if (!formato) throw badRequest("Formato inválido");
      await app.audit({ userId: req.auth.id, entity: "Report", entityId: `${def.tipo}:${def.modelo}`, action: `export_${formato}`, diff: { filtros: b.filtros ?? {} } });
      return { ok: true };
    },
  );

  async function build(user: AuthUser, f: Filters, providerName: string | null): Promise<Pick<ReportData, "secoes" | "graficos"> & { avisos?: string[] }> {
    switch (f.modelo) {
      case "resumo_anual":
      case "por_provider":
      case "pagamentos_divida":
        return providersReport(user, f);
      case "auto_medicao":
        return autoMedicao(user, f);
      case "resumo_mes":
        return resumoMes(user, f);
      case "validacoes_anual":
        return validacoes(user, f, providerName!);
      case "penalizacoes":
        return penalizacoes(user, f);
      case "consumo_regiao":
        return consumoRegiao(user, f);
      default:
        throw badRequest("Modelo desconhecido");
    }
  }

  // ------------------------------------------------------------------ Providers

  async function providersReport(user: AuthUser, f: Filters) {
    const where: Prisma.ProviderInvoiceWhereInput = { ano: f.ano, ...scopeFilter(user) };
    if (f.teamId) where.teamId = f.teamId;
    if (f.providerId) where.providerId = f.providerId;
    const invoices = await app.prisma.providerInvoice.findMany({
      where,
      include: { provider: { select: { id: true, nome: true } }, team: { select: { nome: true } } },
      orderBy: [{ mes: "asc" }, { createdAt: "asc" }],
    });

    if (f.modelo === "por_provider") {
      const secao = withTotals({
        titulo: "Facturas",
        colunas: [
          { key: "mes", label: "Mês", tipo: "texto" },
          { key: "po", label: "PO", tipo: "texto" },
          { key: "tipo", label: "Tipo", tipo: "texto" },
          { key: "numero", label: "Nº factura", tipo: "texto" },
          { key: "dataFact", label: "Data fact.", tipo: "data" },
          { key: "dataExec", label: "Data exec.", tipo: "data" },
          { key: "ots", label: "OTs", tipo: "int", soma: true },
          { key: "consumiveis", label: "Consumíveis", tipo: "int", soma: true },
          { key: "ft", label: "Valor FT", tipo: "kz", soma: true },
          { key: "pago", label: "Valor pago", tipo: "kz", soma: true },
          { key: "divida", label: "Dívida", tipo: "kz", soma: true },
          { key: "status", label: "Status", tipo: "texto" },
          { key: "estado", label: "Estado", tipo: "texto" },
        ],
        linhas: invoices.map((i) => ({
          mes: MONTHS_FULL[i.mes - 1],
          po: i.po,
          tipo: i.tipo,
          numero: i.numeroFactura,
          dataFact: i.dataFacturacao ? toIsoDate(i.dataFacturacao) : null,
          dataExec: i.dataExecucao ? toIsoDate(i.dataExecucao) : null,
          ots: i.qtdOTs,
          consumiveis: i.consumiveis,
          ft: s(i.valorFTCent),
          pago: s(i.valorPagoCent),
          divida: s(i.valorFTCent - i.valorPagoCent),
          status: INVOICE_STATUS_LABELS[i.status],
          estado: RECORD_STATE_LABELS[i.state],
        })),
      });
      const byMes = (k: "valorFTCent" | "valorPagoCent") => MONTHS.map((_, m) => Number(invoices.filter((i) => i.mes === m + 1).reduce((a, i) => a + i[k], ZERO)));
      return {
        secoes: [secao],
        graficos: [{ id: "mensal", titulo: "Facturado e pago por mês", tipo: "barras", formato: "kz", categorias: MONTHS, series: [{ nome: "Facturado", valores: byMes("valorFTCent") }, { nome: "Pago", valores: byMes("valorPagoCent") }] } as ReportChart],
      };
    }

    if (f.modelo === "pagamentos_divida") {
      const providers = Array.from(new Map(invoices.map((i) => [i.provider.id, i.provider.nome])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
      const resumo = withTotals({
        titulo: "Resumo por parceiro",
        colunas: [
          { key: "parceiro", label: "Parceiro", tipo: "texto" },
          { key: "facturas", label: "Facturas", tipo: "int", soma: true },
          { key: "ft", label: "Facturado", tipo: "kz", soma: true },
          { key: "pago", label: "Pago", tipo: "kz", soma: true },
          { key: "divida", label: "Dívida", tipo: "kz", soma: true },
        ],
        linhas: providers.map(([id, nome]) => {
          const list = invoices.filter((i) => i.provider.id === id);
          const ft = list.reduce((a, i) => a + i.valorFTCent, ZERO);
          const pago = list.reduce((a, i) => a + i.valorPagoCent, ZERO);
          return { parceiro: nome, facturas: list.length, ft: s(ft), pago: s(pago), divida: s(ft - pago) };
        }),
      });
      const comDivida = invoices.filter((i) => i.valorFTCent > i.valorPagoCent);
      const detalhe = withTotals({
        titulo: "Facturas com dívida",
        colunas: [
          { key: "parceiro", label: "Parceiro", tipo: "texto" },
          { key: "equipa", label: "Equipa", tipo: "texto" },
          { key: "mes", label: "Mês", tipo: "texto" },
          { key: "numero", label: "Nº factura", tipo: "texto" },
          { key: "dataFact", label: "Data fact.", tipo: "data" },
          { key: "ft", label: "Valor FT", tipo: "kz", soma: true },
          { key: "pago", label: "Pago", tipo: "kz", soma: true },
          { key: "divida", label: "Dívida", tipo: "kz", soma: true },
          { key: "status", label: "Status", tipo: "texto" },
          { key: "obs", label: "Observação", tipo: "texto" },
        ],
        linhas: comDivida.map((i) => ({
          parceiro: i.provider.nome,
          equipa: i.team.nome,
          mes: MONTHS_FULL[i.mes - 1],
          numero: i.numeroFactura,
          dataFact: i.dataFacturacao ? toIsoDate(i.dataFacturacao) : null,
          ft: s(i.valorFTCent),
          pago: s(i.valorPagoCent),
          divida: s(i.valorFTCent - i.valorPagoCent),
          status: INVOICE_STATUS_LABELS[i.status],
          obs: i.observacao,
        })),
      });
      return {
        secoes: [resumo, detalhe],
        graficos: [
          {
            id: "pagamentos",
            titulo: "Pago e dívida por parceiro",
            tipo: "barras_empilhadas",
            formato: "kz",
            categorias: resumo.linhas.map((l) => String(l.parceiro)),
            series: [
              { nome: "Pago", valores: resumo.linhas.map((l) => Number(l.pago)) },
              { nome: "Dívida", valores: resumo.linhas.map((l) => Number(l.divida)) },
            ],
          } as ReportChart,
        ],
      };
    }

    // resumo_anual
    const teams = await app.prisma.team.findMany({
      where: { tipo: "PROVIDERS", ativo: true, ...(f.teamId ? { id: f.teamId } : user.role === "GESTOR" ? {} : { id: { in: user.teamIds } }) },
      select: { id: true },
    });
    const [budgets, active] = await Promise.all([
      app.prisma.providerBudget.findMany({ where: { ano: f.ano } }),
      app.prisma.provider.findMany({ where: { ativo: true, tipo: "PROVIDERS" }, select: { id: true, nome: true } }),
    ]);
    const names = new Map([...active.map((p) => [p.id, p.nome] as const), ...invoices.map((i) => [i.provider.id, i.provider.nome] as const)]);
    const ids = Array.from(names.keys()).sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));
    const sm = summarizeProviders(invoices, ids, (pid) => monthlyBudgetFor(budgets, pid, teams.map((t) => t.id), f.ano));
    const mensal = withTotals({
      titulo: "Facturado por mês e parceiro",
      colunas: [{ key: "mes", label: "Mês", tipo: "texto" }, ...ids.map((id) => ({ key: id, label: names.get(id)!, tipo: "kz" as const, soma: true })), { key: "total", label: "Total", tipo: "kz", soma: true }],
      linhas: MONTHS_FULL.map((m, i) => ({ mes: m, ...Object.fromEntries(sm.providers.map((p) => [p.providerId, s(p.facturadoMes[i])])), total: s(sm.totalMes[i]) })),
    });
    const execucao: ReportSection = {
      titulo: "Orçamento e execução",
      colunas: [
        { key: "parceiro", label: "Parceiro", tipo: "texto" },
        { key: "orcMensal", label: "Orç. mensal", tipo: "kz" },
        { key: "orcAnual", label: "Orç. anual", tipo: "kz", soma: true },
        { key: "facturado", label: "Facturado", tipo: "kz", soma: true },
        { key: "pago", label: "Pago", tipo: "kz", soma: true },
        { key: "divida", label: "Dívida", tipo: "kz", soma: true },
        { key: "remanescente", label: "Remanescente", tipo: "kz", soma: true },
        { key: "execucao", label: "Execução", tipo: "pct" },
        { key: "alertas", label: "Meses acima do orçamento", tipo: "texto" },
      ],
      linhas: sm.providers.map((p) => ({
        parceiro: names.get(p.providerId)!,
        orcMensal: s(p.orcamentoMensal),
        orcAnual: s(p.orcamentoAnual),
        facturado: s(p.facturadoAno),
        pago: s(p.pagoAno),
        divida: s(p.divida),
        remanescente: s(p.remanescente),
        execucao: p.execucaoPercent,
        alertas: p.mesesAcimaOrcamento.map((m) => MONTHS[m - 1]).join(", ") || null,
      })),
    };
    return {
      secoes: [mensal, withTotals(execucao)],
      graficos: [
        {
          id: "mensal",
          titulo: "Facturado por mês",
          tipo: "barras_empilhadas",
          formato: "kz",
          categorias: MONTHS,
          series: sm.providers.filter((p) => p.facturadoAno > ZERO).map((p) => ({ nome: names.get(p.providerId)!, valores: p.facturadoMes.map(Number) })),
        } as ReportChart,
      ],
      avisos: sm.providers.filter((p) => p.orcamentoAnual === null).map((p) => `Sem orçamento definido para ${names.get(p.providerId)} em ${f.ano}`),
    };
  }

  // ------------------------------------------------------------------ Geradores

  function mapWhere(user: AuthUser, f: Filters): Prisma.GeneratorMonthlyMapWhereInput {
    const w: Prisma.GeneratorMonthlyMapWhereInput = { ano: f.ano, ...scopeFilter(user) };
    if (f.mes) w.mes = f.mes;
    if (f.teamId) w.teamId = f.teamId;
    if (f.providerId) w.providerId = f.providerId;
    return w;
  }

  function siteWhere(f: Filters): Prisma.SiteWhereInput | undefined {
    if (!f.regiao && !f.provincia) return undefined;
    return { ...(f.regiao ? { regiao: f.regiao } : {}), ...(f.provincia ? { provincia: f.provincia } : {}) };
  }

  async function autoMedicao(user: AuthUser, f: Filters) {
    const rows = await app.prisma.generatorMeasurement.findMany({
      where: { map: mapWhere(user, f), site: siteWhere(f) },
      include: { site: true, generator: { select: { numeroSerie: true, potenciaKVA: true } } },
      orderBy: [{ site: { nome: "asc" } }, { generator: { numeroSerie: "asc" } }],
    });
    const pen = (m: (typeof rows)[number]) => (m.penSLACent ?? ZERO) + (m.penNivelCombustCent ?? ZERO) + (m.penAvariaCent ?? ZERO) + (m.penExcessoHorasCent ?? ZERO);
    const secao = withTotals({
      titulo: "Auto de Medição",
      colunas: [
        { key: "site", label: "Site", tipo: "texto" },
        { key: "pp", label: "Código P.P.", tipo: "texto" },
        { key: "regiao", label: "Região", tipo: "texto" },
        { key: "provincia", label: "Província", tipo: "texto" },
        { key: "serie", label: "Nº série", tipo: "texto" },
        { key: "kva", label: "kVA", tipo: "int" },
        { key: "dias", label: "Dias", tipo: "int" },
        { key: "n1", label: "Horas N-1", tipo: "decimal" },
        { key: "n", label: "Horas N", tipo: "decimal" },
        { key: "ht", label: "H. trab.", tipo: "int" },
        { key: "hr", label: "H. rede", tipo: "int" },
        { key: "desc", label: "% desc.", tipo: "pct" },
        { key: "litros", label: "Litros", tipo: "decimal", soma: true },
        { key: "comb", label: "Combustível", tipo: "kz", soma: true },
        { key: "serv", label: "Serv. abast.", tipo: "kz", soma: true },
        { key: "alug", label: "Aluguer", tipo: "kz", soma: true },
        { key: "descRede", label: "Desc. rede", tipo: "kz", soma: true },
        { key: "manut", label: "Manutenção", tipo: "kz", soma: true },
        { key: "extras", label: "Serv. extras", tipo: "kz", soma: true },
        { key: "pen", label: "Penalizações", tipo: "kz", soma: true },
        { key: "total", label: "Total", tipo: "kz", soma: true },
        { key: "avisos", label: "Avisos", tipo: "texto" },
      ],
      linhas: rows.map((m) => ({
        site: m.site.nome,
        pp: m.site.codigoPP,
        regiao: m.site.regiao,
        provincia: m.site.provincia,
        serie: m.generator.numeroSerie,
        kva: m.generator.potenciaKVA,
        dias: m.dias,
        n1: m.horasN1?.toFixed(2) ?? null,
        n: m.horasN?.toFixed(2) ?? null,
        ht: m.horasTrabalhadas,
        hr: m.horasRede,
        desc: m.descontoPercent === null ? null : Number(m.descontoPercent),
        litros: m.litros?.toFixed(2) ?? null,
        comb: s(m.combustivelCent),
        serv: s(m.servAbastCent),
        alug: s(m.aluguerCent),
        descRede: s(m.descontoRedeCent),
        manut: s(m.precoManutencaoCent),
        extras: s(m.servExtrasCent),
        pen: s(pen(m)),
        total: s(m.totalCent),
        avisos: m.flags.map((x) => GENERATOR_FLAG_LABELS[x as GeneratorFlag] ?? x).join("; ") || null,
      })),
    });
    const reg = REGIOES.map((r) => rows.filter((m) => m.site.regiao === r).reduce((a, m) => a + m.totalCent, ZERO));
    return {
      secoes: [secao],
      graficos: [{ id: "regiao", titulo: "Total por região", tipo: "barras", formato: "kz", horizontal: true, categorias: [...REGIOES], series: [{ nome: "Total", valores: reg.map(Number) }] } as ReportChart],
      avisos: rows.length === 0 ? ["Sem medições com estes filtros."] : [],
    };
  }

  async function resumoMes(user: AuthUser, f: Filters) {
    const maps = await app.prisma.generatorMonthlyMap.findMany({ where: mapWhere(user, f), include: { indicators: true } });
    if (!maps.length) return { secoes: [], graficos: [], avisos: ["Não existe mapa para este provider e mês."] };
    const summaries = await Promise.all(maps.map((m) => computeMonthSummary(app.prisma, m)));
    const avisos = summaries.some((x) => x.ivaEmFalta) ? ["A tabela de preços não tem IVA: assumido 0."] : [];
    // Soma das linhas dos mapas (várias equipas do mesmo provider)
    const keyOf = (l: { categoria: string; zona: string }) => `${l.categoria}|${l.zona}`;
    const acc = new Map<string, { categoria: string; zona: string; facturado: bigint; validado: bigint; diferenca: bigint; iva: bigint; totalComIva: bigint }>();
    for (const sm of summaries) {
      for (const l of sm.linhas) {
        const cur = acc.get(keyOf(l)) ?? { categoria: l.categoria, zona: l.zona, facturado: ZERO, validado: ZERO, diferenca: ZERO, iva: ZERO, totalComIva: ZERO };
        cur.facturado += l.facturado;
        cur.validado += l.validado;
        cur.diferenca += l.diferenca;
        cur.iva += l.iva;
        cur.totalComIva += l.totalComIva;
        acc.set(keyOf(l), cur);
      }
    }
    const linhas = Array.from(acc.values());
    const secao = withTotals(
      {
        titulo: `Mapa de facturação (IVA ${summaries[0].ivaPercent ? `${formatDecimal(summaries[0].ivaPercent, 0)}%` : "—"})`,
        colunas: [
          { key: "categoria", label: "Categoria", tipo: "texto" },
          { key: "facturado", label: "Facturado", tipo: "kz", soma: true },
          { key: "validado", label: "Validado", tipo: "kz", soma: true },
          { key: "diferenca", label: "Diferença", tipo: "kz", soma: true },
          { key: "iva", label: "IVA", tipo: "kz", soma: true },
          { key: "total", label: "Total + IVA", tipo: "kz", soma: true },
        ],
        linhas: linhas.map((l) => ({ categoria: `${l.categoria} · ${l.zona}`, facturado: s(l.facturado), validado: s(l.validado), diferenca: s(l.diferenca), iva: s(l.iva), total: s(l.totalComIva) })),
      },
      "Total a pagar",
    );
    const cats = ["Aluguer", "Combustível", "Serviço de Abastecimento"];
    const val = (c: string, z: string) => Number(acc.get(`${c}|${z}`)?.validado ?? ZERO);
    return {
      secoes: [secao],
      graficos: [
        { id: "zonas", titulo: "Validado por categoria e zona", tipo: "barras", formato: "kz", categorias: cats, series: [{ nome: "Província", valores: cats.map((c) => val(c, "Província")) }, { nome: "Luanda", valores: cats.map((c) => val(c, "Luanda")) }] } as ReportChart,
      ],
      avisos,
    };
  }

  async function validacoes(user: AuthUser, f: Filters, providerName: string) {
    const v = await computeValidations(app.prisma, user, { ano: f.ano, providerId: f.providerId, teamId: f.teamId });
    type M = Extract<(typeof v.meses)[number], { temMapa: true }>;
    const meses = v.meses;
    const potencias = Array.from(new Set(meses.flatMap((m) => (m.temMapa ? Object.keys(m.parquePorPotencia) : [])))).sort((a, b) => Number(a) - Number(b));
    type RowDef = { label: string; tipo: "kz" | "int" | "decimal" | "pct"; get(m: M): ReportCell; soma?: boolean; manual?: boolean };
    const defs: RowDef[] = [
      { label: "Geradores penalizados por SLA", tipo: "int", get: (m) => m.penSLA.n, soma: true },
      { label: "Valor das penalizações por SLA", tipo: "kz", get: (m) => s(m.penSLA.valor), soma: true },
      { label: "Penalizações por falta de combustível", tipo: "int", get: (m) => m.penNivelCombust.n, soma: true },
      { label: "Valor das penalizações por falta de combustível", tipo: "kz", get: (m) => s(m.penNivelCombust.valor), soma: true },
      { label: "Geradores 35040 ≤ h < 36480 (40%)", tipo: "int", get: (m) => m.penHoras["40"].n },
      { label: "Valor penalizações horas 40%", tipo: "kz", get: (m) => s(m.penHoras["40"].valor), soma: true },
      { label: "Geradores 36480 ≤ h < 37920 (60%)", tipo: "int", get: (m) => m.penHoras["60"].n },
      { label: "Valor penalizações horas 60%", tipo: "kz", get: (m) => s(m.penHoras["60"].valor), soma: true },
      { label: "Geradores h ≥ 37920 (100%)", tipo: "int", get: (m) => m.penHoras["100"].n },
      { label: "Valor penalizações horas 100%", tipo: "kz", get: (m) => s(m.penHoras["100"].valor), soma: true },
      { label: "Penalizações por avaria (valor)", tipo: "kz", get: (m) => s(m.penAvaria.valor), soma: true },
      { label: "Valor global das penalizações", tipo: "kz", get: (m) => s(m.penalizacoesGlobal), soma: true },
      { label: "Sites ligados à rede pública", tipo: "int", get: (m) => m.indicadores?.sitesRedePublica ?? null, manual: true },
      { label: "Sites configurados no NetEco", tipo: "int", get: (m) => m.indicadores?.sitesRedeConfiguradosNetEco ?? null, manual: true },
      { label: "Sites sem poupança garantida", tipo: "int", get: (m) => m.indicadores?.sitesRedeSemGarantia ?? null, manual: true },
      { label: "Poupança (saving)", tipo: "kz", get: (m) => s(m.indicadores?.poupancaCent ?? null), soma: true, manual: true },
      { label: "Sub-total (penalizações + poupança)", tipo: "kz", get: (m) => s(m.subtotalPenalizacoesPoupanca), soma: true },
      { label: "Parque de geradores", tipo: "int", get: (m) => m.parqueTotal },
      ...potencias.map<RowDef>((p) => ({ label: `Parque — ${p} kVA`, tipo: "int", get: (m) => m.parquePorPotencia[p] ?? 0 })),
      { label: "Target — aluguer e manutenção", tipo: "kz", get: (m) => s(m.targets.providerAluguerManut.target), soma: true },
      { label: "Aluguer e manutenção", tipo: "kz", get: (m) => s(m.aluguerManutCent), soma: true },
      { label: "Desvio ao target (%)", tipo: "pct", get: (m) => m.targets.providerAluguerManut.desvioPercent },
      { label: "Variação aluguer e manutenção (%)", tipo: "pct", get: (m) => m.variacaoAluguerManut.percent },
      { label: "Litros abastecidos", tipo: "decimal", get: (m) => m.litros, soma: true },
      { label: "Combustível", tipo: "kz", get: (m) => s(m.combustivelCent), soma: true },
      { label: "Serviço de abastecimento", tipo: "kz", get: (m) => s(m.servAbastCent), soma: true },
      { label: "Target — combustível e serviço", tipo: "kz", get: (m) => s(m.targets.providerAbastecimento.target), soma: true },
      { label: "Abastecimento", tipo: "kz", get: (m) => s(m.abastecimentoCent), soma: true },
      { label: "Desvio ao target (%)", tipo: "pct", get: (m) => m.targets.providerAbastecimento.desvioPercent },
      { label: "Total parcial", tipo: "kz", get: (m) => s(m.totalParcialCent), soma: true },
      { label: "Transporte extra de combustível", tipo: "kz", get: (m) => s(m.transporteExtraCent), soma: true, manual: true },
      { label: "Total global", tipo: "kz", get: (m) => s(m.totalGlobalCent), soma: true },
      { label: "Variação percentual", tipo: "pct", get: (m) => m.variacaoTotalGlobal.percent },
    ];
    // Uma linha por indicador; uma coluna por mês (tipo misto → colunas "texto" com valores já formatados não servem para o Excel,
    // por isso cada linha leva o seu tipo em "_tipo" e as colunas dos meses usam o tipo da linha).
    const linhas = defs.map((d) => {
      const row: Record<string, ReportCell> = { indicador: d.label, _tipo: d.tipo };
      let total: bigint | number | null = null;
      for (const m of meses) {
        const val = m.temMapa ? d.get(m as M) : d.manual && m.indicadores ? d.get({ indicadores: m.indicadores } as M) : null;
        row[`m${m.mes}`] = val;
        if (d.soma && val !== null) {
          if (d.tipo === "decimal") total = Number(total ?? 0) + Number(val);
          else total = BigInt(total ?? 0) + BigInt(val);
        }
      }
      row.total = total === null ? null : d.tipo === "decimal" ? Number(total).toFixed(2) : total.toString();
      return row;
    });
    const secao: ReportSection = {
      titulo: `${providerName} — ${f.ano}`,
      colunas: [{ key: "indicador", label: "Indicador", tipo: "texto" }, ...MONTHS.map((m, i) => ({ key: `m${i + 1}`, label: m, tipo: "kz" as const })), { key: "total", label: "Total", tipo: "kz" }],
      linhas,
      tipoPorLinha: true,
    };
    const serie = (k: "aluguerManutCent" | "abastecimentoCent") => meses.map((m) => (m.temMapa ? Number((m as M)[k]) : null));
    return {
      secoes: [secao],
      graficos: [
        { id: "evolucao", titulo: "Evolução mensal", tipo: "linhas", formato: "kz", categorias: MONTHS, series: [{ nome: "Aluguer e manutenção", valores: serie("aluguerManutCent") }, { nome: "Abastecimento", valores: serie("abastecimentoCent") }] } as ReportChart,
      ],
    };
  }

  async function penalizacoes(user: AuthUser, f: Filters) {
    const rows = await app.prisma.generatorMeasurement.findMany({
      where: {
        map: mapWhere(user, f),
        site: siteWhere(f),
        OR: [{ penSLACent: { gt: 0 } }, { penNivelCombustCent: { gt: 0 } }, { penAvariaCent: { gt: 0 } }, { penExcessoHorasCent: { gt: 0 } }],
      },
      include: { site: true, generator: { select: { numeroSerie: true } }, map: { select: { mes: true, provider: { select: { nome: true } } } } },
      orderBy: [{ map: { mes: "asc" } }, { site: { nome: "asc" } }],
    });
    const tipos = [
      { key: "penSLACent", label: "SLA" },
      { key: "penNivelCombustCent", label: "Falta de combustível" },
      { key: "penAvariaCent", label: "Avaria" },
      { key: "penExcessoHorasCent", label: "Excesso de horas" },
    ] as const;
    const resumo = withTotals({
      titulo: "Resumo por tipo",
      colunas: [
        { key: "tipo", label: "Tipo de penalização", tipo: "texto" },
        { key: "n", label: "Quantidade", tipo: "int", soma: true },
        { key: "valor", label: "Valor", tipo: "kz", soma: true },
      ],
      linhas: tipos.map((t) => {
        const list = rows.filter((r) => (r[t.key] ?? ZERO) > ZERO);
        return { tipo: t.label, n: list.length, valor: s(list.reduce((a, r) => a + (r[t.key] ?? ZERO), ZERO)) };
      }),
    });
    const detalhe = withTotals({
      titulo: "Medições com penalizações",
      colunas: [
        { key: "mes", label: "Mês", tipo: "texto" },
        { key: "provider", label: "Parceiro", tipo: "texto" },
        { key: "site", label: "Site", tipo: "texto" },
        { key: "pp", label: "Código P.P.", tipo: "texto" },
        { key: "provincia", label: "Província", tipo: "texto" },
        { key: "serie", label: "Nº série", tipo: "texto" },
        ...tipos.map((t) => ({ key: t.key, label: t.label, tipo: "kz" as const, soma: true })),
        { key: "total", label: "Total", tipo: "kz", soma: true },
      ],
      linhas: rows.map((r) => ({
        mes: MONTHS[r.map.mes - 1],
        provider: r.map.provider.nome,
        site: r.site.nome,
        pp: r.site.codigoPP,
        provincia: r.site.provincia,
        serie: r.generator.numeroSerie,
        ...Object.fromEntries(tipos.map((t) => [t.key, s(r[t.key])])),
        total: s(tipos.reduce((a, t) => a + (r[t.key] ?? ZERO), ZERO)),
      })),
    });
    return {
      secoes: [resumo, detalhe],
      graficos: [{ id: "tipos", titulo: "Valor por tipo de penalização", tipo: "barras", formato: "kz", categorias: tipos.map((t) => t.label), series: [{ nome: "Valor", valores: resumo.linhas.map((l) => Number(l.valor)) }] } as ReportChart],
      avisos: rows.length === 0 ? ["Sem penalizações registadas com estes filtros."] : [],
    };
  }

  async function consumoRegiao(user: AuthUser, f: Filters) {
    const maps = await app.prisma.generatorMonthlyMap.findMany({ where: mapWhere(user, f), select: { id: true } });
    const ids = maps.map((m) => m.id);
    type Row = { regiao: string; provincia: string; litros: Prisma.Decimal | null; comb: bigint; serv: bigint; n: bigint };
    const rows = ids.length
      ? await app.prisma.$queryRaw<Row[]>`
          SELECT s.regiao, s.provincia, SUM(m.litros) AS litros, SUM(m."combustivelCent")::bigint AS comb, SUM(m."servAbastCent")::bigint AS serv, COUNT(*) AS n
          FROM "GeneratorMeasurement" m JOIN "Site" s ON s.id = m."siteId"
          WHERE m."mapId" IN (${Prisma.join(ids)}) ${f.regiao ? Prisma.sql`AND s.regiao = ${f.regiao}` : Prisma.empty}
          GROUP BY s.regiao, s.provincia ORDER BY s.regiao, s.provincia`
      : [];
    const lit = (r: Row) => (r.litros === null ? "0.00" : new Prisma.Decimal(r.litros).toFixed(2));
    const porRegiao = withTotals({
      titulo: "Por região",
      colunas: [
        { key: "regiao", label: "Região", tipo: "texto" },
        { key: "medicoes", label: "Medições", tipo: "int", soma: true },
        { key: "litros", label: "Litros", tipo: "decimal", soma: true },
        { key: "comb", label: "Combustível", tipo: "kz", soma: true },
        { key: "serv", label: "Serv. abastecimento", tipo: "kz", soma: true },
        { key: "abast", label: "Abastecimento", tipo: "kz", soma: true },
      ],
      linhas: REGIOES.filter((r) => !f.regiao || r === f.regiao).map((reg) => {
        const list = rows.filter((r) => r.regiao === reg);
        const litros = list.reduce((a, r) => a + Math.round(Number(lit(r)) * 100), 0) / 100;
        const comb = list.reduce((a, r) => a + r.comb, ZERO);
        const serv = list.reduce((a, r) => a + r.serv, ZERO);
        return { regiao: reg, medicoes: list.reduce((a, r) => a + Number(r.n), 0), litros: litros.toFixed(2), comb: s(comb), serv: s(serv), abast: s(comb + serv) };
      }),
    });
    const porProvincia = withTotals({
      titulo: "Por província",
      colunas: [
        { key: "regiao", label: "Região", tipo: "texto" },
        { key: "provincia", label: "Província", tipo: "texto" },
        { key: "medicoes", label: "Medições", tipo: "int", soma: true },
        { key: "litros", label: "Litros", tipo: "decimal", soma: true },
        { key: "abast", label: "Abastecimento", tipo: "kz", soma: true },
      ],
      linhas: rows.map((r) => ({ regiao: r.regiao, provincia: r.provincia, medicoes: Number(r.n), litros: lit(r), abast: s(r.comb + r.serv) })),
    });
    return {
      secoes: [porRegiao, porProvincia],
      graficos: [{ id: "litros", titulo: "Litros por região", tipo: "barras", formato: "decimal", horizontal: true, categorias: porRegiao.linhas.map((l) => String(l.regiao)), series: [{ nome: "Litros", valores: porRegiao.linhas.map((l) => Number(l.litros)) }] } as ReportChart],
      avisos: rows.length === 0 ? ["Sem medições com estes filtros."] : [],
    };
  }
};

export default reportsRoutes;

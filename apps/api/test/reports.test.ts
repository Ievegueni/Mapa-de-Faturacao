import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

const ANO = 2029;

describe.skipIf(!TEST_DB)("relatórios", () => {
  const { app, prisma } = createTestApp();
  let provider: string;
  let pTeam: string;
  let gestor: string;
  let supervisor: string;
  let supId: string;
  let tecnico: string;

  const data = (token: string, qs: string) => app.inject({ method: "GET", url: `/api/reports/data?ano=${ANO}&${qs}`, headers: bearer(token) });
  const log = (token: string, body: object) => app.inject({ method: "POST", url: "/api/reports/log", headers: bearer(token), payload: body });

  beforeAll(async () => {
    await app.ready();
    const gTeam = (await prisma.team.create({ data: { nome: "Rel Geradores", tipo: "GERADORES" } })).id;
    pTeam = (await prisma.team.create({ data: { nome: "Rel Providers", tipo: "PROVIDERS" } })).id;
    provider = (await prisma.provider.create({ data: { nome: "Rel Prov", tipos: ["GERADORES", "PROVIDERS"] } })).id;
    await prisma.providerBudget.create({ data: { providerId: provider, teamId: null, ano: ANO, orcamentoMensalCent: BigInt(100000000) } });
    await prisma.priceTable.create({ data: { providerId: provider, validFrom: new Date(`${ANO}-01-01`), precoCombustivelCent: BigInt(42000), precoServAbastCent: BigInt(4800), ivaPercent: "14" } });
    const g = await createUser(prisma, { email: "g@rel.ao", role: "GESTOR" });
    supId = (await createUser(prisma, { email: "s@rel.ao", role: "SUPERVISOR", teamIds: [gTeam, pTeam] })).id;
    await createUser(prisma, { email: "t@rel.ao", role: "TECNICO", teamIds: [gTeam] });
    gestor = (await login(app, "g@rel.ao")).token;
    supervisor = (await login(app, "s@rel.ao")).token;
    tecnico = (await login(app, "t@rel.ao")).token;

    await prisma.providerInvoice.createMany({
      data: [
        { teamId: pTeam, providerId: provider, ano: ANO, mes: 7, tipo: "Manutenção", valorFTCent: BigInt(66000000), valorPagoCent: BigInt(66000000), createdById: g.id, state: "VALIDADO", status: "FECHADO" },
        { teamId: pTeam, providerId: provider, ano: ANO, mes: 8, tipo: "Manutenção", valorFTCent: BigInt(58854942), valorPagoCent: BigInt(0), createdById: g.id, state: "VALIDADO" },
      ],
    });
    const site1 = await prisma.site.create({ data: { teamId: gTeam, nome: "Rel Site L", regiao: "Norte", provincia: "Luanda" } });
    const site2 = await prisma.site.create({ data: { teamId: gTeam, nome: "Rel Site H", regiao: "Sul", provincia: "Huíla" } });
    const g1 = await prisma.generator.create({ data: { siteId: site1.id, providerId: provider, numeroSerie: "REL-1", potenciaKVA: 20 } });
    const g2 = await prisma.generator.create({ data: { siteId: site2.id, providerId: provider, numeroSerie: "REL-2", potenciaKVA: 15 } });
    const map = (await app.inject({ method: "POST", url: "/api/generators/maps", headers: bearer(supervisor), payload: { teamId: gTeam, providerId: provider, ano: ANO, mes: 8 } })).json();
    for (const [gen, litros, pen] of [[g1.id, "100", "50000"], [g2.id, "200.5", ""]]) {
      await app.inject({ method: "POST", url: `/api/generators/maps/${map.id}/measurements`, headers: bearer(supervisor), payload: { generatorId: gen, dias: 31, horasN1: "0", horasN: "310", litros, penSLACent: pen } });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("providers: resumo anual, por provider e pagamentos/dívida", async () => {
    // Filtra pela equipa: sem filtro, o orçamento soma por todas as equipas PROVIDERS (outros ficheiros de teste criam-nas).
    const r = (await data(gestor, `tipo=PROVIDERS&modelo=resumo_anual&teamId=${pTeam}`)).json();
    expect(r.titulo).toBe("Resumo anual");
    const mensal = r.secoes[0];
    expect(mensal.linhas[6][provider]).toBe("66000000");
    expect(mensal.linhas[7][provider]).toBe("58854942");
    expect(mensal.totais.total).toBe(mensal.linhas.reduce((a: bigint, l: { total: string }) => a + BigInt(l.total), BigInt(0)).toString());
    const exec = r.secoes[1].linhas.find((l: { parceiro: string }) => l.parceiro === "Rel Prov");
    expect(exec).toMatchObject({ orcAnual: "1200000000", facturado: "124854942", divida: "58854942", remanescente: "1075145058" });
    expect(r.graficos[0].tipo).toBe("barras_empilhadas");

    expect((await data(gestor, "tipo=PROVIDERS&modelo=por_provider")).statusCode).toBe(400); // provider obrigatório
    const p = (await data(gestor, `tipo=PROVIDERS&modelo=por_provider&providerId=${provider}`)).json();
    expect(p.secoes[0].linhas).toHaveLength(2);
    expect(p.secoes[0].totais).toMatchObject({ ft: "124854942", pago: "66000000", divida: "58854942" });

    const d = (await data(gestor, "tipo=PROVIDERS&modelo=pagamentos_divida")).json();
    expect(d.secoes[1].linhas.filter((l: { parceiro: string }) => l.parceiro === "Rel Prov")).toHaveLength(1);
  });

  it("geradores: auto de medição, resumo do mês, validações, penalizações e consumo por região", async () => {
    const a = (await data(supervisor, "tipo=GERADORES&modelo=auto_medicao&mes=8")).json();
    expect(a.secoes[0].linhas).toHaveLength(2);
    expect(a.secoes[0].totais.litros).toBe("300.50");
    expect((await data(supervisor, "tipo=GERADORES&modelo=auto_medicao&mes=8&regiao=Sul")).json().secoes[0].linhas).toHaveLength(1);
    expect((await data(supervisor, "tipo=GERADORES&modelo=auto_medicao")).statusCode).toBe(400); // mês obrigatório

    const rm = (await data(supervisor, `tipo=GERADORES&modelo=resumo_mes&mes=8&providerId=${provider}`)).json();
    expect(rm.secoes[0].linhas).toHaveLength(6);
    expect(rm.secoes[0].totais.categoria).toBe("Total a pagar");

    const v = (await data(supervisor, `tipo=GERADORES&modelo=validacoes_anual&providerId=${provider}`)).json();
    expect(v.secoes[0].tipoPorLinha).toBe(true);
    const parque = v.secoes[0].linhas.find((l: { indicador: string }) => l.indicador === "Parque de geradores");
    expect(parque.m8).toBe(2);
    const litros = v.secoes[0].linhas.find((l: { indicador: string }) => l.indicador === "Litros abastecidos");
    expect(litros.total).toBe("300.50");

    const pen = (await data(supervisor, "tipo=GERADORES&modelo=penalizacoes")).json();
    expect(pen.secoes[0].linhas.find((l: { tipo: string }) => l.tipo === "SLA")).toEqual({ tipo: "SLA", n: 1, valor: "50000" });
    expect(pen.secoes[1].linhas).toHaveLength(1);

    const c = (await data(supervisor, "tipo=GERADORES&modelo=consumo_regiao")).json();
    expect(c.secoes[0].linhas.find((l: { regiao: string }) => l.regiao === "Sul").litros).toBe("200.50");
    expect(c.secoes[0].totais.litros).toBe("300.50");
  });

  it("permissões: Técnico sem relatórios; exportação exige reports.export e billing_*.export; regista na auditoria", async () => {
    expect((await data(tecnico, "tipo=GERADORES&modelo=auto_medicao&mes=8")).statusCode).toBe(403);
    expect((await log(tecnico, { tipo: "GERADORES", modelo: "auto_medicao", formato: "pdf" })).statusCode).toBe(403);

    expect((await log(supervisor, { tipo: "PROVIDERS", modelo: "resumo_anual", formato: "pdf", filtros: { Ano: String(ANO) } })).statusCode).toBe(200);
    // Override "negar export" de facturação de providers: bloqueia a exportação desse tipo
    await prisma.userPermission.create({ data: { userId: supId, module: "billing_providers", action: "export", allowed: false } });
    expect((await log(supervisor, { tipo: "PROVIDERS", modelo: "resumo_anual", formato: "xlsx" })).statusCode).toBe(403);
    expect((await log(supervisor, { tipo: "GERADORES", modelo: "auto_medicao", formato: "xlsx" })).statusCode).toBe(200);
    expect((await log(gestor, { tipo: "PROVIDERS", modelo: "resumo_anual", formato: "csv" })).statusCode).toBe(400);
    const audits = await prisma.auditLog.findMany({ where: { entity: "Report", userId: supId } });
    expect(audits.map((x) => x.action).sort()).toEqual(["export_pdf", "export_xlsx"]);
  });
});

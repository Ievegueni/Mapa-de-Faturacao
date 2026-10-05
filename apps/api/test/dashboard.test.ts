import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

const ANO = 2028;
const N = 1200; // ~ parque real (1.161 geradores)

describe.skipIf(!TEST_DB)("dashboard", () => {
  const { app, prisma } = createTestApp();
  let team: string;
  let provider: string; // Combustível e Geradores
  let resProvider: string; // Rede Residencial
  let gestor: string;
  let supervisor: string;
  let tecnico: string;

  const get = (token: string, qs: string) => app.inject({ method: "GET", url: `/api/dashboard?${qs}`, headers: bearer(token) });

  beforeAll(async () => {
    await app.ready();
    team = (await prisma.team.create({ data: { nome: "Dash Geradores", tipo: "GERADORES" } })).id;
    const provTeam = (await prisma.team.create({ data: { nome: "Dash Providers", tipo: "PROVIDERS" } })).id;
    provider = (await prisma.provider.create({ data: { nome: "Dash Prov", tipo: "GERADORES" } })).id;
    resProvider = (await prisma.provider.create({ data: { nome: "Dash Prov", tipo: "PROVIDERS" } })).id;
    await prisma.priceTable.create({ data: { providerId: provider, validFrom: new Date(`${ANO}-01-01`), precoCombustivelCent: BigInt(42000), precoServAbastCent: BigInt(4800), ivaPercent: "14" } });
    await prisma.providerBudget.create({ data: { providerId: resProvider, teamId: null, ano: ANO, po: "PO-DASH", orcamentoMensalCent: BigInt(295000000) } });
    await prisma.target.create({ data: { ano: ANO, mes: 12, providerId: provider, aluguerCent: BigInt(1000000000), combustivelCent: BigInt(500000000) } });

    // 1.200 sites/geradores e 12 mapas mensais com 1.200 medições cada (14.400 linhas)
    const regioes = ["Norte", "Centro", "Sul", "Leste"];
    const sites = await prisma.site.createManyAndReturn({
      data: Array.from({ length: N }, (_, i) => ({ teamId: team, nome: `Dash Site ${i}`, codigoPP: `DS-${i}`, regiao: regioes[i % 4], provincia: i % 7 === 0 ? "Luanda" : "Huíla" })),
      select: { id: true },
    });
    const gens = await prisma.generator.createManyAndReturn({
      data: sites.map((s, i) => ({ siteId: s.id, providerId: provider, numeroSerie: `DASH-${i}`, potenciaKVA: i % 2 ? 15 : 20 })),
      select: { id: true, siteId: true },
    });
    const creator = await createUser(prisma, { email: "g@dash.ao", role: "GESTOR" });
    for (let mes = 1; mes <= 12; mes++) {
      const map = await prisma.generatorMonthlyMap.create({ data: { teamId: team, providerId: provider, ano: ANO, mes, state: mes < 12 ? "FECHADO" : "RASCUNHO" } });
      await prisma.generatorMeasurement.createMany({
        data: gens.map((g, i) => ({
          mapId: map.id, siteId: g.siteId, generatorId: g.id, createdById: creator.id, dias: 31,
          litros: String(100 + (i % 50)), combustivelCent: BigInt(4200000), servAbastCent: BigInt(480000), abastecimentoCent: BigInt(4680000),
          aluguerCent: BigInt(1000000), descontoRedeCent: BigInt(0), totalCent: BigInt(5680000),
          flags: i % 100 === 0 ? ["SEM_PRECO_ALUGUER"] : [], penSLACent: i === 5 ? BigInt(100000) : null,
        })),
      });
    }
    await prisma.providerInvoice.create({
      data: { teamId: provTeam, providerId: resProvider, ano: ANO, mes: 3, tipo: "Manutenção", valorFTCent: BigInt(66000000), valorPagoCent: BigInt(10000000), createdById: creator.id, state: "SUBMETIDO" },
    });
    await createUser(prisma, { email: "s@dash.ao", role: "SUPERVISOR", teamIds: [team] });
    await createUser(prisma, { email: "t@dash.ao", role: "TECNICO", teamIds: [team] });
    gestor = (await login(app, "g@dash.ao")).token;
    supervisor = (await login(app, "s@dash.ao")).token;
    tecnico = (await login(app, "t@dash.ao")).token;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it("geradores: carrega em menos de 2 s com 12 meses de dados (14.400 medições)", async () => {
    await get(gestor, `tipo=GERADORES&ano=${ANO}&teamId=${team}`); // aquecer ligações
    const t0 = Date.now();
    const res = await get(gestor, `tipo=GERADORES&ano=${ANO}&teamId=${team}`);
    const ms = Date.now() - t0;
    console.log(`Dashboard geradores: ${ms} ms`);
    expect(res.statusCode).toBe(200);
    expect(ms).toBeLessThan(2000);
    const d = res.json().geradores;
    expect(d.mes).toBe(12);
    expect(d.mesesComDados).toHaveLength(12);
    expect(d.kpis).toMatchObject({ geradores: N, total: String(5680000 * N), litros: "149400.00", penalizacoes: "100000", mapas: 1, porValidar: 1 });
    expect(d.evolucao.filter((e: { total: string | null }) => e.total !== null)).toHaveLength(12);
    expect(d.regioes.map((r: { regiao: string }) => r.regiao).sort()).toEqual(["Centro", "Leste", "Norte", "Sul"]);
    expect(d.potencias).toEqual([{ potencia: "15", geradores: 600 }, { potencia: "20", geradores: 600 }]);
    expect(d.topSites).toHaveLength(10);
    expect(d.flags).toEqual([{ flag: "SEM_PRECO_ALUGUER", n: 12 }]);
    expect(d.comparacao.providers[0].aluguerManut).toMatchObject({ valor: String(1000000 * N), target: "1000000000", percent: 120 });
    expect(d.comparacao.global.aluguerManut.target).toBeNull();
    expect(d.avisos).toEqual(expect.arrayContaining(["Dash Prov: preços em falta (aluguer)", "Sem target global para o mês"]));
  });

  it("mês escolhido e filtro por provider", async () => {
    const d = (await get(gestor, `tipo=GERADORES&ano=${ANO}&mes=3&providerId=${provider}`)).json().geradores;
    expect(d.mes).toBe(3);
    expect(d.kpis.geradores).toBe(N);
    expect(d.avisos).toEqual(expect.arrayContaining(["Dash Prov: sem target para o mês"]));
  });

  it("providers: KPIs, consumo do orçamento, gráfico mensal e facturas pendentes", async () => {
    const res = await get(gestor, `tipo=PROVIDERS&ano=${ANO}&providerId=${resProvider}`);
    expect(res.statusCode).toBe(200);
    const p = res.json().providers;
    expect(p.kpis.facturado).toBe("66000000");
    expect(p.kpis.divida).toBe("56000000");
    expect(p.porProvider[0]).toMatchObject({ nome: "Dash Prov", facturado: "66000000" });
    expect(p.mensal[2].total).toBe("66000000");
    expect(p.pendentes[0]).toMatchObject({ provider: "Dash Prov", dividaCent: "56000000", state: "SUBMETIDO" });
  });

  it("âmbito e perfis: tipos permitidos, Técnico simplificado, filtro de equipa só para o Gestor", async () => {
    const sup = (await get(supervisor, `ano=${ANO}`)).json();
    expect(sup.tipos).toEqual(["GERADORES"]);
    expect(sup.tipo).toBe("GERADORES");
    expect((await get(supervisor, `tipo=PROVIDERS&ano=${ANO}`)).statusCode).toBe(403);
    expect((await get(supervisor, `tipo=GERADORES&ano=${ANO}&teamId=${team}`)).statusCode).toBe(400);
    const tec = (await get(tecnico, `tipo=GERADORES&ano=${ANO}`)).json();
    expect(tec.simplificado).toBe(true);
    expect(tec.geradores.kpis.geradores).toBe(N);
    expect(tec.geradores.evolucao).toEqual([]);
    expect(tec.geradores.topSites).toEqual([]);
    expect(tec.geradores.flags.length).toBe(1);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

describe.skipIf(!TEST_DB)("resumo do mês e Mapa Resumo de Validações", () => {
  const { app, prisma } = createTestApp();
  let team: string;
  let provider: string;
  let other: string;
  let supervisor: string;
  let tecnico: string;
  let mapId: string;
  const gens: Record<string, string> = {};

  const req = (method: "GET" | "POST" | "PUT", token: string, url: string, payload?: object) =>
    app.inject({ method, url: `/api${url}`, headers: bearer(token), payload });

  beforeAll(async () => {
    await app.ready();
    team = (await prisma.team.create({ data: { nome: "Geradores Resumo", tipo: "GERADORES" } })).id;
    provider = (await prisma.provider.create({ data: { nome: "Prov Resumo", tipos: ["GERADORES"] } })).id;
    other = (await prisma.provider.create({ data: { nome: "Outro Resumo", tipos: ["GERADORES"] } })).id;
    for (const p of [provider, other]) {
      const pt = await prisma.priceTable.create({ data: { providerId: p, validFrom: new Date("2026-01-01"), precoCombustivelCent: BigInt(42000), precoServAbastCent: BigInt(4800), precoManutencaoCent: BigInt(10000), ivaPercent: "14" } });
      await prisma.rentPrice.create({ data: { priceTableId: pt.id, potenciaKVA: 20, precoDiaCent: BigInt(1000000) } });
    }
    // Faixas do seed (podem já existir de outros ficheiros de teste)
    if ((await prisma.gridDiscountRule.count({ where: { validFrom: new Date("2026-01-01") } })) === 0) {
      await prisma.gridDiscountRule.createMany({
        data: [
          { horasMin: 0, horasMax: 5, percent: "0", validFrom: new Date("2026-01-01") },
          { horasMin: 6, horasMax: 11, percent: "35", validFrom: new Date("2026-01-01") },
          { horasMin: 12, horasMax: 17, percent: "45", validFrom: new Date("2026-01-01") },
          { horasMin: 18, horasMax: 24, percent: "55", validFrom: new Date("2026-01-01") },
        ],
      });
    }
    await prisma.target.createMany({
      data: [
        { ano: 2027, mes: 8, providerId: provider, aluguerCent: BigInt(50000000), combustivelCent: BigInt(10000000) },
        { ano: 2027, mes: 8, providerId: null, aluguerCent: BigInt(100000000), combustivelCent: null },
      ],
    });
    const luanda = await prisma.site.create({ data: { teamId: team, nome: "Res Luanda", regiao: "Norte", provincia: "Luanda", ligadoRede: true } });
    const huila = await prisma.site.create({ data: { teamId: team, nome: "Res Huíla", regiao: "Sul", provincia: "Huíla", ligadoRede: false } });
    gens.a = (await prisma.generator.create({ data: { siteId: luanda.id, providerId: provider, numeroSerie: "RES-A", potenciaKVA: 20 } })).id;
    gens.b = (await prisma.generator.create({ data: { siteId: huila.id, providerId: provider, numeroSerie: "RES-B", potenciaKVA: 20, dataRemocao: new Date("2027-08-20") } })).id;
    gens.c = (await prisma.generator.create({ data: { siteId: luanda.id, providerId: other, numeroSerie: "RES-C", potenciaKVA: 20 } })).id;
    await createUser(prisma, { email: "g@res.ao", role: "GESTOR" });
    await createUser(prisma, { email: "s@res.ao", role: "SUPERVISOR", teamIds: [team] });
    await createUser(prisma, { email: "t@res.ao", role: "TECNICO", teamIds: [team] });
    supervisor = (await login(app, "s@res.ao")).token;
    tecnico = (await login(app, "t@res.ao")).token;

    mapId = (await req("POST", supervisor, "/generators/maps", { teamId: team, providerId: provider, ano: 2027, mes: 8 })).json().id;
    const julho = (await req("POST", supervisor, "/generators/maps", { teamId: team, providerId: provider, ano: 2027, mes: 7 })).json().id;
    const outro = (await req("POST", supervisor, "/generators/maps", { teamId: team, providerId: other, ano: 2027, mes: 8 })).json().id;
    // A: Luanda, 31 dias, 6 h/dia → 18 h rede → 55%; 100 L; penalização SLA 1.000,00
    await req("POST", supervisor, `/generators/maps/${mapId}/measurements`, { generatorId: gens.a, dias: 31, horasN1: "35000", horasN: "35186", litros: "100", penSLACent: "100000" });
    // B: Huíla, removido; 10 L; excesso de horas 500,00
    await req("POST", supervisor, `/generators/maps/${mapId}/measurements`, { generatorId: gens.b, dias: 31, horasN1: "0", horasN: "744", litros: "10", penExcessoHorasCent: "50000" });
    await req("POST", supervisor, `/generators/maps/${julho}/measurements`, { generatorId: gens.a, dias: 31, horasN1: "34000", horasN: "35000", litros: "50" });
    await req("POST", supervisor, `/generators/maps/${outro}/measurements`, { generatorId: gens.c, dias: 31, horasN1: "0", horasN: "0", litros: "0" });
    // Só a medição A fica validada
    await prisma.generatorMeasurement.updateMany({ where: { mapId, generatorId: gens.a }, data: { state: "VALIDADO" } });
  });

  afterAll(async () => {
    await app.close();
  });

  it("resumo do mês: categorias × zona, validado vs facturado, IVA 14% (sem IVA no combustível)", async () => {
    const r = await req("GET", tecnico, `/generators/summary/${mapId}`);
    expect(r.statusCode).toBe(200);
    const s = r.json();
    const line = (c: string, z: string) => s.linhas.find((l: { categoria: string; zona: string }) => l.categoria === c && l.zona === z);
    // A (Luanda, validada): aluguer 310.000,00 − 55% (170.500,00) + manutenção 100,00 − SLA 1.000,00 = 138.600,00
    expect(line("Aluguer", "Luanda")).toMatchObject({ facturado: "13860000", validado: "13860000", diferenca: "0", iva: "1940400", totalComIva: "15800400" });
    expect(line("Combustível", "Luanda")).toMatchObject({ validado: "4200000", iva: "0", totalComIva: "4200000" });
    expect(line("Serviço de Abastecimento", "Luanda")).toMatchObject({ validado: "480000", iva: "67200" });
    // B (Província, por validar): só facturado
    expect(line("Combustível", "Província")).toMatchObject({ facturado: "420000", validado: "0", diferenca: "420000" });
    expect(s.ivaEmFalta).toBe(false);
    expect(s.sugestoes.sitesRedePublica).toBe(1);
  });

  it("indicadores manuais: só quem valida grava; vazios ficam null", async () => {
    const body = { sitesRedePublica: 690, sitesRedeConfiguradosNetEco: "299", sitesRedeSemGarantia: "", poupancaCent: null, transporteExtraCent: "250000" };
    expect((await req("PUT", tecnico, `/generators/maps/${mapId}/indicators`, body)).statusCode).toBe(403);
    const ok = await req("PUT", supervisor, `/generators/maps/${mapId}/indicators`, body);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ sitesRedePublica: 690, sitesRedeConfiguradosNetEco: 299, sitesRedeSemGarantia: null, poupancaCent: null, transporteExtraCent: "250000" });
  });

  it("factura do provider: a Diferença passa a ser factura − validado", async () => {
    await req("PUT", supervisor, `/generators/maps/${mapId}/indicators`, { sitesRedePublica: 690, transporteExtraCent: "250000", factCombustivelLuandaCent: "5000000" });
    const s = (await req("GET", tecnico, `/generators/summary/${mapId}`)).json();
    const comb = s.linhas.find((l: { categoria: string; zona: string }) => l.categoria === "Combustível" && l.zona === "Luanda");
    expect(comb).toMatchObject({ facturado: "5000000", origemFacturado: "factura", validado: "4200000", diferenca: "800000" });
  });

  it("Mapa Resumo de Validações: penalizações, parque, totais, variações e targets (sem divisões por zero)", async () => {
    const r = await req("GET", tecnico, `/generators/validations?ano=2027&providerId=${provider}`);
    expect(r.statusCode).toBe(200);
    const { meses } = r.json();
    expect(meses).toHaveLength(12);
    expect(meses[0].temMapa).toBe(false);
    const ago = meses[7];
    expect(ago.penSLA).toEqual({ n: 1, valor: "100000" });
    expect(ago.penExcessoHoras).toEqual({ n: 1, valor: "50000" });
    expect(ago.penHoras["40"]).toEqual({ n: 1, valor: "0" }); // A com 35186 h acumuladas
    expect(ago.penalizacoesGlobal).toBe("150000");
    // Parque: B foi removido em Agosto → fora do parque
    expect(ago.parqueTotal).toBe(1);
    expect(ago.parquePorPotencia).toEqual({ "20": 1 });
    // Aluguer e manutenção = (310.000,00 + 310.000,00) − 55% de A − 0% de B (24 h trab.) + 2 × 100,00
    expect(ago.aluguerManutCent).toBe(String(62000000 - 17050000 + 20000));
    expect(ago.litros).toBe("110.00");
    expect(ago.variacaoLitros).toBe("60.00");
    expect(ago.transporteExtraCent).toBe("250000");
    expect(ago.totalGlobalCent).toBe(String(BigInt(ago.totalParcialCent) + BigInt(250000)));
    expect(ago.indicadores.sitesRedePublica).toBe(690);
    // Targets: provider (aluguer 500.000,00) e global (só providers no âmbito: este + outro)
    expect(ago.targets.providerAluguerManut.target).toBe("50000000");
    expect(ago.targets.providerAbastecimento.target).toBe("10000000");
    expect(ago.targets.globalAbastecimento).toMatchObject({ target: null, desvio: null, desvioPercent: null });
    const outroAluguer = 31 * 1000000 - 17050000 + 10000; // C: 0 h trab. → 24 h de rede → 55% de desconto
    expect(ago.targets.globalAluguerManut.valor).toBe(String(BigInt(ago.aluguerManutCent) + BigInt(outroAluguer)));
    const jul = meses[6];
    expect(jul.temMapa).toBe(true);
    expect(jul.variacaoAluguerManut).toEqual({ abs: null, percent: null });
  });

});

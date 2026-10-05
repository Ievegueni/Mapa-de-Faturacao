import ExcelJS from "exceljs";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

const REAL = join(__dirname, "fixtures/auto-medicao-agosto-2026.xlsx");

/** Corpo multipart/form-data com um ficheiro. */
function multipart(buffer: Buffer, filename: string, fields: Record<string, string> = {}) {
  const boundary = "----cf" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`));
  parts.push(buffer, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

/** Excel pequeno com o mesmo cabeçalho do Auto de Medição (colunas fora de ordem de propósito). */
async function smallWorkbook(rows: (string | number | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("AGOSTO_26");
  ws.addRow(["AUTO DE MEDIÇÃO"]);
  ws.addRow([]);
  ws.addRow(["Nº", "Nome Ponto Produção", "Código P.P.", "Região", "Província", "Subtipo", "Distância Facturação", "Nº Série Gerador", "Potência", "Dias", "Proprietário",
    "Horas Gerador (N-1)", "Horas Gerador (N)", "Litros Abastecidos.420", "Ligado à rede", "Data Remoção Gerador", "Penalização SLA"]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe.skipIf(!TEST_DB)("mapas, medições e importação de geradores", () => {
  const { app, prisma } = createTestApp();
  let team: string;
  let teamB: string;
  let provider: string;
  let gestor: string;
  let supervisor: string;
  let tecnico: string;
  let mapId: string;

  const req = (method: "GET" | "POST" | "PATCH" | "DELETE", token: string, url: string, payload?: object) =>
    app.inject({ method, url: `/api${url}`, headers: bearer(token), payload });
  const upload = (token: string, buffer: Buffer, name = "auto.xlsx", fields: Record<string, string> = {}) => {
    const m = multipart(buffer, name, fields);
    return app.inject({ method: "POST", url: `/api/generators/maps/${mapId}/import/preview`, headers: { ...bearer(token), ...m.headers }, payload: m.payload });
  };

  beforeAll(async () => {
    await app.ready();
    team = (await prisma.team.create({ data: { nome: "Geradores Import", tipo: "GERADORES" } })).id;
    teamB = (await prisma.team.create({ data: { nome: "Geradores Outra", tipo: "GERADORES" } })).id;
    provider = (await prisma.provider.create({ data: { nome: "Anglobal Import", tipos: ["GERADORES"] } })).id;
    await prisma.priceTable.create({
      data: { providerId: provider, validFrom: new Date("2026-01-01"), precoCombustivelCent: BigInt(42000), precoServAbastCent: BigInt(4800), ivaPercent: "14" },
    });
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
    await createUser(prisma, { email: "g@map.ao", role: "GESTOR" });
    await createUser(prisma, { email: "s@map.ao", role: "SUPERVISOR", teamIds: [team] });
    await createUser(prisma, { email: "t@map.ao", role: "TECNICO", teamIds: [team] });
    gestor = (await login(app, "g@map.ao")).token;
    supervisor = (await login(app, "s@map.ao")).token;
    tecnico = (await login(app, "t@map.ao")).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("cria o mapa mensal (único por equipa/provider/mês)", async () => {
    const res = await req("POST", tecnico, "/generators/maps", { teamId: team, providerId: provider, ano: 2026, mes: 8 });
    expect(res.statusCode).toBe(201);
    mapId = res.json().id;
    expect((await req("POST", tecnico, "/generators/maps", { teamId: team, providerId: provider, ano: 2026, mes: 8 })).statusCode).toBe(409);
    expect((await req("POST", tecnico, "/generators/maps", { teamId: teamB, providerId: provider, ano: 2026, mes: 8 })).statusCode).toBe(403);
    const map = (await req("GET", tecnico, `/generators/maps/${mapId}`)).json();
    expect(map.priceTable.precoCombustivelCent).toBe("42000");
    expect(map.bands).toHaveLength(4);
  });

  it("importação: pré-visualização sem gravar, erros por linha, confirmação em rascunho", async () => {
    const buf = await smallWorkbook([
      [1, "Site Um", "PP-1", "Norte ", "Zaire", "Standard", "Até 50 km", "SN-1", "20 kVA", 31, "Anglobal Import, S.A.", 1000, 1372, 620.5, "SIM", null, null],
      [2, "Site Dois", "PP-2", "Sul", "Huíla", "Duty Cycle", "Até 50 km", "SN-2", "15", 31, "Anglobal Import, S.A.", 500, 500, 0, "NÃO", "2026-08-15", 10000],
      [3, "Site Dois", "PP-2", "Sul", "Huíla", "Duty Cycle", "Até 50 km", "SN-3", 15, 31, "Anglobal Import, S.A.", 10, 20, 100, "NÃO", null, null],
      [4, "Site Mau", "PP-9", "Oeste", "Luanda", null, null, "SN-4", 20, 31, null, 0, 0, 0, null, null, null],
      [5, "Site Repetido", "PP-5", "Leste", "Moxico", null, null, "SN-1", 20, 31, null, 0, 0, 0, null, null, null],
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ]);
    expect((await upload(tecnico, buf, "auto.xls")).statusCode).toBe(400);
    expect((await upload(tecnico, Buffer.from("not a zip"), "auto.xlsx")).statusCode).toBe(400);

    const res = await upload(tecnico, buf);
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.folha).toBe("AGOSTO_26");
    expect(p.linhaCabecalho).toBe(3);
    expect(p.linhasLidas).toBe(5);
    expect(p.linhasValidas).toBe(3);
    expect(p.sitesNovos).toBe(2); // Site Um + Site Dois (2 geradores no mesmo site)
    expect(p.geradoresNovos).toBe(3);
    expect(p.litrosFicheiro).toBe("720.50");
    expect(p.litrosValidos).toBe("720.50");
    expect(p.erros.map((e: { line: number }) => e.line)).toEqual([7, 8]);
    expect(p.erros[0].message).toContain("Região inválida");
    expect(p.erros[1].message).toContain("repetido");
    expect(p.flags.GERADOR_REMOVIDO).toBe(1);
    expect(p.flags.SEM_PRECO_ALUGUER).toBe(3);
    expect(await prisma.site.count({ where: { teamId: team } })).toBe(0); // nada gravado

    const ok = await req("POST", tecnico, `/generators/maps/${mapId}/import/confirm`, { token: p.token });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ sitesCriados: 2, geradoresCriados: 3, medicoesCriadas: 3 });
    expect((await req("POST", tecnico, `/generators/maps/${mapId}/import/confirm`, { token: p.token })).statusCode).toBe(400);

    const list = (await req("GET", tecnico, `/generators/maps/${mapId}/measurements`)).json();
    expect(list.total).toBe(3);
    expect(list.totals.litros).toBe("720.50");
    const um = list.items.find((m: { generator: { numeroSerie: string } }) => m.generator.numeroSerie === "SN-1");
    expect(um).toMatchObject({ state: "RASCUNHO", horasTrabalhadas: 12, horasRede: 12, descontoPercent: "45", combustivelCent: "26061000", servAbastCent: "2978400" });
    const dois = list.items.find((m: { generator: { numeroSerie: string } }) => m.generator.numeroSerie === "SN-2");
    expect(dois.penSLACent).toBe("1000000"); // 10.000,00 Kz
    const site = await prisma.site.findFirst({ where: { teamId: team, nome: "Site Um" } });
    expect(site).toMatchObject({ regiao: "Norte", ligadoRede: true, subtipo: "Standard" });
  });

  it("reimportar actualiza os rascunhos e mantém valores manuais preenchidos na ferramenta", async () => {
    const m = (await req("GET", supervisor, `/generators/maps/${mapId}/measurements?q=SN-1`)).json().items[0];
    await req("PATCH", supervisor, `/generators/measurements/${m.id}`, { penAvariaCent: "50000" });
    const buf = await smallWorkbook([[1, "Site Um", "PP-1", "Norte", "Zaire", "Standard", "Até 50 km", "SN-1", 20, 31, "Anglobal Import", 1000, 1372, 700, "SIM", null, null]]);
    const p = (await upload(supervisor, buf)).json();
    expect(p.medicoesActualizadas).toBe(1);
    expect(p.sitesNovos).toBe(0);
    await req("POST", supervisor, `/generators/maps/${mapId}/import/confirm`, { token: p.token });
    const after = (await req("GET", supervisor, `/generators/maps/${mapId}/measurements?q=SN-1`)).json().items[0];
    expect(after.litros).toBe("700");
    expect(after.penAvariaCent).toBe("50000");
  });

  it("formulário por site: lista de geradores, horas N do mês anterior e gravação", async () => {
    const gens = (await req("GET", tecnico, `/generators/maps/${mapId}/generators`)).json();
    expect(gens.map((g: { numeroSerie: string }) => g.numeroSerie).sort()).toEqual(["SN-1", "SN-2", "SN-3"]);

    // Mês anterior com horas N para SN-3
    const julho = (await req("POST", gestor, "/generators/maps", { teamId: team, providerId: provider, ano: 2026, mes: 7 })).json();
    const sn3 = gens.find((g: { numeroSerie: string }) => g.numeroSerie === "SN-3");
    await req("POST", gestor, `/generators/maps/${julho.id}/measurements`, { generatorId: sn3.id, dias: 31, horasN1: "0", horasN: "10", litros: "50" });

    const ctx = (await req("GET", tecnico, `/generators/maps/${mapId}/generators/${sn3.id}`)).json();
    expect(ctx.horasNMesAnterior).toBe("10");
    expect(ctx.measurement.generator.numeroSerie).toBe("SN-3");

    const saved = await req("POST", tecnico, `/generators/maps/${mapId}/measurements`, {
      generatorId: sn3.id, dias: 31, horasN1: "10", horasN: "196", litros: "200,5", penSLACent: "", servExtrasCent: null,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ horasTrabalhadas: 6, horasRede: 18, descontoPercent: "55", litros: "200.5", penSLACent: null });
    expect((await req("POST", tecnico, `/generators/maps/${mapId}/measurements`, { generatorId: sn3.id, dias: 40 })).statusCode).toBe(400);
  });

  it("filtros da lista: flag, região, pesquisa e paginação", async () => {
    const removed = (await req("GET", tecnico, `/generators/maps/${mapId}/measurements?flag=GERADOR_REMOVIDO`)).json();
    expect(removed.items.map((m: { generator: { numeroSerie: string } }) => m.generator.numeroSerie)).toEqual(["SN-2"]);
    expect((await req("GET", tecnico, `/generators/maps/${mapId}/measurements?regiao=Norte`)).json().total).toBe(1);
    expect((await req("GET", tecnico, `/generators/maps/${mapId}/measurements?q=PP-2`)).json().total).toBe(2);
    expect((await req("GET", tecnico, `/generators/maps/${mapId}/measurements`)).json().pageSize).toBe(50);
  });

  it("recalcular aplica preços definidos depois (aluguer) às medições não fechadas", async () => {
    const pt = await prisma.priceTable.findFirstOrThrow({ where: { providerId: provider } });
    await prisma.rentPrice.create({ data: { priceTableId: pt.id, potenciaKVA: 20, precoDiaCent: BigInt(1500000) } });
    expect((await req("POST", tecnico, `/generators/maps/${mapId}/recalculate`)).statusCode).toBe(403);
    const r = await req("POST", supervisor, `/generators/maps/${mapId}/recalculate`);
    expect(r.statusCode).toBe(200);
    const sn1 = (await req("GET", supervisor, `/generators/maps/${mapId}/measurements?q=SN-1`)).json().items[0];
    expect(sn1.precoAluguerDiaCent).toBe("1500000");
    expect(sn1.aluguerCent).toBe("46500000");
    expect(sn1.descontoRedeCent).toBe("20925000"); // 45%
    expect(sn1.flags).toEqual([]);
  });

  it("fluxo: submeter, validar, fechar; editar bloqueado; só o Gestor reabre", async () => {
    // O técnico só submete as suas
    const sub = await req("POST", tecnico, `/generators/maps/${mapId}/submit`);
    expect(sub.statusCode).toBe(200);
    const m = (await req("GET", tecnico, `/generators/maps/${mapId}/measurements?q=SN-1`)).json().items[0];
    expect(m.state).toBe("SUBMETIDO");
    expect((await req("PATCH", tecnico, `/generators/measurements/${m.id}`, { litros: "1" })).statusCode).toBe(403);

    expect((await req("POST", supervisor, `/generators/maps/${mapId}/close`)).statusCode).toBe(400);
    await req("POST", supervisor, `/generators/maps/${mapId}/submit`);
    expect((await req("POST", tecnico, `/generators/maps/${mapId}/validate`)).statusCode).toBe(403);
    expect((await req("POST", supervisor, `/generators/maps/${mapId}/validate`)).json().state).toBe("VALIDADO");
    const closed = await req("POST", supervisor, `/generators/maps/${mapId}/close`);
    expect(closed.json().state).toBe("FECHADO");
    expect((await req("PATCH", supervisor, `/generators/measurements/${m.id}`, { litros: "1" })).statusCode).toBe(400);
    expect((await req("POST", supervisor, `/generators/maps/${mapId}/recalculate`)).statusCode).toBe(400);
    expect((await upload(supervisor, await smallWorkbook([]))).statusCode).toBe(400);
    expect((await req("POST", supervisor, `/generators/maps/${mapId}/reopen`)).statusCode).toBe(403);
    expect((await req("POST", gestor, `/generators/maps/${mapId}/reopen`)).json().state).toBe("VALIDADO");
    expect((await req("POST", gestor, `/generators/maps/${mapId}/return`)).json().state).toBe("RASCUNHO");
  });

  it.skipIf(!existsSync(REAL))("Auto de Medição real: 1.161 linhas importadas em menos de 30 s com o total de litros do Excel", async () => {
    const real = (await req("POST", gestor, "/generators/maps", { teamId: team, providerId: provider, ano: 2026, mes: 9 })).json();
    mapId = real.id;
    const t0 = Date.now();
    const prev = await upload(gestor, readFileSync(REAL), "8_VK_Autos_Medicao_AGOSTO_26.xlsx");
    expect(prev.statusCode).toBe(200);
    const p = prev.json();
    expect(p.folha).toBe("AGOSTO_26");
    expect(p.linhasLidas).toBe(1161);
    expect(p.litrosFicheiro).toBe("509812.49");
    // Erros reais do ficheiro: 2 nºs de série repetidos noutros sites
    expect(p.erros.map((e: { message: string }) => e.message.split(" ").slice(0, 5).join(" "))).toEqual(["Nº de série PEE2497016 repetido", "Nº de série PEE2563860 repetido"]);
    expect(p.avisos.filter((a: { message: string }) => a.message.startsWith("Código P.P.")).length).toBe(2);
    const conf = await req("POST", gestor, `/generators/maps/${mapId}/import/confirm`, { token: p.token });
    expect(conf.statusCode).toBe(200);
    const elapsed = Date.now() - t0;
    const c = conf.json();
    console.log(`Importação real: ${elapsed} ms (gravação ${c.duracaoMs} ms)`, c);
    expect(elapsed).toBeLessThan(30000);
    expect(c.medicoesCriadas + c.medicoesActualizadas).toBe(1159);
    const list = (await req("GET", gestor, `/generators/maps/${mapId}/measurements`)).json();
    expect(list.total).toBe(1159);
    // 509.812,49 − (410 + 500) das 2 linhas repetidas ignoradas
    expect(list.totals.litros).toBe("508902.49");
    expect(c.litrosImportados).toBe("508902.49");
  }, 60000);
});

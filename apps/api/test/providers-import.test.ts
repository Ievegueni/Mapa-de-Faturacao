import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importProvidersWorkbook, parseProvidersWorkbook } from "../src/modules/billing-providers/import";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

const FILE = join(__dirname, "fixtures/novo-mapa-facturacao.xlsx");

describe.skipIf(!existsSync(FILE))("leitura do Novo Mapa de Facturação", () => {
  it("lê as facturas mensais por parceiro e a folha PAGAMENTOS", async () => {
    const { invoices, payments } = await parseProvidersWorkbook(readFileSync(FILE));
    expect(invoices.map((i) => [i.parceiro, i.mes, i.valorFTCent.toString(), i.valorPagoCent.toString(), i.po])).toEqual([
      ["ANGLOBAL", 7, "66000000", "66000000", "4500614726"],
      ["ANGLOBAL", 8, "58854942", "58854942", "4500614726"],
    ]);
    const ang = payments.find((p) => p.prestador === "ANGLOBAL")!;
    expect(ang).toMatchObject({ dataFacturacao: "2026-07-01", consumiveis: 10, qtdOTs: 21, ano: 2026, dataExecucao: "2026-02-12", status: "ANDAMENTO" });
  });
});

describe.skipIf(!TEST_DB || !existsSync(FILE))("importação do Novo Mapa de Facturação", () => {
  const { app, prisma } = createTestApp();
  let teamId: string;
  let token: string;

  beforeAll(async () => {
    await app.ready();
    teamId = (await prisma.team.create({ data: { nome: "Providers Migração", tipo: "PROVIDERS" } })).id;
    for (const nome of ["Anglobal", "Blinder", "Comatel"]) {
      const p = await prisma.provider.upsert({ where: { nome_tipo: { nome, tipo: "PROVIDERS" } }, create: { nome, tipo: "PROVIDERS" }, update: {} });
      const exists = await prisma.providerBudget.findFirst({ where: { providerId: p.id, teamId: null, ano: 2026 } });
      if (!exists) await prisma.providerBudget.create({ data: { providerId: p.id, teamId: null, ano: 2026, orcamentoMensalCent: BigInt(295000000) } });
    }
    const g = await createUser(prisma, { email: "g@migr.ao", role: "GESTOR" });
    token = (await login(app, "g@migr.ao")).token;
    const r = await importProvidersWorkbook(prisma, readFileSync(FILE), { teamId, ano: 2026, userId: g.id });
    expect(r).toMatchObject({ criadas: 2, ignoradas: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  it("os totais coincidem com a app actual: Anglobal Julho 660.000,00, Agosto 588.549,42, remanescente 34.151.450,58", async () => {
    const s = (await app.inject({ method: "GET", url: `/api/billing/providers/summary?ano=2026&teamId=${teamId}`, headers: bearer(token) })).json();
    const a = s.providers.find((p: { nome: string }) => p.nome === "Anglobal");
    expect(a.facturadoMes[6]).toBe("66000000");
    expect(a.facturadoMes[7]).toBe("58854942");
    expect(a.facturadoAno).toBe("124854942");
    expect(a.pagoAno).toBe("124854942");
    expect(a.divida).toBe("0");
    expect(a.orcamentoAnual).toBe("3540000000");
    expect(a.remanescente).toBe("3415145058"); // célula J6 do RESUMO: 35.400.000 − 1.248.549,42
    const b = s.providers.find((p: { nome: string }) => p.nome === "Blinder");
    expect(b.remanescente).toBe("3540000000");
  });

  it("detalhes da folha PAGAMENTOS associados à factura de Julho; reimportar não duplica", async () => {
    const list = (await app.inject({ method: "GET", url: `/api/billing/providers/invoices?teamId=${teamId}&mes=7`, headers: bearer(token) })).json();
    expect(list.items[0]).toMatchObject({ po: "4500614726", qtdOTs: 21, consumiveis: 10, dataFacturacao: "2026-07-01", status: "ANDAMENTO", state: "VALIDADO" });
    expect(list.items[0].observacao).toContain("mangas de fusão");
    const g = await prisma.user.findFirstOrThrow({ where: { email: "g@migr.ao" } });
    const again = await importProvidersWorkbook(prisma, readFileSync(FILE), { teamId, ano: 2026, userId: g.id });
    expect(again).toMatchObject({ criadas: 0, ignoradas: 2 });
  });
});

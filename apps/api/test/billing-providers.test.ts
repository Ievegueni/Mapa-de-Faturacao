import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

describe.skipIf(!TEST_DB)("facturação de providers", () => {
  const { app, prisma } = createTestApp();
  let teamA: string;
  let teamB: string;
  let anglobal: string;
  let blinder: string;
  let gestor: string;
  let supervisor: string;
  let tecnico: string;
  let tecnico2: string;

  const post = (token: string, url: string, payload?: object) => app.inject({ method: "POST", url, headers: bearer(token), payload });
  const patch = (token: string, url: string, payload: object) => app.inject({ method: "PATCH", url, headers: bearer(token), payload });
  const get = (token: string, url: string) => app.inject({ method: "GET", url, headers: bearer(token) });
  const base = "/api/billing/providers/invoices";

  const invoice = (over: object = {}) => ({
    teamId: teamA,
    providerId: anglobal,
    ano: 2026,
    mes: 7,
    tipo: "Manutenção",
    numeroFactura: "FT 1/2026",
    dataFacturacao: "2026-07-31",
    qtdOTs: 12,
    consumiveis: "",
    valorFTCent: "40000000",
    ...over,
  });

  beforeAll(async () => {
    await app.ready();
    teamA = (await prisma.team.create({ data: { nome: "Prov A", tipo: "PROVIDERS" } })).id;
    teamB = (await prisma.team.create({ data: { nome: "Prov B", tipo: "PROVIDERS" } })).id;
    anglobal = (await prisma.provider.create({ data: { nome: "Anglobal BP", tipos: ["PROVIDERS", "GERADORES"] } })).id;
    blinder = (await prisma.provider.create({ data: { nome: "Blinder BP", tipos: ["PROVIDERS"] } })).id;
    await prisma.providerBudget.createMany({
      data: [
        { providerId: anglobal, teamId: null, ano: 2026, po: "4500614726", orcamentoMensalCent: BigInt(295000000) },
        { providerId: blinder, teamId: null, ano: 2026, po: "4500614723", orcamentoMensalCent: BigInt(295000000) },
        { providerId: blinder, teamId: teamB, ano: 2026, po: "PO-B", orcamentoMensalCent: BigInt(100000000) },
      ],
    });
    await createUser(prisma, { email: "g@bp.ao", role: "GESTOR" });
    await createUser(prisma, { email: "s@bp.ao", role: "SUPERVISOR", teamIds: [teamA] });
    await createUser(prisma, { email: "t@bp.ao", role: "TECNICO", teamIds: [teamA] });
    await createUser(prisma, { email: "t2@bp.ao", role: "TECNICO", teamIds: [teamA] });
    gestor = (await login(app, "g@bp.ao")).token;
    supervisor = (await login(app, "s@bp.ao")).token;
    tecnico = (await login(app, "t@bp.ao")).token;
    tecnico2 = (await login(app, "t2@bp.ao")).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("Técnico vê as opções do formulário e o PO é preenchido automaticamente", async () => {
    const opts = (await get(tecnico, "/api/billing/providers/options")).json();
    expect(opts.teams.map((t: { id: string }) => t.id)).toEqual([teamA]);
    expect(opts.providers.map((p: { nome: string }) => p.nome)).toEqual(expect.arrayContaining(["Anglobal BP", "Blinder BP"]));
    const po = await get(tecnico, `/api/billing/providers/po?providerId=${anglobal}&teamId=${teamA}&ano=2026`);
    expect(po.json().po).toBe("4500614726");

    const res = await post(tecnico, base, invoice());
    expect(res.statusCode).toBe(201);
    const inv = res.json();
    expect(inv.po).toBe("4500614726");
    expect(inv.state).toBe("RASCUNHO");
    expect(inv.status).toBe("ABERTO");
    expect(inv.valorPagoCent).toBe("0");
    expect(inv.dividaCent).toBe("40000000");
    expect(inv.consumiveis).toBeNull();
    expect(inv.dataFacturacao).toBe("2026-07-31");
  });

  it("valida os campos e o tipo de equipa", async () => {
    expect((await post(tecnico, base, invoice({ valorFTCent: null }))).statusCode).toBe(400);
    expect((await post(tecnico, base, invoice({ tipo: "Outro" }))).statusCode).toBe(400);
    expect((await post(tecnico, base, invoice({ mes: 13 }))).statusCode).toBe(400);
    const gerTeam = (await prisma.team.create({ data: { nome: "Ger X", tipo: "GERADORES" } })).id;
    expect((await post(gestor, base, invoice({ teamId: gerTeam }))).statusCode).toBe(400);
  });

  it("Técnico da equipa A recebe 403 nas facturas da equipa B", async () => {
    const b = (await post(gestor, base, invoice({ teamId: teamB, providerId: blinder, valorFTCent: "1000" }))).json();
    expect(b.po).toBe("PO-B");
    expect((await get(tecnico, `${base}/${b.id}`)).statusCode).toBe(403);
    expect((await patch(tecnico, `${base}/${b.id}`, { observacao: "x" })).statusCode).toBe(403);
    expect((await post(tecnico, base, invoice({ teamId: teamB }))).statusCode).toBe(403);
    expect((await get(tecnico, `${base}?teamId=${teamB}`)).statusCode).toBe(403);
    const list = (await get(tecnico, base)).json();
    expect(list.items.every((i: { teamId: string }) => i.teamId === teamA)).toBe(true);
    await app.inject({ method: "DELETE", url: `${base}/${b.id}`, headers: bearer(gestor) });
  });

  it("fluxo Rascunho → Submetido → Validado e regras de edição", async () => {
    const inv = (await post(tecnico, base, invoice({ numeroFactura: "FT 2/2026" }))).json();

    // Outro técnico não mexe no rascunho alheio
    expect((await patch(tecnico2, `${base}/${inv.id}`, { observacao: "x" })).statusCode).toBe(403);
    // Técnico não pode apagar (sem billing_providers.delete) nem validar
    expect((await app.inject({ method: "DELETE", url: `${base}/${inv.id}`, headers: bearer(tecnico) })).statusCode).toBe(403);

    expect((await patch(tecnico, `${base}/${inv.id}`, { valorFTCent: "26000000", providerId: anglobal })).json().valorFTCent).toBe("26000000");
    expect((await post(supervisor, `${base}/${inv.id}/validate`)).statusCode).toBe(400); // ainda em rascunho
    expect((await post(tecnico, `${base}/${inv.id}/submit`)).json().state).toBe("SUBMETIDO");
    expect((await patch(tecnico, `${base}/${inv.id}`, { observacao: "x" })).statusCode).toBe(403); // já submetido
    expect((await post(tecnico, `${base}/${inv.id}/validate`)).statusCode).toBe(403);

    // Supervisor devolve, técnico corrige e volta a submeter, supervisor valida
    expect((await post(supervisor, `${base}/${inv.id}/return`)).json().state).toBe("RASCUNHO");
    await patch(tecnico, `${base}/${inv.id}`, { observacao: "corrigido" });
    await post(tecnico, `${base}/${inv.id}/submit`);
    const validated = (await post(supervisor, `${base}/${inv.id}/validate`)).json();
    expect(validated.state).toBe("VALIDADO");
    expect(validated.validatedBy.id).toBeTruthy();

    // Validada: só pagamentos, status e observação
    expect((await patch(supervisor, `${base}/${inv.id}`, { valorFTCent: "1" })).statusCode).toBe(400);
    const paid = await patch(supervisor, `${base}/${inv.id}`, { valorPagoCent: "26000000", status: "FECHADO" });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().dividaCent).toBe("0");
    expect((await app.inject({ method: "DELETE", url: `${base}/${inv.id}`, headers: bearer(supervisor) })).statusCode).toBe(400);

    // Só o Gestor reabre
    expect((await post(supervisor, `${base}/${inv.id}/reopen`)).statusCode).toBe(403);
    expect((await post(gestor, `${base}/${inv.id}/reopen`)).json().state).toBe("SUBMETIDO");
    await post(gestor, `${base}/${inv.id}/validate`);

    const mine = (await get(tecnico, `${base}?mine=true&state=RASCUNHO`)).json();
    expect(mine.items.every((i: { createdBy: { id: string }; state: string }) => i.state === "RASCUNHO")).toBe(true);
  });

  it("resumo: totais de referência (Anglobal Jul 660.000,00; Ago 588.549,42), dívida, remanescente e alerta", async () => {
    await post(supervisor, base, invoice({ mes: 8, numeroFactura: "FT 8/2026", valorFTCent: "58854942", valorPagoCent: "10000000" }));
    await post(supervisor, base, invoice({ providerId: blinder, mes: 9, valorFTCent: "300000000" }));

    const res = await get(supervisor, "/api/billing/providers/summary?ano=2026");
    expect(res.statusCode).toBe(200);
    const s = res.json();
    const a = s.providers.find((p: { nome: string }) => p.nome === "Anglobal BP");
    expect(a.facturadoMes[6]).toBe("66000000"); // 400.000,00 + 260.000,00
    expect(a.facturadoMes[7]).toBe("58854942");
    expect(a.orcamentoMensal).toBe("295000000");
    expect(a.orcamentoAnual).toBe("3540000000");
    expect(a.pagoAno).toBe("36000000");
    expect(a.divida).toBe("88854942");
    expect(a.remanescente).toBe("3415145058");
    expect(a.execucaoPercent).toBe(3.52);

    const b = s.providers.find((p: { nome: string }) => p.nome === "Blinder BP");
    expect(b.mesesAcimaOrcamento).toEqual([9]);

    const validated = (await get(supervisor, "/api/billing/providers/summary?ano=2026&validadas=true")).json();
    const av = validated.providers.find((p: { nome: string }) => p.nome === "Anglobal BP");
    expect(av.facturadoMes[6]).toBe("26000000");

    // Técnico não vê a equipa B no resumo
    expect((await get(tecnico, `/api/billing/providers/summary?ano=2026&teamId=${teamB}`)).statusCode).toBe(403);
  });

  it("lista com filtros, paginação e totais", async () => {
    const res = (await get(gestor, `${base}?ano=2026&providerId=${anglobal}&mes=7`)).json();
    expect(res.total).toBe(2);
    expect(res.totals.valorFTCent).toBe("66000000");
    expect(res.pageSize).toBe(50);
  });

  it("regista as operações na auditoria", async () => {
    const actions = await prisma.auditLog.findMany({ where: { entity: "ProviderInvoice" }, select: { action: true } });
    const set = new Set(actions.map((a) => a.action));
    for (const a of ["create", "update", "submit", "validate", "return", "reopen", "delete"]) expect(set.has(a), a).toBe(true);
  });
});

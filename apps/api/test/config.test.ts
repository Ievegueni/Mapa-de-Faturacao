import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

describe.skipIf(!TEST_DB)("providers, preços, faixas e targets", () => {
  const { app, prisma } = createTestApp();
  let gestor: string;
  let supervisor: string;
  let providerId: string;
  let teamId: string;

  beforeAll(async () => {
    await app.ready();
    await createUser(prisma, { email: "gestor@config.ao", role: "GESTOR" });
    await createUser(prisma, { email: "super@config.ao", role: "SUPERVISOR" });
    await createUser(prisma, { email: "tec@config.ao", role: "TECNICO" });
    gestor = (await login(app, "gestor@config.ao")).token;
    supervisor = (await login(app, "super@config.ao")).token;
    teamId = (await prisma.team.create({ data: { nome: "Providers Config", tipo: "PROVIDERS" } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("CRUD de providers e permissões (Supervisor só vê; Técnico não vê)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/providers",
      headers: bearer(gestor),
      payload: { nome: "Provider Teste", nif: "", email: "", tipos: ["GERADORES"] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().nif).toBeNull();
    providerId = created.json().id;

    expect((await app.inject({ method: "GET", url: "/api/providers", headers: bearer(supervisor) })).statusCode).toBe(200);
    const denied = await app.inject({
      method: "PATCH",
      url: `/api/providers/${providerId}`,
      headers: bearer(supervisor),
      payload: { nome: "X" },
    });
    expect(denied.statusCode).toBe(403);
    const tec = (await login(app, "tec@config.ao")).token;
    expect((await app.inject({ method: "GET", url: "/api/providers", headers: bearer(tec) })).statusCode).toBe(403);

    const noType = await app.inject({ method: "POST", url: "/api/providers", headers: bearer(gestor), payload: { nome: "Sem tipo", tipos: [] } });
    expect(noType.statusCode).toBe(400);
  });

  it("orçamento por equipa/ano e por omissão (todas as equipas), com valores em branco", async () => {
    const def = await app.inject({
      method: "PUT",
      url: `/api/providers/${providerId}/budgets`,
      headers: bearer(gestor),
      payload: { teamId: null, ano: 2026, po: "4500000001", orcamentoMensalCent: "295000000" },
    });
    expect(def.statusCode).toBe(200);
    const again = await app.inject({
      method: "PUT",
      url: `/api/providers/${providerId}/budgets`,
      headers: bearer(gestor),
      payload: { teamId: null, ano: 2026, po: "4500000002", orcamentoMensalCent: null },
    });
    const defaults = again.json().budgets.filter((b: { teamId: string | null }) => b.teamId === null);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].po).toBe("4500000002");
    expect(defaults[0].orcamentoMensalCent).toBeNull();

    const team = await app.inject({
      method: "PUT",
      url: `/api/providers/${providerId}/budgets`,
      headers: bearer(gestor),
      payload: { teamId, ano: 2026, po: null, orcamentoMensalCent: "100050" },
    });
    const row = team.json().budgets.find((b: { teamId: string | null }) => b.teamId === teamId);
    expect(row.orcamentoMensalCent).toBe("100050");
    expect(row.team.nome).toBe("Providers Config");
  });

  it("preço em branco grava null; editar depois funciona; BigInt serializado como string", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/prices",
      headers: bearer(gestor),
      payload: { providerId, validFrom: "2026-01-01", precoCombustivelCent: "42000", ivaPercent: null },
    });
    expect(created.statusCode).toBe(201);
    const table = created.json();
    expect(table.validFrom).toBe("2026-01-01");
    expect(table.precoCombustivelCent).toBe("42000");
    expect(table.precoServAbastCent).toBeNull();
    expect(table.precoManutencaoCent).toBeNull();
    expect(table.ivaPercent).toBeNull();

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/prices/${table.id}`,
      headers: bearer(gestor),
      payload: { precoServAbastCent: "4800", ivaPercent: "14", precoCombustivelCent: null },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().precoServAbastCent).toBe("4800");
    expect(edited.json().ivaPercent).toBe("14");
    expect(edited.json().precoCombustivelCent).toBeNull();

    const dup = await app.inject({
      method: "POST",
      url: "/api/prices",
      headers: bearer(gestor),
      payload: { providerId, validFrom: "2026-01-01" },
    });
    expect(dup.statusCode).toBe(409);

    const badIva = await app.inject({ method: "PATCH", url: `/api/prices/${table.id}`, headers: bearer(gestor), payload: { ivaPercent: "140" } });
    expect(badIva.statusCode).toBe(400);
    const supEdit = await app.inject({ method: "PATCH", url: `/api/prices/${table.id}`, headers: bearer(supervisor), payload: { ivaPercent: "10" } });
    expect(supEdit.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/prices", headers: bearer(supervisor) })).statusCode).toBe(200);
  });

  it("linhas de aluguer: campos vazios e cópia para nova vigência", async () => {
    const table = (await app.inject({ method: "GET", url: `/api/prices?providerId=${providerId}`, headers: bearer(gestor) })).json()[0];
    const added = await app.inject({
      method: "POST",
      url: `/api/prices/${table.id}/rent-prices`,
      headers: bearer(gestor),
      payload: { potenciaKVA: 20, subtipo: "", distancia: null, precoDiaCent: null },
    });
    expect(added.statusCode).toBe(201);
    const rent = added.json().rentPrices[0];
    expect(rent.subtipo).toBeNull();
    expect(rent.precoDiaCent).toBeNull();

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/prices/${table.id}/rent-prices/${rent.id}`,
      headers: bearer(gestor),
      payload: { precoDiaCent: "1500000", distancia: "> 50 km" },
    });
    expect(edited.json().rentPrices[0].precoDiaCent).toBe("1500000");

    const copy = await app.inject({
      method: "POST",
      url: "/api/prices",
      headers: bearer(gestor),
      payload: { providerId, validFrom: "2026-07-01", copyFromId: table.id },
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json().precoServAbastCent).toBe("4800");
    expect(copy.json().rentPrices).toHaveLength(1);
    expect(copy.json().rentPrices[0].distancia).toBe("> 50 km");
  });

  it("faixas de desconto: criar, editar, rejeitar sobreposição", async () => {
    const mk = (payload: object) => app.inject({ method: "POST", url: "/api/discount-rules", headers: bearer(gestor), payload });
    const a = await mk({ horasMin: 0, horasMax: 5, percent: "0", validFrom: "2030-01-01" });
    expect(a.statusCode).toBe(201);
    expect((await mk({ horasMin: 6, horasMax: 11, percent: 35, validFrom: "2030-01-01" })).statusCode).toBe(201);
    const overlap = await mk({ horasMin: 5, horasMax: 8, percent: "40", validFrom: "2030-01-01" });
    expect(overlap.statusCode).toBe(400);
    expect((await mk({ horasMin: 9, horasMax: 3, percent: "1", validFrom: "2030-01-01" })).statusCode).toBe(400);

    const edit = await app.inject({ method: "PATCH", url: `/api/discount-rules/${a.json().id}`, headers: bearer(gestor), payload: { percent: "5" } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().percent).toBe("5");
  });

  it("targets: global e por provider, campos vazios gravam null e aparecem vazios", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/targets",
      headers: bearer(gestor),
      payload: {
        ano: 2026,
        items: [
          { mes: 7, providerId: null, aluguerCent: "1000000000", combustivelCent: null },
          { mes: 7, providerId, aluguerCent: null, combustivelCent: "50000000" },
          { mes: 8, providerId: null, aluguerCent: null, combustivelCent: null },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const items = put.json().items as { mes: number; providerId: string | null; aluguerCent: string | null; combustivelCent: string | null }[];
    expect(items).toHaveLength(2);
    const global = items.find((i) => i.providerId === null)!;
    expect(global.aluguerCent).toBe("1000000000");
    expect(global.combustivelCent).toBeNull();

    // Repetir o global não duplica (índice único parcial) e editar funciona.
    await app.inject({
      method: "PUT",
      url: "/api/targets",
      headers: bearer(gestor),
      payload: { ano: 2026, items: [{ mes: 7, providerId: null, aluguerCent: "1000000000", combustivelCent: "70000000" }] },
    });
    const get = await app.inject({ method: "GET", url: "/api/targets?ano=2026", headers: bearer(supervisor) });
    const globals = get.json().items.filter((i: { providerId: string | null }) => i.providerId === null);
    expect(globals).toHaveLength(1);
    expect(globals[0].combustivelCent).toBe("70000000");

    // Esvaziar a célula apaga a linha.
    const cleared = await app.inject({
      method: "PUT",
      url: "/api/targets",
      headers: bearer(gestor),
      payload: { ano: 2026, items: [{ mes: 7, providerId, aluguerCent: null, combustivelCent: null }] },
    });
    expect(cleared.json().items.filter((i: { providerId: string | null }) => i.providerId === providerId)).toHaveLength(0);

    const denied = await app.inject({ method: "PUT", url: "/api/targets", headers: bearer(supervisor), payload: { ano: 2026, items: [] } });
    expect(denied.statusCode).toBe(403);
  });
});

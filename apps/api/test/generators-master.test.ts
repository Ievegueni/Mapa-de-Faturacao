import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

describe.skipIf(!TEST_DB)("sites e geradores (dados mestre)", () => {
  const { app, prisma } = createTestApp();
  let teamA: string;
  let teamB: string;
  let provider: string;
  let gestor: string;
  let supervisor: string;
  let tecnico: string;
  let siteId: string;

  const req = (method: "GET" | "POST" | "PATCH" | "DELETE", token: string, url: string, payload?: object) =>
    app.inject({ method, url: `/api${url}`, headers: bearer(token), payload });

  beforeAll(async () => {
    await app.ready();
    teamA = (await prisma.team.create({ data: { nome: "Ger A", tipo: "GERADORES" } })).id;
    teamB = (await prisma.team.create({ data: { nome: "Ger B", tipo: "GERADORES" } })).id;
    provider = (await prisma.provider.create({ data: { nome: "Prop Ger", tipos: ["GERADORES"] } })).id;
    await createUser(prisma, { email: "g@gm.ao", role: "GESTOR" });
    await createUser(prisma, { email: "s@gm.ao", role: "SUPERVISOR", teamIds: [teamA] });
    await createUser(prisma, { email: "t@gm.ao", role: "TECNICO", teamIds: [teamA] });
    gestor = (await login(app, "g@gm.ao")).token;
    supervisor = (await login(app, "s@gm.ao")).token;
    tecnico = (await login(app, "t@gm.ao")).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("Supervisor cria site normalizado; Técnico não altera dados mestre", async () => {
    const payload = { teamId: teamA, nome: "  Luanda   Sul 01 ", codigoPP: "PP-001", regiao: "Sul", provincia: "Luanda", powerCube1000: true, subtipo: "Macro" };
    const res = await req("POST", supervisor, "/generators/sites", payload);
    expect(res.statusCode).toBe(201);
    siteId = res.json().id;
    expect(res.json().nome).toBe("Luanda Sul 01");
    expect(res.json().ligadoRede).toBeNull();
    expect((await req("POST", tecnico, "/generators/sites", { ...payload, codigoPP: "PP-T" })).statusCode).toBe(403);
    expect((await req("POST", supervisor, "/generators/sites", payload)).statusCode).toBe(409);
    expect((await req("POST", supervisor, "/generators/sites", { ...payload, codigoPP: "X", regiao: "Oeste" })).statusCode).toBe(400);
    expect((await req("POST", supervisor, "/generators/sites", { ...payload, teamId: teamB, codigoPP: "Y" })).statusCode).toBe(403);
  });

  it("geradores: nº de série único, potência, datas e proprietário", async () => {
    const res = await req("POST", supervisor, "/generators/generators", {
      siteId, providerId: provider, numeroSerie: "SN-0001", potenciaKVA: "20", dataInstalacao: "2024-03-01",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().potenciaKVA).toBe(20);
    expect(res.json().dataInstalacao).toBe("2024-03-01");
    expect((await req("POST", supervisor, "/generators/generators", { siteId, providerId: provider, numeroSerie: "SN-0001" })).statusCode).toBe(409);
    const bad = await req("POST", supervisor, "/generators/generators", {
      siteId, providerId: provider, numeroSerie: "SN-2", dataInstalacao: "2024-03-01", dataRemocao: "2024-01-01",
    });
    expect(bad.statusCode).toBe(400);
    const prov = (await prisma.provider.create({ data: { nome: "Só Prov", tipos: ["PROVIDERS"] } })).id;
    expect((await req("POST", supervisor, "/generators/generators", { siteId, providerId: prov, numeroSerie: "SN-3" })).statusCode).toBe(400);

    const g = res.json();
    const upd = await req("PATCH", supervisor, `/generators/generators/${g.id}`, { dataRemocao: "2026-08-15", potenciaKVA: "" });
    expect(upd.json().dataRemocao).toBe("2026-08-15");
    expect(upd.json().potenciaKVA).toBeNull();
  });

  it("pesquisa e filtros (por nome, código P.P. e nº de série), âmbito por equipa", async () => {
    const siteB = (await req("POST", gestor, "/generators/sites", { teamId: teamB, nome: "Huambo 02", codigoPP: "PP-900", regiao: "Centro", provincia: "Huambo" })).json();
    await req("POST", gestor, "/generators/generators", { siteId: siteB.id, providerId: provider, numeroSerie: "SN-B1", potenciaKVA: 40 });

    const bySerie = (await req("GET", tecnico, "/generators/sites?q=sn-0001")).json();
    expect(bySerie.items.map((s: { id: string }) => s.id)).toEqual([siteId]);
    expect((await req("GET", tecnico, "/generators/sites")).json().total).toBe(1);
    expect((await req("GET", gestor, "/generators/sites?regiao=Centro")).json().items[0].nome).toBe("Huambo 02");
    expect((await req("GET", tecnico, `/generators/sites/${siteB.id}`)).statusCode).toBe(403);
    expect((await req("GET", tecnico, `/generators/sites?teamId=${teamB}`)).statusCode).toBe(403);

    expect((await req("GET", gestor, "/generators/generators?potencia=40")).json().items[0].numeroSerie).toBe("SN-B1");
    expect((await req("GET", gestor, "/generators/generators?removidos=true")).json().items.map((g: { numeroSerie: string }) => g.numeroSerie)).toEqual(["SN-0001"]);
    expect((await req("GET", tecnico, "/generators/generators?q=Huambo")).json().total).toBe(0);

    const opts = (await req("GET", tecnico, "/generators/options")).json();
    expect(opts.teams.map((t: { id: string }) => t.id)).toEqual([teamA]);
    expect(opts.provincias).toEqual(["Luanda"]);
  });

  it("eliminar: site com geradores bloqueado; gerador sem medições pode ser eliminado", async () => {
    expect((await req("DELETE", supervisor, `/generators/sites/${siteId}`)).statusCode).toBe(409);
    const g = (await req("GET", supervisor, "/generators/generators?q=SN-0001")).json().items[0];
    expect((await req("DELETE", tecnico, `/generators/generators/${g.id}`)).statusCode).toBe(403);
    expect((await req("DELETE", supervisor, `/generators/generators/${g.id}`)).statusCode).toBe(204);
    expect((await req("DELETE", supervisor, `/generators/sites/${siteId}`)).statusCode).toBe(204);
  });
});

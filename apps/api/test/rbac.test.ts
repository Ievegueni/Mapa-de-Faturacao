import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTeamAccess, requirePermission, scopeFilter } from "../src/plugins/rbac";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

/**
 * Critérios de aceitação do Sprint 1. Os módulos de facturação chegam nos sprints seguintes,
 * por isso usam-se rotas de teste com os mesmos guardas (requirePermission + scopeFilter/assertTeamAccess).
 */
describe.skipIf(!TEST_DB)("RBAC e âmbito por equipa", () => {
  const { app, prisma } = createTestApp();
  let teamA: string;
  let teamB: string;
  let gestorToken: string;
  let tecnicoToken: string;
  let supervisorId: string;
  let supervisorToken: string;

  beforeAll(async () => {
    app.register(
      async (api) => {
        api.addHook("onRequest", api.authenticate);
        api.get<{ Params: { teamId: string } }>(
          "/test/teams/:teamId/records",
          { preHandler: requirePermission("billing_providers", "view") },
          async (req) => {
            assertTeamAccess(req.auth, req.params.teamId);
            return { ok: true };
          },
        );
        api.get("/test/records", { preHandler: requirePermission("billing_providers", "view") }, async (req) => {
          return { where: scopeFilter(req.auth) };
        });
        api.get("/test/export", { preHandler: requirePermission("billing_providers", "export") }, async () => ({
          ok: true,
        }));
      },
      { prefix: "/api" },
    );
    await app.ready();

    teamA = (await prisma.team.create({ data: { nome: "Equipa A", tipo: "PROVIDERS" } })).id;
    teamB = (await prisma.team.create({ data: { nome: "Equipa B", tipo: "PROVIDERS" } })).id;
    await createUser(prisma, { email: "gestor@rbac.ao", role: "GESTOR" });
    await createUser(prisma, { email: "tecnico@rbac.ao", role: "TECNICO", teamIds: [teamA] });
    supervisorId = (await createUser(prisma, { email: "super@rbac.ao", role: "SUPERVISOR", teamIds: [teamA] })).id;
    gestorToken = (await login(app, "gestor@rbac.ao")).token;
    tecnicoToken = (await login(app, "tecnico@rbac.ao")).token;
    supervisorToken = (await login(app, "super@rbac.ao")).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("Técnico da equipa A recebe 403 na equipa B e 200 na A", async () => {
    const b = await app.inject({ method: "GET", url: `/api/test/teams/${teamB}/records`, headers: bearer(tecnicoToken) });
    expect(b.statusCode).toBe(403);
    const a = await app.inject({ method: "GET", url: `/api/test/teams/${teamA}/records`, headers: bearer(tecnicoToken) });
    expect(a.statusCode).toBe(200);
  });

  it("scopeFilter: Técnico só vê as suas equipas; Gestor vê tudo", async () => {
    const t = await app.inject({ method: "GET", url: "/api/test/records", headers: bearer(tecnicoToken) });
    expect(t.json().where).toEqual({ teamId: { in: [teamA] } });
    const g = await app.inject({ method: "GET", url: "/api/test/records", headers: bearer(gestorToken) });
    expect(g.json().where).toEqual({});
    const gb = await app.inject({ method: "GET", url: `/api/test/teams/${teamB}/records`, headers: bearer(gestorToken) });
    expect(gb.statusCode).toBe(200);
  });

  it("Técnico recebe 403 nas páginas do Gestor", async () => {
    for (const url of ["/api/users", "/api/teams", `/api/users/${supervisorId}/permissions`]) {
      const res = await app.inject({ method: "GET", url, headers: bearer(tecnicoToken) });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it("override 'negar export' bloqueia o endpoint e desaparece de /me", async () => {
    const before = await app.inject({ method: "GET", url: "/api/test/export", headers: bearer(supervisorToken) });
    expect(before.statusCode).toBe(200);

    const put = await app.inject({
      method: "PUT",
      url: `/api/users/${supervisorId}/permissions`,
      headers: bearer(gestorToken),
      payload: { overrides: [{ module: "billing_providers", action: "export", allowed: false }] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().effective).not.toContain("billing_providers.export");

    const after = await app.inject({ method: "GET", url: "/api/test/export", headers: bearer(supervisorToken) });
    expect(after.statusCode).toBe(403);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: bearer(supervisorToken) });
    expect(me.json().permissions).not.toContain("billing_providers.export");

    const reset = await app.inject({
      method: "PUT",
      url: `/api/users/${supervisorId}/permissions`,
      headers: bearer(gestorToken),
      payload: { overrides: [{ module: "billing_providers", action: "export", allowed: null }] },
    });
    expect(reset.json().effective).toContain("billing_providers.export");
  });

  it("rejeita permissões fora do catálogo", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${supervisorId}/permissions`,
      headers: bearer(gestorToken),
      payload: { overrides: [{ module: "x", action: "y", allowed: true }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("utilizador desactivado perde o acesso de imediato", async () => {
    const u = await createUser(prisma, { email: "sai@rbac.ao", role: "TECNICO", teamIds: [teamA] });
    const { token } = await login(app, "sai@rbac.ao");
    const del = await app.inject({ method: "DELETE", url: `/api/users/${u.id}`, headers: bearer(gestorToken) });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) })).statusCode).toBe(401);
  });

  it("equipa desactivada sai do âmbito do utilizador", async () => {
    const c = (await prisma.team.create({ data: { nome: "Equipa C", tipo: "GERADORES" } })).id;
    await createUser(prisma, { email: "c@rbac.ao", role: "TECNICO", teamIds: [c] });
    const { token } = await login(app, "c@rbac.ao");
    await app.inject({ method: "DELETE", url: `/api/teams/${c}`, headers: bearer(gestorToken) });
    const res = await app.inject({ method: "GET", url: `/api/test/teams/${c}/records`, headers: bearer(token) });
    expect(res.statusCode).toBe(403);
  });
});

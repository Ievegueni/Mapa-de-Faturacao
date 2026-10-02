import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, createUser, login, TEST_DB } from "./helpers";

describe.skipIf(!TEST_DB)("gestão de utilizadores e equipas (Gestor)", () => {
  const { app, prisma } = createTestApp();
  let token: string;
  let gestorId: string;

  beforeAll(async () => {
    await app.ready();
    gestorId = (await createUser(prisma, { email: "gestor@admin.ao", role: "GESTOR" })).id;
    token = (await login(app, "gestor@admin.ao")).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("cria, edita e desactiva equipas", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: bearer(token),
      payload: { nome: "Geradores Luanda", tipo: "GERADORES" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const dup = await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: bearer(token),
      payload: { nome: "geradores luanda", tipo: "PROVIDERS" },
    });
    expect(dup.statusCode).toBe(409);

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/teams/${id}`,
      headers: bearer(token),
      payload: { nome: "Geradores Sul" },
    });
    expect(edited.json().nome).toBe("Geradores Sul");

    const off = await app.inject({ method: "DELETE", url: `/api/teams/${id}`, headers: bearer(token) });
    expect(off.json().ativo).toBe(false);
  });

  it("cria utilizador com troca de password obrigatória e associa à equipa", async () => {
    const team = await prisma.team.create({ data: { nome: "Providers Norte", tipo: "PROVIDERS" } });
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: bearer(token),
      payload: { nome: "Ana Técnica", email: "Ana@Admin.ao", role: "TECNICO", password: "temporaria-123" },
    });
    expect(res.statusCode).toBe(201);
    const user = res.json();
    expect(user.email).toBe("ana@admin.ao");
    expect(user.mustChangePassword).toBe(true);
    expect(user.passwordHash).toBeUndefined();

    const add = await app.inject({
      method: "POST",
      url: `/api/teams/${team.id}/members`,
      headers: bearer(token),
      payload: { userId: user.id },
    });
    expect(add.json().members.map((m: { id: string }) => m.id)).toContain(user.id);

    const me = (await login(app, "ana@admin.ao", "temporaria-123")).body.user;
    expect(me.teams.map((t: { id: string }) => t.id)).toEqual([team.id]);
    expect(me.billingTypes).toEqual(["PROVIDERS"]);

    const rm = await app.inject({
      method: "DELETE",
      url: `/api/teams/${team.id}/members/${user.id}`,
      headers: bearer(token),
    });
    expect(rm.json().members).toHaveLength(0);

    const dupEmail = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: bearer(token),
      payload: { nome: "Outra", email: "ana@admin.ao", role: "TECNICO", password: "temporaria-123" },
    });
    expect(dupEmail.statusCode).toBe(409);
  });

  it("não deixa o Gestor desactivar-se nem mudar o próprio perfil", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/users/${gestorId}`, headers: bearer(token) });
    expect(del.statusCode).toBe(400);
    const role = await app.inject({
      method: "PATCH",
      url: `/api/users/${gestorId}`,
      headers: bearer(token),
      payload: { role: "TECNICO" },
    });
    expect(role.statusCode).toBe(400);
  });

  it("regista as mutações na auditoria", async () => {
    const count = await prisma.auditLog.count({ where: { userId: gestorId } });
    expect(count).toBeGreaterThan(3);
  });
});

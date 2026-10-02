import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestApp, createUser, login, PASSWORD, TEST_DB } from "./helpers";

describe.skipIf(!TEST_DB)("autenticação", () => {
  const { app, prisma } = createTestApp();

  beforeAll(async () => {
    await app.ready();
    await createUser(prisma, { email: "novo@teste.ao", role: "TECNICO", mustChangePassword: true });
    await createUser(prisma, { email: "inactivo@teste.ao", role: "TECNICO" }).then((u) =>
      prisma.user.update({ where: { id: u.id }, data: { ativo: false } }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejeita credenciais erradas e contas inactivas", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "novo@teste.ao", password: "errada-errada" },
    });
    expect(wrong.statusCode).toBe(401);
    const inactive = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "inactivo@teste.ao", password: PASSWORD },
    });
    expect(inactive.statusCode).toBe(401);
  });

  it("login devolve token, cookie de refresh httpOnly e /me", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "NOVO@teste.ao", password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "refresh_token")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    expect(cookie.path).toBe("/api/auth");
    expect(res.json().user.homePath).toBe("/meu-trabalho");
  });

  it("primeiro acesso: só /me e troca de password até trocar", async () => {
    const { token, refreshCookie } = await login(app, "novo@teste.ao");

    const me = await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().mustChangePassword).toBe(true);

    const blocked = await app.inject({ method: "GET", url: "/api/users", headers: bearer(token) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("PASSWORD_CHANGE_REQUIRED");

    const short = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: bearer(token),
      payload: { currentPassword: PASSWORD, newPassword: "curta" },
    });
    expect(short.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: bearer(token),
      payload: { currentPassword: PASSWORD, newPassword: "nova-password-segura" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mustChangePassword).toBe(false);

    const refresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { refresh_token: refreshCookie! },
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().accessToken).toBeTruthy();

    await login(app, "novo@teste.ao", "nova-password-segura");
  });

  it("refresh sem cookie ou com token inválido devolve 401", async () => {
    expect((await app.inject({ method: "POST", url: "/api/auth/refresh" })).statusCode).toBe(401);
    const bad = await app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { refresh_token: "x.y.z" } });
    expect(bad.statusCode).toBe(401);
  });

  it("pedidos sem token devolvem 401", async () => {
    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
  });
});

import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../app";

function fakePrisma(ok: boolean) {
  return {
    $queryRaw: async () => {
      if (!ok) throw new Error("db down");
      return [{ "?column?": 1 }];
    },
    $disconnect: async () => undefined,
  } as unknown as PrismaClient;
}

describe("GET /api/health", () => {
  it("devolve 200 com a base de dados disponível", async () => {
    const app = buildApp({ prisma: fakePrisma(true) });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "up" });
    await app.close();
  });

  it("devolve 503 sem base de dados", async () => {
    const app = buildApp({ prisma: fakePrisma(false) });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", db: "down" });
    await app.close();
  });
});

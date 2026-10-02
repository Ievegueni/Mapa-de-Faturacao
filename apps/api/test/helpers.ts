import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";
import { buildApp } from "../src/app";

export const TEST_DB = process.env.TEST_DATABASE_URL;
export const PASSWORD = "password-de-teste-123";

export function createTestApp() {
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
  const app = buildApp({ prisma });
  return { app, prisma };
}

let hash: string | null = null;

export async function createUser(
  prisma: PrismaClient,
  data: { email: string; role: Role; nome?: string; mustChangePassword?: boolean; teamIds?: string[] },
) {
  hash = hash || (await bcrypt.hash(PASSWORD, 4));
  return prisma.user.create({
    data: {
      nome: data.nome || data.email,
      email: data.email,
      role: data.role,
      passwordHash: hash,
      mustChangePassword: data.mustChangePassword ?? false,
      teams: data.teamIds ? { create: data.teamIds.map((teamId) => ({ teamId })) } : undefined,
    },
  });
}

export async function login(app: ReturnType<typeof buildApp>, email: string, password = PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login falhou (${res.statusCode}): ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "refresh_token");
  return { token: res.json().accessToken as string, refreshCookie: cookie?.value, body: res.json() };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { BillingType, Role } from "@prisma/client";
import { BILLING_TYPES, homePathFor, PermissionKey, resolvePermissions } from "@cf/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config";
import { forbidden, unauthorized } from "../lib/errors";

export interface AuthUser {
  id: string;
  nome: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
  teams: { id: string; nome: string; tipo: BillingType }[];
  teamIds: string[];
  permissions: PermissionKey[];
}

interface TokenPayload {
  sub: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void>;
    loadAuthUser(userId: string): Promise<AuthUser | null>;
    issueTokens(reply: FastifyReply, userId: string): Promise<string>;
  }
  interface FastifyRequest {
    auth: AuthUser;
  }
  interface FastifyContextConfig {
    /** Rota acessível mesmo com troca de password pendente. */
    allowPendingPassword?: boolean;
  }
}

export const REFRESH_COOKIE = "refresh_token";
export const REFRESH_COOKIE_PATH = "/api/auth";

export function toMe(user: AuthUser) {
  const billingTypes: BillingType[] =
    user.role === "GESTOR" ? BILLING_TYPES : Array.from(new Set(user.teams.map((t) => t.tipo)));
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    teams: user.teams,
    permissions: user.permissions,
    billingTypes,
    homePath: homePathFor(user.role),
  };
}

export default fp(
  async (app) => {
    await app.register(cookie);
    await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.accessTokenTtl } });
    await app.register(jwt, {
      secret: config.jwtRefreshSecret,
      namespace: "refresh",
      sign: { expiresIn: config.refreshTokenTtlSeconds },
    });

    app.decorateRequest("auth", null);

    app.decorate("loadAuthUser", async (userId: string): Promise<AuthUser | null> => {
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        include: {
          teams: { include: { team: true } },
          permissionOverrides: true,
        },
      });
      if (!user || !user.ativo) return null;
      const teams = user.teams
        .map((m) => m.team)
        .filter((t) => t.ativo)
        .map((t) => ({ id: t.id, nome: t.nome, tipo: t.tipo }));
      return {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        teams,
        teamIds: teams.map((t) => t.id),
        permissions: resolvePermissions(user.role, user.permissionOverrides),
      };
    });

    app.decorate("issueTokens", async (reply: FastifyReply, userId: string) => {
      const accessToken = app.jwt.sign({ sub: userId });
      const refreshToken = (app.jwt as any).refresh.sign({ sub: userId }) as string;
      reply.setCookie(REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: "strict",
        path: REFRESH_COOKIE_PATH,
        maxAge: config.refreshTokenTtlSeconds,
      });
      return accessToken;
    });

    app.decorate("authenticate", async (req: FastifyRequest) => {
      let payload: TokenPayload;
      try {
        payload = await req.jwtVerify<TokenPayload>();
      } catch {
        throw unauthorized();
      }
      const user = await app.loadAuthUser(payload.sub);
      if (!user) throw unauthorized();
      req.auth = user;
      if (user.mustChangePassword && !req.routeOptions.config.allowPendingPassword) {
        throw forbidden("É obrigatório trocar a password", "PASSWORD_CHANGE_REQUIRED");
      }
    });
  },
  { name: "auth", dependencies: ["prisma"] },
);

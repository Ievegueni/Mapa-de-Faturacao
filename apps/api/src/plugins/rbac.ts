import { can } from "@cf/shared";
import { FastifyRequest } from "fastify";
import { forbidden } from "../lib/errors";
import { AuthUser } from "./auth";

/** preHandler: exige `module.action` nas permissões efectivas do utilizador. */
export function requirePermission(module: string, action: string) {
  return async (req: FastifyRequest) => {
    if (!req.auth || !can(req.auth.permissions, module, action)) throw forbidden();
  };
}

/** Filtro Prisma por equipa: Gestor sem filtro; restantes só as suas equipas. */
export function scopeFilter(user: AuthUser): { teamId?: { in: string[] } } {
  if (user.role === "GESTOR") return {};
  return { teamId: { in: user.teamIds } };
}

/** 403 se o utilizador não tiver acesso à equipa (Gestor tem acesso a todas). */
export function assertTeamAccess(user: AuthUser, teamId: string) {
  if (user.role !== "GESTOR" && !user.teamIds.includes(teamId)) {
    throw forbidden("Sem acesso aos dados desta equipa");
  }
}

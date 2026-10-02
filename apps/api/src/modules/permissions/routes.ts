import { isValidPermission, permissionKey, permissionOverridesSchema, ROLE_DEFAULTS, resolvePermissions } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { badRequest, notFound, parse } from "../../lib/errors";
import { requirePermission } from "../../plugins/rbac";

const permissionsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  async function view(userId: string) {
    const user = await app.prisma.user.findUnique({ where: { id: userId }, include: { permissionOverrides: true } });
    if (!user) throw notFound("Utilizador não encontrado");
    return {
      userId: user.id,
      role: user.role,
      defaults: ROLE_DEFAULTS[user.role],
      overrides: user.permissionOverrides.map((o) => ({ module: o.module, action: o.action, allowed: o.allowed })),
      effective: resolvePermissions(user.role, user.permissionOverrides),
    };
  }

  app.get<{ Params: { id: string } }>(
    "/users/:id/permissions",
    { preHandler: requirePermission("users", "view") },
    async (req) => view(req.params.id),
  );

  /** Substitui os overrides indicados (`allowed: null` = volta ao default do perfil). */
  app.put<{ Params: { id: string } }>(
    "/users/:id/permissions",
    { preHandler: requirePermission("users", "edit") },
    async (req) => {
      const { overrides } = parse(permissionOverridesSchema, req.body);
      const before = await view(req.params.id);
      const invalid = overrides.find((o) => !isValidPermission(o.module, o.action));
      if (invalid) throw badRequest(`Permissão desconhecida: ${permissionKey(invalid.module, invalid.action)}`);

      const userId = before.userId;
      await app.prisma.$transaction(
        overrides.map((o) =>
          o.allowed === null
            ? app.prisma.userPermission.deleteMany({ where: { userId, module: o.module, action: o.action } })
            : app.prisma.userPermission.upsert({
                where: { userId_module_action: { userId, module: o.module, action: o.action } },
                create: { userId, module: o.module, action: o.action, allowed: o.allowed },
                update: { allowed: o.allowed },
              }),
        ),
      );

      await app.audit({
        userId: req.auth.id,
        entity: "UserPermission",
        entityId: userId,
        action: "update",
        diff: { overrides },
      });
      return view(userId);
    },
  );
};

export default permissionsRoutes;

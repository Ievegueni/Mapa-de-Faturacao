import { Prisma } from "@prisma/client";
import { userCreateSchema, userUpdateSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { badRequest, conflict, notFound, parse } from "../../lib/errors";
import { hashPassword } from "../../lib/password";
import { diffFields } from "../../plugins/audit";
import { requirePermission } from "../../plugins/rbac";

const userSelect = {
  id: true,
  nome: true,
  email: true,
  role: true,
  ativo: true,
  mustChangePassword: true,
  createdAt: true,
  teams: { select: { team: { select: { id: true, nome: true, tipo: true, ativo: true } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const toDto = (u: UserRow) => ({ ...u, teams: u.teams.map((m) => m.team) });

const usersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  app.get<{ Querystring: { q?: string; role?: string; ativo?: string } }>(
    "/users",
    { preHandler: requirePermission("users", "view") },
    async (req) => {
      const { q, role, ativo } = req.query;
      const where: Prisma.UserWhereInput = {};
      if (q) where.OR = [{ nome: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }];
      if (role === "GESTOR" || role === "SUPERVISOR" || role === "TECNICO") where.role = role;
      if (ativo === "true" || ativo === "false") where.ativo = ativo === "true";
      const users = await app.prisma.user.findMany({ where, select: userSelect, orderBy: { nome: "asc" } });
      return users.map(toDto);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: requirePermission("users", "view") },
    async (req) => {
      const user = await app.prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
      if (!user) throw notFound("Utilizador não encontrado");
      return toDto(user);
    },
  );

  app.post("/users", { preHandler: requirePermission("users", "create") }, async (req, reply) => {
    const data = parse(userCreateSchema, req.body);
    if (await app.prisma.user.findUnique({ where: { email: data.email } })) {
      throw conflict("Já existe um utilizador com este email");
    }
    const user = await app.prisma.user.create({
      data: {
        nome: data.nome,
        email: data.email,
        role: data.role,
        passwordHash: await hashPassword(data.password),
        mustChangePassword: true,
        teams: data.teamIds?.length ? { create: data.teamIds.map((teamId) => ({ teamId })) } : undefined,
      },
      select: userSelect,
    });
    await app.audit({
      userId: req.auth.id,
      entity: "User",
      entityId: user.id,
      action: "create",
      diff: { nome: user.nome, email: user.email, role: user.role, teamIds: data.teamIds || [] },
    });
    return reply.code(201).send(toDto(user));
  });

  app.patch<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: requirePermission("users", "edit") },
    async (req) => {
      const data = parse(userUpdateSchema, req.body);
      const before = await app.prisma.user.findUnique({ where: { id: req.params.id } });
      if (!before) throw notFound("Utilizador não encontrado");

      const isSelf = before.id === req.auth.id;
      if (isSelf && data.ativo === false) throw badRequest("Não pode desactivar a sua própria conta");
      if (isSelf && data.role && data.role !== before.role) throw badRequest("Não pode alterar o seu próprio perfil");
      if (data.email && data.email !== before.email && (await app.prisma.user.findUnique({ where: { email: data.email } }))) {
        throw conflict("Já existe um utilizador com este email");
      }

      const update: Prisma.UserUpdateInput = { nome: data.nome, email: data.email, role: data.role, ativo: data.ativo };
      if (data.password) {
        update.passwordHash = await hashPassword(data.password);
        update.mustChangePassword = true;
      }
      const user = await app.prisma.user.update({ where: { id: before.id }, data: update, select: userSelect });

      const diff = diffFields(before, data, ["nome", "email", "role", "ativo"]) as Record<string, unknown>;
      if (data.password) diff.password = "reposta";
      await app.audit({ userId: req.auth.id, entity: "User", entityId: user.id, action: "update", diff: diff as Prisma.InputJsonValue });
      return toDto(user);
    },
  );

  /** Desactivar (não apaga: o histórico e a auditoria mantêm a referência). */
  app.delete<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: requirePermission("users", "delete") },
    async (req) => {
      if (req.params.id === req.auth.id) throw badRequest("Não pode desactivar a sua própria conta");
      const before = await app.prisma.user.findUnique({ where: { id: req.params.id } });
      if (!before) throw notFound("Utilizador não encontrado");
      const user = await app.prisma.user.update({ where: { id: before.id }, data: { ativo: false }, select: userSelect });
      await app.audit({ userId: req.auth.id, entity: "User", entityId: user.id, action: "deactivate" });
      return toDto(user);
    },
  );
};

export default usersRoutes;

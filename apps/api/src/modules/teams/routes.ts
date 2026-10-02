import { Prisma } from "@prisma/client";
import { teamCreateSchema, teamMemberSchema, teamUpdateSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { conflict, notFound, parse } from "../../lib/errors";
import { diffFields } from "../../plugins/audit";
import { requirePermission } from "../../plugins/rbac";

const teamSelect = {
  id: true,
  nome: true,
  tipo: true,
  ativo: true,
  members: {
    select: { user: { select: { id: true, nome: true, email: true, role: true, ativo: true } } },
    orderBy: { user: { nome: "asc" } },
  },
} satisfies Prisma.TeamSelect;

type TeamRow = Prisma.TeamGetPayload<{ select: typeof teamSelect }>;

const toDto = (t: TeamRow) => ({ ...t, members: t.members.map((m) => m.user) });

const teamsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", app.authenticate);

  async function getTeam(id: string) {
    const team = await app.prisma.team.findUnique({ where: { id }, select: teamSelect });
    if (!team) throw notFound("Equipa não encontrada");
    return team;
  }

  async function assertUniqueName(nome: string, exceptId?: string) {
    const other = await app.prisma.team.findFirst({ where: { nome: { equals: nome, mode: "insensitive" } } });
    if (other && other.id !== exceptId) throw conflict("Já existe uma equipa com este nome");
  }

  app.get<{ Querystring: { ativo?: string; tipo?: string } }>(
    "/teams",
    { preHandler: requirePermission("teams", "view") },
    async (req) => {
      const where: Prisma.TeamWhereInput = {};
      if (req.query.ativo === "true" || req.query.ativo === "false") where.ativo = req.query.ativo === "true";
      if (req.query.tipo === "PROVIDERS" || req.query.tipo === "GERADORES") where.tipo = req.query.tipo;
      const teams = await app.prisma.team.findMany({ where, select: teamSelect, orderBy: { nome: "asc" } });
      return teams.map(toDto);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/teams/:id",
    { preHandler: requirePermission("teams", "view") },
    async (req) => toDto(await getTeam(req.params.id)),
  );

  app.post("/teams", { preHandler: requirePermission("teams", "create") }, async (req, reply) => {
    const data = parse(teamCreateSchema, req.body);
    await assertUniqueName(data.nome);
    const team = await app.prisma.team.create({ data, select: teamSelect });
    await app.audit({ userId: req.auth.id, entity: "Team", entityId: team.id, action: "create", diff: data });
    return reply.code(201).send(toDto(team));
  });

  app.patch<{ Params: { id: string } }>(
    "/teams/:id",
    { preHandler: requirePermission("teams", "edit") },
    async (req) => {
      const data = parse(teamUpdateSchema, req.body);
      const before = await getTeam(req.params.id);
      if (data.nome) await assertUniqueName(data.nome, before.id);
      const team = await app.prisma.team.update({ where: { id: before.id }, data, select: teamSelect });
      await app.audit({
        userId: req.auth.id,
        entity: "Team",
        entityId: team.id,
        action: "update",
        diff: diffFields(before, data, ["nome", "tipo", "ativo"]),
      });
      return toDto(team);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/teams/:id",
    { preHandler: requirePermission("teams", "delete") },
    async (req) => {
      const before = await getTeam(req.params.id);
      const team = await app.prisma.team.update({ where: { id: before.id }, data: { ativo: false }, select: teamSelect });
      await app.audit({ userId: req.auth.id, entity: "Team", entityId: team.id, action: "deactivate" });
      return toDto(team);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/teams/:id/members",
    { preHandler: requirePermission("teams", "view") },
    async (req) => (await getTeam(req.params.id)).members.map((m) => m.user),
  );

  app.post<{ Params: { id: string } }>(
    "/teams/:id/members",
    { preHandler: requirePermission("teams", "edit") },
    async (req, reply) => {
      const { userId } = parse(teamMemberSchema, req.body);
      const team = await getTeam(req.params.id);
      if (!(await app.prisma.user.findUnique({ where: { id: userId } }))) throw notFound("Utilizador não encontrado");
      await app.prisma.teamMember.upsert({
        where: { userId_teamId: { userId, teamId: team.id } },
        create: { userId, teamId: team.id },
        update: {},
      });
      await app.audit({ userId: req.auth.id, entity: "Team", entityId: team.id, action: "add_member", diff: { userId } });
      return reply.code(201).send(toDto(await getTeam(team.id)));
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/teams/:id/members/:userId",
    { preHandler: requirePermission("teams", "edit") },
    async (req) => {
      const team = await getTeam(req.params.id);
      await app.prisma.teamMember.deleteMany({ where: { teamId: team.id, userId: req.params.userId } });
      await app.audit({
        userId: req.auth.id,
        entity: "Team",
        entityId: team.id,
        action: "remove_member",
        diff: { userId: req.params.userId },
      });
      return toDto(await getTeam(team.id));
    },
  );
};

export default teamsRoutes;

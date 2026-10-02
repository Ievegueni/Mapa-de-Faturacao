import { changePasswordSchema, loginSchema } from "@cf/shared";
import { FastifyPluginAsync } from "fastify";
import { config } from "../../config";
import { parse, unauthorized } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/password";
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, toMe } from "../../plugins/auth";

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await app.prisma.user.findUnique({ where: { email } });
    const ok = await verifyPassword(password, user?.passwordHash);
    if (!user || !ok || !user.ativo) throw unauthorized("Email ou password incorrectos");

    const authUser = await app.loadAuthUser(user.id);
    if (!authUser) throw unauthorized("Email ou password incorrectos");
    const accessToken = await app.issueTokens(reply, user.id);
    await app.audit({ userId: user.id, entity: "User", entityId: user.id, action: "login" });
    return { accessToken, user: toMe(authUser) };
  });

  app.post("/auth/refresh", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized();
    let sub: string;
    try {
      sub = ((app.jwt as any).refresh.verify(token) as { sub: string }).sub;
    } catch {
      throw unauthorized();
    }
    const authUser = await app.loadAuthUser(sub);
    if (!authUser) throw unauthorized();
    const accessToken = await app.issueTokens(reply, authUser.id);
    return { accessToken, user: toMe(authUser) };
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie(REFRESH_COOKIE, {
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "strict",
    });
    return reply.code(204).send();
  });

  app.post(
    "/auth/change-password",
    { onRequest: app.authenticate, config: { allowPendingPassword: true } },
    async (req) => {
      const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
      const user = await app.prisma.user.findUniqueOrThrow({ where: { id: req.auth.id } });
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        throw unauthorized("A password actual está incorrecta");
      }
      await app.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
      });
      await app.audit({ userId: user.id, entity: "User", entityId: user.id, action: "change_password" });
      const authUser = await app.loadAuthUser(user.id);
      return toMe(authUser!);
    },
  );

  app.get("/me", { onRequest: app.authenticate, config: { allowPendingPassword: true } }, async (req) => toMe(req.auth));
};

export default authRoutes;

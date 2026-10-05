import { z } from "zod";
import { billingTypeSchema, roleSchema } from "./common";

export const PASSWORD_MIN = 10;

const email = z.string().trim().toLowerCase().email("Email inválido");
const nome = z.string().trim().min(2, "Nome demasiado curto").max(120);
const password = z.string().min(PASSWORD_MIN, `A password deve ter pelo menos ${PASSWORD_MIN} caracteres`).max(200);

export { billingTypeSchema, roleSchema } from "./common";

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Indique a password"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Indique a password actual"),
    newPassword: password,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: "A nova password tem de ser diferente da actual",
    path: ["newPassword"],
  });

export const userCreateSchema = z.object({
  nome,
  email,
  role: roleSchema,
  password,
  teamIds: z.array(z.string()).optional(),
});

export const userUpdateSchema = z
  .object({
    nome,
    email,
    role: roleSchema,
    ativo: z.boolean(),
    /** Repor password: o utilizador volta a ter de a trocar no próximo acesso. */
    password,
  })
  .partial();

export const teamCreateSchema = z.object({
  nome: z.string().trim().min(2, "Nome demasiado curto").max(80),
  tipo: billingTypeSchema,
});

export const teamUpdateSchema = teamCreateSchema.extend({ ativo: z.boolean() }).partial();

export const teamMemberSchema = z.object({ userId: z.string().min(1) });

export const permissionOverridesSchema = z.object({
  overrides: z.array(
    z.object({
      module: z.string(),
      action: z.string(),
      /** null = volta ao default do perfil. */
      allowed: z.boolean().nullable(),
    }),
  ),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>;
export type PermissionOverridesInput = z.infer<typeof permissionOverridesSchema>;
export * from "./config";
export * from "./invoices";

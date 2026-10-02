import type { ZodTypeAny, z } from "zod";

/** Valida no browser com o mesmo schema da API; lança Error com a primeira mensagem. */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new Error(result.error.issues[0]?.message || "Dados inválidos");
  return result.data;
}

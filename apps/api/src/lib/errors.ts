import { ZodTypeAny, z } from "zod";

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code?: string, public issues?: unknown) {
    super(message);
  }
}

export const badRequest = (message: string, issues?: unknown) => new HttpError(400, message, "BAD_REQUEST", issues);
export const unauthorized = (message = "Sessão inválida ou expirada") => new HttpError(401, message, "UNAUTHORIZED");
export const forbidden = (message = "Sem permissão para esta operação", code = "FORBIDDEN") =>
  new HttpError(403, message, code);
export const notFound = (message = "Registo não encontrado") => new HttpError(404, message, "NOT_FOUND");
export const conflict = (message: string) => new HttpError(409, message, "CONFLICT");

/** Valida `data` com um schema Zod; erro 400 com os detalhes por campo. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  throw badRequest(issues[0]?.message || "Dados inválidos", issues);
}

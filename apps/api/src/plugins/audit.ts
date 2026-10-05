import { Prisma } from "@prisma/client";
import fp from "fastify-plugin";

export interface AuditEntry {
  userId: string;
  entity: string;
  entityId: string;
  action: string;
  /** Aceita BigInt (convertido para string). */
  diff?: Prisma.InputJsonValue | Record<string, unknown>;
}

const jsonSafe = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Prisma.InputJsonValue;

declare module "fastify" {
  interface FastifyInstance {
    audit(entry: AuditEntry): Promise<void>;
  }
}

export default fp(
  async (app) => {
    app.decorate("audit", async (entry: AuditEntry) => {
      await app.prisma.auditLog.create({ data: { ...entry, diff: entry.diff === undefined ? undefined : jsonSafe(entry.diff) } });
    });
  },
  { name: "audit", dependencies: ["prisma"] },
);

/** Diferenças entre dois objectos, só nos campos indicados: `{ campo: [antes, depois] }`. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>, fields: (keyof T)[]) {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const f of fields) {
    if (f in after && after[f] !== undefined && after[f] !== before[f]) diff[f as string] = [before[f], after[f]];
  }
  return diff as Prisma.InputJsonValue;
}

import { z } from "zod";

export const roleSchema = z.enum(["GESTOR", "SUPERVISOR", "TECNICO"]);
export const billingTypeSchema = z.enum(["PROVIDERS", "GERADORES"]);

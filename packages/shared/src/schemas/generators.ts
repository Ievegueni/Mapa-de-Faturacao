import { z } from "zod";
import { REGIOES } from "../calc/normalize";

const collapse = (v: string) => v.replace(/\s+/g, " ");

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v.replace(/\s+/g, " ") : null));

const optionalBool = z.boolean().nullable().optional().transform((v) => (v === undefined ? null : v));

const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const siteSchema = z.object({
  teamId: z.string().min(1, "Escolha a equipa"),
  nome: z.string().trim().min(1, "Indique o nome do site").max(160).transform(collapse),
  codigoPP: text(60),
  codigoLocalizacao: text(60),
  codigoCliente: text(60),
  regiao: z.enum(REGIOES, { errorMap: () => ({ message: "Região inválida (Norte, Centro, Sul ou Leste)" }) }),
  provincia: z.string().trim().min(1, "Indique a província").max(60).transform(collapse),
  nivel: text(40),
  tipo: text(60),
  powerCube1000: optionalBool,
  subtipo: text(60),
  distanciaFacturacao: text(60),
  tipoAcesso: text(60),
  pavimentadoInterior: optionalBool,
  ligadoRede: optionalBool,
});

export const siteUpdateSchema = siteSchema.partial();

export const generatorSchema = z
  .object({
    siteId: z.string().min(1, "Escolha o site"),
    providerId: z.string().min(1, "Escolha o proprietário"),
    numeroSerie: z.string().trim().min(1, "Indique o nº de série").max(80),
    numeroActivo: text(80),
    potenciaKVA: z.union([z.literal(""), z.null(), z.coerce.number().int("Potência inválida").positive("Potência inválida")]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
    dataInstalacao: optionalDate,
    dataRemocao: optionalDate,
    dataEntrada: optionalDate,
  })
  .refine((g) => !g.dataInstalacao || !g.dataRemocao || g.dataRemocao >= g.dataInstalacao, {
    message: "A data de remoção não pode ser anterior à de instalação",
    path: ["dataRemocao"],
  });

export const generatorUpdateSchema = z
  .object({
    siteId: z.string().min(1),
    providerId: z.string().min(1),
    numeroSerie: z.string().trim().min(1).max(80),
    numeroActivo: text(80),
    potenciaKVA: z.union([z.literal(""), z.null(), z.coerce.number().int().positive("Potência inválida")]).transform((v) => (v === "" ? null : v)),
    dataInstalacao: optionalDate,
    dataRemocao: optionalDate,
    dataEntrada: optionalDate,
  })
  .partial();

export type SiteInput = z.infer<typeof siteSchema>;
export type GeneratorInput = z.infer<typeof generatorSchema>;

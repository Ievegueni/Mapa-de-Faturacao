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

const decimalField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const s = String(v).trim().replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Número inválido" });
      return z.NEVER;
    }
    return s;
  });

const manualCents = z
  .union([z.literal(""), z.null(), z.string().trim().regex(/^\d+$/, "Valor inválido"), z.number().int().nonnegative()])
  .optional()
  .transform((v) => (v === undefined || v === null || v === "" ? null : String(v)));

/** Campos editáveis de uma medição (o resto é calculado no servidor com a mesma função do browser). */
export const measurementFieldsSchema = z.object({
  dias: z.coerce.number().int("Dias inválidos").min(0, "Dias inválidos").max(31, "Dias inválidos"),
  horasN1: decimalField,
  horasN: decimalField,
  litros: decimalField,
  servExtrasCent: manualCents,
  penExcessoHorasCent: manualCents,
  penSLACent: manualCents,
  penNivelCombustCent: manualCents,
  penAvariaCent: manualCents,
});

export const measurementCreateSchema = measurementFieldsSchema.extend({ generatorId: z.string().min(1) });
export const measurementUpdateSchema = measurementFieldsSchema.partial();

export const generatorMapCreateSchema = z.object({
  teamId: z.string().min(1, "Escolha a equipa"),
  providerId: z.string().min(1, "Escolha o provider"),
  ano: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

export type MeasurementFields = z.infer<typeof measurementFieldsSchema>;

const optionalCount = z
  .union([z.literal(""), z.null(), z.coerce.number().int("Tem de ser um número inteiro").min(0, "Não pode ser negativo")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

/** Linhas manuais do Mapa Resumo de Validações (por mapa mensal). Todos podem ficar vazios. */
export const monthlyIndicatorsSchema = z.object({
  sitesRedePublica: optionalCount,
  sitesRedeConfiguradosNetEco: optionalCount,
  sitesRedeSemGarantia: optionalCount,
  poupancaCent: manualCents,
  transporteExtraCent: manualCents,
  factAluguerLuandaCent: manualCents,
  factAluguerProvinciaCent: manualCents,
  factCombustivelLuandaCent: manualCents,
  factCombustivelProvinciaCent: manualCents,
  factServAbastLuandaCent: manualCents,
  factServAbastProvinciaCent: manualCents,
});

/** Campo de MonthlyIndicators com o valor facturado pelo provider para cada categoria/zona. */
export const FACTURADO_FIELDS = {
  "Aluguer|Luanda": "factAluguerLuandaCent",
  "Aluguer|Província": "factAluguerProvinciaCent",
  "Combustível|Luanda": "factCombustivelLuandaCent",
  "Combustível|Província": "factCombustivelProvinciaCent",
  "Serviço de Abastecimento|Luanda": "factServAbastLuandaCent",
  "Serviço de Abastecimento|Província": "factServAbastProvinciaCent",
} as const;

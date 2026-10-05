import { z } from "zod";
import { billingTypeSchema } from "./common";

/** Cêntimos como string/inteiro (a API serializa BigInt como string). Vazio → null. */
export const centsSchema = z
  .union([z.string().trim().regex(/^-?\d+$/, "Valor inválido"), z.number().int(), z.null()])
  .transform((v) => (v === null ? null : BigInt(v)));

export const nonNegativeCentsSchema = centsSchema.refine((v) => v === null || v >= BigInt(0), "O valor não pode ser negativo");

/** Percentagem 0–100 com até 2 casas. Vazio → null. */
export const percentSchema = z
  .union([z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Percentagem inválida"), z.number(), z.null()])
  .transform((v) => (v === null ? null : String(v)))
  .refine((v) => v === null || (Number(v) >= 0 && Number(v) <= 100), "A percentagem tem de estar entre 0 e 100");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (aaaa-mm-dd)")
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), "Data inválida");

export const yearSchema = z.coerce.number().int().min(2000).max(2100);
export const monthSchema = z.coerce.number().int().min(1).max(12);

export const providerCreateSchema = z.object({
  nome: z.string().trim().min(2, "Nome demasiado curto").max(120),
  nif: optionalText(30),
  contacto: optionalText(120),
  email: z
    .union([z.string().trim().toLowerCase().email("Email inválido"), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : null)),
  /** Módulo do parceiro (listas separadas): não muda depois de criado. */
  tipo: billingTypeSchema,
});

export const providerUpdateSchema = providerCreateSchema.omit({ tipo: true }).extend({ ativo: z.boolean() }).partial();

export const providerBudgetSchema = z.object({
  /** Vazio = todas as equipas. */
  teamId: z.string().min(1).nullable(),
  ano: yearSchema,
  po: optionalText(40),
  orcamentoMensalCent: nonNegativeCentsSchema,
});

const priceFields = {
  precoCombustivelCent: nonNegativeCentsSchema,
  precoServAbastCent: nonNegativeCentsSchema,
  precoManutencaoCent: nonNegativeCentsSchema,
  ivaPercent: percentSchema,
};

/** Campo opcional na criação: em falta → null (fica em branco). */
const blank = <T extends z.ZodTypeAny>(schema: T) => schema.optional().transform((v) => (v === undefined ? null : v));

export const priceTableCreateSchema = z.object({
  providerId: z.string().min(1),
  validFrom: isoDate,
  precoCombustivelCent: blank(priceFields.precoCombustivelCent),
  precoServAbastCent: blank(priceFields.precoServAbastCent),
  precoManutencaoCent: blank(priceFields.precoManutencaoCent),
  ivaPercent: blank(priceFields.ivaPercent),
});

export const priceTableUpdateSchema = z.object({ validFrom: isoDate, ...priceFields }).partial();

export const rentPriceSchema = z.object({
  potenciaKVA: z.union([z.coerce.number().int().positive("Potência inválida"), z.null()]),
  subtipo: optionalText(60),
  distancia: optionalText(60),
  precoDiaCent: nonNegativeCentsSchema,
});

export const rentPriceUpdateSchema = rentPriceSchema.partial();

export const discountRuleSchema = z
  .object({
    horasMin: z.coerce.number().int().min(0).max(24),
    horasMax: z.coerce.number().int().min(0).max(24),
    percent: z.union([z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Percentagem inválida"), z.number()]).transform(String),
    validFrom: isoDate,
  })
  .refine((r) => r.horasMin <= r.horasMax, { message: "As horas mínimas não podem ser maiores que as máximas", path: ["horasMax"] })
  .refine((r) => Number(r.percent) >= 0 && Number(r.percent) <= 100, { message: "A percentagem tem de estar entre 0 e 100", path: ["percent"] });

export const targetsUpsertSchema = z.object({
  ano: yearSchema,
  items: z
    .array(
      z.object({
        mes: monthSchema,
        /** Vazio = target global. */
        providerId: z.string().min(1).nullable(),
        aluguerCent: nonNegativeCentsSchema,
        combustivelCent: nonNegativeCentsSchema,
      }),
    )
    .max(12 * 50),
});

export type ProviderCreateInput = z.infer<typeof providerCreateSchema>;
export type ProviderBudgetInput = z.infer<typeof providerBudgetSchema>;
export type RentPriceInput = z.infer<typeof rentPriceSchema>;
export type DiscountRuleInput = z.infer<typeof discountRuleSchema>;
export type TargetsUpsertInput = z.infer<typeof targetsUpsertSchema>;

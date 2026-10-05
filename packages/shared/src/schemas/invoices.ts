import { z } from "zod";
import { monthSchema, nonNegativeCentsSchema, yearSchema } from "./config";

export const INVOICE_TYPES = ["Manutenção", "Material"] as const;
export const INVOICE_STATUSES = ["ABERTO", "ANDAMENTO", "PENDENTE", "FECHADO"] as const;
export const RECORD_STATES = ["RASCUNHO", "SUBMETIDO", "VALIDADO", "FECHADO"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type RecordState = (typeof RECORD_STATES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  ABERTO: "Aberto",
  ANDAMENTO: "Em andamento",
  PENDENTE: "Pendente",
  FECHADO: "Fechado",
};

export const RECORD_STATE_LABELS: Record<RecordState, string> = {
  RASCUNHO: "Rascunho",
  SUBMETIDO: "Submetido",
  VALIDADO: "Validado",
  FECHADO: "Fechado",
};

const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const optionalInt = z
  .union([z.literal(""), z.null(), z.coerce.number().int("Tem de ser um número inteiro").min(0, "Não pode ser negativo")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

/** Campos da inserção — exactamente os do Excel actual (§8). O PO é preenchido pela API. */
export const invoiceCreateSchema = z.object({
  teamId: z.string().min(1, "Escolha a equipa"),
  providerId: z.string().min(1, "Escolha o parceiro"),
  ano: yearSchema,
  mes: monthSchema,
  tipo: z.enum(INVOICE_TYPES, { errorMap: () => ({ message: "Tipo inválido" }) }),
  numeroFactura: optionalText(60),
  dataFacturacao: optionalDate,
  dataExecucao: optionalDate,
  qtdOTs: optionalInt,
  consumiveis: optionalInt,
  valorFTCent: nonNegativeCentsSchema.refine((v) => v !== null, "Indique o valor FT"),
  valorPagoCent: nonNegativeCentsSchema.optional().transform((v) => v ?? BigInt(0)),
  status: z.enum(INVOICE_STATUSES).optional().default("ABERTO"),
  observacao: optionalText(1000),
});

export const invoiceUpdateSchema = z
  .object({
    teamId: z.string().min(1),
    providerId: z.string().min(1),
    ano: yearSchema,
    mes: monthSchema,
    tipo: z.enum(INVOICE_TYPES),
    numeroFactura: optionalText(60),
    dataFacturacao: optionalDate,
    dataExecucao: optionalDate,
    qtdOTs: optionalInt,
    consumiveis: optionalInt,
    valorFTCent: nonNegativeCentsSchema.refine((v) => v !== null, "Indique o valor FT"),
    valorPagoCent: nonNegativeCentsSchema.transform((v) => v ?? BigInt(0)),
    status: z.enum(INVOICE_STATUSES),
    observacao: optionalText(1000),
  })
  .partial();

/** Depois de validada, só se actualizam pagamentos, status e observação. */
export const INVOICE_FIELDS_AFTER_VALIDATION = ["valorPagoCent", "status", "observacao"] as const;


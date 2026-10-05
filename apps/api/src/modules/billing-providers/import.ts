import { Readable } from "stream";
import ExcelJS from "exceljs";
import { InvoiceStatus, PrismaClient } from "@prisma/client";
import { cleanText, MONTHS_FULL, parseExcelDate, toHundredths } from "@cf/shared";
import { toDate } from "../../lib/dates";

/**
 * Importação do "Novo Mapa de Facturação.xlsx" (CLAUDE.md §15, script de migração).
 * - Uma folha por parceiro (ANGLOBAL, BLINDER, COMATEL…) com o cabeçalho
 *   Parceiro | PO | Tipo de pagamento | Mês | Valor Total da FT Mensal | Valor Pago.
 * - A folha PAGAMENTOS acrescenta os detalhes (data de facturação, nº factura, OTs, consumíveis,
 *   data de execução, status e observação), associados por parceiro + ano + valor pago (ou mês da data de facturação).
 */

const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return o.result ?? null;
    if ("formula" in o || "sharedFormula" in o) return null;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return o.text;
    if ("error" in o) return null;
  }
  return v;
}

const MONTH_KEYS = MONTHS_FULL.map((m) => norm(m));

export interface ProviderSheetRow {
  sheet: string;
  line: number;
  parceiro: string;
  po: string | null;
  tipo: string;
  mes: number;
  valorFTCent: bigint;
  valorPagoCent: bigint;
}

export interface PaymentRow {
  line: number;
  prestador: string;
  dataFacturacao: string | null;
  consumiveis: number | null;
  numeroFactura: string | null;
  qtdOTs: number | null;
  tipo: string | null;
  valorPagoCent: bigint | null;
  po: string | null;
  ano: number | null;
  dataExecucao: string | null;
  status: InvoiceStatus | null;
  observacao: string | null;
}

const cents = (v: unknown): bigint | null => {
  if (v === null || v === undefined || v === "") return null;
  const h = toHundredths(typeof v === "number" ? v : String(v));
  return h;
};

const int = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
};

const STATUS: Record<string, InvoiceStatus> = { aberto: "ABERTO", andamento: "ANDAMENTO", pendente: "PENDENTE", fechado: "FECHADO" };

export async function parseProvidersWorkbook(buffer: Buffer) {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    sharedStrings: "cache",
    worksheets: "emit",
    styles: "ignore",
    hyperlinks: "ignore",
    entries: "ignore",
  });
  const invoices: ProviderSheetRow[] = [];
  const payments: PaymentRow[] = [];

  for await (const ws of reader as unknown as AsyncIterable<AsyncIterable<ExcelJS.Row> & { name: string }>) {
    let col: Record<string, number> | null = null;
    let kind: "provider" | "payments" | null = null;
    for await (const row of ws) {
      const values = Array.from(row.values as unknown[], cellValue);
      if (!col) {
        const n = Array.from(values, norm);
        const iFT = n.findIndex((h) => h.startsWith("valortotaldaft"));
        const iPrest = n.indexOf("prestador");
        if (iFT > 0 && n.includes("parceiro")) {
          kind = "provider";
          col = { parceiro: n.indexOf("parceiro"), po: n.indexOf("po"), tipo: n.findIndex((h) => h.startsWith("tipo")), mes: n.indexOf("mes"), ft: iFT, pago: n.findIndex((h) => h.startsWith("valorpago")) };
        } else if (iPrest > 0 && n.some((h) => h.startsWith("datadefacturacao"))) {
          kind = "payments";
          col = {
            data: n.findIndex((h) => h.startsWith("datadefacturacao")),
            prestador: iPrest,
            consumiveis: n.findIndex((h) => h.startsWith("consumiveis")),
            factura: n.findIndex((h) => h.startsWith("factura")),
            ots: n.findIndex((h) => h.startsWith("quantidade")),
            tipo: n.indexOf("tipo"),
            pago: n.findIndex((h) => h.startsWith("valorpago")),
            po: n.indexOf("po"),
            ano: n.indexOf("ano"),
            execucao: n.findIndex((h) => h.startsWith("datadeexecucao")),
            status: n.indexOf("status"),
            obs: n.findIndex((h) => h.startsWith("obeservacao") || h.startsWith("observacao")),
          };
        }
        continue;
      }
      const g = (k: string) => (col![k] > 0 ? values[col![k]] : null);
      if (kind === "provider") {
        const parceiro = cleanText(g("parceiro"));
        const mes = MONTH_KEYS.indexOf(norm(g("mes"))) + 1;
        const ft = cents(g("ft"));
        if (!parceiro || mes < 1 || ft === null || ft === BigInt(0)) continue;
        const poRaw = g("po");
        invoices.push({
          sheet: ws.name,
          line: row.number,
          parceiro,
          po: poRaw === null || poRaw === undefined || norm(poRaw) === "na" ? null : String(poRaw).trim(),
          tipo: cleanText(g("tipo")) ?? "Manutenção",
          mes,
          valorFTCent: ft,
          valorPagoCent: cents(g("pago")) ?? BigInt(0),
        });
      } else if (kind === "payments") {
        const prestador = cleanText(g("prestador"));
        if (!prestador) continue;
        const poRaw = g("po");
        payments.push({
          line: row.number,
          prestador,
          dataFacturacao: parseExcelDate(g("data")),
          consumiveis: int(g("consumiveis")),
          numeroFactura: cleanText(g("factura")),
          qtdOTs: int(g("ots")),
          tipo: cleanText(g("tipo")),
          valorPagoCent: cents(g("pago")),
          po: poRaw === null || norm(poRaw) === "na" ? null : String(poRaw).trim(),
          ano: int(g("ano")),
          dataExecucao: parseExcelDate(g("execucao")),
          status: STATUS[norm(g("status"))] ?? null,
          observacao: cleanText(g("obs")),
        });
      }
    }
  }
  return { invoices, payments };
}

export interface ProvidersImportOptions {
  teamId: string;
  ano: number;
  userId: string;
  /** Estado das facturas importadas (dados históricos: VALIDADO por omissão). */
  state?: "RASCUNHO" | "VALIDADO";
  /** Substitui facturas já existentes para a mesma equipa/parceiro/ano/mês/tipo. */
  replace?: boolean;
}

/** Grava as facturas do ficheiro. Devolve o que foi criado, ignorado e os avisos. */
export async function importProvidersWorkbook(prisma: PrismaClient, buffer: Buffer, opts: ProvidersImportOptions) {
  const { invoices, payments } = await parseProvidersWorkbook(buffer);
  const providers = await prisma.provider.findMany({ select: { id: true, nome: true } });
  const providerOf = (name: string) => {
    const k = norm(name);
    return providers.find((p) => norm(p.nome) === k) ?? providers.find((p) => k.startsWith(norm(p.nome)) || norm(p.nome).startsWith(k)) ?? null;
  };
  const state = opts.state ?? "VALIDADO";
  const report = { criadas: 0, substituidas: 0, ignoradas: 0, avisos: [] as string[], facturas: [] as { parceiro: string; mes: number; valorFTCent: bigint }[] };
  const usedPayments = new Set<number>();

  for (const inv of invoices) {
    const provider = providerOf(inv.parceiro);
    if (!provider) {
      report.avisos.push(`${inv.sheet}!${inv.line}: parceiro "${inv.parceiro}" não existe na plataforma`);
      report.ignoradas++;
      continue;
    }
    // Detalhes da folha PAGAMENTOS: mesmo parceiro e ano; primeiro por valor pago, depois pelo mês da data de facturação.
    const candidates = payments.filter((p) => !usedPayments.has(p.line) && providerOf(p.prestador)?.id === provider.id && (p.ano === null || p.ano === opts.ano));
    const pay =
      candidates.find((p) => p.valorPagoCent !== null && p.valorPagoCent === inv.valorPagoCent && p.valorPagoCent > BigInt(0)) ??
      candidates.find((p) => p.dataFacturacao && Number(p.dataFacturacao.slice(5, 7)) === inv.mes);
    if (pay) usedPayments.add(pay.line);

    const slot = { teamId: opts.teamId, providerId: provider.id, ano: opts.ano, mes: inv.mes, tipo: inv.tipo };
    const existing = await prisma.providerInvoice.count({ where: slot });
    if (existing && !opts.replace) {
      report.avisos.push(`${inv.sheet}!${inv.line}: já existe factura de ${provider.nome} em ${MONTHS_FULL[inv.mes - 1]}/${opts.ano} (use --substituir)`);
      report.ignoradas++;
      continue;
    }
    const data = {
      teamId: opts.teamId,
      providerId: provider.id,
      ano: opts.ano,
      mes: inv.mes,
      po: inv.po ?? pay?.po ?? null,
      tipo: inv.tipo,
      numeroFactura: pay?.numeroFactura ?? null,
      dataFacturacao: pay?.dataFacturacao ? toDate(pay.dataFacturacao) : null,
      dataExecucao: pay?.dataExecucao ? toDate(pay.dataExecucao) : null,
      qtdOTs: pay?.qtdOTs ?? null,
      consumiveis: pay?.consumiveis ?? null,
      valorFTCent: inv.valorFTCent,
      valorPagoCent: inv.valorPagoCent,
      status: pay?.status ?? (inv.valorPagoCent >= inv.valorFTCent ? "FECHADO" : "ABERTO"),
      observacao: pay?.observacao ?? null,
      state,
      createdById: opts.userId,
      validatedById: state === "VALIDADO" ? opts.userId : null,
      validatedAt: state === "VALIDADO" ? new Date() : null,
    } as const;
    if (existing) {
      // Substituir: o mês do ficheiro passa a ser a única factura desse parceiro/mês/tipo na equipa.
      await prisma.$transaction([prisma.providerInvoice.deleteMany({ where: slot }), prisma.providerInvoice.create({ data })]);
      report.substituidas++;
    } else {
      await prisma.providerInvoice.create({ data });
      report.criadas++;
    }
    report.facturas.push({ parceiro: provider.nome, mes: inv.mes, valorFTCent: inv.valorFTCent });
  }
  const unused = payments.filter((p) => !usedPayments.has(p.line) && (p.valorPagoCent ?? BigInt(0)) > BigInt(0));
  for (const p of unused) report.avisos.push(`PAGAMENTOS!${p.line}: pagamento de ${p.prestador} sem factura mensal correspondente`);
  return report;
}

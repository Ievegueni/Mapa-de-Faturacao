/**
 * Regras de cálculo — Providers (CLAUDE.md §8). Funções puras; valores em cêntimos (bigint).
 */

const ZERO = BigInt(0);
const toBig = (v: bigint | string | number | null | undefined): bigint => (v === null || v === undefined || v === "" ? ZERO : BigInt(v));

/** Orçamento anual = mensal × 12. Vazio → null (não calcula remanescente nem %). */
export function annualBudget(monthly: bigint | null): bigint | null {
  return monthly === null ? null : monthly * BigInt(12);
}

/** Dívida = valor FT − valor pago. */
export function debt(valorFT: bigint, valorPago: bigint): bigint {
  return valorFT - valorPago;
}

/** Remanescente = orçamento anual − facturado no ano. Sem orçamento → null. */
export function remaining(annual: bigint | null, facturadoAno: bigint): bigint | null {
  return annual === null ? null : annual - facturadoAno;
}

/** % de execução = facturado / orçamento anual (0–100+, 2 casas). Sem orçamento ou orçamento 0 → null. */
export function executionPercent(facturadoAno: bigint, annual: bigint | null): number | null {
  if (annual === null || annual === ZERO) return null;
  return Number((facturadoAno * BigInt(10000)) / annual) / 100;
}

/** Alerta quando o facturado do mês ultrapassa o orçamento mensal. */
export function isOverMonthlyBudget(facturadoMes: bigint, monthly: bigint | null): boolean {
  return monthly !== null && facturadoMes > monthly;
}

export interface BudgetLike {
  providerId: string;
  teamId: string | null;
  ano: number;
  po: string | null;
  orcamentoMensalCent: bigint | string | null;
}

/**
 * Orçamento aplicável a provider/equipa/ano, campo a campo: o valor da linha da equipa sobrepõe-se;
 * se estiver vazio, herda da linha por omissão (sem equipa). Sem linhas → null.
 */
export function resolveBudget(
  budgets: BudgetLike[],
  providerId: string,
  teamId: string,
  ano: number,
): { po: string | null; orcamentoMensalCent: bigint | null } | null {
  const rows = budgets.filter((b) => b.providerId === providerId && b.ano === ano);
  const team = rows.find((b) => b.teamId === teamId);
  const def = rows.find((b) => b.teamId === null);
  if (!team && !def) return null;
  const orc = team?.orcamentoMensalCent ?? def?.orcamentoMensalCent ?? null;
  return { po: team?.po || def?.po || null, orcamentoMensalCent: orc === null ? null : BigInt(orc) };
}

/**
 * Orçamento mensal de um provider para um conjunto de equipas: soma, por equipa, da linha aplicável.
 * Se nenhuma equipa tiver linha nem houver linha por omissão → null.
 */
export function monthlyBudgetFor(budgets: BudgetLike[], providerId: string, teamIds: string[], ano: number): bigint | null {
  if (teamIds.length === 0) {
    const def = budgets.find((b) => b.providerId === providerId && b.ano === ano && b.teamId === null);
    return def && def.orcamentoMensalCent !== null ? BigInt(def.orcamentoMensalCent) : null;
  }
  let total = ZERO;
  let any = false;
  for (const teamId of teamIds) {
    const b = resolveBudget(budgets, providerId, teamId, ano);
    if (b && b.orcamentoMensalCent !== null) {
      total += b.orcamentoMensalCent;
      any = true;
    }
  }
  return any ? total : null;
}

export interface InvoiceLike {
  providerId: string;
  mes: number;
  valorFTCent: bigint | string;
  valorPagoCent: bigint | string;
}

export interface ProviderSummary {
  providerId: string;
  /** Índice 0 = Janeiro. */
  facturadoMes: bigint[];
  pagoMes: bigint[];
  orcamentoMensal: bigint | null;
  orcamentoAnual: bigint | null;
  facturadoAno: bigint;
  pagoAno: bigint;
  divida: bigint;
  remanescente: bigint | null;
  execucaoPercent: number | null;
  /** Meses (1–12) em que o facturado ultrapassa o orçamento mensal. */
  mesesAcimaOrcamento: number[];
}

/** Resumo anual mês × provider (substitui a folha de resumo do Excel). */
export function summarizeProviders(
  invoices: InvoiceLike[],
  providerIds: string[],
  monthlyBudget: (providerId: string) => bigint | null,
): { providers: ProviderSummary[]; totalMes: bigint[]; totalAno: bigint; pagoAno: bigint; dividaAno: bigint } {
  const providers = providerIds.map<ProviderSummary>((providerId) => {
    const facturadoMes = Array.from({ length: 12 }, () => ZERO);
    const pagoMes = Array.from({ length: 12 }, () => ZERO);
    for (const inv of invoices) {
      if (inv.providerId !== providerId || inv.mes < 1 || inv.mes > 12) continue;
      facturadoMes[inv.mes - 1] += toBig(inv.valorFTCent);
      pagoMes[inv.mes - 1] += toBig(inv.valorPagoCent);
    }
    const facturadoAno = facturadoMes.reduce((a, b) => a + b, ZERO);
    const pagoAno = pagoMes.reduce((a, b) => a + b, ZERO);
    const orcamentoMensal = monthlyBudget(providerId);
    const orcamentoAnual = annualBudget(orcamentoMensal);
    return {
      providerId,
      facturadoMes,
      pagoMes,
      orcamentoMensal,
      orcamentoAnual,
      facturadoAno,
      pagoAno,
      divida: debt(facturadoAno, pagoAno),
      remanescente: remaining(orcamentoAnual, facturadoAno),
      execucaoPercent: executionPercent(facturadoAno, orcamentoAnual),
      mesesAcimaOrcamento: facturadoMes.map((v, i) => (isOverMonthlyBudget(v, orcamentoMensal) ? i + 1 : 0)).filter(Boolean),
    };
  });

  const totalMes = Array.from({ length: 12 }, (_, i) => providers.reduce((a, p) => a + p.facturadoMes[i], ZERO));
  const totalAno = providers.reduce((a, p) => a + p.facturadoAno, ZERO);
  const pagoAno = providers.reduce((a, p) => a + p.pagoAno, ZERO);
  return { providers, totalMes, totalAno, pagoAno, dividaAno: debt(totalAno, pagoAno) };
}

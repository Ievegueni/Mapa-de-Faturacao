import { describe, expect, it } from "vitest";
import {
  annualBudget,
  debt,
  executionPercent,
  isOverMonthlyBudget,
  monthlyBudgetFor,
  remaining,
  resolveBudget,
  summarizeProviders,
} from "./providers";

const B = (v: number | string) => BigInt(v);

describe("regras de providers (§8)", () => {
  it("orçamento anual, dívida, remanescente e % de execução", () => {
    expect(annualBudget(B(295000000))).toBe(B(3540000000));
    expect(annualBudget(null)).toBeNull();
    expect(debt(B(66000000), B(50000000))).toBe(B(16000000));
    expect(remaining(B(3540000000), B(124854942))).toBe(B(3415145058));
    expect(remaining(null, B(10))).toBeNull();
    expect(executionPercent(B(124854942), B(3540000000))).toBe(3.52);
    expect(executionPercent(B(10), null)).toBeNull();
    expect(executionPercent(B(10), B(0))).toBeNull();
  });

  it("alerta quando o mês ultrapassa o orçamento mensal", () => {
    expect(isOverMonthlyBudget(B(295000001), B(295000000))).toBe(true);
    expect(isOverMonthlyBudget(B(295000000), B(295000000))).toBe(false);
    expect(isOverMonthlyBudget(B(999), null)).toBe(false);
  });

  it("orçamento aplicável: equipa sobrepõe-se ao por omissão; soma por equipas", () => {
    const budgets = [
      { providerId: "a", teamId: null, ano: 2026, po: "PO-DEF", orcamentoMensalCent: "100" },
      { providerId: "a", teamId: "t1", ano: 2026, po: "PO-T1", orcamentoMensalCent: "30" },
      { providerId: "a", teamId: null, ano: 2025, po: "OLD", orcamentoMensalCent: "1" },
    ];
    expect(resolveBudget(budgets, "a", "t1", 2026)?.po).toBe("PO-T1");
    expect(resolveBudget(budgets, "a", "t2", 2026)?.po).toBe("PO-DEF");
    expect(resolveBudget(budgets, "b", "t1", 2026)).toBeNull();
    // Campo vazio na linha da equipa herda da linha por omissão
    const partial = [...budgets, { providerId: "a", teamId: "t3", ano: 2026, po: null, orcamentoMensalCent: "50" }];
    expect(resolveBudget(partial, "a", "t3", 2026)).toEqual({ po: "PO-DEF", orcamentoMensalCent: BigInt(50) });
    const noOrc = [...budgets, { providerId: "a", teamId: "t4", ano: 2026, po: "PO-T4", orcamentoMensalCent: null }];
    expect(resolveBudget(noOrc, "a", "t4", 2026)).toEqual({ po: "PO-T4", orcamentoMensalCent: BigInt(100) });
    expect(monthlyBudgetFor(budgets, "a", ["t1", "t2"], 2026)).toBe(B(130));
    expect(monthlyBudgetFor(budgets, "a", [], 2026)).toBe(B(100));
    expect(monthlyBudgetFor(budgets, "a", ["t1"], 2024)).toBeNull();
  });
});

describe("summarizeProviders", () => {
  // Valores de referência da app actual: Anglobal Julho 660.000,00; Agosto 588.549,42.
  const invoices = [
    { providerId: "anglobal", mes: 7, valorFTCent: "40000000", valorPagoCent: "40000000" },
    { providerId: "anglobal", mes: 7, valorFTCent: "26000000", valorPagoCent: "0" },
    { providerId: "anglobal", mes: 8, valorFTCent: "58854942", valorPagoCent: "10000000" },
    { providerId: "blinder", mes: 8, valorFTCent: "300000000", valorPagoCent: "0" },
  ];
  const budget = (id: string) => (id === "comatel" ? null : B(295000000));
  const s = summarizeProviders(invoices, ["anglobal", "blinder", "comatel"], budget);

  it("totais por mês e por provider", () => {
    const a = s.providers[0];
    expect(a.facturadoMes[6]).toBe(B(66000000));
    expect(a.facturadoMes[7]).toBe(B(58854942));
    expect(a.facturadoAno).toBe(B(124854942));
    expect(a.pagoAno).toBe(B(50000000));
    expect(a.divida).toBe(B(74854942));
    expect(a.orcamentoAnual).toBe(B(3540000000));
    expect(a.remanescente).toBe(B(3415145058));
    expect(a.mesesAcimaOrcamento).toEqual([]);
    expect(s.totalMes[7]).toBe(B(358854942));
    expect(s.totalAno).toBe(B(424854942));
  });

  it("alerta de mês acima do orçamento e provider sem orçamento", () => {
    expect(s.providers[1].mesesAcimaOrcamento).toEqual([8]);
    const c = s.providers[2];
    expect(c.orcamentoAnual).toBeNull();
    expect(c.remanescente).toBeNull();
    expect(c.execucaoPercent).toBeNull();
    expect(c.facturadoAno).toBe(B(0));
  });
});

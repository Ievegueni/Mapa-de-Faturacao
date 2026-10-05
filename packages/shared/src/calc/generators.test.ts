import { describe, expect, it } from "vitest";
import { toHundredths } from "./decimal";
import {
  calculateMeasurement,
  findDiscountPercent,
  MeasurementInput,
  selectDiscountBands,
  selectByValidity,
  selectRentPrice,
} from "./generators";
import { normalizeRegiao, parseExcelDate, parsePotencia, parseSimNao } from "./normalize";

const B = (v: number | string) => BigInt(v);

// Faixas do seed (CLAUDE.md §15)
const bands = [
  { horasMin: 0, horasMax: 5, percent: "0" },
  { horasMin: 6, horasMax: 11, percent: "35" },
  { horasMin: 12, horasMax: 17, percent: "45" },
  { horasMin: 18, horasMax: 24, percent: "55" },
];

const base = (over: Partial<MeasurementInput>): MeasurementInput => ({
  dias: 31,
  horasN1: "0",
  horasN: "0",
  litros: "0",
  precoCombustivelCent: "42000",
  precoServAbastCent: "4800",
  precoAluguerDiaCent: "1500000",
  precoManutencaoCent: null,
  ...over,
});

/**
 * Linhas ilustrativas no formato do Auto de Medição de Agosto de 2026 (combustível 420,00; serviço 48,00).
 * Valores esperados calculados à parte com aritmética decimal exacta.
 * TODO: substituir/completar com linhas reais do Auto de Medição quando o ficheiro estiver disponível.
 */
const rows: [string, Partial<MeasurementInput>, { ht: number; hr: number; pct: string; comb: number; serv: number; alug: number; desc: number; total: number }][] = [
  ["R01", { horasN1: "12450.00", horasN: "12822.00", litros: "620.50" }, { ht: 12, hr: 12, pct: "45.00", comb: 26061000, serv: 2978400, alug: 46500000, desc: 20925000, total: 54614400 }],
  ["R02", { horasN1: "8800.00", horasN: "8862.00", litros: "110.00" }, { ht: 2, hr: 22, pct: "55.00", comb: 4620000, serv: 528000, alug: 46500000, desc: 25575000, total: 26073000 }],
  ["R03", { horasN1: "3300.00", horasN: "3920.00", litros: "980.25", precoAluguerDiaCent: "1800000" }, { ht: 20, hr: 4, pct: "0.00", comb: 41170500, serv: 4705200, alug: 55800000, desc: 0, total: 101675700 }],
  ["R04", { dias: 30, horasN1: "15000.00", horasN: "15100.50", litros: "150.00", servExtrasCent: "2500000" }, { ht: 3, hr: 21, pct: "55.00", comb: 6300000, serv: 720000, alug: 45000000, desc: 24750000, total: 29770000 }],
  ["R05", { horasN1: "20010.00", horasN: "20444.00", litros: "700.00", precoAluguerDiaCent: "2200000", precoManutencaoCent: "3000000" }, { ht: 14, hr: 10, pct: "35.00", comb: 29400000, serv: 3360000, alug: 68200000, desc: 23870000, total: 80090000 }],
  ["R06", { horasN1: "500.00", horasN: "500.00", litros: "0" }, { ht: 0, hr: 24, pct: "55.00", comb: 0, serv: 0, alug: 46500000, desc: 25575000, total: 20925000 }],
  ["R07", { horasN1: "7000.00", horasN: "7186.00", litros: "300.75", penSLACent: "1000000" }, { ht: 6, hr: 18, pct: "55.00", comb: 12631500, serv: 1443600, alug: 46500000, desc: 25575000, total: 34000100 }],
  ["R08", { dias: 15, horasN1: "1000.00", horasN: "1090.00", litros: "95.50" }, { ht: 6, hr: 18, pct: "55.00", comb: 4011000, serv: 458400, alug: 22500000, desc: 12375000, total: 14594400 }],
  ["R09", { horasN1: "4000.00", horasN: "4744.00", litros: "1200.00", precoAluguerDiaCent: "2500000", penAvariaCent: "500000" }, { ht: 24, hr: 0, pct: "0.00", comb: 50400000, serv: 5760000, alug: 77500000, desc: 0, total: 133160000 }],
  ["R10", { horasN1: "9000.00", horasN: "9279.00", litros: "455.30" }, { ht: 9, hr: 15, pct: "45.00", comb: 19122600, serv: 2185440, alug: 46500000, desc: 20925000, total: 46883040 }],
];

describe("calculateMeasurement — linhas do Auto de Medição", () => {
  it.each(rows)("%s", (_name, input, e) => {
    const r = calculateMeasurement(base(input), { bands });
    expect(r.horasTrabalhadas).toBe(e.ht);
    expect(r.horasRede).toBe(e.hr);
    expect(r.descontoPercent).toBe(e.pct);
    expect(r.combustivelCent).toBe(B(e.comb));
    expect(r.servAbastCent).toBe(B(e.serv));
    expect(r.abastecimentoCent).toBe(B(e.comb + e.serv));
    expect(r.aluguerCent).toBe(B(e.alug));
    expect(r.descontoRedeCent).toBe(B(e.desc));
    expect(r.totalCent).toBe(B(e.total));
    expect(r.flags).toEqual([]);
  });

  it("aceita Decimal do Prisma, números e vírgula decimal", () => {
    const dec = { toString: () => "620.5" };
    const a = calculateMeasurement(base({ horasN1: 12450, horasN: "12822,00", litros: dec }), { bands });
    expect(a.combustivelCent).toBe(B(26061000));
    expect(a.horasTrabalhadas).toBe(12);
  });
});

describe("casos-limite", () => {
  it("horas negativas: flag, sem desconto e sem 'fora das faixas'", () => {
    const r = calculateMeasurement(base({ horasN1: "1000", horasN: "900" }), { bands });
    expect(r.flags).toEqual(["HORAS_NEGATIVAS"]);
    expect(r.horasTrabalhadas).toBe(-4); // floor(-100/31)
    expect(r.horasRede).toBe(28);
    expect(r.descontoRedeCent).toBe(B(0));
    expect(r.descontoPercent).toBe("0.00");
  });

  it("dias 0, vazios, negativos, decimais ou > 31: DIAS_INVALIDOS sem dividir por zero", () => {
    const zero = calculateMeasurement(base({ dias: 0, horasN1: "0", horasN: "100", litros: "10" }), { bands });
    expect(zero.flags).toContain("DIAS_INVALIDOS");
    expect(zero.horasTrabalhadas).toBeNull();
    expect(zero.horasRede).toBeNull();
    expect(zero.aluguerCent).toBe(B(0));
    expect(zero.combustivelCent).toBe(B(420000));
    expect(zero.flags).not.toContain("SEM_PRECO_ALUGUER");
    expect(calculateMeasurement(base({ dias: null }), { bands }).flags).toContain("DIAS_INVALIDOS");
    expect(calculateMeasurement(base({ dias: -3 }), { bands }).aluguerCent).toBe(B(0));
    const big = calculateMeasurement(base({ dias: 32 }), { bands });
    expect(big.flags).toContain("DIAS_INVALIDOS");
    expect(big.aluguerCent).toBe(B(48000000));
  });

  it("limites das faixas (5/6, 11/12, 17/18, 24) e fora das faixas", () => {
    expect(findDiscountPercent(5, bands)).toBe(B(0));
    expect(findDiscountPercent(6, bands)).toBe(B(3500));
    expect(findDiscountPercent(11, bands)).toBe(B(3500));
    expect(findDiscountPercent(12, bands)).toBe(B(4500));
    expect(findDiscountPercent(17, bands)).toBe(B(4500));
    expect(findDiscountPercent(18, bands)).toBe(B(5500));
    expect(findDiscountPercent(24, bands)).toBe(B(5500));
    expect(findDiscountPercent(25, bands)).toBeNull();
    expect(findDiscountPercent(-1, bands)).toBeNull();
    // 31 dias × 25 h/dia = 775 h → horasRede −1 → fora das faixas
    const r = calculateMeasurement(base({ horasN1: "0", horasN: "775" }), { bands });
    expect(r.horasRede).toBe(-1);
    expect(r.flags).toEqual(["HORAS_FORA_INTERVALO"]);
    expect(r.descontoRedeCent).toBe(B(0));
    // Sem faixas configuradas → fora das faixas, desconto 0
    expect(calculateMeasurement(base({ horasN: "31" }), { bands: [] }).flags).toEqual(["HORAS_FORA_INTERVALO"]);
  });

  it("floor nas horas por dia: 185,99 h em 31 dias → 5 h", () => {
    const r = calculateMeasurement(base({ horasN1: "0", horasN: "185.99" }), { bands });
    expect(r.horasTrabalhadas).toBe(5);
    expect(r.horasRede).toBe(19);
  });

  it("preços vazios contam como 0 e geram flags (combustível só com litros)", () => {
    const r = calculateMeasurement(
      base({ litros: "100", precoCombustivelCent: null, precoServAbastCent: "", precoAluguerDiaCent: null, horasN: "310" }),
      { bands },
    );
    expect(r.flags).toEqual(["SEM_PRECO_ALUGUER", "SEM_PRECO_COMBUSTIVEL", "SEM_PRECO_SERV_ABAST"]);
    expect(r.totalCent).toBe(B(0));
    const noLitros = calculateMeasurement(base({ litros: null, precoCombustivelCent: null, horasN: "310" }), { bands });
    expect(noLitros.flags).toEqual([]);
  });

  it("horas em falta: sem horas nem desconto, sem flag", () => {
    const r = calculateMeasurement(base({ horasN1: null, horasN: "100" }), { bands });
    expect(r.horasTrabalhadas).toBeNull();
    expect(r.descontoPercent).toBeNull();
    expect(r.descontoRedeCent).toBe(B(0));
    expect(r.totalCent).toBe(B(46500000));
  });

  it("penalizações e extras em branco não afectam o total; preenchidas descontam", () => {
    const a = calculateMeasurement(base({ horasN: "310" }), { bands });
    const b = calculateMeasurement(
      base({ horasN: "310", servExtrasCent: "100", penExcessoHorasCent: "10", penSLACent: "20", penNivelCombustCent: "30", penAvariaCent: "40" }),
      { bands },
    );
    expect(b.penalizacoesCent).toBe(B(100));
    expect(b.totalCent - a.totalCent).toBe(B(0));
  });

  it("arredondamento ao cêntimo: 0,01 L × 48,50 = 0,49 (meio para cima)", () => {
    const r = calculateMeasurement(base({ litros: "0.01", precoServAbastCent: "4850" }), { bands });
    expect(r.servAbastCent).toBe(B(49));
  });

  it("litros acima de 2× a média dos últimos 3 meses e gerador removido", () => {
    const r = calculateMeasurement(base({ horasN: "310", litros: "601" }), { bands, mediaLitros3m: "300", geradorRemovido: true });
    expect(r.flags).toEqual(["LITROS_ACIMA_MEDIA", "GERADOR_REMOVIDO"]);
    expect(calculateMeasurement(base({ horasN: "310", litros: "600" }), { bands, mediaLitros3m: "300" }).flags).toEqual([]);
    expect(calculateMeasurement(base({ horasN: "310", litros: "600" }), { bands, mediaLitros3m: null }).flags).toEqual([]);
  });
});

describe("escolha do preço de aluguer", () => {
  const rentRows = [
    { id: "p20", potenciaKVA: 20, subtipo: null, distancia: null, precoDiaCent: "1500000" },
    { id: "p20-macro", potenciaKVA: 20, subtipo: "Macro", distancia: null, precoDiaCent: "1600000" },
    { id: "p20-macro-50", potenciaKVA: 20, subtipo: "Macro", distancia: "> 50 km", precoDiaCent: "1700000" },
    { id: "p40-micro", potenciaKVA: 40, subtipo: "Micro", distancia: null, precoDiaCent: "2000000" },
  ];

  it("correspondência exacta → linha mais específica", () => {
    expect(selectRentPrice(rentRows, { potenciaKVA: 20, subtipo: "macro ", distancia: "> 50 km" })).toMatchObject({ row: { id: "p20-macro-50" }, match: "exacta" });
    expect(selectRentPrice(rentRows, { potenciaKVA: 20, subtipo: "Macro", distancia: null })).toMatchObject({ row: { id: "p20-macro" }, match: "exacta" });
  });

  it("linha genérica (subtipo/distância vazios) quando não há específica", () => {
    expect(selectRentPrice(rentRows, { potenciaKVA: 20, subtipo: "Micro", distancia: "< 50 km" })).toMatchObject({ row: { id: "p20" }, match: "potencia" });
    expect(selectRentPrice(rentRows, { potenciaKVA: 20, subtipo: "Macro", distancia: "< 50 km" })).toMatchObject({ row: { id: "p20-macro" }, match: "potencia" });
  });

  it("só potência quando nenhuma linha é compatível; sem potência ou sem linha → sem preço", () => {
    expect(selectRentPrice(rentRows, { potenciaKVA: 40, subtipo: "Macro", distancia: null })).toMatchObject({ row: { id: "p40-micro" }, match: "potencia" });
    expect(selectRentPrice(rentRows, { potenciaKVA: 60, subtipo: null, distancia: null })).toEqual({ row: null, match: null });
    expect(selectRentPrice(rentRows, { potenciaKVA: null, subtipo: null, distancia: null })).toEqual({ row: null, match: null });
  });
});

describe("vigências", () => {
  it("tabela de preços e faixas em vigor no mês", () => {
    const tables = [{ id: "a", validFrom: "2026-01-01" }, { id: "b", validFrom: "2026-07-01" }, { id: "c", validFrom: "2026-09-01" }];
    expect(selectByValidity(tables, new Date("2026-08-01"))?.id).toBe("b");
    expect(selectByValidity(tables, new Date("2025-12-01"))).toBeNull();
    const rules = [
      { horasMin: 6, horasMax: 11, percent: "35", validFrom: "2026-01-01" },
      { horasMin: 0, horasMax: 5, percent: "0", validFrom: "2026-01-01" },
      { horasMin: 0, horasMax: 24, percent: "10", validFrom: "2027-01-01" },
    ];
    expect(selectDiscountBands(rules, new Date("2026-08-01")).map((r) => r.horasMin)).toEqual([0, 6]);
  });
});

describe("normalização", () => {
  it("potência em texto, SIM/NÃO, região e datas do Excel", () => {
    expect(parsePotencia("20 kVA")).toBe(20);
    expect(parsePotencia("20KVA")).toBe(20);
    expect(parsePotencia(" 27,5 ")).toBe(28);
    expect(parsePotencia(40)).toBe(40);
    expect(parsePotencia("—")).toBeNull();
    expect(parseSimNao("SIM")).toBe(true);
    expect(parseSimNao("Não ")).toBe(false);
    expect(parseSimNao("NAO")).toBe(false);
    expect(parseSimNao("talvez")).toBeNull();
    expect(normalizeRegiao("Sul ")).toBe("Sul");
    expect(normalizeRegiao("LESTE")).toBe("Leste");
    expect(normalizeRegiao("Oeste")).toBeNull();
    expect(parseExcelDate(46234)).toBe("2026-07-31");
    expect(parseExcelDate("05/08/2026")).toBe("2026-08-05");
    expect(parseExcelDate(new Date(Date.UTC(2026, 7, 1)))).toBe("2026-08-01");
    expect(parseExcelDate("x")).toBeNull();
  });

  it("decimais em centésimas", () => {
    expect(toHundredths("620.505")).toBe(B(62051));
    expect(toHundredths("-1,5")).toBe(B(-150));
    expect(toHundredths("")).toBeNull();
    expect(toHundredths("abc")).toBeNull();
  });
});

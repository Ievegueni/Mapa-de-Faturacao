import { describe, expect, it } from "vitest";
import { escalaoHoras, monthSummary, validationsYear, ValidationMonthInput, zonaOf } from "./summary";

const B = (v: number | string) => BigInt(v);

describe("Resumo do mês", () => {
  const rows = [
    // Luanda, validada
    { provincia: "Luanda", validado: true, aluguerCent: "1000000", descontoRedeCent: "350000", manutencaoCent: "50000", servExtrasCent: null, penalizacoesCent: "0", combustivelCent: "4200000", servAbastCent: "480000" },
    // Província, validada, com penalização e extras
    { provincia: "Huíla", validado: true, aluguerCent: "2000000", descontoRedeCent: "0", manutencaoCent: null, servExtrasCent: "100000", penalizacoesCent: "200000", combustivelCent: "840000", servAbastCent: "96000" },
    // Província, por validar
    { provincia: "Benguela ", validado: false, aluguerCent: "500000", descontoRedeCent: "0", manutencaoCent: null, servExtrasCent: null, penalizacoesCent: "0", combustivelCent: "420000", servAbastCent: "48000" },
  ];

  it("zona: Luanda ou Província", () => {
    expect(zonaOf("Luanda")).toBe("Luanda");
    expect(zonaOf(" luanda ")).toBe("Luanda");
    expect(zonaOf("Huíla")).toBe("Província");
    expect(zonaOf(null)).toBe("Província");
  });

  it("categorias × zona: validado, diferença, IVA (sem IVA no combustível) e total + IVA", () => {
    const s = monthSummary(rows, "14");
    const line = (c: string, z: string) => s.linhas.find((l) => l.categoria === c && l.zona === z)!;
    // Aluguer Luanda = 1.000.000 − 350.000 + 50.000 = 700.000 (cêntimos 700000)
    expect(line("Aluguer", "Luanda")).toMatchObject({ facturado: B(700000), validado: B(700000), diferenca: B(0), iva: B(98000), totalComIva: B(798000) });
    // Aluguer Província = (2.000.000 + 100.000 − 200.000) validado + 500.000 por validar
    expect(line("Aluguer", "Província")).toMatchObject({ facturado: B(2400000), validado: B(1900000), diferenca: B(500000), iva: B(266000) });
    expect(line("Combustível", "Província")).toMatchObject({ validado: B(840000), iva: B(0), totalComIva: B(840000), diferenca: B(420000) });
    expect(line("Serviço de Abastecimento", "Luanda")).toMatchObject({ validado: B(480000), iva: B(67200), totalComIva: B(547200) });
    // As três categorias somam o total das medições (aluguer+manut+extras+abastecimento−desconto−penalizações)
    expect(s.total.facturado).toBe(B(700000 + 4200000 + 480000 + 1900000 + 840000 + 96000 + 500000 + 420000 + 48000));
    expect(s.ivaEmFalta).toBe(false);
  });

  it("IVA vazio → aviso e IVA 0", () => {
    const s = monthSummary(rows, null);
    expect(s.ivaEmFalta).toBe(true);
    expect(s.total.iva).toBe(B(0));
    expect(s.total.totalComIva).toBe(s.total.validado);
  });

  it("IVA com casas decimais e arredondamento ao cêntimo", () => {
    const s = monthSummary([{ ...rows[0], aluguerCent: "333", descontoRedeCent: "0", manutencaoCent: null }], "14.5");
    expect(s.linhas.find((l) => l.categoria === "Aluguer" && l.zona === "Luanda")!.iva).toBe(B(48)); // 333 × 14,5% = 48,285
  });
});

describe("escalões de horas acumuladas (excesso de horas)", () => {
  it("limites 35040 / 36480 / 37920", () => {
    expect(escalaoHoras(35039.99)).toBeNull();
    expect(escalaoHoras("35040")).toBe("40");
    expect(escalaoHoras(36479.99)).toBe("40");
    expect(escalaoHoras(36480)).toBe("60");
    expect(escalaoHoras(37920)).toBe("100");
    expect(escalaoHoras(null)).toBeNull();
  });
});

describe("Mapa Resumo de Validações", () => {
  const cv = (n = 0, v = 0) => ({ n, valor: B(v) });
  const month = (mes: number, over: Partial<ValidationMonthInput> = {}): ValidationMonthInput => ({
    mes,
    temMapa: true,
    penSLA: cv(),
    penNivelCombust: cv(),
    penAvaria: cv(),
    penExcessoHoras: cv(),
    penHoras: { "40": cv(), "60": cv(), "100": cv() },
    parqueTotal: 1152,
    parquePorPotencia: { "15": 543, "20": 575, "30": 30, "45": 4 },
    aluguerCent: B(0),
    descontoRedeCent: B(0),
    manutencaoCent: B(0),
    litros: "0",
    combustivelCent: B(0),
    servAbastCent: B(0),
    indicadores: null,
    globalAluguerManutCent: B(0),
    globalAbastecimentoCent: B(0),
    ...over,
  });
  const none = () => ({ aluguerCent: null, combustivelCent: null });

  it("penalizações, aluguer e manutenção, abastecimento, totais e transporte extra", () => {
    const y = validationsYear(
      [
        month(8, {
          penSLA: cv(2, 100000),
          penNivelCombust: cv(1, 50000),
          penExcessoHoras: cv(4, 100000),
          penHoras: { "40": cv(3, 30000), "60": cv(), "100": cv(1, 70000) },
          aluguerCent: B(10000000),
          descontoRedeCent: B(3500000),
          manutencaoCent: B(500000),
          litros: "509812.49",
          combustivelCent: B(21412124580),
          servAbastCent: B(2447099952),
          indicadores: { sitesRedePublica: 690, sitesRedeConfiguradosNetEco: 299, sitesRedeSemGarantia: 101, poupancaCent: B(1000), transporteExtraCent: B(250000) },
        }),
      ],
      { provider: none, global: none },
    );
    const ago = y[7];
    if (!ago.temMapa) throw new Error("sem mapa");
    expect(ago.penalizacoesGlobal).toBe(B(250000));
    expect(ago.subtotalPenalizacoesPoupanca).toBe(B(251000));
    expect(ago.aluguerManutCent).toBe(B(7000000));
    expect(ago.abastecimentoCent).toBe(B(23859224532));
    expect(ago.totalParcialCent).toBe(B(23866224532));
    expect(ago.totalGlobalCent).toBe(B(23866474532));
    expect(ago.litros).toBe("509812.49");
    expect(ago.variacaoAluguerManut).toEqual({ abs: null, percent: null });
    expect(y[6].temMapa).toBe(false);
  });

  it("variações mensais (absolutas e % do mês anterior) e divisão por zero → null", () => {
    const y = validationsYear(
      [month(6, { aluguerCent: B(0) }), month(7, { aluguerCent: B(1000), litros: "10" }), month(8, { aluguerCent: B(1500), litros: "7.5" })],
      { provider: none, global: none },
    );
    const jul = y[6];
    const ago = y[7];
    if (!jul.temMapa || !ago.temMapa) throw new Error("sem mapa");
    expect(jul.variacaoAluguerManut).toEqual({ abs: B(1000), percent: null }); // Junho = 0
    expect(ago.variacaoAluguerManut).toEqual({ abs: B(500), percent: 50 });
    expect(ago.variacaoLitros).toBe("-2.50");
  });

  it("targets do provider e global: desvio em valor e em %", () => {
    const y = validationsYear([month(8, { aluguerCent: B(54184806011), globalAluguerManutCent: B(100), combustivelCent: B(30000000000), globalAbastecimentoCent: B(0) })], {
      provider: () => ({ aluguerCent: B(54184806011), combustivelCent: B(30909147775) }), // targets reais do Mapa Resumo
      global: (mes) => (mes === 8 ? { aluguerCent: B(80), combustivelCent: B(0) } : { aluguerCent: null, combustivelCent: null }),
    });
    const ago = y[7];
    if (!ago.temMapa) throw new Error("sem mapa");
    expect(ago.targets.providerAluguerManut).toEqual({ target: B(54184806011), valor: B(54184806011), desvio: B(0), desvioPercent: 0 });
    expect(ago.targets.providerAbastecimento.desvio).toBe(B(-909147775));
    expect(ago.targets.providerAbastecimento.desvioPercent).toBe(-2.94);
    expect(ago.targets.globalAluguerManut).toEqual({ target: B(80), valor: B(100), desvio: B(20), desvioPercent: 25 });
    expect(ago.targets.globalAbastecimento.desvioPercent).toBeNull(); // target 0
  });
});

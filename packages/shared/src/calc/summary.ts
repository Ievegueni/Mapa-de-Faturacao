/**
 * Resumo do mês e Mapa Resumo de Validações (CLAUDE.md §7). Funções puras; valores em cêntimos.
 */
import { divRound, hundredthsToString, toHundredths } from "./decimal";

const ZERO = BigInt(0);
const big = (v: bigint | string | number | null | undefined) => (v === null || v === undefined || v === "" ? ZERO : BigInt(v));

// ---------------------------------------------------------------------------
// Resumo do mês (substitui a folha "Resumo")
// ---------------------------------------------------------------------------

export type Zona = "Luanda" | "Província";
export type Categoria = "Aluguer" | "Combustível" | "Serviço de Abastecimento";
export const CATEGORIAS: Categoria[] = ["Aluguer", "Combustível", "Serviço de Abastecimento"];
export const ZONAS: Zona[] = ["Província", "Luanda"];

/** Zona = Luanda se a província for Luanda; caso contrário Província. */
export const zonaOf = (provincia: string | null | undefined): Zona =>
  (provincia ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase() === "luanda" ? "Luanda" : "Província";

export interface SummaryMeasurement {
  provincia: string;
  validado: boolean;
  aluguerCent: bigint | string;
  descontoRedeCent: bigint | string;
  /** Valor de manutenção aplicado (snapshot do preço). */
  manutencaoCent: bigint | string | null;
  servExtrasCent: bigint | string | null;
  penalizacoesCent: bigint | string;
  combustivelCent: bigint | string;
  servAbastCent: bigint | string;
}

export interface MonthSummaryLine {
  categoria: Categoria;
  zona: Zona;
  facturado: bigint;
  validado: bigint;
  diferenca: bigint;
  iva: bigint;
  totalComIva: bigint;
}

/**
 * Agregação por categoria e zona.
 * - Aluguer = aluguer − desconto de rede + manutenção + serviços extras − penalizações
 *   (as três categorias somam o total do mapa).
 * - Facturado = todas as medições do mapa; Validado = medições validadas ou fechadas; Diferença = facturado − validado.
 * - IVA (taxa da tabela de preços) sobre Aluguer e Serviço de Abastecimento, calculado sobre o validado. O combustível não leva IVA.
 */
export function monthSummary(rows: SummaryMeasurement[], ivaPercent: string | number | null) {
  const ivaH = toHundredths(ivaPercent ?? null);
  const lines: MonthSummaryLine[] = [];
  const acc = new Map<string, { f: bigint; v: bigint }>();
  const add = (c: Categoria, z: Zona, value: bigint, validado: boolean) => {
    const k = `${c}|${z}`;
    const cur = acc.get(k) ?? { f: ZERO, v: ZERO };
    cur.f += value;
    if (validado) cur.v += value;
    acc.set(k, cur);
  };
  for (const r of rows) {
    const z = zonaOf(r.provincia);
    const aluguer = big(r.aluguerCent) - big(r.descontoRedeCent) + big(r.manutencaoCent) + big(r.servExtrasCent) - big(r.penalizacoesCent);
    add("Aluguer", z, aluguer, r.validado);
    add("Combustível", z, big(r.combustivelCent), r.validado);
    add("Serviço de Abastecimento", z, big(r.servAbastCent), r.validado);
  }
  for (const c of CATEGORIAS) {
    for (const z of ZONAS) {
      const a = acc.get(`${c}|${z}`) ?? { f: ZERO, v: ZERO };
      const iva = c === "Combustível" || ivaH === null ? ZERO : divRound(a.v * ivaH, BigInt(10000));
      lines.push({ categoria: c, zona: z, facturado: a.f, validado: a.v, diferenca: a.f - a.v, iva, totalComIva: a.v + iva });
    }
  }
  const sum = (pick: (l: MonthSummaryLine) => bigint, filter: (l: MonthSummaryLine) => boolean = () => true) =>
    lines.filter(filter).reduce((s, l) => s + pick(l), ZERO);
  const totaisCategoria = CATEGORIAS.map((c) => ({
    categoria: c,
    facturado: sum((l) => l.facturado, (l) => l.categoria === c),
    validado: sum((l) => l.validado, (l) => l.categoria === c),
    diferenca: sum((l) => l.diferenca, (l) => l.categoria === c),
    iva: sum((l) => l.iva, (l) => l.categoria === c),
    totalComIva: sum((l) => l.totalComIva, (l) => l.categoria === c),
  }));
  return {
    linhas: lines,
    totaisCategoria,
    total: {
      facturado: sum((l) => l.facturado),
      validado: sum((l) => l.validado),
      diferenca: sum((l) => l.diferenca),
      iva: sum((l) => l.iva),
      totalComIva: sum((l) => l.totalComIva),
    },
    /** IVA vazio na tabela de preços: assume 0 e a interface mostra aviso. */
    ivaEmFalta: ivaH === null,
  };
}

// ---------------------------------------------------------------------------
// Mapa Resumo de Validações (vista anual Jan–Dez por provider)
// ---------------------------------------------------------------------------

/**
 * Escalões de incumprimento do SLA por horas acumuladas do gerador (linhas do Mapa Resumo de Validações:
 * 40% para 35040 ≤ h < 36480, 60% para 36480 ≤ h < 37920, 100% para h ≥ 37920). Regra contratual, não preço.
 */
export const HORAS_SLA_ESCALOES = [
  { id: "40", min: 35040, max: 36480 },
  { id: "60", min: 36480, max: 37920 },
  { id: "100", min: 37920, max: Infinity },
] as const;

export function escalaoHoras(horasN: string | number | null | undefined): "40" | "60" | "100" | null {
  const h = toHundredths(horasN ?? null);
  if (h === null) return null;
  const n = Number(h) / 100;
  const e = HORAS_SLA_ESCALOES.find((x) => n >= x.min && n < x.max);
  return e ? e.id : null;
}

export interface CountValue {
  n: number;
  valor: bigint;
}

/** Agregados de um mês (soma dos mapas do provider nesse mês). */
export interface ValidationMonthInput {
  mes: number;
  temMapa: boolean;
  penSLA: CountValue;
  penNivelCombust: CountValue;
  penAvaria: CountValue;
  /** Todas as penalizações por excesso de horas (entra no valor global). */
  penExcessoHoras: CountValue;
  /** Por escalão de horas acumuladas: n = geradores no escalão; valor = penalizações por excesso de horas desses geradores. */
  penHoras: Record<"40" | "60" | "100", CountValue>;
  parqueTotal: number;
  parquePorPotencia: Record<string, number>;
  aluguerCent: bigint;
  descontoRedeCent: bigint;
  manutencaoCent: bigint;
  litros: string;
  combustivelCent: bigint;
  servAbastCent: bigint;
  indicadores: {
    sitesRedePublica: number | null;
    sitesRedeConfiguradosNetEco: number | null;
    sitesRedeSemGarantia: number | null;
    poupancaCent: bigint | null;
    transporteExtraCent: bigint | null;
  } | null;
  /** Totais de todos os providers no mês (para comparar com o target global). */
  globalAluguerManutCent: bigint;
  globalAbastecimentoCent: bigint;
}

export interface TargetPair {
  aluguerCent: bigint | null;
  combustivelCent: bigint | null;
}

export interface Deviation {
  target: bigint | null;
  valor: bigint;
  desvio: bigint | null;
  /** Desvio em % do target (2 casas); target vazio ou 0 → null ("—"). */
  desvioPercent: number | null;
}

const deviation = (valor: bigint, target: bigint | null): Deviation => ({
  target,
  valor,
  desvio: target === null ? null : valor - target,
  desvioPercent: target === null || target === ZERO ? null : Number(((valor - target) * BigInt(10000)) / target) / 100,
});

/** Variação face ao mês anterior: absoluta e % do mês anterior (anterior 0 ou sem mapa → % null). */
const variation = (cur: bigint, prev: bigint | null) => ({
  abs: prev === null ? null : cur - prev,
  percent: prev === null || prev === ZERO ? null : Number(((cur - prev) * BigInt(10000)) / prev) / 100,
});

export function validationsYear(
  months: ValidationMonthInput[],
  targets: { provider: (mes: number) => TargetPair; global: (mes: number) => TargetPair },
) {
  const byMes = new Map(months.map((m) => [m.mes, m]));
  const out = [];
  let prev: { aluguerManut: bigint; litrosH: bigint; abastecimento: bigint; totalGlobal: bigint } | null = null;
  for (let mes = 1; mes <= 12; mes++) {
    const m = byMes.get(mes);
    if (!m || !m.temMapa) {
      out.push({ mes, temMapa: false as const, indicadores: m?.indicadores ?? null });
      prev = null;
      continue;
    }
    const penalizacoesGlobal = m.penSLA.valor + m.penNivelCombust.valor + m.penAvaria.valor + m.penExcessoHoras.valor;
    const poupanca = m.indicadores?.poupancaCent ?? null;
    const aluguerManut = m.aluguerCent - m.descontoRedeCent + m.manutencaoCent;
    const abastecimento = m.combustivelCent + m.servAbastCent;
    const totalParcial = aluguerManut + abastecimento;
    const transporte = m.indicadores?.transporteExtraCent ?? null;
    const totalGlobal = totalParcial + (transporte ?? ZERO);
    const litrosH = toHundredths(m.litros) ?? ZERO;
    const tp = targets.provider(mes);
    const tg = targets.global(mes);
    out.push({
      mes,
      temMapa: true as const,
      penSLA: m.penSLA,
      penNivelCombust: m.penNivelCombust,
      penAvaria: m.penAvaria,
      penExcessoHoras: m.penExcessoHoras,
      penHoras: m.penHoras,
      penalizacoesGlobal,
      indicadores: m.indicadores,
      subtotalPenalizacoesPoupanca: penalizacoesGlobal + (poupanca ?? ZERO),
      parqueTotal: m.parqueTotal,
      parquePorPotencia: m.parquePorPotencia,
      aluguerManutCent: aluguerManut,
      variacaoAluguerManut: variation(aluguerManut, prev?.aluguerManut ?? null),
      litros: hundredthsToString(litrosH),
      variacaoLitros: prev === null ? null : hundredthsToString(litrosH - prev.litrosH),
      combustivelCent: m.combustivelCent,
      servAbastCent: m.servAbastCent,
      abastecimentoCent: abastecimento,
      variacaoAbastecimento: variation(abastecimento, prev?.abastecimento ?? null),
      totalParcialCent: totalParcial,
      transporteExtraCent: transporte,
      totalGlobalCent: totalGlobal,
      variacaoTotalGlobal: variation(totalGlobal, prev?.totalGlobal ?? null),
      targets: {
        providerAluguerManut: deviation(aluguerManut, tp.aluguerCent),
        providerAbastecimento: deviation(abastecimento, tp.combustivelCent),
        globalAluguerManut: deviation(m.globalAluguerManutCent, tg.aluguerCent),
        globalAbastecimento: deviation(m.globalAbastecimentoCent, tg.combustivelCent),
      },
    });
    prev = { aluguerManut, litrosH, abastecimento, totalGlobal };
  }
  return out;
}

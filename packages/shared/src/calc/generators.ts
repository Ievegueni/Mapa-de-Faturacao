/**
 * Regras de cálculo — Geradores (CLAUDE.md §7). Funções puras, usadas pela API e pela web.
 * Valores monetários em cêntimos (bigint); litros, horas e percentagens com 2 casas.
 */
import { DecimalLike, divFloor, divRound, toHundredths } from "./decimal";

export const GENERATOR_FLAGS = [
  "HORAS_NEGATIVAS",
  "DIAS_INVALIDOS",
  "HORAS_FORA_INTERVALO",
  "SEM_PRECO_ALUGUER",
  "SEM_PRECO_COMBUSTIVEL",
  "SEM_PRECO_SERV_ABAST",
  "LITROS_ACIMA_MEDIA",
  "GERADOR_REMOVIDO",
] as const;
export type GeneratorFlag = (typeof GENERATOR_FLAGS)[number];

export const GENERATOR_FLAG_LABELS: Record<GeneratorFlag, string> = {
  HORAS_NEGATIVAS: "Horas negativas",
  DIAS_INVALIDOS: "Dias inválidos",
  HORAS_FORA_INTERVALO: "Horas fora das faixas",
  SEM_PRECO_ALUGUER: "Sem preço de aluguer",
  SEM_PRECO_COMBUSTIVEL: "Sem preço de combustível",
  SEM_PRECO_SERV_ABAST: "Sem preço de serviço de abastecimento",
  LITROS_ACIMA_MEDIA: "Litros acima da média",
  GERADOR_REMOVIDO: "Gerador removido",
};

type Cents = bigint | string | number | null | undefined;
const ZERO = BigInt(0);
const cents = (v: Cents): bigint | null => (v === null || v === undefined || v === "" ? null : BigInt(v));
const orZero = (v: bigint | null) => v ?? ZERO;

export interface DiscountBand {
  horasMin: number;
  horasMax: number;
  /** Pontos percentuais ("35" = 35%). */
  percent: DecimalLike;
}

export interface MeasurementInput {
  dias: number | null | undefined;
  horasN1: DecimalLike;
  horasN: DecimalLike;
  litros: DecimalLike;
  precoCombustivelCent: Cents;
  precoServAbastCent: Cents;
  precoAluguerDiaCent: Cents;
  precoManutencaoCent: Cents;
  servExtrasCent?: Cents;
  penExcessoHorasCent?: Cents;
  penSLACent?: Cents;
  penNivelCombustCent?: Cents;
  penAvariaCent?: Cents;
}

export interface MeasurementContext {
  /** Faixas de desconto em vigor para o mês. */
  bands: DiscountBand[];
  /** Média de litros dos últimos 3 meses do site (para LITROS_ACIMA_MEDIA). */
  mediaLitros3m?: DecimalLike;
  /** O gerador foi removido antes ou durante o mês. */
  geradorRemovido?: boolean;
}

export interface MeasurementResult {
  horasTrabalhadas: number | null;
  horasRede: number | null;
  /** Pontos percentuais com 2 casas, ex.: "35.00"; null sem horas. */
  descontoPercent: string | null;
  combustivelCent: bigint;
  servAbastCent: bigint;
  abastecimentoCent: bigint;
  aluguerCent: bigint;
  manutencaoCent: bigint;
  descontoRedeCent: bigint;
  penalizacoesCent: bigint;
  totalCent: bigint;
  flags: GeneratorFlag[];
}

/** Faixa de desconto para as horas de rede por dia. Fora das faixas → null. */
export function findDiscountPercent(horasRede: number, bands: DiscountBand[]): bigint | null {
  const band = bands.find((b) => horasRede >= b.horasMin && horasRede <= b.horasMax);
  return band ? toHundredths(band.percent) ?? ZERO : null;
}

/** Calcula uma linha do Auto de Medição. Valores vazios contam como 0 e geram flags; nunca lança erro. */
export function calculateMeasurement(input: MeasurementInput, ctx: MeasurementContext): MeasurementResult {
  const flags = new Set<GeneratorFlag>();

  // Dias
  const rawDias = input.dias;
  const diasValid = typeof rawDias === "number" && Number.isInteger(rawDias) && rawDias > 0 && rawDias <= 31;
  if (!diasValid) flags.add("DIAS_INVALIDOS");
  const dias = typeof rawDias === "number" && Number.isFinite(rawDias) && rawDias > 0 ? Math.floor(rawDias) : 0;

  // Horas: horasTrabalhadas = floor((N − N1) / dias); horasRede = 24 − horasTrabalhadas
  let horasTrabalhadas: number | null = null;
  let horasRede: number | null = null;
  let descontoH: bigint = ZERO; // percentagem em centésimas (3500 = 35%)
  let descontoPercent: string | null = null;
  const n = toHundredths(input.horasN);
  const n1 = toHundredths(input.horasN1);
  if (n !== null && n1 !== null && dias > 0) {
    const diff = n - n1;
    if (diff < ZERO) flags.add("HORAS_NEGATIVAS");
    horasTrabalhadas = Number(divFloor(diff, BigInt(dias * 100)));
    horasRede = 24 - horasTrabalhadas;
    // Horas negativas: não há desconto (o contador está errado); fora das faixas só se as horas forem válidas.
    const pct = diff < ZERO ? null : findDiscountPercent(horasRede, ctx.bands);
    if (pct === null && diff >= ZERO) flags.add("HORAS_FORA_INTERVALO");
    if (pct !== null) descontoH = pct;
    descontoPercent = (Number(descontoH) / 100).toFixed(2);
  }

  // Abastecimento
  const litrosH = toHundredths(input.litros);
  const litrosPos = litrosH !== null && litrosH > ZERO;
  const precoComb = cents(input.precoCombustivelCent);
  const precoServ = cents(input.precoServAbastCent);
  if (litrosPos && precoComb === null) flags.add("SEM_PRECO_COMBUSTIVEL");
  if (litrosPos && precoServ === null) flags.add("SEM_PRECO_SERV_ABAST");
  const combustivelCent = litrosH === null ? ZERO : divRound(litrosH * orZero(precoComb), BigInt(100));
  const servAbastCent = litrosH === null ? ZERO : divRound(litrosH * orZero(precoServ), BigInt(100));
  const abastecimentoCent = combustivelCent + servAbastCent;

  // Aluguer e desconto da rede
  const precoAluguer = cents(input.precoAluguerDiaCent);
  if (precoAluguer === null && dias > 0) flags.add("SEM_PRECO_ALUGUER");
  const aluguerCent = orZero(precoAluguer) * BigInt(dias);
  const descontoRedeCent = divRound(aluguerCent * descontoH, BigInt(10000));

  const manutencaoCent = orZero(cents(input.precoManutencaoCent));
  const servExtras = orZero(cents(input.servExtrasCent));
  const penalizacoesCent =
    orZero(cents(input.penExcessoHorasCent)) +
    orZero(cents(input.penSLACent)) +
    orZero(cents(input.penNivelCombustCent)) +
    orZero(cents(input.penAvariaCent));

  const totalCent = aluguerCent + manutencaoCent + servExtras + abastecimentoCent - descontoRedeCent - penalizacoesCent;

  // Avisos de contexto
  const media = toHundredths(ctx.mediaLitros3m);
  if (litrosH !== null && media !== null && media > ZERO && litrosH > media * BigInt(2)) flags.add("LITROS_ACIMA_MEDIA");
  if (ctx.geradorRemovido) flags.add("GERADOR_REMOVIDO");

  return {
    horasTrabalhadas,
    horasRede,
    descontoPercent,
    combustivelCent,
    servAbastCent,
    abastecimentoCent,
    aluguerCent,
    manutencaoCent,
    descontoRedeCent,
    penalizacoesCent,
    totalCent,
    flags: GENERATOR_FLAGS.filter((f) => flags.has(f)),
  };
}

// ---------- Escolha de preços e faixas ----------

export interface RentPriceLike {
  potenciaKVA: number | null;
  subtipo: string | null;
  distancia: string | null;
  precoDiaCent: Cents;
}

export interface SiteRentKey {
  potenciaKVA: number | null;
  subtipo: string | null;
  distancia: string | null;
}

const norm = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null);

/**
 * Preço de aluguer por dia: mesma potência e, se existirem na linha, o mesmo subtipo e distância
 * (vazio = aplica-se a todos). Prioridade: correspondência exacta → só potência → sem preço.
 */
export function selectRentPrice<T extends RentPriceLike>(
  rows: T[],
  key: SiteRentKey,
): { row: T | null; match: "exacta" | "potencia" | null } {
  if (key.potenciaKVA === null || key.potenciaKVA === undefined) return { row: null, match: null };
  const samePower = rows.filter((r) => r.potenciaKVA === key.potenciaKVA);
  const sub = norm(key.subtipo);
  const dist = norm(key.distancia);

  const compatible = samePower
    .filter((r) => (norm(r.subtipo) === null || norm(r.subtipo) === sub) && (norm(r.distancia) === null || norm(r.distancia) === dist))
    .map((r) => ({ r, score: (norm(r.subtipo) !== null ? 2 : 0) + (norm(r.distancia) !== null ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);

  if (compatible.length) {
    const best = compatible[0];
    const exact = norm(best.r.subtipo) === sub && norm(best.r.distancia) === dist;
    return { row: best.r, match: exact ? "exacta" : "potencia" };
  }
  // Só potência: nenhuma linha compatível com subtipo/distância; usa a primeira linha da mesma potência.
  return samePower.length ? { row: samePower[0], match: "potencia" } : { row: null, match: null };
}

/** Item com vigência: o mais recente com início ≤ data de referência. */
export function selectByValidity<T extends { validFrom: string | Date }>(items: T[], ref: Date): T | null {
  const t = ref.getTime();
  let best: T | null = null;
  for (const i of items) {
    const from = new Date(i.validFrom).getTime();
    if (from <= t && (!best || from > new Date(best.validFrom).getTime())) best = i;
  }
  return best;
}

/** Faixas de desconto em vigor: o grupo com a data de início mais recente ≤ data de referência. */
export function selectDiscountBands<T extends DiscountBand & { validFrom: string | Date }>(rules: T[], ref: Date): T[] {
  const current = selectByValidity(rules, ref);
  if (!current) return [];
  const from = new Date(current.validFrom).getTime();
  return rules.filter((r) => new Date(r.validFrom).getTime() === from).sort((a, b) => a.horasMin - b.horasMin);
}

/** Primeiro dia do mês (UTC) — data de referência para preços e faixas de um mapa. */
export const monthStart = (ano: number, mes: number) => new Date(Date.UTC(ano, mes - 1, 1));

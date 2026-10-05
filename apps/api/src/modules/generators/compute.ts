import { Generator, Prisma, PrismaClient, Site } from "@prisma/client";
import {
  calculateMeasurement,
  hundredthsToString,
  MeasurementFields,
  monthStart,
  selectByValidity,
  selectDiscountBands,
  selectRentPrice,
  toHundredths,
} from "@cf/shared";

type Db = PrismaClient | Prisma.TransactionClient;

export type MapContext = Awaited<ReturnType<typeof loadMapContext>>;

/** Mapa + tabela de preços e faixas de desconto em vigor no mês (CLAUDE.md §7). */
export async function loadMapContext(db: Db, mapId: string) {
  const map = await db.generatorMonthlyMap.findUnique({
    where: { id: mapId },
    include: { team: { select: { id: true, nome: true } }, provider: { select: { id: true, nome: true } } },
  });
  if (!map) return null;
  const ref = monthStart(map.ano, map.mes);
  const monthEnd = new Date(Date.UTC(map.ano, map.mes, 0));
  const [tables, rules] = await Promise.all([
    db.priceTable.findMany({ where: { providerId: map.providerId }, include: { rentPrices: true } }),
    db.gridDiscountRule.findMany(),
  ]);
  const priceTable = selectByValidity(tables, ref);
  const bands = selectDiscountBands(rules, ref).map((r) => ({ horasMin: r.horasMin, horasMax: r.horasMax, percent: r.percent.toString(), validFrom: r.validFrom }));
  return { map, ref, monthEnd, priceTable, bands };
}

type SiteKey = Pick<Site, "subtipo" | "distanciaFacturacao">;
type GeneratorKey = Pick<Generator, "potenciaKVA" | "dataRemocao">;

const dec = (v: string | null | undefined) => {
  const h = toHundredths(v);
  return h === null ? null : hundredthsToString(h);
};
const big = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : BigInt(v));

/**
 * Campos persistidos de uma medição: snapshot dos preços em vigor + resultado de calculateMeasurement.
 * Usado pela importação, pelo formulário, pela edição em linha e pelo recálculo.
 */
export function buildMeasurementData(ctx: MapContext, site: SiteKey, generator: GeneratorKey, f: MeasurementFields, mediaLitros3m: string | null) {
  const pt = ctx!.priceTable;
  const rent = selectRentPrice(pt?.rentPrices ?? [], {
    potenciaKVA: generator.potenciaKVA,
    subtipo: site.subtipo,
    distancia: site.distanciaFacturacao,
  });
  const prices = {
    precoCombustivelCent: pt?.precoCombustivelCent ?? null,
    precoServAbastCent: pt?.precoServAbastCent ?? null,
    precoAluguerDiaCent: rent.row?.precoDiaCent ?? null,
    precoManutencaoCent: pt?.precoManutencaoCent ?? null,
  };
  const removed = !!generator.dataRemocao && generator.dataRemocao.getTime() <= ctx!.monthEnd.getTime();
  const r = calculateMeasurement({ ...f, ...prices }, { bands: ctx!.bands, mediaLitros3m, geradorRemovido: removed });
  return {
    dias: f.dias,
    horasN1: dec(f.horasN1),
    horasN: dec(f.horasN),
    litros: dec(f.litros),
    servExtrasCent: big(f.servExtrasCent),
    penExcessoHorasCent: big(f.penExcessoHorasCent),
    penSLACent: big(f.penSLACent),
    penNivelCombustCent: big(f.penNivelCombustCent),
    penAvariaCent: big(f.penAvariaCent),
    ...prices,
    horasTrabalhadas: r.horasTrabalhadas,
    horasRede: r.horasRede,
    descontoPercent: r.descontoPercent,
    combustivelCent: r.combustivelCent,
    servAbastCent: r.servAbastCent,
    abastecimentoCent: r.abastecimentoCent,
    aluguerCent: r.aluguerCent,
    descontoRedeCent: r.descontoRedeCent,
    totalCent: r.totalCent,
    flags: r.flags as string[],
  };
}

/** Campos editáveis de uma medição gravada (para recalcular sem os alterar). */
export function fieldsOf(m: {
  dias: number;
  horasN1: Prisma.Decimal | null;
  horasN: Prisma.Decimal | null;
  litros: Prisma.Decimal | null;
  servExtrasCent: bigint | null;
  penExcessoHorasCent: bigint | null;
  penSLACent: bigint | null;
  penNivelCombustCent: bigint | null;
  penAvariaCent: bigint | null;
}): MeasurementFields {
  const s = (v: { toString(): string } | null) => (v === null ? null : v.toString());
  return {
    dias: m.dias,
    horasN1: s(m.horasN1),
    horasN: s(m.horasN),
    litros: s(m.litros),
    servExtrasCent: s(m.servExtrasCent),
    penExcessoHorasCent: s(m.penExcessoHorasCent),
    penSLACent: s(m.penSLACent),
    penNivelCombustCent: s(m.penNivelCombustCent),
    penAvariaCent: s(m.penAvariaCent),
  };
}

/**
 * Média de litros por linha nos 3 meses anteriores, por site (para LITROS_ACIMA_MEDIA).
 * Considera os mapas da mesma equipa, de qualquer provider.
 */
export async function mediaLitrosBySite(db: Db, teamId: string, ano: number, mes: number, siteIds?: string[]) {
  const months: { ano: number; mes: number }[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    months.push({ ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 });
  }
  const maps = await db.generatorMonthlyMap.findMany({ where: { teamId, OR: months }, select: { id: true } });
  const result = new Map<string, string | null>();
  if (!maps.length) return result;
  const rows = await db.generatorMeasurement.groupBy({
    by: ["siteId"],
    where: { mapId: { in: maps.map((m) => m.id) }, litros: { not: null }, ...(siteIds ? { siteId: { in: siteIds } } : {}) },
    _avg: { litros: true },
  });
  for (const r of rows) result.set(r.siteId, r._avg.litros ? r._avg.litros.toFixed(2) : null);
  return result;
}

/** Estado do mapa a partir das medições (o fecho é explícito e não passa por aqui). */
export async function syncMapState(db: Db, mapId: string) {
  const map = await db.generatorMonthlyMap.findUnique({ where: { id: mapId }, select: { state: true } });
  if (!map || map.state === "FECHADO") return;
  const counts = await db.generatorMeasurement.groupBy({ by: ["state"], where: { mapId }, _count: true });
  const has = (s: string) => counts.some((c) => c.state === s && c._count > 0);
  const state = has("RASCUNHO") ? "RASCUNHO" : has("SUBMETIDO") ? "SUBMETIDO" : has("VALIDADO") ? "VALIDADO" : "RASCUNHO";
  if (state !== map.state) await db.generatorMonthlyMap.update({ where: { id: mapId }, data: { state } });
}

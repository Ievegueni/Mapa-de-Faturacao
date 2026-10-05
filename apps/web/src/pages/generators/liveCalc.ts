import { calculateMeasurement, MeasurementResult, selectRentPrice } from "@cf/shared";
import type { GeneratorMapDetail } from "../../lib/types";

export interface MeasurementDraft {
  dias: string;
  horasN1: string;
  horasN: string;
  litros: string;
  servExtrasCent: string | null;
  penExcessoHorasCent: string | null;
  penSLACent: string | null;
  penNivelCombustCent: string | null;
  penAvariaCent: string | null;
}

export const emptyDraft = (dias: number): MeasurementDraft => ({
  dias: String(dias),
  horasN1: "",
  horasN: "",
  litros: "",
  servExtrasCent: null,
  penExcessoHorasCent: null,
  penSLACent: null,
  penNivelCombustCent: null,
  penAvariaCent: null,
});

export const draftFrom = (m: {
  dias: number;
  horasN1: string | null;
  horasN: string | null;
  litros: string | null;
  servExtrasCent: string | null;
  penExcessoHorasCent: string | null;
  penSLACent: string | null;
  penNivelCombustCent: string | null;
  penAvariaCent: string | null;
}): MeasurementDraft => ({
  dias: String(m.dias),
  horasN1: m.horasN1 ?? "",
  horasN: m.horasN ?? "",
  litros: m.litros ?? "",
  servExtrasCent: m.servExtrasCent,
  penExcessoHorasCent: m.penExcessoHorasCent,
  penSLACent: m.penSLACent,
  penNivelCombustCent: m.penNivelCombustCent,
  penAvariaCent: m.penAvariaCent,
});

/** Dados para a API (decimais com ponto; vazio → null). */
export const draftPayload = (d: MeasurementDraft) => ({
  dias: d.dias.trim() === "" ? 0 : Number(d.dias),
  horasN1: d.horasN1.trim() || null,
  horasN: d.horasN.trim() || null,
  litros: d.litros.trim() || null,
  servExtrasCent: d.servExtrasCent,
  penExcessoHorasCent: d.penExcessoHorasCent,
  penSLACent: d.penSLACent,
  penNivelCombustCent: d.penNivelCombustCent,
  penAvariaCent: d.penAvariaCent,
});

export const daysInMonth = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

/**
 * Cálculo em tempo real no browser — a MESMA função que a API usa ao gravar (CLAUDE.md §9.2).
 * O valor gravado é sempre o calculado no servidor.
 */
export function liveCalc(
  map: GeneratorMapDetail,
  site: { subtipo: string | null; distanciaFacturacao: string | null },
  generator: { potenciaKVA: number | null; dataRemocao: string | null },
  d: MeasurementDraft,
  mediaLitros3m: string | null,
): { result: MeasurementResult; precoAluguerDiaCent: string | null } {
  const pt = map.priceTable;
  const rent = selectRentPrice(pt?.rentPrices ?? [], { potenciaKVA: generator.potenciaKVA, subtipo: site.subtipo, distancia: site.distanciaFacturacao });
  const monthEnd = new Date(Date.UTC(map.ano, map.mes, 0));
  const payload = draftPayload(d);
  const precoAluguerDiaCent = rent.row?.precoDiaCent ?? null;
  const result = calculateMeasurement(
    {
      ...payload,
      dias: d.dias.trim() === "" ? null : Number(d.dias),
      precoCombustivelCent: pt?.precoCombustivelCent ?? null,
      precoServAbastCent: pt?.precoServAbastCent ?? null,
      precoAluguerDiaCent,
      precoManutencaoCent: pt?.precoManutencaoCent ?? null,
    },
    {
      bands: map.bands,
      mediaLitros3m,
      geradorRemovido: !!generator.dataRemocao && new Date(`${generator.dataRemocao}T00:00:00Z`) <= monthEnd,
    },
  );
  return { result, precoAluguerDiaCent };
}

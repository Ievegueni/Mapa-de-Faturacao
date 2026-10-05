import { KeyboardEvent, ReactNode } from "react";
import { formatDecimal, formatKz } from "@cf/shared";
import { MoneyInput } from "../../components/inputs";
import { Field, Input } from "../../components/ui";
import type { GeneratorMapDetail } from "../../lib/types";
import { FlagChips } from "./flags";
import { liveCalc, MeasurementDraft } from "./liveCalc";

interface Props {
  map: GeneratorMapDetail;
  site: { subtipo: string | null; distanciaFacturacao: string | null };
  generator: { potenciaKVA: number | null; dataRemocao: string | null };
  draft: MeasurementDraft;
  onChange(d: MeasurementDraft): void;
  mediaLitros3m: string | null;
  disabled?: boolean;
  /** Enter num campo: gravar (e avançar, no formulário por site). */
  onEnter?(): void;
  hint?: ReactNode;
}

function Out({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-semibold text-navy-950" : "text-ink-800"}`}>{value}</span>
    </div>
  );
}

/** Campos de entrada + resultados calculados em tempo real (só leitura). */
export default function MeasurementEditor({ map, site, generator, draft, onChange, mediaLitros3m, disabled, onEnter, hint }: Props) {
  const { result: r, precoAluguerDiaCent } = liveCalc(map, site, generator, draft, mediaLitros3m);
  const set = (p: Partial<MeasurementDraft>) => onChange({ ...draft, ...p });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
      setTimeout(onEnter, 0);
    }
  };
  const dec = (k: "horasN1" | "horasN" | "litros", label: string) => (
    <Field label={label}>
      <Input inputMode="decimal" placeholder="—" disabled={disabled} value={draft[k]} onKeyDown={onKey} onChange={(e) => set({ [k]: e.target.value } as Partial<MeasurementDraft>)} aria-label={label} />
    </Field>
  );
  const money = (k: "servExtrasCent" | "penExcessoHorasCent" | "penSLACent" | "penNivelCombustCent" | "penAvariaCent", label: string) => (
    <Field label={label}>
      <div onKeyDown={onKey}>
        <MoneyInput value={draft[k]} disabled={disabled} onChange={(v) => set({ [k]: v } as Partial<MeasurementDraft>)} aria-label={label} />
      </div>
    </Field>
  );
  const pct = r.descontoPercent === null ? "—" : `${formatDecimal(r.descontoPercent, 0)}%`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Dias">
            <Input inputMode="numeric" disabled={disabled} value={draft.dias} onKeyDown={onKey} onChange={(e) => set({ dias: e.target.value })} aria-label="Dias" />
          </Field>
          {dec("horasN1", "Horas (N-1)")}
          {dec("horasN", "Horas (N)")}
          {dec("litros", "Litros")}
        </div>
        {hint}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {money("servExtrasCent", "Serviços extras")}
          {money("penExcessoHorasCent", "Pen. excesso de horas")}
          {money("penSLACent", "Penalização SLA")}
          {money("penNivelCombustCent", "Pen. nível combustível")}
          {money("penAvariaCent", "Penalização avaria")}
        </div>
      </div>
      <div className="rounded-xl bg-ink-50 p-4 ring-1 ring-ink-100">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Cálculo</div>
        <Out label="Horas trabalhadas / dia" value={r.horasTrabalhadas === null ? "—" : String(r.horasTrabalhadas)} />
        <Out label="Horas de rede / dia" value={r.horasRede === null ? "—" : String(r.horasRede)} />
        <Out label="Desconto de rede" value={pct} />
        <div className="my-2 border-t border-ink-200" />
        <Out label="Combustível" value={formatKz(r.combustivelCent)} />
        <Out label="Serviço de abastecimento" value={formatKz(r.servAbastCent)} />
        <Out label={`Aluguer${precoAluguerDiaCent ? ` (${formatKz(precoAluguerDiaCent)}/dia)` : ""}`} value={formatKz(r.aluguerCent)} />
        <Out label="Desconto de rede" value={`− ${formatKz(r.descontoRedeCent)}`} />
        {r.manutencaoCent > BigInt(0) && <Out label="Manutenção" value={formatKz(r.manutencaoCent)} />}
        {r.penalizacoesCent > BigInt(0) && <Out label="Penalizações" value={`− ${formatKz(r.penalizacoesCent)}`} />}
        <div className="my-2 border-t border-ink-200" />
        <Out label="Total" value={formatKz(r.totalCent)} strong />
        {r.flags.length > 0 && (
          <div className="mt-3">
            <FlagChips flags={r.flags} full />
          </div>
        )}
      </div>
    </div>
  );
}

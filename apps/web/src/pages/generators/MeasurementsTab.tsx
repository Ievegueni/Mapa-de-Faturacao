import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can, formatDecimal, formatKz, GENERATOR_FLAG_LABELS, GENERATOR_FLAGS, RECORD_STATE_LABELS, REGIOES } from "@cf/shared";
import { Pager } from "../../components/Pager";
import { Alert, Badge, Button, Card, EmptyRow, Input, Select, Spinner, errorMessage, th } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { useDebounced } from "../../hooks/useDebounced";
import { api, apiPatch } from "../../lib/api";
import type { GeneratorMapDetail, MeasurementList, MeasurementRow } from "../../lib/types";
import { stateTone } from "../billing-providers/invoiceRules";
import { FlagChips } from "./flags";
import { draftFrom, draftPayload, MeasurementDraft } from "./liveCalc";
import MeasurementEditor from "./MeasurementEditor";

const td = "px-3 py-2 text-sm text-ink-700 whitespace-nowrap";
const num = `${td} text-right tabular-nums`;

export default function MeasurementsTab({ map }: { map: GeneratorMapDetail }) {
  const { user } = useAuth();
  const [f, setF] = useState({ q: "", regiao: "", flag: "", state: "" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebounced(f.q);
  const set = (p: Partial<typeof f>) => {
    setPage(1);
    setF((x) => ({ ...x, ...p }));
  };
  const qs = new URLSearchParams({ page: String(page) });
  if (q) qs.set("q", q);
  for (const k of ["regiao", "flag", "state"] as const) if (f[k]) qs.set(k, f[k]);
  const list = useQuery({
    queryKey: ["measurements", map.id, q, f.regiao, f.flag, f.state, page],
    queryFn: () => api<MeasurementList>(`/generators/maps/${map.id}/measurements?${qs}`),
    keepPreviousData: true,
  });

  if (!user) return null;
  const validator = can(user.permissions, "billing_generators", "validate");
  const canEditRow = (m: MeasurementRow) =>
    can(user.permissions, "billing_generators", "edit") && m.state !== "FECHADO" && (validator || (m.state === "RASCUNHO" && m.createdById === user.id));

  return (
    <Card>
      <div className="grid grid-cols-2 gap-2 border-b border-ink-100 p-4 sm:flex sm:flex-wrap">
        <Input placeholder="Pesquisar site, código P.P. ou nº de série" value={f.q} onChange={(e) => set({ q: e.target.value })} className="col-span-2 sm:w-80" />
        <Select value={f.regiao} onChange={(e) => set({ regiao: e.target.value })} className="sm:w-36" aria-label="Região">
          <option value="">Todas as regiões</option>
          {REGIOES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Select value={f.flag} onChange={(e) => set({ flag: e.target.value })} className="sm:w-52" aria-label="Aviso">
          <option value="">Todos os avisos</option>
          <option value="COM_FLAGS">Com avisos</option>
          <option value="SEM_FLAGS">Sem avisos</option>
          {GENERATOR_FLAGS.map((x) => <option key={x} value={x}>{GENERATOR_FLAG_LABELS[x]}</option>)}
        </Select>
        <Select value={f.state} onChange={(e) => set({ state: e.target.value })} className="sm:w-36" aria-label="Estado">
          <option value="">Todos os estados</option>
          {(["RASCUNHO", "SUBMETIDO", "VALIDADO", "FECHADO"] as const).map((s) => <option key={s} value={s}>{RECORD_STATE_LABELS[s]}</option>)}
        </Select>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <div className="p-4"><Alert>{errorMessage(list.error)}</Alert></div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Site</th>
                  <th className={th}>Gerador</th>
                  <th className={`${th} text-right`}>Dias</th>
                  <th className={`${th} text-right`}>H. trab.</th>
                  <th className={`${th} text-right`}>H. rede</th>
                  <th className={`${th} text-right`}>Desc.</th>
                  <th className={`${th} text-right`}>Litros</th>
                  <th className={`${th} text-right`}>Abastecimento</th>
                  <th className={`${th} text-right`}>Aluguer</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={th}>Avisos</th>
                  <th className={th}>Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {list.data!.items.length === 0 && <EmptyRow colSpan={12}>Sem medições com estes filtros. Importe o Excel ou use o formulário por site.</EmptyRow>}
                {list.data!.items.map((m) => (
                  <Fragment key={m.id}>
                    <tr className={`hover:bg-ink-50/50 ${open === m.id ? "bg-brand-50/40" : ""} ${canEditRow(m) ? "cursor-pointer" : ""}`} onClick={() => canEditRow(m) && setOpen(open === m.id ? null : m.id)}>
                      <td className={td}>
                        <div className="max-w-[14rem] truncate font-medium text-navy-950" title={m.site.nome}>{m.site.nome}</div>
                        <div className="text-xs text-ink-500">{m.site.codigoPP || "—"} · {m.site.provincia}</div>
                      </td>
                      <td className={td}>
                        {m.generator.numeroSerie}
                        <div className="text-xs text-ink-500">{m.generator.potenciaKVA ? `${m.generator.potenciaKVA} kVA` : "—"}</div>
                      </td>
                      <td className={num}>{m.dias}</td>
                      <td className={num}>{m.horasTrabalhadas ?? "—"}</td>
                      <td className={num}>{m.horasRede ?? "—"}</td>
                      <td className={num}>{m.descontoPercent === null ? "—" : `${formatDecimal(m.descontoPercent, 0)}%`}</td>
                      <td className={num}>{formatDecimal(m.litros)}</td>
                      <td className={num}>{formatKz(m.abastecimentoCent)}</td>
                      <td className={num}>{formatKz(m.aluguerCent)}</td>
                      <td className={`${num} font-medium text-navy-950`}>{formatKz(m.totalCent)}</td>
                      <td className={td}><FlagChips flags={m.flags} /></td>
                      <td className={td}><Badge tone={stateTone[m.state]}>{RECORD_STATE_LABELS[m.state]}</Badge></td>
                    </tr>
                    {open === m.id && (
                      <tr>
                        <td colSpan={12} className="bg-brand-50/30 px-4 py-4">
                          <InlineEditor map={map} m={m} onClose={() => setOpen(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              {list.data!.items.length > 0 && (
                <tfoot className="border-t-2 border-ink-200 bg-ink-50/60">
                  <tr>
                    <td className={`${td} font-semibold text-navy-950`} colSpan={6}>Total ({list.data!.total.toLocaleString("pt-PT")} medições com estes filtros)</td>
                    <td className={`${num} font-semibold text-navy-950`}>{formatDecimal(list.data!.totals.litros)}</td>
                    <td className={`${num} font-semibold text-navy-950`}>{formatKz(BigInt(list.data!.totals.combustivelCent) + BigInt(list.data!.totals.servAbastCent))}</td>
                    <td className={`${num} font-semibold text-navy-950`}>{formatKz(list.data!.totals.aluguerCent)}</td>
                    <td className={`${num} font-semibold text-navy-950`}>{formatKz(list.data!.totals.totalCent)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <Pager page={page} total={list.data!.total} pageSize={list.data!.pageSize} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

/** Edição em linha com cálculo em tempo real. */
function InlineEditor({ map, m, onClose }: { map: GeneratorMapDetail; m: MeasurementRow; onClose(): void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<MeasurementDraft>(draftFrom(m));
  useEffect(() => setDraft(draftFrom(m)), [m]);
  const save = useMutation({
    mutationFn: () => apiPatch<MeasurementRow>(`/generators/measurements/${m.id}`, draftPayload(draft)),
    onSuccess: () => {
      qc.invalidateQueries(["measurements", map.id]);
      qc.invalidateQueries(["generator-map", map.id]);
      onClose();
    },
  });
  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      <div className="text-sm font-medium text-navy-950">
        {m.site.nome} · {m.generator.numeroSerie}
        <span className="ml-2 text-xs font-normal text-ink-500">{[m.site.subtipo, m.site.distanciaFacturacao].filter(Boolean).join(" · ")}</span>
      </div>
      <MeasurementEditor map={map} site={m.site} generator={m.generator} draft={draft} onChange={setDraft} mediaLitros3m={null} onEnter={() => save.mutate()} />
      {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button disabled={save.isLoading} onClick={() => save.mutate()}>{save.isLoading ? "A guardar…" : "Guardar"}</Button>
      </div>
    </div>
  );
}

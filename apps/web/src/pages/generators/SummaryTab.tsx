import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can, formatKz, formatPercent } from "@cf/shared";
import { MoneyInput } from "../../components/inputs";
import { Alert, Button, Card, Field, Input, Spinner, errorMessage, th } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { api, apiPut } from "../../lib/api";
import type { GeneratorMapDetail, MonthIndicators, MonthSummaryResponse } from "../../lib/types";

const td = "px-4 py-2.5 text-sm text-ink-700 whitespace-nowrap";
const num = `${td} text-right tabular-nums`;

/** Resumo do mês (substitui a folha "Resumo") + indicadores manuais do Mapa Resumo de Validações. */
export default function SummaryTab({ map }: { map: GeneratorMapDetail }) {
  const s = useQuery({ queryKey: ["map-summary", map.id], queryFn: () => api<MonthSummaryResponse>(`/generators/summary/${map.id}`) });
  if (s.isLoading) return <Spinner />;
  if (s.error) return <Alert>{errorMessage(s.error)}</Alert>;
  const d = s.data!;
  const totalCat = (c: string) => d.totaisCategoria.find((t) => t.categoria === c)!;

  return (
    <div className="space-y-4">
      {d.ivaEmFalta && <Alert>A tabela de preços não tem IVA definido: o IVA foi assumido como 0.</Alert>}
      <Card className="overflow-x-auto">
        <div className="border-b border-ink-100 px-5 py-3">
          <h3 className="font-semibold text-navy-950">Mapa de facturação do mês</h3>
          <p className="text-xs text-ink-500">
            Validado = medições validadas ou fechadas; Diferença = facturado (todas as medições) − validado. IVA {d.ivaPercent ? formatPercent(d.ivaPercent) : "—"} sobre aluguer e serviço de abastecimento, calculado sobre o validado; o combustível não leva IVA.
          </p>
        </div>
        <table className="min-w-full divide-y divide-ink-100">
          <thead className="bg-ink-50/60">
            <tr>
              <th className={th}>Categoria</th>
              <th className={`${th} text-right`}>Validado</th>
              <th className={`${th} text-right`}>Diferença</th>
              <th className={`${th} text-right`}>IVA</th>
              <th className={`${th} text-right`}>Total + IVA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {["Aluguer", "Combustível", "Serviço de Abastecimento"].map((c) => (
              <Fragment key={c}>
                {d.linhas.filter((l) => l.categoria === c).map((l) => (
                  <tr key={`${c}${l.zona}`}>
                    <td className={td}>{c} · {l.zona}</td>
                    <td className={num}>{formatKz(l.validado)}</td>
                    <td className={`${num} ${l.diferenca !== "0" ? "text-amber-700" : "text-ink-400"}`}>{formatKz(l.diferenca)}</td>
                    <td className={num}>{c === "Combustível" ? "—" : formatKz(l.iva)}</td>
                    <td className={num}>{formatKz(l.totalComIva)}</td>
                  </tr>
                ))}
                <tr className="bg-ink-50/60">
                  <td className={`${td} font-semibold text-navy-950`}>{c} · total</td>
                  <td className={`${num} font-semibold text-navy-950`}>{formatKz(totalCat(c).validado)}</td>
                  <td className={`${num} font-semibold`}>{formatKz(totalCat(c).diferenca)}</td>
                  <td className={`${num} font-semibold`}>{c === "Combustível" ? "—" : formatKz(totalCat(c).iva)}</td>
                  <td className={`${num} font-semibold text-navy-950`}>{formatKz(totalCat(c).totalComIva)}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-ink-200 bg-navy-950 text-white">
            <tr>
              <td className="px-4 py-3 text-sm font-semibold">Total a pagar</td>
              <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">{formatKz(d.total.validado)}</td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">{formatKz(d.total.diferenca)}</td>
              <td className="px-4 py-3 text-right text-sm tabular-nums">{formatKz(d.total.iva)}</td>
              <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">{formatKz(d.total.totalComIva)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
      <IndicatorsCard map={map} data={d} />
    </div>
  );
}

function IndicatorsCard({ map, data }: { map: GeneratorMapDetail; data: MonthSummaryResponse }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = !!user && can(user.permissions, "billing_generators", "validate");
  const toForm = (i: MonthIndicators | null) => ({
    sitesRedePublica: i?.sitesRedePublica?.toString() ?? "",
    sitesRedeConfiguradosNetEco: i?.sitesRedeConfiguradosNetEco?.toString() ?? "",
    sitesRedeSemGarantia: i?.sitesRedeSemGarantia?.toString() ?? "",
    poupancaCent: i?.poupancaCent ?? null,
    transporteExtraCent: i?.transporteExtraCent ?? null,
  });
  const [f, setF] = useState(toForm(data.indicadores));
  const [saved, setSaved] = useState(false);
  useEffect(() => setF(toForm(data.indicadores)), [data.indicadores]);
  const save = useMutation({
    mutationFn: () => apiPut(`/generators/maps/${map.id}/indicators`, f),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries(["map-summary", map.id]);
      qc.invalidateQueries(["validations"]);
    },
  });
  const set = (p: Partial<typeof f>) => {
    setSaved(false);
    setF((x) => ({ ...x, ...p }));
  };
  const intField = (k: "sitesRedePublica" | "sitesRedeConfiguradosNetEco" | "sitesRedeSemGarantia", label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input inputMode="numeric" placeholder="—" disabled={!canEdit} value={f[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<typeof f>)} />
    </Field>
  );

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="font-semibold text-navy-950">Indicadores do mês (Mapa Resumo de Validações)</h3>
        <p className="text-xs text-ink-500">Valores inseridos manualmente; podem ficar em branco.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {intField("sitesRedePublica", "Sites ligados à rede pública", `No mapa: ${data.sugestoes.sitesRedePublica} sites marcados como ligados`)}
        {intField("sitesRedeConfiguradosNetEco", "Configurados no NetEco")}
        {intField("sitesRedeSemGarantia", "Sem poupança garantida")}
        <Field label="Poupança (saving)">
          <MoneyInput value={f.poupancaCent} disabled={!canEdit} onChange={(v) => set({ poupancaCent: v })} aria-label="Poupança" />
        </Field>
        <Field label="Transporte extra de combustível">
          <MoneyInput value={f.transporteExtraCent} disabled={!canEdit} onChange={(v) => set({ transporteExtraCent: v })} aria-label="Transporte extra" />
        </Field>
      </div>
      {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
      {saved && <Alert kind="success">Indicadores guardados.</Alert>}
      {canEdit && (
        <div className="flex justify-end">
          <Button disabled={save.isLoading} onClick={() => save.mutate()}>{save.isLoading ? "A guardar…" : "Guardar indicadores"}</Button>
        </div>
      )}
    </Card>
  );
}

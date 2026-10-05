import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatKz, MONTHS_FULL } from "@cf/shared";
import { Alert, Card, Select, Spinner, errorMessage, td, th } from "../../components/ui";
import { api } from "../../lib/api";
import type { BillingOptions, ProvidersSummary } from "../../lib/types";
import { yearOptions } from "../../lib/years";

const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}%`);

function Kpi({ label, value, tone = "navy" }: { label: string; value: string; tone?: "navy" | "brand" }) {
  return (
    <Card className="p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-2 text-xl font-semibold tabular-nums ${tone === "brand" ? "text-brand-600" : "text-navy-950"}`}>{value}</div>
    </Card>
  );
}

/** Resumo anual: tabela mês × provider, remanescente, dívida, % de execução e alertas de orçamento mensal. */
export default function SummaryTab({ options }: { options: BillingOptions }) {
  const [ano, setAno] = useState(new Date().getFullYear());
  const [teamId, setTeamId] = useState("");
  const [validadas, setValidadas] = useState(false);

  const qs = new URLSearchParams({ ano: String(ano) });
  if (teamId) qs.set("teamId", teamId);
  if (validadas) qs.set("validadas", "true");
  const summary = useQuery({
    queryKey: ["providers-summary", ano, teamId, validadas],
    queryFn: () => api<ProvidersSummary>(`/billing/providers/summary?${qs}`),
    keepPreviousData: true,
  });

  const s = summary.data;
  const alerts = s?.providers.flatMap((p) => p.mesesAcimaOrcamento.map((m) => `${p.nome} em ${MONTHS_FULL[m - 1]}`)) || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="w-24" aria-label="Ano">
          {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        {options.teams.length > 1 && (
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-48" aria-label="Equipa">
            <option value="">Todas as equipas</option>
            {options.teams.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </Select>
        )}
        <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-ink-700 ring-1 ring-ink-200">
          <input type="checkbox" className="accent-brand-500" checked={validadas} onChange={(e) => setValidadas(e.target.checked)} />
          Só facturas validadas
        </label>
      </div>

      {summary.isLoading ? (
        <Spinner />
      ) : summary.error ? (
        <Alert>{errorMessage(summary.error)}</Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi label={`Facturado ${s!.ano}`} value={formatKz(s!.totalAno)} />
            <Kpi label="Pago" value={formatKz(s!.pagoAno)} />
            <Kpi label="Dívida" value={formatKz(s!.dividaAno)} tone="brand" />
          </div>

          {alerts.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="font-semibold">Orçamento mensal ultrapassado:</span> {alerts.join("; ")}.
            </div>
          )}

          <Card className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100 text-sm">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Mês</th>
                  {s!.providers.map((p) => <th key={p.providerId} className={`${th} text-right`}>{p.nome}</th>)}
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {MONTHS_FULL.map((m, i) => (
                  <tr key={m} className="hover:bg-ink-50/50">
                    <td className={`${td} font-medium text-navy-950`}>{m}</td>
                    {s!.providers.map((p) => {
                      const over = p.mesesAcimaOrcamento.includes(i + 1);
                      const v = p.facturadoMes[i];
                      return (
                        <td
                          key={p.providerId}
                          className={`${td} whitespace-nowrap text-right tabular-nums ${over ? "bg-red-50 font-semibold text-red-700" : v === "0" ? "text-ink-300" : ""}`}
                          title={over ? `Acima do orçamento mensal (${formatKz(p.orcamentoMensal)})` : undefined}
                        >
                          {v === "0" ? "—" : formatKz(v)}
                        </td>
                      );
                    })}
                    <td className={`${td} whitespace-nowrap text-right font-medium tabular-nums text-navy-950`}>{s!.totalMes[i] === "0" ? "—" : formatKz(s!.totalMes[i])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-ink-200 bg-ink-50/60">
                <tr>
                  <td className={`${td} font-semibold text-navy-950`}>Total</td>
                  {s!.providers.map((p) => <td key={p.providerId} className={`${td} whitespace-nowrap text-right font-semibold tabular-nums text-navy-950`}>{formatKz(p.facturadoAno)}</td>)}
                  <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums text-navy-950`}>{formatKz(s!.totalAno)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>

          <Card className="overflow-x-auto">
            <div className="border-b border-ink-100 px-5 py-3">
              <h3 className="font-semibold text-navy-950">Orçamento e execução</h3>
              <p className="text-xs text-ink-500">Orçamento anual = mensal × 12. Sem orçamento definido, o remanescente e a % de execução ficam "—".</p>
            </div>
            <table className="min-w-full divide-y divide-ink-100 text-sm">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Parceiro</th>
                  <th className={`${th} text-right`}>Orç. mensal</th>
                  <th className={`${th} text-right`}>Orç. anual</th>
                  <th className={`${th} text-right`}>Facturado</th>
                  <th className={`${th} text-right`}>Pago</th>
                  <th className={`${th} text-right`}>Dívida</th>
                  <th className={`${th} text-right`}>Remanescente</th>
                  <th className={th}>Execução</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {s!.providers.map((p) => (
                  <tr key={p.providerId}>
                    <td className={`${td} font-medium text-navy-950`}>{p.nome}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(p.orcamentoMensal)}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(p.orcamentoAnual)}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(p.facturadoAno)}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(p.pagoAno)}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(p.divida)}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums ${p.remanescente !== null && BigInt(p.remanescente) < BigInt(0) ? "font-semibold text-red-700" : ""}`}>
                      {formatKz(p.remanescente)}
                    </td>
                    <td className={`${td} min-w-[8rem]`}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                          <div
                            className={`h-full rounded-full ${p.execucaoPercent !== null && p.execucaoPercent > 100 ? "bg-red-500" : "bg-brand-500"}`}
                            style={{ width: `${Math.min(100, p.execucaoPercent ?? 0)}%` }}
                          />
                        </div>
                        <span className="w-14 text-right text-xs tabular-nums text-ink-600">{pct(p.execucaoPercent)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatKz, INVOICE_STATUS_LABELS, MONTHS, MONTHS_FULL, RECORD_STATE_LABELS } from "@cf/shared";
import { ChartCard, ChartTooltip, INK, kzCompact, Legend, SERIES, StatTile } from "../../components/charts";
import { Badge, th, td } from "../../components/ui";
import type { DashboardResponse } from "../../lib/types";
import { stateTone } from "../billing-providers/invoiceRules";

type P = NonNullable<DashboardResponse["providers"]>;

const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%`);

export default function ProvidersDashboard({ data, simplified }: { data: P; simplified: boolean }) {
  const k = data.kpis;
  // A cor segue o provider (ordem alfabética fixa), mesmo quando o filtro reduz a lista.
  const colorOf = new Map(data.porProvider.map((p, i) => [p.providerId, SERIES[i % SERIES.length]]));
  const chartData = data.mensal.map((m) => ({
    mes: MONTHS[m.mes - 1],
    ...Object.fromEntries(Object.entries(m.porProvider).map(([id, v]) => [id, Number(v)])),
  }));
  const withValues = data.porProvider.filter((p) => data.mensal.some((m) => m.porProvider[p.providerId] !== "0"));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Orçamento anual" value={formatKz(k.orcamentoAnual)} />
        <StatTile label="Facturado" value={formatKz(k.facturado)} sub={`Execução ${pct(k.execucaoPercent)}`} />
        <StatTile label="Pago" value={formatKz(k.pago)} />
        <StatTile label="Dívida" value={formatKz(k.divida)} tone={BigInt(k.divida) > BigInt(0) ? "warn" : undefined} />
        <StatTile label="Remanescente" value={formatKz(k.remanescente)} tone={k.remanescente !== null && BigInt(k.remanescente) < BigInt(0) ? "bad" : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ChartCard title="Consumo do orçamento por parceiro" subtitle="Facturado no ano face ao orçamento anual (mensal × 12).">
          <ul className="space-y-4">
            {data.porProvider.map((p) => {
              const v = p.execucaoPercent ?? 0;
              return (
                <li key={p.providerId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-navy-950">{p.nome}</span>
                    <span className="tabular-nums text-ink-600">{formatKz(p.facturado)} <span className="text-ink-400">/ {formatKz(p.orcamentoAnual)}</span></span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.nome}: ${pct(p.execucaoPercent)}`}>
                    <div className={`h-full rounded-full ${v > 100 ? "bg-red-500" : ""}`} style={{ width: `${Math.min(100, v)}%`, background: v > 100 ? undefined : colorOf.get(p.providerId) }} />
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-ink-500">
                    <span>{pct(p.execucaoPercent)} executado</span>
                    <span>Remanescente {formatKz(p.remanescente)}</span>
                  </div>
                  {p.mesesAcimaOrcamento.length > 0 && (
                    <div className="mt-1 text-xs font-medium text-red-700">Acima do orçamento mensal em {p.mesesAcimaOrcamento.map((m) => MONTHS_FULL[m - 1]).join(", ")}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </ChartCard>

        {!simplified && (
          <ChartCard
            title="Facturado por mês"
            subtitle="Valor das facturas por parceiro (Kz)."
            legend={withValues.length > 1 ? <Legend items={withValues.map((p) => ({ label: p.nome, color: colorOf.get(p.providerId)! }))} /> : undefined}
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="25%">
                  <CartesianGrid vertical={false} stroke={INK.grid} />
                  <XAxis dataKey="mes" tickLine={false} axisLine={{ stroke: INK.grid }} tick={{ fill: INK.axis, fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => kzCompact(v)} tickLine={false} axisLine={false} tick={{ fill: INK.axis, fontSize: 12 }} width={64} />
                  <Tooltip
                    cursor={{ fill: "rgba(8,0,60,0.04)" }}
                    content={<ChartTooltip valueFormatter={(v) => formatKz(Math.round(Number(v)))} />}
                    formatter={(v) => v}
                  />
                  {withValues.map((p, i) => (
                    <Bar
                      key={p.providerId}
                      dataKey={p.providerId}
                      name={p.nome}
                      stackId="m"
                      fill={colorOf.get(p.providerId)}
                      stroke="#fff"
                      strokeWidth={2}
                      radius={i === withValues.length - 1 ? [4, 4, 0, 0] : 0}
                      maxBarSize={40}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}
      </div>

      <ChartCard title="Facturas pendentes" subtitle="Por validar ou ainda não fechadas (10 mais recentes).">
        {data.pendentes.length === 0 ? (
          <p className="text-sm text-ink-500">Sem facturas pendentes.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Parceiro</th>
                  <th className={th}>Período</th>
                  <th className={th}>Factura</th>
                  <th className={`${th} text-right`}>Valor FT</th>
                  <th className={`${th} text-right`}>Dívida</th>
                  <th className={th}>Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.pendentes.map((i) => (
                  <tr key={i.id}>
                    <td className={td}>{i.provider}<div className="text-xs text-ink-500">{i.equipa}</div></td>
                    <td className={`${td} whitespace-nowrap`}>{MONTHS[i.mes - 1]}/{i.ano}</td>
                    <td className={td}>{i.numeroFactura || "—"}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(i.valorFTCent)}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(i.dividaCent)}</td>
                    <td className={td}>
                      <Badge tone={stateTone[i.state]}>{RECORD_STATE_LABELS[i.state]}</Badge>
                      <div className="mt-1 text-xs text-ink-500">{INVOICE_STATUS_LABELS[i.status]}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

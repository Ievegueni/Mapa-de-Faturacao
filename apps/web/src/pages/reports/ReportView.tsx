import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cellType, formatDecimal, ReportChart, ReportData, ReportSection } from "@cf/shared";
import { ChartCard, ChartTooltip, INK, kzCompact, Legend, SERIES } from "../../components/charts";
import { cellText, isNumeric } from "../../export/format";

/** Linhas mostradas por secção na pré-visualização (a exportação leva todas). */
const PREVIEW_ROWS = 50;

const fmtValue = (formato: ReportChart["formato"]) => (v: number | string) =>
  formato === "kz" ? kzCompact(v) : formato === "decimal" ? formatDecimal(Number(v)) : Number(v).toLocaleString("pt-PT");

function Chart({ chart }: { chart: ReportChart }) {
  const data = chart.categorias.map((c, i) => ({ cat: c, ...Object.fromEntries(chart.series.map((s, j) => [`s${j}`, s.valores[i]])) }));
  const color = (j: number) => SERIES[j % SERIES.length];
  const axisFmt = (v: number) => (chart.formato === "kz" ? kzCompact(v) : Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 0 }));
  const tooltip = <Tooltip cursor={{ fill: INK.grid }} content={<ChartTooltip valueFormatter={(v) => fmtValue(chart.formato)(v)} />} />;
  const common = { data, margin: { top: 8, right: 16, bottom: 0, left: 8 } };
  const axisProps = { tick: { fill: INK.text, fontSize: 11 }, stroke: INK.axis, tickLine: false };
  const height = chart.horizontal ? Math.max(220, chart.categorias.length * 28 + 40) : 260;
  const legend = chart.series.length > 1 ? <Legend items={chart.series.map((s, j) => ({ label: s.nome, color: color(j) }))} /> : undefined;

  if (!chart.series.some((s) => s.valores.some((v) => v !== null && v !== 0))) {
    return (
      <ChartCard title={chart.titulo}>
        <p className="py-10 text-center text-sm text-ink-500">Sem valores para mostrar.</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={chart.titulo} legend={legend}>
      {/* data-chart-* marca o gráfico para a exportação (export/chartToPng.ts) */}
      <div data-chart-id={chart.id} data-chart-title={chart.titulo} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart.tipo === "linhas" ? (
            <LineChart {...common}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis dataKey="cat" {...axisProps} />
              <YAxis {...axisProps} axisLine={false} tickFormatter={axisFmt} width={64} />
              {tooltip}
              {chart.series.map((s, j) => (
                <Line key={s.nome} dataKey={`s${j}`} name={s.nome} stroke={color(j)} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "#fff" }} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          ) : (
            <BarChart {...common} layout={chart.horizontal ? "vertical" : "horizontal"} barCategoryGap="25%">
              <CartesianGrid stroke={INK.grid} vertical={!!chart.horizontal} horizontal={!chart.horizontal} />
              {chart.horizontal ? (
                <>
                  <XAxis type="number" {...axisProps} tickFormatter={axisFmt} />
                  <YAxis type="category" dataKey="cat" {...axisProps} width={140} />
                </>
              ) : (
                <>
                  <XAxis dataKey="cat" {...axisProps} />
                  <YAxis {...axisProps} axisLine={false} tickFormatter={axisFmt} width={64} />
                </>
              )}
              {tooltip}
              {chart.series.map((s, j) => (
                <Bar
                  key={s.nome}
                  dataKey={`s${j}`}
                  name={s.nome}
                  fill={color(j)}
                  stackId={chart.tipo === "barras_empilhadas" ? "a" : undefined}
                  stroke="#fff"
                  strokeWidth={chart.tipo === "barras_empilhadas" ? 1 : 0}
                  radius={chart.tipo === "barras_empilhadas" && j < chart.series.length - 1 ? 0 : chart.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                  maxBarSize={40}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function SectionTable({ section }: { section: ReportSection }) {
  const [all, setAll] = useState(false);
  const rows = all ? section.linhas : section.linhas.slice(0, PREVIEW_ROWS);
  const destaque = new Set(section.destaque ?? []);
  const cls = (t: string) => `whitespace-nowrap px-3 py-2 ${isNumeric(t as never) ? "text-right tabular-nums" : "text-left"}`;
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-ink-100">
      <div className="flex items-center justify-between px-5 py-3">
        <h3 className="font-semibold text-navy-950">{section.titulo}</h3>
        <span className="text-xs text-ink-500">{section.linhas.length.toLocaleString("pt-PT")} linha(s)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-950 text-white">
            <tr>{section.colunas.map((c) => <th key={c.key} className={`${cls(c.tipo)} text-xs font-semibold`}>{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-ink-100 text-ink-700">
            {rows.length === 0 && (
              <tr><td colSpan={section.colunas.length} className="px-3 py-6 text-center text-ink-500">Sem dados para os filtros escolhidos.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className={destaque.has(i) ? "bg-ink-50 font-semibold text-navy-950" : ""}>
                {section.colunas.map((c) => <td key={c.key} className={cls(cellType(section, c, r))}>{cellText(section, c, r)}</td>)}
              </tr>
            ))}
          </tbody>
          {section.totais && rows.length > 0 && (
            <tfoot className="border-t-2 border-ink-200 bg-ink-50 font-semibold text-navy-950">
              <tr>{section.colunas.map((c) => <td key={c.key} className={cls(c.tipo)}>{section.totais![c.key] === undefined ? "" : cellText(section, c, section.totais!)}</td>)}</tr>
            </tfoot>
          )}
        </table>
      </div>
      {section.linhas.length > PREVIEW_ROWS && (
        <div className="border-t border-ink-100 px-5 py-2 text-xs text-ink-500">
          {all ? "A mostrar todas as linhas." : `A mostrar ${PREVIEW_ROWS} de ${section.linhas.length.toLocaleString("pt-PT")} linhas (a exportação inclui todas).`}{" "}
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setAll(!all)}>{all ? "Mostrar menos" : "Mostrar todas"}</button>
        </div>
      )}
    </div>
  );
}

export default function ReportView({ report }: { report: ReportData }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-navy-950">{report.titulo}</h2>
        <p className="text-sm text-ink-500">{report.periodo} · {Object.entries(report.filtros).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
      </div>
      {report.avisos.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          <ul className="list-disc pl-5">{report.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {report.graficos.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">{report.graficos.map((c) => <Chart key={c.id} chart={c} />)}</div>
      )}
      {report.secoes.map((s) => <SectionTable key={s.titulo} section={s} />)}
    </div>
  );
}

import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDecimal, formatKz, GENERATOR_FLAG_LABELS, GeneratorFlag, MONTHS, MONTHS_FULL } from "@cf/shared";
import { ChartCard, ChartTooltip, INK, kzCompact, Legend, SERIES, StatTile } from "../../components/charts";
import { th, td } from "../../components/ui";
import type { DashboardResponse } from "../../lib/types";

type G = NonNullable<DashboardResponse["geradores"]>;
type Cmp = G["comparacao"]["global"]["aluguerManut"];

const PRICE_FLAGS = ["SEM_PRECO_ALUGUER", "SEM_PRECO_COMBUSTIVEL", "SEM_PRECO_SERV_ABAST"];

function TargetBar({ label, c }: { label: string; c: Cmp }) {
  const p = c.percent;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-700">{label}</span>
        <span className="tabular-nums text-ink-900">
          {formatKz(c.valor)} <span className="text-ink-400">/ {c.target === null ? "sem target" : formatKz(c.target)}</span>
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={p ?? 0} aria-label={`${label}: ${p === null ? "sem target" : `${p}% do target`}`}>
        <div className={`h-full rounded-full ${p !== null && p > 100 ? "bg-red-500" : "bg-[#dc6f00]"}`} style={{ width: `${Math.min(100, p ?? 0)}%` }} />
      </div>
      <div className={`mt-1 text-xs ${p !== null && p > 100 ? "font-medium text-red-700" : "text-ink-500"}`}>
        {p === null ? "Defina o target em Configuração → Targets" : `${p.toLocaleString("pt-PT", { maximumFractionDigits: 1 })}% do target${p > 100 ? " (acima)" : ""}`}
      </div>
    </div>
  );
}

export default function GeneratorsDashboard({ data, simplified }: { data: G; simplified: boolean }) {
  const k = data.kpis;
  const evo = data.evolucao.map((e) => ({
    mes: MONTHS[e.mes - 1],
    aluguerManut: e.aluguerManut === null ? null : Number(e.aluguerManut),
    abastecimento: e.abastecimento === null ? null : Number(e.abastecimento),
  }));
  const regioes = data.regioes.map((r) => ({ regiao: r.regiao, total: Number(r.total), litros: r.litros }));
  const potencias = data.potencias.map((p) => ({ potencia: p.potencia === "—" ? "Sem potência" : `${p.potencia} kVA`, geradores: p.geradores }));
  const maxLitros = Math.max(1, ...data.topSites.map((s) => Number(s.litros)));
  const priceFlags = data.flags.filter((f) => PRICE_FLAGS.includes(f.flag));
  const otherFlags = data.flags.filter((f) => !PRICE_FLAGS.includes(f.flag));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={`Total · ${MONTHS[data.mes - 1]}`} value={formatKz(k.total)} sub={`${k.mapas} mapa${k.mapas === 1 ? "" : "s"}${k.porValidar ? ` · ${k.porValidar} por validar` : ""}`} />
        <StatTile label="Aluguer" value={formatKz(k.aluguer)} />
        <StatTile label="Combustível" value={formatKz(k.combustivel)} />
        <StatTile label="Litros" value={formatDecimal(k.litros)} />
        <StatTile label="Desconto de rede" value={formatKz(k.descontoRede)} />
        <StatTile label="Penalizações" value={formatKz(k.penalizacoes)} />
        <StatTile label="Geradores" value={k.geradores.toLocaleString("pt-PT")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Comparação com os targets" subtitle={`${MONTHS_FULL[data.mes - 1]}: aluguer e manutenção (aluguer − desconto + manutenção) e abastecimento (combustível + serviço).`}>
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Target global (todos os parceiros)</div>
              <TargetBar label="Aluguer e manutenção" c={data.comparacao.global.aluguerManut} />
              <TargetBar label="Abastecimento" c={data.comparacao.global.abastecimento} />
            </div>
            {data.comparacao.providers.map((p) => (
              <div key={p.providerId} className="space-y-3 border-t border-ink-100 pt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Target do parceiro · {p.nome}</div>
                <TargetBar label="Aluguer e manutenção" c={p.aluguerManut} />
                <TargetBar label="Abastecimento" c={p.abastecimento} />
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Avisos pendentes" subtitle={`Medições de ${MONTHS_FULL[data.mes - 1]} com avisos (não bloqueiam a gravação).`}>
          {data.flags.length === 0 ? (
            <p className="text-sm text-ink-500">Sem avisos neste mês.</p>
          ) : (
            <div className="space-y-4">
              {priceFlags.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">Preços em falta</div>
                  <ul className="space-y-1.5">
                    {priceFlags.map((f) => (
                      <li key={f.flag} className="flex justify-between text-sm"><span className="text-ink-700">⚠ {GENERATOR_FLAG_LABELS[f.flag as GeneratorFlag]}</span><span className="font-medium tabular-nums">{f.n.toLocaleString("pt-PT")}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {otherFlags.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-700">A verificar</div>
                  <ul className="space-y-1.5">
                    {otherFlags.map((f) => (
                      <li key={f.flag} className="flex justify-between text-sm"><span className="text-ink-700">⚠ {GENERATOR_FLAG_LABELS[f.flag as GeneratorFlag] || f.flag}</span><span className="font-medium tabular-nums">{f.n.toLocaleString("pt-PT")}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              <Link to="/geradores/mapas" className="inline-block text-sm font-medium text-brand-700 hover:underline">Abrir os mapas para corrigir →</Link>
            </div>
          )}
        </ChartCard>
      </div>

      {!simplified && (
        <>
          <ChartCard
            title="Evolução mensal"
            subtitle="Aluguer e manutenção vs abastecimento (Kz)."
            legend={<Legend items={[{ label: "Aluguer e manutenção", color: SERIES[0] }, { label: "Abastecimento", color: SERIES[1] }]} />}
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={evo} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke={INK.grid} />
                  <XAxis dataKey="mes" tickLine={false} axisLine={{ stroke: INK.grid }} tick={{ fill: INK.axis, fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => kzCompact(v)} tickLine={false} axisLine={false} tick={{ fill: INK.axis, fontSize: 12 }} width={64} />
                  <Tooltip cursor={{ stroke: INK.axis, strokeDasharray: "3 3" }} content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="aluguerManut" name="Aluguer e manutenção" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} />
                  <Line type="monotone" dataKey="abastecimento" name="Abastecimento" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Distribuição por região" subtitle={`Total de ${MONTHS_FULL[data.mes - 1]} (Kz).`}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={regioes} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 8 }} barCategoryGap="30%">
                    <CartesianGrid horizontal={false} stroke={INK.grid} />
                    <XAxis type="number" tickFormatter={(v) => kzCompact(v)} tickLine={false} axisLine={false} tick={{ fill: INK.axis, fontSize: 12 }} />
                    <YAxis type="category" dataKey="regiao" tickLine={false} axisLine={false} tick={{ fill: INK.text, fontSize: 12 }} width={60} />
                    <Tooltip cursor={{ fill: "rgba(8,0,60,0.04)" }} content={<ChartTooltip />} />
                    <Bar dataKey="total" name="Total" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={28} label={{ position: "right", fill: INK.text, fontSize: 11, formatter: (v: number) => kzCompact(v) }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
            <ChartCard title="Distribuição por potência" subtitle="Geradores no parque (sem os removidos).">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={potencias} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                    <CartesianGrid vertical={false} stroke={INK.grid} />
                    <XAxis dataKey="potencia" tickLine={false} axisLine={{ stroke: INK.grid }} tick={{ fill: INK.text, fontSize: 12 }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: INK.axis, fontSize: 12 }} width={40} />
                    <Tooltip cursor={{ fill: "rgba(8,0,60,0.04)" }} content={<ChartTooltip valueFormatter={(v) => Number(v).toLocaleString("pt-PT")} />} />
                    <Bar dataKey="geradores" name="Geradores" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={48} label={{ position: "top", fill: INK.text, fontSize: 11 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <ChartCard title="Top 10 sites por litros" subtitle={MONTHS_FULL[data.mes - 1]}>
            <div className="-mx-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-100">
                <thead className="bg-ink-50/60">
                  <tr>
                    <th className={th}>#</th>
                    <th className={th}>Site</th>
                    <th className={th}>Província</th>
                    <th className={`${th} w-1/3`}>Litros</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {data.topSites.length === 0 && <tr><td colSpan={4} className={`${td} text-center text-ink-400`}>Sem litros registados.</td></tr>}
                  {data.topSites.map((s, i) => (
                    <tr key={s.siteId}>
                      <td className={`${td} tabular-nums text-ink-400`}>{i + 1}</td>
                      <td className={td}><span className="font-medium text-navy-950">{s.nome}</span><div className="text-xs text-ink-500">{s.codigoPP || "—"}</div></td>
                      <td className={td}>{s.provincia}</td>
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100"><div className="h-full rounded-full" style={{ width: `${(Number(s.litros) / maxLitros) * 100}%`, background: SERIES[0] }} /></div>
                          <span className="w-20 text-right text-xs tabular-nums text-ink-700">{formatDecimal(s.litros)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}
    </div>
  );
}

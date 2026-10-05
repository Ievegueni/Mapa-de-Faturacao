import { ReactNode } from "react";
import { formatKz } from "@cf/shared";

/**
 * Paleta categórica dos gráficos — tons das escalas da marca (CLAUDE.md §18), validados com o validador de paletas
 * (luminosidade, croma, separação para daltonismo e contraste ≥ 3:1 sobre fundo claro).
 * Ordem fixa: a cor segue a entidade (provider, série), nunca a posição.
 */
export const SERIES = ["#dc6f00", "#5f55b5", "#b35700", "#8a82cf"]; // brand-600, navy-400, brand-700, navy-300
export const INK = { axis: "#8c8c96", grid: "#eeeef0", text: "#4d4d56", target: "#3a3a41" };

/** Kz compacto para eixos e etiquetas: 445,98 M · 12,3 mil. */
export function kzCompact(cents: string | number | bigint | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const v = Number(cents) / 100;
  const abs = Math.abs(v);
  const f = (n: number, d: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  if (abs >= 1e9) return `${f(v / 1e9, 2)} mM`;
  if (abs >= 1e6) return `${f(v / 1e6, 2)} M`;
  if (abs >= 1e3) return `${f(v / 1e3, 1)} mil`;
  return f(v, 0);
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (v) => formatKz(Math.round(Number(v))),
}: {
  active?: boolean;
  payload?: { name: string; value: number | string; color?: string; dataKey?: string; payload?: unknown }[];
  label?: string | number;
  labelFormatter?(l: string | number): string;
  valueFormatter?(v: number | string, key?: string): string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-ink-200">
      {label !== undefined && <div className="mb-1 font-semibold text-navy-950">{labelFormatter ? labelFormatter(label) : label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 py-0.5">
          <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-ink-600">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums text-ink-900">{valueFormatter(p.value, String(p.dataKey))}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.dashed ? <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} /> : <span className="size-2.5 rounded-sm" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ title, subtitle, legend, children, className = "" }: { title: string; subtitle?: string; legend?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink-100 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-navy-950">{title}</h3>
          {subtitle && <p className="text-xs text-ink-500">{subtitle}</p>}
        </div>
        {legend}
      </div>
      {children}
    </div>
  );
}

export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: "warn" | "bad" | "good" }) {
  const color = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-navy-950";
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-ink-100">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-1.5 break-words text-xl font-semibold leading-tight tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

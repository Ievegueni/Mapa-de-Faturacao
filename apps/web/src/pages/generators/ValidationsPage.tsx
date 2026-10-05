import { Fragment, ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDecimal, formatKz, MONTHS } from "@cf/shared";
import { Alert, Card, PageHeader, Select, Spinner, errorMessage } from "../../components/ui";
import { api } from "../../lib/api";
import type { GeneratorOptions, ValidationMonth, ValidationsResponse } from "../../lib/types";
import { yearOptions } from "../../lib/years";

type M = Extract<ValidationMonth, { temMapa: true }>;
type Cell = string | number | null;

/** Valor em Kz sem o sufixo (a tabela indica "valores em Kz"). */
const kz = (v: string | null | undefined) => (v === null || v === undefined ? "—" : formatKz(v).replace(" Kz", ""));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}%`);
const int = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-PT"));

interface Row {
  label: string;
  /** Valor por mês (só meses com mapa). */
  get(m: M): Cell;
  /** Indicadores manuais existem mesmo sem mapa. */
  manual?: boolean;
  format: "kz" | "int" | "pct" | "litros";
  /** Soma na coluna Total. */
  sum?: boolean;
  strong?: boolean;
  tone?(m: M): "bad" | "good" | undefined;
}

const fmt = (v: Cell, f: Row["format"]) =>
  v === null ? "—" : f === "kz" ? kz(String(v)) : f === "int" ? int(Number(v)) : f === "pct" ? pct(Number(v)) : formatDecimal(String(v));

const toneDev = (d: { desvio: string | null }) => (d.desvio === null ? undefined : BigInt(d.desvio) > BigInt(0) ? "bad" : "good");

function buildSections(potencias: string[]): { title: string; rows: Row[] }[] {
  return [
    {
      title: "Análise das penalizações",
      rows: [
        { label: "Geradores penalizados por SLA", get: (m) => m.penSLA.n, format: "int", sum: true },
        { label: "Valor das penalizações por SLA", get: (m) => m.penSLA.valor, format: "kz", sum: true },
        { label: "Penalizações por falta de combustível no gerador", get: (m) => m.penNivelCombust.n, format: "int", sum: true },
        { label: "Valor das penalizações por falta de combustível", get: (m) => m.penNivelCombust.valor, format: "kz", sum: true },
        { label: "Geradores com 35040 ≤ h < 36480 (incumprimento 40%)", get: (m) => m.penHoras["40"].n, format: "int" },
        { label: "Valor das penalizações por horas — 40%", get: (m) => m.penHoras["40"].valor, format: "kz", sum: true },
        { label: "Geradores com 36480 ≤ h < 37920 (incumprimento 60%)", get: (m) => m.penHoras["60"].n, format: "int" },
        { label: "Valor das penalizações por horas — 60%", get: (m) => m.penHoras["60"].valor, format: "kz", sum: true },
        { label: "Geradores com h ≥ 37920 (incumprimento 100%)", get: (m) => m.penHoras["100"].n, format: "int" },
        { label: "Valor das penalizações por horas — 100%", get: (m) => m.penHoras["100"].valor, format: "kz", sum: true },
        { label: "Total das penalizações por excesso de horas", get: (m) => m.penExcessoHoras.valor, format: "kz", sum: true },
        { label: "Penalizações por avaria", get: (m) => m.penAvaria.n, format: "int", sum: true },
        { label: "Valor das penalizações por avaria", get: (m) => m.penAvaria.valor, format: "kz", sum: true },
        { label: "Valor global das penalizações", get: (m) => m.penalizacoesGlobal, format: "kz", sum: true, strong: true },
      ],
    },
    {
      title: "Rede pública e poupança (valores manuais)",
      rows: [
        { label: "Sites ligados à rede pública", get: (m) => m.indicadores?.sitesRedePublica ?? null, format: "int", manual: true },
        { label: "Sites na rede pública configurados no NetEco", get: (m) => m.indicadores?.sitesRedeConfiguradosNetEco ?? null, format: "int", manual: true },
        { label: "Sites na rede pública que não garantiram poupança", get: (m) => m.indicadores?.sitesRedeSemGarantia ?? null, format: "int", manual: true },
        { label: "Poupança (saving)", get: (m) => m.indicadores?.poupancaCent ?? null, format: "kz", manual: true, sum: true },
        { label: "Sub-total (penalizações + poupança)", get: (m) => m.subtotalPenalizacoesPoupanca, format: "kz", sum: true, strong: true },
      ],
    },
    {
      title: "Valores a facturar",
      rows: [
        { label: "Parque de geradores na rede", get: (m) => m.parqueTotal, format: "int", strong: true },
        ...potencias.map<Row>((p) => ({ label: `Parque — ${p === "—" ? "potência —" : `${p} kVA`}`, get: (m) => m.parquePorPotencia[p] ?? 0, format: "int" })),
        { label: "Target mensal — aluguer e manutenção", get: (m) => m.targets.providerAluguerManut.target, format: "kz", sum: true },
        { label: "Aluguer e manutenção (aluguer − desconto de rede + manutenção)", get: (m) => m.aluguerManutCent, format: "kz", sum: true, strong: true },
        { label: "Desvio face ao target", get: (m) => m.targets.providerAluguerManut.desvio, format: "kz", tone: (m) => toneDev(m.targets.providerAluguerManut) },
        { label: "Desvio face ao target (%)", get: (m) => m.targets.providerAluguerManut.desvioPercent, format: "pct", tone: (m) => toneDev(m.targets.providerAluguerManut) },
        { label: "Variação do aluguer e manutenção", get: (m) => m.variacaoAluguerManut.abs, format: "kz" },
        { label: "Variação do aluguer e manutenção (%)", get: (m) => m.variacaoAluguerManut.percent, format: "pct" },
        { label: "Litros abastecidos", get: (m) => m.litros, format: "litros", sum: true },
        { label: "Variação de litros", get: (m) => m.variacaoLitros, format: "litros" },
        { label: "Combustível", get: (m) => m.combustivelCent, format: "kz", sum: true },
        { label: "Serviço de abastecimento", get: (m) => m.servAbastCent, format: "kz", sum: true },
        { label: "Target mensal — combustível e serviço de abastecimento", get: (m) => m.targets.providerAbastecimento.target, format: "kz", sum: true },
        { label: "Abastecimento (combustível + serviço)", get: (m) => m.abastecimentoCent, format: "kz", sum: true, strong: true },
        { label: "Desvio face ao target", get: (m) => m.targets.providerAbastecimento.desvio, format: "kz", tone: (m) => toneDev(m.targets.providerAbastecimento) },
        { label: "Desvio face ao target (%)", get: (m) => m.targets.providerAbastecimento.desvioPercent, format: "pct", tone: (m) => toneDev(m.targets.providerAbastecimento) },
        { label: "Variação do abastecimento", get: (m) => m.variacaoAbastecimento.abs, format: "kz" },
        { label: "Total parcial", get: (m) => m.totalParcialCent, format: "kz", sum: true, strong: true },
        { label: "Transporte extra de combustível", get: (m) => m.transporteExtraCent, format: "kz", sum: true, manual: true },
        { label: "Total global", get: (m) => m.totalGlobalCent, format: "kz", sum: true, strong: true },
        { label: "Variação percentual", get: (m) => m.variacaoTotalGlobal.percent, format: "pct" },
      ],
    },
    {
      title: "Target global (todos os providers)",
      rows: [
        { label: "Target global — aluguer e manutenção", get: (m) => m.targets.globalAluguerManut.target, format: "kz", sum: true },
        { label: "Aluguer e manutenção — todos os providers", get: (m) => m.targets.globalAluguerManut.valor, format: "kz", sum: true },
        { label: "Desvio (%)", get: (m) => m.targets.globalAluguerManut.desvioPercent, format: "pct", tone: (m) => toneDev(m.targets.globalAluguerManut) },
        { label: "Target global — combustível e serviço", get: (m) => m.targets.globalAbastecimento.target, format: "kz", sum: true },
        { label: "Abastecimento — todos os providers", get: (m) => m.targets.globalAbastecimento.valor, format: "kz", sum: true },
        { label: "Desvio (%)", get: (m) => m.targets.globalAbastecimento.desvioPercent, format: "pct", tone: (m) => toneDev(m.targets.globalAbastecimento) },
      ],
    },
  ];
}

function total(row: Row, months: ValidationMonth[]): string {
  if (!row.sum) return "—";
  let any = false;
  if (row.format === "litros") {
    let s = 0;
    for (const m of months) if (m.temMapa) { const v = row.get(m); if (v !== null) { s += Number(v); any = true; } }
    return any ? formatDecimal(s) : "—";
  }
  let s = BigInt(0);
  for (const m of months) {
    if (!m.temMapa) continue;
    const v = row.get(m);
    if (v !== null) {
      s += BigInt(v);
      any = true;
    }
  }
  return any ? (row.format === "kz" ? kz(s.toString()) : int(Number(s))) : "—";
}

/** Mapa Resumo de Validações — vista anual Jan–Dez por provider. */
export default function ValidationsPage() {
  const options = useQuery({ queryKey: ["generator-options"], queryFn: () => api<GeneratorOptions>("/generators/options") });
  const [ano, setAno] = useState(new Date().getFullYear());
  const [providerId, setProviderId] = useState("");
  const [teamId, setTeamId] = useState("");
  useEffect(() => {
    if (!providerId && options.data?.providers.length) setProviderId(options.data.providers[0].id);
  }, [options.data, providerId]);

  const qs = new URLSearchParams({ ano: String(ano), providerId });
  if (teamId) qs.set("teamId", teamId);
  const data = useQuery({
    queryKey: ["validations", ano, providerId, teamId],
    queryFn: () => api<ValidationsResponse>(`/generators/validations?${qs}`),
    enabled: !!providerId,
    keepPreviousData: true,
  });

  const months = data.data?.meses ?? [];
  const potencias = Array.from(new Set(months.flatMap((m) => (m.temMapa ? Object.keys(m.parquePorPotencia) : [])))).sort((a, b) => Number(a) - Number(b));
  const sections = buildSections(potencias);
  const mapOf = (mes: number) => data.data?.mapas.find((m) => m.mes === mes);

  return (
    <>
      <PageHeader title="Mapa Resumo de Validações" subtitle="Vista anual por provider, calculada a partir das medições. Valores em Kz; divisões por zero aparecem como —." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="w-24" aria-label="Ano">
          {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="w-48" aria-label="Provider">
          {options.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </Select>
        {(options.data?.teams.length ?? 0) > 1 && (
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-48" aria-label="Equipa">
            <option value="">Todas as equipas</option>
            {options.data!.teams.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </Select>
        )}
      </div>
      {options.isLoading || (data.isLoading && !!providerId) ? (
        <Spinner />
      ) : options.error || data.error ? (
        <Alert>{errorMessage(options.error || data.error)}</Alert>
      ) : !providerId ? (
        <Alert kind="info">Não há providers de Geradores.</Alert>
      ) : (
        <Card className="overflow-auto" >
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-20 bg-navy-950 text-white">
              <tr>
                <th className="sticky left-0 z-30 min-w-[18rem] bg-navy-950 px-3 py-2.5 text-left font-semibold">{data.data?.provider.nome} · {ano}</th>
                {MONTHS.map((m, i) => {
                  const map = mapOf(i + 1);
                  return (
                    <th key={m} className="min-w-[7.5rem] px-2 py-2.5 text-right font-semibold">
                      {map ? <Link to={`/geradores/mapas/${map.id}`} className="underline decoration-brand-400 underline-offset-2 hover:text-brand-300">{m}</Link> : <span className="text-navy-300">{m}</span>}
                    </th>
                  );
                })}
                <th className="min-w-[8rem] px-3 py-2.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((sec) => (
                <Fragment key={sec.title}>
                  <tr>
                    <td colSpan={14} className="sticky left-0 bg-brand-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-brand-800">{sec.title}</td>
                  </tr>
                  {sec.rows.map((r, ri) => (
                    <tr key={`${sec.title}${ri}`} className={`border-t border-ink-100 ${r.strong ? "bg-ink-50/80" : ""}`}>
                      <td className={`sticky left-0 z-10 px-3 py-1.5 ${r.strong ? "bg-ink-50 font-semibold text-navy-950" : "bg-white text-ink-700"}`}>
                        {r.label}
                        {r.manual && <span className="ml-1 text-[10px] text-ink-400">(manual)</span>}
                      </td>
                      {months.map((m) => {
                        let content: ReactNode = <span className="text-ink-300">·</span>;
                        let tone: string | undefined;
                        if (m.temMapa) {
                          content = fmt(r.get(m), r.format);
                          const t = r.tone?.(m);
                          tone = t === "bad" ? "text-red-700" : t === "good" ? "text-emerald-700" : undefined;
                        } else if (r.manual && m.indicadores) {
                          content = fmt(r.get({ indicadores: m.indicadores } as M), r.format);
                        }
                        return (
                          <td key={m.mes} className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${r.strong ? "font-semibold text-navy-950" : "text-ink-700"} ${tone ?? ""}`}>
                            {content}
                          </td>
                        );
                      })}
                      <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${r.strong ? "font-semibold text-navy-950" : "text-ink-700"}`}>{total(r, months)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-3 text-xs text-ink-500">
        Parque = geradores sem data de remoção até ao fim do mês. Variações face ao mês anterior. Desvios: positivo (acima do target) a vermelho, negativo a verde. Os indicadores manuais preenchem-se no separador "Resumo do mês" de cada mapa.
      </p>
    </>
  );
}

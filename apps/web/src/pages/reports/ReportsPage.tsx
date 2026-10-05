import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BILLING_TYPE_LABELS, MONTHS_FULL, REGIOES, REPORT_MODELS, ReportData, ReportFilter, ReportModelo, ReportTipo } from "@cf/shared";
import { Tabs } from "../../components/Tabs";
import { Alert, Button, PageHeader, Select, Spinner, errorMessage } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { usePermission } from "../../hooks/usePermission";
import { api, apiPost } from "../../lib/api";
import type { BillingOptions, GeneratorOptions } from "../../lib/types";
import { yearOptions } from "../../lib/years";
import { captureCharts } from "../../export/chartToPng";
import { download } from "../../export/format";
import ReportView from "./ReportView";

const FILTER_LABELS: Record<ReportFilter, string> = { ano: "Ano", mes: "Mês", equipa: "Equipa", provider: "Provider", regiao: "Região", provincia: "Província" };

export default function ReportsPage() {
  const { user } = useAuth();
  const tipos = (["PROVIDERS", "GERADORES"] as ReportTipo[]).filter((t) => user?.billingTypes.includes(t));
  const [tipo, setTipo] = useState<ReportTipo>(tipos[0] ?? "PROVIDERS");
  const [modelo, setModelo] = useState<ReportModelo | "">("");
  const [ano, setAno] = useState(new Date().getFullYear());
  const [mes, setMes] = useState("");
  const [teamId, setTeamId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [regiao, setRegiao] = useState("");
  const [provincia, setProvincia] = useState("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [error, setError] = useState("");
  const viewRef = useRef<HTMLDivElement>(null);

  const canExport = usePermission("reports", "export") && usePermission(tipo === "PROVIDERS" ? "billing_providers" : "billing_generators", "export");
  const models = REPORT_MODELS.filter((m) => m.tipo === tipo);
  const def = models.find((m) => m.modelo === modelo);
  const has = (f: ReportFilter) => !!def?.filtros.includes(f);
  const required = (f: ReportFilter) => !!def?.obrigatorios.includes(f);

  const options = useQuery({
    queryKey: ["report-options", tipo],
    queryFn: async (): Promise<GeneratorOptions | BillingOptions> =>
      tipo === "PROVIDERS" ? api<BillingOptions>("/billing/providers/options") : api<GeneratorOptions>("/generators/options"),
    enabled: tipos.length > 0,
  });
  const provincias = useMemo(() => (options.data && "provincias" in options.data ? options.data.provincias : []), [options.data]);

  const missing = def?.obrigatorios.filter((f) => (f === "mes" && !mes) || (f === "provider" && !providerId)) ?? [];

  function reset() {
    setReport(null);
    setError("");
  }

  function params() {
    const qs = new URLSearchParams({ tipo, modelo: String(modelo), ano: String(ano) });
    if (has("mes") && mes) qs.set("mes", mes);
    if (has("equipa") && teamId) qs.set("teamId", teamId);
    if (has("provider") && providerId) qs.set("providerId", providerId);
    if (has("regiao") && regiao) qs.set("regiao", regiao);
    if (has("provincia") && provincia) qs.set("provincia", provincia);
    return qs;
  }

  async function preview() {
    setLoading(true);
    setError("");
    try {
      setReport(await api<ReportData>(`/reports/data?${params()}`));
    } catch (e) {
      setReport(null);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function exportAs(formato: "pdf" | "xlsx") {
    if (!report || !viewRef.current) return;
    setExporting(formato);
    setError("");
    try {
      await apiPost("/reports/log", { tipo: report.tipo, modelo: report.modelo, formato, filtros: report.filtros });
      const charts = await captureCharts(viewRef.current);
      const out =
        formato === "pdf"
          ? await (await import("../../export/pdf")).generatePdf(report, charts, user?.nome ?? "")
          : await (await import("../../export/xlsx")).generateXlsx(report, charts, user?.nome ?? "");
      download(out.blob, out.name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(null);
    }
  }

  if (tipos.length === 0) {
    return (
      <>
        <PageHeader title="Relatórios" />
        <Alert kind="info">Não pertence a nenhuma equipa activa. Peça ao Gestor para o associar a uma equipa.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Escolha o tipo, o modelo e os filtros. A exportação é feita no browser." />

      {tipos.length > 1 && (
        <Tabs<ReportTipo>
          value={tipo}
          onChange={(v) => { setTipo(v); setModelo(""); setProviderId(""); setTeamId(""); setProvincia(""); reset(); }}
          items={tipos.map((t) => ({ value: t, label: t === "GERADORES" ? "Controlo de Geradores" : BILLING_TYPE_LABELS[t] }))}
        />
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {models.map((m) => (
          <button
            key={m.modelo}
            type="button"
            onClick={() => { setModelo(m.modelo); reset(); }}
            aria-pressed={modelo === m.modelo}
            className={`rounded-2xl p-4 text-left ring-1 transition ${
              modelo === m.modelo ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-ink-100 hover:ring-ink-300"
            }`}
          >
            <div className="font-semibold text-navy-950">{m.nome}</div>
            <div className="mt-1 text-xs text-ink-500">{m.descricao}</div>
          </button>
        ))}
      </div>

      {def && (
        <div className="mb-5 flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-ink-100">
          <Select value={ano} onChange={(e) => { setAno(Number(e.target.value)); reset(); }} className="w-24" aria-label="Ano">
            {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          {has("mes") && (
            <Select value={mes} onChange={(e) => { setMes(e.target.value); reset(); }} className="w-40" aria-label="Mês">
              <option value="">{required("mes") ? "Mês…" : "Todos os meses"}</option>
              {MONTHS_FULL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          )}
          {has("equipa") && (options.data?.teams.length ?? 0) > 1 && (
            <Select value={teamId} onChange={(e) => { setTeamId(e.target.value); reset(); }} className="w-48" aria-label="Equipa">
              <option value="">Todas as equipas</option>
              {options.data!.teams.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </Select>
          )}
          {has("provider") && (
            <Select value={providerId} onChange={(e) => { setProviderId(e.target.value); reset(); }} className="w-44" aria-label="Provider">
              <option value="">{required("provider") ? "Provider…" : "Todos os providers"}</option>
              {options.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
          )}
          {has("regiao") && (
            <Select value={regiao} onChange={(e) => { setRegiao(e.target.value); reset(); }} className="w-36" aria-label="Região">
              <option value="">Todas as regiões</option>
              {REGIOES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          )}
          {has("provincia") && (
            <Select value={provincia} onChange={(e) => { setProvincia(e.target.value); reset(); }} className="w-44" aria-label="Província">
              <option value="">Todas as províncias</option>
              {provincias.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          )}
          <Button onClick={preview} disabled={loading || missing.length > 0} title={missing.length ? `Preencha: ${missing.map((f) => FILTER_LABELS[f]).join(", ")}` : undefined}>
            {loading ? "A carregar…" : "Pré-visualizar"}
          </Button>
          {report && canExport && (
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => exportAs("pdf")} disabled={!!exporting}>{exporting === "pdf" ? "A gerar…" : "Exportar PDF"}</Button>
              <Button variant="secondary" onClick={() => exportAs("xlsx")} disabled={!!exporting}>{exporting === "xlsx" ? "A gerar…" : "Exportar Excel"}</Button>
            </div>
          )}
        </div>
      )}

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {!def && <Alert kind="info">Escolha um modelo de relatório.</Alert>}
      {loading && !report && <Spinner />}
      {report && <div ref={viewRef}><ReportView report={report} /></div>}
    </>
  );
}

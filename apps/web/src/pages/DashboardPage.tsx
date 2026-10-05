import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BILLING_TYPE_LABELS, MONTHS_FULL } from "@cf/shared";
import { Alert, PageHeader, Select, Spinner, errorMessage } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { usePermission } from "../hooks/usePermission";
import { api } from "../lib/api";
import type { BillingOptions, DashboardResponse, GeneratorOptions, TeamRow } from "../lib/types";
import { yearOptions } from "../lib/years";
import GeneratorsDashboard from "./dashboard/GeneratorsDashboard";
import ProvidersDashboard from "./dashboard/ProvidersDashboard";

type Tipo = "PROVIDERS" | "GERADORES";

/** Dashboard de um módulo (Rede Residencial ou Combustível e Geradores). */
export default function DashboardPage({ tipo }: { tipo: Tipo }) {
  const { user } = useAuth();
  const isGestor = user?.role === "GESTOR";
  const canTeams = usePermission("teams", "view");
  const [ano, setAno] = useState(new Date().getFullYear());
  const [mes, setMes] = useState("");
  const [teamId, setTeamId] = useState("");
  const [providerId, setProviderId] = useState("");

  const qs = new URLSearchParams({ ano: String(ano), tipo });
  if (mes && tipo === "GERADORES") qs.set("mes", mes);
  if (teamId) qs.set("teamId", teamId);
  if (providerId) qs.set("providerId", providerId);
  const data = useQuery({ queryKey: ["dashboard", tipo, ano, mes, teamId, providerId], queryFn: () => api<DashboardResponse>(`/dashboard?${qs}`), keepPreviousData: true });

  const teams = useQuery({ queryKey: ["teams", "true"], queryFn: () => api<TeamRow[]>("/teams?ativo=true"), enabled: isGestor && canTeams });
  const provOpts = useQuery({
    queryKey: ["dash-providers", tipo],
    queryFn: async () =>
      tipo === "PROVIDERS" ? (await api<BillingOptions>("/billing/providers/options")).providers : (await api<GeneratorOptions>("/generators/options")).providers,
  });

  const d = data.data;
  const avisos = (tipo === "PROVIDERS" ? d?.providers?.avisos : d?.geradores?.avisos) ?? [];

  return (
    <>
      <PageHeader
        title={`Dashboard · ${BILLING_TYPE_LABELS[tipo]}`}
        subtitle={isGestor ? "Visão global" : user?.role === "TECNICO" ? "Resumo das suas equipas" : "Visão das suas equipas"}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="w-24" aria-label="Ano">
          {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        {tipo === "GERADORES" && (
          <Select value={mes} onChange={(e) => setMes(e.target.value)} className="w-44" aria-label="Mês">
            <option value="">Último mês com dados</option>
            {MONTHS_FULL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        )}
        {isGestor && (teams.data?.length ?? 0) > 0 && (
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-48" aria-label="Equipa">
            <option value="">Todas as equipas</option>
            {teams.data!.filter((t) => t.tipo === tipo).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </Select>
        )}
        <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="w-44" aria-label="Parceiro">
          <option value="">Todos os parceiros</option>
          {provOpts.data?.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </Select>
      </div>
      {avisos.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          <div className="font-semibold">⚠ Dados de configuração em falta</div>
          <ul className="mt-1 list-disc pl-5">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {data.isLoading ? (
        <Spinner />
      ) : data.error ? (
        <Alert>{errorMessage(data.error)}</Alert>
      ) : !d ? (
        <Spinner />
      ) : tipo === "PROVIDERS" && d.providers ? (
        <ProvidersDashboard data={d.providers} simplified={d.simplificado} />
      ) : tipo === "GERADORES" && d.geradores ? (
        d.geradores.kpis.mapas === 0 && d.geradores.mesesComDados.length === 0 ? (
          <Alert kind="info">Sem mapas de geradores em {ano}.</Alert>
        ) : (
          <GeneratorsDashboard data={d.geradores} simplified={d.simplificado} />
        )
      ) : (
        <Spinner />
      )}
    </>
  );
}

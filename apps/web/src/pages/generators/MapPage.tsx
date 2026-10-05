import { useParams, useSearchParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can, formatDate, formatDecimal, formatKz, GENERATOR_FLAG_LABELS, GeneratorFlag, MONTHS_FULL, RECORD_STATE_LABELS } from "@cf/shared";
import { Tabs } from "../../components/Tabs";
import { Alert, Badge, Button, Card, Spinner, errorMessage } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { api, apiPost } from "../../lib/api";
import type { GeneratorMapDetail } from "../../lib/types";
import { stateTone } from "../billing-providers/invoiceRules";
import FormTab from "./FormTab";
import ImportTab from "./ImportTab";
import MeasurementsTab from "./MeasurementsTab";

type Tab = "medicoes" | "formulario" | "importar";

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === "warn" ? "text-amber-700" : "text-navy-950"}`}>{value}</div>
    </div>
  );
}

export default function MapPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const map = useQuery({ queryKey: ["generator-map", id], queryFn: () => api<GeneratorMapDetail>(`/generators/maps/${id}`) });

  const action = useMutation({
    mutationFn: (op: string) => apiPost(`/generators/maps/${id}/${op}`),
    onSuccess: () => {
      qc.invalidateQueries(["generator-map", id]);
      qc.invalidateQueries(["measurements", id]);
      qc.invalidateQueries(["map-generators", id]);
      qc.invalidateQueries(["generator-maps"]);
    },
  });

  if (map.isLoading) return <Spinner />;
  if (map.error) return <Alert>{errorMessage(map.error)}</Alert>;
  if (!user) return null;
  const m = map.data!;
  const p = user.permissions;
  const closed = m.state === "FECHADO";
  const validator = can(p, "billing_generators", "validate");
  const st = m.stats.porEstado;
  const canImport = can(p, "billing_generators", "import") && !closed;
  const canForm = can(p, "billing_generators", "create") && !closed;

  const tabs: { value: Tab; label: string }[] = [{ value: "medicoes", label: `Medições (${m.stats.medicoes.toLocaleString("pt-PT")})` }];
  if (canForm) tabs.push({ value: "formulario", label: "Formulário por site" });
  if (canImport) tabs.push({ value: "importar", label: "Importar Excel" });
  const tab = (tabs.find((t) => t.value === params.get("tab"))?.value ?? "medicoes") as Tab;

  const run = (op: string, confirm?: string) => (!confirm || window.confirm(confirm)) && action.mutate(op);
  const flagsTotal = Object.entries(m.stats.flags);
  const missingPrices = !m.priceTable;

  return (
    <>
      <div className="mb-2 text-sm"><Link to="/geradores/mapas" className="text-ink-500 hover:text-navy-950">← Mapas de geradores</Link></div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-navy-950">{m.provider.nome} · {MONTHS_FULL[m.mes - 1]} {m.ano}</h1>
            <Badge tone={stateTone[m.state]}>{RECORD_STATE_LABELS[m.state]}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {m.team.nome}
            {m.closedBy && ` · fechado por ${m.closedBy.nome} em ${formatDate(m.closedAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!closed && can(p, "billing_generators", "edit") && (st.RASCUNHO ?? 0) > 0 && (
            <Button variant="secondary" disabled={action.isLoading} onClick={() => run("submit", validator ? `Submeter as ${st.RASCUNHO} medições em rascunho?` : "Submeter as suas medições em rascunho?")}>Submeter</Button>
          )}
          {!closed && validator && (st.SUBMETIDO ?? 0) > 0 && (
            <Button disabled={action.isLoading} onClick={() => run("validate", `Validar ${st.SUBMETIDO} medições submetidas?`)}>Validar</Button>
          )}
          {!closed && validator && ((st.SUBMETIDO ?? 0) + (st.VALIDADO ?? 0)) > 0 && (
            <Button variant="ghost" disabled={action.isLoading} onClick={() => run("return", "Devolver as medições submetidas e validadas para rascunho?")}>Devolver</Button>
          )}
          {!closed && validator && (
            <Button variant="secondary" disabled={action.isLoading} onClick={() => run("recalculate", "Aplicar os preços e faixas actuais a todas as medições não fechadas?")}>Recalcular mapa</Button>
          )}
          {!closed && can(p, "billing_generators", "close") && m.stats.medicoes > 0 && (st.VALIDADO ?? 0) === m.stats.medicoes && (
            <Button variant="dark" disabled={action.isLoading} onClick={() => run("close", "Fechar o mapa? Depois só o Gestor pode reabrir.")}>Fechar mês</Button>
          )}
          {closed && user.role === "GESTOR" && can(p, "billing_generators", "close") && (
            <Button variant="secondary" disabled={action.isLoading} onClick={() => run("reopen", "Reabrir o mapa fechado?")}>Reabrir</Button>
          )}
        </div>
      </div>

      {action.error ? <div className="mb-4"><Alert>{errorMessage(action.error)}</Alert></div> : null}
      {missingPrices && <div className="mb-4"><Alert>Sem tabela de preços em vigor para {m.provider.nome} neste mês: combustível, serviço e aluguer contam como 0.</Alert></div>}

      <Card className="mb-6 grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Litros" value={formatDecimal(m.stats.litros)} />
        <Kpi label="Combustível" value={formatKz(m.stats.combustivelCent)} />
        <Kpi label="Serv. abastecimento" value={formatKz(m.stats.servAbastCent)} />
        <Kpi label="Aluguer" value={formatKz(m.stats.aluguerCent)} />
        <Kpi label="Desconto de rede" value={formatKz(m.stats.descontoRedeCent)} />
        <Kpi label="Total" value={formatKz(m.stats.totalCent)} />
        {flagsTotal.length > 0 && (
          <div className="col-span-full flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-100 pt-3 text-xs text-ink-500">
            <span className="font-semibold text-amber-700">Avisos:</span>
            {flagsTotal.map(([f, n]) => <span key={f}>{GENERATOR_FLAG_LABELS[f as GeneratorFlag] || f} <b className="text-ink-800">{n.toLocaleString("pt-PT")}</b></span>)}
          </div>
        )}
      </Card>

      <Tabs<Tab> value={tab} onChange={(v) => setParams(v === "medicoes" ? {} : { tab: v })} items={tabs} />
      {tab === "medicoes" && <MeasurementsTab map={m} />}
      {tab === "formulario" && <FormTab map={m} />}
      {tab === "importar" && <ImportTab map={m} onDone={() => setParams({})} />}
    </>
  );
}

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BILLING_TYPE_LABELS, BillingType, can, formatKz, MODULE_BASE, MONTHS, MONTHS_FULL, RECORD_STATE_LABELS } from "@cf/shared";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import type { GeneratorMapRow, InvoiceList } from "../lib/types";
import { Alert, Badge, Button, Card, PageHeader, Spinner, errorMessage } from "../components/ui";
import { stateTone } from "./billing-providers/invoiceRules";

/** Página inicial do Técnico em cada módulo: os seus rascunhos e o que está por validar. */
export default function MyWorkPage({ tipo }: { tipo: BillingType }) {
  const { user } = useAuth();
  if (!user) return null;
  const teams = user.teams.filter((t) => t.tipo === tipo);

  return (
    <>
      <PageHeader title="O meu trabalho" subtitle={`Olá, ${user.nome}. Rascunhos e pendentes de ${BILLING_TYPE_LABELS[tipo]}.`} />
      {teams.length === 0 ? (
        <Alert kind="info">Não pertence a nenhuma equipa deste módulo. Peça ao Gestor para o associar.</Alert>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {teams.map((t) => <Badge key={t.id} tone="brand">{t.nome}</Badge>)}
          </div>
          {tipo === "PROVIDERS" ? <InvoicesCard /> : <MapsCard />}
        </div>
      )}
    </>
  );
}

function InvoicesCard() {
  const { user } = useAuth();
  const allowed = !!user && can(user.permissions, "billing_providers", "view");
  const drafts = useQuery({
    queryKey: ["invoices", "mine"],
    queryFn: () => api<InvoiceList>("/billing/providers/invoices?mine=true&state=RASCUNHO,SUBMETIDO"),
    enabled: allowed,
  });
  if (!allowed) return null;
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <h3 className="font-semibold text-navy-950">As minhas facturas</h3>
        <Link to={`${MODULE_BASE.PROVIDERS}/facturas`}><Button size="sm" variant="secondary">Abrir facturas</Button></Link>
      </div>
      {drafts.isLoading ? (
        <Spinner />
      ) : drafts.error ? (
        <div className="p-4"><Alert>{errorMessage(drafts.error)}</Alert></div>
      ) : drafts.data!.items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">Sem rascunhos nem facturas por validar.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {drafts.data!.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-navy-950">{i.provider.nome} · {MONTHS[i.mes - 1]}/{i.ano}</div>
                <div className="truncate text-xs text-ink-500">{i.numeroFactura || "Sem nº de factura"} · {formatKz(i.valorFTCent)}</div>
              </div>
              <Badge tone={stateTone[i.state]}>{RECORD_STATE_LABELS[i.state]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Mapas do ano ainda em rascunho ou submetidos (as medições inserem-se no mapa). */
function MapsCard() {
  const { user } = useAuth();
  const allowed = !!user && can(user.permissions, "billing_generators", "view");
  const ano = new Date().getFullYear();
  const maps = useQuery({
    queryKey: ["generator-maps", "my-work", ano],
    queryFn: () => api<GeneratorMapRow[]>(`/generators/maps?ano=${ano}`),
    enabled: allowed,
  });
  if (!allowed) return null;
  const open = (maps.data ?? []).filter((m) => m.state === "RASCUNHO" || m.state === "SUBMETIDO");
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <h3 className="font-semibold text-navy-950">Mapas em curso ({ano})</h3>
        <Link to={`${MODULE_BASE.GERADORES}/mapas`}><Button size="sm" variant="secondary">Abrir mapas</Button></Link>
      </div>
      {maps.isLoading ? (
        <Spinner />
      ) : maps.error ? (
        <div className="p-4"><Alert>{errorMessage(maps.error)}</Alert></div>
      ) : open.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">Sem mapas em rascunho nem por validar.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {open.map((m) => (
            <li key={m.id}>
              <Link to={`${MODULE_BASE.GERADORES}/mapas/${m.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-ink-50">
                <div className="min-w-0">
                  <div className="truncate font-medium text-navy-950">{m.provider.nome} · {MONTHS_FULL[m.mes - 1]} {m.ano}</div>
                  <div className="truncate text-xs text-ink-500">{m.team.nome}</div>
                </div>
                <Badge tone={stateTone[m.state]}>{RECORD_STATE_LABELS[m.state]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

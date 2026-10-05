import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BILLING_TYPE_LABELS, can, formatKz, MONTHS, RECORD_STATE_LABELS } from "@cf/shared";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import type { InvoiceList } from "../lib/types";
import { Alert, Badge, Button, Card, PageHeader, Spinner, errorMessage } from "../components/ui";
import { stateTone } from "./billing-providers/invoiceRules";

/** Página inicial do Técnico: os seus rascunhos e o que está submetido. */
export default function MyWorkPage() {
  const { user } = useAuth();
  const providers = !!user && user.billingTypes.includes("PROVIDERS") && can(user.permissions, "billing_providers", "view");
  const drafts = useQuery({
    queryKey: ["invoices", "mine"],
    queryFn: () => api<InvoiceList>("/billing/providers/invoices?mine=true&state=RASCUNHO,SUBMETIDO"),
    enabled: providers,
  });
  if (!user) return null;

  return (
    <>
      <PageHeader title="O meu trabalho" subtitle={`Olá, ${user.nome}. Aqui ficam os seus rascunhos e pendentes.`} />
      {user.teams.length === 0 ? (
        <Alert kind="info">Ainda não pertence a nenhuma equipa. Peça ao Gestor para o associar.</Alert>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {user.teams.map((t) => <Badge key={t.id} tone="brand">{t.nome} · {BILLING_TYPE_LABELS[t.tipo]}</Badge>)}
          </div>
          {providers && (
            <Card>
              <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
                <h3 className="font-semibold text-navy-950">Facturas de Providers</h3>
                <Link to="/facturacao/providers"><Button size="sm" variant="secondary">Abrir facturação</Button></Link>
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
          )}
        </div>
      )}
    </>
  );
}

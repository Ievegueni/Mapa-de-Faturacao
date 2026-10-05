import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, formatKz, INVOICE_STATUS_LABELS, INVOICE_STATUSES, MONTHS, MONTHS_FULL, RECORD_STATE_LABELS, RECORD_STATES } from "@cf/shared";
import { Tabs } from "../../components/Tabs";
import { Alert, Badge, Button, Card, EmptyRow, PageHeader, Select, Spinner, errorMessage, td, th } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { Can, usePermission } from "../../hooks/usePermission";
import { api, apiDelete, apiPost } from "../../lib/api";
import type { BillingOptions, InvoiceList, InvoiceRow } from "../../lib/types";
import { yearOptions } from "../../lib/years";
import InvoiceForm from "./InvoiceForm";
import { invoiceActions, stateTone } from "./invoiceRules";
import SummaryTab from "./SummaryTab";

type Tab = "facturas" | "resumo";

export default function BillingProvidersPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "resumo" ? "resumo" : "facturas";
  const options = useQuery({ queryKey: ["billing-options"], queryFn: () => api<BillingOptions>("/billing/providers/options") });

  return (
    <>
      <PageHeader title="Facturas · Rede Residencial" subtitle="Facturas mensais por parceiro, pagamentos, dívida e orçamento." />
      <Tabs<Tab>
        value={tab}
        onChange={(v) => setParams(v === "resumo" ? { tab: "resumo" } : {})}
        items={[
          { value: "facturas", label: "Facturas" },
          { value: "resumo", label: "Resumo" },
        ]}
      />
      {options.isLoading ? (
        <Spinner />
      ) : options.error ? (
        <Alert>{errorMessage(options.error)}</Alert>
      ) : tab === "facturas" ? (
        <InvoicesTab options={options.data!} />
      ) : (
        <SummaryTab options={options.data!} />
      )}
    </>
  );
}

function InvoicesTab({ options }: { options: BillingOptions }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const validator = usePermission("billing_providers", "validate");
  const [filters, setFilters] = useState({ ano: String(new Date().getFullYear()), mes: "", teamId: "", providerId: "", status: "", state: "" });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ invoice: InvoiceRow | null; paymentsOnly: boolean } | null>(null);
  const setFilter = (patch: Partial<typeof filters>) => {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
  };

  const qs = new URLSearchParams({ page: String(page) });
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const list = useQuery({
    queryKey: ["invoices", filters, page],
    queryFn: () => api<InvoiceList>(`/billing/providers/invoices?${qs}`),
    keepPreviousData: true,
  });

  const action = useMutation({
    mutationFn: ({ inv, op }: { inv: InvoiceRow; op: "submit" | "validate" | "return" | "reopen" | "delete" }) =>
      op === "delete" ? apiDelete(`/billing/providers/invoices/${inv.id}`) : apiPost(`/billing/providers/invoices/${inv.id}/${op}`),
    onSuccess: () => {
      qc.invalidateQueries(["invoices"]);
      qc.invalidateQueries(["providers-summary"]);
    },
  });

  if (!user) return null;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  if (options.teams.length === 0) {
    return <Alert kind="info">Não pertence a nenhuma equipa de Providers. Peça ao Gestor para o associar.</Alert>;
  }

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={filters.ano} onChange={(e) => setFilter({ ano: e.target.value })} className="sm:w-24" aria-label="Ano">
              {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Select value={filters.mes} onChange={(e) => setFilter({ mes: e.target.value })} className="sm:w-36" aria-label="Mês">
              <option value="">Todos os meses</option>
              {MONTHS_FULL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
            {options.teams.length > 1 && (
              <Select value={filters.teamId} onChange={(e) => setFilter({ teamId: e.target.value })} className="sm:w-44" aria-label="Equipa">
                <option value="">Todas as equipas</option>
                {options.teams.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </Select>
            )}
            <Select value={filters.providerId} onChange={(e) => setFilter({ providerId: e.target.value })} className="sm:w-40" aria-label="Parceiro">
              <option value="">Todos os parceiros</option>
              {options.providers.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
            <Select value={filters.status} onChange={(e) => setFilter({ status: e.target.value })} className="sm:w-40" aria-label="Status">
              <option value="">Todos os status</option>
              {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</option>)}
            </Select>
            <Select value={filters.state} onChange={(e) => setFilter({ state: e.target.value })} className="sm:w-36" aria-label="Estado">
              <option value="">Todos os estados</option>
              {RECORD_STATES.filter((s) => s !== "FECHADO").map((s) => <option key={s} value={s}>{RECORD_STATE_LABELS[s]}</option>)}
            </Select>
          </div>
          <div className="flex gap-2">
            {validator && (
              <Button variant={filters.state === "SUBMETIDO" ? "dark" : "secondary"} onClick={() => setFilter({ state: filters.state === "SUBMETIDO" ? "" : "SUBMETIDO" })}>
                Por validar
              </Button>
            )}
            <Can module="billing_providers" action="create">
              <Button onClick={() => setEditing({ invoice: null, paymentsOnly: false })}>Nova factura</Button>
            </Can>
          </div>
        </div>
        {action.error ? <div className="p-4"><Alert>{errorMessage(action.error)}</Alert></div> : null}
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4"><Alert>{errorMessage(list.error)}</Alert></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Parceiro</th>
                  <th className={th}>Período</th>
                  <th className={th}>Factura</th>
                  <th className={`${th} text-right`}>Valor FT</th>
                  <th className={`${th} text-right`}>Pago</th>
                  <th className={`${th} text-right`}>Dívida</th>
                  <th className={th}>Estado</th>
                  <th className={`${th} text-right`}>Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {list.data!.items.length === 0 && <EmptyRow colSpan={8}>Nenhuma factura com estes filtros.</EmptyRow>}
                {list.data!.items.map((inv) => {
                  const a = invoiceActions(user, inv);
                  const busy = action.isLoading && action.variables?.inv.id === inv.id;
                  return (
                    <tr key={inv.id} className="hover:bg-ink-50/50">
                      <td className={`${td} whitespace-nowrap`}>
                        <div className="font-medium text-navy-950">{inv.provider.nome}</div>
                        <div className="text-xs text-ink-500">PO {inv.po || "—"}{options.teams.length > 1 ? ` · ${inv.team.nome}` : ""}</div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        {MONTHS[inv.mes - 1]}/{inv.ano}
                        <div className="text-xs text-ink-500">{inv.tipo}</div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <div>{inv.numeroFactura || "—"}</div>
                        <div className="text-xs text-ink-500">{formatDate(inv.dataFacturacao)}</div>
                      </td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(inv.valorFTCent)}</td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(inv.valorPagoCent)}</td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums ${BigInt(inv.dividaCent) > BigInt(0) ? "font-medium text-navy-950" : "text-ink-400"}`}>
                        {formatKz(inv.dividaCent)}
                      </td>
                      <td className={td}>
                        <Badge tone={stateTone[inv.state]}>{RECORD_STATE_LABELS[inv.state]}</Badge>
                        <div className="mt-1 whitespace-nowrap text-xs text-ink-500">{INVOICE_STATUS_LABELS[inv.status]}</div>
                      </td>
                      <td className={`${td} text-right`}>
                        <div className="ml-auto flex max-w-[11rem] flex-wrap justify-end gap-1">
                          {a.edit && <Button size="sm" variant="secondary" onClick={() => setEditing({ invoice: inv, paymentsOnly: a.paymentsOnly })}>{a.paymentsOnly ? "Pagamento" : "Editar"}</Button>}
                          {a.submit && <Button size="sm" variant="secondary" disabled={busy} onClick={() => action.mutate({ inv, op: "submit" })}>Submeter</Button>}
                          {a.validate && <Button size="sm" disabled={busy} onClick={() => action.mutate({ inv, op: "validate" })}>Validar</Button>}
                          {a.giveBack && <Button size="sm" variant="ghost" disabled={busy} onClick={() => action.mutate({ inv, op: "return" })}>Devolver</Button>}
                          {a.reopen && <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm("Reabrir esta factura validada?") && action.mutate({ inv, op: "reopen" })}>Reabrir</Button>}
                          {a.remove && (
                            <Button size="sm" variant="ghost" disabled={busy} aria-label="Eliminar" onClick={() => window.confirm("Eliminar esta factura?") && action.mutate({ inv, op: "delete" })}>
                              ✕
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {list.data!.items.length > 0 && (
                <tfoot className="border-t-2 border-ink-200 bg-ink-50/60">
                  <tr>
                    <td className={`${td} font-semibold text-navy-950`} colSpan={3}>Total ({list.data!.total} facturas)</td>
                    <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums text-navy-950`}>{formatKz(list.data!.totals.valorFTCent)}</td>
                    <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums text-navy-950`}>{formatKz(list.data!.totals.valorPagoCent)}</td>
                    <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums text-navy-950`}>{formatKz(list.data!.totals.dividaCent)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-sm text-ink-500">
            <span>Página {page} de {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Seguinte</Button>
            </div>
          </div>
        )}
      </Card>
      {editing && <InvoiceForm invoice={editing.invoice} paymentsOnly={editing.paymentsOnly} options={options} onClose={() => setEditing(null)} />}
    </>
  );
}

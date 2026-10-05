import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BILLING_TYPE_LABELS, BILLING_TYPES, BillingType, formatKz, providerCreateSchema } from "@cf/shared";
import { MoneyInput } from "../components/inputs";
import { Tabs } from "../components/Tabs";
import { Alert, Badge, Button, Card, EmptyRow, Field, Input, Modal, PageHeader, Select, Spinner, errorMessage, td, th } from "../components/ui";
import { usePermission } from "../hooks/usePermission";
import { api, apiDelete, apiPatch, apiPost, apiPut } from "../lib/api";
import type { ProviderRow, TeamRow } from "../lib/types";
import { validate } from "../lib/validate";
import { yearOptions } from "../lib/years";
import PricesTab from "./PricesTab";

type Tab = "providers" | "precos";

export default function ProvidersPage() {
  const [params, setParams] = useSearchParams();
  const canPrices = usePermission("prices_targets", "view");
  const tab: Tab = params.get("tab") === "precos" && canPrices ? "precos" : "providers";

  return (
    <>
      <PageHeader title="Providers" subtitle="Parceiros, tipos de facturação, PO, orçamentos e preços." />
      {canPrices && (
        <Tabs<Tab>
          value={tab}
          onChange={(v) => setParams(v === "precos" ? { tab: "precos" } : {})}
          items={[
            { value: "providers", label: "Providers" },
            { value: "precos", label: "Preços" },
          ]}
        />
      )}
      {tab === "providers" ? <ProvidersTab /> : <PricesTab />}
    </>
  );
}

function ProvidersTab() {
  const qc = useQueryClient();
  const [estado, setEstado] = useState("true");
  const [editing, setEditing] = useState<ProviderRow | "new" | null>(null);
  const [budgetsOf, setBudgetsOf] = useState<string | null>(null);
  const canCreate = usePermission("providers", "create");
  const canEdit = usePermission("providers", "edit");
  const canDelete = usePermission("providers", "delete");
  const ano = new Date().getFullYear();

  const providers = useQuery({
    queryKey: ["providers", estado],
    queryFn: () => api<ProviderRow[]>(`/providers${estado ? `?ativo=${estado}` : ""}`),
    keepPreviousData: true,
  });

  const toggle = useMutation({
    mutationFn: (p: ProviderRow) => (p.ativo ? apiDelete(`/providers/${p.id}`) : apiPatch(`/providers/${p.id}`, { ativo: true })),
    onSuccess: () => qc.invalidateQueries(["providers"]),
  });

  const budgetsProvider = providers.data?.find((p) => p.id === budgetsOf) || null;

  return (
    <>
      <Card>
        <div className="flex flex-col gap-2 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <Select value={estado} onChange={(e) => setEstado(e.target.value)} className="sm:w-40">
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
            <option value="">Todos</option>
          </Select>
          {canCreate && <Button onClick={() => setEditing("new")}>Novo provider</Button>}
        </div>
        {toggle.error ? <div className="p-4"><Alert>{errorMessage(toggle.error)}</Alert></div> : null}
        {providers.isLoading ? (
          <Spinner />
        ) : providers.error ? (
          <div className="p-4"><Alert>{errorMessage(providers.error)}</Alert></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Provider</th>
                  <th className={th}>Tipos</th>
                  <th className={th}>PO {ano}</th>
                  <th className={`${th} text-right`}>Orçamento mensal {ano}</th>
                  <th className={th}>Estado</th>
                  <th className={`${th} text-right`}>Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {providers.data!.length === 0 && <EmptyRow colSpan={6}>Nenhum provider.</EmptyRow>}
                {providers.data!.map((p) => {
                  const def = p.budgets.find((b) => b.ano === ano && b.teamId === null);
                  const perTeam = p.budgets.filter((b) => b.ano === ano && b.teamId !== null).length;
                  return (
                    <tr key={p.id} className="hover:bg-ink-50/50">
                      <td className={td}>
                        <div className="font-medium text-navy-950">{p.nome}</div>
                        <div className="text-xs text-ink-500">{[p.nif && `NIF ${p.nif}`, p.contacto, p.email].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          {p.tipos.map((t) => <Badge key={t} tone={t === "PROVIDERS" ? "navy" : "brand"}>{BILLING_TYPE_LABELS[t]}</Badge>)}
                        </div>
                      </td>
                      <td className={`${td} tabular-nums`}>{def?.po || "—"}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {formatKz(def?.orcamentoMensalCent)}
                        {perTeam > 0 && <div className="text-xs text-ink-400">+ {perTeam} por equipa</div>}
                      </td>
                      <td className={td}>{p.ativo ? <Badge tone="green">Activo</Badge> : <Badge tone="red">Inactivo</Badge>}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => setBudgetsOf(p.id)}>PO e orçamento</Button>
                          {canEdit && <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Editar</Button>}
                          {canDelete && (
                            <Button size="sm" variant={p.ativo ? "danger" : "secondary"} disabled={toggle.isLoading} onClick={() => toggle.mutate(p)}>
                              {p.ativo ? "Desactivar" : "Reactivar"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <ProviderForm provider={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {budgetsProvider && <BudgetsModal provider={budgetsProvider} canEdit={canEdit} onClose={() => setBudgetsOf(null)} />}
    </>
  );
}

function ProviderForm({ provider, onClose }: { provider: ProviderRow | null; onClose(): void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nome: provider?.nome || "",
    nif: provider?.nif || "",
    contacto: provider?.contacto || "",
    email: provider?.email || "",
    tipos: provider?.tipos || (["PROVIDERS"] as BillingType[]),
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const data = validate(providerCreateSchema, form);
      return provider ? apiPatch(`/providers/${provider.id}`, data) : apiPost("/providers", data);
    },
    onSuccess: () => {
      qc.invalidateQueries(["providers"]);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const toggleTipo = (t: BillingType) =>
    setForm((f) => ({ ...f, tipos: f.tipos.includes(t) ? f.tipos.filter((x) => x !== t) : [...f.tipos, t] }));

  return (
    <Modal
      title={provider ? "Editar provider" : "Novo provider"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="provider-form" disabled={save.isLoading}>{save.isLoading ? "A guardar…" : "Guardar"}</Button>
        </>
      }
    >
      <form id="provider-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Nome">
          <Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="NIF">
            <Input value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} />
          </Field>
          <Field label="Contacto">
            <Input value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Tipos de facturação servidos" group>
          <div className="flex gap-4">
            {BILLING_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-brand-500" checked={form.tipos.includes(t)} onChange={() => toggleTipo(t)} />
                {BILLING_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </Field>
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}

interface BudgetDraft {
  teamId: string | null;
  label: string;
  id?: string;
  po: string;
  orcamentoMensalCent: string | null;
}

/** PO e orçamento mensal por equipa/ano. A primeira linha (todas as equipas) é o valor por omissão. */
function BudgetsModal({ provider, canEdit, onClose }: { provider: ProviderRow; canEdit: boolean; onClose(): void }) {
  const qc = useQueryClient();
  const [ano, setAno] = useState(new Date().getFullYear());
  const canTeams = usePermission("teams", "view");
  const teams = useQuery({ queryKey: ["teams", "true"], queryFn: () => api<TeamRow[]>("/teams?ativo=true"), enabled: canTeams });

  const initial = useMemo<BudgetDraft[]>(() => {
    const yearRows = provider.budgets.filter((b) => b.ano === ano);
    const rows: BudgetDraft[] = [{ teamId: null, label: "Todas as equipas (por omissão)", po: "", orcamentoMensalCent: null }];
    const teamList = new Map<string, string>();
    for (const t of teams.data || []) teamList.set(t.id, t.nome);
    for (const b of yearRows) if (b.team) teamList.set(b.team.id, b.team.nome);
    for (const [id, nome] of teamList) rows.push({ teamId: id, label: nome, po: "", orcamentoMensalCent: null });
    for (const r of rows) {
      const b = yearRows.find((x) => x.teamId === r.teamId);
      if (b) Object.assign(r, { id: b.id, po: b.po || "", orcamentoMensalCent: b.orcamentoMensalCent });
    }
    return rows;
  }, [provider, ano, teams.data]);

  const [drafts, setDrafts] = useState<Record<string, BudgetDraft>>({});
  const rows = initial.map((r) => drafts[`${ano}:${r.teamId}`] || r);
  const dirty = rows.filter((r, i) => r !== initial[i]);

  const save = useMutation({
    mutationFn: async () => {
      for (const r of dirty) {
        const empty = !r.po.trim() && r.orcamentoMensalCent === null;
        if (empty && r.id) await apiDelete(`/providers/${provider.id}/budgets/${r.id}`);
        else if (!empty) {
          await apiPut(`/providers/${provider.id}/budgets`, { teamId: r.teamId, ano, po: r.po.trim() || null, orcamentoMensalCent: r.orcamentoMensalCent });
        }
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries(["providers"]);
      setDrafts({});
    },
  });

  const update = (r: BudgetDraft, patch: Partial<BudgetDraft>) => setDrafts((d) => ({ ...d, [`${ano}:${r.teamId}`]: { ...r, ...patch } }));

  return (
    <Modal
      title={`PO e orçamento · ${provider.nome}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          {canEdit && <Button disabled={!dirty.length || save.isLoading} onClick={() => save.mutate()}>{save.isLoading ? "A guardar…" : "Guardar"}</Button>}
        </>
      }
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-600">Ano</span>
        <Select value={ano} onChange={(e) => { setAno(Number(e.target.value)); setDrafts({}); }} className="w-28">
          {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>
      <p className="text-xs text-ink-500">Campos em branco ficam "—". O orçamento anual é o mensal × 12. Uma linha da equipa sobrepõe-se à linha por omissão.</p>
      <div className="overflow-x-auto rounded-lg border border-ink-100">
        <table className="min-w-full divide-y divide-ink-100 text-sm">
          <thead className="bg-ink-50/60">
            <tr>
              <th className={th}>Equipa</th>
              <th className={th}>PO</th>
              <th className={`${th} text-right`}>Orçamento mensal</th>
              <th className={`${th} text-right`}>Anual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={String(r.teamId)}>
                <td className="px-4 py-2 font-medium text-navy-950">{r.label}</td>
                <td className="px-2 py-2">
                  <Input value={r.po} placeholder="—" disabled={!canEdit} onChange={(e) => update(r, { po: e.target.value })} className="min-w-[8rem] px-2 py-1 text-xs" aria-label={`PO ${r.label}`} />
                </td>
                <td className="px-2 py-2">
                  <MoneyInput compact value={r.orcamentoMensalCent} disabled={!canEdit} onChange={(v) => update(r, { orcamentoMensalCent: v })} className="min-w-[9rem]" aria-label={`Orçamento ${r.label}`} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-600">
                  {r.orcamentoMensalCent === null ? "—" : formatKz(BigInt(r.orcamentoMensalCent) * BigInt(12))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canTeams && <p className="text-xs text-ink-400">Só aparecem as equipas que já têm orçamento.</p>}
      {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
    </Modal>
  );
}

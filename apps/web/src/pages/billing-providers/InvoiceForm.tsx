import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INVOICE_STATUS_LABELS, INVOICE_STATUSES, INVOICE_TYPES, invoiceCreateSchema, MONTHS_FULL, RECORD_STATE_LABELS } from "@cf/shared";
import { MoneyInput } from "../../components/inputs";
import { Alert, Badge, Button, Field, Input, Modal, Select, errorMessage } from "../../components/ui";
import { api, apiPatch, apiPost } from "../../lib/api";
import type { BillingOptions, InvoiceRow, InvoiceStatusT } from "../../lib/types";
import { validate } from "../../lib/validate";
import { yearOptions } from "../../lib/years";

interface FormState {
  teamId: string;
  providerId: string;
  ano: number;
  mes: number;
  tipo: string;
  numeroFactura: string;
  dataFacturacao: string;
  dataExecucao: string;
  qtdOTs: string;
  consumiveis: string;
  valorFTCent: string | null;
  valorPagoCent: string | null;
  status: InvoiceStatusT;
  observacao: string;
}

const fromInvoice = (i: InvoiceRow): FormState => ({
  teamId: i.teamId,
  providerId: i.providerId,
  ano: i.ano,
  mes: i.mes,
  tipo: i.tipo,
  numeroFactura: i.numeroFactura || "",
  dataFacturacao: i.dataFacturacao || "",
  dataExecucao: i.dataExecucao || "",
  qtdOTs: i.qtdOTs?.toString() ?? "",
  consumiveis: i.consumiveis?.toString() ?? "",
  valorFTCent: i.valorFTCent,
  valorPagoCent: i.valorPagoCent,
  status: i.status,
  observacao: i.observacao || "",
});

/** Painel de inserção — exactamente os campos do Excel actual (CLAUDE.md §8). */
export default function InvoiceForm({
  invoice,
  options,
  paymentsOnly,
  onClose,
}: {
  invoice: InvoiceRow | null;
  options: BillingOptions;
  paymentsOnly: boolean;
  onClose(): void;
}) {
  const qc = useQueryClient();
  const now = new Date();
  const [form, setForm] = useState<FormState>(
    invoice
      ? fromInvoice(invoice)
      : {
          teamId: options.teams.length === 1 ? options.teams[0].id : "",
          providerId: "",
          ano: now.getFullYear(),
          mes: now.getMonth() + 1,
          tipo: INVOICE_TYPES[0],
          numeroFactura: "",
          dataFacturacao: "",
          dataExecucao: "",
          qtdOTs: "",
          consumiveis: "",
          valorFTCent: null,
          valorPagoCent: null,
          status: "ABERTO",
          observacao: "",
        },
  );
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const po = useQuery({
    queryKey: ["po", form.providerId, form.teamId, form.ano],
    queryFn: () => api<{ po: string | null }>(`/billing/providers/po?providerId=${form.providerId}&teamId=${form.teamId}&ano=${form.ano}`),
    enabled: !!form.providerId && !!form.teamId,
  });

  useEffect(() => setError(null), [form]);

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      let saved: InvoiceRow;
      if (paymentsOnly && invoice) {
        saved = await apiPatch<InvoiceRow>(`/billing/providers/invoices/${invoice.id}`, {
          valorPagoCent: form.valorPagoCent,
          status: form.status,
          observacao: form.observacao,
        });
      } else {
        const payload = { ...form, valorPagoCent: form.valorPagoCent ?? "0" };
        validate(invoiceCreateSchema, payload);
        saved = invoice
          ? await apiPatch<InvoiceRow>(`/billing/providers/invoices/${invoice.id}`, payload)
          : await apiPost<InvoiceRow>("/billing/providers/invoices", payload);
      }
      if (submit) saved = await apiPost<InvoiceRow>(`/billing/providers/invoices/${saved.id}/submit`);
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries(["invoices"]);
      qc.invalidateQueries(["providers-summary"]);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(false);
  }

  const lock = paymentsOnly;
  const canSubmit = !invoice || invoice.state === "RASCUNHO";
  const poValue = po.data?.po ?? (invoice && form.providerId === invoice.providerId && form.teamId === invoice.teamId && form.ano === invoice.ano ? invoice.po : null);

  return (
    <Modal
      title={invoice ? "Editar factura" : "Nova factura"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="secondary" type="submit" form="invoice-form" disabled={save.isLoading}>
            {invoice && !canSubmit ? "Guardar" : "Guardar rascunho"}
          </Button>
          {canSubmit && !lock && (
            <Button disabled={save.isLoading} onClick={() => save.mutate(true)}>Guardar e submeter</Button>
          )}
        </>
      }
    >
      {invoice && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <Badge tone="navy">{RECORD_STATE_LABELS[invoice.state]}</Badge>
          <span>Criada por {invoice.createdBy.nome}</span>
          {invoice.validatedBy && <span>· validada por {invoice.validatedBy.nome}</span>}
        </div>
      )}
      {lock && <Alert kind="info">Factura validada: só pode actualizar o valor pago, o status e a observação.</Alert>}
      <form id="invoice-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        {options.teams.length > 1 || (invoice && !options.teams.some((t) => t.id === form.teamId)) ? (
          <Field label="Equipa">
            <Select required disabled={lock} value={form.teamId} onChange={(e) => set({ teamId: e.target.value })}>
              <option value="">Seleccionar…</option>
              {options.teams.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              {invoice && !options.teams.some((t) => t.id === form.teamId) && <option value={invoice.teamId}>{invoice.team.nome}</option>}
            </Select>
          </Field>
        ) : null}
        <Field label="Parceiro">
          <Select required disabled={lock} value={form.providerId} onChange={(e) => set({ providerId: e.target.value })}>
            <option value="">Seleccionar…</option>
            {options.providers.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            {invoice && !options.providers.some((p) => p.id === form.providerId) && <option value={invoice.providerId}>{invoice.provider.nome}</option>}
          </Select>
        </Field>
        <Field label="PO" hint="Preenchido automaticamente a partir do orçamento do parceiro.">
          <Input readOnly disabled value={form.providerId && form.teamId ? (po.isFetching ? "…" : poValue || "—") : "—"} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Ano">
            <Select disabled={lock} value={form.ano} onChange={(e) => set({ ano: Number(e.target.value) })}>
              {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </Field>
          <Field label="Mês">
            <Select disabled={lock} value={form.mes} onChange={(e) => set({ mes: Number(e.target.value) })}>
              {MONTHS_FULL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Tipo">
          <Select disabled={lock} value={form.tipo} onChange={(e) => set({ tipo: e.target.value })}>
            {INVOICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Nº factura">
          <Input disabled={lock} value={form.numeroFactura} onChange={(e) => set({ numeroFactura: e.target.value })} />
        </Field>
        <Field label="Data de facturação">
          <Input type="date" disabled={lock} value={form.dataFacturacao} onChange={(e) => set({ dataFacturacao: e.target.value })} />
        </Field>
        <Field label="Data de execução">
          <Input type="date" disabled={lock} value={form.dataExecucao} onChange={(e) => set({ dataExecucao: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="OTs">
            <Input inputMode="numeric" disabled={lock} placeholder="—" value={form.qtdOTs} onChange={(e) => set({ qtdOTs: e.target.value })} />
          </Field>
          <Field label="Consumíveis">
            <Input inputMode="numeric" disabled={lock} placeholder="—" value={form.consumiveis} onChange={(e) => set({ consumiveis: e.target.value })} />
          </Field>
        </div>
        <Field label="Valor FT">
          <MoneyInput disabled={lock} value={form.valorFTCent} onChange={(v) => set({ valorFTCent: v })} aria-label="Valor FT" />
        </Field>
        <Field label="Valor pago">
          <MoneyInput value={form.valorPagoCent} onChange={(v) => set({ valorPagoCent: v })} aria-label="Valor pago" />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set({ status: e.target.value as InvoiceStatusT })}>
            {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observação">
            <textarea
              rows={2}
              value={form.observacao}
              onChange={(e) => set({ observacao: e.target.value })}
              className="block w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </Field>
        </div>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
      </form>
    </Modal>
  );
}

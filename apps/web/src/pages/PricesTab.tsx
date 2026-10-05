import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@cf/shared";
import { MoneyInput, PercentInput } from "../components/inputs";
import { Alert, Button, Card, EmptyRow, Field, Input, Modal, Select, Spinner, errorMessage, th } from "../components/ui";
import { usePermission } from "../hooks/usePermission";
import { api, apiDelete, apiPatch, apiPost } from "../lib/api";
import type { PriceTableRow, ProviderRow, RentPriceRow } from "../lib/types";

const today = () => new Date().toISOString().slice(0, 10);

/** Separador Preços: tabelas com vigência por provider; todos os campos podem ficar vazios. */
export default function PricesTab() {
  const canEdit = usePermission("prices_targets", "edit");
  const providers = useQuery({ queryKey: ["providers", "true"], queryFn: () => api<ProviderRow[]>("/providers?ativo=true") });
  const [providerId, setProviderId] = useState<string>("");
  const [tableId, setTableId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!providerId && providers.data?.length) setProviderId(providers.data[0].id);
  }, [providers.data, providerId]);

  const tables = useQuery({
    queryKey: ["prices", providerId],
    queryFn: () => api<PriceTableRow[]>(`/prices?providerId=${providerId}`),
    enabled: !!providerId,
  });

  useEffect(() => {
    if (tables.data && !tables.data.some((t) => t.id === tableId)) setTableId(tables.data[0]?.id || "");
  }, [tables.data, tableId]);

  if (providers.isLoading) return <Spinner />;
  if (providers.error) return <Alert>{errorMessage(providers.error)}</Alert>;
  if (!providers.data?.length) return <Alert kind="info">Crie primeiro um provider.</Alert>;

  const table = tables.data?.find((t) => t.id === tableId) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {providers.data.map((p) => (
          <button
            key={p.id}
            onClick={() => { setProviderId(p.id); setTableId(""); }}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              p.id === providerId ? "bg-navy-950 text-white" : "bg-white text-ink-600 ring-1 ring-ink-200 hover:text-navy-950"
            }`}
          >
            {p.nome}
          </button>
        ))}
      </div>

      {tables.isLoading ? (
        <Spinner />
      ) : tables.error ? (
        <Alert>{errorMessage(tables.error)}</Alert>
      ) : (
        <>
          <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-600">Vigência</span>
              {tables.data!.length ? (
                <Select value={tableId} onChange={(e) => setTableId(e.target.value)} className="w-56">
                  {tables.data!.map((t, i) => (
                    <option key={t.id} value={t.id}>
                      Desde {formatDate(t.validFrom)}{i === 0 ? " (mais recente)" : ""}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-sm text-ink-400">Sem tabelas de preços</span>
              )}
            </div>
            {canEdit && <Button variant="secondary" onClick={() => setCreating(true)}>Nova vigência</Button>}
          </Card>
          {table && <PriceTableEditor key={table.id} table={table} canEdit={canEdit} />}
        </>
      )}
      {creating && (
        <NewTableModal providerId={providerId} latest={tables.data?.[0] || null} onClose={() => setCreating(false)} onCreated={(id) => setTableId(id)} />
      )}
    </div>
  );
}

function NewTableModal({ providerId, latest, onClose, onCreated }: { providerId: string; latest: PriceTableRow | null; onClose(): void; onCreated(id: string): void }) {
  const qc = useQueryClient();
  const [validFrom, setValidFrom] = useState(today());
  const [copy, setCopy] = useState(!!latest);
  const create = useMutation({
    mutationFn: () => apiPost<PriceTableRow>("/prices", { providerId, validFrom, copyFromId: copy && latest ? latest.id : undefined }),
    onSuccess: async (t) => {
      await qc.invalidateQueries(["prices", providerId]);
      onCreated(t.id);
      onClose();
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal
      title="Nova vigência de preços"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="new-table" disabled={create.isLoading}>Criar</Button>
        </>
      }
    >
      <form id="new-table" onSubmit={onSubmit} className="space-y-4">
        <Field label="Válida a partir de">
          <Input type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        {latest && (
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" className="accent-brand-500" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            Copiar preços e linhas de aluguer da vigência de {formatDate(latest.validFrom)}
          </label>
        )}
        <p className="text-xs text-ink-500">Sem cópia, todos os preços ficam em branco ("—") e podem ser preenchidos depois.</p>
        {create.error ? <Alert>{errorMessage(create.error)}</Alert> : null}
      </form>
    </Modal>
  );
}

type BaseFields = Pick<PriceTableRow, "precoCombustivelCent" | "precoServAbastCent" | "precoManutencaoCent" | "ivaPercent">;

function PriceTableEditor({ table, canEdit }: { table: PriceTableRow; canEdit: boolean }) {
  const qc = useQueryClient();
  const pick = (t: PriceTableRow): BaseFields => ({
    precoCombustivelCent: t.precoCombustivelCent,
    precoServAbastCent: t.precoServAbastCent,
    precoManutencaoCent: t.precoManutencaoCent,
    ivaPercent: t.ivaPercent,
  });
  const [base, setBase] = useState<BaseFields>(pick(table));
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(base) !== JSON.stringify(pick(table));

  const refresh = (t: PriceTableRow) => qc.setQueryData<PriceTableRow[]>(["prices", table.providerId], (list) => list?.map((x) => (x.id === t.id ? t : x)));

  const saveBase = useMutation({
    mutationFn: () => apiPatch<PriceTableRow>(`/prices/${table.id}`, base),
    onSuccess: (t) => {
      refresh(t);
      setSaved(true);
    },
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/prices/${table.id}`),
    onSuccess: () => qc.invalidateQueries(["prices", table.providerId]),
  });

  const set = (patch: Partial<BaseFields>) => {
    setSaved(false);
    setBase((b) => ({ ...b, ...patch }));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="font-semibold text-navy-950">Preços base</h3>
          <p className="text-xs text-ink-500">Em vigor desde {formatDate(table.validFrom)}. Campos vazios contam como 0 nos cálculos e geram aviso.</p>
        </div>
        <Field label="Combustível (por litro)">
          <MoneyInput value={base.precoCombustivelCent} disabled={!canEdit} onChange={(v) => set({ precoCombustivelCent: v })} aria-label="Combustível" />
        </Field>
        <Field label="Serviço de abastecimento (por litro)">
          <MoneyInput value={base.precoServAbastCent} disabled={!canEdit} onChange={(v) => set({ precoServAbastCent: v })} aria-label="Serviço de abastecimento" />
        </Field>
        <Field label="Manutenção">
          <MoneyInput value={base.precoManutencaoCent} disabled={!canEdit} onChange={(v) => set({ precoManutencaoCent: v })} aria-label="Manutenção" />
        </Field>
        <Field label="IVA">
          <PercentInput value={base.ivaPercent} disabled={!canEdit} onChange={(v) => set({ ivaPercent: v })} aria-label="IVA" />
        </Field>
        {saveBase.error ? <Alert>{errorMessage(saveBase.error)}</Alert> : null}
        {saved && !dirty && <Alert kind="success">Preços guardados.</Alert>}
        {canEdit && (
          <div className="flex items-center justify-between gap-2">
            <Button disabled={!dirty || saveBase.isLoading} onClick={() => saveBase.mutate()}>{saveBase.isLoading ? "A guardar…" : "Guardar preços"}</Button>
            <Button variant="ghost" size="sm" disabled={remove.isLoading} onClick={() => window.confirm("Eliminar esta vigência e as suas linhas de aluguer?") && remove.mutate()}>
              Eliminar vigência
            </Button>
          </div>
        )}
      </Card>
      <RentPricesCard table={table} canEdit={canEdit} onChange={refresh} />
    </div>
  );
}

interface RentDraft {
  potenciaKVA: string;
  subtipo: string;
  distancia: string;
  precoDiaCent: string | null;
}

const toDraft = (r?: RentPriceRow): RentDraft => ({
  potenciaKVA: r?.potenciaKVA?.toString() || "",
  subtipo: r?.subtipo || "",
  distancia: r?.distancia || "",
  precoDiaCent: r?.precoDiaCent ?? null,
});

const toPayload = (d: RentDraft) => ({
  potenciaKVA: d.potenciaKVA.trim() ? d.potenciaKVA.trim() : null,
  subtipo: d.subtipo.trim() || null,
  distancia: d.distancia.trim() || null,
  precoDiaCent: d.precoDiaCent,
});

function RentPricesCard({ table, canEdit, onChange }: { table: PriceTableRow; canEdit: boolean; onChange(t: PriceTableRow): void }) {
  const [newRow, setNewRow] = useState<RentDraft>(toDraft());
  const add = useMutation({
    mutationFn: () => apiPost<PriceTableRow>(`/prices/${table.id}/rent-prices`, toPayload(newRow)),
    onSuccess: (t) => {
      onChange(t);
      setNewRow(toDraft());
    },
  });

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-ink-100 p-5">
        <h3 className="font-semibold text-navy-950">Aluguer por dia</h3>
        <p className="text-xs text-ink-500">
          Preço escolhido pela potência e, se existirem, subtipo e distância. Subtipo ou distância vazios aplicam-se a todos.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-ink-100 text-sm">
          <thead className="bg-ink-50/60">
            <tr>
              <th className={th}>Potência (kVA)</th>
              <th className={th}>Subtipo</th>
              <th className={th}>Distância</th>
              <th className={`${th} text-right`}>Preço / dia</th>
              {canEdit && <th className={th} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {table.rentPrices.length === 0 && <EmptyRow colSpan={canEdit ? 5 : 4}>Sem linhas de aluguer: o aluguer conta como 0 e gera aviso.</EmptyRow>}
            {table.rentPrices.map((r) => (
              <RentRow key={r.id} tableId={table.id} row={r} canEdit={canEdit} onChange={onChange} />
            ))}
            {canEdit && (
              <tr className="bg-brand-50/40">
                <RentCells draft={newRow} onChange={setNewRow} />
                <td className="px-2 py-2 text-right">
                  <Button size="sm" disabled={add.isLoading} onClick={() => add.mutate()}>Adicionar</Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {add.error ? <div className="p-4"><Alert>{errorMessage(add.error)}</Alert></div> : null}
    </Card>
  );
}

function RentCells({ draft, onChange, disabled }: { draft: RentDraft; onChange(d: RentDraft): void; disabled?: boolean }) {
  const cell = "min-w-[6rem] px-2 py-1 text-xs";
  return (
    <>
      <td className="px-2 py-2">
        <Input inputMode="numeric" placeholder="—" disabled={disabled} value={draft.potenciaKVA} onChange={(e) => onChange({ ...draft, potenciaKVA: e.target.value })} className={cell} aria-label="Potência" />
      </td>
      <td className="px-2 py-2">
        <Input placeholder="Todos" disabled={disabled} value={draft.subtipo} onChange={(e) => onChange({ ...draft, subtipo: e.target.value })} className={cell} aria-label="Subtipo" />
      </td>
      <td className="px-2 py-2">
        <Input placeholder="Todas" disabled={disabled} value={draft.distancia} onChange={(e) => onChange({ ...draft, distancia: e.target.value })} className={cell} aria-label="Distância" />
      </td>
      <td className="px-2 py-2">
        <MoneyInput compact disabled={disabled} value={draft.precoDiaCent} onChange={(v) => onChange({ ...draft, precoDiaCent: v })} className="min-w-[8rem]" aria-label="Preço por dia" />
      </td>
    </>
  );
}

function RentRow({ tableId, row, canEdit, onChange }: { tableId: string; row: RentPriceRow; canEdit: boolean; onChange(t: PriceTableRow): void }) {
  const [draft, setDraft] = useState(toDraft(row));
  useEffect(() => setDraft(toDraft(row)), [row]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(row));

  const save = useMutation({ mutationFn: () => apiPatch<PriceTableRow>(`/prices/${tableId}/rent-prices/${row.id}`, toPayload(draft)), onSuccess: onChange });
  const remove = useMutation({ mutationFn: () => apiDelete<PriceTableRow>(`/prices/${tableId}/rent-prices/${row.id}`), onSuccess: onChange });

  return (
    <tr>
      <RentCells draft={draft} onChange={setDraft} disabled={!canEdit} />
      {canEdit && (
        <td className="whitespace-nowrap px-2 py-2 text-right">
          <div className="flex justify-end gap-1">
            {dirty && <Button size="sm" disabled={save.isLoading} onClick={() => save.mutate()}>Guardar</Button>}
            <Button size="sm" variant="ghost" disabled={remove.isLoading} onClick={() => remove.mutate()} aria-label="Eliminar linha">✕</Button>
          </div>
          {save.error || remove.error ? <div className="mt-1 text-xs text-red-600">{errorMessage(save.error || remove.error)}</div> : null}
        </td>
      )}
    </tr>
  );
}

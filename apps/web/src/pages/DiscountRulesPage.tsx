import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@cf/shared";
import { PercentInput } from "../components/inputs";
import { Alert, Button, Card, Input, PageHeader, Spinner, errorMessage, th } from "../components/ui";
import { usePermission } from "../hooks/usePermission";
import { api, apiDelete, apiPatch, apiPost } from "../lib/api";
import type { DiscountRuleRow } from "../lib/types";

interface Draft {
  horasMin: string;
  horasMax: string;
  percent: string | null;
}

const toDraft = (r?: DiscountRuleRow): Draft => ({ horasMin: r ? String(r.horasMin) : "", horasMax: r ? String(r.horasMax) : "", percent: r?.percent ?? null });

/** Faixas de desconto da rede: horas de rede por dia → % de desconto sobre o aluguer. */
export default function DiscountRulesPage() {
  const canEdit = usePermission("prices_targets", "edit");
  const rules = useQuery({ queryKey: ["discount-rules"], queryFn: () => api<DiscountRuleRow[]>("/discount-rules") });
  const [newDate, setNewDate] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, DiscountRuleRow[]>();
    for (const r of rules.data || []) map.set(r.validFrom, [...(map.get(r.validFrom) || []), r]);
    if (newDate && !map.has(newDate)) map.set(newDate, []);
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rules.data, newDate]);

  return (
    <>
      <PageHeader
        title="Faixas de desconto da rede"
        subtitle="Desconto sobre o aluguer conforme as horas diárias com rede pública. Aplica-se a vigência mais recente à data do mapa."
      />
      {rules.isLoading ? (
        <Spinner />
      ) : rules.error ? (
        <Alert>{errorMessage(rules.error)}</Alert>
      ) : (
        <div className="space-y-4">
          {canEdit && (
            <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <span className="text-sm text-ink-600">Nova vigência a partir de</span>
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="sm:w-48" />
              <span className="text-xs text-ink-400">Depois adicione as faixas na tabela que aparece.</span>
            </Card>
          )}
          {groups.length === 0 && <Alert kind="info">Sem faixas definidas: o desconto da rede conta como 0.</Alert>}
          {groups.map(([validFrom, list], i) => (
            <RulesTable key={validFrom} validFrom={validFrom} rules={list} current={i === 0} canEdit={canEdit} />
          ))}
        </div>
      )}
    </>
  );
}

function RulesTable({ validFrom, rules, current, canEdit }: { validFrom: string; rules: DiscountRuleRow[]; current: boolean; canEdit: boolean }) {
  const qc = useQueryClient();
  const [newRow, setNewRow] = useState<Draft>(toDraft());
  const add = useMutation({
    mutationFn: () => apiPost("/discount-rules", { ...newRow, validFrom }),
    onSuccess: async () => {
      await qc.invalidateQueries(["discount-rules"]);
      setNewRow(toDraft());
    },
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <h3 className="font-semibold text-navy-950">Desde {formatDate(validFrom)}</h3>
        {current && <span className="text-xs font-medium text-brand-600">Mais recente</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-ink-100 text-sm">
          <thead className="bg-ink-50/60">
            <tr>
              <th className={th}>Horas de rede (mín.)</th>
              <th className={th}>Horas de rede (máx.)</th>
              <th className={`${th} text-right`}>Desconto</th>
              {canEdit && <th className={th} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rules.map((r) => <RuleRow key={r.id} rule={r} canEdit={canEdit} />)}
            {canEdit && (
              <tr className="bg-brand-50/40">
                <RuleCells draft={newRow} onChange={setNewRow} />
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

function RuleCells({ draft, onChange, disabled }: { draft: Draft; onChange(d: Draft): void; disabled?: boolean }) {
  const cell = "w-24 px-2 py-1 text-xs";
  return (
    <>
      <td className="px-4 py-2">
        <Input type="number" min={0} max={24} disabled={disabled} value={draft.horasMin} onChange={(e) => onChange({ ...draft, horasMin: e.target.value })} className={cell} aria-label="Horas mínimas" />
      </td>
      <td className="px-4 py-2">
        <Input type="number" min={0} max={24} disabled={disabled} value={draft.horasMax} onChange={(e) => onChange({ ...draft, horasMax: e.target.value })} className={cell} aria-label="Horas máximas" />
      </td>
      <td className="px-4 py-2">
        <PercentInput compact disabled={disabled} value={draft.percent} onChange={(v) => onChange({ ...draft, percent: v })} className="ml-auto w-28" aria-label="Desconto" />
      </td>
    </>
  );
}

function RuleRow({ rule, canEdit }: { rule: DiscountRuleRow; canEdit: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(toDraft(rule));
  useEffect(() => setDraft(toDraft(rule)), [rule]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(rule));
  const done = () => qc.invalidateQueries(["discount-rules"]);
  const save = useMutation({ mutationFn: () => apiPatch(`/discount-rules/${rule.id}`, draft), onSuccess: done });
  const remove = useMutation({ mutationFn: () => apiDelete(`/discount-rules/${rule.id}`), onSuccess: done });

  return (
    <tr>
      <RuleCells draft={draft} onChange={setDraft} disabled={!canEdit} />
      {canEdit && (
        <td className="whitespace-nowrap px-2 py-2 text-right">
          <div className="flex justify-end gap-1">
            {dirty && <Button size="sm" disabled={save.isLoading} onClick={() => save.mutate()}>Guardar</Button>}
            <Button size="sm" variant="ghost" disabled={remove.isLoading} onClick={() => remove.mutate()} aria-label="Eliminar faixa">✕</Button>
          </div>
          {save.error || remove.error ? <div className="mt-1 max-w-xs text-xs text-red-600">{errorMessage(save.error || remove.error)}</div> : null}
        </td>
      )}
    </tr>
  );
}

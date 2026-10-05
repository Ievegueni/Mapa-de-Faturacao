import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatKz, MONTHS } from "@cf/shared";
import { MoneyInput } from "../components/inputs";
import { Alert, Button, Card, PageHeader, Select, Spinner, errorMessage } from "../components/ui";
import { usePermission } from "../hooks/usePermission";
import { api, apiPut } from "../lib/api";
import type { ProviderRow, TargetRow } from "../lib/types";
import { yearOptions } from "../lib/years";

type Field = "aluguerCent" | "combustivelCent";
type Grid = Record<string, string | null>; // `${providerId|GLOBAL}:${mes}:${field}`

const GLOBAL = "GLOBAL";
const key = (owner: string, mes: number, field: Field) => `${owner}:${mes}:${field}`;
const FIELDS: { field: Field; label: string }[] = [
  { field: "aluguerCent", label: "Aluguer" },
  { field: "combustivelCent", label: "Combustível" },
];

function toGrid(items: TargetRow[]): Grid {
  const g: Grid = {};
  for (const t of items) {
    const owner = t.providerId || GLOBAL;
    g[key(owner, t.mes, "aluguerCent")] = t.aluguerCent;
    g[key(owner, t.mes, "combustivelCent")] = t.combustivelCent;
  }
  return g;
}

/** Targets ano × mês: linha Global e uma linha por provider (aluguer e combustível). Campos vazios permitidos. */
export default function TargetsPage() {
  const qc = useQueryClient();
  const canEdit = usePermission("prices_targets", "edit");
  const [ano, setAno] = useState(new Date().getFullYear());
  const [grid, setGrid] = useState<Grid>({});
  const [saved, setSaved] = useState(false);

  const providers = useQuery({ queryKey: ["providers", "GERADORES"], queryFn: () => api<ProviderRow[]>("/providers?ativo=true&tipo=GERADORES") });
  const targets = useQuery({ queryKey: ["targets", ano], queryFn: () => api<{ ano: number; items: TargetRow[] }>(`/targets?ano=${ano}`) });

  const original = useMemo(() => toGrid(targets.data?.items || []), [targets.data]);
  useEffect(() => setGrid(original), [original]);
  const dirty = Object.keys({ ...grid, ...original }).some((k) => (grid[k] ?? null) !== (original[k] ?? null));

  const owners = [{ id: GLOBAL, nome: "Global" }, ...(providers.data || []).map((p) => ({ id: p.id, nome: p.nome }))];

  const save = useMutation({
    mutationFn: () => {
      const items = owners.flatMap((o) =>
        MONTHS.map((_, i) => ({
          mes: i + 1,
          providerId: o.id === GLOBAL ? null : o.id,
          aluguerCent: grid[key(o.id, i + 1, "aluguerCent")] ?? null,
          combustivelCent: grid[key(o.id, i + 1, "combustivelCent")] ?? null,
        })),
      );
      return apiPut<{ ano: number; items: TargetRow[] }>("/targets", { ano, items });
    },
    onSuccess: (data) => {
      qc.setQueryData(["targets", ano], data);
      setSaved(true);
    },
  });

  const total = (owner: string, field: Field) => {
    let sum = BigInt(0);
    let any = false;
    for (let m = 1; m <= 12; m++) {
      const v = grid[key(owner, m, field)];
      if (v !== null && v !== undefined) {
        sum += BigInt(v);
        any = true;
      }
    }
    return any ? formatKz(sum) : "—";
  };

  return (
    <>
      <PageHeader
        title="Targets"
        subtitle="Objectivos mensais de aluguer e combustível: global e por provider. Células vazias aparecem como —."
        actions={
          canEdit && (
            <Button disabled={!dirty || save.isLoading} onClick={() => { setSaved(false); save.mutate(); }}>
              {save.isLoading ? "A guardar…" : "Guardar targets"}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={ano} onChange={(e) => setAno(Number(e.target.value))} className="w-28" aria-label="Ano">
          {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        {dirty && <span className="text-xs font-medium text-brand-600">Alterações por guardar</span>}
      </div>
      <div className="mb-4 space-y-2">
        {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
        {saved && !dirty && <Alert kind="success">Targets guardados.</Alert>}
      </div>
      {targets.isLoading || providers.isLoading ? (
        <Spinner />
      ) : targets.error || providers.error ? (
        <Alert>{errorMessage(targets.error || providers.error)}</Alert>
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-ink-50/60">
              <tr>
                <th className="sticky left-0 z-10 bg-ink-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-500">Linha</th>
                {MONTHS.map((m) => (
                  <th key={m} className="px-1.5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-ink-500">{m}</th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-ink-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((o, oi) =>
                FIELDS.map(({ field, label }, fi) => (
                  <tr key={`${o.id}:${field}`} className={`${fi === 0 && oi > 0 ? "border-t-2 border-ink-100" : "border-t border-ink-50"} ${o.id === GLOBAL ? "bg-brand-50/40" : ""}`}>
                    <td className={`sticky left-0 z-10 whitespace-nowrap px-4 py-1.5 ${o.id === GLOBAL ? "bg-brand-50" : "bg-white"}`}>
                      {fi === 0 && <div className="font-semibold text-navy-950">{o.nome}</div>}
                      <div className="text-xs text-ink-500">{label}</div>
                    </td>
                    {MONTHS.map((m, i) => (
                      <td key={m} className="px-1 py-1.5">
                        <MoneyInput
                          compact
                          disabled={!canEdit}
                          value={grid[key(o.id, i + 1, field)] ?? null}
                          onChange={(v) => { setSaved(false); setGrid((g) => ({ ...g, [key(o.id, i + 1, field)]: v })); }}
                          className="w-28"
                          aria-label={`${o.nome} ${label} ${m}`}
                        />
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs font-medium tabular-nums text-navy-950">{total(o.id, field)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

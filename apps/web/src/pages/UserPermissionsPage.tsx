import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ACTION_LABELS, Module, MODULE_LABELS, MODULES, permissionKey, ROLE_LABELS } from "@cf/shared";
import { usePermission } from "../hooks/usePermission";
import { api, apiPut } from "../lib/api";
import type { PermissionsView, UserRow } from "../lib/types";
import { Alert, Badge, Button, Card, PageHeader, Spinner, errorMessage } from "../components/ui";

type Choice = "default" | "allow" | "deny";

const ALL_ACTIONS = Array.from(new Set(Object.values(MODULES).flat()));

export default function UserPermissionsPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const canEdit = usePermission("users", "edit");
  const user = useQuery({ queryKey: ["user", id], queryFn: () => api<UserRow>(`/users/${id}`) });
  const perms = useQuery({ queryKey: ["permissions", id], queryFn: () => api<PermissionsView>(`/users/${id}/permissions`) });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!perms.data) return;
    const next: Record<string, Choice> = {};
    for (const o of perms.data.overrides) next[permissionKey(o.module, o.action)] = o.allowed ? "allow" : "deny";
    setChoices(next);
  }, [perms.data]);

  const defaults = useMemo(() => new Set(perms.data?.defaults || []), [perms.data]);

  const save = useMutation({
    mutationFn: () => {
      const overrides = Object.entries(MODULES).flatMap(([module, actions]) =>
        (actions as readonly string[]).map((action) => {
          const c = choices[permissionKey(module, action)] || "default";
          return { module, action, allowed: c === "default" ? null : c === "allow" };
        }),
      );
      return apiPut<PermissionsView>(`/users/${id}/permissions`, { overrides });
    },
    onSuccess: (data) => {
      qc.setQueryData(["permissions", id], data);
      setSaved(true);
    },
  });

  if (user.isLoading || perms.isLoading) return <Spinner />;
  if (user.error || perms.error) return <Alert>{errorMessage(user.error || perms.error)}</Alert>;
  const u = user.data!;

  const effective = (key: string) => {
    const c = choices[key] || "default";
    return c === "default" ? defaults.has(key) : c === "allow";
  };

  return (
    <>
      <PageHeader
        title="Permissões"
        subtitle={`${u.nome} · ${ROLE_LABELS[u.role]}. Ajuste acções específicas em relação ao perfil.`}
        actions={
          <>
            <Link to="/utilizadores"><Button variant="ghost">Voltar</Button></Link>
            {canEdit && <Button onClick={() => { setSaved(false); save.mutate(); }} disabled={save.isLoading}>{save.isLoading ? "A guardar…" : "Guardar permissões"}</Button>}
          </>
        }
      />
      <div className="mb-4 space-y-2">
        {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
        {saved && <Alert kind="success">Permissões guardadas. Aplicam-se no próximo pedido do utilizador.</Alert>}
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
          <span className="flex items-center gap-1"><Badge>Perfil</Badge> segue o default do perfil</span>
          <span className="flex items-center gap-1"><Badge tone="green">Permitir</Badge> override</span>
          <span className="flex items-center gap-1"><Badge tone="red">Negar</Badge> override</span>
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="min-w-full divide-y divide-ink-100 text-sm">
          <thead className="bg-ink-50/60">
            <tr>
              <th className="sticky left-0 bg-ink-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-500">Módulo</th>
              {ALL_ACTIONS.map((a) => (
                <th key={a} className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider text-ink-500">{ACTION_LABELS[a] || a}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {(Object.keys(MODULES) as Module[]).map((module) => (
              <tr key={module}>
                <td className="sticky left-0 whitespace-nowrap bg-white px-4 py-2.5 font-medium text-navy-950">{MODULE_LABELS[module]}</td>
                {ALL_ACTIONS.map((action) => {
                  if (!(MODULES[module] as readonly string[]).includes(action)) return <td key={action} className="px-2 py-2.5 text-center text-ink-200">·</td>;
                  const key = permissionKey(module, action);
                  const choice = choices[key] || "default";
                  const on = effective(key);
                  const ring = choice === "allow" ? "border-emerald-300 bg-emerald-50" : choice === "deny" ? "border-red-300 bg-red-50" : "border-ink-200 bg-white";
                  return (
                    <td key={action} className="px-2 py-2 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-base leading-none ${on ? "text-emerald-600" : "text-ink-300"}`} title={on ? "Permitido" : "Sem acesso"}>{on ? "✔" : "—"}</span>
                        <select
                          aria-label={`${MODULE_LABELS[module]} · ${ACTION_LABELS[action]}`}
                          disabled={!canEdit}
                          value={choice}
                          onChange={(e) => { setSaved(false); setChoices({ ...choices, [key]: e.target.value as Choice }); }}
                          className={`rounded-md border px-1 py-0.5 text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 ${ring}`}
                        >
                          <option value="default">Perfil ({defaults.has(key) ? "✔" : "—"})</option>
                          <option value="allow">Permitir</option>
                          <option value="deny">Negar</option>
                        </select>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

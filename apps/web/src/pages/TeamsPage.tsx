import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BILLING_TYPE_LABELS, BILLING_TYPES, BillingType, ROLE_LABELS, teamCreateSchema } from "@cf/shared";
import { Can, usePermission } from "../hooks/usePermission";
import { api, apiDelete, apiPatch, apiPost } from "../lib/api";
import type { TeamRow, UserRow } from "../lib/types";
import { validate } from "../lib/validate";
import { Alert, Badge, Button, Card, EmptyRow, Field, Input, Modal, PageHeader, Select, Spinner, errorMessage, td, th } from "../components/ui";

export default function TeamsPage() {
  const qc = useQueryClient();
  const [estado, setEstado] = useState("true");
  const [editing, setEditing] = useState<TeamRow | "new" | null>(null);
  const [membersOf, setMembersOf] = useState<string | null>(null);
  const canEdit = usePermission("teams", "edit");
  const canDelete = usePermission("teams", "delete");

  const teams = useQuery({
    queryKey: ["teams", estado],
    queryFn: () => api<TeamRow[]>(`/teams${estado ? `?ativo=${estado}` : ""}`),
    keepPreviousData: true,
  });

  const toggle = useMutation({
    mutationFn: (t: TeamRow) => (t.ativo ? apiDelete(`/teams/${t.id}`) : apiPatch(`/teams/${t.id}`, { ativo: true })),
    onSuccess: () => qc.invalidateQueries(["teams"]),
  });

  const membersTeam = teams.data?.find((t) => t.id === membersOf) || null;

  return (
    <>
      <PageHeader
        title="Equipas"
        subtitle="Cada mapa pertence a uma equipa. Os utilizadores só vêem os dados das suas equipas."
        actions={
          <Can module="teams" action="create">
            <Button onClick={() => setEditing("new")}>Nova equipa</Button>
          </Can>
        }
      />
      <Card>
        <div className="flex gap-2 border-b border-ink-100 p-4">
          <Select value={estado} onChange={(e) => setEstado(e.target.value)} className="sm:w-40">
            <option value="true">Activas</option>
            <option value="false">Inactivas</option>
            <option value="">Todas</option>
          </Select>
        </div>
        {toggle.error ? <div className="p-4"><Alert>{errorMessage(toggle.error)}</Alert></div> : null}
        {teams.isLoading ? (
          <Spinner />
        ) : teams.error ? (
          <div className="p-4"><Alert>{errorMessage(teams.error)}</Alert></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Equipa</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Membros</th>
                  <th className={th}>Estado</th>
                  <th className={`${th} text-right`}>Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {teams.data!.length === 0 && <EmptyRow colSpan={5}>Nenhuma equipa. Crie a primeira equipa para começar.</EmptyRow>}
                {teams.data!.map((t) => (
                  <tr key={t.id} className="hover:bg-ink-50/50">
                    <td className={`${td} font-medium text-navy-950`}>{t.nome}</td>
                    <td className={td}><Badge tone={t.tipo === "PROVIDERS" ? "navy" : "brand"}>{BILLING_TYPE_LABELS[t.tipo]}</Badge></td>
                    <td className={td}>{t.members.length}</td>
                    <td className={td}>{t.ativo ? <Badge tone="green">Activa</Badge> : <Badge tone="red">Inactiva</Badge>}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setMembersOf(t.id)}>Membros</Button>
                        {canEdit && <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Editar</Button>}
                        {canDelete && (
                          <Button size="sm" variant={t.ativo ? "danger" : "secondary"} disabled={toggle.isLoading} onClick={() => toggle.mutate(t)}>
                            {t.ativo ? "Desactivar" : "Reactivar"}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <TeamForm team={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {membersTeam && <MembersModal team={membersTeam} canEdit={canEdit} onClose={() => setMembersOf(null)} />}
    </>
  );
}

function TeamForm({ team, onClose }: { team: TeamRow | null; onClose(): void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(team?.nome || "");
  const [tipo, setTipo] = useState<BillingType>(team?.tipo || "PROVIDERS");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const data = validate(teamCreateSchema, { nome, tipo });
      return team ? apiPatch(`/teams/${team.id}`, data) : apiPost("/teams", data);
    },
    onSuccess: () => {
      qc.invalidateQueries(["teams"]);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <Modal
      title={team ? "Editar equipa" : "Nova equipa"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="team-form" disabled={save.isLoading}>{save.isLoading ? "A guardar…" : "Guardar"}</Button>
        </>
      }
    >
      <form id="team-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Nome">
          <Input required value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </Field>
        <Field label="Tipo de facturação">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as BillingType)}>
            {BILLING_TYPES.map((t) => (
              <option key={t} value={t}>{BILLING_TYPE_LABELS[t]}</option>
            ))}
          </Select>
        </Field>
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}

function MembersModal({ team, canEdit, onClose }: { team: TeamRow; canEdit: boolean; onClose(): void }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const users = useQuery({ queryKey: ["users", "", "", "true"], queryFn: () => api<UserRow[]>("/users?ativo=true"), enabled: canEdit });

  const done = () => qc.invalidateQueries(["teams"]).then(() => qc.invalidateQueries(["users"]));
  const add = useMutation({
    mutationFn: () => apiPost(`/teams/${team.id}/members`, { userId }),
    onSuccess: () => {
      setUserId("");
      return done();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/teams/${team.id}/members/${id}`), onSuccess: done });

  const memberIds = new Set(team.members.map((m) => m.id));
  const candidates = (users.data || []).filter((u) => !memberIds.has(u.id) && u.role !== "GESTOR");
  const error = add.error || remove.error;

  return (
    <Modal title={`Membros · ${team.nome}`} onClose={onClose} wide>
      {canEdit && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Seleccionar utilizador…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>{u.nome} · {ROLE_LABELS[u.role]}</option>
            ))}
          </Select>
          <Button disabled={!userId || add.isLoading} onClick={() => add.mutate()} className="shrink-0">Adicionar</Button>
        </div>
      )}
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
        {team.members.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-400">Sem membros.</li>}
        {team.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-navy-950">{m.nome} {!m.ativo && <Badge tone="red">Inactivo</Badge>}</div>
              <div className="truncate text-xs text-ink-500">{m.email} · {ROLE_LABELS[m.role]}</div>
            </div>
            {canEdit && <Button size="sm" variant="ghost" disabled={remove.isLoading} onClick={() => remove.mutate(m.id)}>Remover</Button>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

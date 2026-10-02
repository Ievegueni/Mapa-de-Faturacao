import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PASSWORD_MIN, Role, ROLE_LABELS, ROLES, userCreateSchema, userUpdateSchema } from "@cf/shared";
import { useAuth } from "../hooks/useAuth";
import { Can, usePermission } from "../hooks/usePermission";
import { api, apiDelete, apiPatch, apiPost } from "../lib/api";
import type { TeamRow, UserRow } from "../lib/types";
import { validate } from "../lib/validate";
import { Alert, Badge, Button, Card, EmptyRow, Field, Input, Modal, PageHeader, Select, Spinner, errorMessage, td, th } from "../components/ui";

const roleTone: Record<Role, "navy" | "brand" | "ink"> = { GESTOR: "navy", SUPERVISOR: "brand", TECNICO: "ink" };

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [estado, setEstado] = useState("true");
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const canEdit = usePermission("users", "edit");
  const canDelete = usePermission("users", "delete");

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (role) params.set("role", role);
  if (estado) params.set("ativo", estado);
  const users = useQuery({ queryKey: ["users", q, role, estado], queryFn: () => api<UserRow[]>(`/users?${params}`), keepPreviousData: true });

  const toggle = useMutation({
    mutationFn: (u: UserRow) => (u.ativo ? apiDelete(`/users/${u.id}`) : apiPatch(`/users/${u.id}`, { ativo: true })),
    onSuccess: () => qc.invalidateQueries(["users"]),
  });

  return (
    <>
      <PageHeader
        title="Utilizadores"
        subtitle="Contas de acesso, perfis e equipas."
        actions={
          <Can module="users" action="create">
            <Button onClick={() => setEditing("new")}>Novo utilizador</Button>
          </Can>
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-ink-100 p-4 sm:flex-row">
          <Input placeholder="Pesquisar por nome ou email" value={q} onChange={(e) => setQ(e.target.value)} className="sm:max-w-xs" />
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="sm:w-44">
            <option value="">Todos os perfis</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </Select>
          <Select value={estado} onChange={(e) => setEstado(e.target.value)} className="sm:w-40">
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
            <option value="">Todos</option>
          </Select>
        </div>
        {toggle.error ? <div className="p-4"><Alert>{errorMessage(toggle.error)}</Alert></div> : null}
        {users.isLoading ? (
          <Spinner />
        ) : users.error ? (
          <div className="p-4"><Alert>{errorMessage(users.error)}</Alert></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Nome</th>
                  <th className={th}>Perfil</th>
                  <th className={th}>Equipas</th>
                  <th className={th}>Estado</th>
                  <th className={`${th} text-right`}>Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {users.data!.length === 0 && <EmptyRow colSpan={5}>Nenhum utilizador encontrado.</EmptyRow>}
                {users.data!.map((u) => (
                  <tr key={u.id} className="hover:bg-ink-50/50">
                    <td className={td}>
                      <div className="font-medium text-navy-950">{u.nome}</div>
                      <div className="text-xs text-ink-500">{u.email}</div>
                    </td>
                    <td className={td}><Badge tone={roleTone[u.role]}>{ROLE_LABELS[u.role]}</Badge></td>
                    <td className={td}>{u.role === "GESTOR" ? <span className="text-ink-400">Todas</span> : u.teams.length ? u.teams.map((t) => t.nome).join(", ") : <span className="text-ink-400">—</span>}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {u.ativo ? <Badge tone="green">Activo</Badge> : <Badge tone="red">Inactivo</Badge>}
                        {u.mustChangePassword && <Badge>Password temporária</Badge>}
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <div className="flex justify-end gap-1.5">
                        {canEdit && <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>Editar</Button>}
                        {canEdit && u.role !== "GESTOR" && (
                          <Link to={`/utilizadores/${u.id}/permissoes`}>
                            <Button size="sm" variant="secondary">Permissões</Button>
                          </Link>
                        )}
                        {canDelete && u.id !== me?.id && (
                          <Button size="sm" variant={u.ativo ? "danger" : "secondary"} disabled={toggle.isLoading} onClick={() => toggle.mutate(u)}>
                            {u.ativo ? "Desactivar" : "Reactivar"}
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

      {editing && <UserForm user={editing === "new" ? null : editing} isSelf={editing !== "new" && editing.id === me?.id} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserForm({ user, isSelf, onClose }: { user: UserRow | null; isSelf: boolean; onClose(): void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nome: user?.nome || "",
    email: user?.email || "",
    role: (user?.role || "TECNICO") as Role,
    password: "",
    teamIds: [] as string[],
  });
  const [error, setError] = useState<string | null>(null);
  const teams = useQuery({ queryKey: ["teams", "active"], queryFn: () => api<TeamRow[]>("/teams?ativo=true"), enabled: !user });

  const save = useMutation({
    mutationFn: () => {
      if (!user) {
        const data = validate(userCreateSchema, { ...form, teamIds: form.role === "GESTOR" ? [] : form.teamIds });
        return apiPost<UserRow>("/users", data);
      }
      const data = validate(userUpdateSchema, {
        nome: form.nome,
        email: form.email,
        role: isSelf ? undefined : form.role,
        password: form.password || undefined,
      });
      return apiPatch<UserRow>(`/users/${user.id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries(["users"]);
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

  const toggleTeam = (id: string) =>
    setForm((f) => ({ ...f, teamIds: f.teamIds.includes(id) ? f.teamIds.filter((t) => t !== id) : [...f.teamIds, id] }));

  return (
    <Modal
      title={user ? "Editar utilizador" : "Novo utilizador"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="user-form" disabled={save.isLoading}>{save.isLoading ? "A guardar…" : "Guardar"}</Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Nome">
          <Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Perfil" hint={isSelf ? "Não pode alterar o seu próprio perfil." : undefined}>
          <Select value={form.role} disabled={isSelf} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </Select>
        </Field>
        <Field
          label={user ? "Repor password (opcional)" : "Password temporária"}
          hint={`Mínimo de ${PASSWORD_MIN} caracteres. O utilizador tem de a trocar no primeiro acesso.`}
        >
          <Input type="text" autoComplete="off" required={!user} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {!user && form.role !== "GESTOR" && (
          <Field label="Equipas" group>
            {teams.isLoading ? (
              <span className="text-sm text-ink-400">A carregar…</span>
            ) : teams.data?.length ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-ink-200 p-2">
                {teams.data.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-ink-50">
                    <input type="checkbox" className="accent-brand-500" checked={form.teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                    {t.nome} <span className="text-xs text-ink-400">({t.tipo === "PROVIDERS" ? "Providers" : "Geradores"})</span>
                  </label>
                ))}
              </div>
            ) : (
              <span className="text-sm text-ink-400">Ainda não existem equipas.</span>
            )}
          </Field>
        )}
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}

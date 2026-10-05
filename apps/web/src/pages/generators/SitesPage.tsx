import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can, formatDate, REGIOES } from "@cf/shared";
import { Pager } from "../../components/Pager";
import { Tabs } from "../../components/Tabs";
import { Alert, Badge, Button, Card, EmptyRow, Input, PageHeader, Select, Spinner, errorMessage, td, th } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { useDebounced } from "../../hooks/useDebounced";
import { usePermission } from "../../hooks/usePermission";
import { api, apiDelete } from "../../lib/api";
import type { GeneratorOptions, GeneratorRow, Paged, SiteRow } from "../../lib/types";
import { GeneratorForm, SiteForm } from "./forms";

type Tab = "sites" | "geradores";

const bool = (v: boolean | null) => (v === null ? "—" : v ? "Sim" : "Não");

export default function SitesPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "geradores" ? "geradores" : "sites";
  const { user } = useAuth();
  const options = useQuery({ queryKey: ["generator-options"], queryFn: () => api<GeneratorOptions>("/generators/options") });
  const canEdit = !!user && can(user.permissions, "billing_generators", "edit") && can(user.permissions, "billing_generators", "validate");

  return (
    <>
      <PageHeader title="Sites e geradores" subtitle="Dados mestre de Combustível e Geradores: sites, geradores, proprietários e potências." />
      <Tabs<Tab>
        value={tab}
        onChange={(v) => setParams(v === "geradores" ? { tab: "geradores" } : {})}
        items={[
          { value: "sites", label: "Sites" },
          { value: "geradores", label: "Geradores" },
        ]}
      />
      {options.isLoading ? (
        <Spinner />
      ) : options.error ? (
        <Alert>{errorMessage(options.error)}</Alert>
      ) : options.data!.teams.length === 0 ? (
        <Alert kind="info">Não pertence a nenhuma equipa de Geradores.</Alert>
      ) : tab === "sites" ? (
        <SitesTab options={options.data!} canEdit={canEdit} />
      ) : (
        <GeneratorsTab options={options.data!} canEdit={canEdit} />
      )}
    </>
  );
}

function SitesTab({ options, canEdit }: { options: GeneratorOptions; canEdit: boolean }) {
  const qc = useQueryClient();
  const canDelete = usePermission("billing_generators", "delete") && canEdit;
  const [f, setF] = useState({ q: "", regiao: "", provincia: "", teamId: "" });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SiteRow | "new" | null>(null);
  const q = useDebounced(f.q);
  const set = (patch: Partial<typeof f>) => {
    setPage(1);
    setF((x) => ({ ...x, ...patch }));
  };

  const qs = new URLSearchParams({ page: String(page) });
  if (q) qs.set("q", q);
  if (f.regiao) qs.set("regiao", f.regiao);
  if (f.provincia) qs.set("provincia", f.provincia);
  if (f.teamId) qs.set("teamId", f.teamId);
  const sites = useQuery({ queryKey: ["sites", q, f.regiao, f.provincia, f.teamId, page], queryFn: () => api<Paged<SiteRow>>(`/generators/sites?${qs}`), keepPreviousData: true });

  const remove = useMutation({
    mutationFn: (s: SiteRow) => apiDelete(`/generators/sites/${s.id}`),
    onSuccess: () => {
      qc.invalidateQueries(["sites"]);
      qc.invalidateQueries(["generator-options"]);
    },
  });

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Input placeholder="Pesquisar por nome, código P.P. ou nº de série" value={f.q} onChange={(e) => set({ q: e.target.value })} className="col-span-2 sm:w-80" />
            <Select value={f.regiao} onChange={(e) => set({ regiao: e.target.value })} className="sm:w-36" aria-label="Região">
              <option value="">Todas as regiões</option>
              {REGIOES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
            <Select value={f.provincia} onChange={(e) => set({ provincia: e.target.value })} className="sm:w-40" aria-label="Província">
              <option value="">Todas as províncias</option>
              {options.provincias.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            {options.teams.length > 1 && (
              <Select value={f.teamId} onChange={(e) => set({ teamId: e.target.value })} className="sm:w-44" aria-label="Equipa">
                <option value="">Todas as equipas</option>
                {options.teams.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </Select>
            )}
          </div>
          {canEdit && <Button onClick={() => setEditing("new")}>Novo site</Button>}
        </div>
        {remove.error ? <div className="p-4"><Alert>{errorMessage(remove.error)}</Alert></div> : null}
        {sites.isLoading ? (
          <Spinner />
        ) : sites.error ? (
          <div className="p-4"><Alert>{errorMessage(sites.error)}</Alert></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-100">
                <thead className="bg-ink-50/60">
                  <tr>
                    <th className={th}>Site</th>
                    <th className={th}>Localização</th>
                    <th className={th}>Subtipo · distância</th>
                    <th className={th}>Geradores</th>
                    <th className={th}>Rede</th>
                    {canEdit && <th className={`${th} text-right`}>Acções</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {sites.data!.items.length === 0 && <EmptyRow colSpan={canEdit ? 6 : 5}>Nenhum site encontrado.</EmptyRow>}
                  {sites.data!.items.map((s) => (
                    <tr key={s.id} className="hover:bg-ink-50/50">
                      <td className={td}>
                        <div className="font-medium text-navy-950">{s.nome}</div>
                        <div className="text-xs text-ink-500">P.P. {s.codigoPP || "—"}{options.teams.length > 1 ? ` · ${s.team.nome}` : ""}</div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        {s.provincia}
                        <div className="text-xs text-ink-500">{s.regiao}</div>
                      </td>
                      <td className={td}>{[s.subtipo, s.distanciaFacturacao].filter(Boolean).join(" · ") || "—"}</td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          {s.generators.length === 0 && <span className="text-ink-400">—</span>}
                          {s.generators.map((g) => (
                            <Badge key={g.id} tone={g.dataRemocao ? "red" : "ink"}>
                              {g.numeroSerie}{g.potenciaKVA ? ` · ${g.potenciaKVA} kVA` : ""}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{bool(s.ligadoRede)}</td>
                      {canEdit && (
                        <td className={`${td} whitespace-nowrap text-right`}>
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>Editar</Button>
                            {canDelete && (
                              <Button size="sm" variant="ghost" aria-label="Eliminar" disabled={remove.isLoading} onClick={() => window.confirm(`Eliminar o site ${s.nome}?`) && remove.mutate(s)}>✕</Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={sites.data!.total} pageSize={sites.data!.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
      {editing && <SiteForm site={editing === "new" ? null : editing} options={options} onClose={() => setEditing(null)} />}
    </>
  );
}

function GeneratorsTab({ options, canEdit }: { options: GeneratorOptions; canEdit: boolean }) {
  const qc = useQueryClient();
  const canDelete = usePermission("billing_generators", "delete") && canEdit;
  const [f, setF] = useState({ q: "", providerId: "", potencia: "", removidos: "false" });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<GeneratorRow | "new" | null>(null);
  const q = useDebounced(f.q);
  const set = (patch: Partial<typeof f>) => {
    setPage(1);
    setF((x) => ({ ...x, ...patch }));
  };

  const qs = new URLSearchParams({ page: String(page) });
  if (q) qs.set("q", q);
  if (f.providerId) qs.set("providerId", f.providerId);
  if (f.potencia) qs.set("potencia", f.potencia);
  if (f.removidos) qs.set("removidos", f.removidos);
  const gens = useQuery({
    queryKey: ["generators", q, f.providerId, f.potencia, f.removidos, page],
    queryFn: () => api<Paged<GeneratorRow>>(`/generators/generators?${qs}`),
    keepPreviousData: true,
  });

  const remove = useMutation({
    mutationFn: (g: GeneratorRow) => apiDelete(`/generators/generators/${g.id}`),
    onSuccess: () => {
      qc.invalidateQueries(["generators"]);
      qc.invalidateQueries(["sites"]);
    },
  });

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Input placeholder="Pesquisar por nº de série, activo ou site" value={f.q} onChange={(e) => set({ q: e.target.value })} className="col-span-2 sm:w-72" />
            <Select value={f.providerId} onChange={(e) => set({ providerId: e.target.value })} className="sm:w-40" aria-label="Proprietário">
              <option value="">Todos os proprietários</option>
              {options.providers.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
            <Select value={f.potencia} onChange={(e) => set({ potencia: e.target.value })} className="sm:w-36" aria-label="Potência">
              <option value="">Todas as potências</option>
              {options.potencias.map((p) => <option key={p} value={p}>{p} kVA</option>)}
            </Select>
            <Select value={f.removidos} onChange={(e) => set({ removidos: e.target.value })} className="sm:w-36" aria-label="Estado">
              <option value="false">Instalados</option>
              <option value="true">Removidos</option>
              <option value="">Todos</option>
            </Select>
          </div>
          {canEdit && <Button onClick={() => setEditing("new")}>Novo gerador</Button>}
        </div>
        {remove.error ? <div className="p-4"><Alert>{errorMessage(remove.error)}</Alert></div> : null}
        {gens.isLoading ? (
          <Spinner />
        ) : gens.error ? (
          <div className="p-4"><Alert>{errorMessage(gens.error)}</Alert></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-100">
                <thead className="bg-ink-50/60">
                  <tr>
                    <th className={th}>Nº de série</th>
                    <th className={th}>Site</th>
                    <th className={th}>Proprietário</th>
                    <th className={`${th} text-right`}>Potência</th>
                    <th className={th}>Instalação</th>
                    <th className={th}>Remoção</th>
                    {canEdit && <th className={`${th} text-right`}>Acções</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {gens.data!.items.length === 0 && <EmptyRow colSpan={canEdit ? 7 : 6}>Nenhum gerador encontrado.</EmptyRow>}
                  {gens.data!.items.map((g) => (
                    <tr key={g.id} className="hover:bg-ink-50/50">
                      <td className={td}>
                        <div className="font-medium text-navy-950">{g.numeroSerie}</div>
                        <div className="text-xs text-ink-500">Activo {g.numeroActivo || "—"}</div>
                      </td>
                      <td className={td}>
                        {g.site.nome}
                        <div className="text-xs text-ink-500">P.P. {g.site.codigoPP || "—"} · {g.site.provincia}</div>
                      </td>
                      <td className={td}>{g.provider.nome}</td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{g.potenciaKVA ? `${g.potenciaKVA} kVA` : "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(g.dataInstalacao)}</td>
                      <td className={`${td} whitespace-nowrap`}>{g.dataRemocao ? <Badge tone="red">{formatDate(g.dataRemocao)}</Badge> : "—"}</td>
                      {canEdit && (
                        <td className={`${td} whitespace-nowrap text-right`}>
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="secondary" onClick={() => setEditing(g)}>Editar</Button>
                            {canDelete && g._count.measurements === 0 && (
                              <Button size="sm" variant="ghost" aria-label="Eliminar" disabled={remove.isLoading} onClick={() => window.confirm(`Eliminar o gerador ${g.numeroSerie}?`) && remove.mutate(g)}>✕</Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={gens.data!.total} pageSize={gens.data!.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
      {editing && <GeneratorForm generator={editing === "new" ? null : editing} options={options} onClose={() => setEditing(null)} />}
    </>
  );
}

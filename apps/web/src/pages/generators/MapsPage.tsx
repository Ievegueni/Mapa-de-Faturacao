import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDecimal, formatKz, MONTHS_FULL, RECORD_STATE_LABELS } from "@cf/shared";
import { Alert, Badge, Button, Card, EmptyRow, Field, Modal, PageHeader, Select, Spinner, errorMessage, td, th } from "../../components/ui";
import { usePermission } from "../../hooks/usePermission";
import { api, apiPost } from "../../lib/api";
import type { GeneratorMapRow, GeneratorOptions } from "../../lib/types";
import { yearOptions } from "../../lib/years";
import { stateTone } from "../billing-providers/invoiceRules";

export default function MapsPage() {
  const navigate = useNavigate();
  const canCreate = usePermission("billing_generators", "create");
  const [f, setF] = useState({ ano: String(new Date().getFullYear()), teamId: "", providerId: "" });
  const [creating, setCreating] = useState(false);
  const options = useQuery({ queryKey: ["generator-options"], queryFn: () => api<GeneratorOptions>("/generators/options") });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const maps = useQuery({ queryKey: ["generator-maps", f], queryFn: () => api<GeneratorMapRow[]>(`/generators/maps?${qs}`), keepPreviousData: true });

  return (
    <>
      <PageHeader
        title="Mapas de geradores"
        subtitle="Um mapa por equipa, parceiro e mês: Auto de Medição, validação e fecho."
        actions={canCreate && options.data?.teams.length ? <Button onClick={() => setCreating(true)}>Novo mapa</Button> : undefined}
      />
      {options.data && options.data.teams.length === 0 && <Alert kind="info">Não pertence a nenhuma equipa de Geradores.</Alert>}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-ink-100 p-4">
          <Select value={f.ano} onChange={(e) => setF({ ...f, ano: e.target.value })} className="w-24" aria-label="Ano">
            {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          {(options.data?.teams.length ?? 0) > 1 && (
            <Select value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })} className="w-48" aria-label="Equipa">
              <option value="">Todas as equipas</option>
              {options.data!.teams.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </Select>
          )}
          <Select value={f.providerId} onChange={(e) => setF({ ...f, providerId: e.target.value })} className="w-44" aria-label="Parceiro">
            <option value="">Todos os parceiros</option>
            {options.data?.providers.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
        </div>
        {maps.isLoading ? (
          <Spinner />
        ) : maps.error ? (
          <div className="p-4"><Alert>{errorMessage(maps.error)}</Alert></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Mês</th>
                  <th className={th}>Parceiro · equipa</th>
                  <th className={th}>Estado</th>
                  <th className={`${th} text-right`}>Medições</th>
                  <th className={`${th} text-right`}>Litros</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Com avisos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {maps.data!.length === 0 && <EmptyRow colSpan={7}>Nenhum mapa neste ano.</EmptyRow>}
                {maps.data!.map((m) => {
                  const flagged = Object.values(m.stats.flags).reduce((a, b) => Math.max(a, b), 0);
                  return (
                    <tr key={m.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => navigate(`/geradores/mapas/${m.id}`)}>
                      <td className={`${td} whitespace-nowrap font-medium text-navy-950`}>{MONTHS_FULL[m.mes - 1]} {m.ano}</td>
                      <td className={td}>
                        {m.provider.nome}
                        <div className="text-xs text-ink-500">{m.team.nome}</div>
                      </td>
                      <td className={td}><Badge tone={stateTone[m.state]}>{RECORD_STATE_LABELS[m.state]}</Badge></td>
                      <td className={`${td} text-right tabular-nums`}>{m.stats.medicoes.toLocaleString("pt-PT")}</td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatDecimal(m.stats.litros)}</td>
                      <td className={`${td} whitespace-nowrap text-right font-medium tabular-nums text-navy-950`}>{formatKz(m.stats.totalCent)}</td>
                      <td className={`${td} text-right tabular-nums`}>{flagged ? <span className="text-amber-700">{flagged}</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && options.data && <NewMapModal options={options.data} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/geradores/mapas/${id}`)} />}
    </>
  );
}

function NewMapModal({ options, onClose, onCreated }: { options: GeneratorOptions; onClose(): void; onCreated(id: string): void }) {
  const qc = useQueryClient();
  const now = new Date();
  const [f, setF] = useState({
    teamId: options.teams.length === 1 ? options.teams[0].id : "",
    providerId: options.providers.length === 1 ? options.providers[0].id : "",
    ano: now.getFullYear(),
    mes: now.getMonth() + 1,
  });
  const create = useMutation({
    mutationFn: () => apiPost<GeneratorMapRow>("/generators/maps", f),
    onSuccess: (m) => {
      qc.invalidateQueries(["generator-maps"]);
      onCreated(m.id);
    },
  });
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  return (
    <Modal
      title="Novo mapa mensal"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="map-form" disabled={create.isLoading}>Criar</Button>
        </>
      }
    >
      <form id="map-form" onSubmit={onSubmit} className="space-y-4">
        {options.teams.length > 1 && (
          <Field label="Equipa">
            <Select required value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
              <option value="">Seleccionar…</option>
              {options.teams.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Parceiro">
          <Select required value={f.providerId} onChange={(e) => setF({ ...f, providerId: e.target.value })}>
            <option value="">Seleccionar…</option>
            {options.providers.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Ano">
            <Select value={f.ano} onChange={(e) => setF({ ...f, ano: Number(e.target.value) })}>
              {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </Field>
          <Field label="Mês">
            <Select value={f.mes} onChange={(e) => setF({ ...f, mes: Number(e.target.value) })}>
              {MONTHS_FULL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
        </div>
        {create.error ? <Alert>{errorMessage(create.error)}</Alert> : null}
      </form>
    </Modal>
  );
}

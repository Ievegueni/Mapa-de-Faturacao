import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { generatorSchema, REGIOES, siteSchema } from "@cf/shared";
import { Alert, Button, Field, Input, Modal, Select, errorMessage } from "../../components/ui";
import { useDebounced } from "../../hooks/useDebounced";
import { api, apiPatch, apiPost } from "../../lib/api";
import type { GeneratorOptions, GeneratorRow, Paged, SiteRow } from "../../lib/types";
import { validate } from "../../lib/validate";

type Tri = "" | "true" | "false";
const toTri = (v: boolean | null | undefined): Tri => (v === null || v === undefined ? "" : v ? "true" : "false");
const fromTri = (v: Tri) => (v === "" ? null : v === "true");

function TriSelect({ label, value, onChange }: { label: string; value: Tri; onChange(v: Tri): void }) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value as Tri)}>
        <option value="">—</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </Select>
    </Field>
  );
}

export function SiteForm({ site, options, onClose }: { site: SiteRow | null; options: GeneratorOptions; onClose(): void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    teamId: site?.teamId || (options.teams.length === 1 ? options.teams[0].id : ""),
    nome: site?.nome || "",
    codigoPP: site?.codigoPP || "",
    codigoLocalizacao: site?.codigoLocalizacao || "",
    codigoCliente: site?.codigoCliente || "",
    regiao: site?.regiao || "",
    provincia: site?.provincia || "",
    nivel: site?.nivel || "",
    tipo: site?.tipo || "",
    subtipo: site?.subtipo || "",
    distanciaFacturacao: site?.distanciaFacturacao || "",
    tipoAcesso: site?.tipoAcesso || "",
    powerCube1000: toTri(site?.powerCube1000),
    pavimentadoInterior: toTri(site?.pavimentadoInterior),
    ligadoRede: toTri(site?.ligadoRede),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const save = useMutation({
    mutationFn: () => {
      const data = validate(siteSchema, {
        ...f,
        powerCube1000: fromTri(f.powerCube1000),
        pavimentadoInterior: fromTri(f.pavimentadoInterior),
        ligadoRede: fromTri(f.ligadoRede),
      });
      return site ? apiPatch(`/generators/sites/${site.id}`, data) : apiPost("/generators/sites", data);
    },
    onSuccess: () => {
      qc.invalidateQueries(["sites"]);
      qc.invalidateQueries(["generator-options"]);
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const text = (key: keyof typeof f, label: string, required = false) => (
    <Field label={label}>
      <Input required={required} value={f[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<typeof f>)} />
    </Field>
  );

  return (
    <Modal
      title={site ? "Editar site" : "Novo site"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="site-form" disabled={save.isLoading}>{save.isLoading ? "A guardar…" : "Guardar"}</Button>
        </>
      }
    >
      <form id="site-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        {options.teams.length > 1 && (
          <Field label="Equipa">
            <Select required value={f.teamId} onChange={(e) => set({ teamId: e.target.value })}>
              <option value="">Seleccionar…</option>
              {options.teams.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </Select>
          </Field>
        )}
        <div className="sm:col-span-2">{text("nome", "Nome do ponto de produção", true)}</div>
        {text("codigoPP", "Código P.P.")}
        {text("codigoLocalizacao", "Código de localização")}
        {text("codigoCliente", "Código de cliente")}
        <Field label="Região">
          <Select required value={f.regiao} onChange={(e) => set({ regiao: e.target.value })}>
            <option value="">Seleccionar…</option>
            {REGIOES.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Província">
          <Input required list="provincias" value={f.provincia} onChange={(e) => set({ provincia: e.target.value })} />
          <datalist id="provincias">{options.provincias.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        {text("nivel", "Nível")}
        {text("tipo", "Tipo")}
        {text("subtipo", "Subtipo")}
        {text("distanciaFacturacao", "Distância de facturação")}
        {text("tipoAcesso", "Tipo de acesso")}
        <TriSelect label="Power Cube 1000" value={f.powerCube1000} onChange={(v) => set({ powerCube1000: v })} />
        <TriSelect label="Pavimentado interior" value={f.pavimentadoInterior} onChange={(v) => set({ pavimentadoInterior: v })} />
        <TriSelect label="Ligado à rede" value={f.ligadoRede} onChange={(v) => set({ ligadoRede: v })} />
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
      </form>
    </Modal>
  );
}

/** Pesquisa de site (a lista completa tem ~1.160 sites). */
function SitePicker({ value, label, onChange }: { value: string; label: string; onChange(id: string, label: string): void }) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const q = useDebounced(term);
  const results = useQuery({
    queryKey: ["site-picker", q],
    queryFn: () => api<Paged<SiteRow>>(`/generators/sites?q=${encodeURIComponent(q)}`),
    enabled: open && q.length >= 2,
  });
  return (
    <div className="relative">
      <Input
        required={!value}
        placeholder={label || "Pesquisar site por nome ou código P.P."}
        value={open ? term : label}
        onFocus={() => { setOpen(true); setTerm(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setTerm(e.target.value)}
      />
      {open && q.length >= 2 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-ink-200 bg-white shadow-lg">
          {results.isLoading && <li className="px-3 py-2 text-sm text-ink-400">A pesquisar…</li>}
          {results.data?.items.length === 0 && <li className="px-3 py-2 text-sm text-ink-400">Sem resultados</li>}
          {results.data?.items.slice(0, 15).map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                onMouseDown={() => { onChange(s.id, `${s.nome}${s.codigoPP ? ` (${s.codigoPP})` : ""}`); setOpen(false); }}
              >
                <span className="font-medium text-navy-950">{s.nome}</span>
                <span className="ml-2 text-xs text-ink-500">P.P. {s.codigoPP || "—"} · {s.provincia}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GeneratorForm({ generator, options, onClose }: { generator: GeneratorRow | null; options: GeneratorOptions; onClose(): void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    siteId: generator?.siteId || "",
    siteLabel: generator ? `${generator.site.nome}${generator.site.codigoPP ? ` (${generator.site.codigoPP})` : ""}` : "",
    providerId: generator?.providerId || (options.providers.length === 1 ? options.providers[0].id : ""),
    numeroSerie: generator?.numeroSerie || "",
    numeroActivo: generator?.numeroActivo || "",
    potenciaKVA: generator?.potenciaKVA?.toString() || "",
    dataInstalacao: generator?.dataInstalacao || "",
    dataRemocao: generator?.dataRemocao || "",
    dataEntrada: generator?.dataEntrada || "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const save = useMutation({
    mutationFn: () => {
      const { siteLabel: _label, ...payload } = f;
      const data = validate(generatorSchema, payload);
      return generator ? apiPatch(`/generators/generators/${generator.id}`, data) : apiPost("/generators/generators", data);
    },
    onSuccess: () => {
      qc.invalidateQueries(["generators"]);
      qc.invalidateQueries(["sites"]);
      qc.invalidateQueries(["generator-options"]);
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <Modal
      title={generator ? "Editar gerador" : "Novo gerador"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="generator-form" disabled={save.isLoading}>{save.isLoading ? "A guardar…" : "Guardar"}</Button>
        </>
      }
    >
      <form id="generator-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Site" group>
            <SitePicker value={f.siteId} label={f.siteLabel} onChange={(siteId, siteLabel) => set({ siteId, siteLabel })} />
          </Field>
        </div>
        <Field label="Proprietário">
          <Select required value={f.providerId} onChange={(e) => set({ providerId: e.target.value })}>
            <option value="">Seleccionar…</option>
            {options.providers.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
        </Field>
        <Field label="Potência (kVA)">
          <Input inputMode="numeric" placeholder="—" value={f.potenciaKVA} onChange={(e) => set({ potenciaKVA: e.target.value })} />
        </Field>
        <Field label="Nº de série">
          <Input required value={f.numeroSerie} onChange={(e) => set({ numeroSerie: e.target.value })} />
        </Field>
        <Field label="Nº de activo">
          <Input value={f.numeroActivo} onChange={(e) => set({ numeroActivo: e.target.value })} />
        </Field>
        <Field label="Data de instalação">
          <Input type="date" value={f.dataInstalacao} onChange={(e) => set({ dataInstalacao: e.target.value })} />
        </Field>
        <Field label="Data de entrada">
          <Input type="date" value={f.dataEntrada} onChange={(e) => set({ dataEntrada: e.target.value })} />
        </Field>
        <Field label="Data de remoção" hint="Preencha quando o gerador sair do site (gera o aviso Gerador removido).">
          <Input type="date" value={f.dataRemocao} onChange={(e) => set({ dataRemocao: e.target.value })} />
        </Field>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
      </form>
    </Modal>
  );
}

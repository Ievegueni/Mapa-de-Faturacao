import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can, formatDecimal, formatKz, RECORD_STATE_LABELS } from "@cf/shared";
import { Alert, Badge, Button, Card, Input, Spinner, errorMessage } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { api, apiPost } from "../../lib/api";
import type { GeneratorFormContext, GeneratorMapDetail, MapGeneratorItem, MeasurementRow } from "../../lib/types";
import { stateTone } from "../billing-providers/invoiceRules";
import { daysInMonth, draftFrom, draftPayload, emptyDraft, MeasurementDraft } from "./liveCalc";
import MeasurementEditor from "./MeasurementEditor";

/** Formulário por site (CLAUDE.md §9.2): pesquisa, horas N−1 do mês anterior, cálculo em tempo real, Enter grava e avança. */
export default function FormTab({ map }: { map: GeneratorMapDetail }) {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gens = useQuery({ queryKey: ["map-generators", map.id], queryFn: () => api<MapGeneratorItem[]>(`/generators/maps/${map.id}/generators`) });

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    const all = gens.data || [];
    if (!t) return all;
    return all.filter((g) => g.site.nome.toLowerCase().includes(t) || (g.site.codigoPP || "").toLowerCase().includes(t) || g.numeroSerie.toLowerCase().includes(t));
  }, [gens.data, term]);

  useEffect(() => {
    if (!selected && filtered.length) setSelected(filtered[0].id);
  }, [filtered, selected]);

  const next = () => {
    const i = filtered.findIndex((g) => g.id === selected);
    if (i >= 0 && i + 1 < filtered.length) setSelected(filtered[i + 1].id);
  };

  if (gens.isLoading) return <Spinner />;
  if (gens.error) return <Alert>{errorMessage(gens.error)}</Alert>;
  const done = (gens.data || []).filter((g) => g.measurement).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card className="flex max-h-[70vh] flex-col overflow-hidden">
        <div className="border-b border-ink-100 p-3">
          <Input ref={searchRef} placeholder="Código P.P., nome ou nº de série" value={term} onChange={(e) => setTerm(e.target.value)} />
          <div className="mt-2 text-xs text-ink-500">{done.toLocaleString("pt-PT")} de {(gens.data || []).length.toLocaleString("pt-PT")} geradores com medição</div>
        </div>
        <ul className="flex-1 divide-y divide-ink-100 overflow-y-auto">
          {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-400">Nenhum gerador. Crie sites e geradores ou importe o Excel.</li>}
          {filtered.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => setSelected(g.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${selected === g.id ? "bg-brand-50" : "hover:bg-ink-50"}`}
              >
                <span className={`size-2 shrink-0 rounded-full ${g.measurement ? (g.measurement.flags.length ? "bg-amber-500" : "bg-emerald-500") : "bg-ink-200"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-navy-950">{g.site.nome}</span>
                  <span className="block truncate text-xs text-ink-500">{g.site.codigoPP || "—"} · {g.numeroSerie}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <div>
        {lastSaved && <div className="mb-3"><Alert kind="success">{lastSaved}</Alert></div>}
        {selected ? (
          <GeneratorForm
            key={selected}
            map={map}
            generatorId={selected}
            onSaved={(m) => {
              setLastSaved(`Gravado: ${m.site.nome} · ${m.generator.numeroSerie} · ${formatKz(m.totalCent)}`);
              next();
            }}
          />
        ) : (
          <Card className="p-6 text-sm text-ink-500">Escolha um gerador na lista.</Card>
        )}
      </div>
    </div>
  );
}

function GeneratorForm({ map, generatorId, onSaved }: { map: GeneratorMapDetail; generatorId: string; onSaved(m: MeasurementRow): void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const ctx = useQuery({
    queryKey: ["generator-form", map.id, generatorId],
    queryFn: () => api<GeneratorFormContext>(`/generators/maps/${map.id}/generators/${generatorId}`),
  });
  const [draft, setDraft] = useState<MeasurementDraft | null>(null);

  useEffect(() => {
    if (!ctx.data) return;
    if (ctx.data.measurement) setDraft(draftFrom(ctx.data.measurement));
    else setDraft({ ...emptyDraft(daysInMonth(map.ano, map.mes)), horasN1: ctx.data.horasNMesAnterior ?? "" });
  }, [ctx.data, map.ano, map.mes]);

  const save = useMutation({
    mutationFn: () => apiPost<MeasurementRow>(`/generators/maps/${map.id}/measurements`, { generatorId, ...draftPayload(draft!) }),
    onSuccess: (m) => {
      qc.invalidateQueries(["map-generators", map.id]);
      qc.invalidateQueries(["generator-form", map.id, generatorId]);
      qc.invalidateQueries(["measurements", map.id]);
      qc.invalidateQueries(["generator-map", map.id]);
      onSaved(m);
    },
  });

  if (ctx.isLoading || !draft) return <Spinner />;
  if (ctx.error) return <Alert>{errorMessage(ctx.error)}</Alert>;
  const c = ctx.data!;
  const m = c.measurement;
  const locked =
    !!m &&
    (m.state === "FECHADO" ||
      (!can(user!.permissions, "billing_generators", "validate") && (m.state !== "RASCUNHO" || m.createdById !== user!.id)));

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-navy-950">{c.site.nome}</h3>
          <p className="text-sm text-ink-500">
            P.P. {c.site.codigoPP || "—"} · {c.site.provincia} · {c.generator.numeroSerie} · {c.generator.potenciaKVA ? `${c.generator.potenciaKVA} kVA` : "potência —"}
            {c.site.subtipo ? ` · ${c.site.subtipo}` : ""}{c.site.distanciaFacturacao ? ` · ${c.site.distanciaFacturacao}` : ""}
          </p>
        </div>
        {m ? <Badge tone={stateTone[m.state]}>{RECORD_STATE_LABELS[m.state]}</Badge> : <Badge>Sem medição</Badge>}
      </div>
      {locked && <Alert kind="info">Esta medição já não pode ser alterada por si.</Alert>}
      <MeasurementEditor
        map={map}
        site={c.site}
        generator={c.generator}
        draft={draft}
        onChange={setDraft}
        mediaLitros3m={c.mediaLitros3m}
        disabled={locked}
        onEnter={() => !locked && save.mutate()}
        hint={
          <p className="text-xs text-ink-500">
            Horas (N-1) do mês anterior: {c.horasNMesAnterior ? formatDecimal(c.horasNMesAnterior) : "sem registo"}.
            {c.mediaLitros3m ? ` Média de litros (3 meses): ${formatDecimal(c.mediaLitros3m)}.` : ""} Enter grava e passa ao gerador seguinte.
          </p>
        }
      />
      {save.error ? <Alert>{errorMessage(save.error)}</Alert> : null}
      {!locked && (
        <div className="flex justify-end">
          <Button disabled={save.isLoading} onClick={() => save.mutate()}>{save.isLoading ? "A guardar…" : "Gravar e seguinte"}</Button>
        </div>
      )}
    </Card>
  );
}

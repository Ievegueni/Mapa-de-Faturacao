import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDecimal, formatKz, GENERATOR_FLAG_LABELS, GeneratorFlag } from "@cf/shared";
import { Alert, Button, Card, Select, Spinner, errorMessage, th } from "../../components/ui";
import { apiPost, apiUpload } from "../../lib/api";
import type { GeneratorMapDetail, ImportPreview } from "../../lib/types";
import { FlagChips } from "./flags";

interface ImportResult {
  sitesCriados: number;
  sitesActualizados: number;
  geradoresCriados: number;
  geradoresActualizados: number;
  medicoesCriadas: number;
  medicoesActualizadas: number;
  litrosImportados: string;
  litrosFicheiro: string;
  erros: { line: number; message: string }[];
  duracaoMs: number;
}

const td = "px-3 py-2 text-sm text-ink-700";

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-ink-100">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-navy-950"}`}>{value}</div>
    </div>
  );
}

/** Importação em dois passos: pré-visualização (nada é gravado) → confirmação. */
export default function ImportTab({ map, onDone }: { map: GeneratorMapDetail; onDone(): void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const analyse = useMutation({
    mutationFn: (opts: { file: File; sheet?: string }) => {
      const form = new FormData();
      if (opts.sheet) form.append("sheet", opts.sheet);
      form.append("file", opts.file);
      return apiUpload<ImportPreview>(`/generators/maps/${map.id}/import/preview`, form);
    },
    onSuccess: (p) => {
      setPreview(p);
      setSheet(p.folha);
      setResult(null);
    },
  });

  const confirm = useMutation({
    mutationFn: () => apiPost<ImportResult>(`/generators/maps/${map.id}/import/confirm`, { token: preview!.token }),
    onSuccess: (r) => {
      setResult(r);
      setPreview(null);
      qc.invalidateQueries(["measurements", map.id]);
      qc.invalidateQueries(["generator-map", map.id]);
      qc.invalidateQueries(["map-generators", map.id]);
      qc.invalidateQueries(["generator-maps"]);
      qc.invalidateQueries(["sites"]);
    },
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div>
          <h3 className="font-semibold text-navy-950">Auto de Medição (.xlsx, até 20 MB)</h3>
          <p className="text-xs text-ink-500">
            As colunas são lidas pelo nome (cabeçalho com "Nome Ponto Produção"); as fórmulas e os preços do Excel são ignorados e os cálculos são refeitos com os preços da plataforma. Nada é gravado antes de confirmar.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); setSheet(""); }}
            className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-navy-950 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-800 sm:w-auto"
            aria-label="Ficheiro Excel"
          />
          {preview && preview.folhas.length > 1 && (
            <Select value={sheet} onChange={(e) => { setSheet(e.target.value); analyse.mutate({ file: file!, sheet: e.target.value }); }} className="sm:w-48" aria-label="Folha">
              {preview.folhas.map((s) => <option key={s} value={s}>Folha: {s}</option>)}
            </Select>
          )}
          <Button disabled={!file || analyse.isLoading} onClick={() => file && analyse.mutate({ file, sheet: sheet || undefined })}>
            {analyse.isLoading ? "A analisar…" : "Analisar ficheiro"}
          </Button>
        </div>
        {analyse.error ? <Alert>{errorMessage(analyse.error)}</Alert> : null}
      </Card>

      {analyse.isLoading && <Spinner label="A ler o ficheiro…" />}

      {result && (
        <Alert kind="success">
          Importação concluída em {(result.duracaoMs / 1000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} s: {result.medicoesCriadas} medições novas, {result.medicoesActualizadas} actualizadas,{" "}
          {result.sitesCriados} sites e {result.geradoresCriados} geradores criados. Litros importados: {formatDecimal(result.litrosImportados)} de {formatDecimal(result.litrosFicheiro)} no ficheiro.
          {result.erros.length > 0 && ` ${result.erros.length} linhas com erro não foram importadas.`}{" "}
          <button className="font-semibold underline" onClick={onDone}>Ver medições</button>
        </Alert>
      )}

      {preview && (
        <>
          {preview.semPrecos && <Alert>Não há tabela de preços em vigor para este provider e mês: os valores ficam a 0 até definir preços e recalcular.</Alert>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Linhas lidas" value={preview.linhasLidas.toLocaleString("pt-PT")} />
            <Stat label="Para importar" value={preview.linhasValidas.toLocaleString("pt-PT")} />
            <Stat label="Com erro" value={preview.erros.length} tone={preview.erros.length ? "bad" : undefined} />
            <Stat label="Avisos" value={preview.avisos.length} tone={preview.avisos.length ? "warn" : undefined} />
            <Stat label="Litros no ficheiro" value={formatDecimal(preview.litrosFicheiro)} />
            <Stat label="Litros a importar" value={formatDecimal(preview.litrosValidos)} tone={preview.litrosValidos !== preview.litrosFicheiro ? "warn" : undefined} />
            <Stat label="Sites novos / act." value={`${preview.sitesNovos} / ${preview.sitesActualizados}`} />
            <Stat label="Geradores novos / act." value={`${preview.geradoresNovos} / ${preview.geradoresActualizados}`} />
          </div>
          <Card className="grid gap-4 p-5 md:grid-cols-2">
            <div className="space-y-1 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Totais calculados</div>
              <div className="flex justify-between"><span className="text-ink-500">Combustível</span><span className="tabular-nums">{formatKz(preview.totais.combustivelCent)}</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Serviço de abastecimento</span><span className="tabular-nums">{formatKz(preview.totais.servAbastCent)}</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Aluguer</span><span className="tabular-nums">{formatKz(preview.totais.aluguerCent)}</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Desconto de rede</span><span className="tabular-nums">− {formatKz(preview.totais.descontoRedeCent)}</span></div>
              <div className="flex justify-between border-t border-ink-100 pt-1 font-semibold text-navy-950"><span>Total</span><span className="tabular-nums">{formatKz(preview.totais.totalCent)}</span></div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Avisos nas medições</div>
              {Object.keys(preview.flags).length === 0 && <div className="text-ink-400">Nenhum.</div>}
              {Object.entries(preview.flags).map(([f, n]) => (
                <div key={f} className="flex justify-between"><span className="text-ink-500">{GENERATOR_FLAG_LABELS[f as GeneratorFlag] || f}</span><span className="tabular-nums">{n.toLocaleString("pt-PT")}</span></div>
              ))}
              <div className="pt-1 text-xs text-ink-400">Ficheiro {preview.ficheiro} · folha {preview.folha} · cabeçalho na linha {preview.linhaCabecalho}</div>
            </div>
          </Card>

          {(preview.erros.length > 0 || preview.avisos.length > 0) && (
            <Card className="max-h-80 overflow-y-auto">
              <table className="min-w-full divide-y divide-ink-100">
                <thead className="sticky top-0 bg-ink-50">
                  <tr><th className={th}>Linha</th><th className={th}>Tipo</th><th className={th}>Descrição</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {preview.erros.map((e, i) => (
                    <tr key={`e${i}`}><td className={`${td} tabular-nums`}>{e.line}</td><td className={td}><span className="font-medium text-red-700">Erro · não importada</span></td><td className={td}>{e.message}</td></tr>
                  ))}
                  {preview.avisos.map((e, i) => (
                    <tr key={`a${i}`}><td className={`${td} tabular-nums`}>{e.line}</td><td className={td}><span className="font-medium text-amber-700">Aviso</span></td><td className={td}>{e.message}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <Card className="overflow-x-auto">
            <div className="border-b border-ink-100 px-4 py-2 text-xs text-ink-500">Primeiras {preview.amostra.length} linhas a importar</div>
            <table className="min-w-full divide-y divide-ink-100">
              <thead className="bg-ink-50/60">
                <tr>
                  <th className={th}>Linha</th><th className={th}>Site</th><th className={th}>Nº série</th><th className={`${th} text-right`}>Dias</th>
                  <th className={`${th} text-right`}>Litros</th><th className={`${th} text-right`}>H. rede</th><th className={`${th} text-right`}>Desc.</th><th className={`${th} text-right`}>Total</th><th className={th}>Avisos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {preview.amostra.map((r) => (
                  <tr key={r.linha}>
                    <td className={`${td} tabular-nums`}>{r.linha}</td>
                    <td className={td}>{r.site}<div className="text-xs text-ink-500">{r.codigoPP || "—"}</div></td>
                    <td className={td}>{r.numeroSerie}{r.novo && <span className="ml-1 text-xs text-brand-600">novo</span>}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.dias}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatDecimal(r.litros)}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.horasRede ?? "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.descontoPercent === null ? "—" : `${formatDecimal(r.descontoPercent, 0)}%`}</td>
                    <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{formatKz(r.totalCent)}</td>
                    <td className={td}><FlagChips flags={r.flags} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="sticky bottom-0 flex flex-col gap-2 rounded-xl bg-white p-4 shadow-lg ring-1 ring-ink-200 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-ink-600">
              Vai gravar {preview.linhasValidas.toLocaleString("pt-PT")} medições em rascunho{preview.erros.length ? ` (${preview.erros.length} linhas com erro ficam de fora)` : ""}. A pré-visualização expira em 15 minutos.
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancelar</Button>
              <Button disabled={confirm.isLoading || preview.linhasValidas === 0} onClick={() => confirm.mutate()}>{confirm.isLoading ? "A importar…" : "Confirmar importação"}</Button>
            </div>
          </div>
          {confirm.error ? <Alert>{errorMessage(confirm.error)}</Alert> : null}
        </>
      )}
    </div>
  );
}

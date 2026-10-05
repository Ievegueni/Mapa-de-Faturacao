import { Readable } from "stream";
import ExcelJS from "exceljs";
import { cleanText, normalizeRegiao, parseExcelDate, parsePotencia, parseSimNao, toHundredths, hundredthsToString } from "@cf/shared";

/**
 * Leitura do Auto de Medição (CLAUDE.md §9.1).
 * - Usa o leitor em streaming do exceljs: o leitor normal falha em ficheiros reais com filtros por cor em tabelas.
 * - Cabeçalho detectado pela coluna "Nome Ponto Produção"; mapeamento pelo NOME da coluna, nunca pela posição.
 * - As fórmulas do Excel são ignoradas (só se lêem colunas de entrada); os cálculos são refeitos no servidor.
 */

/** Nome de coluna normalizado: sem sufixo ".420", sem acentos, só letras e dígitos. */
export function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.\d+$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Campo → nomes aceites (já normalizados). */
const COLUMNS = {
  nome: ["nomepontoproducao"],
  dataInstalacao: ["datainstalacaogerador", "datainstalacao"],
  dataRemocao: ["dataremocaogerador", "dataremocao"],
  dataEntrada: ["dataentrada"],
  ligadoRede: ["ligadoarede", "ligadorede"],
  codigoPP: ["codigopp", "codpp"],
  codigoLocalizacao: ["codigolocalizacao", "codlocalizacao"],
  codigoCliente: ["codcliente", "codigocliente"],
  regiao: ["regiao"],
  provincia: ["provincia"],
  nivel: ["nivel"],
  tipo: ["tipo"],
  powerCube1000: ["powercube1000"],
  subtipo: ["subtipo"],
  distanciaFacturacao: ["distanciafacturacao", "distanciafaturacao"],
  tipoAcesso: ["tipodeacesso", "tipoacesso"],
  pavimentadoInterior: ["pavimentadointerior"],
  numeroActivo: ["nactivo", "numeroactivo", "noactivo"],
  numeroSerie: ["nseriegerador", "numeroseriegerador", "noseriegerador", "nserie"],
  potencia: ["potencia", "potenciakva"],
  dias: ["dias"],
  proprietario: ["proprietario"],
  horasN1: ["horasgeradorn1"],
  horasN: ["horasgeradorn"],
  litros: ["litrosabastecidos"],
  servExtras: ["servextras"],
  penExcessoHoras: ["penalizacaoexcessohoras"],
  penSLA: ["penalizacaosla"],
  penNivelCombust: ["penalizacaonivelcombust", "penalizacaonivelcombustivel"],
  penAvaria: ["penalizacaoporavaria", "penalizacaoavaria"],
} as const;

type Field = keyof typeof COLUMNS;
const REQUIRED: Field[] = ["nome", "numeroSerie", "regiao", "provincia", "dias"];
const HEADER_MARK = "nomepontoproducao";

export interface ParsedRow {
  line: number;
  site: {
    nome: string;
    codigoPP: string | null;
    codigoLocalizacao: string | null;
    codigoCliente: string | null;
    regiao: string;
    provincia: string;
    nivel: string | null;
    tipo: string | null;
    powerCube1000: boolean | null;
    subtipo: string | null;
    distanciaFacturacao: string | null;
    tipoAcesso: string | null;
    pavimentadoInterior: boolean | null;
    ligadoRede: boolean | null;
  };
  generator: {
    numeroSerie: string;
    numeroActivo: string | null;
    potenciaKVA: number | null;
    dataInstalacao: string | null;
    dataRemocao: string | null;
    dataEntrada: string | null;
    proprietario: string | null;
  };
  measurement: {
    dias: number;
    horasN1: string | null;
    horasN: string | null;
    litros: string | null;
    servExtrasCent: string | null;
    penExcessoHorasCent: string | null;
    penSLACent: string | null;
    penNivelCombustCent: string | null;
    penAvariaCent: string | null;
  };
  errors: string[];
}

export interface ParseResult {
  /** Folhas que têm o cabeçalho do Auto de Medição. */
  sheets: string[];
  sheet: string | null;
  headerLine: number | null;
  missingColumns: string[];
  rows: ParsedRow[];
}

/** Valor da célula: resultado em cache para fórmulas, texto para rich text. */
function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return o.result ?? null;
    if ("formula" in o || "sharedFormula" in o) return null;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return o.text;
    if ("error" in o) return null;
  }
  return v;
}

const decimalOrError = (v: unknown, label: string, errors: string[]): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const h = toHundredths(typeof v === "number" ? v : String(v));
  if (h === null) {
    errors.push(`${label} inválido: "${String(v)}"`);
    return null;
  }
  return hundredthsToString(h);
};

/** Valor em Kz do Excel → cêntimos. Vazio ou 0 → null (fica em branco). */
const centsOrError = (v: unknown, label: string, errors: string[]): string | null => {
  const d = decimalOrError(v, label, errors);
  if (d === null) return null;
  const h = toHundredths(d)!;
  if (h < BigInt(0)) {
    errors.push(`${label} negativo`);
    return null;
  }
  return h === BigInt(0) ? null : h.toString();
};

export async function parseAutoMedicao(buffer: Buffer, opts: { sheet?: string } = {}): Promise<ParseResult> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    sharedStrings: "cache",
    worksheets: "emit",
    styles: "ignore",
    hyperlinks: "ignore",
    entries: "ignore",
  });

  const sheets: string[] = [];
  let chosen: ParseResult | null = null;

  for await (const ws of reader as unknown as AsyncIterable<AsyncIterable<ExcelJS.Row> & { name: string }>) {
    const name = ws.name;
    let colOf: Partial<Record<Field, number>> | null = null;
    let headerLine: number | null = null;
    const rows: ParsedRow[] = [];
    const take = !chosen && (!opts.sheet || opts.sheet === name);

    for await (const row of ws) {
      const values = row.values as unknown[];
      if (!colOf) {
        if (row.number > 40) continue;
        const norm = values.map((v) => normalizeHeader(cellValue(v)));
        const idx = norm.indexOf(HEADER_MARK);
        if (idx < 0) continue;
        colOf = {};
        for (const [field, aliases] of Object.entries(COLUMNS) as [Field, readonly string[]][]) {
          const i = norm.findIndex((h) => aliases.includes(h));
          if (i > 0) colOf[field] = i;
        }
        headerLine = row.number;
        sheets.push(name);
        continue;
      }
      if (!take) continue;
      const get = (f: Field) => (colOf![f] ? cellValue(values[colOf![f]!]) : null);
      const nome = cleanText(get("nome"));
      const serie = cleanText(get("numeroSerie"));
      if (!nome && !serie) continue; // linha vazia ou de totais

      const errors: string[] = [];
      if (!nome) errors.push("Nome do ponto de produção em falta");
      if (!serie) errors.push("Nº de série em falta");
      const regiaoRaw = cleanText(get("regiao"));
      const regiao = normalizeRegiao(regiaoRaw);
      if (!regiao) errors.push(regiaoRaw ? `Região inválida: "${regiaoRaw}"` : "Região em falta");
      const provincia = cleanText(get("provincia"));
      if (!provincia) errors.push("Província em falta");

      const diasRaw = get("dias");
      const diasNum = typeof diasRaw === "number" ? diasRaw : Number(cleanText(diasRaw)?.replace(",", "."));
      const dias = Number.isFinite(diasNum) && diasNum >= 0 ? Math.round(diasNum) : 0;
      const potRaw = get("potencia");
      const potenciaKVA = parsePotencia(potRaw);

      rows.push({
        line: row.number,
        site: {
          nome: nome ?? "",
          codigoPP: cleanText(get("codigoPP")),
          codigoLocalizacao: cleanText(get("codigoLocalizacao")),
          codigoCliente: cleanText(get("codigoCliente")),
          regiao: regiao ?? "",
          provincia: provincia ?? "",
          nivel: cleanText(get("nivel")),
          tipo: cleanText(get("tipo")),
          powerCube1000: parseSimNao(get("powerCube1000")),
          subtipo: cleanText(get("subtipo")),
          distanciaFacturacao: cleanText(get("distanciaFacturacao")),
          tipoAcesso: cleanText(get("tipoAcesso")),
          pavimentadoInterior: parseSimNao(get("pavimentadoInterior")),
          ligadoRede: parseSimNao(get("ligadoRede")),
        },
        generator: {
          numeroSerie: serie ?? "",
          numeroActivo: cleanText(get("numeroActivo")),
          potenciaKVA,
          dataInstalacao: parseExcelDate(get("dataInstalacao")),
          dataRemocao: parseExcelDate(get("dataRemocao")),
          dataEntrada: parseExcelDate(get("dataEntrada")),
          proprietario: cleanText(get("proprietario")),
        },
        measurement: {
          dias,
          horasN1: decimalOrError(get("horasN1"), "Horas (N-1)", errors),
          horasN: decimalOrError(get("horasN"), "Horas (N)", errors),
          litros: decimalOrError(get("litros"), "Litros", errors),
          servExtrasCent: centsOrError(get("servExtras"), "Serviços extras", errors),
          penExcessoHorasCent: centsOrError(get("penExcessoHoras"), "Penalização excesso de horas", errors),
          penSLACent: centsOrError(get("penSLA"), "Penalização SLA", errors),
          penNivelCombustCent: centsOrError(get("penNivelCombust"), "Penalização nível de combustível", errors),
          penAvariaCent: centsOrError(get("penAvaria"), "Penalização por avaria", errors),
        },
        errors,
      });
    }

    if (take && colOf) {
      const missingColumns = REQUIRED.filter((f) => !colOf![f]).map((f) => f);
      chosen = { sheets: [], sheet: name, headerLine, missingColumns, rows };
    }
  }

  if (!chosen) return { sheets, sheet: null, headerLine: null, missingColumns: [], rows: [] };
  return { ...chosen, sheets };
}

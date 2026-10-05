/** Relatórios (CLAUDE.md §11): catálogo de modelos e formato comum (pré-visualização, PDF e Excel). */

export type ReportTipo = "PROVIDERS" | "GERADORES";

export type ReportModelo =
  | "resumo_anual"
  | "por_provider"
  | "pagamentos_divida"
  | "auto_medicao"
  | "resumo_mes"
  | "validacoes_anual"
  | "penalizacoes"
  | "consumo_regiao";

export type ReportFilter = "ano" | "mes" | "equipa" | "provider" | "regiao" | "provincia";

export interface ReportModelDef {
  tipo: ReportTipo;
  modelo: ReportModelo;
  nome: string;
  descricao: string;
  filtros: ReportFilter[];
  /** Filtros que têm de estar preenchidos. */
  obrigatorios: ReportFilter[];
  /** Folha A4 ao alto ou ao baixo no PDF. */
  orientacao: "portrait" | "landscape";
}

export const REPORT_MODELS: ReportModelDef[] = [
  { tipo: "PROVIDERS", modelo: "resumo_anual", nome: "Resumo anual", descricao: "Facturado por mês e parceiro, orçamento, dívida, remanescente e % de execução.", filtros: ["ano", "equipa"], obrigatorios: ["ano"], orientacao: "landscape" },
  { tipo: "PROVIDERS", modelo: "por_provider", nome: "Por parceiro", descricao: "Facturas do ano de um parceiro, com pagamentos e dívida.", filtros: ["ano", "equipa", "provider"], obrigatorios: ["ano", "provider"], orientacao: "landscape" },
  { tipo: "PROVIDERS", modelo: "pagamentos_divida", nome: "Pagamentos / Dívida", descricao: "Facturas com dívida e resumo de pagamentos por parceiro.", filtros: ["ano", "equipa", "provider"], obrigatorios: ["ano"], orientacao: "landscape" },
  { tipo: "GERADORES", modelo: "auto_medicao", nome: "Auto de Medição mensal", descricao: "Todas as medições do mês, com cálculos e avisos.", filtros: ["ano", "mes", "equipa", "provider", "regiao", "provincia"], obrigatorios: ["ano", "mes"], orientacao: "landscape" },
  { tipo: "GERADORES", modelo: "resumo_mes", nome: "Resumo do mês (com IVA)", descricao: "Aluguer, combustível e serviço por zona: facturado, validado, diferença, IVA e total + IVA.", filtros: ["ano", "mes", "equipa", "provider"], obrigatorios: ["ano", "mes", "provider"], orientacao: "portrait" },
  { tipo: "GERADORES", modelo: "validacoes_anual", nome: "Mapa Resumo de Validações", descricao: "Vista anual Jan–Dez do parceiro: penalizações, parque, valores, variações e targets.", filtros: ["ano", "equipa", "provider"], obrigatorios: ["ano", "provider"], orientacao: "landscape" },
  { tipo: "GERADORES", modelo: "penalizacoes", nome: "Penalizações", descricao: "Medições com penalizações, por tipo.", filtros: ["ano", "mes", "equipa", "provider", "regiao", "provincia"], obrigatorios: ["ano"], orientacao: "landscape" },
  { tipo: "GERADORES", modelo: "consumo_regiao", nome: "Consumo por região", descricao: "Litros e valores de abastecimento por região e província.", filtros: ["ano", "mes", "equipa", "provider", "regiao"], obrigatorios: ["ano"], orientacao: "portrait" },
];

export type ReportColumnType = "texto" | "kz" | "int" | "decimal" | "pct" | "data";

export interface ReportColumn {
  key: string;
  label: string;
  tipo: ReportColumnType;
  /** Soma na linha de totais. */
  soma?: boolean;
}

/** Valores: kz em cêntimos (string), decimal como string "1234.50", data "aaaa-mm-dd". */
export type ReportCell = string | number | null;

export interface ReportSection {
  titulo: string;
  colunas: ReportColumn[];
  linhas: Record<string, ReportCell>[];
  /** Linha de totais (já calculada); no Excel é escrita com fórmulas SUM. */
  totais?: Record<string, ReportCell>;
  /** Linhas a destacar (índices), ex.: subtotais. */
  destaque?: number[];
  /** Cada linha traz o seu tipo em `_tipo` (aplica-se às colunas numéricas), ex.: Mapa Resumo de Validações. */
  tipoPorLinha?: boolean;
}

/** Tipo efectivo de uma célula (respeita `tipoPorLinha`). */
export function cellType(section: ReportSection, col: ReportColumn, row: Record<string, ReportCell>): ReportColumnType {
  if (section.tipoPorLinha && col.tipo !== "texto" && typeof row._tipo === "string") return row._tipo as ReportColumnType;
  return col.tipo;
}

export interface ReportChart {
  id: string;
  titulo: string;
  tipo: "barras" | "barras_empilhadas" | "linhas";
  formato: "kz" | "int" | "decimal";
  categorias: string[];
  series: { nome: string; valores: (number | null)[] }[];
  horizontal?: boolean;
}

export interface ReportData {
  tipo: ReportTipo;
  modelo: ReportModelo;
  titulo: string;
  periodo: string;
  filtros: Record<string, string>;
  orientacao: "portrait" | "landscape";
  secoes: ReportSection[];
  graficos: ReportChart[];
  avisos: string[];
}

export function reportModel(tipo: string, modelo: string): ReportModelDef | undefined {
  return REPORT_MODELS.find((m) => m.tipo === tipo && m.modelo === modelo);
}

/** Soma de uma coluna (kz/int em BigInt; decimal em centésimas). */
export function sumColumn(linhas: Record<string, ReportCell>[], col: ReportColumn): ReportCell {
  if (col.tipo === "kz" || col.tipo === "int") {
    let s = BigInt(0);
    for (const l of linhas) if (l[col.key] !== null && l[col.key] !== undefined && l[col.key] !== "") s += BigInt(l[col.key] as string);
    return col.tipo === "int" ? Number(s) : s.toString();
  }
  if (col.tipo === "decimal") {
    let s = 0;
    for (const l of linhas) if (l[col.key] !== null && l[col.key] !== undefined) s += Math.round(Number(l[col.key]) * 100);
    return (s / 100).toFixed(2);
  }
  return null;
}

export function withTotals(section: Omit<ReportSection, "totais">, label = "Total"): ReportSection {
  const totais: Record<string, ReportCell> = {};
  section.colunas.forEach((c, i) => {
    if (c.soma) totais[c.key] = sumColumn(section.linhas, c);
    else if (i === 0) totais[c.key] = label;
  });
  return { ...section, totais };
}

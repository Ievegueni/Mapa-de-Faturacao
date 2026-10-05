/** Normalização de valores vindos do Excel ou de formulários (CLAUDE.md §9.1). */

export const REGIOES = ["Norte", "Centro", "Sul", "Leste"] as const;
export type Regiao = (typeof REGIOES)[number];

/** Remove espaços no início/fim e espaços repetidos; vazio → null. */
export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** SIM/NÃO (e variantes) → booleano; outro valor → null. */
export function parseSimNao(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = cleanText(v);
  if (!s) return null;
  const k = stripAccents(s).toUpperCase();
  if (["SIM", "S", "YES", "Y", "TRUE", "1", "X"].includes(k)) return true;
  if (["NAO", "N", "NO", "FALSE", "0"].includes(k)) return false;
  return null;
}

/** Potência em texto ("20 kVA", "20KVA", "20,0", 20) → inteiro em kVA; inválida → null. */
export function parsePotencia(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = cleanText(v);
  if (!s) return null;
  const m = s.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  return n > 0 ? n : null;
}

/** Região normalizada (Norte|Centro|Sul|Leste), sem acentos nem maiúsculas a contar; outra → null. */
export function normalizeRegiao(v: unknown): Regiao | null {
  const s = cleanText(v);
  if (!s) return null;
  const k = stripAccents(s).toLowerCase();
  return REGIOES.find((r) => r.toLowerCase() === k) ?? null;
}

/** Data do Excel (Date, número de série ou texto dd/mm/aaaa | aaaa-mm-dd) → "aaaa-mm-dd"; inválida → null. */
export function parseExcelDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  let d: Date | null = null;
  if (v instanceof Date) d = v;
  else if (typeof v === "number") d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
  else {
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

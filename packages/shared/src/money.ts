import type { Cents } from "./format";

/**
 * Converte o que o utilizador escreve ("2.950.000,00", "420", "48,5", "1234.56") em cêntimos (string).
 * Vazio → null. Inválido → undefined.
 */
export function parseKzInput(input: string | null | undefined): string | null | undefined {
  if (input === null || input === undefined) return null;
  let s = input.replace(/\s|Kz|AOA/gi, "");
  if (s === "" || s === "—") return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let decPart = "";
  if (lastComma >= 0) {
    // Vírgula decimal (pt-AO): os pontos são separadores de milhares.
    intPart = s.slice(0, lastComma).replace(/\./g, "");
    decPart = s.slice(lastComma + 1);
  } else if (lastDot >= 0 && s.length - lastDot - 1 !== 3) {
    // Ponto decimal (ex.: 1234.56) quando não tem 3 casas depois.
    intPart = s.slice(0, lastDot).replace(/\./g, "");
    decPart = s.slice(lastDot + 1);
  } else {
    intPart = s.replace(/\./g, "");
  }
  if (intPart === "") intPart = "0";
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return undefined;

  const cents = (BigInt(intPart) * BigInt(100) + BigInt(decPart.padEnd(2, "0") || "0")).toString();
  return negative && cents !== "0" ? `-${cents}` : cents;
}

/** Cêntimos → texto editável ("2.950.000,00"); vazio → "". */
export function centsToInput(value: Cents | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const cents = BigInt(value);
  const negative = cents < BigInt(0);
  const abs = negative ? -cents : cents;
  const units = (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${units},${(abs % BigInt(100)).toString().padStart(2, "0")}`;
}

/** "14" | "14,5" | "14.5" → "14.5"; vazio → null; inválido → undefined. */
export function parsePercentInput(input: string | null | undefined): string | null | undefined {
  if (input === null || input === undefined) return null;
  const s = input.replace(/\s|%/g, "").replace(",", ".");
  if (s === "" || s === "—") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return String(Number(s));
}

/** Percentagem para mostrar: "14%" / "12,5%"; vazio → "—". */
export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `${n.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}%`;
}

export const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const MONTHS_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

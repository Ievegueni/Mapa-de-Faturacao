/** Valor monetário em cêntimos de AOA (a API serializa BigInt como string). */
export type Cents = bigint | number | string;

const EMPTY = "—";

/** Formata cêntimos como `1.234.567,89 Kz`. Vazio → "—". */
export function formatKz(value: Cents | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const cents = BigInt(value);
  const negative = cents < BigInt(0);
  const abs = negative ? -cents : cents;
  const units = (abs / BigInt(100)).toString();
  const decimals = (abs % BigInt(100)).toString().padStart(2, "0");
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${decimals} Kz`;
}

/** Formata uma data como `dd/mm/aaaa` (UTC). Vazio ou inválido → "—". */
export function formatDate(value: Date | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Decimal ("509812.49", 509812.49, Decimal) → "509.812,49"; vazio → "—". `digits` = casas decimais mostradas. */
export function formatDecimal(value: { toString(): string } | number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const n = typeof value === "number" ? value : Number(value.toString());
  if (!Number.isFinite(n)) return EMPTY;
  const [int, frac] = Math.abs(n).toFixed(digits).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

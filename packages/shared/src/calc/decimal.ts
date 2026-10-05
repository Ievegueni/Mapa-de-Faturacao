/**
 * Decimais com 2 casas (litros, horas, percentagens) em centésimas inteiras, sem erros de vírgula flutuante.
 * Aceita number, string ("1234.5", "1234,5") ou Prisma Decimal (via toString).
 */
export type DecimalLike = number | string | { toString(): string } | null | undefined;

/** Valor → centésimas (bigint), com arredondamento meio-para-cima. Vazio ou inválido → null. */
export function toHundredths(value: DecimalLike): bigint | null {
  if (value === null || value === undefined) return null;
  let s = (typeof value === "number" ? value.toFixed(6) : value.toString()).trim().replace(",", ".");
  if (s === "") return null;
  const negative = s.startsWith("-");
  if (negative || s.startsWith("+")) s = s.slice(1);
  if (!/^\d*(\.\d*)?$/.test(s) || s === "." ) return null;
  const [int = "0", frac = ""] = s.split(".");
  const digits = (frac + "000").slice(0, 3);
  let h = BigInt(int || "0") * BigInt(100) + BigInt(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) h += BigInt(1);
  return negative ? -h : h;
}

/** Divisão inteira com arredondamento meio-para-cima (afastado de zero). */
export function divRound(n: bigint, d: bigint): bigint {
  const neg = n < BigInt(0) !== d < BigInt(0);
  const an = n < BigInt(0) ? -n : n;
  const ad = d < BigInt(0) ? -d : d;
  const q = (an * BigInt(2) + ad) / (ad * BigInt(2));
  return neg ? -q : q;
}

/** Divisão inteira com arredondamento para baixo (floor), também para negativos. */
export function divFloor(n: bigint, d: bigint): bigint {
  const q = n / d;
  return (n % d !== BigInt(0)) && ((n < BigInt(0)) !== (d < BigInt(0))) ? q - BigInt(1) : q;
}

/** Centésimas → string decimal com 2 casas ("1234.50"). */
export function hundredthsToString(h: bigint): string {
  const neg = h < BigInt(0);
  const a = neg ? -h : h;
  return `${neg ? "-" : ""}${a / BigInt(100)}.${(a % BigInt(100)).toString().padStart(2, "0")}`;
}

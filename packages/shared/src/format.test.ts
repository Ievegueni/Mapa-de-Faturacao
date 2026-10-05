import { describe, expect, it } from "vitest";
import { formatDate, formatDecimal, formatKz } from "./format";

describe("formatKz", () => {
  it("formata cêntimos com separadores de Angola", () => {
    expect(formatKz(BigInt(123456789))).toBe("1.234.567,89 Kz");
    expect(formatKz("66000000")).toBe("660.000,00 Kz");
    expect(formatKz(58854942)).toBe("588.549,42 Kz");
    expect(formatKz(5)).toBe("0,05 Kz");
    expect(formatKz(-150)).toBe("-1,50 Kz");
  });

  it("mostra — para valores vazios", () => {
    expect(formatKz(null)).toBe("—");
    expect(formatKz(undefined)).toBe("—");
    expect(formatKz("")).toBe("—");
  });
});

describe("formatDate", () => {
  it("formata dd/mm/aaaa", () => {
    expect(formatDate("2026-08-05T00:00:00Z")).toBe("05/08/2026");
    expect(formatDate(new Date(Date.UTC(2026, 11, 31)))).toBe("31/12/2026");
  });

  it("mostra — para vazio ou inválido", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("abc")).toBe("—");
  });
});

describe("formatDecimal", () => {
  it("formata litros e horas", () => {
    expect(formatDecimal("509812.49")).toBe("509.812,49");
    expect(formatDecimal(1996)).toBe("1.996,00");
    expect(formatDecimal("12.5", 1)).toBe("12,5");
    expect(formatDecimal(-3, 0)).toBe("-3");
    expect(formatDecimal(null)).toBe("—");
  });
});

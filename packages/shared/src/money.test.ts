import { describe, expect, it } from "vitest";
import { centsToInput, formatPercent, parseKzInput, parsePercentInput } from "./money";

describe("parseKzInput", () => {
  it("aceita formatos pt-AO e com ponto decimal", () => {
    expect(parseKzInput("2.950.000,00")).toBe("295000000");
    expect(parseKzInput("420")).toBe("42000");
    expect(parseKzInput("48,5")).toBe("4850");
    expect(parseKzInput("1234.56")).toBe("123456");
    expect(parseKzInput("1.000")).toBe("100000");
    expect(parseKzInput("588 549,42 Kz")).toBe("58854942");
    expect(parseKzInput("-10,00")).toBe("-1000");
    expect(parseKzInput(",5")).toBe("50");
  });

  it("vazio → null; inválido → undefined", () => {
    expect(parseKzInput("")).toBeNull();
    expect(parseKzInput("  ")).toBeNull();
    expect(parseKzInput("—")).toBeNull();
    expect(parseKzInput(null)).toBeNull();
    expect(parseKzInput("abc")).toBeUndefined();
    expect(parseKzInput("1,234")).toBeUndefined();
  });

  it("ida e volta com centsToInput", () => {
    expect(centsToInput("295000000")).toBe("2.950.000,00");
    expect(centsToInput(4850)).toBe("48,50");
    expect(centsToInput(null)).toBe("");
    expect(parseKzInput(centsToInput("58854942"))).toBe("58854942");
  });
});

describe("percentagens", () => {
  it("parse e formatação", () => {
    expect(parsePercentInput("14")).toBe("14");
    expect(parsePercentInput("12,5 %")).toBe("12.5");
    expect(parsePercentInput("")).toBeNull();
    expect(parsePercentInput("x")).toBeUndefined();
    expect(formatPercent("14")).toBe("14%");
    expect(formatPercent("12.5")).toBe("12,5%");
    expect(formatPercent(null)).toBe("—");
  });
});

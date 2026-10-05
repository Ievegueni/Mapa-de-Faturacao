import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { normalizeHeader, parseAutoMedicao } from "./parser";

const FIXTURE = join(__dirname, "../../../../test/fixtures/auto-medicao-agosto-2026.xlsx");

describe("normalizeHeader", () => {
  it("ignora acentos, pontuação, quebras de linha e o sufixo .420", () => {
    expect(normalizeHeader("\nData Instalação Gerador")).toBe("datainstalacaogerador");
    expect(normalizeHeader("Litros Abastecidos.420")).toBe("litrosabastecidos");
    expect(normalizeHeader("Nº Série Gerador")).toBe("nseriegerador");
    expect(normalizeHeader("Horas Gerador (N-1)")).toBe("horasgeradorn1");
    expect(normalizeHeader("Código P.P.")).toBe("codigopp");
  });
});

// O ficheiro real não vai para o repositório (dados operacionais); o teste corre se estiver presente.
describe.skipIf(!existsSync(FIXTURE))("Auto de Medição real (Agosto de 2026)", () => {
  it("lê 1.161 linhas da folha AGOSTO_26 com o total de litros do Excel", async () => {
    const t0 = Date.now();
    const r = await parseAutoMedicao(readFileSync(FIXTURE));
    expect(Date.now() - t0).toBeLessThan(10000);
    expect(r.sheets).toEqual(["AGOSTO_26", "Carregamento"]);
    expect(r.sheet).toBe("AGOSTO_26");
    expect(r.headerLine).toBe(5);
    expect(r.missingColumns).toEqual([]);
    expect(r.rows).toHaveLength(1161);
    const litros = r.rows.reduce((a, x) => a + BigInt(x.measurement.litros ? x.measurement.litros.replace(".", "") : "0"), BigInt(0));
    expect(litros).toBe(BigInt(50981249)); // 509.812,49 L (célula AC4 do Excel)
    expect(r.rows.filter((x) => x.errors.length)).toEqual([]);
  });

  it("normaliza espaços, SIM/NÃO, potência em texto e datas", async () => {
    const r = await parseAutoMedicao(readFileSync(FIXTURE));
    const first = r.rows[0];
    expect(first.line).toBe(6);
    expect(first.site).toMatchObject({ nome: "11 de Novembro", codigoPP: "UN2ZA-01002", regiao: "Norte", provincia: "Zaire", ligadoRede: true, powerCube1000: true, subtipo: "Standard" });
    expect(first.generator).toMatchObject({ numeroSerie: "PEE2685546", potenciaKVA: 20, dataInstalacao: "2026-02-02", proprietario: "Anglobal, S.A." });
    expect(first.measurement).toMatchObject({ dias: 31, horasN1: "2495.90", horasN: "2979.50", litros: "0.00" });
    expect(r.rows.every((x) => ["Norte", "Centro", "Sul", "Leste"].includes(x.site.regiao))).toBe(true); // "Sul " → "Sul"
    expect(r.rows.every((x) => typeof x.generator.potenciaKVA === "number")).toBe(true); // "20" → 20
    expect(r.rows.filter((x) => x.generator.dataRemocao).length).toBe(9);
  });

  it("permite escolher outra folha", async () => {
    const r = await parseAutoMedicao(readFileSync(FIXTURE), { sheet: "Carregamento" });
    expect(r.sheet).toBe("Carregamento");
    expect(r.rows.length).toBeGreaterThan(0);
  });
});

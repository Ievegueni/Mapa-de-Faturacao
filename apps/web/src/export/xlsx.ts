import { cellType, ReportCell, ReportColumnType, ReportData } from "@cf/shared";
import type { ChartImage } from "./chartToPng";
import { fileName } from "./format";

const NAVY = "FF08003C";
const FMT: Partial<Record<ReportColumnType, string>> = { kz: "#,##0.00", decimal: "#,##0.00", int: "#,##0", pct: "0.00%", data: "dd/mm/yyyy" };

/** Valor nativo do Excel: kz em Kz (não cêntimos), % como fracção, datas como Date. */
function excelValue(v: ReportCell | undefined, tipo: ReportColumnType): string | number | Date | null {
  if (v === null || v === undefined || v === "") return null;
  switch (tipo) {
    case "kz":
      return Number(v) / 100;
    case "int":
    case "decimal":
      return Number(v);
    case "pct":
      return Number(v) / 100;
    case "data":
      return new Date(`${v}T00:00:00Z`);
    default:
      return String(v);
  }
}

const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

const sheetName = (t: string, used: Set<string>) => {
  let base = t.replace(/[[\]:*?/\\]/g, " ").slice(0, 28).trim() || "Folha";
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base.slice(0, 26)} ${i}`;
  used.add(name);
  return name;
};

/** Excel no browser (exceljs): uma folha por secção, números formatados, totais com SUM e gráficos como PNG. */
export async function generateXlsx(report: ReportData, charts: ChartImage[], userName: string): Promise<{ blob: Blob; name: string }> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = userName;
  wb.created = new Date();
  const used = new Set<string>();
  const info = [
    report.titulo,
    `Período: ${report.periodo}`,
    Object.entries(report.filtros).map(([k, v]) => `${k}: ${v}`).join("  ·  "),
    `Gerado por ${userName} em ${new Date().toLocaleString("pt-PT")}`,
  ];

  for (const sec of report.secoes) {
    const ws = wb.addWorksheet(sheetName(sec.titulo, used), { views: [{ state: "frozen", ySplit: 6 }] });
    info.forEach((t, i) => {
      const c = ws.getCell(i + 1, 1);
      c.value = t;
      c.font = i === 0 ? { bold: true, size: 14, color: { argb: NAVY } } : { size: 10, color: { argb: "FF4D4D56" } };
    });
    const headerRow = 6;
    sec.colunas.forEach((col, i) => {
      const c = ws.getCell(headerRow, i + 1);
      c.value = col.label;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      c.alignment = { horizontal: col.tipo === "texto" ? "left" : "center", vertical: "middle", wrapText: true };
      ws.getColumn(i + 1).width = col.tipo === "texto" ? (i === 0 ? 34 : 18) : 15;
    });
    const first = headerRow + 1;
    sec.linhas.forEach((row, r) => {
      sec.colunas.forEach((col, i) => {
        const tipo = cellType(sec, col, row);
        const c = ws.getCell(first + r, i + 1);
        c.value = excelValue(row[col.key], tipo);
        if (FMT[tipo]) c.numFmt = FMT[tipo]!;
      });
    });
    const last = first + sec.linhas.length - 1;
    if (sec.totais) {
      const tr = last + 1;
      sec.colunas.forEach((col, i) => {
        const c = ws.getCell(tr, i + 1);
        if (col.soma && sec.linhas.length) {
          const L = colLetter(i + 1);
          c.value = { formula: `SUM(${L}${first}:${L}${last})`, result: excelValue(sec.totais![col.key], col.tipo) as number };
          if (FMT[col.tipo]) c.numFmt = FMT[col.tipo]!;
        } else if (i === 0) c.value = String(sec.totais![col.key] ?? "Total");
        c.font = { bold: true, color: { argb: NAVY } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEF0" } };
      });
    }
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: sec.colunas.length } };
  }

  if (charts.length) {
    const ws = wb.addWorksheet(sheetName("Gráficos", used));
    ws.getCell(1, 1).value = `${report.titulo} — gráficos`;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
    let row = 3;
    for (const c of charts) {
      ws.getCell(row, 1).value = c.titulo;
      ws.getCell(row, 1).font = { bold: true, color: { argb: NAVY } };
      const id = wb.addImage({ base64: c.dataUrl, extension: "png" });
      const width = 820;
      const height = Math.round((c.height / c.width) * width);
      ws.addImage(id, { tl: { col: 0, row }, ext: { width, height } });
      row += Math.ceil(height / 20) + 3;
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    name: fileName(report.titulo, report.periodo, "xlsx"),
  };
}

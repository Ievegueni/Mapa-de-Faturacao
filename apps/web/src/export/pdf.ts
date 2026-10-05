import type { ReportData, ReportSection } from "@cf/shared";
import { cellText, fileName, imageDataUrl, isNumeric } from "./format";
import type { ChartImage } from "./chartToPng";

const NAVY: [number, number, number] = [8, 0, 60];
const INK: [number, number, number] = [77, 77, 86];
const BRAND: [number, number, number] = [220, 111, 0];

/** As fontes base do PDF só têm Latin-1: troca os poucos símbolos que não existem. */
const pdfText = (s: string) => s.replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/→/g, "->").replace(/−/g, "-").replace(/ /g, " ");

/** PDF no browser (jsPDF + autotable): cabeçalho com logótipo, título, período, utilizador e data; tabelas e gráficos. */
export async function generatePdf(report: ReportData, charts: ChartImage[], userName: string): Promise<{ blob: Blob; name: string }> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: report.orientacao, unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const now = new Date();
  const stamp = `${now.toLocaleDateString("pt-PT")} ${now.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`;

  let logo: Awaited<ReturnType<typeof imageDataUrl>> | null = null;
  try {
    logo = await imageDataUrl("/unitel-logo.png");
  } catch {
    logo = null;
  }

  // Cabeçalho
  if (logo) {
    const h = 11;
    doc.addImage(logo.dataUrl, "PNG", M, M - 2, (logo.width / logo.height) * h, h, "logo", "FAST");
  }
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(pdfText(report.titulo), W - M, M + 2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(pdfText(`Período: ${report.periodo}`), W - M, M + 7, { align: "right" });
  const filtros = Object.entries(report.filtros).map(([k, v]) => `${k}: ${v}`).join("  ·  ");
  doc.text(pdfText(filtros), M, M + 15);
  doc.text(pdfText(`Gerado por ${userName} em ${stamp}`), M, M + 19.5);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.6);
  doc.line(M, M + 22, W - M, M + 22);
  let y = M + 28;

  if (report.avisos.length) {
    doc.setTextColor(180, 83, 9);
    for (const a of report.avisos) {
      doc.text(pdfText(`Aviso: ${a}`), M, y);
      y += 4.5;
    }
    y += 2;
  }

  // Gráficos (PNG) à escala do ecrã (0,22 mm por px: o texto do eixo fica ~7 pt, como as tabelas), mantendo a proporção
  const MM_PER_PX = 0.22;
  for (const c of charts) {
    let w = Math.min(W - 2 * M, c.width * MM_PER_PX);
    let h = (c.height / c.width) * w;
    const maxH = (H - 2 * M) * 0.6;
    if (h > maxH) {
      w *= maxH / h;
      h = maxH;
    }
    if (y + h + 8 > H - M) {
      doc.addPage();
      y = M + 4;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text(pdfText(c.titulo), M, y);
    doc.addImage(c.dataUrl, "PNG", M, y + 2, w, h, c.id, "FAST");
    y += h + 8;
  }

  // Tabelas
  for (const sec of report.secoes) {
    if (y > H - 40) {
      doc.addPage();
      y = M + 4;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text(pdfText(sec.titulo), M, y);
    const wide = sec.colunas.length > 10;
    autoTable(doc, {
      startY: y + 2,
      margin: { left: M, right: M },
      head: [sec.colunas.map((c) => pdfText(c.label))],
      body: sec.linhas.map((r) => sec.colunas.map((c) => pdfText(cellText(sec, c, r)))),
      foot: sec.totais ? [sec.colunas.map((c) => pdfText(sec.totais![c.key] === undefined ? "" : cellText(sec as ReportSection, c, sec.totais!)))] : undefined,
      showFoot: "lastPage",
      theme: "grid",
      styles: { font: "helvetica", fontSize: wide ? 6 : 8, cellPadding: wide ? 1 : 1.6, textColor: [24, 24, 27], lineColor: [220, 220, 224], lineWidth: 0.1, overflow: "linebreak" },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", halign: "center" },
      footStyles: { fillColor: [238, 238, 240], textColor: NAVY, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 250, 251] },
      columnStyles: Object.fromEntries(sec.colunas.map((c, i) => [i, { halign: isNumeric(c.tipo) ? "right" : "left" }])),
      didParseCell: (d) => {
        if ((d.section === "body" || d.section === "foot") && d.column.index > 0 && sec.tipoPorLinha) d.cell.styles.halign = "right";
        if (d.section === "head") d.cell.styles.halign = d.column.index === 0 ? "left" : isNumeric(sec.colunas[d.column.index].tipo) ? "right" : "left";
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // Rodapé com paginação
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140, 140, 150);
    doc.text(pdfText(`Unitel · Controlo de Facturação · ${report.titulo} · ${report.periodo}`), M, H - 6);
    doc.text(`${i} / ${pages}`, W - M, H - 6, { align: "right" });
  }
  return { blob: doc.output("blob"), name: fileName(report.titulo, report.periodo, "pdf") };
}

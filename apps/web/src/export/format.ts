import { cellType, formatDate, formatDecimal, formatKz, ReportCell, ReportColumn, ReportColumnType, ReportSection } from "@cf/shared";

/** Texto de uma célula para ecrã e PDF. */
export function formatCell(v: ReportCell | undefined, tipo: ReportColumnType): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (tipo) {
    case "kz":
      return formatKz(String(v)).replace(" Kz", "");
    case "int":
      return Number(v).toLocaleString("pt-PT").replace(/\s/g, ".");
    case "decimal":
      return formatDecimal(String(v));
    case "pct":
      return `${Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 2 })}%`;
    case "data":
      return formatDate(String(v));
    default:
      return String(v);
  }
}

export const isNumeric = (t: ReportColumnType) => t !== "texto" && t !== "data";

export function cellText(section: ReportSection, col: ReportColumn, row: Record<string, ReportCell>) {
  return formatCell(row[col.key], cellType(section, col, row));
}

/** Nome de ficheiro seguro. */
export function fileName(titulo: string, periodo: string, ext: string) {
  const slug = `${titulo} ${periodo}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${slug}.${ext}`;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function imageDataUrl(src: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const blob = await (await fetch(src)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}

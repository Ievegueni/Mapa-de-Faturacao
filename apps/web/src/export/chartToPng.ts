/**
 * Converte o SVG de um gráfico Recharts em PNG (canvas do browser, sem dependências).
 * Usado para embutir os gráficos no PDF e no Excel (CLAUDE.md §11).
 */
export interface ChartImage {
  id: string;
  titulo: string;
  dataUrl: string;
  width: number;
  height: number;
}

export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<{ dataUrl: string; width: number; height: number }> {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || Number(svg.getAttribute("width")) || 600));
  const height = Math.max(1, Math.round(rect.height || Number(svg.getAttribute("height")) || 300));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("style", "font-family: 'Inter Variable', Inter, Arial, sans-serif; font-size: 12px;");
  // Fundo branco (o SVG é transparente)
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/png"), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Captura todos os gráficos marcados com data-chart-id dentro de um contentor. */
export async function captureCharts(root: HTMLElement): Promise<ChartImage[]> {
  const out: ChartImage[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-chart-id]"))) {
    const svg = el.querySelector<SVGSVGElement>("svg.recharts-surface");
    if (!svg) continue;
    const png = await svgToPng(svg);
    out.push({ id: el.dataset.chartId!, titulo: el.dataset.chartTitle ?? "", ...png });
  }
  return out;
}

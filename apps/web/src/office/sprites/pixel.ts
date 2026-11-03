/**
 * Utilitários para desenhar pixel art original a partir de grades de caracteres.
 * Cada caractere é uma cor da paleta; "." é transparente. Tudo é gerado em canvas no navegador,
 * então não há assets de terceiros no projeto.
 */
export type Palette = Record<string, string>;

export function normalizeRows(rows: string[], width: number): string[] {
  return rows.map((r) => (r.length >= width ? r.slice(0, width) : r.padEnd(width, ".")));
}

export function drawGrid(ctx: CanvasRenderingContext2D, rows: string[], palette: Palette, ox = 0, oy = 0, mirror = false) {
  const width = Math.max(...rows.map((r) => r.length));
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === "." || ch === " ") continue;
      const color = palette[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ox + (mirror ? width - 1 - x : x), oy + y, 1, 1);
    }
  });
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Clareia/escurece uma cor hex (amount entre -1 e 1). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

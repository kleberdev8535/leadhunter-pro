import { makeCanvas, shade } from "./pixel";

type Pt = [number, number];
type Ctx = CanvasRenderingContext2D;

/** Preenche um polígono pixel a pixel (sem antialias), para bordas nítidas de pixel art. */
export function fillPoly(ctx: Ctx, pts: Pt[], color: string) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.floor(Math.min(...xs));
  const maxX = Math.ceil(Math.max(...xs));
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));
  ctx.fillStyle = color;
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]!;
        const [xj, yj] = pts[j]!;
        if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** Contorno de 1px entre pontos (linha de Bresenham). */
export function line(ctx: Ctx, a: Pt, b: Pt, color: string) {
  ctx.fillStyle = color;
  let [x0, y0] = [Math.round(a[0]), Math.round(a[1])];
  const [x1, y1] = [Math.round(b[0]), Math.round(b[1])];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export interface BoxColors {
  top: string;
  left?: string; // face da frente-esquerda (mais clara)
  right?: string; // face da frente-direita (mais escura)
  outline?: string;
}

/**
 * Caixa isométrica com base de `a` tiles no eixo x e `b` tiles no eixo y, altura `h` e elevação `z`
 * (em px). Projeção do ponto (i, j, z): X = (i - j)·16 + offX, Y = (i + j)·8 - z + offY.
 */
export function isoBox(ctx: Ctx, offX: number, offY: number, a: number, b: number, h: number, c: BoxColors, z = 0) {
  const P = (i: number, j: number, k: number): Pt => [(i - j) * 16 + offX, (i + j) * 8 - k + offY];
  const left = c.left ?? shade(c.top, -0.12);
  const right = c.right ?? shade(c.top, -0.28);
  const top = z + h;
  // face frente-esquerda (j = b)
  fillPoly(ctx, [P(0, b, z), P(a, b, z), P(a, b, top), P(0, b, top)], left);
  // face frente-direita (i = a)
  fillPoly(ctx, [P(a, 0, z), P(a, b, z), P(a, b, top), P(a, 0, top)], right);
  // tampa
  fillPoly(ctx, [P(0, 0, top), P(a, 0, top), P(a, b, top), P(0, b, top)], c.top);
  if (c.outline) {
    const o = c.outline;
    line(ctx, P(0, 0, top), P(a, 0, top), o);
    line(ctx, P(a, 0, top), P(a, b, top), o);
    line(ctx, P(a, b, top), P(0, b, top), o);
    line(ctx, P(0, b, top), P(0, 0, top), o);
    if (h > 0) {
      line(ctx, P(0, b, top), P(0, b, z), o);
      line(ctx, P(a, b, top), P(a, b, z), o);
      line(ctx, P(a, 0, top), P(a, 0, z), o);
      line(ctx, P(0, b, z), P(a, b, z), o);
      line(ctx, P(a, b, z), P(a, 0, z), o);
    }
  }
  return { P };
}

/** Canvas do tamanho certo para um objeto de base a×b tiles e altura total `height`. */
export function boxCanvas(a: number, b: number, height: number): [HTMLCanvasElement, Ctx, number, number] {
  const w = (a + b) * 16 + 2;
  const hgt = (a + b) * 8 + height + 2;
  const [c, ctx] = makeCanvas(w, hgt);
  // offX: o canto (0, b) fica em x = 1; offY: o canto de trás (0, 0) no topo da altura.
  return [c, ctx, b * 16 + 1, height + 1];
}

/** Sombra suave no chão sob um objeto (losango escurecido). */
export function floorShadow(ctx: Ctx, offX: number, offY: number, a: number, b: number) {
  const P = (i: number, j: number): Pt => [(i - j) * 16 + offX, (i + j) * 8 + offY];
  fillPoly(ctx, [P(-0.05, 0.15), P(a + 0.15, 0.15), P(a + 0.15, b + 0.25), P(-0.05, b + 0.25)], "rgba(20,24,40,0.22)");
}

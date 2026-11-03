import { makeCanvas, shade } from "./pixel";

/**
 * Personagens isométricos originais com formas arredondadas (cabeça oval, ombros curvos, membros finos).
 * Cada quadro é desenhado sem contorno e depois recebe um contorno de 1px calculado a partir da própria
 * silhueta — assim o contorno acompanha as curvas em vez de formar caixas.
 * Duas vistas (frente = sudoeste, costas = noroeste); as outras diagonais saem espelhando (flipX).
 */
export const CHAR_W = 30;
export const CHAR_H = 56;
export const CHAR_COLS = 6;
export const CHAR_ROWS = 3;

export const ISO_FRAMES = {
  frontStand: 0,
  frontWalk: [1, 0, 2, 0],
  backStand: 3,
  backWalk: [4, 3, 5, 3],
  sit: 6,
  type: [7, 8],
  celebrate: [9, 10],
  wave: 11,
  // Respiração: o tronco e a cabeça descem 1px (pés parados), para ninguém parecer uma foto.
  frontBreath: 12,
  backBreath: 13,
  sitBreath: 14,
} as const;

export interface Look {
  uniform: string;
  hair: string;
  skin: string;
  pants: string;
  accent: string;
  /** Estilo do cabelo: curto, volumoso ou comprido (dá personalidade a cada agente). */
  hairStyle: "short" | "puffy" | "long";
}

type Legs = "stand" | "walkA" | "walkB" | "seated";
type Arms = "down" | "swingA" | "swingB" | "typeA" | "typeB" | "up" | "wave";
type Ctx = CanvasRenderingContext2D;

const OUTLINE = "#1b1e30";

// ── Primitivas arredondadas (pixel a pixel, sem antialias) ──
function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, clip?: (x: number, y: number) => boolean) {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && (!clip || clip(x, y))) ctx.fillRect(x, y, 1, 1);
    }
  }
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string) {
  ctx.fillStyle = color;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const cx = xx < r ? r - xx - 0.5 : xx >= w - r ? xx - (w - r) + 0.5 : 0;
      const cy = yy < r ? r - yy - 0.5 : yy >= h - r ? yy - (h - r) + 0.5 : 0;
      if (cx * cx + cy * cy <= r * r + 0.3) ctx.fillRect(x + xx, y + yy, 1, 1);
    }
  }
}

/** Tronco: ombros largos e arredondados afinando até a cintura. */
function torso(ctx: Ctx, x0: number, y0: number, color: string, shadeColor: string) {
  const rows = 13;
  for (let r = 0; r < rows; r++) {
    const half = r < 3 ? 6 + r : 9 - Math.floor((r - 3) * 0.25); // ombro arredondado → cintura
    const left = x0 + 15 - half;
    const width = half * 2;
    ctx.fillStyle = color;
    ctx.fillRect(left, y0 + r, width, 1);
    ctx.fillStyle = shadeColor;
    ctx.fillRect(left + width - Math.max(2, Math.floor(width * 0.28)), y0 + r, Math.max(2, Math.floor(width * 0.28)), 1);
  }
}

/** Membro fino com ponta arredondada (braço/perna). */
function limb(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  roundRect(ctx, x, y, w, h, Math.min(1.5, w / 2), color);
}

/** Contorno de 1px em volta de tudo o que já foi desenhado no quadro. */
function outline(src: HTMLCanvasElement, dst: Ctx, ox: number, oy: number) {
  const sctx = src.getContext("2d")!;
  const { width: w, height: h } = src;
  const data = sctx.getImageData(0, 0, w, h).data;
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! > 0;
  dst.fillStyle = OUTLINE;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) dst.fillRect(ox + x, oy + y, 1, 1);
    }
  }
  dst.drawImage(src, ox, oy);
}

function figure(look: Look, view: "front" | "back", legs: Legs, arms: Arms, dy = 0): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(CHAR_W, CHAR_H);
  const seated = legs === "seated";
  const Y = (v: number) => v + dy + (seated ? 8 : 0);
  const u = look.uniform;
  const uD = shade(u, -0.22);
  const skinD = shade(look.skin, -0.14);
  const hairD = shade(look.hair, -0.22);
  const pantsD = shade(look.pants, -0.25);
  const shoe = "#3b2b26";

  // Pernas
  if (seated) {
    roundRect(ctx, 9, Y(38), 12, 6, 2, look.pants);
  } else {
    const L = legs === "walkA" ? { lx: 10, ll: 12, rx: 16, rl: 9 } : legs === "walkB" ? { lx: 11, ll: 9, rx: 15, rl: 12 } : { lx: 10, ll: 11, rx: 16, rl: 11 };
    limb(ctx, L.lx, Y(39), 4, L.ll, look.pants);
    limb(ctx, L.rx, Y(39), 4, L.rl, pantsD);
    const toe = view === "front" ? -1 : 1;
    ellipse(ctx, L.lx + 2 + toe, Y(39 + L.ll), 3, 1.8, shoe);
    ellipse(ctx, L.rx + 2 + toe, Y(39 + L.rl), 3, 1.8, shoe);
  }

  // Braços
  const arm = (side: "l" | "r") => {
    const x = side === "l" ? 5 : 22;
    const col = side === "l" ? u : uD;
    if (arms === "up" || (arms === "wave" && side === "r")) {
      const ax = side === "l" ? x - 1 : x + 1;
      limb(ctx, ax, Y(14), 3, 13, col);
      ellipse(ctx, ax + 1.5, Y(13), 2, 2, look.skin);
    } else if (arms === "typeA" || arms === "typeB") {
      const raised = (arms === "typeA") === (side === "l");
      limb(ctx, x, Y(27), 3, raised ? 7 : 9, col);
      ellipse(ctx, x + 1.5, Y(raised ? 34 : 36), 2, 1.8, look.skin);
    } else {
      const swing = arms === "swingA" ? (side === "l" ? 1 : -1) : arms === "swingB" ? (side === "l" ? -1 : 1) : 0;
      limb(ctx, x, Y(27 + swing), 3, 10, col);
      ellipse(ctx, x + 1.5, Y(37 + swing), 2, 1.8, look.skin);
    }
  };
  arm("l");
  arm("r");

  // Tronco + cinto
  torso(ctx, 0, Y(26), u, uD);
  if (!seated) {
    ctx.fillStyle = shade(look.pants, -0.35);
    ctx.fillRect(9, Y(38), 12, 1);
  }

  // Pescoço
  roundRect(ctx, 13, Y(23), 5, 4, 1, view === "front" ? skinD : shade(look.skin, -0.2));

  // Cabeça oval (marca do estilo: cabeça grande)
  const hx = 15;
  const hy = Y(14);
  if (view === "front") {
    ellipse(ctx, hx, hy, 8.5, 9, look.skin);
    ellipse(ctx, hx + 7.5, hy + 1, 1.6, 2.2, skinD); // orelha (lado de trás)
    // cabelo: calota + franja irregular + volume conforme o estilo
    ellipse(ctx, hx, hy - 3, 9.3, 7, look.hair, (_x, y) => y <= hy - 3);
    for (const [fx, fy] of [[-6, -3], [-3, -2], [0, -3], [3, -2], [6, -3]] as const) ellipse(ctx, hx + fx, hy + fy, 2, 2, look.hair);
    ellipse(ctx, hx + 7, hy, 2.5, 5, look.hair); // lateral/nuca
    if (look.hairStyle === "puffy") ellipse(ctx, hx, hy - 7, 9, 5, look.hair);
    if (look.hairStyle === "long") {
      ellipse(ctx, hx + 7, hy + 5, 3, 7, look.hair);
      ellipse(ctx, hx - 8, hy + 3, 2, 5, look.hair);
    }
    ellipse(ctx, hx - 2, hy - 8, 3, 1.2, shade(look.hair, 0.25)); // brilho
    // rosto (olhando para sudoeste: traços levemente à esquerda)
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(hx - 5, hy + 1, 2, 3);
    ctx.fillRect(hx, hy + 1, 2, 3);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(hx - 5, hy + 1, 1, 1);
    ctx.fillRect(hx, hy + 1, 1, 1);
    ctx.fillStyle = shade(look.skin, -0.35);
    ctx.fillRect(hx - 3, hy + 6, 3, 1); // sorriso
    ctx.fillRect(hx - 4, hy + 5, 1, 1);
    ctx.fillRect(hx, hy + 5, 1, 1);
    ctx.fillStyle = "rgba(239,100,100,0.35)";
    ctx.fillRect(hx - 7, hy + 4, 2, 1); // bochecha
    ctx.fillRect(hx + 2, hy + 4, 2, 1);
    // gola e detalhe do uniforme
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(12, Y(26), 7, 2);
    ctx.fillRect(13, Y(28), 5, 1);
    ctx.fillStyle = look.accent;
    ctx.fillRect(15, Y(28), 2, 6);
  } else {
    ellipse(ctx, hx, hy, 8.5, 9, look.hair);
    ellipse(ctx, hx, hy + 4, 7.5, 4.5, hairD);
    ellipse(ctx, hx - 8, hy + 1, 1.6, 2.2, shade(look.skin, -0.14)); // orelha
    if (look.hairStyle === "puffy") ellipse(ctx, hx, hy - 6, 9, 5, look.hair);
    if (look.hairStyle === "long") ellipse(ctx, hx, hy + 8, 7, 5, hairD);
    ellipse(ctx, hx + 2, hy - 6, 3, 1.2, shade(look.hair, 0.25));
    ctx.fillStyle = uD;
    ctx.fillRect(15, Y(30), 1, 7); // costura das costas
  }

  const [out, octx] = makeCanvas(CHAR_W, CHAR_H);
  outline(c, octx, 0, 0);
  return out;
}

/** Copia o quadro descendo 1px tudo acima de `splitY` (cintura), mantendo pernas e pés no lugar. */
function breathe(src: HTMLCanvasElement, splitY: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(CHAR_W, CHAR_H);
  ctx.drawImage(src, 0, splitY, CHAR_W, CHAR_H - splitY, 0, splitY, CHAR_W, CHAR_H - splitY);
  ctx.drawImage(src, 0, 0, CHAR_W, splitY, 0, 1, CHAR_W, splitY);
  return c;
}

/** Gera a folha 6×3 de um agente (180×168 px). */
export function buildIsoCharacterSheet(look: Look): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(CHAR_W * CHAR_COLS, CHAR_H * CHAR_ROWS);
  const frames: HTMLCanvasElement[] = [
    figure(look, "front", "stand", "down"),
    figure(look, "front", "walkA", "swingA"),
    figure(look, "front", "walkB", "swingB"),
    figure(look, "back", "stand", "down"),
    figure(look, "back", "walkA", "swingA"),
    figure(look, "back", "walkB", "swingB"),
    figure(look, "back", "seated", "down"),
    figure(look, "back", "seated", "typeA"),
    figure(look, "back", "seated", "typeB"),
    figure(look, "front", "stand", "up", -2),
    figure(look, "front", "stand", "up", 0),
    figure(look, "front", "stand", "wave"),
  ];
  frames.push(breathe(frames[0]!, 38), breathe(frames[3]!, 38), breathe(frames[6]!, 46));
  frames.forEach((f, i) => ctx.drawImage(f, (i % CHAR_COLS) * CHAR_W, Math.floor(i / CHAR_COLS) * CHAR_H));
  return canvas;
}

export const ISO_LOOKS: Record<string, Look> = {
  HUNTER: { uniform: "#2f6fdc", hair: "#4a3324", skin: "#efbd94", pants: "#2b3245", accent: "#f2c94c", hairStyle: "short" },
  SCOUT: { uniform: "#2e9e5b", hair: "#1f1b1a", skin: "#a8724f", pants: "#33302b", accent: "#f1f5f9", hairStyle: "puffy" },
  ATLAS: { uniform: "#e07b2a", hair: "#9a5d32", skin: "#f3cba8", pants: "#2b3245", accent: "#7c2d12", hairStyle: "short" },
  WRITER: { uniform: "#7c4dd6", hair: "#e9b850", skin: "#f5d4b5", pants: "#2a2440", accent: "#f472b6", hairStyle: "long" },
  METRICS: { uniform: "#6b7280", hair: "#5a5a5a", skin: "#7d5038", pants: "#1f2937", accent: "#38bdf8", hairStyle: "short" },
};

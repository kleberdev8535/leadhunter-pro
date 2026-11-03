import { makeCanvas, rect, shade } from "./pixel";
import { boxCanvas, fillPoly, floorShadow, isoBox, line, type BoxColors } from "./iso-draw";
import { WALL_LOW, WALL_TALL } from "../iso/iso";
import type { FloorKind, FurnitureType } from "../map/OfficeMap";

/**
 * Cenário isométrico original, no espírito dos hotéis em pixel art: piso em losango, paredes com volume
 * e móveis em blocos. Nenhum asset de terceiros: tudo é desenhado aqui.
 */
type Ctx = CanvasRenderingContext2D;
const OUT = "#2b2f45";

export interface IsoTexture {
  canvas: HTMLCanvasElement;
  /** Ponto do canvas que corresponde ao canto de trás do tile de origem, no chão. */
  anchorX: number;
  anchorY: number;
}

// ───────────── Piso ─────────────

const FLOOR: Record<FloorKind, { a: string; b: string; style: "check" | "wood" | "carpet" | "marble" }> = {
  prospect: { a: "#b9c8e2", b: "#aabbd8", style: "check" },
  analysis: { a: "#b8dcc0", b: "#a7cfb1", style: "check" },
  manager: { a: "#c08f5c", b: "#b0804f", style: "wood" },
  corridor: { a: "#e2dccf", b: "#d6cfc0", style: "marble" },
  reception: { a: "#efe9dd", b: "#e2dccd", style: "marble" },
  crm: { a: "#efd3b4", b: "#e5c5a2", style: "check" },
  comms: { a: "#d3cbee", b: "#c5bce6", style: "check" },
  lounge: { a: "#88c2ab", b: "#7bb59e", style: "carpet" },
};

function diamond(ctx: Ctx, color: string) {
  fillPoly(ctx, [[16, 0], [32, 8], [16, 16], [0, 8]], color);
}

function floorTile(kind: FloorKind, alt: boolean): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(32, 16);
  const f = FLOOR[kind];
  const base = f.style === "check" && alt ? f.b : f.a;
  diamond(ctx, base);
  if (f.style === "wood") {
    // tábuas na diagonal
    for (let k = -16; k < 32; k += 6) line(ctx, [k, 16], [k + 16, 8], shade(f.a, -0.14));
  } else if (f.style === "carpet") {
    for (let y = 2; y < 15; y += 2) for (let x = 2 + (y % 4); x < 30; x += 4) {
      const inside = Math.abs(x - 16) / 16 + Math.abs(y - 8) / 8 < 0.92;
      if (inside) rect(ctx, x, y, 1, 1, f.b);
    }
  } else if (f.style === "marble") {
    for (const [x, y] of [[9, 7], [10, 8], [20, 5], [21, 6], [15, 11], [23, 9]] as const) rect(ctx, x, y, 1, 1, f.b);
  }
  // rejunte nas duas bordas de trás: dá a leitura de grade do piso
  line(ctx, [0, 8], [16, 0], shade(base, -0.1));
  line(ctx, [16, 0], [31, 7.5], shade(base, -0.1));
  return c;
}

export function buildFloorTextures(): Record<string, HTMLCanvasElement> {
  const out: Record<string, HTMLCanvasElement> = {};
  for (const k of Object.keys(FLOOR) as FloorKind[]) {
    out[`${k}:a`] = floorTile(k, false);
    out[`${k}:b`] = floorTile(k, true);
  }
  out["door:a"] = floorTile("corridor", false);
  out["door:b"] = floorTile("corridor", true);
  return out;
}

// ───────────── Paredes ─────────────

function wallBlock(h: number, window: boolean): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(1, 1, h);
  // Paredes do fundo com topo escuro (contraste); meias-paredes com topo claro, para o piso “respirar”.
  const low = h < 20;
  const { P } = isoBox(ctx, ox, oy, 1, 1, h, low
    ? { top: "#d6cfbf", left: "#efe8d8", right: "#d8cfbb", outline: "#a39a86" }
    : { top: "#5b6380", left: "#efe8d8", right: "#d8cfbb", outline: "#4a516b" });
  // rodapé
  fillPoly(ctx, [P(0, 1, 0), P(1, 1, 0), P(1, 1, 3), P(0, 1, 3)], "#9a8a6c");
  fillPoly(ctx, [P(1, 0, 0), P(1, 1, 0), P(1, 1, 3), P(1, 0, 3)], "#867758");
  if (window && h > 20) {
    fillPoly(ctx, [P(0.15, 1, 9), P(0.85, 1, 9), P(0.85, 1, h - 5), P(0.15, 1, h - 5)], OUT);
    fillPoly(ctx, [P(0.2, 1, 10), P(0.8, 1, 10), P(0.8, 1, h - 6), P(0.2, 1, h - 6)], "#9fd6f2");
    fillPoly(ctx, [P(0.2, 1, h - 10), P(0.8, 1, h - 10), P(0.8, 1, h - 6), P(0.2, 1, h - 6)], "#cdeefc");
    line(ctx, P(0.5, 1, 10), P(0.5, 1, h - 6), OUT);
  }
  return { canvas: c, anchorX: ox, anchorY: oy };
}

export function buildWallTextures() {
  return { tall: wallBlock(WALL_TALL, false), window: wallBlock(WALL_TALL, true), low: wallBlock(WALL_LOW, false) };
}

// ───────────── Móveis ─────────────

const WOOD: BoxColors = { top: "#c99a62", left: "#ad7f4b", right: "#8f663a", outline: "#5e4024" };
const METAL: BoxColors = { top: "#aeb6c7", left: "#949db1", right: "#7b8498", outline: "#4f566a" };

/** Caixa deslocada para (i0, j0) dentro do mesmo canvas. */
function sub(ctx: Ctx, ox: number, oy: number, i0: number, j0: number, a: number, b: number, h: number, c: BoxColors, z = 0) {
  return isoBox(ctx, ox + (i0 - j0) * 16, oy + (i0 + j0) * 8, a, b, h, c, z);
}

function desk(a: number): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(a, 1, 20);
  floorShadow(ctx, ox, oy, a, 1);
  for (const [i, j] of [[0.08, 0.1], [a - 0.2, 0.1], [0.08, 0.8], [a - 0.2, 0.8]] as const) sub(ctx, ox, oy, i, j, 0.12, 0.1, 11, WOOD);
  sub(ctx, ox, oy, 0, 0.05, a, 0.95, 3, WOOD, 11);
  // teclado, papéis e caneca sobre a mesa
  sub(ctx, ox, oy, 0.25, 0.6, 0.5, 0.18, 1, { top: "#e1e5ed", outline: "#7b8498" }, 14);
  sub(ctx, ox, oy, a - 0.75, 0.3, 0.4, 0.35, 1, { top: "#f8fafc", outline: "#c2c9d6" }, 14);
  sub(ctx, ox, oy, a - 0.25, 0.65, 0.1, 0.1, 3, { top: "#ef6b6b", outline: "#9b3a3a" }, 14);
  return { canvas: c, anchorX: ox, anchorY: oy };
}

/** Monitor sobre a mesa, com a tela virada para a cadeira (sul). Quadros: 0 desligado, 1–2 ligado. */
function monitorSheet(): { canvas: HTMLCanvasElement; frameW: number; frameH: number; anchorX: number; anchorY: number } {
  const frames = 3;
  const [one, , ox, oy] = boxCanvas(1, 1, 34);
  const fw = one.width;
  const fh = one.height;
  const [c, ctx] = makeCanvas(fw * frames, fh);
  for (let f = 0; f < frames; f++) {
    const fx = f * fw;
    sub(ctx, fx + ox, oy, 0.42, 0.25, 0.16, 0.12, 4, METAL, 14); // pé
    const { P } = sub(ctx, fx + ox, oy, 0.12, 0.28, 0.76, 0.08, 13, { top: "#3a4058", left: "#262b3d", right: "#1f2333", outline: "#141826" }, 17);
    const screen = f === 0 ? "#1f2a3c" : "#1c4f8f";
    fillPoly(ctx, [P(0.08, 0.08, 18.5), P(0.7, 0.08, 18.5), P(0.7, 0.08, 28.5), P(0.08, 0.08, 28.5)], screen);
    if (f > 0) {
      const rows = f === 1 ? [0.5, 0.3, 0.42] : [0.35, 0.5, 0.25];
      rows.forEach((len, r) => line(ctx, P(0.14, 0.08, 26 - r * 2.6), P(0.14 + len, 0.08, 26 - r * 2.6), r === 1 ? "#5eead4" : "#9cc8ff"));
    }
  }
  return { canvas: c, frameW: fw, frameH: fh, anchorX: ox, anchorY: oy };
}

function chair(color = "#3f4763"): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(1, 1, 22);
  const seat: BoxColors = { top: shade(color, 0.12), left: color, right: shade(color, -0.2), outline: "#1f2333" };
  sub(ctx, ox, oy, 0.46, 0.46, 0.08, 0.08, 6, METAL);
  sub(ctx, ox, oy, 0.22, 0.22, 0.56, 0.56, 3, seat, 6);
  // encosto do lado sul: fica na frente de quem senta (visto de trás)
  sub(ctx, ox, oy, 0.22, 0.74, 0.56, 0.1, 12, seat, 8);
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function plant(): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(1, 1, 40);
  floorShadow(ctx, ox, oy, 1, 1);
  sub(ctx, ox, oy, 0.28, 0.28, 0.44, 0.44, 10, { top: "#7a4a2c", left: "#c9784b", right: "#a85f37", outline: "#5a3420" });
  const cx = ox + 0;
  const cy = oy + 8;
  const blobs: [number, number, number, string][] = [
    [cx, cy - 22, 8, "#2f7d45"], [cx - 6, cy - 16, 7, "#3d9655"], [cx + 6, cy - 16, 7, "#3d9655"],
    [cx, cy - 28, 6, "#4cae63"], [cx - 3, cy - 20, 5, "#5cc072"], [cx + 4, cy - 25, 4, "#6fd083"],
  ];
  for (const [x, y, r, col] of blobs) {
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy * 1.3 <= r * r) rect(ctx, x + xx, y + yy, 1, 1, col);
  }
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function bookshelf(): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(2, 1, 44);
  floorShadow(ctx, ox, oy, 2, 1);
  const { P } = sub(ctx, ox, oy, 0, 0.55, 2, 0.4, 42, { top: "#7a5232", left: "#6b4428", right: "#563620", outline: "#3a2414" });
  const books = ["#e05d5d", "#3b82f6", "#f2c94c", "#2e9e5b", "#8b5cf6", "#f97316", "#64748b", "#ec4899"];
  for (let shelf = 0; shelf < 3; shelf++) {
    const z0 = 4 + shelf * 13;
    fillPoly(ctx, [P(0.05, 0.4, z0), P(1.95, 0.4, z0), P(1.95, 0.4, z0 + 11), P(0.05, 0.4, z0 + 11)], "#3a2414");
    let i = 0.1;
    let n = shelf * 3;
    while (i < 1.85) {
      const w = 0.09 + ((n * 7) % 3) * 0.03;
      const hh = 7 + ((n * 5) % 4);
      fillPoly(ctx, [P(i, 0.4, z0), P(i + w, 0.4, z0), P(i + w, 0.4, z0 + hh), P(i, 0.4, z0 + hh)], books[n % books.length]!);
      i += w + 0.02;
      n++;
    }
  }
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function cabinet(): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(1, 1, 26);
  floorShadow(ctx, ox, oy, 1, 1);
  const { P } = sub(ctx, ox, oy, 0.12, 0.1, 0.76, 0.8, 24, METAL);
  for (const z of [5, 12, 19]) {
    line(ctx, P(0, 0.8, z), P(0.76, 0.8, z), "#6b7387");
    fillPoly(ctx, [P(0.3, 0.8, z + 2), P(0.46, 0.8, z + 2), P(0.46, 0.8, z + 3), P(0.3, 0.8, z + 3)], "#3b4252");
  }
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function counter(): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(4, 1, 34);
  floorShadow(ctx, ox, oy, 4, 1);
  const { P } = sub(ctx, ox, oy, 0, 0.1, 4, 0.8, 18, { top: "#f3eee3", left: "#6366f1", right: "#4f46e5", outline: "#312e81" });
  fillPoly(ctx, [P(1.6, 0.8, 6), P(2.4, 0.8, 6), P(2.4, 0.8, 12), P(1.6, 0.8, 12)], "#e0e7ff");
  sub(ctx, ox, oy, 0.6, 0.35, 0.6, 0.08, 10, { top: "#3a4058", left: "#1c4f8f", right: "#1f2333", outline: "#141826" }, 18);
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function sofa(): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(3, 1, 22);
  floorShadow(ctx, ox, oy, 3, 1);
  const fab: BoxColors = { top: "#f28a4a", left: "#e06c26", right: "#c2581b", outline: "#7a3410" };
  sub(ctx, ox, oy, 0, 0, 3, 0.3, 16, fab); // encosto (norte)
  sub(ctx, ox, oy, 0, 0.3, 3, 0.6, 7, fab);
  sub(ctx, ox, oy, 0, 0.3, 0.25, 0.6, 11, fab);
  sub(ctx, ox, oy, 2.75, 0.3, 0.25, 0.6, 11, fab);
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function coffeeTable(): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(2, 1, 14);
  floorShadow(ctx, ox, oy, 2, 1);
  sub(ctx, ox, oy, 0.15, 0.2, 1.7, 0.6, 7, WOOD);
  sub(ctx, ox, oy, 0.4, 0.4, 0.12, 0.12, 3, { top: "#f8fafc", outline: "#94a3b8" }, 7);
  sub(ctx, ox, oy, 1.1, 0.35, 0.45, 0.3, 1, { top: "#3b82f6", outline: "#1e40af" }, 7);
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function waterCooler(): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(1, 1, 34);
  floorShadow(ctx, ox, oy, 1, 1);
  sub(ctx, ox, oy, 0.3, 0.3, 0.4, 0.4, 18, { top: "#f1f5f9", left: "#e2e8f0", right: "#cbd5e1", outline: "#64748b" });
  sub(ctx, ox, oy, 0.34, 0.34, 0.32, 0.32, 12, { top: "#bae6fd", left: "#7dd3fc", right: "#38bdf8", outline: "#0369a1" }, 18);
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function coffeeBar(): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(2, 1, 32);
  floorShadow(ctx, ox, oy, 2, 1);
  sub(ctx, ox, oy, 0, 0.15, 2, 0.75, 16, { top: "#f3eee3", left: WOOD.left!, right: WOOD.right!, outline: WOOD.outline });
  sub(ctx, ox, oy, 0.2, 0.3, 0.5, 0.4, 13, { top: "#4b5563", left: "#374151", right: "#1f2937", outline: "#111827" }, 16);
  sub(ctx, ox, oy, 1.2, 0.45, 0.14, 0.14, 4, { top: "#f8fafc", outline: "#94a3b8" }, 16);
  sub(ctx, ox, oy, 1.5, 0.45, 0.14, 0.14, 4, { top: "#fde68a", outline: "#b45309" }, 16);
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function printer(): IsoTexture {
  const [c, ctx, ox, oy] = boxCanvas(2, 1, 22);
  floorShadow(ctx, ox, oy, 2, 1);
  sub(ctx, ox, oy, 0.2, 0.2, 1.6, 0.6, 12, { top: "#e5e7eb", left: "#d1d5db", right: "#9ca3af", outline: "#4b5563" });
  sub(ctx, ox, oy, 0.5, 0.3, 0.8, 0.4, 1, { top: "#ffffff", outline: "#cbd5e1" }, 12);
  sub(ctx, ox, oy, 1.55, 0.75, 0.1, 0.05, 2, { top: "#22c55e", outline: "#166534" }, 8);
  return { canvas: c, anchorX: ox, anchorY: oy };
}

function serverSheet(): { canvas: HTMLCanvasElement; frameW: number; frameH: number; anchorX: number; anchorY: number } {
  const [one, , ox, oy] = boxCanvas(2, 1, 44);
  const [c, ctx] = makeCanvas(one.width * 2, one.height);
  for (let f = 0; f < 2; f++) {
    const fx = f * one.width;
    floorShadow(ctx, fx + ox, oy, 2, 1);
    const { P } = sub(ctx, fx + ox, oy, 0.1, 0.1, 1.8, 0.8, 42, { top: "#374151", left: "#1f2937", right: "#111827", outline: "#030712" });
    for (let r = 0; r < 6; r++) {
      const z = 5 + r * 6;
      fillPoly(ctx, [P(0.1, 0.8, z), P(1.7, 0.8, z), P(1.7, 0.8, z + 4), P(0.1, 0.8, z + 4)], "#2b3544");
      fillPoly(ctx, [P(0.18, 0.8, z + 1), P(0.24, 0.8, z + 1), P(0.24, 0.8, z + 3), P(0.18, 0.8, z + 3)], (r + f) % 2 ? "#22c55e" : "#14532d");
      fillPoly(ctx, [P(0.3, 0.8, z + 1), P(0.36, 0.8, z + 1), P(0.36, 0.8, z + 3), P(0.3, 0.8, z + 3)], (r + f) % 3 === 0 ? "#38bdf8" : "#0c4a6e");
    }
  }
  return { canvas: c, frameW: one.width, frameH: one.height, anchorX: ox, anchorY: oy };
}

export function buildIsoFurniture(): Record<Exclude<FurnitureType, "server">, IsoTexture> {
  return {
    desk: desk(2),
    bigDesk: desk(3),
    chair: chair(),
    plant: plant(),
    bookshelf: bookshelf(),
    cabinet: cabinet(),
    counter: counter(),
    waitingChair: chair("#6366f1"),
    sofa: sofa(),
    coffeeTable: coffeeTable(),
    waterCooler: waterCooler(),
    coffeeBar: coffeeBar(),
    printer: printer(),
  };
}

export const buildIsoMonitor = monitorSheet;
export const buildIsoServer = serverSheet;

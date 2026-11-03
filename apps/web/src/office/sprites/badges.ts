import { makeCanvas, rect } from "./pixel";
import type { Badge } from "../agents/behavior";

/** Balõezinhos sobre a cabeça (11x11), um por estado. */
export function buildBadgeTextures(): Record<Exclude<Badge, "none">, HTMLCanvasElement> {
  const bubble = (bg: string, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const [c, ctx] = makeCanvas(11, 12);
    rect(ctx, 1, 0, 9, 9, "#1b1f2a");
    rect(ctx, 0, 1, 11, 7, "#1b1f2a");
    rect(ctx, 1, 1, 9, 7, bg);
    rect(ctx, 4, 9, 3, 1, "#1b1f2a");
    rect(ctx, 5, 10, 1, 1, "#1b1f2a");
    rect(ctx, 5, 9, 1, 1, bg);
    draw(ctx);
    return c;
  };
  return {
    error: bubble("#ef4444", (ctx) => {
      rect(ctx, 5, 2, 1, 3, "#fff");
      rect(ctx, 5, 6, 1, 1, "#fff");
    }),
    waiting: bubble("#f8fafc", (ctx) => {
      for (const x of [3, 5, 7]) rect(ctx, x, 4, 1, 1, "#475569");
    }),
    paused: bubble("#f59e0b", (ctx) => {
      rect(ctx, 4, 2, 1, 5, "#fff");
      rect(ctx, 6, 2, 1, 5, "#fff");
    }),
    assigned: bubble("#6366f1", (ctx) => {
      rect(ctx, 3, 2, 5, 5, "#fff");
      rect(ctx, 4, 3, 3, 1, "#6366f1");
      rect(ctx, 4, 5, 2, 1, "#6366f1");
    }),
  };
}

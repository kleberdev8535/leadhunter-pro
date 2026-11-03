import { MAP_W } from "../map/OfficeMap";
import type { Point } from "./CollisionSystem";

type BlockedFn = (x: number, y: number) => boolean;

/** Fila de prioridade binária mínima (A* com muitos nós precisa disso para não ser O(n²)). */
class MinHeap {
  private readonly items: { k: number; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(k: number, f: number) {
    const a = this.items;
    a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= a[i]!.f) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.f < a[m]!.f) m = l;
        if (r < a.length && a[r]!.f < a[m]!.f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top.k;
  }
}

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/**
 * A* em grade com 4 direções (como em RPGs top-down: sem diagonal) e heurística de Manhattan.
 * Retorna os passos a partir do vizinho de `start` até `goal`, ou null se não há caminho.
 */
export function findPath(start: Point, goal: Point, blocked: BlockedFn, maxNodes = 4000): Point[] | null {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (blocked(goal.x, goal.y)) return null;
  const k = (x: number, y: number) => y * MAP_W + x;
  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  const open = new MinHeap();
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const startK = k(start.x, start.y);
  g.set(startK, 0);
  open.push(startK, h(start.x, start.y));
  let expanded = 0;

  while (open.size && expanded++ < maxNodes) {
    const cur = open.pop();
    const cx = cur % MAP_W;
    const cy = Math.floor(cur / MAP_W);
    if (cx === goal.x && cy === goal.y) {
      const path: Point[] = [];
      let n: number | undefined = cur;
      while (n !== undefined && n !== startK) {
        path.push({ x: n % MAP_W, y: Math.floor(n / MAP_W) });
        n = came.get(n);
      }
      return path.reverse();
    }
    const gc = g.get(cur)!;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (blocked(nx, ny)) continue;
      const nk = k(nx, ny);
      const ng = gc + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, cur);
        open.push(nk, ng + h(nx, ny));
      }
    }
  }
  return null;
}

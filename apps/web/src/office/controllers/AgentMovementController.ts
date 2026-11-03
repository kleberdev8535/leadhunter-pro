import { TILE } from "../map/OfficeMap";
import type { CollisionSystem, Point } from "../systems/CollisionSystem";
import { findPath } from "../systems/Pathfinding";
import type { Dir } from "../animations/AnimationManager";

const SPEED = 64; // px por segundo (~4 tiles/s)
const WAIT_MS = 350;
const MAX_WAITS = 4;

/**
 * Movimento tile a tile. Antes de entrar num tile o agente o reserva no CollisionSystem;
 * se outro agente estiver lá, espera um pouco e depois recalcula o caminho desviando dele.
 */
export class AgentMovementController {
  tile: Point;
  pos: { x: number; y: number };
  dir: Dir = "down";
  private path: Point[] = [];
  private goal: Point | null = null;
  private next: Point | null = null;
  private waited = 0;
  private waitUntil = 0;
  private onArrive: (() => void) | null = null;

  constructor(
    private readonly agentId: string,
    private readonly collision: CollisionSystem,
    start: Point,
  ) {
    this.tile = { ...start };
    this.pos = { x: start.x * TILE, y: start.y * TILE };
    collision.occupy(agentId, start.x, start.y);
  }

  get moving() {
    return this.next !== null || this.path.length > 0;
  }

  get destination() {
    return this.goal;
  }

  /** Teletransporte (usado só na carga inicial, para refletir o estado atual sem animação falsa). */
  place(p: Point) {
    this.collision.releaseAll(this.agentId);
    this.tile = { ...p };
    this.pos = { x: p.x * TILE, y: p.y * TILE };
    this.path = [];
    this.next = null;
    this.goal = { ...p };
    this.collision.occupy(this.agentId, p.x, p.y);
  }

  goTo(target: Point, onArrive: () => void): boolean {
    this.onArrive = onArrive;
    this.goal = { ...target };
    if (!this.next && this.tile.x === target.x && this.tile.y === target.y) {
      this.finish();
      return true;
    }
    return this.plan(true);
  }

  private plan(avoidAgents: boolean): boolean {
    if (!this.goal) return false;
    const from = this.next ?? this.tile;
    const blocked = avoidAgents
      ? (x: number, y: number) => this.collision.isBlocked(x, y, this.agentId) && !(x === this.goal!.x && y === this.goal!.y && !this.collision.isStaticBlocked(x, y))
      : (x: number, y: number) => this.collision.isStaticBlocked(x, y);
    const path = findPath(from, this.goal, blocked) ?? (avoidAgents ? findPath(from, this.goal, (x, y) => this.collision.isStaticBlocked(x, y)) : null);
    if (!path) return false;
    this.path = path;
    return true;
  }

  private finish() {
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.();
  }

  /** Sai da frente: vai para um tile vizinho livre e, ao chegar, recalcula a rota. */
  private sidestep() {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5);
    for (const [dx, dy] of dirs) {
      const x = this.tile.x + dx!;
      const y = this.tile.y + dy!;
      if (!this.collision.isBlocked(x, y, this.agentId)) {
        this.path = [{ x, y }];
        return;
      }
    }
  }

  /** Avança o movimento. Retorna true enquanto está andando. */
  update(deltaMs: number, now: number): boolean {
    if (!this.next) {
      const step = this.path[0];
      if (!step) return false;
      if (now < this.waitUntil) return true;
      if (!this.collision.occupy(this.agentId, step.x, step.y)) {
        // Tem alguém no caminho: espera e, se persistir, recalcula desviando.
        this.waited++;
        // Espera com variação aleatória: dois agentes de frente não recalculam no mesmo instante.
        this.waitUntil = now + WAIT_MS + Math.random() * 400;
        if (this.waited >= MAX_WAITS) {
          this.waited = 0;
          const replanned = this.plan(true);
          const first = this.path[0];
          // Rota nova ainda bloqueada (dois agentes de frente): um deles dá um passo para o lado.
          // O sorteio quebra a simetria para os dois não desviarem ao mesmo tempo.
          if ((!replanned || !first || this.collision.isBlocked(first.x, first.y, this.agentId)) && Math.random() < 0.6) {
            this.sidestep();
          }
        }
        return true;
      }
      this.waited = 0;
      this.path.shift();
      this.next = step;
      this.dir = step.x > this.tile.x ? "right" : step.x < this.tile.x ? "left" : step.y < this.tile.y ? "up" : "down";
    }

    const tx = this.next.x * TILE;
    const ty = this.next.y * TILE;
    const dist = (SPEED * deltaMs) / 1000;
    const dx = tx - this.pos.x;
    const dy = ty - this.pos.y;
    if (Math.abs(dx) <= dist && Math.abs(dy) <= dist) {
      this.pos = { x: tx, y: ty };
      this.collision.release(this.agentId, this.tile.x, this.tile.y);
      this.tile = this.next;
      this.next = null;
      if (this.path.length === 0) {
        const atGoal = this.goal && this.tile.x === this.goal.x && this.tile.y === this.goal.y;
        // Depois de um passo para o lado, recalcula a rota até o destino real.
        if (!atGoal && this.goal) {
          if (!this.plan(true)) this.finish();
        } else this.finish();
      }
    } else {
      this.pos.x += Math.sign(dx) * Math.min(dist, Math.abs(dx));
      this.pos.y += Math.sign(dy) * Math.min(dist, Math.abs(dy));
    }
    return true;
  }
}

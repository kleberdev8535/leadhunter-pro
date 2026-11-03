import { FURNITURE, MAP_H, MAP_W, TILES, isFloor } from "../map/OfficeMap";

export interface Point {
  x: number;
  y: number;
}

const key = (x: number, y: number) => y * MAP_W + x;

/**
 * Colisão em duas camadas: estática (paredes e móveis, calculada uma vez) e dinâmica
 * (tile atual e próximo tile de cada agente), para que ninguém atravesse ninguém.
 */
export class CollisionSystem {
  private readonly solid = new Uint8Array(MAP_W * MAP_H);
  private readonly occupants = new Map<number, string>();

  constructor() {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) if (!isFloor(TILES[y]![x])) this.solid[key(x, y)] = 1;
    }
    for (const f of FURNITURE) {
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) this.solid[key(x, y)] = 1;
    }
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  }

  isStaticBlocked(x: number, y: number) {
    return !this.inBounds(x, y) || this.solid[key(x, y)] === 1;
  }

  /** Bloqueado para `agentId`: parede, móvel ou outro agente. */
  isBlocked(x: number, y: number, agentId?: string) {
    if (this.isStaticBlocked(x, y)) return true;
    const who = this.occupants.get(key(x, y));
    return who !== undefined && who !== agentId;
  }

  /** Reserva um tile. Retorna false se outro agente já está nele. */
  occupy(agentId: string, x: number, y: number): boolean {
    const k = key(x, y);
    const who = this.occupants.get(k);
    if (who !== undefined && who !== agentId) return false;
    this.occupants.set(k, agentId);
    return true;
  }

  release(agentId: string, x: number, y: number) {
    const k = key(x, y);
    if (this.occupants.get(k) === agentId) this.occupants.delete(k);
  }

  releaseAll(agentId: string) {
    for (const [k, who] of this.occupants) if (who === agentId) this.occupants.delete(k);
  }

  occupantAt(x: number, y: number) {
    return this.occupants.get(key(x, y));
  }
}

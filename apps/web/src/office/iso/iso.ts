import { MAP_H, MAP_W } from "../map/OfficeMap";

/**
 * Projeção isométrica 2:1 (estilo Habbo). A lógica do escritório (grade, colisão, A*) continua em
 * coordenadas de tile; só o desenho passa por aqui.
 */
export const ISO_W = 32; // largura do losango de um tile
export const ISO_H = 16; // altura do losango de um tile
export const WALL_TALL = 30; // paredes do fundo
export const WALL_LOW = 9; // meias-paredes (frente e divisórias), para não esconder os agentes

/** Deslocamento para que todo o mapa fique com coordenadas positivas. */
export const ORIGIN_X = MAP_H * (ISO_W / 2) + 8;
export const ORIGIN_Y = WALL_TALL + 8;

export const WORLD_W = (MAP_W + MAP_H) * (ISO_W / 2) + 16;
export const WORLD_H = (MAP_W + MAP_H) * (ISO_H / 2) + WALL_TALL + 24;

/** Canto de trás (norte) do tile (x, y), em pixels de tela. Aceita frações para o movimento suave. */
export function toScreen(x: number, y: number) {
  return { x: ORIGIN_X + (x - y) * (ISO_W / 2), y: ORIGIN_Y + (x + y) * (ISO_H / 2) };
}

/** Centro do losango do tile. */
export function tileCenter(x: number, y: number) {
  const p = toScreen(x, y);
  return { x: p.x, y: p.y + ISO_H / 2 };
}

/**
 * Ordem de desenho: quem está mais "à frente" (maior x + y) é desenhado por cima.
 * Os decimais separam camadas do mesmo tile (piso < móvel < pessoa < encosto da cadeira).
 */
export const depthOf = (x: number, y: number, layer = 0) => (x + y) * 10 + layer;

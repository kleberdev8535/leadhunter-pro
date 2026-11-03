/**
 * Mapa do escritório em tiles de 16px. É um único mapa contínuo: salas ligadas por portas a um
 * corredor central. Sem dependência do Phaser, para que colisão e pathfinding sejam testáveis.
 */
export const TILE = 16;
export const MAP_W = 44;
export const MAP_H = 30;

export type Tile =
  | "wall" // topo de parede (sólido)
  | "face" // face da parede (sólido)
  | "window" // face com janela (sólido)
  | "door" // vão de porta (andável)
  | "entrance" // porta de entrada (sólida, só visual)
  | `floor:${FloorKind}`;

export type FloorKind = "prospect" | "analysis" | "manager" | "corridor" | "reception" | "crm" | "comms" | "lounge";

export interface Room {
  id: string;
  name: string;
  floor: FloorKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ROOMS: Room[] = [
  { id: "prospect", name: "Prospecção", floor: "prospect", x: 1, y: 2, w: 14, h: 10 },
  { id: "analysis", name: "Análise", floor: "analysis", x: 16, y: 2, w: 12, h: 10 },
  { id: "manager", name: "Gerenciamento", floor: "manager", x: 29, y: 2, w: 14, h: 10 },
  { id: "corridor", name: "", floor: "corridor", x: 1, y: 14, w: 42, h: 3 },
  { id: "reception", name: "Recepção", floor: "reception", x: 1, y: 19, w: 10, h: 9 },
  { id: "crm", name: "CRM", floor: "crm", x: 12, y: 19, w: 10, h: 9 },
  { id: "comms", name: "Comunicação", floor: "comms", x: 23, y: 19, w: 9, h: 9 },
  { id: "lounge", name: "Descanso", floor: "lounge", x: 33, y: 19, w: 10, h: 9 },
];

const DOORS: [number, number][] = [
  // portas das salas de cima (parede em y=12/13)
  [7, 12], [8, 12], [7, 13], [8, 13],
  [21, 12], [22, 12], [21, 13], [22, 13],
  [35, 12], [36, 12], [35, 13], [36, 13],
  // portas das salas de baixo (parede em y=17/18)
  [5, 17], [6, 17], [5, 18], [6, 18],
  [16, 17], [17, 17], [16, 18], [17, 18],
  [26, 17], [27, 17], [26, 18], [27, 18],
  [37, 17], [38, 17], [37, 18], [38, 18],
];
const WINDOW_COLS = [3, 4, 9, 10, 19, 20, 25, 26, 31, 32, 39, 40];

export type FurnitureType =
  | "desk"
  | "bigDesk"
  | "chair"
  | "plant"
  | "bookshelf"
  | "cabinet"
  | "counter"
  | "waitingChair"
  | "sofa"
  | "coffeeTable"
  | "waterCooler"
  | "coffeeBar"
  | "printer"
  | "server";

export interface Furniture {
  id: string;
  type: FurnitureType;
  x: number;
  y: number;
  /** Área sólida em tiles. */
  w: number;
  h: number;
}

/** Decoração presa na parede (sem colisão). */
export interface WallDecor {
  type: "whiteboard" | "chart" | "kanban" | "screens" | "clock" | "frame" | "noticeboard" | "logo";
  x: number;
  y: number;
  w: number;
}

export interface Station {
  id: string;
  room: string;
  /** Tile onde o agente senta (virado para cima, de frente para a mesa). */
  seat: { x: number; y: number };
  deskId: string;
}

const furniture: Furniture[] = [];
const stations: Station[] = [];
const add = (f: Furniture) => furniture.push(f);

function workstation(id: string, room: string, x: number, y: number, big = false) {
  const w = big ? 3 : 2;
  add({ id: `desk:${id}`, type: big ? "bigDesk" : "desk", x, y, w, h: 1 });
  const seat = { x: big ? x + 1 : x, y: y + 1 };
  stations.push({ id, room, seat, deskId: `desk:${id}` });
}

// Prospecção — 3 estações
workstation("prospect-1", "prospect", 2, 4);
workstation("prospect-2", "prospect", 6, 4);
workstation("prospect-3", "prospect", 10, 4);
add({ id: "shelf:p1", type: "bookshelf", x: 12, y: 2, w: 2, h: 1 });
add({ id: "cab:p1", type: "cabinet", x: 14, y: 7, w: 1, h: 1 });
add({ id: "plant:p1", type: "plant", x: 1, y: 10, w: 1, h: 1 });
add({ id: "plant:p2", type: "plant", x: 14, y: 10, w: 1, h: 1 });
add({ id: "shelf:p2", type: "bookshelf", x: 1, y: 2, w: 2, h: 1 });

// Análise — 2 estações
workstation("analysis-1", "analysis", 18, 5);
workstation("analysis-2", "analysis", 23, 5);
add({ id: "cab:a1", type: "cabinet", x: 26, y: 2, w: 1, h: 1 });
add({ id: "cab:a2", type: "cabinet", x: 27, y: 2, w: 1, h: 1 });
add({ id: "plant:a1", type: "plant", x: 16, y: 10, w: 1, h: 1 });
add({ id: "plant:a2", type: "plant", x: 27, y: 10, w: 1, h: 1 });

// Gerenciamento — mesa principal
workstation("manager-1", "manager", 34, 5, true);
add({ id: "shelf:m1", type: "bookshelf", x: 29, y: 2, w: 2, h: 1 });
add({ id: "server:m1", type: "server", x: 41, y: 2, w: 2, h: 1 });
add({ id: "plant:m1", type: "plant", x: 29, y: 10, w: 1, h: 1 });
add({ id: "plant:m2", type: "plant", x: 42, y: 10, w: 1, h: 1 });

// Corredor
add({ id: "plant:c1", type: "plant", x: 1, y: 14, w: 1, h: 1 });
add({ id: "plant:c2", type: "plant", x: 42, y: 14, w: 1, h: 1 });

// Recepção
add({ id: "counter:r1", type: "counter", x: 3, y: 22, w: 4, h: 1 });
add({ id: "wait:r1", type: "waitingChair", x: 8, y: 25, w: 1, h: 1 });
add({ id: "wait:r2", type: "waitingChair", x: 9, y: 25, w: 1, h: 1 });
add({ id: "plant:r1", type: "plant", x: 10, y: 19, w: 1, h: 1 });
add({ id: "plant:r2", type: "plant", x: 1, y: 27, w: 1, h: 1 });
add({ id: "plant:r3", type: "plant", x: 10, y: 27, w: 1, h: 1 });

// CRM — 2 estações
workstation("crm-1", "crm", 13, 21);
workstation("crm-2", "crm", 18, 21);
add({ id: "cab:k1", type: "cabinet", x: 20, y: 19, w: 1, h: 1 });
add({ id: "cab:k2", type: "cabinet", x: 21, y: 19, w: 1, h: 1 });
add({ id: "plant:k1", type: "plant", x: 12, y: 27, w: 1, h: 1 });

// Comunicação — 2 estações
workstation("comms-1", "comms", 24, 21);
workstation("comms-2", "comms", 28, 21);
add({ id: "printer:m1", type: "printer", x: 30, y: 19, w: 2, h: 1 });
add({ id: "plant:o1", type: "plant", x: 31, y: 27, w: 1, h: 1 });

// Descanso
add({ id: "sofa:l1", type: "sofa", x: 34, y: 25, w: 3, h: 1 });
add({ id: "table:l1", type: "coffeeTable", x: 35, y: 22, w: 2, h: 1 });
add({ id: "cooler:l1", type: "waterCooler", x: 42, y: 19, w: 1, h: 1 });
add({ id: "bar:l1", type: "coffeeBar", x: 39, y: 19, w: 2, h: 1 });
add({ id: "plant:l1", type: "plant", x: 33, y: 19, w: 1, h: 1 });
add({ id: "plant:l2", type: "plant", x: 42, y: 27, w: 1, h: 1 });
add({ id: "sofa:l2", type: "sofa", x: 39, y: 25, w: 3, h: 1 });

export const FURNITURE: readonly Furniture[] = furniture;
export const STATIONS: readonly Station[] = stations;

/** Lugares onde agentes livres ficam na sala de descanso. */
export const LOUNGE_SPOTS: readonly { x: number; y: number }[] = [
  { x: 35, y: 24 }, { x: 40, y: 24 }, { x: 37, y: 21 }, { x: 41, y: 21 }, { x: 34, y: 21 }, { x: 38, y: 26 }, { x: 33, y: 23 },
];

/** Lugares para onde agentes livres vão passear (cafeteira, bebedouro, corredor, janelas…). */
export const POINTS_OF_INTEREST: readonly { x: number; y: number; face: "down" | "left" | "right" | "up"; label: string }[] = [
  { x: 39, y: 20, face: "up", label: "café" },
  { x: 40, y: 20, face: "up", label: "café" },
  { x: 42, y: 20, face: "up", label: "água" },
  { x: 36, y: 24, face: "down", label: "sofá" },
  { x: 40, y: 23, face: "down", label: "descanso" },
  { x: 10, y: 15, face: "down", label: "corredor" },
  { x: 22, y: 15, face: "down", label: "corredor" },
  { x: 33, y: 16, face: "down", label: "corredor" },
  { x: 4, y: 2, face: "up", label: "janela" },
  { x: 20, y: 2, face: "up", label: "janela" },
  { x: 32, y: 3, face: "up", label: "janela" },
  { x: 8, y: 24, face: "down", label: "recepção" },
];

export const WALL_DECOR: readonly WallDecor[] = [
  { type: "whiteboard", x: 6, y: 1, w: 2 },
  { type: "clock", x: 13, y: 1, w: 1 },
  { type: "chart", x: 17, y: 1, w: 2 },
  { type: "chart", x: 23, y: 1, w: 2 },
  { type: "screens", x: 36, y: 1, w: 3 },
  { type: "frame", x: 33, y: 1, w: 1 },
  { type: "logo", x: 3, y: 18, w: 2 },
  { type: "kanban", x: 19, y: 18, w: 2 },
  { type: "noticeboard", x: 23, y: 18, w: 2 },
  { type: "frame", x: 34, y: 18, w: 1 },
  { type: "clock", x: 41, y: 18, w: 1 },
];

function buildTiles(): Tile[][] {
  const t: Tile[][] = Array.from({ length: MAP_H }, () => Array.from({ length: MAP_W }, () => "wall" as Tile));
  for (const r of ROOMS) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) t[y]![x] = `floor:${r.floor}`;
  }
  // Faces de parede visíveis (abaixo de cada linha de parede horizontal).
  for (let x = 1; x < MAP_W - 1; x++) {
    if (t[1]![x] === "wall") t[1]![x] = WINDOW_COLS.includes(x) ? "window" : "face";
    if (t[13]![x] === "wall" && x !== 15 && x !== 28) t[13]![x] = "face";
    if (t[18]![x] === "wall" && ![11, 22, 32].includes(x)) t[18]![x] = "face";
  }
  for (const [x, y] of DOORS) t[y]![x] = "door";
  t[28]![4] = "entrance";
  t[28]![5] = "entrance";
  return t;
}

export const TILES: readonly (readonly Tile[])[] = buildTiles();

export const isFloor = (tile: Tile | undefined) => !!tile && (tile.startsWith("floor:") || tile === "door");

export function roomAt(x: number, y: number): Room | undefined {
  return ROOMS.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

export const stationById = (id: string) => STATIONS.find((s) => s.id === id);

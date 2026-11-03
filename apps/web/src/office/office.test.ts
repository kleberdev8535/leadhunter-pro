import { describe, expect, it } from "vitest";
import { FURNITURE, LOUNGE_SPOTS, MAP_H, MAP_W, POINTS_OF_INTEREST, ROOMS, STATIONS, TILES, roomAt } from "./map/OfficeMap";
import { CollisionSystem } from "./systems/CollisionSystem";
import { findPath } from "./systems/Pathfinding";
import { StationOccupancy } from "./systems/StationOccupancy";
import { AgentMovementController } from "./controllers/AgentMovementController";
import { behaviorFor, type AgentStatus } from "./agents/behavior";
import { normalizeRows } from "./sprites/pixel";

// As estações que o backend atribui a cada agente (AGENT_REGISTRY).
const BACKEND_STATIONS = ["prospect-1", "analysis-1", "crm-1", "comms-1", "manager-1"];
const STATUSES: AgentStatus[] = ["IDLE", "AVAILABLE", "ASSIGNED", "WORKING", "WAITING", "PAUSED", "COMPLETED", "ERROR", "OFFLINE"];

describe("mapa do escritório", () => {
  it("tem as 7 salas pedidas, num mapa único", () => {
    const names = ROOMS.map((r) => r.name).filter(Boolean);
    expect(names).toEqual(["Prospecção", "Análise", "Gerenciamento", "Recepção", "CRM", "Comunicação", "Descanso"]);
    expect(TILES).toHaveLength(MAP_H);
    expect(TILES.every((row) => row.length === MAP_W)).toBe(true);
  });

  it("tem 3 estações na Prospecção e 2 na Análise, e todas as estações do backend existem", () => {
    expect(STATIONS.filter((s) => s.room === "prospect")).toHaveLength(3);
    expect(STATIONS.filter((s) => s.room === "analysis")).toHaveLength(2);
    for (const id of BACKEND_STATIONS) expect(STATIONS.some((s) => s.id === id)).toBe(true);
  });

  it("todo assento e todo lugar de descanso é alcançável a partir de qualquer outro", () => {
    const c = new CollisionSystem();
    const blocked = (x: number, y: number) => c.isStaticBlocked(x, y);
    const points = [...STATIONS.map((s) => s.seat), ...LOUNGE_SPOTS];
    for (const p of points) expect(blocked(p.x, p.y)).toBe(false);
    for (const a of points) for (const b of points) expect(findPath(a, b, blocked), `${JSON.stringify(a)}→${JSON.stringify(b)}`).not.toBeNull();
  });

  it("todo ponto de passeio é livre e alcançável a partir de qualquer cadeira (ida e volta)", () => {
    const c = new CollisionSystem();
    const blocked = (x: number, y: number) => c.isStaticBlocked(x, y);
    for (const p of POINTS_OF_INTEREST) {
      expect(blocked(p.x, p.y), p.label).toBe(false);
      for (const s of STATIONS) {
        expect(findPath(s.seat, p, blocked), `${s.id}→${p.label}`).not.toBeNull();
        expect(findPath(p, s.seat, blocked), `${p.label}→${s.id}`).not.toBeNull();
      }
    }
  });

  it("os lugares de descanso ficam na sala de descanso", () => {
    expect(LOUNGE_SPOTS.every((p) => roomAt(p.x, p.y)?.id === "lounge")).toBe(true);
  });

  it("móveis não ficam por cima de portas", () => {
    for (const f of FURNITURE) {
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) expect(TILES[y]![x]).not.toBe("door");
    }
  });
});

describe("pathfinding A*", () => {
  const c = new CollisionSystem();
  const blocked = (x: number, y: number) => c.isStaticBlocked(x, y);

  it("encontra o caminho mais curto e nunca passa por paredes ou móveis", () => {
    const from = STATIONS.find((s) => s.id === "prospect-1")!.seat;
    const to = STATIONS.find((s) => s.id === "comms-1")!.seat;
    const path = findPath(from, to, blocked)!;
    expect(path.at(-1)).toEqual(to);
    for (const p of path) expect(blocked(p.x, p.y)).toBe(false);
    // Cada passo anda exatamente 1 tile, sem diagonal.
    let prev = from;
    for (const p of path) {
      expect(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)).toBe(1);
      prev = p;
    }
  });

  it("devolve null quando o destino é sólido", () => {
    expect(findPath({ x: 2, y: 5 }, { x: 0, y: 0 }, blocked)).toBeNull();
  });

  it("desvia de outro agente parado no caminho", () => {
    const col = new CollisionSystem();
    col.occupy("outro", 8, 15);
    const path = findPath({ x: 4, y: 15 }, { x: 12, y: 15 }, (x, y) => col.isBlocked(x, y, "eu"))!;
    expect(path.some((p) => p.x === 8 && p.y === 15)).toBe(false);
  });
});

describe("colisão entre agentes", () => {
  it("dois agentes não ocupam o mesmo tile", () => {
    const c = new CollisionSystem();
    expect(c.occupy("a", 5, 15)).toBe(true);
    expect(c.occupy("b", 5, 15)).toBe(false);
    c.release("a", 5, 15);
    expect(c.occupy("b", 5, 15)).toBe(true);
  });

  it("um agente andando espera quem está na frente e chega sem atravessar ninguém", () => {
    const c = new CollisionSystem();
    const walker = new AgentMovementController("a", c, { x: 3, y: 15 });
    c.occupy("parado", 6, 15);
    let arrived = false;
    walker.goTo({ x: 10, y: 15 }, () => (arrived = true));
    let now = 0;
    for (let i = 0; i < 2000 && !arrived; i++) {
      now += 16;
      walker.update(16, now);
      expect(c.occupantAt(walker.tile.x, walker.tile.y)).toBe("a");
      expect(walker.tile).not.toEqual({ x: 6, y: 15 });
    }
    expect(arrived).toBe(true);
    expect(walker.tile).toEqual({ x: 10, y: 15 });
  });
});

describe("impasse entre agentes", () => {
  it("dois agentes andando de frente um para o outro se desviam e ambos chegam", () => {
    for (let run = 0; run < 20; run++) {
      const c = new CollisionSystem();
      const a = new AgentMovementController("a", c, { x: 5, y: 15 });
      const b = new AgentMovementController("b", c, { x: 15, y: 15 });
      let doneA = false;
      let doneB = false;
      a.goTo({ x: 15, y: 15 }, () => (doneA = true));
      b.goTo({ x: 5, y: 15 }, () => (doneB = true));
      let now = 0;
      for (let i = 0; i < 6000 && !(doneA && doneB); i++) {
        now += 16;
        a.update(16, now);
        b.update(16, now);
        expect(a.tile).not.toEqual(b.tile);
      }
      expect(doneA && doneB, `rodada ${run}`).toBe(true);
    }
  });

  it("também resolve o encontro numa porta estreita", () => {
    const c = new CollisionSystem();
    const a = new AgentMovementController("a", c, { x: 7, y: 11 });
    const b = new AgentMovementController("b", c, { x: 7, y: 14 });
    let doneA = false;
    let doneB = false;
    a.goTo({ x: 7, y: 15 }, () => (doneA = true));
    b.goTo({ x: 7, y: 10 }, () => (doneB = true));
    let now = 0;
    for (let i = 0; i < 8000 && !(doneA && doneB); i++) {
      now += 16;
      a.update(16, now);
      b.update(16, now);
    }
    expect(doneA && doneB).toBe(true);
  });
});

describe("ocupação de estações", () => {
  it("duas pessoas não sentam na mesma cadeira", () => {
    const o = new StationOccupancy();
    expect(o.claimStation("hunter", "prospect-1")?.id).toBe("prospect-1");
    // Outro agente que preferia a mesma cadeira fica com outra da mesma sala.
    const other = o.claimStation("visitante", "prospect-1");
    expect(other?.id).not.toBe("prospect-1");
    expect(other?.room).toBe("prospect");
    expect(o.occupantOf("prospect-1")).toBe("hunter");
  });

  it("libera a cadeira ao sair e reserva lugares de descanso distintos", () => {
    const o = new StationOccupancy();
    o.claimStation("a", "crm-1");
    o.releaseStation("a");
    expect(o.occupantOf("crm-1")).toBeNull();
    const s1 = o.claimLoungeSpot("a");
    const s2 = o.claimLoungeSpot("b");
    expect(s1).not.toEqual(s2);
  });
});

describe("visual segue o backend", () => {
  it("só o status WORKING faz o agente digitar e mostrar progresso", () => {
    for (const s of STATUSES) {
      const b = behaviorFor(s);
      expect(b.pose === "type").toBe(s === "WORKING");
      expect(b.showProgress).toBe(s === "WORKING");
    }
  });

  it("só agentes livres passeiam; quem tem tarefa nunca sai da mesa", () => {
    expect(behaviorFor("AVAILABLE").wander).toBe(true);
    expect(behaviorFor("IDLE").wander).toBe(true);
    for (const s of ["WORKING", "ASSIGNED", "WAITING", "PAUSED", "ERROR", "OFFLINE"] as AgentStatus[]) expect(behaviorFor(s).wander).toBe(false);
  });

  it("agentes livres ficam sentados na própria mesa, sem digitar", () => {
    expect(behaviorFor("AVAILABLE")).toMatchObject({ place: "station", pose: "sit" });
    expect(behaviorFor("IDLE")).toMatchObject({ place: "station", pose: "sit" });
    expect(behaviorFor("ASSIGNED").place).toBe("station");
    expect(behaviorFor("ERROR").badge).toBe("error");
    expect(behaviorFor("OFFLINE").place).toBe("none");
  });
});

describe("sprites", () => {
  it("normaliza linhas para a largura do quadro", () => {
    expect(normalizeRows(["abc", "abcdefghijklmnopq"], 16).every((r) => r.length === 16)).toBe(true);
  });
});

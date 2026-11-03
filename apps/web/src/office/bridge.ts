import type { AgentStatus } from "./agents/behavior";

export interface OfficeAgent {
  id: string;
  kind: "HUNTER" | "SCOUT" | "ATLAS" | "WRITER" | "METRICS";
  name: string;
  station: string;
  status: AgentStatus;
  progress: number | null;
}

type GameToUi = {
  ready: [];
  hover: [{ id: string; x: number; y: number } | null];
  click: [string];
  dblclick: [string];
};

type UiToGame = {
  sync: [OfficeAgent[]];
  progress: [string, number];
  celebrate: [string];
  zoom: ["in" | "out" | "fit"];
  focus: [string];
};

type Listener<A extends unknown[]> = (...args: A) => void;

/**
 * Ponte entre React e Phaser. O React é dono dos dados (vindos da API e do Socket.IO);
 * o jogo só desenha. O último `sync` fica guardado para a cena aplicar quando terminar de carregar.
 */
export class OfficeBridge {
  private readonly toUi = new Map<keyof GameToUi, Set<Listener<never[]>>>();
  private readonly toGame = new Map<keyof UiToGame, Set<Listener<never[]>>>();
  lastAgents: OfficeAgent[] = [];

  onUi<K extends keyof GameToUi>(event: K, fn: Listener<GameToUi[K]>) {
    return this.on(this.toUi, event, fn);
  }
  emitUi<K extends keyof GameToUi>(event: K, ...args: GameToUi[K]) {
    this.emit(this.toUi, event, args);
  }
  onGame<K extends keyof UiToGame>(event: K, fn: Listener<UiToGame[K]>) {
    return this.on(this.toGame, event, fn);
  }
  emitGame<K extends keyof UiToGame>(event: K, ...args: UiToGame[K]) {
    if (event === "sync") this.lastAgents = args[0] as OfficeAgent[];
    this.emit(this.toGame, event, args);
  }

  private on<M extends Map<PropertyKey, Set<Listener<never[]>>>>(map: M, event: PropertyKey, fn: unknown) {
    if (!map.has(event)) map.set(event, new Set());
    map.get(event)!.add(fn as Listener<never[]>);
    return () => map.get(event)?.delete(fn as Listener<never[]>);
  }
  private emit(map: Map<PropertyKey, Set<Listener<never[]>>>, event: PropertyKey, args: unknown[]) {
    map.get(event)?.forEach((fn) => (fn as (...a: unknown[]) => void)(...args));
  }

  clear() {
    this.toUi.clear();
    this.toGame.clear();
  }
}

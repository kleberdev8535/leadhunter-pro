import Phaser from "phaser";
import { FURNITURE, MAP_H, MAP_W, ROOMS, STATIONS, TILES, isFloor } from "../map/OfficeMap";
import { CollisionSystem } from "../systems/CollisionSystem";
import { StationOccupancy } from "../systems/StationOccupancy";
import { InteractionSystem } from "../systems/InteractionSystem";
import { AgentController } from "../controllers/AgentController";
import { GameScene } from "./GameScene";
import { ANCHORS } from "./PreloadScene";
import { WORLD_H, WORLD_W, depthOf, tileCenter, toScreen } from "../iso/iso";
import type { OfficeAgent } from "../bridge";

/** Cena principal em vista isométrica: piso, paredes, móveis e agentes. */
export class OfficeScene extends GameScene {
  private collision!: CollisionSystem;
  private occupancy!: StationOccupancy;
  private interaction!: InteractionSystem;
  private readonly agents = new Map<string, AgentController>();
  private readonly monitors = new Map<string, Phaser.GameObjects.Sprite>();
  private fitZoom = 1;
  /** Placas com o nome das salas: tamanho fixo na tela, independente do zoom. */
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private lastZoom = -1;
  private zoomedByUser = false;

  constructor() {
    super("office");
  }

  create() {
    this.setupLifecycle();
    this.collision = new CollisionSystem();
    this.occupancy = new StationOccupancy();
    this.interaction = new InteractionSystem(this, this.bridge);

    this.drawFloor();
    this.drawWalls();
    this.drawFurniture();
    this.drawLabels();
    this.setupCamera();

    this.listen(this.bridge.onGame("sync", (agents) => this.syncAgents(agents)));
    this.listen(this.bridge.onGame("progress", (id, pct) => this.agents.get(id)?.setProgress(pct)));
    this.listen(this.bridge.onGame("celebrate", (id) => this.agents.get(id)?.celebrate()));
    this.listen(this.bridge.onGame("zoom", (z) => this.zoom(z)));
    this.listen(this.bridge.onGame("focus", (id) => this.focus(id)));
    this.syncAgents(this.bridge.lastAgents);
    this.bridge.emitUi("ready");
  }

  /** Coloca uma textura isométrica com o canto de trás do tile (x, y) no lugar certo. */
  private placeIso(key: string, x: number, y: number, depth: number, frame?: number) {
    const a = ANCHORS.get(key) ?? { x: 0, y: 0 };
    const p = toScreen(x, y);
    const obj = frame === undefined ? this.add.image(p.x - a.x, p.y - a.y, key) : this.add.sprite(p.x - a.x, p.y - a.y, key, frame);
    return obj.setOrigin(0, 0).setDepth(depth);
  }

  private drawFloor() {
    const rt = this.add.renderTexture(0, 0, WORLD_W, WORLD_H).setOrigin(0).setDepth(-1000);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = TILES[y]![x]!;
        if (!isFloor(t)) continue;
        const kind = t === "door" ? "door" : t.slice(6);
        const p = toScreen(x, y);
        rt.draw(`floor:${kind}:${(x + y) % 2 ? "b" : "a"}`, p.x - 16, p.y);
      }
    }
    // Tapetes (losangos sobre o piso).
    const g = this.add.graphics().setDepth(-999);
    const rug = (x: number, y: number, w: number, h: number, color: number, border: number) => {
      const pts = [toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + h), toScreen(x, y + h)];
      g.fillStyle(border, 1).fillPoints(pts.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true);
      const inset = [toScreen(x + 0.2, y + 0.2), toScreen(x + w - 0.2, y + 0.2), toScreen(x + w - 0.2, y + h - 0.2), toScreen(x + 0.2, y + h - 0.2)];
      g.fillStyle(color, 1).fillPoints(inset.map((p) => new Phaser.Math.Vector2(p.x, p.y)), true);
    };
    rug(32, 4, 7, 5, 0x8a3416, 0xd9a441);
    rug(3, 24, 4, 3, 0x4f46e5, 0xa5b4fc);
    rug(34, 21, 4, 3, 0xf3e3b8, 0xc9a96b);
  }

  private drawWalls() {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = TILES[y]![x]!;
        if (isFloor(t)) continue;
        // Paredes do fundo (norte e oeste) altas; as da frente e divisórias baixas, para não esconder ninguém.
        const back = y <= 1 || x === 0;
        const key = back ? (t === "window" ? "wall:window" : "wall:tall") : "wall:low";
        this.placeIso(key, x, y, depthOf(x, y, 2));
      }
    }
  }

  private drawFurniture() {
    for (const f of FURNITURE) {
      const depth = depthOf(f.x + f.w - 1, f.y + f.h - 1, 3);
      if (f.type === "server") {
        (this.placeIso("furn:server", f.x, f.y, depth, 0) as Phaser.GameObjects.Sprite).play("server:blink");
        continue;
      }
      this.placeIso(`furn:${f.type}`, f.x, f.y, depth);
    }
    for (const s of STATIONS) {
      const desk = FURNITURE.find((f) => f.id === s.deskId)!;
      const mx = desk.type === "bigDesk" ? desk.x + 1 : desk.x;
      const monitor = this.placeIso("furn:monitor", mx, desk.y, depthOf(desk.x + desk.w - 1, desk.y, 3.5), 0) as Phaser.GameObjects.Sprite;
      this.monitors.set(s.id, monitor);
      // Encosto da cadeira por cima de quem está sentado (camada 6 > pessoa sentada 4).
      this.placeIso("furn:chair", s.seat.x, s.seat.y, depthOf(s.seat.x, s.seat.y, 6));
    }
  }

  private drawLabels() {
    for (const r of ROOMS) {
      if (!r.name) continue;
      // Centro da sala; a placa fica acima de tudo (paredes, móveis e agentes) para nunca sumir.
      const c = tileCenter(r.x + r.w / 2 - 0.5, r.y + r.h / 2 - 0.5);
      const label = this.add
        .text(c.x, c.y, r.name, {
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "12px",
          fontStyle: "bold",
          color: "#ffffff",
          backgroundColor: "#1b1f2acc",
          padding: { x: 7, y: 3 },
        })
        .setOrigin(0.5)
        .setResolution(3)
        .setAlpha(0.92)
        .setDepth(1_000_000);
      this.labels.push(label);
    }
  }

  /** Mantém placas e nomes legíveis: compensam o zoom da câmera (tamanho constante na tela). */
  private applyUiScale() {
    const zoom = this.cameras.main.zoom;
    if (zoom === this.lastZoom) return;
    this.lastZoom = zoom;
    const s = 1 / zoom;
    for (const l of this.labels) l.setScale(s);
    for (const a of this.agents.values()) a.setUiScale(s);
  }

  /** O monitor só liga quando alguém está de fato trabalhando naquela estação. */
  private setMonitor = (stationId: string, on: boolean) => {
    const m = this.monitors.get(stationId);
    if (!m) return;
    if (on) m.play("monitor:on", true);
    else m.stop().setFrame(0);
  };

  private syncAgents(list: OfficeAgent[]) {
    const ids = new Set(list.map((a) => a.id));
    for (const [id, ctrl] of this.agents) {
      if (!ids.has(id)) {
        ctrl.destroy();
        this.agents.delete(id);
      }
    }
    for (const a of list) {
      const existing = this.agents.get(a.id);
      if (existing) existing.update(a);
      else {
        const ctrl = new AgentController(this, a, this.collision, this.occupancy, this.setMonitor);
        ctrl.setUiScale(1 / this.cameras.main.zoom);
        this.agents.set(a.id, ctrl);
        this.interaction.attach(ctrl);
      }
    }
  }

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBackgroundColor("#20243a");
    cam.setRoundPixels(true);
    const fit = () => {
      this.fitZoom = Math.max(0.4, Math.min(this.scale.width / WORLD_W, this.scale.height / WORLD_H));
      if (cam.zoom < this.fitZoom || !this.zoomedByUser) cam.setZoom(this.fitZoom);
      cam.centerOn(WORLD_W / 2, WORLD_H / 2);
    };
    fit();
    this.scale.on(Phaser.Scale.Events.RESIZE, fit);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, fit));

    let drag: { x: number; y: number; sx: number; sy: number } | null = null;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      drag = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (!drag || !p.isDown) return;
      cam.setScroll(drag.sx - (p.x - drag.x) / cam.zoom, drag.sy - (p.y - drag.y) / cam.zoom);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => (drag = null));
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoom(dy > 0 ? "out" : "in"));
  }

  private zoom(z: "in" | "out" | "fit") {
    const cam = this.cameras.main;
    if (z === "fit") {
      this.zoomedByUser = false;
      cam.setZoom(this.fitZoom);
      cam.centerOn(WORLD_W / 2, WORLD_H / 2);
      return;
    }
    this.zoomedByUser = true;
    cam.zoomTo(Phaser.Math.Clamp(cam.zoom * (z === "in" ? 1.25 : 0.8), this.fitZoom, 6), 120);
  }

  private focus(id: string) {
    const a = this.agents.get(id);
    if (!a) return;
    this.zoomedByUser = true;
    const cam = this.cameras.main;
    cam.zoomTo(Math.max(cam.zoom, this.fitZoom * 2.2), 250);
    cam.pan(a.container.x, a.container.y - 24, 250, "Sine.easeInOut");
  }

  update(_time: number, delta: number) {
    const now = this.time.now;
    for (const a of this.agents.values()) a.tick(delta, now);
    this.applyUiScale();
    this.interaction.update();
  }
}

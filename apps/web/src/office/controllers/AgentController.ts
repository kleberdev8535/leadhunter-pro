import Phaser from "phaser";
import { TILE, stationById, roomAt } from "../map/OfficeMap";
import type { CollisionSystem, Point } from "../systems/CollisionSystem";
import type { StationOccupancy } from "../systems/StationOccupancy";
import { AgentMovementController } from "./AgentMovementController";
import { animKey, isoView } from "../animations/AnimationManager";
import { depthOf, tileCenter } from "../iso/iso";
import { CHAR_H } from "../sprites/iso-characters";
import { behaviorFor, type AgentStatus, type Behavior } from "../agents/behavior";
import type { OfficeAgent } from "../bridge";

type Mode = "walking" | "seated" | "standing" | "celebrating";

/**
 * Um agente no mapa. Recebe o status real do backend, decide o destino (estação ou descanso)
 * e a pose ao chegar. Não tem nenhuma lógica própria de "fingir trabalho".
 */
export class AgentController {
  readonly container: Phaser.GameObjects.Container;
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly tag: Phaser.GameObjects.Text;
  private readonly badge: Phaser.GameObjects.Image;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly move: AgentMovementController;
  private behavior: Behavior;
  private mode: Mode = "standing";
  private progress: number | null = null;
  private nextWander = 0;
  private seatedAt: string | null = null;
  status: AgentStatus;

  constructor(
    private readonly scene: Phaser.Scene,
    public data: OfficeAgent,
    private readonly collision: CollisionSystem,
    private readonly occupancy: StationOccupancy,
    private readonly onMonitor: (stationId: string, on: boolean) => void,
  ) {
    this.status = data.status;
    this.behavior = behaviorFor(data.status);
    const start = this.resolveTarget() ?? { x: 37, y: 23 };
    this.move = new AgentMovementController(data.id, collision, start);

    // Origem do container = pés do personagem no centro do losango do tile.
    this.shadow = scene.add.ellipse(0, -1, 18, 7, 0x141824, 0.3);
    this.sprite = scene.add.sprite(0, 0, `agent:${data.kind}`, 0).setOrigin(0.5, 1);
    this.badge = scene.add.image(0, -CHAR_H - 14, "badge:waiting").setOrigin(0.5, 1).setVisible(false);
    this.bar = scene.add.graphics();
    this.tag = scene.add
      .text(0, -CHAR_H + 4, data.name, { fontFamily: "Inter, system-ui, sans-serif", fontSize: "11px", fontStyle: "bold", color: "#ffffff", backgroundColor: "#1b1f2ae6", padding: { x: 5, y: 2 } })
      .setOrigin(0.5, 1)
      .setResolution(3);
    this.container = scene.add.container(0, 0, [this.shadow, this.sprite, this.badge, this.bar, this.tag]);
    this.container.setSize(26, CHAR_H);
    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });

    // Estado inicial aplicado sem caminhada: a tela abre mostrando onde cada um realmente está.
    this.arrive();
    this.sync();
  }

  get id() {
    return this.data.id;
  }

  /** Destino conforme o comportamento atual (reserva cadeira/lugar). */
  private resolveTarget(): Point | null {
    if (this.behavior.place === "station") {
      this.occupancy.releaseLoungeSpot(this.id);
      const station = this.occupancy.claimStation(this.id, this.data.station);
      return station ? station.seat : null;
    }
    if (this.behavior.place === "lounge") {
      this.occupancy.releaseStation(this.id);
      return this.occupancy.claimLoungeSpot(this.id, this.data.name.length);
    }
    this.occupancy.releaseStation(this.id);
    this.occupancy.releaseLoungeSpot(this.id);
    return null;
  }

  update(agent: OfficeAgent) {
    const changed = agent.status !== this.status;
    this.data = agent;
    this.progress = agent.progress;
    if (!changed) return this.sync();
    this.status = agent.status;
    this.behavior = behaviorFor(agent.status);
    this.retarget();
  }

  /** Nome, balão e barra com tamanho constante na tela (a cena passa 1/zoom). */
  setUiScale(s: number) {
    this.tag.setScale(s);
    this.badge.setScale(s);
    this.bar.setScale(s);
    // Empilha acima da cabeça: nome (≈17px) → barra de progresso → balão de status, sem sobreposição.
    const top = -CHAR_H + 4;
    this.bar.setY(top - 23 * s + s * (CHAR_H + 6));
    this.badge.setY(top - (this.behavior.showProgress ? 27 : 20) * s);
  }

  setProgress(pct: number) {
    this.progress = pct;
    this.drawBar();
  }

  /** Comemoração só acontece quando o backend avisa que uma tarefa terminou de verdade. */
  celebrate() {
    if (this.mode === "walking") return;
    this.leaveSeat();
    this.mode = "celebrating";
    this.sprite.setFlipX(false);
    this.sprite.play(animKey(this.data.kind, "celebrate"));
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.mode = "standing";
      this.retarget();
    });
  }

  private retarget() {
    if (this.mode === "celebrating") return;
    const target = this.resolveTarget();
    this.container.setVisible(this.behavior.place !== "none");
    if (!target) return this.sync();
    const here = this.move.tile;
    if (!this.move.moving && here.x === target.x && here.y === target.y) return this.arrive();
    this.leaveSeat();
    this.mode = "walking";
    this.move.goTo(target, () => this.arrive());
    this.sync();
  }

  private leaveSeat() {
    if (this.seatedAt) this.onMonitor(this.seatedAt, false);
    this.seatedAt = null;
  }

  private arrive() {
    const atStation = this.behavior.place === "station" ? this.occupancy.stationOf(this.id) : null;
    const pose = this.behavior.pose;
    if (atStation && pose !== "stand") {
      this.mode = "seated";
      this.seatedAt = atStation;
      this.onMonitor(atStation, pose === "type");
      // Sentado de frente para a mesa (nordeste): vista de costas espelhada.
      this.sprite.setFlipX(true);
      this.sprite.play(animKey(this.data.kind, pose === "type" ? "type" : "sit"));
    } else {
      this.leaveSeat();
      this.mode = "standing";
      this.move.dir = atStation ? "up" : "down";
      this.face(this.move.dir, "idle");
    }
    this.nextWander = this.scene.time.now + 5000 + Math.random() * 6000;
    this.sync();
  }

  private sync() {
    const b = this.behavior.badge;
    this.badge.setVisible(b !== "none");
    if (b !== "none") this.badge.setTexture(`badge:${b}`);
    this.drawBar();
  }

  private drawBar() {
    this.bar.clear();
    if (!this.behavior.showProgress || this.progress === null) return;
    const w = 22;
    const y = -CHAR_H - 6;
    this.bar.fillStyle(0x1b1f2a, 1).fillRect(-w / 2 - 1, y, w + 2, 5);
    this.bar.fillStyle(0x334155, 1).fillRect(-w / 2, y + 1, w, 3);
    this.bar.fillStyle(0x22c55e, 1).fillRect(-w / 2, y + 1, Math.max(1, Math.round((w * this.progress) / 100)), 3);
  }

  /** Aplica a vista isométrica da direção (frente/costas + espelho). */
  private face(dir: "down" | "left" | "right" | "up", kind: "idle" | "walk") {
    const { view, flip } = isoView(dir);
    this.sprite.setFlipX(flip);
    const key = animKey(this.data.kind, `${kind}-${view}`);
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key);
  }

  tick(delta: number, now: number) {
    const walking = this.move.update(delta, now);
    if (walking && this.mode === "walking") this.face(this.move.dir, "walk");
    // Pequenas voltas na sala de descanso, só quando o agente está livre.
    if (!walking && this.mode === "standing" && this.behavior.wander && now > this.nextWander) {
      this.occupancy.releaseLoungeSpot(this.id);
      const spot = this.occupancy.claimLoungeSpot(this.id, Math.floor(Math.random() * 7));
      if (spot && roomAt(spot.x, spot.y)?.id === "lounge") {
        this.mode = "walking";
        this.move.goTo(spot, () => this.arrive());
      } else this.nextWander = now + 4000;
    }

    const seated = this.mode === "seated";
    // Grade (px) → tile fracionário → tela isométrica (centro do losango = pés).
    const tx = this.move.pos.x / TILE;
    const ty = this.move.pos.y / TILE;
    const p = tileCenter(tx, ty);
    this.container.setPosition(Math.round(p.x), Math.round(p.y + (seated ? -4 : 0)));
    this.shadow.setVisible(!seated);
    // Sentado fica atrás do encosto da cadeira (camada 6); em pé, à frente dos móveis do mesmo tile.
    this.container.setDepth(depthOf(tx, ty, seated ? 4 : 5));
  }

  screenPoint(camera: Phaser.Cameras.Scene2D.Camera) {
    const x = (this.container.x - camera.worldView.x) * camera.zoom;
    const y = (this.container.y - CHAR_H - camera.worldView.y) * camera.zoom;
    return { x, y };
  }

  destroy() {
    this.leaveSeat();
    this.collision.releaseAll(this.id);
    this.occupancy.releaseStation(this.id);
    this.occupancy.releaseLoungeSpot(this.id);
    this.container.destroy();
  }

  static stationExists(id: string) {
    return !!stationById(id);
  }
}

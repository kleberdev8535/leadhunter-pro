import Phaser from "phaser";
import type { OfficeBridge } from "../bridge";
import type { AgentController } from "../controllers/AgentController";

const DOUBLE_CLICK_MS = 320;

/** Hover, clique e duplo clique nos personagens, repassados ao React pela ponte. */
export class InteractionSystem {
  private lastClick = new Map<string, number>();
  private hovered: AgentController | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly bridge: OfficeBridge,
  ) {}

  attach(agent: AgentController) {
    agent.sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => {
      this.hovered = agent;
      agent.sprite.setTint(0xe0e7ff);
      this.emitHover();
    });
    agent.sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
      if (this.hovered === agent) this.hovered = null;
      agent.sprite.clearTint();
      this.bridge.emitUi("hover", null);
    });
    agent.sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      const now = this.scene.time.now;
      const last = this.lastClick.get(agent.id) ?? 0;
      this.lastClick.set(agent.id, now);
      if (now - last < DOUBLE_CLICK_MS) this.bridge.emitUi("dblclick", agent.id);
      else this.bridge.emitUi("click", agent.id);
    });
  }

  /** Mantém o tooltip acompanhando o personagem enquanto ele anda. */
  update() {
    if (this.hovered) this.emitHover();
  }

  private emitHover() {
    if (!this.hovered) return;
    const p = this.hovered.screenPoint(this.scene.cameras.main);
    this.bridge.emitUi("hover", { id: this.hovered.id, x: p.x, y: p.y });
  }
}

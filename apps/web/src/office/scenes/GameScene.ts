import Phaser from "phaser";
import type { OfficeBridge } from "../bridge";

/** Base das cenas jogáveis: acesso tipado à ponte com o React e limpeza no shutdown. */
export abstract class GameScene extends Phaser.Scene {
  private unsubscribers: (() => void)[] = [];

  protected get bridge(): OfficeBridge {
    return this.registry.get("bridge") as OfficeBridge;
  }

  /** Inscreve um listener que é removido automaticamente quando a cena encerra. */
  protected listen(unsubscribe: () => void) {
    this.unsubscribers.push(unsubscribe);
  }

  protected setupLifecycle() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribers.forEach((u) => u());
      this.unsubscribers = [];
    });
  }
}

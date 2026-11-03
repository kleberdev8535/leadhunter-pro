import Phaser from "phaser";
import { ISO_FRAMES } from "../sprites/iso-characters";

export type Dir = "down" | "left" | "right" | "up";
export const animKey = (kind: string, name: string) => `${kind}:${name}`;

/**
 * Direção na grade → vista isométrica. Andar em +y (baixo) = sudoeste (de frente); +x (direita) = sudeste
 * (de frente, espelhado); -x = noroeste (de costas); -y = nordeste (de costas, espelhado).
 */
export function isoView(dir: Dir): { view: "front" | "back"; flip: boolean } {
  switch (dir) {
    case "down": return { view: "front", flip: false };
    case "right": return { view: "front", flip: true };
    case "left": return { view: "back", flip: false };
    case "up": return { view: "back", flip: true };
  }
}

/** Registra as animações de um agente a partir da folha isométrica gerada. */
export function registerAgentAnimations(scene: Phaser.Scene, kind: string) {
  const sheet = `agent:${kind}`;
  const mk = (name: string, frames: readonly number[], frameRate: number, repeat: number) => {
    const key = animKey(kind, name);
    if (scene.anims.exists(key)) return;
    scene.anims.create({ key, frames: frames.map((frame) => ({ key: sheet, frame })), frameRate, repeat });
  };
  mk("walk-front", ISO_FRAMES.frontWalk, 8, -1);
  mk("walk-back", ISO_FRAMES.backWalk, 8, -1);
  mk("idle-front", [ISO_FRAMES.frontStand, ISO_FRAMES.frontStand, ISO_FRAMES.frontBreath, ISO_FRAMES.frontBreath], 3, -1);
  mk("idle-back", [ISO_FRAMES.backStand, ISO_FRAMES.backStand, ISO_FRAMES.backBreath, ISO_FRAMES.backBreath], 3, -1);
  mk("type", ISO_FRAMES.type, 5, -1);
  mk("sit", [ISO_FRAMES.sit, ISO_FRAMES.sit, ISO_FRAMES.sit, ISO_FRAMES.sitBreath], 2.5, -1);
  mk("celebrate", ISO_FRAMES.celebrate, 6, 3);
  mk("wave", [ISO_FRAMES.wave, ISO_FRAMES.frontStand, ISO_FRAMES.wave], 4, 0);
}

export function registerSceneryAnimations(scene: Phaser.Scene) {
  if (!scene.anims.exists("monitor:on")) {
    scene.anims.create({ key: "monitor:on", frames: [{ key: "furn:monitor", frame: 1 }, { key: "furn:monitor", frame: 2 }], frameRate: 3, repeat: -1 });
  }
  if (!scene.anims.exists("server:blink")) {
    scene.anims.create({ key: "server:blink", frames: [{ key: "furn:server", frame: 0 }, { key: "furn:server", frame: 1 }], frameRate: 2, repeat: -1 });
  }
}

import Phaser from "phaser";
import type { OfficeBridge } from "./bridge";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { OfficeScene } from "./scenes/OfficeScene";

/** Cria a instância do jogo dentro do container. Quem chama destrói no unmount. */
export function createOfficeGame(parent: HTMLElement, bridge: OfficeBridge) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#1b1f2a",
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 800, height: parent.clientHeight || 500 },
    input: { keyboard: false },
    audio: { noAudio: true },
    banner: false,
    scene: [BootScene, PreloadScene, OfficeScene],
  });
  game.registry.set("bridge", bridge);
  if (import.meta.env.DEV) (window as unknown as { __officeGame?: Phaser.Game }).__officeGame = game;
  return game;
}

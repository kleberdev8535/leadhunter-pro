import Phaser from "phaser";

/** Primeira cena: só confirma a configuração e segue para a geração de texturas. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create() {
    this.game.canvas.setAttribute("aria-label", "Mapa do escritório virtual");
    this.game.canvas.style.imageRendering = "pixelated";
    this.scene.start("preload");
  }
}

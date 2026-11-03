import Phaser from "phaser";
import { CHAR_H, CHAR_W, ISO_LOOKS, buildIsoCharacterSheet } from "../sprites/iso-characters";
import { buildFloorTextures, buildIsoFurniture, buildIsoMonitor, buildIsoServer, buildWallTextures, type IsoTexture } from "../sprites/iso-scenery";
import { buildBadgeTextures } from "../sprites/badges";
import { registerAgentAnimations, registerSceneryAnimations } from "../animations/AnimationManager";

/** Pontos de ancoragem de cada textura isométrica (canto de trás do tile no chão). */
export const ANCHORS = new Map<string, { x: number; y: number }>();

/** Gera todos os assets (pixel art isométrica original em canvas) e registra as animações. */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("preload");
  }

  private addCanvas(key: string, canvas: HTMLCanvasElement) {
    if (!this.textures.exists(key)) this.textures.addCanvas(key, canvas);
  }

  private addIso(key: string, t: IsoTexture) {
    this.addCanvas(key, t.canvas);
    ANCHORS.set(key, { x: t.anchorX, y: t.anchorY });
  }

  private addSheet(key: string, canvas: HTMLCanvasElement, fw: number, fh: number) {
    if (this.textures.exists(key)) return;
    const tex = this.textures.addCanvas(key, canvas)!;
    const cols = Math.floor(canvas.width / fw);
    const rows = Math.floor(canvas.height / fh);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tex.add(r * cols + c, 0, c * fw, r * fh, fw, fh);
  }

  create() {
    for (const [k, c] of Object.entries(buildFloorTextures())) this.addCanvas(`floor:${k}`, c);
    for (const [k, t] of Object.entries(buildWallTextures())) this.addIso(`wall:${k}`, t);
    for (const [k, t] of Object.entries(buildIsoFurniture())) this.addIso(`furn:${k}`, t);
    const monitor = buildIsoMonitor();
    this.addSheet("furn:monitor", monitor.canvas, monitor.frameW, monitor.frameH);
    ANCHORS.set("furn:monitor", { x: monitor.anchorX, y: monitor.anchorY });
    const server = buildIsoServer();
    this.addSheet("furn:server", server.canvas, server.frameW, server.frameH);
    ANCHORS.set("furn:server", { x: server.anchorX, y: server.anchorY });
    for (const [k, c] of Object.entries(buildBadgeTextures())) this.addCanvas(`badge:${k}`, c);
    for (const [kind, look] of Object.entries(ISO_LOOKS)) {
      this.addSheet(`agent:${kind}`, buildIsoCharacterSheet(look), CHAR_W, CHAR_H);
      registerAgentAnimations(this, kind);
    }
    registerSceneryAnimations(this);
    this.scene.start("office");
  }
}

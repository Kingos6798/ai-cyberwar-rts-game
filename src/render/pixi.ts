// Default renderer: top-down 2D with PixiJS (the Phase 1 greybox), moved out of main.ts unchanged.
import { Application, Container, Graphics } from 'pixi.js';
import { TILE } from '../sim/index.ts';
import { drawWorld } from './draw.ts';
import { drawEffects } from './effects.ts';
import { viewport, type Frame, type Renderer, type ScreenBox } from './renderer.ts';

export async function createPixiRenderer(mapWidth: number, mapHeight: number): Promise<Renderer> {
  const app = new Application();
  // The game loop in main.ts calls render() once per frame, so Pixi's own ticker stays off.
  await app.init({ resizeTo: window, background: '#060910', antialias: true, autoStart: false });
  document.body.appendChild(app.canvas);
  const stage = new Container();
  const g = new Graphics();
  const fxLayer = new Graphics();
  const boxG = new Graphics();
  // Effects glow: additive blending brightens where light overlaps.
  fxLayer.blendMode = 'add';
  stage.addChild(g, fxLayer);
  app.stage.addChild(stage, boxG);

  // Camera: world units -> screen pixels.
  const cam = { x: 0, y: 0, zoom: 1 };
  const toWorld = (sx: number, sy: number): [number, number] => [Math.round(cam.x + sx / cam.zoom), Math.round(cam.y + sy / cam.zoom)];

  return {
    canvas: app.canvas,
    toWorld,
    toScreen: (x, y) => [(x - cam.x) * cam.zoom, (y - cam.y) * cam.zoom],
    pan(dx, dy) {
      cam.x -= dx / cam.zoom;
      cam.y -= dy / cam.zoom;
    },
    zoomAt(sx, sy, factor) {
      const [wx, wy] = toWorld(sx, sy);
      cam.zoom *= factor;
      cam.x = wx - sx / cam.zoom;
      cam.y = wy - sy / cam.zoom;
    },
    fit() {
      const vp = viewport(app.screen.width, app.screen.height);
      cam.zoom = Math.min(vp.width / (mapWidth * TILE), vp.height / (mapHeight * TILE)) * 0.95;
      cam.x = (mapWidth * TILE) / 2 - (vp.left + vp.width / 2) / cam.zoom;
      cam.y = (mapHeight * TILE) / 2 - vp.height / 2 / cam.zoom;
    },
    setBox(box: ScreenBox | null) {
      boxG.clear();
      if (box) {
        boxG.rect(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1), Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0))
          .stroke({ width: 1, color: 0xffffff });
      }
    },
    render({ world, view, selected, fx, now }: Frame) {
      stage.scale.set(cam.zoom);
      stage.position.set(-cam.x * cam.zoom, -cam.y * cam.zoom);
      drawWorld(g, world, view, selected);
      drawEffects(fxLayer, view, fx, now);
      app.render();
    },
  };
}

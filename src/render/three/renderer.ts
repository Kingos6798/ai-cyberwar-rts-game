// Three.js renderer prototype (M4.0 renderer spike, issue #7, D-017): a tilted perspective RTS view
// with low-poly meshes built in code, soft shadows and a fog texture. Selected with ?renderer=three.
// main.ts owns the animation loop and calls render() once per frame.
import {
  ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PCFShadowMap, Scene, WebGLRenderer,
} from 'three';
import type { Frame, Renderer, ScreenBox } from '../renderer.ts';
import { createBuildingLayer } from './buildings.ts';
import { createRtsCamera } from './camera.ts';
import { createGroundLayer } from './ground.ts';
import { createOverlayLayer } from './overlays.ts';
import { createSiteLayer } from './sites.ts';
import { createUnitLayer } from './units.ts';

export async function createThreeRenderer(mapWidth: number, mapHeight: number): Promise<Renderer> {
  const gl = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = PCFShadowMap;
  gl.toneMapping = ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.0;
  const canvas = gl.domElement;
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.display = 'block';
  document.body.appendChild(canvas);

  const scene = new Scene();
  scene.background = new Color(0x060910);
  scene.add(new HemisphereLight(0xa9c4ef, 0x0b1220, 0.75));
  // A cool blue rim light from the far side gives the low-poly meshes the console-glow edge of the 2D views.
  const rim = new DirectionalLight(0x4aa3ff, 0.55);
  rim.position.set(-40, 25, -30);
  scene.add(rim);
  const sun = new DirectionalLight(0xfff1dd, 2.4);
  sun.position.set(mapWidth / 2 - 18, 40, mapHeight / 2 + 22);
  sun.target.position.set(mapWidth / 2, 0, mapHeight / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const half = Math.max(mapWidth, mapHeight) * 0.62;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 120 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const cam = createRtsCamera(mapWidth, mapHeight);
  const ground = createGroundLayer(scene, mapWidth, mapHeight);
  const sites = createSiteLayer(scene);
  const buildings = createBuildingLayer(scene);
  const units = createUnitLayer(scene);
  const overlays = createOverlayLayer(scene, cam.camera);

  // Drag-select rectangle as a DOM box over the canvas.
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', border: '1px solid #fff', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none', display: 'none', zIndex: '5' });
  document.body.appendChild(box);

  const resize = () => {
    gl.setSize(window.innerWidth, window.innerHeight);
    cam.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  let lastNow = performance.now();
  return {
    canvas,
    toWorld: cam.toWorld,
    toScreen: cam.toScreen,
    pan: cam.pan,
    zoomAt: cam.zoomAt,
    fit: cam.fit,
    setBox(b: ScreenBox | null) {
      if (!b) { box.style.display = 'none'; return; }
      Object.assign(box.style, { display: 'block', left: `${Math.min(b.x0, b.x1)}px`, top: `${Math.min(b.y0, b.y1)}px`,
        width: `${Math.abs(b.x1 - b.x0)}px`, height: `${Math.abs(b.y1 - b.y0)}px` });
    },
    render({ world, view, selected, fx, now }: Frame) {
      const dt = Math.min(250, Math.max(0, now - lastNow));
      lastNow = now;
      ground.update(view, dt);
      sites.update(world, view, now);
      buildings.update(view);
      units.update(view, fx.flashes, now);
      overlays.update(world, view, selected, fx, now);
      gl.render(scene, cam.camera);
    },
  };
}

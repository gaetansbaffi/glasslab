/*
 * Glass Lab — rendu 3D (Three.js) : scène, lumière, ombres des joueurs, caméra.
 *
 * Le soleil vient de derrière ton équipe : ton ombre se projette devant toi sur le court, un repère
 * de position visible en 1re personne. Seuls les joueurs projettent une ombre (carte d'ombres unique) ;
 * la balle a son ombre ronde à la verticale (lecture de la hauteur et de la profondeur).
 */
import * as THREE from 'three';
import G from '../core/geometry.js';
import { buildCourt, COLORS } from './court.js';
import { createFigures } from './figures.js';
import { createBallView } from './ball.js';

/**
 * Crée le rendu dans `canvas` pour `players` joueurs. Lève une exception si WebGL n'est pas disponible.
 * opts = { antialias, players }
 */
export function createRenderer(canvas, opts) {
  opts = opts || {};
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !!opts.antialias, powerPreference: 'high-performance', alpha: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const disposables = [];
  const track = (o) => (disposables.push(o), o);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.sky, 34, 80);
  scene.add(new THREE.HemisphereLight(0xf2f8ff, 0x22303e, 1.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  // Derrière l'équipe du bas, en hauteur (≈ 55°), légèrement de côté
  G.worldToSceneInto(sun.position, 3.2, -9, 15);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -14;
  sc.right = 14;
  sc.top = 14;
  sc.bottom = -14;
  sc.near = 1;
  sc.far = 50;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const court = buildCourt(track);
  scene.add(court.group);
  const figures = createFigures(scene, track, opts.players ?? 4);
  const ballView = createBallView(scene, track);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.04, 90);
  const size = { w: 1, h: 1 };
  const tmp = new THREE.Vector3();

  /**
   * Caméra : cam = { eye {x,y,z}, yaw, pitch, vFov } (1re personne : regard sans roulis)
   *          ou { eye, target {x,y,z}, vFov, topDown } (vues du Détail).
   * shift = { x, y } : décalage de l'image (fraction d'écran) quand un panneau couvre une partie de l'écran.
   */
  function setCamera(cam, shift) {
    camera.fov = cam.vFov;
    camera.aspect = size.w / size.h;
    if (cam.topDown) camera.up.set(0, 0, -1); // vue de dessus : le filet en haut de l'écran
    else camera.up.set(0, 1, 0); // horizon stable, jamais de roulis
    G.worldToSceneInto(camera.position, cam.eye.x, cam.eye.y, cam.eye.z);
    if (cam.target) camera.lookAt(G.worldToSceneInto(tmp, cam.target.x, cam.target.y, cam.target.z));
    else {
      const c = Math.cos(cam.pitch);
      camera.lookAt(G.worldToSceneInto(tmp, cam.eye.x + Math.sin(cam.yaw) * c, cam.eye.y + Math.cos(cam.yaw) * c, cam.eye.z + Math.sin(cam.pitch)));
    }
    if (shift && (shift.x || shift.y)) camera.setViewOffset(size.w, size.h, shift.x * size.w, shift.y * size.h, size.w, size.h);
    else if (camera.view) camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  const proj = new THREE.Vector3();
  /** Projection d'un point monde à l'écran (pixels CSS) ; visible = devant la caméra et dans l'image. */
  function project(p, out) {
    G.worldToSceneInto(proj, p.x, p.y, p.z);
    proj.project(camera);
    out = out || {};
    out.x = ((proj.x + 1) / 2) * size.w;
    out.y = ((1 - proj.y) / 2) * size.h;
    out.visible = proj.z > -1 && proj.z < 1 && Math.abs(proj.x) <= 1 && Math.abs(proj.y) <= 1;
    return out;
  }

  return {
    renderer,
    figures,
    ball: ballView,
    setCamera,
    project,
    render() {
      figures.commit();
      renderer.render(scene, camera);
    },
    resize(w, h) {
      size.w = Math.max(1, Math.round(w));
      size.h = Math.max(1, Math.round(h));
      renderer.setSize(size.w, size.h, false);
    },
    setPixelRatio(pr) {
      renderer.setPixelRatio(pr);
      renderer.setSize(size.w, size.h, false);
    },
    get pixelRatio() {
      return renderer.getPixelRatio();
    },
    /** Ombres des joueurs : coupées si l'appareil peine même en basse résolution. */
    setShadows(on) {
      if (renderer.shadowMap.enabled === on) return;
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      figures.setShadows(on);
      court.turf.material.needsUpdate = true;
    },
    get shadows() {
      return renderer.shadowMap.enabled;
    },
    dispose() {
      ballView.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}

/** WebGL disponible ? (test sans créer la scène) */
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

/*
 * Glass Lab — court de padel en 3D (Three.js) : gazon, lignes, filet, vitres, grillage et cadres.
 * Construit une seule fois ; aucune allocation pendant le jeu.
 *
 * Positions en repère monde de src/core (x largeur, y profondeur, z hauteur), converties par G.worldToScene.
 */
import * as THREE from 'three';
import G from '../core/geometry.js';
import P from '../core/physics.js';

export const COURT_W = 10;
export const COURT_L = 20;

export const COLORS = {
  sky: 0x9fcdee,
  apron: 0x1d3a55,
  turf: 0x2463b0,
  line: 0xffffff,
  glass: 0xd4f4ff,
  frame: 0x1c2026,
  mesh: 0x9aa6b2,
  net: 0x14181d,
};

/** Nouveau vecteur scène depuis un point monde (construction uniquement, jamais dans la boucle). */
export const sv = (x, y, z) => G.worldToSceneInto(new THREE.Vector3(), x, y, z);

/**
 * Panneaux d'une moitié de court (y ∈ [0, 10]) ; l'autre moitié par symétrie y → 20 − y. Construits
 * depuis physics.COURT (règlement FIP), pour que ce qu'on voit soit ce que la balle touche :
 * fond = vitre 3 m + grille 1 m ; latérales = vitre 3 m sur 2 m, vitre 2 m sur 2 m, grille au-dessus
 * (jusqu'à 4 m puis 3 m) et grille de 3 m jusqu'au filet, percée d'une porte (ouverte) près du filet.
 */
function halfWalls() {
  const C = P.COURT;
  const glass = [{ wall: 'back', from: 0, to: COURT_W, z0: 0, z1: C.backGlassHeight }];
  const mesh = [{ wall: 'back', from: 0, to: COURT_W, z0: C.backGlassHeight, z1: C.backHeight }];
  const doors = [];
  for (const wall of ['left', 'right']) {
    for (const g of C.sideGlass) glass.push({ wall, from: g.from, to: g.to, z0: 0, z1: g.height });
    // Grille : au-dessus des vitres, puis pleine hauteur, sauf l'ouverture de la porte
    const cuts = [0, C.depth];
    for (const g of C.sideGlass) cuts.push(g.from, g.to);
    for (const d of C.doors) cuts.push(d.from, d.to);
    const ys = [...new Set(cuts)].sort((a, b) => a - b);
    for (let i = 0; i + 1 < ys.length; i++) {
      const y0 = ys[i];
      const y1 = ys[i + 1];
      const mid = (y0 + y1) / 2;
      const top = C.sideHeight.find((h) => mid >= h.from && mid <= h.to).height;
      const g = C.sideGlass.find((p) => mid >= p.from && mid <= p.to);
      const d = C.doors.find((p) => mid >= p.from && mid <= p.to);
      const z0 = g ? g.height : d ? d.height : 0;
      if (top > z0) mesh.push({ wall, from: y0, to: y1, z0, z1: top });
      if (d) doors.push({ wall, from: y0, to: y1, height: d.height, top });
    }
  }
  return { glass, mesh, doors };
}
const HALF_WALLS = halfWalls();

function panelCorners(p, half) {
  const my = (y) => (half ? COURT_L - y : y);
  if (p.wall === 'back') {
    const y = my(0);
    return [
      { x: p.from, y, z: p.z0 },
      { x: p.to, y, z: p.z0 },
      { x: p.to, y, z: p.z1 },
      { x: p.from, y, z: p.z1 },
    ];
  }
  const x = p.wall === 'left' ? 0 : COURT_W;
  return [
    { x, y: my(p.from), z: p.z0 },
    { x, y: my(p.to), z: p.z0 },
    { x, y: my(p.to), z: p.z1 },
    { x, y: my(p.from), z: p.z1 },
  ];
}

function quadPositions(corners, out) {
  const pts = corners.map((c) => sv(c.x, c.y, c.z));
  for (const i of [0, 1, 2, 0, 2, 3]) out.push(pts[i].x, pts[i].y, pts[i].z);
}

function meshGridSegments(corners, step, out) {
  const [a, b, , d] = corners;
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const w = { x: d.x - a.x, y: d.y - a.y, z: d.z - a.z };
  const lu = Math.hypot(u.x, u.y, u.z);
  const lw = Math.hypot(w.x, w.y, w.z);
  const at = (s, t) => sv(a.x + u.x * s + w.x * t, a.y + u.y * s + w.y * t, a.z + u.z * s + w.z * t);
  for (let i = 0; i <= Math.round(lu / step); i++) {
    const s = Math.min(1, (i * step) / lu);
    out.push(at(s, 0), at(s, 1));
  }
  for (let j = 0; j <= Math.round(lw / step); j++) {
    const t = Math.min(1, (j * step) / lw);
    out.push(at(0, t), at(1, t));
  }
}

function frameBars() {
  const C = P.COURT;
  const bars = [];
  const T = 0.07;
  const post = (x, y, h) => bars.push({ c: [x, y, h / 2], s: [T, T, h] });
  const railX = (y, x0, x1, z) => bars.push({ c: [(x0 + x1) / 2, y, z], s: [x1 - x0, T, T] });
  const railY = (x, y0, y1, z) => bars.push({ c: [x, (y0 + y1) / 2, z], s: [T, Math.abs(y1 - y0), T] });
  const height = (y) => C.sideHeight.find((h) => y >= h.from && y <= h.to).height;
  for (const half of [0, 1]) {
    const my = (y) => (half ? COURT_L - y : y);
    for (let x = 0; x <= COURT_W; x += 2) post(x, my(0), C.backHeight);
    railX(my(0), 0, COURT_W, C.backGlassHeight);
    railX(my(0), 0, COURT_W, C.backHeight);
    for (const x of [0, COURT_W]) {
      for (const y of [2, 4, 6, 8]) post(x, my(y), height(y));
      for (const g of C.sideGlass) railY(x, my(g.from), my(g.to), g.height);
      for (const h of C.sideHeight) railY(x, my(h.from), my(h.to), h.height);
      // Porte : montants et linteau
      for (const d of C.doors) {
        post(x, my(d.from), height(d.from));
        post(x, my(d.to), height(d.to));
        railY(x, my(d.from), my(d.to), d.height);
      }
    }
  }
  // Poteaux du filet
  bars.push({ c: [-0.05, 10, 0.5], s: [0.09, 0.09, 1.0] }, { c: [COURT_W + 0.05, 10, 0.5], s: [0.09, 0.09, 1.0] });
  return bars;
}

/**
 * Texture de gazon synthétique : grain fin et légères variations, pour mieux percevoir la vitesse et la
 * distance en 1re personne. Générée une fois dans un canvas (aucun fichier).
 */
function turfTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#2463b0';
  g.fillRect(0, 0, size, size);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 9000; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? `rgba(14,50,110,${0.12 + 0.18 * rnd()})` : `rgba(120,170,235,${0.08 + 0.14 * rnd()})`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(COURT_W / 2, COURT_L / 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Construit le court. `track` reçoit chaque géométrie, matériau et texture à libérer.
 * Retourne { group, turf } (le gazon reçoit les ombres des joueurs).
 */
export function buildCourt(track) {
  const group = new THREE.Group();
  const lambert = (color, extra) => track(new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, extra)));

  const apron = new THREE.Mesh(track(new THREE.PlaneGeometry(40, 50)), lambert(COLORS.apron));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  group.add(apron);
  const turf = new THREE.Mesh(track(new THREE.PlaneGeometry(COURT_W, COURT_L)), track(new THREE.MeshLambertMaterial({ color: 0xffffff, map: track(turfTexture()) })));
  turf.rotation.x = -Math.PI / 2;
  turf.receiveShadow = true;
  group.add(turf);

  // Lignes de service (6,95 m du filet) et ligne centrale
  const lineMat = track(new THREE.MeshBasicMaterial({ color: COLORS.line }));
  const service = 10 - 6.95;
  const strips = [
    [0, service, COURT_W, service],
    [0, COURT_L - service, COURT_W, COURT_L - service],
    [COURT_W / 2, service, COURT_W / 2, COURT_L - service],
  ];
  for (const [x0, y0, x1, y1] of strips) {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(Math.hypot(x1 - x0, y1 - y0), 0.05)), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    m.position.copy(sv((x0 + x1) / 2, (y0 + y1) / 2, 0.004));
    group.add(m);
  }

  // Filet : maille sombre semi-transparente, bande blanche
  const net = new THREE.Mesh(
    track(new THREE.PlaneGeometry(COURT_W, 0.88)),
    track(new THREE.MeshBasicMaterial({ color: COLORS.net, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }))
  );
  net.position.copy(sv(COURT_W / 2, 10, 0.44));
  group.add(net);
  const band = new THREE.Mesh(track(new THREE.BoxGeometry(COURT_W, 0.05, 0.03)), lineMat);
  band.position.copy(sv(COURT_W / 2, 10, 0.88));
  group.add(band);

  // Vitres (une seule géométrie) et grillage (une seule géométrie de segments)
  const glassPos = [];
  const meshPts = [];
  for (const half of [0, 1]) {
    for (const p of HALF_WALLS.glass) quadPositions(panelCorners(p, half), glassPos);
    for (const p of HALF_WALLS.mesh) meshGridSegments(panelCorners(p, half), 0.25, meshPts);
  }
  const glassGeo = track(new THREE.BufferGeometry());
  glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(glassPos, 3));
  glassGeo.computeVertexNormals();
  const glass = new THREE.Mesh(
    glassGeo,
    track(new THREE.MeshBasicMaterial({ color: COLORS.glass, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }))
  );
  glass.renderOrder = 1;
  group.add(glass);
  group.add(
    new THREE.LineSegments(
      track(new THREE.BufferGeometry().setFromPoints(meshPts)),
      track(new THREE.LineBasicMaterial({ color: COLORS.mesh, transparent: true, opacity: 0.55 }))
    )
  );

  // Cadres et poteaux : une seule InstancedMesh
  const bars = frameBars();
  const frames = new THREE.InstancedMesh(track(new THREE.BoxGeometry(1, 1, 1)), lambert(COLORS.frame), bars.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  bars.forEach((b, i) => {
    m4.compose(sv(b.c[0], b.c[1], b.c[2]), q, new THREE.Vector3(b.s[0], b.s[2], b.s[1]));
    frames.setMatrixAt(i, m4);
  });
  group.add(frames);
  return { group, turf };
}

/*
 * Glass Lab — balle et aides visuelles (Three.js).
 *   En jeu, toujours actives et discrètes : balle grossie ≈ 2× avec contour, ombre ronde au sol à la
 *   verticale de la balle, trait balle → sol, anneau de portée aux pieds du joueur.
 *   La balle porte sa couture blanche et tourne selon son effet (rotation ralentie pour rester lisible :
 *   un coupé roule vers l'arrière, un lift vers l'avant, un latéral tourne comme une toupie).
 *   Balles hautes (lobs) : l'ombre reste nettement visible, cerclée de blanc, et le point de chute est
 *   marqué au sol jusqu'au rebond.
 *   Dans le Détail seulement : trajectoire, meilleur point (vert), ta frappe (orange).
 */
import * as THREE from 'three';
import G from '../core/geometry.js';
import { sv } from './court.js';

const BALL_VISUAL_RADIUS = 0.066; // ≈ 2 × le rayon réel (3,3 cm)
const RADIAL = 6;
const COLORS = { ball: 0xf2ff1f, ballEdge: 0x2e3300, best: 0x2ee88a, mine: 0xff9f1c };
// Rotation affichée : l'effet réel (jusqu'à ≈ 30 tours/s) serait illisible à 60 images/s
const SPIN_VISUAL = 0.12;
const SPIN_VISUAL_MAX = 22; // rad/s

/**
 * Texture de la balle : jaune avec la couture blanche (courbe classique des balles de padel et de tennis :
 * x = a cos t + b cos 3t, y = a sin t − b sin 3t, z = 2√(ab) sin 2t), projetée comme les UV de
 * THREE.SphereGeometry.
 */
function seamTexture() {
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f2ff1f';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 9;
  g.lineCap = 'round';
  const a = 0.75;
  const b = 0.25;
  const k = 2 * Math.sqrt(a * b);
  let prev = null;
  for (let i = 0; i <= 480; i++) {
    const t = (i / 480) * 2 * Math.PI;
    let x = a * Math.cos(t) + b * Math.cos(3 * t);
    let y = a * Math.sin(t) - b * Math.sin(3 * t);
    let z = k * Math.sin(2 * t);
    const l = Math.hypot(x, y, z);
    x /= l;
    y /= l;
    z /= l;
    const u = (((Math.atan2(z, -x) / (2 * Math.PI)) % 1) + 1) % 1;
    const p = { u: u * W, v: (Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI) * H };
    if (prev && Math.abs(p.u - prev.u) < W / 2) {
      g.beginPath();
      g.moveTo(prev.u, prev.v);
      g.lineTo(p.u, p.v);
      g.stroke();
    }
    prev = p;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Polyligne paramétrée par l'indice des points : rebonds anguleux, segment j = intervalle de temps j. */
class IndexPolyline extends THREE.Curve {
  constructor(points) {
    super();
    this.points = points;
  }
  getPoint(u, target = new THREE.Vector3()) {
    const n = this.points.length;
    const f = Math.min(Math.max(u, 0), 1) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    return target.copy(this.points[i]).lerp(this.points[i + 1], f - i);
  }
  getUtoTmapping(u) {
    return u;
  }
}

export function createBallView(scene, track) {
  // Balle très visible + contour sombre (lisible devant le ciel comme devant le gazon)
  const ballGeo = track(new THREE.SphereGeometry(BALL_VISUAL_RADIUS, 16, 12));
  const ball = new THREE.Mesh(ballGeo, track(new THREE.MeshBasicMaterial({ color: 0xffffff, map: track(seamTexture()) })));
  const edge = new THREE.Mesh(ballGeo, track(new THREE.MeshBasicMaterial({ color: COLORS.ballEdge, side: THREE.BackSide })));
  edge.scale.setScalar(1.3);
  ball.add(edge);
  ball.renderOrder = 2;
  scene.add(ball);

  // Ombre ronde à la verticale de la balle : indispensable pour percevoir la profondeur
  const shadowMat = track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
  const shadow = new THREE.Mesh(track(new THREE.CircleGeometry(0.085, 20)), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  // Cercle autour de l'ombre d'une balle haute : sa position au sol se lit même de loin
  const shadowRingMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  const shadowRing = new THREE.Mesh(track(new THREE.RingGeometry(0.09, 0.11, 28)), shadowRingMat);
  shadowRing.rotation.x = -Math.PI / 2;
  scene.add(shadowRing);

  // Point de chute d'une balle haute : cible jaune au sol jusqu'au rebond
  const landing = new THREE.Group();
  const landingMat = track(new THREE.MeshBasicMaterial({ color: COLORS.ball, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  const landingRing = new THREE.Mesh(track(new THREE.RingGeometry(0.26, 0.33, 40)), landingMat);
  const landingDot = new THREE.Mesh(track(new THREE.CircleGeometry(0.06, 16)), landingMat);
  for (const m of [landingRing, landingDot]) {
    m.rotation.x = -Math.PI / 2;
    landing.add(m);
  }
  landing.visible = false;
  scene.add(landing);

  // Trait vertical balle → sol : relie la balle à son ombre pour lire hauteur et profondeur
  const stem = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.008, 0.008, 1, 5).translate(0, 0.5, 0)),
    track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }))
  );
  scene.add(stem);

  // Anneau de portée aux pieds du joueur (0,3 à 1,1 m) : la balle est jouable quand son ombre y entre
  const ring = new THREE.Mesh(
    track(new THREE.RingGeometry(0.3, 1.1, 56)),
    track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }))
  );
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const ringEdge = new THREE.Mesh(
    track(new THREE.RingGeometry(1.08, 1.11, 56)),
    track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }))
  );
  ringEdge.rotation.x = -Math.PI / 2;
  scene.add(ringEdge);

  // Repères du Détail : meilleur point (vert), ta frappe (orange), position idéale au sol
  const dotGeo = track(new THREE.SphereGeometry(0.085, 12, 8));
  const bestDot = new THREE.Mesh(dotGeo, track(new THREE.MeshBasicMaterial({ color: COLORS.best })));
  const mineDot = new THREE.Mesh(dotGeo, track(new THREE.MeshBasicMaterial({ color: COLORS.mine })));
  const bestRing = new THREE.Mesh(
    track(new THREE.RingGeometry(0.28, 0.38, 32)),
    track(new THREE.MeshBasicMaterial({ color: COLORS.best, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }))
  );
  bestRing.rotation.x = -Math.PI / 2;
  for (const m of [bestDot, mineDot, bestRing]) {
    m.visible = false;
    scene.add(m);
  }

  // Trajectoire (Détail uniquement) : tube reconstruit à chaque nouvelle balle rejouée
  const pathMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
  let path = null;
  let pathTimes = null;

  function clearPath() {
    if (!path) return;
    scene.remove(path);
    path.geometry.dispose();
    path = null;
    pathTimes = null;
  }

  /** Trajectoire échantillonnée [{ t, x, y, z }] (repère monde) pour le Détail. */
  function setPath(samples) {
    clearPath();
    const pts = [];
    const times = [];
    for (const s of samples) {
      const v = sv(s.x, s.y, s.z);
      if (pts.length && v.distanceToSquared(pts[pts.length - 1]) < 1e-8) continue;
      pts.push(v);
      times.push(s.t);
    }
    if (pts.length < 2) return;
    path = new THREE.Mesh(new THREE.TubeGeometry(new IndexPolyline(pts), pts.length - 1, 0.016, RADIAL, false), pathMat);
    path.visible = false;
    scene.add(path);
    pathTimes = times;
  }

  /** Nombre d'indices du tube jusqu'à l'instant t (recherche dichotomique). */
  function pathCount(t) {
    let lo = 0;
    let hi = pathTimes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pathTimes[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo * RADIAL * 6;
  }

  const spinAxis = new THREE.Vector3();

  /** Rotation affichée pendant dt (s) : vecteur rotation monde { wx, wy, wz } (rad/s) → repère de la scène. */
  function spinBall(w, dt) {
    if (!w || !(dt > 0)) return;
    spinAxis.set(w.wx, w.wz, -w.wy); // même changement de repère que les positions (rotation propre)
    const rate = spinAxis.length();
    if (rate < 1e-6) return;
    ball.rotateOnWorldAxis(spinAxis.divideScalar(rate), Math.min(SPIN_VISUAL_MAX, rate * SPIN_VISUAL) * dt);
  }

  /**
   * v = { ball: {x,y,z, wx?,wy?,wz?} | null, reach: {x,y} | null, pathT: number | null (Détail : trajectoire
   *       jusqu'à t), best: { bx, by, bz, px, py } | null, mine: { bx, by, bz } | null,
   *       landing: { x, y } | null (point de chute d'une balle haute) } ; dt : durée de l'image (s de jeu),
   *       pour faire tourner la balle selon son effet.
   */
  function update(v, dt) {
    const b = v.ball;
    ball.visible = shadow.visible = !!b;
    stem.visible = !!(b && b.z > 0.06);
    shadowRing.visible = !!(b && b.z > 1.2);
    if (b) {
      if (b.wx !== undefined) spinBall(b, dt);
      G.worldToSceneInto(ball.position, b.x, b.y, b.z);
      G.worldToSceneInto(shadow.position, b.x, b.y, 0.006);
      // Ombre lisible même sous un lob de 8 m (elle pâlit peu et grandit à peine)
      shadowMat.opacity = 0.6 * Math.max(0.45, 1 - b.z / 10);
      shadow.scale.setScalar(1 + b.z * 0.1);
      if (shadowRing.visible) {
        shadowRing.position.copy(shadow.position);
        shadowRing.position.y += 0.002;
        shadowRing.scale.setScalar(1 + b.z * 0.1);
        shadowRingMat.opacity = Math.min(0.7, (b.z - 1.2) * 0.35);
      }
      if (stem.visible) {
        G.worldToSceneInto(stem.position, b.x, b.y, 0);
        stem.scale.set(1, b.z, 1);
      }
    }
    landing.visible = !!v.landing;
    if (v.landing) G.worldToSceneInto(landing.position, v.landing.x, v.landing.y, 0.01);
    ring.visible = ringEdge.visible = !!v.reach;
    if (v.reach) {
      G.worldToSceneInto(ring.position, v.reach.x, v.reach.y, 0.008);
      ringEdge.position.copy(ring.position);
    }
    if (path) {
      path.visible = v.pathT != null;
      if (path.visible) path.geometry.setDrawRange(0, pathCount(v.pathT));
    }
    bestDot.visible = bestRing.visible = !!v.best;
    if (v.best) {
      G.worldToSceneInto(bestDot.position, v.best.bx, v.best.by, v.best.bz);
      G.worldToSceneInto(bestRing.position, v.best.px, v.best.py, 0.012);
    }
    mineDot.visible = !!v.mine;
    if (v.mine) G.worldToSceneInto(mineDot.position, v.mine.bx, v.mine.by, v.mine.bz);
  }

  return {
    update,
    setPath,
    clearPath,
    dispose() {
      clearPath();
    },
  };
}

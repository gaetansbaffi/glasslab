/*
 * Glass Lab — silhouettes des joueurs (Three.js) : corps low-poly et raquettes, dessinés à partir des
 * squelettes de core/body.js. Toutes les pièces d'un même type partagent une InstancedMesh (couleur par
 * instance) : une dizaine d'appels de rendu pour les 4 joueurs, aucune allocation par image.
 *
 * Le joueur en 1re personne n'affiche ni tête, ni cou, ni casquette : la caméra est à la place de ses yeux.
 */
import * as THREE from 'three';
import G from '../core/geometry.js';

const SKIN = [0xf1c27d, 0xc68642, 0xe0ac69, 0x8d5524];

/** Tenues : équipe du bas (toi et ton partenaire) en blanc, adversaires en rouge. */
export const KITS = [
  { shirt: 0xf3f6f8, shorts: 0x1b2a41, cap: 0x1fb5a8, racket: 0x1fb5a8 },
  { shirt: 0xe0483e, shorts: 0x2a2a2a, cap: 0xf2f2f2, racket: 0xffb11f },
];

/** Pièces d'un joueur et instances correspondantes. */
const LIMBS = [
  ['shoulderL', 'elbowL', 0.058, 'shirt'],
  ['shoulderR', 'elbowR', 0.058, 'shirt'],
  ['elbowL', 'handL', 0.045, 'skin'],
  ['elbowR', 'handR', 0.045, 'skin'],
  ['hipL', 'kneeL', 0.083, 'skin'],
  ['hipR', 'kneeR', 0.083, 'skin'],
  ['kneeL', 'ankleL', 0.06, 'skin'],
  ['kneeR', 'ankleR', 0.06, 'skin'],
  ['chest', 'neck', 0.055, 'skin'], // cou (masqué en 1re personne)
];
const JOINT_BALLS = [
  ['handL', 0.047, 'skin'],
  ['handR', 0.047, 'skin'],
  ['elbowL', 0.05, 'skin'],
  ['elbowR', 0.05, 'skin'],
  ['kneeL', 0.07, 'skin'],
  ['kneeR', 0.07, 'skin'],
  ['shoulderL', 0.07, 'shirt'],
  ['shoulderR', 0.07, 'shirt'],
];
const NECK = LIMBS.length - 1;

export function createFigures(scene, track, count) {
  const lambert = (opts) => track(new THREE.MeshLambertMaterial(Object.assign({ color: 0xffffff, flatShading: true }, opts)));
  const limbGeo = track(new THREE.CylinderGeometry(0.8, 1, 1, 7, 1).translate(0, 0.5, 0));
  const torsoGeo = track(new THREE.CylinderGeometry(1, 0.82, 1, 9, 1).translate(0, 0.5, 0));
  const ballGeo = track(new THREE.IcosahedronGeometry(1, 1));
  const boxGeo = track(new THREE.BoxGeometry(1, 1, 1));
  const handleGeo = track(new THREE.CylinderGeometry(0.85, 1, 1, 6, 1).translate(0, 0.5, 0));
  const frameGeo = track(new THREE.TorusGeometry(1, 0.075, 5, 22));
  const faceGeo = track(new THREE.CircleGeometry(1, 20));

  const make = (geo, mat, n, shadow) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = !!shadow;
    scene.add(m);
    return m;
  };
  const body = lambert();
  const limbs = make(limbGeo, body, count * LIMBS.length, true);
  const torsos = make(torsoGeo, body, count * 2, true);
  const balls = make(ballGeo, body, count * (JOINT_BALLS.length + 1), true);
  const boxes = make(boxGeo, body, count * 3, true);
  const handles = make(handleGeo, lambert({ color: 0x15191e }), count, true);
  const frames = make(frameGeo, lambert(), count, true);
  const faces = make(faceGeo, track(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })), count, false);
  // Ta propre raquette (1re personne) : tamis presque transparent, pour ne rien masquer du court
  const facesFp = make(faceGeo, track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })), 1, false);
  facesFp.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));

  const players = [];
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) players.push({ team: 0, fp: false, visible: true });

  /** Couleurs d'un joueur : équipe (0 bas, 1 haut), teinte de peau, 1re personne ou non. */
  function setPlayer(i, o) {
    const p = players[i];
    p.team = o.team;
    p.fp = !!o.fp;
    const kit = KITS[o.team];
    const skin = SKIN[(o.skin == null ? i : o.skin) % SKIN.length];
    const pick = (k) => (k === 'skin' ? skin : kit[k]);
    LIMBS.forEach((l, k) => limbs.setColorAt(i * LIMBS.length + k, col.setHex(pick(l[3]))));
    torsos.setColorAt(i * 2, col.setHex(kit.shirt));
    torsos.setColorAt(i * 2 + 1, col.setHex(kit.shorts));
    const nb = JOINT_BALLS.length + 1;
    JOINT_BALLS.forEach((j, k) => balls.setColorAt(i * nb + k, col.setHex(pick(j[2]))));
    balls.setColorAt(i * nb + JOINT_BALLS.length, col.setHex(skin)); // tête
    boxes.setColorAt(i * 3, col.setHex(0xf2f2f2));
    boxes.setColorAt(i * 3 + 1, col.setHex(0xf2f2f2));
    boxes.setColorAt(i * 3 + 2, col.setHex(kit.cap));
    frames.setColorAt(i, col.setHex(kit.racket));
    faces.setColorAt(i, col.setHex(kit.racket).lerp(new THREE.Color(0xffffff), 0.55));
    for (const m of [limbs, torsos, balls, boxes, frames, faces]) m.instanceColor.needsUpdate = true;
  }

  /* ----- Matrices (repère scène), objets temporaires réutilisés ----- */
  const m4 = new THREE.Matrix4();
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  const H = new THREE.Vector3();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const toScene = (out, p) => G.worldToSceneInto(out, p.x, p.y, p.z);
  const low = { x: 0, y: 0, z: 0 };
  const high = { x: 0, y: 0, z: 0 };
  const at = { x: 0, y: 0, z: 0 };

  /** Base orthonormée : Y donné (unitaire), X proche de l'indice `hint`, Z = X × Y. */
  function basis(hint) {
    X.copy(hint).addScaledVector(Y, -hint.dot(Y));
    if (X.lengthSq() < 1e-8) X.set(Math.abs(Y.y) < 0.9 ? 0 : 1, Math.abs(Y.y) < 0.9 ? 1 : 0, 0).addScaledVector(Y, -Y.y);
    X.normalize();
    Z.crossVectors(X, Y);
  }

  function setMatrix(mesh, idx, sx, sy, sz, pos) {
    m4.set(X.x * sx, Y.x * sy, Z.x * sz, pos.x, X.y * sx, Y.y * sy, Z.y * sz, pos.y, X.z * sx, Y.z * sy, Z.z * sz, pos.z, 0, 0, 0, 1);
    mesh.setMatrixAt(idx, m4);
  }

  /** Segment de a vers b (points monde), section rx × rz, axe X orienté selon `hint` (repère scène). */
  function segment(mesh, idx, a, b, rx, rz, hint) {
    toScene(A, a);
    toScene(B, b);
    Y.subVectors(B, A);
    const len = Y.length();
    if (len < 1e-6) return mesh.setMatrixAt(idx, ZERO);
    Y.multiplyScalar(1 / len);
    basis(hint);
    setMatrix(mesh, idx, rx, len, rz, A);
  }

  function sphere(idx, p, sx, sy, sz) {
    toScene(A, p);
    m4.makeScale(sx, sy, sz).setPosition(A);
    balls.setMatrixAt(idx, m4);
  }

  /** Boîte centrée en c (point monde), axes : `fwd` (repère scène, horizontal) et la verticale. */
  function box(idx, c, fwdX, fwdZ, w, h, l, pitch) {
    toScene(A, c);
    const cp = Math.cos(pitch || 0);
    const sp = Math.sin(pitch || 0);
    Z.set(fwdX * cp, sp, fwdZ * cp); // avant
    Y.set(-fwdX * sp, cp, -fwdZ * sp); // haut
    X.crossVectors(Y, Z);
    m4.set(X.x * w, Y.x * h, Z.x * l, A.x, X.y * w, Y.y * h, Z.y * l, A.y, X.z * w, Y.z * h, Z.z * l, A.z, 0, 0, 0, 1);
    boxes.setMatrixAt(idx, m4);
  }

  function hide(i) {
    for (let k = 0; k < LIMBS.length; k++) limbs.setMatrixAt(i * LIMBS.length + k, ZERO);
    torsos.setMatrixAt(i * 2, ZERO);
    torsos.setMatrixAt(i * 2 + 1, ZERO);
    for (let k = 0; k <= JOINT_BALLS.length; k++) balls.setMatrixAt(i * (JOINT_BALLS.length + 1) + k, ZERO);
    for (let k = 0; k < 3; k++) boxes.setMatrixAt(i * 3 + k, ZERO);
    handles.setMatrixAt(i, ZERO);
    frames.setMatrixAt(i, ZERO);
    faces.setMatrixAt(i, ZERO);
  }

  /** Pièce trop près des yeux du joueur en 1re personne (elle masquerait l'écran) : masquée. */
  const tooClose = (eye, a, b) => eye && Math.hypot((a.x + b.x) / 2 - eye.x, (a.y + b.y) / 2 - eye.y, (a.z + b.z) / 2 - eye.z) < 0.25;

  /**
   * Pose du joueur i à partir de son squelette (core/body.js : skeleton) et de son orientation.
   * look = { bodyYaw, gazeYaw, gazePitch } ; eye = position des yeux (1re personne seulement).
   */
  function update(i, sk, look, eye) {
    const p = players[i];
    if (!sk) return hide(i);
    eye = p.fp ? eye : null;
    // Droite du corps (repère scène) : monde (cos, −sin) → scène (cos, 0, sin)
    const by = look.bodyYaw;
    H.set(Math.cos(by), 0, Math.sin(by));
    LIMBS.forEach((l, k) => {
      if ((p.fp && k === NECK) || tooClose(eye, sk[l[0]], sk[l[1]])) return limbs.setMatrixAt(i * LIMBS.length + k, ZERO);
      segment(limbs, i * LIMBS.length + k, sk[l[0]], sk[l[1]], l[2], l[2], H);
    });
    // Buste (épaules plus larges que la taille) et short
    segment(torsos, i * 2, sk.pelvis, sk.chest, 0.165, 0.105, H);
    low.x = high.x = sk.pelvis.x;
    low.y = high.y = sk.pelvis.y;
    low.z = sk.pelvis.z - 0.17;
    high.z = sk.pelvis.z + 0.06;
    segment(torsos, i * 2 + 1, low, high, 0.17, 0.115, H);
    const nb = JOINT_BALLS.length + 1;
    JOINT_BALLS.forEach((j, k) => {
      if (tooClose(eye, sk[j[0]], sk[j[0]])) balls.setMatrixAt(i * nb + k, ZERO);
      else sphere(i * nb + k, sk[j[0]], j[1], j[1], j[1]);
    });
    if (p.fp) balls.setMatrixAt(i * nb + JOINT_BALLS.length, ZERO);
    else sphere(i * nb + JOINT_BALLS.length, sk.head, 0.1, 0.118, 0.106);
    // Pieds : du talon vers la pointe
    for (let k = 0; k < 2; k++) {
      const ankle = k ? sk.ankleR : sk.ankleL;
      const toe = k ? sk.toeR : sk.toeL;
      const fx = toe.x - ankle.x;
      const fy = toe.y - ankle.y;
      const fl = Math.hypot(fx, fy) || 1;
      at.x = ankle.x + fx * 0.45;
      at.y = ankle.y + fy * 0.45;
      at.z = Math.max(0.04, ankle.z - 0.035);
      box(i * 3 + k, at, fx / fl, -fy / fl, 0.1, 0.075, 0.27, 0);
    }
    // Casquette (visière dans la direction du regard) : montre où regardent les IA
    if (p.fp) boxes.setMatrixAt(i * 3 + 2, ZERO);
    else {
      const gy = look.gazeYaw;
      at.x = sk.head.x + Math.sin(gy) * 0.1;
      at.y = sk.head.y + Math.cos(gy) * 0.1;
      at.z = sk.head.z + 0.05;
      box(i * 3 + 2, at, Math.sin(gy), -Math.cos(gy), 0.17, 0.02, 0.11, (look.gazePitch || 0) * 0.6);
    }
    // Raquette : manche, cadre et tamis dans le plan de la face
    const r = sk.racket;
    const grip = r.grip;
    toScene(A, grip);
    G.worldToSceneInto(Y, r.dir.x, r.dir.y, r.dir.z);
    Y.sub(G.worldToSceneInto(B, 0, 0, 0)).normalize();
    G.worldToSceneInto(Z, r.normal.x, r.normal.y, r.normal.z);
    Z.sub(B).normalize();
    X.crossVectors(Y, Z).normalize();
    Z.crossVectors(X, Y);
    B.copy(A).addScaledVector(Y, -0.07);
    setMatrix(handles, i, 0.017, 0.24, 0.017, B);
    B.copy(A).addScaledVector(Y, 0.3);
    setMatrix(frames, i, 0.132, 0.152, 0.132, B);
    if (p.fp) {
      faces.setMatrixAt(i, ZERO);
      setMatrix(facesFp, 0, 0.125, 0.145, 1, B);
    } else setMatrix(faces, i, 0.125, 0.145, 1, B);
  }

  return {
    setPlayer,
    update,
    hide,
    commit() {
      for (const m of [limbs, torsos, balls, boxes, handles, frames, faces, facesFp]) m.instanceMatrix.needsUpdate = true;
    },
    /** Ombres portées des joueurs (désactivables si la cadence est trop basse). */
    setShadows(on) {
      for (const m of [limbs, torsos, balls, boxes, handles, frames]) m.castShadow = on;
    },
  };
}

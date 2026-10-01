/*
 * Glass Lab — corps des joueurs, en fonctions pures (ni DOM, ni Three.js).
 *
 *   - tête et corps séparés : le regard suit la balle, le cou est limité (≈ ±80°) et le corps
 *     ne pivote que lorsque le cou ne suffit plus (balle qui passe derrière, vers la vitre) ;
 *   - position des yeux (caméra 1re personne) : au niveau des yeux, autour du pivot du cou ;
 *   - cinématique inverse du bras (2 segments) : la main tient réellement la raquette ;
 *   - poses de raquette : garde, préparation (la tête de raquette au point de contact idéal,
 *     elle matérialise la portée), coups (fond de court, volée, smash, service) ;
 *   - squelette complet (bassin, buste, tête, bras, jambes, pieds) pour le rendu des 4 joueurs.
 *
 * Repère monde de physics.js : x largeur, y profondeur, z hauteur (m).
 * Lacet (yaw) : 0 = vers +y, positif vers +x. Tangage (pitch) : positif vers le haut.
 * « Repère du corps » : (lat, fwd, z) = (vers la droite du corps, vers l'avant du corps, hauteur).
 */

import G from './geometry.js';

const DEG = Math.PI / 180;

/** Proportions d'un joueur d'environ 1,80 m, en position prête (genoux légèrement fléchis). */
const BODY = {
  eyeHeight: 1.65, // yeux en position prête, regard horizontal
  pivotHeight: 1.54, // pivot du cou (base de la tête)
  pivotForward: 0.07,
  eyeForward: 0.09, // yeux par rapport au pivot, dans le repère de la tête
  eyeUp: 0.11,
  headCenter: { fwd: 0.03, up: 0.1 },
  headRadius: 0.11,
  chest: { fwd: 0.05, z: 1.4 }, // haut du buste (base du cou)
  shoulderHalf: 0.19,
  shoulderDrop: 0.03,
  pelvis: { fwd: 0, z: 0.95 },
  hipHalf: 0.1,
  hipDrop: 0.05,
  upperArm: 0.31,
  forearm: 0.33, // coude → centre de la prise
  thigh: 0.46,
  shin: 0.45,
  ankleHeight: 0.07,
  footLength: 0.24,
  stanceHalf: 0.17, // demi-écart des pieds
  crouchDrop: 0.3, // descente du bassin à flexion maximale (balle très basse)
  crouchLean: 0.18, // avancée du buste à flexion maximale
};

/** Raquette de padel : 45,5 cm au plus, centre du tamis à 30 cm de la prise. */
const RACKET = { length: 0.455, headCenter: 0.3, headHalfWidth: 0.13, headHalfHeight: 0.15, handle: 0.15 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Angle ramené dans ]-π, π]. */
function wrapAngle(a) {
  return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
}

/** Lissage exponentiel (demi-vie, s) avec vitesse maximale (unités/s), indépendant de la cadence. */
function approach(current, target, dt, halfLife, maxSpeed) {
  const k = halfLife > 0 ? 1 - Math.pow(0.5, dt / halfLife) : 1;
  let step = (target - current) * k;
  if (maxSpeed != null) step = clamp(step, -maxSpeed * dt, maxSpeed * dt);
  return current + step;
}

/** Comme approach, pour un angle, par le plus court chemin. */
function approachAngle(current, target, dt, halfLife, maxSpeed) {
  return wrapAngle(approach(0, wrapAngle(target - current), dt, halfLife, maxSpeed) + current);
}

/* ---------- Repère du corps ---------- */

function forwardOf(yaw) {
  return { x: Math.sin(yaw), y: Math.cos(yaw) };
}

/** Point monde à partir de coordonnées du corps (lat, fwd, z) ; écrit dans `out` si fourni. */
function bodyPoint(pos, yaw, lat, fwd, z, out) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  out = out || {};
  out.x = pos.x + c * lat + s * fwd;
  out.y = pos.y - s * lat + c * fwd;
  out.z = z;
  return out;
}

/** Coordonnées du corps (lat, fwd, z) d'un point monde. */
function toBody(pos, yaw, p) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const dx = p.x - pos.x;
  const dy = p.y - pos.y;
  return { lat: c * dx - s * dy, fwd: s * dx + c * dy, z: p.z };
}

/** Vecteur monde depuis un vecteur du corps (lat, fwd, z), non normalisé. */
function bodyVector(yaw, lat, fwd, z, out) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  out = out || {};
  out.x = c * lat + s * fwd;
  out.y = -s * lat + c * fwd;
  out.z = z;
  return out;
}

/* ---------- Tête et corps ---------- */

/** Réglages par défaut de l'orientation (radians, secondes). */
const LOOK = {
  restYaw: 0, // orientation de repos du corps (0 = vers le filet pour le joueur du bas)
  neckMax: 80 * DEG, // rotation maximale du cou sans tourner le corps
  neckComfort: 55 * DEG, // au-delà, le corps commence à pivoter
  bodyMax: 115 * DEG, // pivot maximal du corps (se retourner vers la vitre)
  headHalfLife: 0.05, // inertie de la tête : quelques centièmes de seconde
  headMaxSpeed: 9, // rad/s : assez vif pour suivre une sortie de vitre qui passe derrière la tête
  bodyHalfLife: 0.09,
  bodyMaxSpeed: 6,
  pitchHalfLife: 0.06,
  pitchMin: -65 * DEG,
  pitchMax: 50 * DEG,
};

/** Orientation initiale : corps et regard vers `yaw`, tangage `pitch`. */
function createLook(yaw, pitch) {
  yaw = yaw || 0;
  return { bodyYaw: yaw, gazeYaw: yaw, gazePitch: pitch || 0, neckYaw: 0 };
}

/**
 * Un pas d'orientation : le regard tend vers la cible (lissage, vitesse bornée), le corps reste à son
 * orientation de repos tant que le cou suffit (± neckComfort), puis pivote juste assez (± bodyMax) ;
 * le cou ne dépasse jamais ± neckMax. Aucun roulis : seulement lacet et tangage.
 *
 * Les angles sont « déroulés » par rapport au repos : le regard vit dans l'intervalle continu
 * [−(bodyMax + neckMax), bodyMax + neckMax]. Pour revenir d'une balle derrière soi, la tête repasse donc
 * toujours par le côté où le corps est tourné, sans jamais rester bloquée en butée.
 * look = { bodyYaw, gazeYaw, gazePitch } ; target = { yaw, pitch } (regard voulu, repère monde).
 * Retourne un nouvel objet { bodyYaw, gazeYaw, gazePitch, neckYaw }.
 */
function lookStep(look, target, dt, opts) {
  const o = opts ? Object.assign({}, LOOK, opts) : LOOK;
  const rest = o.restYaw;
  const limit = o.bodyMax + o.neckMax;
  const bodyU = wrapAngle(look.bodyYaw - rest);
  const gazeU = bodyU + wrapAngle(look.gazeYaw - look.bodyYaw);
  // 1. Cible déroulée : la représentation atteignable la plus proche du regard courant
  const t0 = wrapAngle(target.yaw - rest);
  let tU = t0;
  for (const c of [t0 - 2 * Math.PI, t0 + 2 * Math.PI]) {
    if (c >= -limit && c <= limit && Math.abs(c - gazeU) < Math.abs(tU - gazeU)) tU = c;
  }
  const g = approach(gazeU, clamp(tU, -limit, limit), dt, o.headHalfLife, o.headMaxSpeed);
  const pitch = approach(look.gazePitch, clamp(target.pitch, o.pitchMin, o.pitchMax), dt, o.pitchHalfLife, o.headMaxSpeed);
  // 2. Le corps ne pivote que si le cou sort de sa zone de confort
  let want = 0;
  if (g > o.neckComfort) want = Math.min(o.bodyMax, g - o.neckComfort);
  else if (g < -o.neckComfort) want = Math.max(-o.bodyMax, g + o.neckComfort);
  const body = approach(bodyU, want, dt, o.bodyHalfLife, o.bodyMaxSpeed);
  // 3. Cou borné
  const neck = clamp(g - body, -o.neckMax, o.neckMax);
  return { bodyYaw: wrapAngle(rest + body), gazeYaw: wrapAngle(rest + body + neck), gazePitch: pitch, neckYaw: neck };
}

/**
 * Regard voulu pour que la tête suive la balle :
 *   - balle lointaine : zone morte en lacet et suivi partiel en hauteur autour d'un regard légèrement
 *     plongeant (le court reste stable à l'écran, on voit le sol proche, son corps et sa raquette) ;
 *   - balle proche : la zone morte se resserre et le regard la vise franchement, pour qu'elle reste
 *     visible au moment de frapper ;
 *   - balle derrière soi qui revient (sortie de vitre) : comme un vrai joueur, on regarde déjà là où
 *     elle va arriver (`ahead` = position de la balle `anticipation` secondes plus tard). Tant qu'elle
 *     part vers la vitre, on la suit : l'impact sur la vitre reste visible.
 * look = orientation courante, eye = position des yeux, ball = { x, y, z } ou null, pos = joueur au sol ;
 * o = { deadYaw, basePitch, pitchFollow, nearFrom, nearTo, behindFrom, behindTo, restYaw,
 *       idle: { x, y, z } (point regardé sans balle) } ; ahead = { x, y, z } facultatif.
 */
function gazeTarget(look, eye, ball, pos, o, ahead) {
  if (ball && ahead) {
    const rel = Math.abs(wrapAngle(G.lookAngles(eye, ball).yaw - (o.restYaw || 0)));
    const behind = clamp((rel - o.behindFrom) / (o.behindTo - o.behindFrom), 0, 1);
    const approaching = Math.hypot(ahead.x - pos.x, ahead.y - pos.y) < Math.hypot(ball.x - pos.x, ball.y - pos.y);
    const w = approaching ? behind : 0;
    if (w > 0) ball = { x: ball.x + (ahead.x - ball.x) * w, y: ball.y + (ahead.y - ball.y) * w, z: ball.z + (ahead.z - ball.z) * w };
  }
  const at = ball || o.idle;
  const want = G.lookAngles(eye, at);
  if (!ball) return { yaw: want.yaw, pitch: o.basePitch };
  const dist = Math.hypot(ball.x - pos.x, ball.y - pos.y);
  const far = clamp((dist - o.nearFrom) / (o.nearTo - o.nearFrom), 0, 1); // 0 = proche, 1 = loin
  const dead = o.deadYaw * (0.12 + 0.88 * far);
  const d = wrapAngle(want.yaw - look.gazeYaw);
  let yaw = look.gazeYaw;
  if (d > dead) yaw = want.yaw - dead;
  else if (d < -dead) yaw = want.yaw + dead;
  const follow = o.pitchFollow + (1 - o.pitchFollow) * (1 - far);
  return { yaw: wrapAngle(yaw), pitch: o.basePitch + (want.pitch - o.basePitch) * follow };
}

/** Direction du regard (vecteur unitaire monde). */
function gazeDir(look, out) {
  const c = Math.cos(look.gazePitch);
  out = out || {};
  out.x = Math.sin(look.gazeYaw) * c;
  out.y = Math.cos(look.gazeYaw) * c;
  out.z = Math.sin(look.gazePitch);
  return out;
}

/**
 * Pivot du cou (base de la tête) : au-dessus des pieds, légèrement en avant du corps, abaissé par la
 * flexion des jambes (crouch 0–1) et le saut du split-step (hop, m).
 */
function neckPivot(pos, bodyYaw, crouch, hop, out) {
  const c = crouch || 0;
  return bodyPoint(pos, bodyYaw, 0, BODY.pivotForward + BODY.crouchLean * c, BODY.pivotHeight - BODY.crouchDrop * c + (hop || 0), out);
}

/**
 * Position des yeux (caméra 1re personne) : les yeux tournent autour du pivot du cou avec la tête ;
 * en regardant vers le bas, ils avancent et descendent légèrement, comme dans un vrai corps.
 * Toujours à l'intérieur du court.
 */
function eyePosition(pos, look, crouch, hop, out) {
  const p = neckPivot(pos, look.bodyYaw, crouch, hop, out);
  const cp = Math.cos(look.gazePitch);
  const sp = Math.sin(look.gazePitch);
  const fwd = BODY.eyeForward * cp - BODY.eyeUp * sp;
  const up = BODY.eyeForward * sp + BODY.eyeUp * cp;
  p.x = clamp(p.x + Math.sin(look.gazeYaw) * fwd, 0.12, 9.88);
  p.y = clamp(p.y + Math.cos(look.gazeYaw) * fwd, 0.12, 19.88);
  p.z += up;
  return p;
}

/* ---------- Cinématique inverse à deux segments (bras, jambes) ---------- */

/**
 * Coude (ou genou) pour relier `root` à `target` avec deux segments de longueurs l1 et l2.
 * `pole` indique de quel côté plier. Si la cible est hors de portée, le membre est tendu vers elle.
 * Retourne { mid, end, reached } ; `end` est le bout réellement atteint (main, cheville).
 */
function ik2(root, target, l1, l2, pole, out) {
  out = out || { mid: {}, end: {} };
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let dz = target.z - root.z;
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) {
    dx = 0;
    dy = 0;
    dz = -1;
    d = 1e-9;
  }
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  const dMin = Math.abs(l1 - l2) + 1e-6;
  const dMax = l1 + l2 - 1e-6;
  const reached = d <= dMax && d >= dMin;
  const dd = clamp(d, dMin, dMax);
  // Projection du coude sur l'axe racine → cible, et distance à cet axe
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // Direction perpendiculaire du côté du pôle
  let px = pole.x;
  let py = pole.y;
  let pz = pole.z;
  let dot = px * ux + py * uy + pz * uz;
  px -= ux * dot;
  py -= uy * dot;
  pz -= uz * dot;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    // Pôle aligné avec le membre : on prend une perpendiculaire quelconque, stable
    px = -uy;
    py = ux;
    pz = 0;
    pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) {
      px = 1;
      py = 0;
      pz = 0;
      pl = 1;
    }
  }
  px /= pl;
  py /= pl;
  pz /= pl;
  out.mid.x = root.x + ux * a + px * h;
  out.mid.y = root.y + uy * a + py * h;
  out.mid.z = root.z + uz * a + pz * h;
  out.end.x = root.x + ux * dd;
  out.end.y = root.y + uy * dd;
  out.end.z = root.z + uz * dd;
  out.reached = reached;
  return out;
}

/* ---------- Raquette ---------- */

/**
 * Coups : images clés de la tête de raquette (repère du corps, côté de balle b = ±1 pour lat) et de
 * l'axe manche → tête. Hauteurs relatives à la hauteur de contact h (sauf `abs`).
 * Images clés : prep (s = 0), arrière (s = 0,25), contact (s = 0,55), accompagnement (s = 1).
 */
const STROKES = {
  ground: {
    keys: [
      { lat: 0.6, fwd: 0.12, dz: 0.05, axis: [0.75, -0.2, 0.55] },
      { lat: 0.55, fwd: -0.28, dz: 0.12, axis: [0.35, -0.65, 0.6] },
      { lat: 0.62, fwd: 0.28, dz: 0, axis: [0.85, 0.35, 0.35] },
      { lat: -0.12, fwd: 0.55, dz: 0.45, axis: [-0.4, 0.6, 0.7] },
    ],
  },
  volley: {
    keys: [
      { lat: 0.55, fwd: 0.22, dz: 0.05, axis: [0.6, 0.1, 0.8] },
      { lat: 0.55, fwd: 0.05, dz: 0.1, axis: [0.55, -0.15, 0.82] },
      { lat: 0.55, fwd: 0.38, dz: 0, axis: [0.6, 0.4, 0.7] },
      { lat: 0.35, fwd: 0.55, dz: -0.12, axis: [0.4, 0.7, 0.55] },
    ],
  },
  lob: {
    keys: [
      { lat: 0.6, fwd: 0.1, dz: 0, axis: [0.8, -0.2, 0.5] },
      { lat: 0.55, fwd: -0.25, dz: -0.1, axis: [0.45, -0.6, 0.35] },
      { lat: 0.6, fwd: 0.22, dz: 0, axis: [0.85, 0.25, 0.45] },
      { lat: 0.2, fwd: 0.45, dz: 0.85, axis: [0.15, 0.3, 0.95] },
    ],
  },
  overhead: {
    abs: true,
    keys: [
      { lat: 0.3, fwd: 0.05, z: 2.0, axis: [0.15, -0.1, 0.98] },
      { lat: 0.32, fwd: -0.35, z: 2.0, axis: [0.15, -0.55, 0.82] },
      { lat: 0.25, fwd: 0.32, z: 2.45, axis: [0.05, 0.45, 0.9] },
      { lat: -0.2, fwd: 0.45, z: 1.05, axis: [-0.3, 0.6, -0.65] },
    ],
  },
  serve: {
    abs: true,
    keys: [
      { lat: 0.4, fwd: 0.1, z: 0.8, axis: [0.4, 0.2, -0.85] },
      { lat: 0.42, fwd: -0.45, z: 0.55, axis: [0.15, -0.65, -0.55] },
      { lat: 0.4, fwd: 0.32, z: 0.78, axis: [0.55, 0.6, -0.2] },
      { lat: 0.12, fwd: 0.6, z: 1.5, axis: [0.05, 0.4, 0.92] },
    ],
  },
};
const STROKE_TIMES = [0, 0.25, 0.55, 1];
/** Part du geste au moment du contact (pour synchroniser l'animation et la frappe). */
const CONTACT_AT = 0.55;

/**
 * Garde : raquette devant le corps, du côté de la main, tamis relevé. En 1re personne, le haut du cadre
 * apparaît en bas de l'écran, entre le centre et le bouton Frappe, sans masquer le court.
 */
const GUARD = { lat: 0.14, fwd: 0.5, z: 1.18, axis: [-0.25, 0.4, 0.88] };

const smooth = (k) => k * k * (3 - 2 * k);

function normalize3(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= l;
  v.y /= l;
  v.z /= l;
  return v;
}

/**
 * Côté de la balle dans le repère du corps : 1 = à droite, −1 = à gauche, avec hystérésis.
 */
function ballSide(prev, pos, bodyYaw, ball, hysteresis) {
  const lat = toBody(pos, bodyYaw, ball).lat;
  const h = hysteresis == null ? 0.2 : hysteresis;
  if (lat > h) return 1;
  if (lat < -h) return -1;
  return prev || 1;
}

/**
 * Pose de la raquette (repère monde).
 * o = {
 *   pos {x,y}, bodyYaw, hand (1 = droitier, −1 = gaucher), crouch,
 *   mode : 'guard' | 'prep' | 'swing',
 *   stroke : 'ground' | 'volley' | 'lob' | 'overhead' | 'serve' (prep et swing),
 *   side : côté de la balle (±1, repère du corps),
 *   height : hauteur de contact visée (m), prep : 0–1 (garde → préparation), swing : 0–1 (geste),
 *   aim : { x, y, z } point de contact (facultatif) : le tamis passe par ce point au contact
 * }
 * Retourne { grip, head, dir (axe manche → tête, unitaire), normal (face, unitaire) }.
 */
function racketPose(o, out) {
  out = out || { grip: {}, head: {}, dir: {}, normal: {} };
  const yaw = o.bodyYaw;
  const hand = o.hand || 1;
  const b = o.side || hand;
  const h = o.height == null ? 1 : o.height;
  let lat;
  let fwd;
  let z;
  let ax;
  let ay;
  let az;
  // Balle basse : le tamis passe sous la main (raquette inclinée vers le sol)
  const low = Math.max(0, 0.9 - h) * 1.6;
  const key = (k) => {
    const st = STROKES[o.stroke] || STROKES.ground;
    const kk = st.keys[k];
    if (st.abs) return { lat: kk.lat * hand, fwd: kk.fwd, z: kk.z, ax: kk.axis[0] * hand, ay: kk.axis[1], az: kk.axis[2] };
    return { lat: kk.lat * b, fwd: kk.fwd, z: h + kk.dz, ax: kk.axis[0] * b, ay: kk.axis[1], az: kk.axis[2] - (k < 3 ? low : 0) };
  };
  if (o.mode === 'swing') {
    const s = clamp(o.swing || 0, 0, 1);
    let i = 0;
    while (i < STROKE_TIMES.length - 2 && s > STROKE_TIMES[i + 1]) i++;
    const A = key(i);
    const B = key(i + 1);
    // Point de contact réel : l'image clé « contact » passe par la balle
    if (o.aim) {
      const local = toBody(o.pos, yaw, o.aim);
      const fix = (K) => {
        K.lat = local.lat;
        K.fwd = local.fwd;
        K.z = local.z;
      };
      if (i + 1 === 2) fix(B);
      if (i === 2) fix(A);
    }
    const k = smooth((s - STROKE_TIMES[i]) / (STROKE_TIMES[i + 1] - STROKE_TIMES[i]));
    lat = A.lat + (B.lat - A.lat) * k;
    fwd = A.fwd + (B.fwd - A.fwd) * k;
    z = A.z + (B.z - A.z) * k;
    ax = A.ax + (B.ax - A.ax) * k;
    ay = A.ay + (B.ay - A.ay) * k;
    az = A.az + (B.az - A.az) * k;
  } else {
    const g = { lat: GUARD.lat * hand, fwd: GUARD.fwd, z: GUARD.z - BODY.crouchDrop * (o.crouch || 0), ax: GUARD.axis[0] * hand, ay: GUARD.axis[1], az: GUARD.axis[2] };
    const k = o.mode === 'prep' ? smooth(clamp(o.prep == null ? 1 : o.prep, 0, 1)) : 0;
    const P = k > 0 ? key(0) : g;
    lat = g.lat + (P.lat - g.lat) * k;
    fwd = g.fwd + (P.fwd - g.fwd) * k;
    z = g.z + (P.z - g.z) * k;
    ax = g.ax + (P.ax - g.ax) * k;
    ay = g.ay + (P.ay - g.ay) * k;
    az = g.az + (P.az - g.az) * k;
  }
  // Tête de raquette à une hauteur atteignable (genoux fléchis au plus bas)
  z = clamp(z, 0.12, 2.75);
  bodyPoint(o.pos, yaw, lat, fwd, z, out.head);
  bodyVector(yaw, ax, ay, az, out.dir);
  normalize3(out.dir);
  out.grip.x = out.head.x - out.dir.x * RACKET.headCenter;
  out.grip.y = out.head.y - out.dir.y * RACKET.headCenter;
  out.grip.z = out.head.z - out.dir.z * RACKET.headCenter;
  // Face : perpendiculaire au manche, tournée vers l'avant du corps
  const f = forwardOf(yaw);
  const d = f.x * out.dir.x + f.y * out.dir.y;
  out.normal.x = f.x - out.dir.x * d;
  out.normal.y = f.y - out.dir.y * d;
  out.normal.z = -out.dir.z * d;
  normalize3(out.normal);
  return out;
}

/**
 * Flexion des jambes pour une hauteur de contact : nulle au-dessus de 0,95 m, maximale vers 0,3 m.
 */
function crouchFor(height) {
  return clamp((1.0 - height) / 0.6, 0, 1);
}

/**
 * Torsion des épaules pendant un coup (rad) : armé du côté de la balle, puis rotation à travers le contact.
 */
function twistFor(mode, side, prep, swing) {
  if (mode === 'prep') return 0.45 * side * smooth(clamp(prep == null ? 1 : prep, 0, 1));
  if (mode !== 'swing') return 0;
  const s = clamp(swing || 0, 0, 1);
  if (s < 0.25) return side * (0.45 + 0.15 * (s / 0.25));
  if (s < CONTACT_AT) return side * 0.6 * (1 - (s - 0.25) / (CONTACT_AT - 0.25));
  return -side * 0.4 * smooth((s - CONTACT_AT) / (1 - CONTACT_AT));
}

/* ---------- Squelette complet ---------- */

const JOINTS = [
  'pelvis', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'toeL', 'toeR',
];

/** Objet squelette réutilisable (évite toute allocation dans la boucle de rendu). */
function createSkeleton() {
  const s = { reachedR: true, reachedL: true, racket: { grip: {}, head: {}, dir: {}, normal: {} } };
  for (const j of JOINTS) s[j] = { x: 0, y: 0, z: 0 };
  s._ik = { mid: {}, end: {} };
  s._tmp = { x: 0, y: 0, z: 0 };
  s._pole = { x: 0, y: 0, z: 0 };
  return s;
}

/**
 * Squelette d'un joueur (points monde), écrit dans `out` (créé par createSkeleton).
 * p = {
 *   x, y : position au sol ; bodyYaw ; gazeYaw, gazePitch (regard) ;
 *   vx, vy : vitesse (m/s) ; gait : distance cumulée (m), donne la phase de la foulée ;
 *   crouch (0–1), hop (m, split-step) ; twist (rad, rotation des épaules) ;
 *   hand : 1 droitier / −1 gaucher ; racket : pose de racketPose (la main dominante tient la prise) ;
 *   offHand : { x, y, z } cible de la main libre (facultatif)
 * }
 */
function skeleton(p, out) {
  out = out || createSkeleton();
  const yaw = p.bodyYaw || 0;
  const c = clamp(p.crouch || 0, 0, 1);
  const hop = p.hop || 0;
  const lift = Math.max(0, hop); // saut : tout le corps monte
  const sink = Math.min(0, hop); // réception : seul le bassin descend
  const pos = { x: p.x, y: p.y };
  const hand = p.hand || 1;

  // Bassin et buste
  const pz = BODY.pelvis.z - BODY.crouchDrop * c + lift + sink;
  bodyPoint(pos, yaw, 0, BODY.pelvis.fwd + 0.04 * c, pz, out.pelvis);
  bodyPoint(pos, yaw, 0, BODY.chest.fwd + BODY.crouchLean * c, BODY.chest.z - BODY.crouchDrop * c + lift + sink, out.chest);
  neckPivot(pos, yaw, c, lift + sink, out.neck);
  // Tête : tourne avec le regard autour du pivot du cou
  const cp = Math.cos(p.gazePitch || 0);
  const sp = Math.sin(p.gazePitch || 0);
  const gy = p.gazeYaw == null ? yaw : p.gazeYaw;
  const hf = BODY.headCenter.fwd * cp - BODY.headCenter.up * sp;
  out.head.x = out.neck.x + Math.sin(gy) * hf;
  out.head.y = out.neck.y + Math.cos(gy) * hf;
  out.head.z = out.neck.z + BODY.headCenter.fwd * sp + BODY.headCenter.up * cp;

  // Épaules, avec torsion du buste
  const ty = yaw + (p.twist || 0);
  for (const side of [-1, 1]) {
    const sh = side < 0 ? out.shoulderL : out.shoulderR;
    sh.x = out.chest.x + Math.cos(ty) * BODY.shoulderHalf * side;
    sh.y = out.chest.y - Math.sin(ty) * BODY.shoulderHalf * side;
    sh.z = out.chest.z - BODY.shoulderDrop;
    const hip = side < 0 ? out.hipL : out.hipR;
    bodyPoint(pos, yaw, BODY.hipHalf * side, BODY.pelvis.fwd + 0.04 * c, pz - BODY.hipDrop, hip);
  }

  // Bras dominant : la main tient la raquette (cinématique inverse)
  const domSh = hand > 0 ? out.shoulderR : out.shoulderL;
  const offSh = hand > 0 ? out.shoulderL : out.shoulderR;
  const domEl = hand > 0 ? out.elbowR : out.elbowL;
  const offEl = hand > 0 ? out.elbowL : out.elbowR;
  const domHand = hand > 0 ? out.handR : out.handL;
  const offHandJ = hand > 0 ? out.handL : out.handR;
  const pole = out._pole;
  bodyVector(yaw, 0.55 * hand, -0.35, -1, pole);
  const r = p.racket;
  const gripTarget = r ? r.grip : bodyPoint(pos, yaw, 0.22 * hand, 0.3, 1.0, out._tmp);
  const arm = ik2(domSh, gripTarget, BODY.upperArm, BODY.forearm, pole, out._ik);
  domEl.x = arm.mid.x;
  domEl.y = arm.mid.y;
  domEl.z = arm.mid.z;
  domHand.x = arm.end.x;
  domHand.y = arm.end.y;
  domHand.z = arm.end.z;
  out.reachedR = arm.reached;
  // La raquette suit la main réellement atteinte (jamais détachée)
  const rk = out.racket;
  if (r) {
    rk.dir.x = r.dir.x;
    rk.dir.y = r.dir.y;
    rk.dir.z = r.dir.z;
    rk.normal.x = r.normal.x;
    rk.normal.y = r.normal.y;
    rk.normal.z = r.normal.z;
  } else {
    bodyVector(yaw, GUARD.axis[0] * hand, GUARD.axis[1], GUARD.axis[2], rk.dir);
    normalize3(rk.dir);
    bodyVector(yaw, 0, 1, 0, rk.normal);
  }
  rk.grip.x = domHand.x;
  rk.grip.y = domHand.y;
  rk.grip.z = domHand.z;
  rk.head.x = domHand.x + rk.dir.x * RACKET.headCenter;
  rk.head.y = domHand.y + rk.dir.y * RACKET.headCenter;
  rk.head.z = domHand.z + rk.dir.z * RACKET.headCenter;

  // Main libre : soutient le cœur de la raquette en garde, sinon équilibre
  const offTarget = p.offHand || {
    x: domHand.x + rk.dir.x * 0.16 - Math.cos(yaw) * 0.05 * hand,
    y: domHand.y + rk.dir.y * 0.16 + Math.sin(yaw) * 0.05 * hand,
    z: domHand.z + rk.dir.z * 0.16,
  };
  bodyVector(yaw, -0.55 * hand, -0.35, -1, pole);
  const off = ik2(offSh, offTarget, BODY.upperArm, BODY.forearm, pole, out._ik);
  offEl.x = off.mid.x;
  offEl.y = off.mid.y;
  offEl.z = off.mid.z;
  offHandJ.x = off.end.x;
  offHandJ.y = off.end.y;
  offHandJ.z = off.end.z;
  out.reachedL = off.reached;

  // Jambes : foulée (course ou pas chassés) puis genoux par cinématique inverse
  const vx = p.vx || 0;
  const vy = p.vy || 0;
  const v = Math.hypot(vx, vy);
  const local = { lat: Math.cos(yaw) * vx - Math.sin(yaw) * vy, fwd: Math.sin(yaw) * vx + Math.cos(yaw) * vy };
  const ampF = Math.min(0.36, 0.05 + 0.075 * v);
  const ampL = Math.min(0.12, 0.03 + 0.04 * v);
  const stride = 4 * Math.max(0.12, ampF);
  const phase = ((p.gait || 0) / stride) * 2 * Math.PI;
  const liftH = v > 0.15 ? Math.min(0.16, 0.025 + 0.03 * v) : 0;
  const dirF = v > 1e-3 ? local.fwd / v : 0;
  const dirL = v > 1e-3 ? local.lat / v : 0;
  const stance = BODY.stanceHalf + 0.05 * c;
  bodyVector(yaw, 0, 1, 0, pole); // genoux vers l'avant
  for (const side of [-1, 1]) {
    const ph = phase + (side > 0 ? Math.PI : 0);
    const sw = v > 0.15 ? Math.sin(ph) : 0;
    const up = v > 0.15 ? Math.max(0, Math.cos(ph)) * liftH : 0;
    const lat = side * stance + sw * dirL * ampL * 2;
    // Appuis sous le buste (position prête), pied droit légèrement devant
    const fwd = 0.05 + (side > 0 ? 0.04 : -0.04) + sw * dirF * ampF;
    const ankle = side < 0 ? out.ankleL : out.ankleR;
    bodyPoint(pos, yaw, lat, fwd, BODY.ankleHeight + up + lift, ankle);
    const hip = side < 0 ? out.hipL : out.hipR;
    const leg = ik2(hip, ankle, BODY.thigh, BODY.shin, pole, out._ik);
    const knee = side < 0 ? out.kneeL : out.kneeR;
    knee.x = leg.mid.x;
    knee.y = leg.mid.y;
    knee.z = leg.mid.z;
    ankle.x = leg.end.x;
    ankle.y = leg.end.y;
    ankle.z = leg.end.z;
    // Pied : pointe légèrement ouverte
    const fy = yaw + side * 0.18;
    const toe = side < 0 ? out.toeL : out.toeR;
    toe.x = ankle.x + Math.sin(fy) * BODY.footLength * 0.72;
    toe.y = ankle.y + Math.cos(fy) * BODY.footLength * 0.72;
    toe.z = Math.max(0.025, ankle.z - 0.045);
  }
  return out;
}

const Body = {
  BODY,
  RACKET,
  LOOK,
  STROKES,
  CONTACT_AT,
  JOINTS,
  wrapAngle,
  approach,
  approachAngle,
  forwardOf,
  bodyPoint,
  bodyVector,
  toBody,
  createLook,
  lookStep,
  gazeTarget,
  gazeDir,
  neckPivot,
  eyePosition,
  ik2,
  ballSide,
  racketPose,
  crouchFor,
  twistFor,
  createSkeleton,
  skeleton,
};

export default Body;

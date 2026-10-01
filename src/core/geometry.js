/*
 * Glass Lab — géométrie du jeu, en fonctions pures (ni DOM, ni Three.js).
 *
 * Repère « monde » de physics.js :
 *   x : largeur (0 = paroi gauche, 10 = paroi droite)
 *   y : profondeur (0 = vitre de fond du joueur, 10 = filet, 20 = fond adverse)
 *   z : hauteur
 * Le repère « scène » de Three.js (y vers le haut) s'en déduit par worldToScene :
 * c'est une rotation (déterminant +1), donc les produits vectoriels sont conservés.
 */

const COURT_W = 10;
const NET_Y = 10;
const DEG = Math.PI / 180;

/* ---------- Repères ---------- */

/** Monde (physique, z vers le haut) → scène Three.js (y vers le haut, filet en z = 0, défense en z > 0). */
function worldToScene(p) {
  return { x: p.x - COURT_W / 2, y: p.z, z: NET_Y - p.y };
}

/** Variante sans allocation : écrit dans `out` (objet avec x, y, z, par exemple un THREE.Vector3). */
function worldToSceneInto(out, x, y, z) {
  out.x = x - COURT_W / 2;
  out.y = z;
  out.z = NET_Y - y;
  return out;
}

function sceneToWorld(s) {
  return { x: s.x + COURT_W / 2, y: NET_Y - s.z, z: s.y };
}

/* ---------- Caméra ---------- */

/**
 * Champ de vision vertical (degrés) donnant un champ horizontal voulu pour un rapport largeur / hauteur,
 * borné pour rester lisible en paysage comme en portrait.
 */
function verticalFov(hFovDeg, aspect, minDeg, maxDeg) {
  const vf = (2 * Math.atan(Math.tan((hFovDeg * DEG) / 2) / aspect)) / DEG;
  return Math.max(minDeg == null ? 45 : minDeg, Math.min(maxDeg == null ? 95 : maxDeg, vf));
}

/**
 * Angles de visée de `from` vers `to` : lacet (0 = vers le filet, positif vers la droite)
 * et tangage (positif vers le haut), en radians.
 */
function lookAngles(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { yaw: Math.atan2(dx, dy), pitch: Math.atan2(to.z - from.z, Math.hypot(dx, dy)) };
}

function dirFromAngles(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.cos(yaw) * c, z: Math.sin(pitch) };
}

/** Angle ramené dans ]-π, π]. */
function wrapAngle(a) {
  return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

/** Lissage exponentiel indépendant de la fréquence d'images (demi-vie en secondes). */
function damp(current, target, dt, halfLife) {
  if (halfLife <= 0) return target;
  return current + (target - current) * (1 - Math.pow(0.5, dt / halfLife));
}

/** Lissage d'un angle par le plus court chemin. */
function dampAngle(current, target, dt, halfLife) {
  return wrapAngle(current + wrapAngle(target - current) * (1 - Math.pow(0.5, dt / Math.max(halfLife, 1e-9))));
}

/**
 * Pas de caméra « suit la balle » : lissage, horizon stable (aucun roulis), amplitude et vitesse bornées.
 * look = { yaw, pitch } courant ; target = { yaw, pitch } visé ;
 * opts = { halfLife, maxYaw, pitchMin, pitchMax, maxSpeed (rad/s) }.
 * Retourne un nouvel objet { yaw, pitch }.
 */
function cameraStep(look, target, dt, opts) {
  const ty = clamp(wrapAngle(target.yaw), -opts.maxYaw, opts.maxYaw);
  const tp = clamp(target.pitch, opts.pitchMin, opts.pitchMax);
  let yaw = damp(look.yaw, ty, dt, opts.halfLife); // amplitude bornée : pas de passage par ±π
  let pitch = damp(look.pitch, tp, dt, opts.halfLife);
  const maxStep = opts.maxSpeed * dt;
  yaw = look.yaw + clamp(yaw - look.yaw, -maxStep, maxStep);
  pitch = look.pitch + clamp(pitch - look.pitch, -maxStep, maxStep);
  return { yaw: clamp(yaw, -opts.maxYaw, opts.maxYaw), pitch: clamp(pitch, opts.pitchMin, opts.pitchMax) };
}

/**
 * Cible de caméra « calme » : le regard ne tourne que si la balle sort d'une fenêtre centrale
 * (zone morte en lacet), et ne suit la hauteur de la balle que partiellement autour d'un
 * tangage de base légèrement plongeant. Le court reste ainsi stable à l'écran.
 * look = regard courant, want = angles vers la balle ;
 * opts = { deadYaw (rad), basePitch (rad), pitchFollow (0–1) }. Retourne { yaw, pitch } visé.
 */
function cameraTarget(look, want, opts) {
  const d = wrapAngle(want.yaw - look.yaw);
  let yaw = look.yaw;
  if (d > opts.deadYaw) yaw = want.yaw - opts.deadYaw;
  else if (d < -opts.deadYaw) yaw = want.yaw + opts.deadYaw;
  const pitch = opts.basePitch + (want.pitch - opts.basePitch) * opts.pitchFollow;
  return { yaw: wrapAngle(yaw), pitch };
}

/**
 * Coordonnées d'un point dans le repère d'une caméra placée en `eye`, regard (yaw, pitch), sans roulis :
 * x vers la droite de l'image, y vers le haut, z vers l'avant (profondeur).
 */
function viewCoords(eye, yaw, pitch, p) {
  const dx = p.x - eye.x;
  const dy = p.y - eye.y;
  const dz = p.z - eye.z;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  return {
    x: cy * dx - sy * dy,
    y: -sy * sp * dx - cy * sp * dy + cp * dz,
    z: sy * cp * dx + cy * cp * dy + sp * dz,
  };
}

/**
 * Le point est-il dans le champ d'une caméra perspective (champs horizontal et vertical en degrés) ?
 * margin (0–1) réduit le champ utile : 0,1 = le point doit être à l'intérieur des 90 % centraux.
 */
function inView(eye, yaw, pitch, p, hFovDeg, vFovDeg, margin) {
  const c = viewCoords(eye, yaw, pitch, p);
  if (c.z <= 0.05) return false;
  const k = 1 - (margin || 0);
  return Math.abs(c.x / c.z) <= Math.tan((hFovDeg * DEG) / 2) * k && Math.abs(c.y / c.z) <= Math.tan((vFovDeg * DEG) / 2) * k;
}

/** Champ horizontal (degrés) correspondant à un champ vertical et un rapport largeur / hauteur. */
function horizontalFov(vFovDeg, aspect) {
  return (2 * Math.atan(Math.tan((vFovDeg * DEG) / 2) * aspect)) / DEG;
}

/* ---------- Contrôles ---------- */

/**
 * Joystick virtuel : décalage du doigt (pixels, y écran vers le bas) → vecteur d'entrée de norme ≤ 1
 * (x = droite, y = avant).
 * opts = { deadZone (fraction du rayon, défaut 0,15), curve (exposant de la courbe de réponse, défaut 1,5),
 *          sensitivity (multiplicateur, défaut 1) }.
 * Zone morte : aucune réponse ; au-delà, la norme suit ((d − zm) / (1 − zm))^curve × sensibilité, plafonnée à 1.
 */
function joystickVector(dx, dy, radius, opts) {
  opts = opts || {};
  const dead = opts.deadZone == null ? 0.15 : opts.deadZone;
  const curve = opts.curve == null ? 1.5 : opts.curve;
  const sens = opts.sensitivity == null ? 1 : opts.sensitivity;
  const l = Math.hypot(dx, dy);
  if (radius <= 0 || l <= radius * dead) return { x: 0, y: 0 };
  const lin = Math.min(1, (l - radius * dead) / (radius * (1 - dead)));
  const m = Math.min(1, Math.pow(lin, curve) * sens);
  return { x: (dx / l) * m, y: (-dy / l) * m };
}

/**
 * Joystick par rapport au regard : haut = droit devant toi (dans la direction regardée), droite = à ta
 * droite. La direction de référence est figée dès que le pouce pousse franchement (≥ o.lockOn) et tant
 * qu'il pousse (≥ o.lockOff) : si la caméra tourne pendant la course (elle suit la balle), ta course ne
 * dévie pas. Pouce relâché ou proche du centre : la référence suit à nouveau le regard.
 * frame = { ref: lacet figé ou null } (modifié sur place) ; stick = { x, y } (norme ≤ 1) ; viewYaw = lacet
 * du regard. Retourne la vitesse voulue dans le repère du court (norme ≤ 1).
 */
function viewRelativeMove(frame, stick, viewYaw, o) {
  const m = Math.hypot(stick.x, stick.y);
  if (frame.ref == null) {
    if (m >= o.lockOn) frame.ref = viewYaw;
  } else if (m < o.lockOff) frame.ref = null;
  const yaw = frame.ref == null ? viewYaw : frame.ref;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // devant = (sin, cos), droite = (cos, −sin) dans le repère du court
  return { x: stick.x * c + stick.y * s, y: -stick.x * s + stick.y * c };
}

/**
 * Entrée clavier → vecteur d'entrée. `keys` contient des KeyboardEvent.code (position physique) :
 * KeyW/KeyA/KeyS/KeyD correspondent à ZQSD sur AZERTY et à WASD sur QWERTY.
 */
function keyboardVector(keys) {
  const has = (k) => keys.has(k);
  let x = 0;
  let y = 0;
  if (has('ArrowUp') || has('KeyW')) y += 1;
  if (has('ArrowDown') || has('KeyS')) y -= 1;
  if (has('ArrowLeft') || has('KeyA')) x -= 1;
  if (has('ArrowRight') || has('KeyD')) x += 1;
  const l = Math.hypot(x, y);
  return l > 1 ? { x: x / l, y: y / l } : { x, y };
}

/* ---------- Balle avant le filet (côté adverse) ---------- */

/**
 * État balistique exact après dt secondes (dt peut être négatif : remonter le temps). Avec effet, l'état
 * porte l'accélération de Magnus de son segment (ax, ay, az), constante : la formule reste exacte.
 */
function ballistic(s, dt, g) {
  const ax = s.ax || 0;
  const ay = s.ay || 0;
  const ge = g - (s.az || 0);
  const o = {
    x: s.x + s.vx * dt + 0.5 * ax * dt * dt,
    y: s.y + s.vy * dt + 0.5 * ay * dt * dt,
    z: s.z + s.vz * dt - 0.5 * ge * dt * dt,
    vx: s.vx + ax * dt,
    vy: s.vy + ay * dt,
    vz: s.vz - ge * dt,
  };
  if (s.wx !== undefined) {
    o.wx = s.wx;
    o.wy = s.wy;
    o.wz = s.wz;
    o.ax = ax;
    o.ay = ay;
    o.az = s.az || 0;
  }
  return o;
}

/**
 * Durée de vol avant le filet pour faire partir la balle de la raquette adverse :
 * on remonte la trajectoire jusqu'à y = yStart, en s'arrêtant plus tôt si la balle
 * passerait sous zMin (frappe trop basse) ou au-dessus de zMax.
 */
function preNetDuration(init, g, opts) {
  opts = opts || {};
  const yStart = opts.yStart == null ? 16.5 : opts.yStart;
  const zMin = opts.zMin == null ? 0.4 : opts.zMin;
  const zMax = opts.zMax == null ? 3.2 : opts.zMax;
  if (init.vy >= 0) return 0;
  const tauY = (yStart - init.y) / -init.vy;
  const ok = (tau) => {
    const s = ballistic(init, -tau, g);
    return s.z >= zMin && s.z <= zMax;
  };
  if (ok(tauY)) return tauY;
  let lo = 0;
  let hi = tauY;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

const Geometry = {
  worldToScene,
  worldToSceneInto,
  sceneToWorld,
  verticalFov,
  lookAngles,
  dirFromAngles,
  wrapAngle,
  clamp,
  damp,
  dampAngle,
  cameraStep,
  cameraTarget,
  viewCoords,
  inView,
  horizontalFov,
  joystickVector,
  keyboardVector,
  viewRelativeMove,
  ballistic,
  preNetDuration,
};

export default Geometry;

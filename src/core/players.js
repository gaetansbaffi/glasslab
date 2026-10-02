/*
 * Glass Lab — déplacement des joueurs, en fonctions pures (ni DOM, ni Three.js).
 *
 * Modèle commun au joueur humain et aux trois IA :
 *   - vitesse maximale bornée ;
 *   - accélération limitée (≈ 0,5 s pour atteindre la pleine vitesse) et freinage plus vif ;
 *   - temps de réaction après la frappe adverse, pendant lequel le joueur fait son split-step
 *     (petit saut d'équilibre) et freine au lieu de courir.
 *
 * Repère monde de physics.js : x largeur, y profondeur, vitesses en m/s.
 */

const EPS = 1e-9;

/**
 * Temps minimal (s) pour parcourir d mètres en partant et en arrivant à l'arrêt :
 * accélération `accel`, croisière à `speed`, freinage `decel`.
 * Sans `accel` (ancien modèle), le joueur atteint `speed` instantanément : d / speed.
 */
function travelTime(d, p) {
  if (!(d > 0)) return 0;
  if (!p.accel) return d / p.speed;
  const a = p.accel;
  const b = p.decel || p.accel;
  const v = p.speed;
  const dFull = (v * v) / (2 * a) + (v * v) / (2 * b); // distance pour accélérer puis freiner à fond
  if (d <= dFull) {
    const peak = Math.sqrt((2 * a * b * d) / (a + b));
    return peak / a + peak / b;
  }
  return v / a + v / b + (d - dFull) / v;
}

/** Distance d'arrêt à la vitesse v (m). */
function brakingDistance(v, p) {
  return (v * v) / (2 * (p.decel || p.accel || Infinity));
}

/**
 * Un pas de déplacement : la vitesse tend vers la vitesse voulue `want` (m/s, repère court) avec une
 * variation bornée par pas : `decel` quand on freine (variation opposée à la vitesse), `accel` sinon.
 * Les bornes { xMin, xMax, yMin, yMax } arrêtent le joueur contre les parois (composante annulée).
 * m = { x, y, vx, vy } ; retourne un nouvel objet du même type (m n'est pas modifié).
 */
function stepVelocity(m, want, dt, p, bounds) {
  const vx = m.vx || 0;
  const vy = m.vy || 0;
  let dvx = want.x - vx;
  let dvy = want.y - vy;
  const dv = Math.hypot(dvx, dvy);
  if (dv > EPS) {
    const braking = dvx * vx + dvy * vy < 0;
    const rate = (braking ? p.decel || p.accel : p.accel) * dt;
    if (p.accel && dv > rate) {
      dvx *= rate / dv;
      dvy *= rate / dv;
    }
  }
  let nvx = vx + dvx;
  let nvy = vy + dvy;
  // Jamais plus vite que la vitesse maximale
  const sp = Math.hypot(nvx, nvy);
  if (sp > p.speed) {
    nvx *= p.speed / sp;
    nvy *= p.speed / sp;
  }
  let x = m.x + nvx * dt;
  let y = m.y + nvy * dt;
  if (bounds) {
    if (x < bounds.xMin) (x = bounds.xMin), (nvx = Math.max(0, nvx));
    if (x > bounds.xMax) (x = bounds.xMax), (nvx = Math.min(0, nvx));
    if (y < bounds.yMin) (y = bounds.yMin), (nvy = Math.max(0, nvy));
    if (y > bounds.yMax) (y = bounds.yMax), (nvy = Math.min(0, nvy));
  }
  return { x, y, vx: nvx, vy: nvy };
}

/** Joystick ou clavier (norme ≤ 1, repère court) → vitesse voulue (m/s). */
function inputVelocity(input, p) {
  if (!input) return { x: 0, y: 0 };
  const l = Math.hypot(input.x || 0, input.y || 0);
  const k = l > 1 ? 1 / l : 1;
  return { x: (input.x || 0) * k * p.speed, y: (input.y || 0) * k * p.speed };
}

/**
 * Vitesse voulue pour rejoindre `target` et s'y arrêter (comportement « arrivée ») : on ne va jamais
 * plus vite que ce qui permet de freiner à temps, ni de dépasser la cible en un pas.
 * speedScale (0–1) : allure (1 = sprint, plus bas pour un replacement tranquille).
 */
function arriveVelocity(m, target, p, dt, speedScale) {
  const dx = target.x - m.x;
  const dy = target.y - m.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.005) return { x: 0, y: 0 };
  const vmax = p.speed * (speedScale == null ? 1 : speedScale);
  const brake = Math.sqrt(2 * (p.decel || p.accel || 1e6) * Math.max(0, d - 0.004));
  const s = Math.min(vmax, brake, d / Math.max(dt, 1e-3) / 2);
  return { x: (dx / d) * s, y: (dy / d) * s };
}

/* ---------- Agents (IA et joueur) : réaction et split-step ---------- */

/**
 * Nouvel agent. o = { x, y, team (0 = bas, 1 = haut) }.
 * reactAt : instant (horloge de l'échange) à partir duquel il peut courir vers sa cible ;
 * splitAt : instant du dernier split-step (−∞ si aucun).
 */
function createAgent(o) {
  return { x: o.x, y: o.y, vx: 0, vy: 0, target: { x: o.x, y: o.y }, pace: 1, reactAt: -Infinity, splitAt: -Infinity, dist: 0 };
}

/**
 * Frappe adverse à l'instant t : l'agent fait un split-step et ne réagit qu'après son temps de réaction.
 * Retourne une copie.
 */
function splitStep(agent, t, p) {
  return Object.assign({}, agent, { splitAt: t, reactAt: t + p.reaction });
}

/** Nouvelle cible (et allure 0–1). Retourne une copie. */
function setTarget(agent, target, pace) {
  return Object.assign({}, agent, { target: { x: target.x, y: target.y }, pace: pace == null ? 1 : pace });
}

/**
 * Pas de l'agent à l'instant t (fin du pas) : il freine pendant sa réaction (split-step),
 * puis rejoint sa cible avec le comportement « arrivée ». `dist` cumule la distance parcourue
 * (phase de la foulée pour l'animation).
 */
function stepAgent(agent, t, dt, p, bounds) {
  const want = t < agent.reactAt ? { x: 0, y: 0 } : arriveVelocity(agent, insideBounds(agent.target, bounds), p, dt, agent.pace);
  const m = stepVelocity(agent, want, dt, p, bounds);
  return Object.assign({}, agent, m, { dist: agent.dist + Math.hypot(m.x - agent.x, m.y - agent.y) });
}

/**
 * Cible ramenée à 10 cm à l'intérieur des bornes : l'agent freine avant la paroi (ou le filet) au lieu de
 * s'y arrêter net.
 */
function insideBounds(target, bounds) {
  if (!bounds) return target;
  const m = 0.1;
  const x = Math.max(bounds.xMin + m, Math.min(bounds.xMax - m, target.x));
  const y = Math.max(bounds.yMin + m, Math.min(bounds.yMax - m, target.y));
  return x === target.x && y === target.y ? target : { x, y };
}

/**
 * Hauteur du split-step à l'instant t (m) : petit saut de `hop` mètres pendant `duration` secondes,
 * suivi d'une flexion (valeur négative) à la réception.
 */
function splitHop(agent, t, p) {
  const k = (t - agent.splitAt) / p.splitDuration;
  if (!(k >= 0 && k < 1.6)) return 0;
  if (k < 1) return p.hop * Math.sin(Math.PI * k);
  return -0.5 * p.hop * Math.sin((Math.PI * (k - 1)) / 0.6);
}

/**
 * Temps pour qu'un agent atteigne `to` depuis `from`, réaction comprise, en partant à l'arrêt.
 * Sert à l'attribution de la balle et à la planification des IA.
 */
function reachTime(from, to, p) {
  return (p.reaction || 0) + travelTime(Math.hypot(to.x - from.x, to.y - from.y), p);
}

const Players = {
  travelTime,
  brakingDistance,
  stepVelocity,
  inputVelocity,
  arriveVelocity,
  createAgent,
  splitStep,
  setTarget,
  stepAgent,
  splitHop,
  reachTime,
};

export default Players;

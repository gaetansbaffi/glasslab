/*
 * Glass Lab — physique pure (aucun accès au DOM).
 *
 * Repère (mètres) :
 *   x : largeur, 0 = paroi gauche, 10 = paroi droite (vu depuis le fond du joueur)
 *   y : profondeur, 0 = vitre de fond du joueur, 10 = filet, 20 = vitre de fond adverse
 *   z : hauteur, 0 = sol
 *
 * Deux modes :
 *   - demi-court (par défaut, historique) : vitre de fond en y = 0, parois latérales ; le filet n'est
 *     qu'un plan où la simulation s'arrête (balle repartie chez l'adversaire) ;
 *   - court complet ({ court: 'full' }) : les deux moitiés avec toutes leurs parois, et le filet comme
 *     obstacle (balle dans le filet, ou qui passe en frôlant la bande).
 *
 * Sans frottement de l'air, chaque segment de vol (entre deux contacts) a une accélération constante :
 * la gravité, plus l'effet Magnus quand la balle tourne. Chaque contact est donc calculé analytiquement
 * (pas d'intégration numérique), ce qui rend la simulation exacte et déterministe.
 *
 * Effets (rotation de la balle) : un état peut porter wx, wy, wz (vecteur rotation, rad/s). Sans ces champs,
 * la balle suit exactement le modèle historique. Avec :
 *   - en vol, l'effet Magnus a = k · (ω × v_h) (v_h : vitesse horizontale, figée au début du segment) :
 *     le lift plonge, le coupé flotte, l'effet latéral courbe la trajectoire ;
 *   - à chaque contact (sol, vitres), le frottement transforme une partie de la rotation en vitesse :
 *     le coupé freine au rebond et « meurt » à la vitre (il en sort bas), le lift accélère au rebond et sort
 *     plus haut de la vitre, l'effet latéral dévie la balle au rebond.
 */

const COURT = {
  width: 10,
  depth: 10, // demi-longueur : le filet est en y = 10
  length: 20,
  serviceLine: 3.05, // depuis la vitre de fond (6,95 m depuis le filet)
  backGlassHeight: 3,
  sideGlass: [ // panneaux de vitre latérale : jusqu'à y = 4 m (3 m de haut), puis 4–6 m (2 m de haut)
    { from: 0, to: 4, height: 3 },
    { from: 4, to: 6, height: 2 },
  ],
  netHeight: 0.88,
};

const DEFAULT_PARAMS = {
  g: 9.81,
  radius: 0.033,
  eFloor: 0.75, // restitution normale au sol
  floorTangent: 0.9, // conservation de la vitesse horizontale au sol
  eWall: 0.8, // restitution normale sur les parois
  wallTangent: 0.95, // légère perte de vitesse tangentielle sur les parois
  minBounceVz: 0.3, // en dessous, la balle « roule » : fin de simulation
  // Filet (court complet) : une balle dans le filet est presque arrêtée et retombe de son côté ;
  // une balle qui frôle la bande passe, ralentie, avec un petit rebond vers le haut.
  eNet: 0.12,
  netTangent: 0.3,
  cordKeep: 0.45,
  cordSide: 0.7,
  cordLift: 0.6,
  // Effets : accélération de Magnus = magnus · |ω × v_h| (m/s² pour des rad/s et des m/s)
  magnus: 0.0011,
  maxLift: 0.5, // une balle coupée ne compense jamais plus de la moitié de la gravité
  spinInertia: 0.6, // moment d'inertie / (m R²) : sphère creuse à paroi épaisse
  spinGrip: 0.375, // part du glissement dû à la rotation supprimée au contact (κ / (1 + κ) : roulement)
  spinFloor: 0.5, // frottement balle / gazon sableux (limite le transfert rotation → vitesse)
  spinGlass: 0.25, // frottement balle / vitre
  spinKeep: 0.85, // rotation conservée à chaque contact (pertes)
  spinNet: 0.3, // rotation conservée dans le filet ou sur la bande
};

const EPS = 1e-9;

/** Générateur pseudo-aléatoire déterministe (mulberry32). Retourne une fonction () => [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withParams(p) {
  return Object.assign({}, DEFAULT_PARAMS, p || {});
}

/** État après une durée tau en vol libre (exact) : accélération du segment (gravité et Magnus) constante. */
function advance(s, tau, g) {
  const ax = s.ax || 0;
  const ay = s.ay || 0;
  const ge = g - (s.az || 0); // gravité effective
  const o = {
    x: s.x + s.vx * tau + 0.5 * ax * tau * tau,
    y: s.y + s.vy * tau + 0.5 * ay * tau * tau,
    z: s.z + s.vz * tau - 0.5 * ge * tau * tau,
    vx: s.vx + ax * tau,
    vy: s.vy + ay * tau,
    vz: s.vz - ge * tau,
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
 * Accélération de Magnus du segment qui commence dans l'état s (modifié sur place) : a = k · (ω × v_h).
 * Sans rotation (pas de champ wx), rien n'est ajouté.
 */
function setMagnus(s, P) {
  if (s.wx === undefined) return s;
  const k = P.magnus;
  s.ax = -k * s.wz * s.vy;
  s.ay = k * s.wz * s.vx;
  s.az = Math.max(-P.g, Math.min(P.g * P.maxLift, k * (s.wx * s.vy - s.wy * s.vx)));
  return s;
}

/**
 * Premier instant τ ≥ 0 où la coordonnée p + v τ + ½ a τ² atteint `target` en s'en approchant
 * (dir = −1 : par valeurs décroissantes, +1 : croissantes). Infinity si jamais.
 * Sans accélération, c'est exactement le calcul linéaire historique.
 */
function reach(p, v, a, target, dir) {
  if (!a) return dir * v > 0 ? Math.max(0, (target - p) / v) : Infinity;
  const c = p - target;
  if (dir * c >= 0 && dir * v > 0) return 0; // déjà au contact, en approche
  const disc = v * v - 2 * a * c;
  if (disc < 0) return Infinity;
  const q = -0.5 * (v + (v >= 0 ? 1 : -1) * Math.sqrt(disc));
  let best = Infinity;
  for (const tau of q === 0 ? [0] : [q / (0.5 * a), c / q]) {
    if (tau > EPS && tau < best && dir * (v + a * tau) > 0) best = tau;
  }
  return best;
}

/** Temps avant le prochain contact avec chaque surface (Infinity si aucun). */
function nextEventTimes(s, P) {
  const r = P.radius;
  const W = COURT.width;
  const t = { floor: Infinity, back: Infinity, left: Infinity, right: Infinity, net: Infinity };
  t.floor = floorTime(s, P);
  const ax = s.ax || 0;
  const ay = s.ay || 0;
  t.back = reach(s.y, s.vy, ay, r, -1);
  t.net = reach(s.y, s.vy, ay, COURT.depth, 1);
  t.left = reach(s.x, s.vx, ax, r, -1);
  t.right = reach(s.x, s.vx, ax, W - r, 1);
  // Un contact à τ = 0 sur une paroi qu'on vient de quitter est impossible
  // car la vitesse normale a été inversée ; on garde donc τ ≥ 0.
  return t;
}

/** Sol : z + vz τ − ½ g' τ² = r (g' = gravité effective) → racine positive. */
function floorTime(s, P) {
  const ge = P.g - (s.az || 0);
  const h = s.z - P.radius;
  const disc = s.vz * s.vz + 2 * ge * h;
  if (disc >= 0) {
    const tau = (s.vz + Math.sqrt(disc)) / ge;
    if (tau > EPS) return tau;
  }
  return Infinity;
}

/** Réflexion sur une surface. Retourne le nouvel état (copie). */
function reflect(s, type, P) {
  const o = Object.assign({}, s);
  const r = P.radius;
  if (type === 'floor') {
    o.z = r;
    o.vz = -s.vz * P.eFloor;
    o.vx = s.vx * P.floorTangent;
    o.vy = s.vy * P.floorTangent;
  } else if (type === 'back' || type === 'backFar') {
    o.y = type === 'back' ? r : COURT.length - r;
    o.vy = -s.vy * P.eWall;
    o.vx = s.vx * P.wallTangent;
    o.vz = s.vz * P.wallTangent;
  } else if (type === 'net') {
    // Dans le filet : la balle repart à peine et retombe de son côté
    o.vy = -s.vy * P.eNet;
    o.vx = s.vx * P.netTangent;
    o.vz = s.vz * P.netTangent;
  } else if (type === 'cord') {
    // Frôle la bande : passe de l'autre côté, ralentie, avec un petit rebond vers le haut
    o.vy = s.vy * P.cordKeep;
    o.vx = s.vx * P.cordSide;
    o.vz = Math.abs(s.vz) * 0.35 + P.cordLift;
  } else if (type === 'left' || type === 'right') {
    o.x = type === 'left' ? r : COURT.width - r;
    o.vx = -s.vx * P.eWall;
    o.vy = s.vy * P.wallTangent;
    o.vz = s.vz * P.wallTangent;
  }
  if (s.wx !== undefined) {
    spinContact(o, s, type, P);
    setMagnus(o, P);
  }
  return o;
}

/** Normale de chaque surface, orientée vers le court (vers la balle). */
const NORMALS = { floor: [0, 0, 1], back: [0, 1, 0], backFar: [0, -1, 0], left: [1, 0, 0], right: [-1, 0, 0] };

/**
 * Contact d'une balle qui tourne (o : état après la réflexion sans effet, modifié sur place).
 * Le point de contact (r = −R n) glisse à la vitesse u = ω × r due à la rotation ; le frottement en
 * supprime une partie (jusqu'au roulement, dans la limite du frottement disponible μ (1 + e) |v_n|) :
 * la balle reçoit Δv = −k u et sa rotation change de Δω = (r × Δv) / (κ R²).
 * Coupé au sol : u va vers l'avant → la balle freine. Lift : u vers l'arrière → elle accélère.
 */
function spinContact(o, s, type, P) {
  const n = NORMALS[type];
  if (!n) {
    // Filet ou bande : la rotation est presque absorbée
    o.wx = s.wx * P.spinNet;
    o.wy = s.wy * P.spinNet;
    o.wz = s.wz * P.spinNet;
    return;
  }
  const R = P.radius;
  const rx = -R * n[0];
  const ry = -R * n[1];
  const rz = -R * n[2];
  const ux = s.wy * rz - s.wz * ry;
  const uy = s.wz * rx - s.wx * rz;
  const uz = s.wx * ry - s.wy * rx;
  const un = Math.hypot(ux, uy, uz);
  let wx = s.wx;
  let wy = s.wy;
  let wz = s.wz;
  if (un > 1e-9) {
    const floor = type === 'floor';
    const vn = Math.abs(s.vx * n[0] + s.vy * n[1] + s.vz * n[2]);
    const e = floor ? P.eFloor : P.eWall;
    const dv = Math.min(P.spinGrip * un, (floor ? P.spinFloor : P.spinGlass) * (1 + e) * vn);
    const k = dv / un;
    const dvx = -k * ux;
    const dvy = -k * uy;
    const dvz = -k * uz;
    o.vx += dvx;
    o.vy += dvy;
    o.vz += dvz;
    const inv = 1 / (P.spinInertia * R * R);
    wx += (ry * dvz - rz * dvy) * inv;
    wy += (rz * dvx - rx * dvz) * inv;
    wz += (rx * dvy - ry * dvx) * inv;
  }
  o.wx = wx * P.spinKeep;
  o.wy = wy * P.spinKeep;
  o.wz = wz * P.spinKeep;
}

/** Copie de l'état initial ; avec effet, l'accélération de Magnus est calculée si elle n'est pas fournie. */
function initialState(init, P) {
  const s = Object.assign({}, init);
  if (s.wx !== undefined && s.ax === undefined) setMagnus(s, P);
  return s;
}

/**
 * Simule une trajectoire.
 * @param {{x,y,z,vx,vy,vz,wx?,wy?,wz?}} init état initial (rotation facultative, rad/s)
 * @param {object} [opts] { params, tMax, maxFloorBounces, court: 'half' (défaut) | 'full' }
 * @returns {{ segments: Array<{t0:number, s:object}>, contacts: Array, endT:number, endReason:string, params:object }}
 */
function simulate(init, opts) {
  opts = opts || {};
  if (opts.court === 'full') return simulateFull(init, opts);
  const P = withParams(opts.params);
  const tMax = opts.tMax != null ? opts.tMax : 6;
  const maxFloor = opts.maxFloorBounces != null ? opts.maxFloorBounces : 2;

  let s = initialState(init, P);
  let t = 0;
  const segments = [{ t0: 0, s: Object.assign({}, s) }];
  const contacts = [];
  let floorCount = 0;
  let endReason = 'tMax';

  for (let guard = 0; guard < 200; guard++) {
    const times = nextEventTimes(s, P);
    let tau = Infinity;
    for (const k in times) tau = Math.min(tau, times[k]);
    if (t + tau >= tMax) {
      s = advance(s, tMax - t, P.g);
      t = tMax;
      endReason = 'tMax';
      break;
    }
    s = advance(s, tau, P.g);
    t += tau;
    if (times.net <= tau + EPS) {
      endReason = 'net';
      break;
    }
    // Toutes les surfaces touchées au même instant (coin) sont traitées dans l'ordre.
    const hits = ['floor', 'back', 'left', 'right'].filter((k) => times[k] <= tau + EPS);
    let stop = false;
    for (const type of hits) {
      const vIn = { vx: s.vx, vy: s.vy, vz: s.vz };
      s = reflect(s, type, P);
      contacts.push({
        type,
        t,
        pos: { x: s.x, y: s.y, z: s.z },
        vIn,
        vOut: { vx: s.vx, vy: s.vy, vz: s.vz },
      });
      if (type === 'floor') {
        floorCount++;
        if (floorCount >= maxFloor) { endReason = 'floor'; stop = true; }
        else if (s.vz < P.minBounceVz) { endReason = 'rolling'; stop = true; }
      }
    }
    segments.push({ t0: t, s: Object.assign({}, s) });
    if (stop) break;
  }
  return { segments, contacts, endT: t, endReason, params: P };
}

/* ---------- Court complet : les deux moitiés et le filet comme obstacle ---------- */

/** Temps avant chaque événement du court complet (Infinity si aucun). */
function nextEventTimesFull(s, P) {
  const r = P.radius;
  const W = COURT.width;
  const L = COURT.length;
  const N = COURT.depth;
  const t = { floor: Infinity, back: Infinity, backFar: Infinity, left: Infinity, right: Infinity, netFace: Infinity, netCross: Infinity };
  t.floor = floorTime(s, P);
  const ax = s.ax || 0;
  const ay = s.ay || 0;
  t.back = reach(s.y, s.vy, ay, r, -1);
  t.backFar = reach(s.y, s.vy, ay, L - r, 1);
  t.left = reach(s.x, s.vx, ax, r, -1);
  t.right = reach(s.x, s.vx, ax, W - r, 1);
  // Filet : d'abord la face (la balle touche le plan du filet), puis le passage du centre au-dessus
  if (s.y < N - r - 1e-7) t.netFace = reach(s.y, s.vy, ay, N - r, 1);
  else if (s.y > N + r + 1e-7) t.netFace = reach(s.y, s.vy, ay, N + r, -1);
  else if (s.vy > 0 && s.y < N - 1e-7) t.netCross = reach(s.y, s.vy, ay, N, 1);
  else if (s.vy < 0 && s.y > N + 1e-7) t.netCross = reach(s.y, s.vy, ay, N, -1);
  return t;
}

const SURFACES_FULL = ['floor', 'back', 'backFar', 'left', 'right'];

/**
 * Court complet. Contacts : floor, back (y = 0), backFar (y = 20), left, right, net (dans le filet),
 * cord (frôle la bande et passe) ; chaque contact porte side = 0 (moitié y < 10) ou 1.
 * crossings : passages au-dessus du filet { t, x, z, dir (+1 vers y croissants), cord }.
 */
function simulateFull(init, opts) {
  const P = withParams(opts.params);
  const tMax = opts.tMax != null ? opts.tMax : 8;
  const maxFloor = opts.maxFloorBounces != null ? opts.maxFloorBounces : 2;
  const H = COURT.netHeight;
  let s = initialState(init, P);
  let t = 0;
  const segments = [{ t0: 0, s: Object.assign({}, s) }];
  const contacts = [];
  const crossings = [];
  let floorCount = 0;
  let endReason = 'tMax';
  const push = (type) => {
    const vIn = { vx: s.vx, vy: s.vy, vz: s.vz };
    s = reflect(s, type, P);
    contacts.push({ type, t, pos: { x: s.x, y: s.y, z: s.z }, vIn, vOut: { vx: s.vx, vy: s.vy, vz: s.vz }, side: s.y < COURT.depth ? 0 : 1 });
  };

  for (let guard = 0; guard < 300; guard++) {
    const times = nextEventTimesFull(s, P);
    let tau = Infinity;
    for (const k in times) tau = Math.min(tau, times[k]);
    if (t + tau >= tMax) {
      s = advance(s, tMax - t, P.g);
      t = tMax;
      endReason = 'tMax';
      break;
    }
    s = advance(s, tau, P.g);
    t += tau;
    let changed = false;
    let stop = false;
    if (times.netFace <= tau + EPS) {
      s.y = s.vy > 0 ? COURT.depth - P.radius : COURT.depth + P.radius;
      if (s.z <= H) {
        push('net');
        changed = true;
      }
    } else if (times.netCross <= tau + EPS) {
      s.y = COURT.depth;
      const dir = s.vy > 0 ? 1 : -1;
      const cord = s.z < H + P.radius;
      if (cord) {
        push('cord');
        changed = true;
      }
      crossings.push({ t, x: s.x, z: s.z, dir, cord });
    }
    // Toutes les surfaces touchées au même instant (coin) sont traitées dans l'ordre.
    for (const type of SURFACES_FULL) {
      if (!(times[type] <= tau + EPS)) continue;
      push(type);
      changed = true;
      if (type === 'floor') {
        floorCount++;
        if (floorCount >= maxFloor) {
          endReason = 'floor';
          stop = true;
        } else if (s.vz < P.minBounceVz) {
          endReason = 'rolling';
          stop = true;
        }
      }
    }
    if (changed) segments.push({ t0: t, s: Object.assign({}, s) });
    if (stop) break;
  }
  return { segments, contacts, crossings, endT: t, endReason, params: P, full: true };
}

/** Symétrie centrale du court (échange des deux moitiés) : position et vitesse. */
function mirrorState(s) {
  const o = { x: COURT.width - s.x, y: COURT.length - s.y, z: s.z };
  if (s.vx != null) {
    o.vx = -s.vx;
    o.vy = -s.vy;
    o.vz = s.vz;
  }
  // Demi-tour autour de l'axe vertical : la rotation et l'accélération tournent comme des vecteurs
  if (s.wx !== undefined) {
    o.wx = -s.wx;
    o.wy = -s.wy;
    o.wz = s.wz;
    if (s.ax !== undefined) {
      o.ax = -s.ax;
      o.ay = -s.ay;
      o.az = s.az;
    }
  }
  return o;
}

/** État exact à l'instant t (borné à [0, endT]). */
function stateAt(sim, t) {
  t = Math.max(0, Math.min(sim.endT, t));
  let seg = sim.segments[0];
  for (let i = 1; i < sim.segments.length; i++) {
    if (sim.segments[i].t0 <= t) seg = sim.segments[i];
    else break;
  }
  return advance(seg.s, t - seg.t0, sim.params.g);
}

/** Échantillonne la trajectoire à pas fixe (les contacts sont ajoutés exactement). */
function sample(sim, dt, t0, t1) {
  dt = dt || 1 / 60;
  t0 = t0 == null ? 0 : t0;
  t1 = t1 == null ? sim.endT : Math.min(t1, sim.endT);
  const times = [];
  for (let t = t0; t < t1; t += dt) times.push(t);
  for (const c of sim.contacts) if (c.t > t0 && c.t < t1) times.push(c.t);
  times.push(t1);
  times.sort((a, b) => a - b);
  return times.map((t) => Object.assign({ t }, stateAt(sim, t)));
}

function isSide(type) {
  return type === 'left' || type === 'right';
}

/** Contacts entre le 1er et le 2e rebond au sol (inclus) sous forme de types. */
function contactSequence(sim) {
  return sim.contacts.map((c) => c.type);
}

/**
 * Famille de la trajectoire :
 *   A : sol → fond
 *   B : sol → fond → latérale
 *   C : sol → latérale → fond
 *   D : sol → latérale
 * Retourne null si la séquence ne correspond à aucune famille.
 */
function classify(sim) {
  const seq = contactSequence(sim);
  if (seq[0] !== 'floor') return null;
  const walls = [];
  let i = 1;
  for (; i < seq.length && seq[i] !== 'floor'; i++) walls.push(seq[i]);
  if (i >= seq.length) return null; // pas de 2e rebond au sol
  const key = walls.map((w) => (isSide(w) ? 'S' : 'F')).join('');
  return { F: 'A', FS: 'B', SF: 'C', S: 'D' }[key] || null;
}

/**
 * Vitesse initiale pour qu'une balle partie de `from` touche le sol en `to` après T secondes.
 * spin (facultatif) : vecteur rotation { wx, wy, wz } (rad/s, voir spinVector) ; le lancer compense alors
 * exactement l'effet Magnus (la balle visée rebondit au même endroit, par une autre trajectoire).
 */
function launchToBounce(from, to, T, params, spin) {
  const P = withParams(params);
  const r = P.radius;
  if (!spin) {
    return {
      x: from.x,
      y: from.y,
      z: from.z,
      vx: (to.x - from.x) / T,
      vy: (to.y - from.y) / T,
      vz: (r - from.z + 0.5 * P.g * T * T) / T,
    };
  }
  // Accélération latérale ax = −k ωz vy, ay = k ωz vx : système linéaire résolu exactement
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const al = 0.5 * P.magnus * spin.wz * T;
  const den = T * (1 + al * al);
  const s = { x: from.x, y: from.y, z: from.z, vx: (dx + al * dy) / den, vy: (dy - al * dx) / den, vz: 0, wx: spin.wx, wy: spin.wy, wz: spin.wz };
  setMagnus(s, P);
  s.vz = (r - from.z + 0.5 * (P.g - s.az) * T * T) / T;
  return s;
}

/**
 * Vecteur rotation (rad/s) d'une balle qui part dans la direction horizontale (dx, dy) :
 *   top  : lift (> 0) ou coupé (< 0), autour de l'axe horizontal perpendiculaire à la trajectoire ;
 *   side : effet latéral (> 0 : la balle tourne vers la droite de sa trajectoire, en vol et au rebond) —
 *          rotation autour de la verticale plus une part autour de l'axe de la trajectoire (inclinaison
 *          de l'axe, comme une víbora), qui fait dévier la balle au rebond.
 */
function spinVector(dx, dy, top, side) {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const tilt = 0.6;
  return { wx: -top * uy + side * tilt * ux, wy: top * ux + side * tilt * uy, wz: -side };
}

/** Effet d'un état, par rapport à sa trajectoire : { top (lift > 0, coupé < 0), side, rate (rad/s) }. */
function spinParts(s) {
  if (s.wx === undefined) return { top: 0, side: 0, rate: 0 };
  const l = Math.hypot(s.vx, s.vy) || 1;
  const ux = s.vx / l;
  const uy = s.vy / l;
  return { top: -s.wx * uy + s.wy * ux, side: -s.wz, rate: Math.hypot(s.wx, s.wy, s.wz) };
}

/**
 * Angle d'incidence (en degrés, par rapport à la normale) dans le plan horizontal
 * pour un contact paroi, avant et après.
 */
function wallAngles(contact) {
  const n = contact.type === 'back' ? 'vy' : 'vx';
  const tKey = contact.type === 'back' ? 'vx' : 'vy';
  const ang = (v) => (Math.atan2(Math.abs(v[tKey]), Math.abs(v[n])) * 180) / Math.PI;
  return { inDeg: ang(contact.vIn), outDeg: ang(contact.vOut) };
}

function speed(v) {
  return Math.hypot(v.vx, v.vy, v.vz);
}

function hSpeed(v) {
  return Math.hypot(v.vx, v.vy);
}

/** Vrai si le contact paroi a lieu sur une partie vitrée (sinon grillage / au-dessus). Deux moitiés. */
function onGlass(contact) {
  const z = contact.pos.z;
  if (contact.type === 'back' || contact.type === 'backFar') return z <= COURT.backGlassHeight;
  if (isSide(contact.type)) {
    const y = contact.pos.y > COURT.depth ? COURT.length - contact.pos.y : contact.pos.y;
    return COURT.sideGlass.some((p) => y >= p.from && y <= p.to && z <= p.height);
  }
  return true;
}

const Physics = {
  COURT,
  DEFAULT_PARAMS,
  mulberry32,
  simulate,
  mirrorState,
  stateAt,
  sample,
  advance,
  reach,
  setMagnus,
  spinVector,
  spinParts,
  reflect,
  classify,
  contactSequence,
  launchToBounce,
  wallAngles,
  speed,
  hSpeed,
  onGlass,
  isSide,
};

export default Physics;

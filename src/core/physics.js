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
 * Une vraie balle de padel sur Terre (57,7 g, Ø 6,6 cm, air à 20 °C) :
 *   - en vol : gravité, traînée de l'air (la balle ralentit : un smash parti à 110 km/h rebondit à ≈ 95 km/h,
 *     un lob retombe plus raide qu'il ne monte) et effet Magnus (le lift plonge, le coupé flotte, l'effet
 *     latéral courbe), avec des coefficients mesurés sur des balles feutrées ;
 *   - au rebond : restitution qui baisse avec la vitesse d'impact (balle pressurisée : lâchée de 2,54 m,
 *     elle remonte de ≈ 1,3 m sur le gazon, 1,35 à 1,45 m sur une surface dure selon le règlement FIP) et
 *     frottement au point de contact, calculé sur sa vraie vitesse de glissement (vitesse tangentielle +
 *     rotation) : la balle glisse puis roule, elle perd de la vitesse et prend du lift ; un lift qui
 *     dépasse le roulement la fait filer, un coupé la freine. Le grillage amortit la balle.
 *     L'énergie (translation + rotation) ne fait que baisser à chaque contact.
 *
 * Le vol est découpé en segments courts (au plus `step` = 0,05 s) d'accélération constante, évaluée au
 * milieu du segment : chaque contact se calcule exactement dans son segment, la simulation reste
 * déterministe, et l'écart avec une intégration très fine est de l'ordre du millimètre (test).
 * Un état porte sa rotation (wx, wy, wz, rad/s) et l'accélération de son segment hors gravité (ax, ay, az).
 */

const COURT = {
  width: 10,
  depth: 10, // demi-longueur : le filet est en y = 10
  length: 20,
  serviceLine: 3.05, // depuis la vitre de fond (6,95 m depuis le filet)
  // Parois d'une moitié (règlement FIP), y mesuré depuis la vitre de fond de cette moitié :
  backGlassHeight: 3, // fond : vitre de 3 m…
  backHeight: 4, // … surmontée de 1 m de grille
  sideGlass: [ // latérales : vitre de 3 m de haut sur les 2 premiers mètres, puis de 2 m sur 2 m (escalier)
    { from: 0, to: 2, height: 3 },
    { from: 2, to: 4, height: 2 },
  ],
  sideHeight: [ // hauteur totale (vitre + grille) : 4 m, puis 3 m ; ensuite grille seule de 3 m jusqu'au filet
    { from: 0, to: 2, height: 4 },
    { from: 2, to: 10, height: 3 },
  ],
  // Accès (portes ouvertes) dans la grille de chaque latérale, de chaque côté du filet : 0,8 m × 2 m.
  // Hypothèse : près du filet, comme sur la plupart des courts (le règlement les place au centre des latérales).
  doors: [{ from: 8.4, to: 9.2, height: 2 }],
  netHeight: 0.88,
};

const DEFAULT_PARAMS = {
  g: 9.81,
  radius: 0.033,
  // Air : ρ A / (2 m) pour une balle de 57,7 g et 6,6 cm de diamètre (1/m)
  air: 0.0356,
  drag: 0.55, // coefficient de traînée d'une balle feutrée
  liftA: 2.022, // portance de Magnus : C_L = S / (liftA · S + liftB), S = R ω⊥ / v (balles feutrées)
  liftB: 0.981,
  step: 0.05, // durée maximale d'un segment de vol (s)
  // Restitution normale e = e0 − pente × vitesse normale d'impact (m/s), au moins eMin
  floorE: 0.78, // gazon synthétique sablé : ≈ 0,72 à 7 m/s, 0,69 à 10 m/s
  floorSlope: 0.009,
  glassE: 0.8, // vitre (surface dure) : ≈ 0,73 à 7 m/s, comme l'essai de rebond du règlement
  glassSlope: 0.0095,
  eMin: 0.45,
  floorGrip: 0.6, // frottement balle / gazon sableux
  glassGrip: 0.3, // frottement balle / vitre
  spinInertia: 0.55, // moment d'inertie / (m R²) : sphère creuse à paroi épaisse
  meshE: 0.25, // grille : elle absorbe le choc (restitution faible), freine la balle le long de la grille
  meshKeep: 0.45, // et casse sa rotation : la balle « meurt » contre la grille
  meshSpin: 0.25,
  minBounceVz: 0.3, // en dessous, la balle « roule » : fin de simulation
  // Filet (court complet) : une balle dans le filet est presque arrêtée et retombe de son côté ;
  // une balle qui frôle la bande passe, ralentie, avec un petit rebond vers le haut.
  eNet: 0.12,
  netTangent: 0.3,
  cordKeep: 0.45,
  cordSide: 0.7,
  cordLift: 0.6,
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

/**
 * État après une durée tau dans un segment (exact) : accélération du segment constante (gravité, plus
 * ax, ay, az : air et effet). La rotation est conservée.
 */
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
  }
  if (s.ax !== undefined) {
    o.ax = ax;
    o.ay = ay;
    o.az = s.az || 0;
  }
  return o;
}

/**
 * Accélération due à l'air (hors gravité) pour la vitesse v et la rotation ω, écrite dans out :
 *   traînée −(ρ A / 2m) C_D |v| v ;
 *   Magnus (ρ A / 2m) C_L v² dans la direction de ω × v, avec C_L = S / (a S + b), S = R ω⊥ / v.
 */
function airAccel(vx, vy, vz, wx, wy, wz, P, out) {
  const v2 = vx * vx + vy * vy + vz * vz;
  if (v2 < 1e-18) {
    out.ax = out.ay = out.az = 0;
    return out;
  }
  const v = Math.sqrt(v2);
  const d = P.air * P.drag * v;
  let ax = -d * vx;
  let ay = -d * vy;
  let az = -d * vz;
  const cx = wy * vz - wz * vy;
  const cy = wz * vx - wx * vz;
  const cz = wx * vy - wy * vx;
  const c = Math.sqrt(cx * cx + cy * cy + cz * cz); // |ω × v| = ω⊥ v
  if (c > 1e-9) {
    const S = (P.radius * c) / v2;
    const k = (P.air * (S / (P.liftA * S + P.liftB)) * v2) / c;
    ax += k * cx;
    ay += k * cy;
    az += k * cz;
  }
  out.ax = ax;
  out.ay = ay;
  out.az = az;
  return out;
}

const ACC = { ax: 0, ay: 0, az: 0 };

/**
 * Accélération du segment qui commence dans l'état s (modifié sur place) : air et effet évalués au
 * milieu du segment (vitesse prédite à step / 2), constants ensuite sur tout le segment.
 */
function setAccel(s, P) {
  const wx = s.wx || 0;
  const wy = s.wy || 0;
  const wz = s.wz || 0;
  const h = P.step / 2;
  airAccel(s.vx, s.vy, s.vz, wx, wy, wz, P, ACC);
  airAccel(s.vx + ACC.ax * h, s.vy + ACC.ay * h, s.vz + (ACC.az - P.g) * h, wx, wy, wz, P, ACC);
  s.ax = ACC.ax;
  s.ay = ACC.ay;
  s.az = ACC.az;
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
  // Parois hors de portée pendant un segment : inutile de calculer le contact
  const sx = reach1(s.vx, ax, P.step);
  const sy = reach1(s.vy, ay, P.step);
  if (s.y - r <= sy) t.back = reach(s.y, s.vy, ay, r, -1);
  if (COURT.depth - s.y <= sy) t.net = reach(s.y, s.vy, ay, COURT.depth, 1);
  if (s.x - r <= sx) t.left = reach(s.x, s.vx, ax, r, -1);
  if (W - r - s.x <= sx) t.right = reach(s.x, s.vx, ax, W - r, 1);
  // Un contact à τ = 0 sur une paroi qu'on vient de quitter est impossible
  // car la vitesse normale a été inversée ; on garde donc τ ≥ 0.
  return t;
}

/** Distance maximale parcourue sur un axe pendant h secondes (vitesse v, accélération a), avec marge. */
function reach1(v, a, h) {
  return Math.abs(v) * h + 0.5 * Math.abs(a) * h * h + 1e-6;
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

/** Normale de chaque surface, orientée vers le court (vers la balle). */
const NORMALS = { floor: [0, 0, 1], back: [0, 1, 0], backFar: [0, -1, 0], left: [1, 0, 0], right: [-1, 0, 0] };

/** Restitution normale d'une surface ('floor' ou 'glass') pour une vitesse normale d'impact vn (m/s). */
function restitution(surface, vn, params) {
  const P = params || DEFAULT_PARAMS;
  const e0 = surface === 'floor' ? P.floorE : P.glassE;
  const k = surface === 'floor' ? P.floorSlope : P.glassSlope;
  return Math.max(P.eMin, Math.min(e0, e0 - k * Math.abs(vn)));
}

/**
 * Nature d'une paroi au point de contact (y, z), dans les deux moitiés : 'glass' (vitre), 'mesh'
 * (grille) ou 'open' (au-dessus du mur, ou porte : la balle sort du court).
 */
function wallAt(type, y, z) {
  if (type === 'back' || type === 'backFar') return z <= COURT.backGlassHeight ? 'glass' : z <= COURT.backHeight ? 'mesh' : 'open';
  if (!isSide(type)) return 'glass';
  const yy = y > COURT.depth ? COURT.length - y : y;
  if (COURT.doors.some((d) => yy >= d.from && yy <= d.to && z <= d.height)) return 'open';
  if (COURT.sideGlass.some((p) => yy >= p.from && yy <= p.to && z <= p.height)) return 'glass';
  return COURT.sideHeight.some((p) => yy >= p.from && yy <= p.to && z <= p.height) ? 'mesh' : 'open';
}

/** Vrai si une paroi est vitrée au point (y, z) (sinon grille ou ouverture). Deux moitiés. */
function glassAt(type, y, z) {
  return wallAt(type, y, z) === 'glass';
}

/**
 * Contact avec une surface. Retourne le nouvel état (copie), avec l'accélération de son segment.
 * Sol et vitres : la vitesse normale repart avec la restitution e(v) ; le point de contact glisse à la
 * vitesse u = v_t + ω × r (r = −R n) et le frottement retire Δv = −k u, au plus jusqu'au roulement
 * (κ / (1 + κ) |u|) et au plus μ (1 + e) |v_n| (glissement pendant tout le contact) ; la rotation change de
 * Δω = (r × Δv) / (κ R²). Grillage : la balle y meurt. Filet et bande : modèle simple, rotation absorbée.
 */
function reflect(s, type, P) {
  const o = Object.assign({}, s);
  const r = P.radius;
  const wx = s.wx || 0;
  const wy = s.wy || 0;
  const wz = s.wz || 0;
  if (type === 'net' || type === 'cord') {
    if (type === 'net') {
      // Dans le filet : la balle repart à peine et retombe de son côté
      o.vy = -s.vy * P.eNet;
      o.vx = s.vx * P.netTangent;
      o.vz = s.vz * P.netTangent;
    } else {
      // Frôle la bande : passe de l'autre côté, ralentie, avec un petit rebond vers le haut
      o.vy = s.vy * P.cordKeep;
      o.vx = s.vx * P.cordSide;
      o.vz = Math.abs(s.vz) * 0.35 + P.cordLift;
    }
    o.wx = wx * P.spinNet;
    o.wy = wy * P.spinNet;
    o.wz = wz * P.spinNet;
    return setAccel(o, P);
  }
  if (type === 'floor') o.z = r;
  else if (type === 'back' || type === 'backFar') o.y = type === 'back' ? r : COURT.length - r;
  else o.x = type === 'left' ? r : COURT.width - r;
  const n = NORMALS[type];
  const vn = s.vx * n[0] + s.vy * n[1] + s.vz * n[2]; // < 0 : la balle arrive sur la surface
  const tx = s.vx - vn * n[0];
  const ty = s.vy - vn * n[1];
  const tz = s.vz - vn * n[2];
  if (type !== 'floor' && !glassAt(type, s.y, s.z)) {
    o.vx = tx * P.meshKeep - P.meshE * vn * n[0];
    o.vy = ty * P.meshKeep - P.meshE * vn * n[1];
    o.vz = tz * P.meshKeep - P.meshE * vn * n[2];
    o.wx = wx * P.meshSpin;
    o.wy = wy * P.meshSpin;
    o.wz = wz * P.meshSpin;
    return setAccel(o, P);
  }
  const floor = type === 'floor';
  const e = restitution(floor ? 'floor' : 'glass', vn, P);
  const mu = floor ? P.floorGrip : P.glassGrip;
  const rx = -r * n[0];
  const ry = -r * n[1];
  const rz = -r * n[2];
  const ux = tx + (wy * rz - wz * ry);
  const uy = ty + (wz * rx - wx * rz);
  const uz = tz + (wx * ry - wy * rx);
  const un = Math.sqrt(ux * ux + uy * uy + uz * uz);
  let dx = 0;
  let dy = 0;
  let dz = 0;
  if (un > 1e-9) {
    const kap = P.spinInertia;
    const dv = Math.min((kap / (1 + kap)) * un, mu * (1 + e) * Math.abs(vn));
    dx = (-dv * ux) / un;
    dy = (-dv * uy) / un;
    dz = (-dv * uz) / un;
  }
  o.vx = tx + dx - e * vn * n[0];
  o.vy = ty + dy - e * vn * n[1];
  o.vz = tz + dz - e * vn * n[2];
  const inv = 1 / (P.spinInertia * r * r);
  o.wx = wx + (ry * dz - rz * dy) * inv;
  o.wy = wy + (rz * dx - rx * dz) * inv;
  o.wz = wz + (rx * dy - ry * dx) * inv;
  return setAccel(o, P);
}

/** Copie de l'état initial, avec sa rotation (nulle par défaut) et l'accélération de son segment. */
function initialState(init, P) {
  const s = Object.assign({}, init);
  if (s.wx === undefined) {
    s.wx = 0;
    s.wy = 0;
    s.wz = 0;
  }
  return setAccel(s, P);
}

/**
 * Simule une trajectoire.
 * @param {{x,y,z,vx,vy,vz,wx?,wy?,wz?}} init état initial (rotation facultative, rad/s)
 * @param {object} [opts] { params, tMax, maxFloorBounces, court: 'half' (défaut) | 'full' }
 * @returns {{ segments: Array<{t0:number, s:object}>, contacts: Array, endT:number, endReason:string, params:object }}
 *   segments : morceaux de vol d'accélération constante (au plus `step` s, ou jusqu'au contact suivant).
 */
function simulate(init, opts) {
  opts = opts || {};
  if (opts.court === 'full') return simulateFull(init, opts);
  const P = withParams(opts.params);
  const tMax = opts.tMax != null ? opts.tMax : 6;
  const maxFloor = opts.maxFloorBounces != null ? opts.maxFloorBounces : 2;

  let s = initialState(init, P);
  let t = 0;
  let segEnd = P.step;
  const segments = [{ t0: 0, s: Object.assign({}, s) }];
  const contacts = [];
  let floorCount = 0;
  let endReason = 'tMax';

  for (let guard = 0; guard < 5000; guard++) {
    const times = nextEventTimes(s, P);
    let tau = Infinity;
    for (const k in times) tau = Math.min(tau, times[k]);
    const toStep = segEnd - t;
    if (t + Math.min(tau, toStep) >= tMax) {
      s = advance(s, tMax - t, P.g);
      t = tMax;
      endReason = 'tMax';
      break;
    }
    if (toStep < tau - EPS) {
      // Fin du segment : l'air a ralenti la balle, l'effet a tourné avec elle → nouvelle accélération
      s = setAccel(advance(s, toStep, P.g), P);
      t = segEnd;
      segEnd = t + P.step;
      segments.push({ t0: t, s: Object.assign({}, s) });
      continue;
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
      if (type !== 'floor' && wallAt(type, s.y, s.z) === 'open') {
        // Au-dessus du mur ou par une porte : la balle sort du court
        contacts.push({ type: 'exit', wall: type, t, pos: { x: s.x, y: s.y, z: s.z }, vIn, vOut: vIn });
        endReason = 'exit';
        stop = true;
        break;
      }
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
    segEnd = t + P.step;
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
  // Parois et filet hors de portée pendant un segment : inutile de calculer le contact
  const sx = reach1(s.vx, ax, P.step);
  const sy = reach1(s.vy, ay, P.step);
  if (s.y - r <= sy) t.back = reach(s.y, s.vy, ay, r, -1);
  if (L - r - s.y <= sy) t.backFar = reach(s.y, s.vy, ay, L - r, 1);
  if (s.x - r <= sx) t.left = reach(s.x, s.vx, ax, r, -1);
  if (W - r - s.x <= sx) t.right = reach(s.x, s.vx, ax, W - r, 1);
  // Filet : d'abord la face (la balle touche le plan du filet), puis le passage du centre au-dessus
  if (Math.abs(s.y - N) - r <= sy) {
    if (s.y < N - r - 1e-7) t.netFace = reach(s.y, s.vy, ay, N - r, 1);
    else if (s.y > N + r + 1e-7) t.netFace = reach(s.y, s.vy, ay, N + r, -1);
    else if (s.vy > 0 && s.y < N - 1e-7) t.netCross = reach(s.y, s.vy, ay, N, 1);
    else if (s.vy < 0 && s.y > N + 1e-7) t.netCross = reach(s.y, s.vy, ay, N, -1);
  }
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
  let segEnd = P.step;
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

  for (let guard = 0; guard < 5000; guard++) {
    const times = nextEventTimesFull(s, P);
    let tau = Infinity;
    for (const k in times) tau = Math.min(tau, times[k]);
    const toStep = segEnd - t;
    if (t + Math.min(tau, toStep) >= tMax) {
      s = advance(s, tMax - t, P.g);
      t = tMax;
      endReason = 'tMax';
      break;
    }
    if (toStep < tau - EPS) {
      s = setAccel(advance(s, toStep, P.g), P);
      t = segEnd;
      segEnd = t + P.step;
      segments.push({ t0: t, s: Object.assign({}, s) });
      continue;
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
      if (type !== 'floor' && wallAt(type, s.y, s.z) === 'open') {
        // Au-dessus du mur ou par une porte : la balle sort du court
        const v = { vx: s.vx, vy: s.vy, vz: s.vz };
        contacts.push({ type: 'exit', wall: type, t, pos: { x: s.x, y: s.y, z: s.z }, vIn: v, vOut: v, side: s.y < COURT.depth ? 0 : 1 });
        endReason = 'exit';
        stop = true;
        break;
      }
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
    if (changed) {
      segments.push({ t0: t, s: Object.assign({}, s) });
      segEnd = t + P.step;
    }
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

/** État exact à l'instant t, borné au début du premier segment et à endT (recherche dichotomique). */
function stateAt(sim, t) {
  const segs = sim.segments;
  t = Math.max(segs[0].t0, Math.min(sim.endT, t));
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  return advance(seg.s, t - seg.t0, sim.params.g);
}

/** Hauteur maximale de la balle entre t0 et t1 (exacte : sommet de chaque segment). */
function maxHeight(sim, t0, t1) {
  const g = sim.params.g;
  const segs = sim.segments;
  let best = Math.max(stateAt(sim, t0).z, stateAt(sim, t1).z);
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i].t0;
    const b = i + 1 < segs.length ? segs[i + 1].t0 : sim.endT;
    if (b <= t0 || a >= t1) continue;
    const s = segs[i].s;
    const ge = g - (s.az || 0);
    if (s.vz > 0 && ge > 0) {
      const top = a + s.vz / ge;
      if (top > Math.max(a, t0) && top < Math.min(b, t1)) best = Math.max(best, advance(s, top - a, g).z);
    }
  }
  return best;
}

/**
 * Prolonge une trajectoire dans le passé de `duration` secondes (vol libre, segments ajoutés avant le
 * premier, instants négatifs) : la balle remonte jusqu'à la raquette qui l'a frappée. Les segments se
 * raccordent exactement (même position et même vitesse au raccord). Modifie et retourne sim.
 */
function extendBack(sim, duration) {
  const P = sim.params;
  let s = sim.segments[0].s;
  let t = sim.segments[0].t0;
  const tEnd = t - duration;
  const pre = [];
  const wx = s.wx || 0;
  const wy = s.wy || 0;
  const wz = s.wz || 0;
  while (t > tEnd + 1e-12) {
    const h = Math.min(P.step, t - tEnd);
    airAccel(s.vx, s.vy, s.vz, wx, wy, wz, P, ACC);
    airAccel(s.vx - ACC.ax * h * 0.5, s.vy - ACC.ay * h * 0.5, s.vz - (ACC.az - P.g) * h * 0.5, wx, wy, wz, P, ACC);
    const gz = ACC.az - P.g;
    const prev = {
      x: s.x - s.vx * h + 0.5 * ACC.ax * h * h,
      y: s.y - s.vy * h + 0.5 * ACC.ay * h * h,
      z: s.z - s.vz * h + 0.5 * gz * h * h,
      vx: s.vx - ACC.ax * h,
      vy: s.vy - ACC.ay * h,
      vz: s.vz - gz * h,
      wx,
      wy,
      wz,
      ax: ACC.ax,
      ay: ACC.ay,
      az: ACC.az,
    };
    pre.push({ t0: t - h, s: prev });
    s = prev;
    t -= h;
  }
  sim.segments = pre.reverse().concat(sim.segments);
  return sim;
}

/**
 * Vol libre (ni parois ni filet) jusqu'au sol, découpé comme la simulation : c'est donc exactement la
 * trajectoire simulée jusqu'au premier contact. o = { netY } : passage du plan y = netY.
 * Retourne { t, s (état au sol), apex (hauteur maximale), net: { t, s } | null, seg (segment du rebond :
 * { t0, s }) } ou null (pas de rebond).
 */
function flyFree(init, params, o) {
  const P = withParams(params);
  const netY = o && o.netY != null ? o.netY : null;
  let s = initialState(init, P);
  let t = 0;
  let apex = s.z;
  let net = null;
  for (let guard = 0; guard < 400; guard++) {
    const tf = floorTime(s, P);
    const h = Math.min(tf, P.step);
    const ge = P.g - s.az;
    if (s.vz > 0 && ge > 0 && s.vz / ge < h) apex = Math.max(apex, advance(s, s.vz / ge, P.g).z);
    if (netY != null && !net && s.vy !== 0) {
      const tn = reach(s.y, s.vy, s.ay, netY, s.vy > 0 ? 1 : -1);
      if (tn <= h) net = { t: t + tn, s: advance(s, tn, P.g) };
    }
    if (tf <= P.step) {
      const end = advance(s, tf, P.g);
      return { t: t + tf, s: end, apex: Math.max(apex, end.z), net, seg: { t0: t, s } };
    }
    s = setAccel(advance(s, P.step, P.g), P);
    t += P.step;
    apex = Math.max(apex, s.z);
  }
  return null;
}

/**
 * Position en vol libre à l'instant T (sans aucun contact, même sous le sol), sans allocation : sert au
 * tir itératif. Mêmes segments et même accélération que la simulation. Écrit { x, y, z } dans out.
 */
function freePositionAt(init, T, P, out) {
  let x = init.x;
  let y = init.y;
  let z = init.z;
  let vx = init.vx;
  let vy = init.vy;
  let vz = init.vz;
  const wx = init.wx || 0;
  const wy = init.wy || 0;
  const wz = init.wz || 0;
  const hh = P.step / 2;
  for (let t = 0; t < T - 1e-12; ) {
    const h = Math.min(P.step, T - t);
    airAccel(vx, vy, vz, wx, wy, wz, P, ACC);
    airAccel(vx + ACC.ax * hh, vy + ACC.ay * hh, vz + (ACC.az - P.g) * hh, wx, wy, wz, P, ACC);
    const ge = P.g - ACC.az;
    x += vx * h + 0.5 * ACC.ax * h * h;
    y += vy * h + 0.5 * ACC.ay * h * h;
    z += vz * h - 0.5 * ge * h * h;
    vx += ACC.ax * h;
    vy += ACC.ay * h;
    vz -= ge * h;
    t = h < P.step ? T : t + P.step;
  }
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
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
 * Estimation rapide (formules, sans simulation) d'un tir de `from` vers un rebond en `to` après T secondes,
 * avec une traînée linéarisée et sans effet : vitesse de départ (km/h, à ±5 %), hauteur au plan y = netY
 * (à ≈ ±1 m selon l'effet) et hauteur maximale (à ±0,6 m). Sert à écarter d'emblée les tirs impossibles.
 */
function launchEstimate(from, to, T, netY, params) {
  const P = params ? withParams(params) : DEFAULT_PARAMS;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = P.radius - from.z;
  const g = P.g;
  const vVac = Math.hypot(dx / T, dy / T, (dz + 0.5 * g * T * T) / T);
  const c = P.air * P.drag * vVac * 0.85;
  const phi = (1 - Math.exp(-c * T)) / c;
  const vx = dx / phi;
  const vy = dy / phi;
  const vz = (dz + (g / c) * (T - phi)) / phi;
  const out = { kmh: Math.hypot(vx, vy, vz) * 3.6, netZ: null, apex: from.z };
  const pn = (netY - from.y) / vy; // φ(t) au passage du filet
  if (pn > 0 && c * pn < 1) out.netZ = from.z + vz * pn - (g / c) * (-Math.log(1 - c * pn) / c - pn);
  if (vz > 0) {
    const ts = Math.log(1 + (c * vz) / g) / c;
    const ps = (1 - Math.exp(-c * ts)) / c;
    out.apex = from.z + vz * ps - (g / c) * (ts - ps);
  }
  return out;
}

/**
 * Vitesse initiale pour qu'une balle partie de `from` touche le sol en `to` après T secondes, avec la
 * traînée et, si `spin` { wx, wy, wz } (rad/s, voir spinVector) est donné, l'effet Magnus. Tir itératif sur
 * le vol libre : départ calculé avec une traînée linéarisée, puis méthode de Broyden (≈ 4 vols), au
 * dixième de millimètre près. Retourne l'état initial (rotation et accélération du premier segment).
 */
function launchToBounce(from, to, T, params, spin) {
  const P = withParams(params);
  const r = P.radius;
  const w = spin || { wx: 0, wy: 0, wz: 0 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = r - from.z;
  // Traînée linéarisée (vitesse moyenne ≈ 0,85 × celle du tir sans air) : solution exacte de ce modèle
  const vVac = Math.hypot(dx / T, dy / T, (dz + 0.5 * P.g * T * T) / T);
  const c = P.air * P.drag * vVac * 0.85;
  const phi = c * T > 1e-6 ? (1 - Math.exp(-c * T)) / c : T;
  const fall = c * T > 1e-6 ? (P.g / c) * (T - phi) : 0.5 * P.g * T * T;
  const state = (v) => ({ x: from.x, y: from.y, z: from.z, vx: v[0], vy: v[1], vz: v[2], wx: w.wx, wy: w.wy, wz: w.wz });
  const pos = { x: 0, y: 0, z: 0 };
  const errOf = (v) => {
    freePositionAt(state(v), T, P, pos);
    return [to.x - pos.x, to.y - pos.y, r - pos.z];
  };
  let v = [dx / phi, dy / phi, (dz + fall) / phi];
  let err = errOf(v);
  // Jacobienne ∂position / ∂v (lignes) : φ·I au départ, corrigée par Broyden à chaque vol
  const B = [[phi, 0, 0], [0, phi, 0], [0, 0, phi]];
  for (let it = 0; it < 20 && Math.max(Math.abs(err[0]), Math.abs(err[1]), Math.abs(err[2])) > 1e-4; it++) {
    const dv = solve3(B, err);
    if (!dv) break;
    const v2 = [v[0] + dv[0], v[1] + dv[1], v[2] + dv[2]];
    const err2 = errOf(v2);
    const n2 = dv[0] * dv[0] + dv[1] * dv[1] + dv[2] * dv[2];
    if (n2 > 0) {
      for (let i = 0; i < 3; i++) {
        const k = (err[i] - err2[i] - (B[i][0] * dv[0] + B[i][1] * dv[1] + B[i][2] * dv[2])) / n2;
        B[i][0] += k * dv[0];
        B[i][1] += k * dv[1];
        B[i][2] += k * dv[2];
      }
    }
    v = v2;
    err = err2;
  }
  return initialState(state(v), P);
}

/** Résout A · x = b (règle de Cramer), A donnée par lignes. null si A est singulière. */
function solve3(A, b) {
  const det = (m0, m1, m2) => m0[0] * (m1[1] * m2[2] - m1[2] * m2[1]) - m0[1] * (m1[0] * m2[2] - m1[2] * m2[0]) + m0[2] * (m1[0] * m2[1] - m1[1] * m2[0]);
  const d = det(A[0], A[1], A[2]);
  if (!(Math.abs(d) > 1e-12)) return null;
  const col = (k) => A.map((row, i) => row.map((x, j) => (j === k ? b[i] : x)));
  return [0, 1, 2].map((k) => {
    const m = col(k);
    return det(m[0], m[1], m[2]) / d;
  });
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
  return glassAt(contact.type, contact.pos.y, contact.pos.z);
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
  airAccel,
  setAccel,
  restitution,
  spinVector,
  spinParts,
  reflect,
  classify,
  contactSequence,
  launchToBounce,
  launchEstimate,
  flyFree,
  maxHeight,
  extendBack,
  wallAngles,
  speed,
  hSpeed,
  onGlass,
  wallAt,
  isSide,
};

export default Physics;

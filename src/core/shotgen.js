/*
 * Glass Lab — génération des balles adverses du mode Match infini.
 * Échantillonnage par rejet, déterministe pour une graine donnée, sans DOM.
 *
 * Une balle retenue doit :
 *   (a) suivre la séquence de contacts de sa famille,
 *   (b) retomber dans la moitié du joueur,
 *   (c) être atteignable : au moins un type de coup atteint la qualité de jouabilité
 *       (config.quality.playable) dans le temps disponible, depuis la position du joueur.
 */

import P from './physics.js';
import G from './geometry.js';
import Q from './quality.js';
import F from './flight.js';
import DEFAULT_CONFIG from './config.js';

const FAMILIES = {
  direct: { id: 'direct', name: 'Directe', short: 'Directe' },
  A: { id: 'A', name: 'Vitre de fond', short: 'Fond' },
  B: { id: 'B', name: 'Fond puis latérale (double vitre)', short: 'Fond → lat.' },
  C: { id: 'C', name: 'Latérale puis fond (double vitre inversée)', short: 'Lat. → fond' },
  D: { id: 'D', name: 'Latérale seule croisée', short: 'Latérale' },
};
const FAMILY_IDS = ['direct', 'A', 'B', 'C', 'D'];

/** Séquences de contacts attendues (sol = 1er et dernier contact). */
const SEQUENCES = {
  direct: [['floor', 'floor']],
  A: [['floor', 'back', 'floor']],
  B: [['floor', 'back', 'left', 'floor'], ['floor', 'back', 'right', 'floor']],
  C: [['floor', 'left', 'back', 'floor'], ['floor', 'right', 'back', 'floor']],
  D: [['floor', 'left', 'floor'], ['floor', 'right', 'floor']],
};

function matchesFamily(sim, family) {
  const seq = P.contactSequence(sim).join(',');
  return SEQUENCES[family].some((s) => s.join(',') === seq);
}

/** Graine dérivée (balle n° i d'une partie, tirage n° j…), bien mélangée. */
function mixSeed(seed, i) {
  return (P.mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0)() * 4294967296) >>> 0;
}

/** Tirage pondéré d'une famille. weights = { famille: poids > 0 } (familles absentes : poids 1). */
function pickFamily(weights, rng) {
  const w = FAMILY_IDS.map((f) => Math.max(0, weights && weights[f] != null ? weights[f] : 1));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let r = rng() * total;
  for (let i = 0; i < FAMILY_IDS.length; i++) {
    r -= w[i];
    if (r <= 0) return FAMILY_IDS[i];
  }
  return FAMILY_IDS[FAMILY_IDS.length - 1];
}

const lerp = (a, b, k) => a + (b - a) * k;

/** Balle directe : rebond court puis 2e rebond avant toute vitre. */
function directCandidate(seed, level, cfg) {
  const rng = P.mulberry32(seed);
  const d = cfg.shotgen.direct;
  const k = (level - 1) / (cfg.shotgen.levels - 1);
  const rnd = (a) => lerp(a[0], a[1], rng());
  const T = rnd([lerp(d.T[0][0], d.T[1][0], k), lerp(d.T[0][1], d.T[1][1], k)]);
  const yb = rnd(d.yb);
  const xb = rnd([1.5, 8.5]);
  const angle = (rnd(d.angle) * (1 + k) * Math.PI) / 180;
  const x0 = xb - (10 - yb) * Math.tan(angle);
  if (x0 < 0.3 || x0 > 9.7) return null;
  const init = P.launchToBounce({ x: x0, y: 10, z: rnd(d.z0) }, { x: xb, y: yb }, T);
  return { init, sim: P.simulate(init, { maxFloorBounces: 2, tMax: 6 }) };
}

/** Contrôles de vraisemblance d'une balle à vitres (apexMax : hauteur maximale avant le rebond). */
function glassPlausible(sim, family, apexMax) {
  if (sim.endReason !== 'floor' || P.classify(sim) !== family) return false;
  const walls = sim.contacts.filter((c) => c.type !== 'floor');
  const floors = sim.contacts.filter((c) => c.type === 'floor');
  if (!walls.every(P.onGlass)) return false; // contacts sur les parties vitrées seulement
  // Au moins 0,6 m de hauteur après la dernière paroi pour que la balle reste jouable
  const lastWall = walls[walls.length - 1];
  let maxZ = 0;
  for (const s of P.sample(sim, 1 / 60, lastWall.t, floors[1].t)) maxZ = Math.max(maxZ, s.z);
  if (maxZ < 0.6) return false;
  if (floors[1].pos.y < 0.5) return false; // retombe à au moins 0,5 m de la vitre de fond
  let apex = 0;
  for (const s of P.sample(sim, 1 / 30, 0, floors[0].t)) apex = Math.max(apex, s.z);
  return apex < (apexMax || 3.5); // pas de chandelle irréaliste (sauf lob voulu)
}

/** Balle à vitres (familles A à D) : un tirage de paramètres de lancer, côté gauche ou droit. */
function glassCandidate(family, seed, level, cfg) {
  const rng = P.mulberry32(seed);
  const k = (level - 1) / (cfg.shotgen.levels - 1);
  const r = cfg.shotgen.glass[family];
  const between = (pair) => [lerp(pair[0][0], pair[1][0], k), lerp(pair[0][1], pair[1][1], k)];
  const rnd = (a) => lerp(a[0], a[1], rng());
  const right = rng() < 0.5;
  const T = rnd(between(cfg.shotgen.glassT));
  let xb = rnd(r.xb);
  const yb = rnd(r.yb);
  const angle = (rnd(between(r.angle)) * Math.PI) / 180;
  const z0 = rnd(r.z0);
  let x0 = xb - (10 - yb) * Math.tan(angle);
  if (!right) {
    xb = 10 - xb;
    x0 = 10 - x0;
  }
  if (x0 < 0.3 || x0 > 9.7) return null;
  const init = P.launchToBounce({ x: x0, y: 10, z: z0 }, { x: xb, y: yb }, T);
  const sim = P.simulate(init, { maxFloorBounces: 2, tMax: 6 });
  return glassPlausible(sim, family) ? { init, sim } : null;
}

/**
 * Balle frappée depuis un point imposé `origin` (camp adverse) : c'est l'échange continu, l'adversaire
 * renvoie depuis l'endroit où il a joué ta balle. Le point de rebond suit les plages de la famille ;
 * la vitesse dépend du niveau, et augmente si l'adversaire frappe près du filet (attaque).
 * Retourne { init (état au passage du filet, t = 0), sim, tStart (< 0 : instant de la frappe) } ou null.
 */
function originCandidate(family, seed, level, origin, cfg) {
  const rng = P.mulberry32(seed);
  const k = (level - 1) / (cfg.shotgen.levels - 1);
  const rc = cfg.rally;
  const rnd = (a) => lerp(a[0], a[1], rng());
  const right = rng() < 0.5;
  let xb;
  let yb;
  if (family === 'direct') {
    xb = rnd([1.5, 8.5]);
    yb = rnd(cfg.shotgen.direct.yb);
  } else {
    const r = cfg.shotgen.glass[family];
    xb = rnd(r.xb);
    yb = rnd(r.yb);
    if (!right) xb = 10 - xb;
  }
  // Hauteur au-dessus du filet : plus basse quand le niveau monte, et quand l'adversaire frappe près du
  // filet (renvoi court = attaque). La durée de vol s'en déduit exactement (passage par le filet à
  // cette hauteur et rebond au point visé) : z(f·T) = z0 + (r − z0)·f + g·T²·f(1 − f)/2.
  const attack = Math.max(0, Math.min(1, (17 - origin.y) / 5));
  const hr = [lerp(rc.netHeight[0][0], rc.netHeight[1][0], k), lerp(rc.netHeight[0][1], rc.netHeight[1][1], k)];
  const hNet = Math.max(rc.minNetHeight, rnd(hr) - rc.attackDrop * attack);
  const r0 = P.DEFAULT_PARAMS.radius;
  const g = P.DEFAULT_PARAMS.g;
  const f = (origin.y - 10) / (origin.y - yb); // fraction du trajet horizontal parcourue au filet
  if (!(f > 0 && f < 1)) return null;
  const T2 = (2 * (hNet - origin.z - (r0 - origin.z) * f)) / (g * f * (1 - f));
  if (!(T2 > 0)) return null;
  const T = Math.sqrt(T2);
  const vh = Math.hypot(xb - origin.x, yb - origin.y) / T;
  if (vh < rc.hSpeed[0] || vh > rc.hSpeed[1]) return null;
  const st = P.launchToBounce(origin, { x: xb, y: yb }, T);
  const tn = f * T; // instant du passage au-dessus du filet
  const net = G.ballistic(st, tn, g);
  if (net.x < 0.2 || net.x > 9.8) return null;
  const init = { x: net.x, y: 10, z: net.z, vx: net.vx, vy: net.vy, vz: net.vz };
  const sim = P.simulate(init, { maxFloorBounces: 2, tMax: 6 });
  if (family === 'direct' ? sim.endReason !== 'floor' : !glassPlausible(sim, family)) return null;
  return { init, sim, tStart: -tn };
}

/**
 * Génère une balle adverse.
 * o = { seed, family, level (1–5), player: { x, y } (position au moment de la frappe adverse), config?,
 *       origin? : { x, y, z } point de frappe adverse imposé (échange continu) }
 * Retourne { family, seed, level, init, sim, tStart, endT, best, attempts }.
 * tStart (< 0) : instant de la frappe adverse, avant le passage du filet (t = 0).
 */
function generateShot(o) {
  const cfg = o.config || DEFAULT_CONFIG;
  const level = Math.max(1, Math.min(cfg.shotgen.levels, o.level || 1));
  const player = o.player || cfg.player.start;
  for (let attempt = 0; attempt < cfg.shotgen.maxAttempts; attempt++) {
    const sub = mixSeed(o.seed, attempt);
    const cand = o.origin
      ? originCandidate(o.family, sub, level, o.origin, cfg)
      : o.family === 'direct'
        ? directCandidate(sub, level, cfg)
        : glassCandidate(o.family, sub, level, cfg);
    if (!cand) continue;
    const { init, sim } = cand;
    if (sim.endReason !== 'floor' || !matchesFamily(sim, o.family)) continue; // (a)
    const f1 = sim.contacts[0].pos;
    const f2 = sim.contacts[sim.contacts.length - 1].pos;
    if (!(f1.y > 0 && f1.y < 10 && f2.y > 0 && f2.y < 10)) continue; // (b)
    const tStart = cand.tStart != null ? cand.tStart : -G.preNetDuration(init, sim.params.g);
    const shot = { family: o.family, seed: o.seed, level, init, sim, tStart, endT: sim.endT, origin: o.origin || null };
    const best = Q.bestChoice(shot, player, cfg);
    if (!best.best || best.best.quality < cfg.quality.playable) continue; // (c)
    shot.best = best;
    shot.attempts = attempt + 1;
    return shot;
  }
  return null;
}

/**
 * Génère une balle en essayant d'abord la famille demandée, puis les autres (dans l'ordre),
 * pour ne jamais bloquer la partie si une famille est injouable depuis la position du joueur.
 */
function generateAny(o) {
  // Repli : les autres familles dans un ordre pseudo-aléatoire (reproductible), pour ne pas favoriser l'une d'elles
  const others = FAMILY_IDS.filter((f) => f !== o.family);
  const key = (f) => mixSeed(o.seed ^ 0x68e31da4, FAMILY_IDS.indexOf(f));
  const order = [o.family].concat(others.sort((a, b) => key(a) - key(b)));
  for (const family of order) {
    const shot = generateShot(Object.assign({}, o, { family }));
    if (shot) return shot;
  }
  throw new Error('Aucune balle atteignable (graine ' + o.seed + ')');
}

/** Séquence déterministe de n balles (joueur immobile) : utile pour les tests et le débogage. */
function sequence(seed, n, o) {
  o = o || {};
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = mixSeed(seed, 1000 + i);
    const family = pickFamily(o.weights, P.mulberry32(s));
    out.push(generateAny({ seed: s, family, level: o.level || 1, player: o.player, config: o.config }));
  }
  return out;
}

/* ---------- Coups de n'importe quel joueur, vers n'importe quelle zone (court complet) ---------- */

const NET_Y = 10;

/** Durée de vol pour passer le filet à la hauteur hNet puis rebondir en `bounce` (repère du receveur). */
function netTime(origin, bounce, hNet, cfg) {
  const g = P.DEFAULT_PARAMS.g;
  const r = P.DEFAULT_PARAMS.radius;
  const f = (origin.y - NET_Y) / (origin.y - bounce.y); // fraction du trajet horizontal parcourue au filet
  if (!(f > 0 && f < 1)) return null;
  const T2 = (2 * (hNet - origin.z - (r - origin.z) * f)) / (g * f * (1 - f));
  return T2 > 0 ? Math.sqrt(T2) : null;
}

/**
 * Durée de vol d'une trajectoire tendue partant à `speed` m/s et rebondissant en `bounce` :
 * branche rapide (la plus courte) de l'équation |v(T)| = speed ; null si la vitesse ne suffit pas.
 */
function flatTime(origin, bounce, speed) {
  const g = P.DEFAULT_PARAMS.g;
  const c = P.DEFAULT_PARAMS.radius - origin.z;
  const dh = Math.hypot(bounce.x - origin.x, bounce.y - origin.y);
  const v = (T) => Math.hypot(dh, c + (g * T * T) / 2) / T;
  const tMin = Math.sqrt((2 * Math.hypot(c, dh)) / g); // trajectoire de vitesse minimale
  if (v(tMin) > speed) return null;
  let lo = 0.01;
  let hi = tMin;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (v(mid) > speed) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Lancement d'un coup de style donné depuis `origin` (repère du receveur, y > 10) vers un rebond tiré dans
 * `zone` { x: [a, b], y: [a, b] }. Vérifie la vitesse (ordres de grandeur du style), le passage du filet
 * et la hauteur maximale. Retourne { init, net (état au plan du filet), tn (durée frappe → filet), bounce } ou null.
 */
function styleLaunch(origin, style, zone, level, rng, cfg) {
  const st = cfg.styles[style];
  const g = P.DEFAULT_PARAMS.g;
  const k = (level - 1) / (cfg.shotgen.levels - 1);
  const rnd = (a) => lerp(a[0], a[1], rng());
  const range = (pair) => [lerp(pair[0][0], pair[1][0], k), lerp(pair[0][1], pair[1][1], k)];
  const bounce = { x: rnd(zone.x), y: rnd(zone.y) };
  let T;
  if (st.mode === 'net') {
    let h = rnd(range(st.net));
    // Frappé près du filet (attaque), le coup est plus tendu
    if (style === 'drive' || style === 'defense') h = Math.max(cfg.rally.minNetHeight, h - cfg.rally.attackDrop * Math.max(0, Math.min(1, (17 - origin.y) / 5)));
    T = netTime(origin, bounce, h, cfg);
  } else T = flatTime(origin, bounce, rnd(range(st.speed)));
  if (!T) return null;
  const spin = st.spin ? styleSpin(origin, bounce, st.spin, rng) : null;
  const init = P.launchToBounce(origin, bounce, T, undefined, spin);
  const kmh = P.speed(init) * 3.6;
  if (kmh < st.kmh[0] || kmh > st.kmh[1]) return null;
  if (!(init.vy < 0)) return null;
  const tn = P.reach(origin.y, init.vy, init.ay || 0, NET_Y, -1);
  if (!(tn < T)) return null;
  const net = G.ballistic(init, tn, g);
  if (net.z < P.COURT.netHeight + cfg.minNetClearance || net.x < 0.2 || net.x > 9.8) return null;
  const tTop = init.vz / (g - (init.az || 0));
  const top = tTop > 0 && tTop < T ? G.ballistic(init, tTop, g).z : origin.z;
  if (top < st.apex[0] || top > st.apex[1]) return null;
  return { init, net: Object.assign(net, { y: NET_Y }), tn, bounce };
}

/**
 * Effet d'un coup (config.styles[style].spin) : lift / coupé tiré dans `top`, effet latéral d'intensité
 * tirée dans `side` ; il part vers la paroi latérale la plus proche du rebond si `toWall` (víbora : la balle
 * file vers la grille), sinon d'un côté au hasard. Retourne le vecteur rotation (rad/s).
 */
function styleSpin(origin, bounce, sp, rng) {
  const top = lerp(sp.top[0], sp.top[1], rng());
  let side = lerp(sp.side[0], sp.side[1], rng());
  const dx = bounce.x - origin.x;
  const dy = bounce.y - origin.y;
  // Droite de la trajectoire : (dy, −dx) ; vers la paroi la plus proche du rebond, ou au hasard
  const right = sp.toWall ? (bounce.x < 5 ? -1 : 1) * dy > 0 : rng() < 0.5;
  if (!right) side = -side;
  return P.spinVector(dx, dy, top, side);
}

/**
 * Zone de rebond (repère du receveur) d'une famille, du côté `side` = { xMin, xMax } couvert par le
 * receveur, croisée avec la profondeur du style quand elles se recouvrent (sinon celle de la famille).
 */
function familyZone(family, side, style, cfg) {
  const fam = family === 'direct' ? { xb: [1.5, 8.5], yb: cfg.shotgen.direct.yb } : cfg.shotgen.glass[family];
  let xb = fam.xb.slice();
  // Familles à parois latérales : la paroi du côté du receveur
  if ((family === 'B' || family === 'C' || family === 'D') && (side.xMin + side.xMax) / 2 < 5) xb = [10 - xb[1], 10 - xb[0]];
  const x = [Math.max(xb[0], side.xMin), Math.min(xb[1], side.xMax)];
  if (x[1] - x[0] < 0.3) return null;
  const sd = cfg.styles[style].depth;
  const y0 = Math.max(fam.yb[0], sd[0]);
  const y1 = Math.min(fam.yb[1], sd[1]);
  return { x, y: y1 - y0 >= 0.5 ? [y0, y1] : fam.yb.slice() };
}

/**
 * Coup d'un joueur vers l'équipe adverse, sur le court complet.
 * o = {
 *   origin { x, y, z } (monde) : point de frappe ; team : équipe du frappeur (0 bas, 1 haut) ;
 *   style (config.styles) ; zone { x, y } (repère du receveur) ou family + side (balle d'entraînement) ;
 *   receiver : { pos { x, y } (monde), config (lois de déplacement du receveur), playable, noVolley } : la
 *              balle doit être jouable par lui (meilleur choix ≥ playable) — facultatif ;
 *   level, seed, config, extra (champs ajoutés au vol)
 * }
 * Retourne un vol (flight.js) valide — la balle passe le filet et rebondit chez le receveur —, avec
 * .shot (balle vue par le receveur, .family, .best si receiver), ou null.
 */
function generateTo(o) {
  const cfg = o.config || DEFAULT_CONFIG;
  const level = Math.max(1, Math.min(cfg.shotgen.levels, o.level || 1));
  const recv = 1 - o.team;
  const origin = F.toTeamFrame(recv, o.origin);
  if (!(origin.y > NET_Y + 0.05)) return null;
  const st = cfg.styles[o.style];
  // Zone imposée (ex. carré de service) : la famille ne sert alors qu'à filtrer
  const zone = o.zone || (o.family ? familyZone(o.family, o.side || { xMin: 0.3, xMax: 9.7 }, o.style, cfg) : { x: [0.6, 9.4], y: st.depth });
  if (!zone) return null;
  const recvPos = o.receiver ? F.toTeamFrame(recv, o.receiver.pos) : null;
  const playable = o.receiver && o.receiver.playable != null ? o.receiver.playable : cfg.quality.playable;
  const attempts = o.attempts || cfg.shotgen.maxAttempts;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rng = P.mulberry32(mixSeed(o.seed, attempt));
    const c = styleLaunch(origin, o.style, zone, level, rng, cfg);
    if (!c) continue;
    const half = P.simulate(c.net, { maxFloorBounces: 2, tMax: 6 });
    if (!half.contacts.length || half.contacts[0].type !== 'floor') continue; // dehors : vitre avant le rebond
    const family = F.familyOf(half);
    if (!family) continue; // trajectoire hors des familles (ex. deux fois la même vitre) : écartée
    if (o.family) {
      if (family !== o.family) continue;
      if (family === 'direct' ? half.endReason !== 'floor' : !glassPlausible(half, family, st.apex[1])) continue;
    }
    const shot = { init: c.net, sim: half, tStart: -c.tn, endT: half.endT, family };
    if (recvPos) {
      const best = Q.bestChoice(shot, recvPos, o.receiver.config || cfg, { noVolley: !!o.receiver.noVolley });
      if (!best.best || best.best.quality < playable) continue;
      shot.best = best;
    }
    const flight = F.makeFlight(F.fromTeamFrame(recv, c.init), o.team, Object.assign({ style: o.style, level }, o.extra || {}));
    if (flight.verdict.fault || !flight.shot) continue; // cohérence avec la physique du court complet
    flight.shot.family = family;
    if (shot.best) flight.shot.best = shot.best;
    flight.attempts = attempt + 1;
    return flight;
  }
  return null;
}

const ShotGen = {
  FAMILIES,
  FAMILY_IDS,
  SEQUENCES,
  matchesFamily,
  mixSeed,
  pickFamily,
  generateShot,
  generateAny,
  sequence,
  netTime,
  flatTime,
  styleLaunch,
  familyZone,
  generateTo,
};

export default ShotGen;

/*
 * Glass Lab — génération des coups (déterministe pour une graine donnée, sans DOM).
 * Échantillonnage par rejet : un coup tiré (point de rebond, durée de vol, effet) est lancé avec la vraie
 * physique (air, effet), puis vérifié sur sa trajectoire réelle : vitesse de départ du style, passage du
 * filet, hauteur maximale, famille de vitres, et jouable par le receveur (meilleur choix suffisant).
 */

import P from './physics.js';
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
  return P.maxHeight(sim, 0, floors[0].t) < (apexMax || 3.5); // pas de chandelle irréaliste (sauf lob voulu)
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
  // Tri rapide (formules) : vitesse, filet et hauteur clairement hors des bornes du style
  const est = P.launchEstimate(origin, bounce, T, NET_Y);
  if (est.kmh < st.kmh[0] * 0.94 || est.kmh > st.kmh[1] * 1.06) return null;
  if (est.apex < st.apex[0] - 0.6 || est.apex > st.apex[1] + 0.6) return null;
  if (est.netZ != null && est.netZ < P.COURT.netHeight + cfg.minNetClearance - 1.1) return null;
  const init = P.launchToBounce(origin, bounce, T, undefined, spin);
  const kmh = P.speed(init) * 3.6;
  if (kmh < st.kmh[0] || kmh > st.kmh[1]) return null;
  if (!(init.vy < 0)) return null;
  // Trajectoire réelle jusqu'au rebond (air, effet) : passage du filet et hauteur maximale
  const fly = P.flyFree(init, undefined, { netY: NET_Y });
  if (!fly || !fly.net) return null;
  const net = fly.net.s;
  if (net.z < P.COURT.netHeight + cfg.minNetClearance || net.x < 0.2 || net.x > 9.8) return null;
  if (fly.apex < st.apex[0] || fly.apex > st.apex[1]) return null;
  return { init, net: Object.assign(net, { y: NET_Y }), tn: fly.net.t, bounce, fly };
}

/**
 * Suite d'un coup après son rebond, vue par le receveur (demi-court, depuis 2 ms avant le rebond) : la
 * même trajectoire que le vol complet après le rebond, pour trier les familles sans simuler tout le vol.
 */
function afterBounce(fly) {
  const near = P.advance(fly.seg.s, Math.max(0, fly.t - 0.002 - fly.seg.t0), P.DEFAULT_PARAMS.g);
  return P.simulate(near, { maxFloorBounces: 2, tMax: 6 });
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
 *   level, seed, config, extra (champs ajoutés au vol), knownFamily (refuser les trajectoires hors familles)
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
    if (o.family || o.knownFamily) {
      // Tri rapide sur la fin de trajectoire (la même que celle du vol complet)
      const fam = F.familyOf(afterBounce(c.fly));
      if (!fam || (o.family && fam !== o.family)) continue;
    }
    const flight = F.makeFlight(F.fromTeamFrame(recv, c.init), o.team, Object.assign({ style: o.style, level }, o.extra || {}));
    if (flight.verdict.fault || !flight.shot) continue; // dehors, filet : refusé
    const shot = flight.shot;
    const family = shot.family;
    // Balle pour toi : toujours d'une famille connue (stats, répétition espacée) ; ailleurs (smash gagnant…), peu importe
    if (!family && (o.family || o.knownFamily)) continue;
    if (o.family) {
      if (family !== o.family) continue;
      if (family === 'direct' ? shot.sim.endReason !== 'floor' : !glassPlausible(shot.sim, family, st.apex[1])) continue;
    }
    if (recvPos) {
      const best = Q.bestChoice(shot, recvPos, o.receiver.config || cfg, { noVolley: !!o.receiver.noVolley, prefer: o.receiver.prefer });
      if (!best.best || best.best.quality < playable) continue;
      shot.best = best;
    }
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
  netTime,
  flatTime,
  styleLaunch,
  familyZone,
  generateTo,
};

export default ShotGen;

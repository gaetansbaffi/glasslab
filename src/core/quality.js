/*
 * Glass Lab — classification des coups, qualité de frappe et meilleur choix (mode Match infini).
 * Fonctions pures et déterministes, sans DOM. Constantes dans config.js.
 *
 * Une « balle » (shot) est l'objet produit par shotgen.js : { init, sim, tStart, endT, family, ... }.
 * Repère monde de physics.js : x largeur, y profondeur (0 = vitre de fond du joueur, 10 = filet), z hauteur.
 */

import P from './physics.js';
import G from './geometry.js';
import PL from './players.js';
import DEFAULT_CONFIG from './config.js';

const SHOT_TYPES = ['volley', 'halfVolley', 'beforeGlass', 'afterGlass', 'overhead'];
const SHOT_NAMES = {
  volley: 'Volée',
  halfVolley: 'Demi-volée',
  beforeGlass: 'Avant vitre',
  afterGlass: 'Après vitre',
  overhead: 'Bandeja / smash',
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Score trapézoïdal : 1 dans [a, b], décroît linéairement jusqu'à 0 en z0 (gauche) et z1 (droite). */
function trapezoid(v, z0, a, b, z1) {
  if (v >= a && v <= b) return 1;
  if (v < a) return a === z0 ? 0 : clamp01((v - z0) / (a - z0));
  return b === z1 ? 0 : clamp01((z1 - v) / (z1 - b));
}

/**
 * État de la balle à l'instant t, enrichi de l'historique des contacts :
 * { t, x, y, z, vx, vy, vz, floorBounces, wallHits, tSinceBounce }.
 * t < 0 : vol côté adverse, avant le filet (trajectoire remontée analytiquement).
 */
function ballStateAt(shot, t) {
  const g = shot.sim.params.g;
  const s = t < 0 ? G.ballistic(shot.init, t, g) : P.stateAt(shot.sim, t);
  let floorBounces = 0;
  let wallHits = 0;
  let lastFloorT = null;
  for (const c of shot.sim.contacts) {
    if (c.t > t) break;
    if (c.type === 'floor') {
      floorBounces++;
      lastFloorT = c.t;
    } else wallHits++;
  }
  return Object.assign({ t, floorBounces, wallHits, tSinceBounce: lastFloorT == null ? null : t - lastFloorT }, s);
}

/**
 * Type de coup selon l'état de la balle au contact :
 *   overhead    : aucun rebond au sol, balle au-dessus de la tête (bandeja, víbora, smash)
 *   volley      : aucun rebond au sol
 *   afterGlass  : au moins un contact avec une paroi
 *   halfVolley  : juste après le rebond (≤ ~150 ms), balle basse (< 0,4 m) et montante
 *   beforeGlass : au moins un rebond, aucune paroi
 */
function classifyShot(b, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const c = cfg.classify;
  if (!b.floorBounces) return b.z >= cfg.zones.overhead.zMin ? 'overhead' : 'volley';
  if (b.wallHits > 0) return 'afterGlass';
  if (b.tSinceBounce != null && b.tSinceBounce <= c.halfVolleyWindow && b.z < c.halfVolleyMaxZ && b.vz > 0) return 'halfVolley';
  return 'beforeGlass';
}

/** La balle est-elle frappable depuis la position du joueur (hauteur et portée du type de coup) ? */
function inZone(b, player, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  if (b.floorBounces >= 2) return false;
  if (b.y > P.COURT.depth) return false; // la balle n'a pas encore passé le filet : interdit de la jouer
  const type = classifyShot(b, cfg);
  const z = cfg.zones[type];
  if (b.z < z.zMin || b.z > z.zMax) return false;
  return Math.hypot(b.x - player.x, b.y - player.y) <= z.reach;
}

/* ---------- Qualité ---------- */

/** Hauteur : 1 dans la fenêtre idéale du type de coup, 0 aux limites de la zone. */
function heightScore(type, z, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const zn = cfg.zones[type];
  return trapezoid(z, zn.zMin, zn.ideal[0], zn.ideal[1], zn.zMax);
}

/**
 * Placement : le joueur doit être derrière la ligne de la balle (balle devant lui, côté filet),
 * pas en dessous, à distance de bras latéralement.
 * Retourne { score, error } — error = distance (m) à la plage de placement idéale.
 */
function placementScore(b, player, type, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const pc = cfg.placement;
  const zn = cfg.zones[type];
  const ahead = b.y - player.y;
  const lateral = Math.abs(b.x - player.x);
  const reach = zn.reach;
  // Distance latérale idéale propre au coup (au-dessus de la tête : plus près du corps)
  const latIdeal = zn.lateral || pc.lateral;
  const latZero = zn.lateralZero != null ? zn.lateralZero : pc.lateralZero;
  const sa = trapezoid(ahead, pc.aheadZero[0], pc.ahead[0], pc.ahead[1], pc.aheadZero[1]);
  const sl = trapezoid(lateral, latZero, latIdeal[0], latIdeal[1], reach);
  const ea = ahead < pc.ahead[0] ? pc.ahead[0] - ahead : ahead > pc.ahead[1] ? ahead - pc.ahead[1] : 0;
  const el = lateral < latIdeal[0] ? latIdeal[0] - lateral : lateral > latIdeal[1] ? lateral - latIdeal[1] : 0;
  return { score: sa * sl, error: Math.hypot(ea, el), ahead, lateral };
}

/** Aisance : marge de temps (s) et vitesse de la balle au contact (plus lente = mieux). */
function easeScore(b, timeMargin, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const e = cfg.ease;
  const m = clamp01((timeMargin || 0) / e.marginFull);
  const v = P.speed(b);
  const sv = clamp01(1 - (v - e.speedEasy) / (e.speedHard - e.speedEasy));
  return 0.5 * (m + sv);
}

/** Dégagement : distance de la balle aux parois au point de frappe ; un coin est pénalisé. */
function clearanceScore(b, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const c = cfg.clearance;
  const dBack = b.y;
  const dSide = Math.min(b.x, 10 - b.x);
  const d = Math.min(dBack, dSide);
  let s = clamp01((d - c.min) / (c.full - c.min));
  if (dBack < c.full && dSide < c.full) s *= c.cornerPenalty;
  return { score: s, dist: d, corner: dBack < c.full && dSide < c.full };
}

/**
 * Qualité d'une frappe (0 à 1). ctx = { timeMargin } (s).
 * Retourne { score, type, parts: { height, placement, ease, clearance }, placementError, corner }.
 */
function shotQuality(b, player, ctx, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const type = classifyShot(b, cfg);
  const w = cfg.quality.weights;
  const pl = placementScore(b, player, type, cfg);
  const cl = clearanceScore(b, cfg);
  const parts = {
    height: heightScore(type, b.z, cfg),
    placement: pl.score,
    ease: easeScore(b, ctx && ctx.timeMargin, cfg),
    clearance: cl.score,
  };
  const score = w.height * parts.height + w.placement * parts.placement + w.ease * parts.ease + w.clearance * parts.clearance;
  return { score, type, parts, placementError: pl.error, corner: cl.corner, clearance: cl.dist };
}

/* ---------- Meilleur choix ---------- */

/** Position idéale du joueur pour frapper une balle en b, du côté le plus proche de `from`. */
function idealPosition(b, from, cfg, type) {
  cfg = cfg || DEFAULT_CONFIG;
  const zn = type && cfg.zones[type];
  const o = (zn && zn.idealOffset) || cfg.placement.idealOffset;
  const B = cfg.player.bounds;
  const cand = [-1, 1].map((sgn) => ({
    x: Math.max(B.xMin, Math.min(B.xMax, b.x + sgn * o.lateral)),
    y: Math.max(B.yMin, Math.min(B.yMax, b.y - o.ahead)),
  }));
  const d = (p) => Math.hypot(p.x - from.x, p.y - from.y);
  return d(cand[0]) <= d(cand[1]) ? cand[0] : cand[1];
}

/**
 * Marge de temps : temps disponible depuis la frappe adverse, moins réaction et trajet
 * (accélération, croisière et freinage : players.travelTime).
 */
function timeMargin(shot, t, from, to, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const travel = PL.travelTime(Math.hypot(to.x - from.x, to.y - from.y), cfg.player);
  return t - shot.tStart - cfg.player.reactionTime - travel;
}

/**
 * Meilleur point de frappe atteignable pour chaque type de coup, par échantillonnage de la trajectoire.
 * from = position du joueur au moment de la frappe adverse ; opts = { noVolley (retour de service : la
 * balle doit rebondir avant d'être jouée), prefer: { type: bonus } (préférence tactique, pour départager
 * des coups de qualité proche ; les qualités rendues ne changent pas) }.
 * Retourne { byType: { type: { quality, t, ball, pos, margin } | null }, bestType, best }.
 */
function bestChoice(shot, from, cfg, opts) {
  cfg = cfg || DEFAULT_CONFIG;
  const dt = cfg.strike.sampleDt;
  const byType = { volley: null, halfVolley: null, beforeGlass: null, afterGlass: null, overhead: null };
  // Jamais avant le passage du filet (t = 0)
  const t0 = Math.max(shot.tStart + cfg.player.reactionTime, 0);
  for (let t = t0; t < shot.endT; t += dt) {
    const b = ballStateAt(shot, t);
    if (b.floorBounces >= 2) break;
    const type = classifyShot(b, cfg);
    if (opts && opts.noVolley && (type === 'volley' || type === 'overhead')) continue;
    const zn = cfg.zones[type];
    if (b.z < zn.zMin || b.z > zn.zMax) continue;
    const pos = idealPosition(b, from, cfg, type);
    if (Math.hypot(b.x - pos.x, b.y - pos.y) > zn.reach) continue;
    const margin = timeMargin(shot, t, from, pos, cfg);
    if (margin < 0) continue; // pas atteignable à temps
    const q = shotQuality(b, pos, { timeMargin: margin }, cfg);
    if (!byType[type] || q.score > byType[type].quality) byType[type] = { quality: q.score, t, ball: b, pos, margin, detail: q };
  }
  const pref = (opts && opts.prefer) || {};
  const value = (k) => byType[k].quality + (pref[k] || 0);
  let bestType = null;
  for (const k of SHOT_TYPES) if (byType[k] && (!bestType || value(k) > value(bestType))) bestType = k;
  return { byType, bestType, best: bestType ? byType[bestType] : null };
}

/* ---------- Contexte du double ---------- */

/**
 * Ta position au moment de frapper, par rapport à ton partenaire et à ton côté du court :
 *   partnerGap : écart de profondeur avec ton partenaire (m) ; aligned : écart ≤ alignTolerance ;
 *   ahead : > 0 si tu es devant ton partenaire (plus près du filet) ;
 *   ownSide : tu restes de ton côté (tu couvres la droite du court, x ≥ 4,2 m).
 * Ne change pas la qualité de la frappe : c'est un conseil de placement dans le double.
 */
function doublesContext(pos, partner, teamMode, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const gap = pos.y - partner.y;
  return {
    teamMode,
    partnerGap: Math.round(Math.abs(gap) * 100) / 100,
    ahead: Math.round(gap * 100) / 100,
    aligned: Math.abs(gap) <= cfg.tactics.alignTolerance,
    ownSide: pos.x >= 4.2,
  };
}

/** Conseil de placement dans le double (vide si tout va bien). */
function doublesAdvice(d) {
  if (!d) return '';
  if (!d.aligned) return d.ahead > 0 ? 'tu étais seul devant : recule avec ton partenaire' : 'ton partenaire était au filet : monte avec lui';
  if (!d.ownSide) return 'tu as quitté ton côté : ton partenaire couvre la gauche';
  return '';
}

/* ---------- Feedback et règle à retenir (textes générés à partir des données) ---------- */

const fmt = (n, d) => n.toFixed(d == null ? 2 : d).replace('.', ',');
const kmh = (v) => Math.round(v * 3.6);
const WALL_NAMES = { back: 'vitre de fond', left: 'vitre latérale gauche', right: 'vitre latérale droite' };

/** Pourquoi ce coup était moins bon : la composante la plus faible, en clair. */
function weakness(r, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  if (!r.parts) return '';
  const p = r.parts;
  const order = Object.keys(p).sort((a, b) => p[a] - p[b]);
  const k = order[0];
  if (p[k] >= 0.85) return '';
  const zn = cfg.zones[r.type];
  if (k === 'clearance') return r.corner ? 'la balle mourait dans le coin' : 'trop près de la vitre pour armer';
  if (k === 'height') return r.ball && r.ball.z < zn.ideal[0] ? 'balle trop basse au contact' : 'balle trop haute au contact';
  if (k === 'placement') {
    const pl = placementScore(r.ball, r.player, r.type, cfg);
    if (pl.ahead < cfg.placement.ahead[0]) return 'la balle était déjà derrière toi';
    if (pl.lateral < (zn.lateral || cfg.placement.lateral)[0]) return 'trop collé à la balle';
    return 'trop loin de la balle';
  }
  return 'balle rapide, peu de temps pour te placer';
}

/**
 * Feedback court (non bloquant) d'une balle jouée ou perdue.
 * Retourne { level: 'good' | 'ok' | 'bad', text }.
 */
function feedback(r, familyName, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const best = `${SHOT_NAMES[r.bestType]} (${fmt(r.bestQuality)})`;
  if (r.outcome === 'miss' && r.reason !== 'weak') {
    return { level: 'bad', text: `${r.reasonLabel} — ${familyName}. Meilleur choix : ${best}.` };
  }
  const why = weakness(r, cfg);
  const head = `${SHOT_NAMES[r.type]} (${fmt(r.quality)})`;
  if (r.outcome === 'miss') return { level: 'bad', text: `${head} : frappe trop faible, dans le filet. Meilleur choix : ${best}${why ? ', ' + why : ''}.` };
  const level = r.quality >= cfg.quality.good ? 'good' : r.quality >= cfg.quality.ok ? 'ok' : 'bad';
  if (r.type === r.bestType) return { level, text: `${head} — ${familyName}, meilleur choix${why ? ' ; ' + why : ''}.` };
  return { level, text: `${head} — ${familyName}. Meilleur choix : ${best}${why ? ', ' + why : ''}.` };
}

const RULE_BY_BEST = {
  volley: 'Quand la balle va mourir près de la vitre ou dans le coin, prends-la de volée avant le rebond, devant toi.',
  halfVolley: 'Rebond court et balle qui filerait vers la vitre : joue la demi-volée juste après le rebond, sans reculer.',
  beforeGlass: 'Balle qui rebondit loin de la vitre : joue-la avant la vitre, quand elle redescend à hauteur de hanche.',
  afterGlass: 'Laisse la vitre travailler : place-toi derrière la ligne de la balle, à distance de bras, et frappe quand elle redescend après la vitre.',
  overhead: 'Balle haute qui passe au-dessus de toi : frappe-la avant le rebond, au-dessus de la tête, un peu devant toi et du côté de ta raquette (bandeja) ; smash si elle est courte et bien haute, près du filet.',
};

/**
 * Détail d'une balle : lignes chiffrées (angles d'incidence, vitesse après rebond, dégagement)
 * et règle à retenir. best = shot.best.
 */
/** Ce que l'effet change pour le receveur. */
const SPIN_HINTS = {
  cut: 'rebond bas et freiné, elle sort peu de la vitre : avance-toi et prépare une frappe basse',
  top: 'rebond haut et rapide, elle sort fort de la vitre : recule et laisse-la venir',
  side: 'elle dévie au rebond, vers la grille : décale-toi du côté de l’effet',
};

/**
 * Effet d'une balle (état avec rotation) en mots : { label (« Balle coupée », « Balle liftée »,
 * « Effet latéral », « Coupée latérale »… ou null si l'effet est faible), turns (tours / s), hint }.
 */
function spinOf(s) {
  const sp = P.spinParts(s);
  const turns = sp.rate / (2 * Math.PI);
  const cut = sp.top <= -50;
  const top = sp.top >= 50;
  const side = Math.abs(sp.side) >= 70;
  if (!cut && !top && !side) return { label: null, turns, hint: '' };
  let label;
  if (cut) label = side ? 'Coupée latérale' : 'Balle coupée';
  else if (top) label = side ? 'Liftée latérale' : 'Balle liftée';
  else label = 'Effet latéral';
  let hint = cut ? SPIN_HINTS.cut : top ? SPIN_HINTS.top : SPIN_HINTS.side;
  if (side && (cut || top)) hint += ' ; elle dévie aussi au rebond, vers la grille';
  return { label, turns, hint };
}

function explainBall(shot, r) {
  const lines = [];
  const floor = shot.sim.contacts[0];
  const h = Math.max(...P.sample(shot.sim, 1 / 60, floor.t, shot.endT).map((b) => b.z));
  const spin = spinOf(shot.init);
  if (spin.label) lines.push(`Effet : ${spin.label.toLowerCase()} (≈ ${Math.round(spin.turns)} tours/s) — ${spin.hint}.`);
  lines.push(`Rebond au sol à ${fmt(floor.pos.y, 1)} m du fond : ${kmh(P.speed(floor.vIn))} → ${kmh(P.speed(floor.vOut))} km/h, la balle remonte jusqu'à ${fmt(h)} m.`);
  for (const c of shot.sim.contacts) {
    if (c.type === 'floor') continue;
    const a = P.wallAngles(c);
    lines.push(
      `${WALL_NAMES[c.type][0].toUpperCase() + WALL_NAMES[c.type].slice(1)} à ${fmt(c.pos.z)} m : incidence ${Math.round(a.inDeg)}° → sortie ${Math.round(a.outDeg)}°, ${kmh(P.hSpeed(c.vIn))} → ${kmh(P.hSpeed(c.vOut))} km/h.`
    );
  }
  const best = shot.best.best;
  const cl = clearanceScore(best.ball);
  lines.push(
    `Meilleur point (${SHOT_NAMES[shot.best.bestType].toLowerCase()}) : balle à ${fmt(best.ball.z)} m, ${kmh(P.speed(best.ball))} km/h, ` +
      `à ${fmt(cl.dist, 1)} m de la paroi la plus proche${cl.corner ? ' (coin)' : ''}, marge ${fmt(Math.max(0, best.margin))} s.`
  );
  if (r && r.outcome === 'hit') {
    const c = clearanceScore(r.ball);
    lines.push(`Ta frappe (${SHOT_NAMES[r.type].toLowerCase()}) : balle à ${fmt(r.ball.z)} m, à ${fmt(c.dist, 1)} m de la paroi, erreur de placement ${fmt(r.placementError)} m.`);
  }
  if (r && r.doubles) {
    const d = r.doubles;
    const where = d.partnerGap < 0.5 ? 'à sa hauteur' : `${fmt(d.partnerGap, 1)} m ${d.ahead > 0 ? 'devant' : 'derrière'} lui`;
    const advice = doublesAdvice(d);
    lines.push(`Double : ton équipe était ${d.teamMode === 'attack' ? 'au filet' : 'en défense'}, tu étais ${where}${advice ? ' — ' + advice : ''}.`);
  }
  // Règle : le meilleur coup, illustré par les chiffres de cette balle
  let rule = RULE_BY_BEST[shot.best.bestType];
  const glass = shot.best.byType.afterGlass;
  if (shot.best.bestType !== 'afterGlass' && glass) {
    const gc = clearanceScore(glass.ball);
    rule += ` Ici, la sortie de vitre ne valait que ${fmt(glass.quality)}${gc.corner ? ' : la balle s’enfermait dans le coin' : gc.dist < 1 ? ` : elle restait à ${fmt(gc.dist, 1)} m de la paroi` : ''}.`;
  } else if (shot.best.bestType === 'afterGlass') {
    const w = shot.sim.contacts.filter((c) => c.type !== 'floor');
    const last = w[w.length - 1];
    const a = P.wallAngles(last);
    rule += ` Ici, la balle sort de la ${WALL_NAMES[last.type]} à ${Math.round(a.outDeg)}° et ${kmh(P.hSpeed(last.vOut))} km/h : elle revient vers le centre, attends-la.`;
  }
  return { lines, rule };
}

const Quality = {
  SHOT_TYPES,
  SHOT_NAMES,
  trapezoid,
  ballStateAt,
  classifyShot,
  inZone,
  heightScore,
  placementScore,
  easeScore,
  clearanceScore,
  shotQuality,
  idealPosition,
  timeMargin,
  bestChoice,
  doublesContext,
  doublesAdvice,
  spinOf,
  weakness,
  feedback,
  explainBall,
};

export default Quality;

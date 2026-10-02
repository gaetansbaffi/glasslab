/*
 * Glass Lab — tactique du double, en fonctions pures (ni DOM, ni Three.js).
 *
 *   - positions : chaque équipe est en défense (au fond, près des vitres) ou en attaque (au filet) ;
 *     les partenaires restent alignés, couvrent chacun leur côté et glissent ensemble vers la balle ;
 *   - transitions : on monte au filet derrière un bon lob ou depuis une balle courte, on recule sur un lob ;
 *   - qui prend la balle : celui de son côté ; au centre, le mieux placé, et à égalité celui dont le
 *     coup droit est au centre ;
 *   - interception des IA : meilleur point atteignable (réaction, accélération), au-dessus de la tête compris ;
 *   - choix du coup des IA selon leur position et la balle reçue ; probabilité de faute ;
 *   - renvoi automatique de ta frappe selon sa qualité et la situation.
 *
 * Repère d'équipe : celui de flight.js (sa vitre de fond en y = 0, le filet en y = 10). Pour l'équipe du
 * haut, c'est le symétrique du court : « droite » y est la droite des joueurs qui regardent le filet.
 */
import Q from './quality.js';
import PL from './players.js';
import DEFAULT_CONFIG from './config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Positions ---------- */

/**
 * Position cible d'un joueur (repère de son équipe).
 * side : +1 = joueur de droite, −1 = joueur de gauche ; mode : 'attack' | 'defense' ;
 * ballX : position latérale de la balle (repère de l'équipe) vers laquelle la paire glisse.
 */
function formation(side, mode, ballX, cfg) {
  const t = (cfg || DEFAULT_CONFIG).tactics;
  const attack = mode === 'attack';
  const half = attack ? t.attackHalfWidth : t.halfWidth;
  const shift = clamp(((ballX == null ? 5 : ballX) - 5) * t.shift, -t.shiftMax, t.shiftMax);
  return { x: clamp(5 + side * half + shift, 0.7, 9.3), y: attack ? t.attackY : t.defenseY };
}

/**
 * Cible du partenaire IA : la place de son équipe, mais aligné sur toi si tu t'en écartes nettement
 * (les partenaires restent alignés : jamais l'un au filet et l'autre au fond).
 */
function partnerSpot(side, mode, ballX, userPos, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const f = formation(side, mode, ballX, cfg);
  if (userPos && Math.abs(userPos.y - f.y) > cfg.tactics.alignTolerance) f.y = clamp(userPos.y, cfg.tactics.defenseY - 0.6, cfg.tactics.attackY + 0.4);
  return f;
}

/**
 * Mode de chaque équipe après une frappe de l'équipe `team` depuis `hitterY` (repère de son équipe) :
 *   - frappe au filet (volée, smash…) : l'équipe est en attaque ;
 *   - lob profond qui passe au-dessus des adversaires : l'équipe monte, les adversaires reculent ;
 *   - balle courte reçue (rebond à moins de 3,5 m du filet) et jouée : on monte au filet ;
 *   - sinon, frappe du fond : défense.
 * modes = ['attack' | 'defense', …] (par équipe). Retourne une copie.
 */
function modesAfterHit(modes, team, o) {
  const out = modes.slice();
  const recv = 1 - team;
  // Seul un lob très profond oblige l'équipe au filet à reculer ; sinon elle le joue au-dessus de la tête
  const deepLob = o.style === 'lob' && o.bounceY != null && o.bounceY < 2.3;
  if (o.hitterY >= 6.0 || ['volley', 'bandeja', 'vibora', 'smash'].includes(o.style)) out[team] = 'attack';
  else if (deepLob || (o.style === 'chiquita' && o.hitterY >= 3.5) || (o.shortBall && o.hitterY >= 4.5)) out[team] = 'attack';
  else out[team] = 'defense';
  if (deepLob) out[recv] = 'defense';
  return out;
}

/* ---------- Qui prend la balle ---------- */

/** Le coup droit de ce joueur est-il tourné vers le centre ? (droitier à gauche, gaucher à droite) */
function forehandToCenter(side, hand) {
  return side * hand < 0;
}

/**
 * Point où l'équipe joue la balle (repère de l'équipe) : là où elle croise la ligne des joueurs à hauteur de
 * volée s'ils sont au filet, sinon le premier rebond.
 */
function decisionPoint(shot, lineY, mode) {
  if (mode === 'attack') {
    for (let t = 0; t < shot.endT; t += 1 / 60) {
      const b = Q.ballStateAt(shot, t);
      if (b.floorBounces > 0) break;
      if (b.y <= lineY + 0.3) return b.z <= 2.4 ? { x: b.x, y: b.y, volley: true } : null;
    }
  }
  const f = shot.sim.contacts[0];
  return f ? { x: f.pos.x, y: f.pos.y, volley: false } : null;
}

/**
 * Qui prend la balle dans une équipe.
 * players = [{ side (+1 droite, −1 gauche), hand (1 droitier, −1 gaucher), pos { x, y } }] (repère de
 * l'équipe), shot = balle vue par l'équipe, mode = mode de l'équipe, params = lois de déplacement (par joueur).
 * Retourne { index, x, central } : index du joueur qui la prend dans `players`.
 */
function whoTakes(players, shot, mode, params, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const lineY = (players[0].pos.y + players[1].pos.y) / 2;
  const d = decisionPoint(shot, lineY, mode) || decisionPoint(shot, lineY, 'defense');
  const x = d ? d.x : 5;
  const band = cfg.tactics.centerBand;
  const sideOf = (i) => players[i].side;
  const right = sideOf(0) > 0 ? 0 : 1;
  if (x >= 5 + band) return { index: right, x, central: false };
  if (x <= 5 - band) return { index: 1 - right, x, central: false };
  // Au centre : le mieux placé (temps pour rejoindre le point), avantage au coup droit tourné vers le centre
  const target = { x, y: d ? Math.min(9.4, Math.max(0.5, d.y)) : 3 };
  const cost = players.map((p, i) => PL.reachTime(p.pos, target, params[i]) - (forehandToCenter(p.side, p.hand) ? cfg.tactics.forehandBonus : 0));
  return { index: cost[0] <= cost[1] ? 0 : 1, x, central: true };
}

/* ---------- Interception des IA ---------- */

const AI_CONFIGS = new WeakMap();

/** Configuration de qualité avec les lois de déplacement d'un joueur IA (pour bestChoice et timeMargin). */
function aiConfig(cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  let out = AI_CONFIGS.get(cfg);
  if (!out) {
    const ai = cfg.ai;
    out = Object.assign({}, cfg, { player: Object.assign({}, cfg.player, { speed: ai.speed, accel: ai.accel, decel: ai.decel, reactionTime: ai.reaction }) });
    AI_CONFIGS.set(cfg, out);
  }
  return out;
}

/** Préférences tactiques : au filet, volée et smash ; au fond, laisser la vitre travailler. */
const PREFER = {
  attack: { volley: 0.18, overhead: 0.25, halfVolley: -0.12, beforeGlass: 0, afterGlass: -0.04 },
  defense: { volley: -0.02, overhead: -0.08, halfVolley: -0.1, beforeGlass: 0, afterGlass: 0.08 },
};

/**
 * Où et quand une IA frappe : meilleur point atteignable de la balle (repère de son équipe) depuis `from`
 * (sa position à la frappe adverse), réaction et accélération comprises, selon son mode (au filet, elle
 * préfère la volée et les coups au-dessus de la tête).
 * opts = { noVolley } (retour de service). Retourne { t, ball, pos, type ('volley' | 'halfVolley' |
 * 'beforeGlass' | 'afterGlass' | 'overhead'), quality } ou null si la balle est hors d'atteinte.
 */
function aiIntercept(shot, from, mode, cfg, opts) {
  cfg = cfg || DEFAULT_CONFIG;
  const noVolley = !!(opts && opts.noVolley);
  const acfg = aiConfig(cfg);
  const pref = PREFER[mode] || PREFER.defense;
  const oh = cfg.overhead;
  let best = null;
  const t0 = Math.max(shot.tStart + cfg.ai.reaction, 0);
  for (let t = t0; t < shot.endT; t += 1 / 60) {
    const b = Q.ballStateAt(shot, t);
    if (b.floorBounces >= 2) break;
    if (noVolley && b.floorBounces === 0) continue; // retour de service : on laisse rebondir
    let type = Q.classifyShot(b, cfg);
    let zn = type === 'overhead' ? oh : cfg.zones[type];
    if ((type === 'volley' || type === 'beforeGlass' || type === 'afterGlass') && b.z > zn.zMax && b.z <= oh.zMax) {
      type = 'overhead';
      zn = oh;
    }
    if (b.z < zn.zMin || b.z > zn.zMax) continue;
    const pos = Q.idealPosition(b, from, acfg);
    if (Math.hypot(b.x - pos.x, b.y - pos.y) > zn.reach) continue;
    const margin = Q.timeMargin(shot, t, from, pos, acfg);
    if (margin < 0) continue;
    let q;
    if (type === 'overhead') q = 0.35 * Q.trapezoid(b.z, oh.zMin, oh.ideal[0], oh.ideal[1], oh.zMax) + 0.65 * Q.shotQuality(Object.assign({}, b, { z: 1.2 }), pos, { timeMargin: margin }, acfg).score;
    else q = Q.shotQuality(b, pos, { timeMargin: margin }, acfg).score;
    const score = q + (pref[type] || 0);
    if (!best || score > best.score) best = { t, ball: b, pos, type, quality: q, score, margin };
  }
  return best;
}

/** Sans interception possible, l'IA court vers l'endroit où la balle va mourir (elle essaie quand même). */
function chaseSpot(shot) {
  const c = shot.sim.contacts;
  const last = c[c.length - 1] || c[0];
  return last ? { x: clamp(last.pos.x, 0.5, 9.5), y: clamp(last.pos.y, 0.5, 9.5) } : { x: 5, y: 2 };
}

/* ---------- Choix du coup ---------- */

/** Tirage pondéré dans une liste [[valeur, poids], …]. */
function pick(list, rng) {
  const total = list.reduce((a, [, w]) => a + Math.max(0, w), 0) || 1;
  let r = rng() * total;
  for (const [v, w] of list) {
    r -= Math.max(0, w);
    if (r <= 0) return v;
  }
  return list[list.length - 1][0];
}

/**
 * Coup d'une IA selon sa position et la balle reçue.
 * o = { type (de interception), z (hauteur de contact), y (distance à sa vitre), oppMode, level, quality }
 */
function chooseStyle(o, rng, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const lv = o.level || 1;
  let list;
  if (o.type === 'overhead') {
    list = o.y >= 6.8 ? [['smash', lv >= 2 ? 0.1 + 0.06 * lv : 0.05], ['vibora', 0.35], ['bandeja', 0.45]] : [['bandeja', 0.6], ['vibora', 0.4]];
  } else if (o.type === 'volley') {
    list = o.y >= 6.3 ? [['volley', 0.88], ['chiquita', 0.12]] : [['volley', 0.55], ['drive', 0.45]];
  } else if (o.type === 'halfVolley') {
    list = [['chiquita', 0.5], ['drive', 0.5]];
  } else {
    const base = o.type === 'afterGlass' ? 'defense' : 'drive';
    list = o.oppMode === 'attack' ? [['lob', 0.34], ['chiquita', 0.28], [base, 0.38]] : [[base, 0.66], ['lob', 0.18], ['chiquita', 0.16]];
  }
  // Le coup doit être jouable à cette hauteur de contact
  const ok = list.filter(([s]) => o.z >= cfg.styles[s].contact[0] && o.z <= cfg.styles[s].contact[1]);
  const style = ok.length ? pick(ok, rng) : o.type === 'overhead' ? 'bandeja' : o.z > 1.9 ? 'volley' : 'drive';
  // Lob raté ou sous pression : il retombe court, au milieu du court (bandeja ou smash pour le filet)
  if (style === 'lob' && rng() < 0.25 + 0.45 * (1 - clamp(o.quality == null ? 0.7 : o.quality, 0, 1))) return 'lobShort';
  return style;
}

/**
 * Probabilité de faute d'une IA : base + difficulté de la balle reçue (1 − qualité de son interception)
 * + risque du coup ; les adversaires se trompent moins quand le niveau monte.
 */
function errorChance(o, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const e = cfg.errors[o.role === 'partner' ? 'partner' : 'opponent'];
  let p = e.base + e.hard * (1 - clamp(o.quality, 0, 1)) + (cfg.errors.risk[o.style] || 0);
  if (o.role !== 'partner') p *= 1.25 - 0.1 * (o.level || 1);
  return clamp(p, 0.005, 0.45);
}

/* ---------- Ton renvoi ---------- */

/**
 * Renvoi automatique de ta frappe (« on entraîne la décision, pas le geste ») :
 *   - au filet, une volée ;
 *   - du fond face à des adversaires au filet : un lob si ta frappe est bonne, sinon une balle de fond
 *     (qu'ils voleront) ;
 *   - sinon une balle de fond.
 * La profondeur et la précision dépendent de la qualité ; la balle part vers le côté le moins couvert.
 * o = { quality, type, z (contact), y (ta distance à ta vitre), oppMode, opponents: [{ x, y }] (repère adverse) }.
 * Retourne { style, zone (repère des adversaires), level (vitesse du coup, 1 à 5) }.
 */
function userReturn(o, rng, cfg) {
  cfg = cfg || DEFAULT_CONFIG;
  const q = clamp(o.quality, 0, 1);
  let style = 'drive';
  if (o.type === 'overhead') {
    // Au-dessus de la tête : smash si la balle est haute, près du filet et bien frappée ; víbora de temps
    // en temps sur une bonne frappe ; sinon bandeja (contrôle, balle coupée vers le fond)
    style = q >= 0.8 && o.y >= 5.0 && o.z >= 2.45 ? 'smash' : q >= 0.6 && rng() < 0.3 ? 'vibora' : 'bandeja';
  } else if ((o.type === 'volley' || o.type === 'halfVolley') && o.y >= 6.2) style = 'volley';
  else if (o.y < 5.5 && o.oppMode === 'attack' && q >= 0.55 && o.z <= cfg.styles.lob.contact[1]) style = 'lob';
  if (o.z > cfg.styles[style].contact[1] || o.z < cfg.styles[style].contact[0]) style = o.z > 1.9 ? 'volley' : 'drive';
  const depth = cfg.styles[style].depth;
  let y;
  if (style === 'lob') y = 3.3 - 2.2 * q;
  else if (style === 'volley') y = 6.0 - 3.8 * q;
  else if (style === 'smash') y = 7.5 - 3.0 * q; // smash : rebond au milieu du court adverse, qui file vers la vitre
  else y = 7.0 - 5.0 * q;
  y = clamp(y + (rng() - 0.5) * 0.8 * (1.2 - q), depth[0], depth[1]);
  // Côté le moins couvert, plus précis si la frappe est bonne
  const opp = o.opponents || [];
  const lane = (x) => opp.reduce((m, p) => Math.min(m, Math.abs(p.x - x)), 10);
  const aim = lane(2.2) >= lane(7.8) ? 2.2 : 7.8;
  const spread = 0.6 + 2.2 * (1 - q);
  const x = clamp(aim + (rng() - 0.5) * 2 * spread, 0.8, 9.2);
  return {
    style,
    zone: { x: [clamp(x - 0.35, 0.6, 9.4), clamp(x + 0.35, 0.6, 9.4)], y: [Math.max(depth[0], y - 0.4), Math.min(depth[1], y + 0.4)] },
    level: 1 + 4 * q,
  };
}

const Tactics = {
  formation,
  partnerSpot,
  modesAfterHit,
  forehandToCenter,
  decisionPoint,
  whoTakes,
  aiConfig,
  aiIntercept,
  chaseSpot,
  pick,
  chooseStyle,
  errorChance,
  userReturn,
};

export default Tactics;

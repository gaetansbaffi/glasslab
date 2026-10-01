/*
 * Glass Lab — animation des joueurs (toi et les IA) : regard qui suit la balle, corps qui pivote,
 * foulée, préparation de la raquette quand la balle arrive, geste de frappe synchronisé avec le contact.
 * S'appuie sur les fonctions pures de core/body.js ; aucune allocation par image (objets réutilisés).
 * Le temps est celui du jeu (ralenti aux premiers niveaux comme la balle).
 */
import B from '../core/body.js';
import CFG from '../core/config.js';

const SWING_DUR = 0.3; // durée d'un geste complet (s de jeu)
const PREP_TIME = 0.9; // la préparation commence ≈ 0,9 s avant le contact
const IDLE_LOOK = { x: 5, y: 10, z: 1 };

/**
 * Nouveau joueur animé.
 * o = { team (0 = bas, 1 = haut), hand (1 droitier / −1 gaucher), fp (1re personne), x, y }
 */
export function createActor(o) {
  const restYaw = o.team === 1 ? Math.PI : 0;
  return {
    team: o.team,
    hand: o.hand || 1,
    fp: !!o.fp,
    restYaw,
    pos: { x: o.x, y: o.y },
    vel: { x: 0, y: 0 },
    gait: 0,
    look: B.createLook(restYaw, CFG.view.basePitch),
    side: o.hand || 1,
    prep: 0,
    crouch: 0.05,
    hop: 0,
    height: 1,
    stroke: 'ground',
    swing: null, // { t0, dur, stroke, side, aim, height }
    racket: { grip: {}, head: {}, dir: {}, normal: {} },
    skeleton: B.createSkeleton(),
    eye: { x: 0, y: 0, z: 0 },
    lookOpts: Object.assign({}, B.LOOK, { restYaw }),
    gazeOpts: Object.assign({ idle: o.team === 1 ? { x: 5, y: 6, z: 1 } : IDLE_LOOK, restYaw }, CFG.view),
    skel: { x: 0, y: 0, bodyYaw: 0, gazeYaw: 0, gazePitch: 0, vx: 0, vy: 0, gait: 0, crouch: 0, hop: 0, twist: 0, hand: 1, racket: null },
  };
}

/** Réglages de mouvement réduits (prefers-reduced-motion) : tête et corps plus lents. */
export function setReducedMotion(a, on) {
  a.lookOpts.headMaxSpeed = on ? 5 : B.LOOK.headMaxSpeed;
  a.lookOpts.bodyMaxSpeed = on ? 3.5 : B.LOOK.bodyMaxSpeed;
  a.lookOpts.headHalfLife = on ? 0.1 : B.LOOK.headHalfLife;
}

/** Repositionne instantanément (nouvelle partie, Détail) et remet le regard vers le filet. */
export function placeActor(a, x, y) {
  a.pos.x = x;
  a.pos.y = y;
  a.vel.x = a.vel.y = 0;
  a.look = B.createLook(a.restYaw, CFG.view.basePitch);
  a.swing = null;
  a.prep = 0;
}

/**
 * Lance le geste de frappe : le tamis passe par `aim` à l'instant `contactAt` (horloge de jeu).
 * Si le contact est trop proche, le geste est accéléré.
 */
export function startSwing(a, clock, o) {
  const lead = Math.max(0, o.contactAt - clock);
  const dur = Math.max(0.16, Math.min(SWING_DUR, lead / B.CONTACT_AT || SWING_DUR));
  const t0 = lead >= B.CONTACT_AT * dur ? o.contactAt - B.CONTACT_AT * dur : clock;
  a.swing = { t0, dur, stroke: o.stroke || 'ground', side: o.side || a.side, aim: o.aim ? { x: o.aim.x, y: o.aim.y, z: o.aim.z } : null, height: o.aim ? o.aim.z : a.height };
}

/** Un geste est-il en cours (ou programmé) ? */
export function swinging(a, clock) {
  return !!a.swing && clock < a.swing.t0 + a.swing.dur;
}

/**
 * Met à jour l'animation pour l'image courante.
 * f = {
 *   x, y, vx, vy : position et vitesse au sol ;
 *   ball : { x, y, z } | null ; ahead : position de la balle ≈ 0,22 s plus tard (anticipation du regard) ;
 *   incoming : { t (s avant le contact prévu), z (hauteur de contact), x, y } | null — la balle est pour ce joueur ;
 *   hop : saut du split-step (m) ; crouchScale : part de la flexion appliquée (1re personne : réduite) ;
 *   lookAt : point regardé à la place de la balle (facultatif) ; offHand : cible de la main libre (facultatif)
 * }
 */
export function updateActor(a, f, dt, clock) {
  a.gait += Math.hypot(f.x - a.pos.x, f.y - a.pos.y);
  a.pos.x = f.x;
  a.pos.y = f.y;
  a.vel.x = f.vx || 0;
  a.vel.y = f.vy || 0;
  a.hop = f.hop || 0;

  // Regard : la tête suit la balle (yeux à la hauteur courante), le corps pivote si besoin ;
  // f.lookAt impose un point (le serveur regarde le receveur, pas la balle qu'il tient)
  B.eyePosition(a.pos, a.look, a.crouch * (f.crouchScale == null ? 1 : f.crouchScale), a.hop, a.eye);
  a.look = B.lookStep(a.look, B.gazeTarget(a.look, a.eye, f.lookAt || f.ball, a.pos, a.gazeOpts, f.lookAt ? null : f.ahead), dt, a.lookOpts);

  // Côté de la balle (coup droit / revers) et préparation
  if (f.ball) a.side = B.ballSide(a.side, a.pos, a.look.bodyYaw, f.incoming || f.ball, 0.2);
  const inc = f.incoming;
  const sw = a.swing && clock < a.swing.t0 + a.swing.dur ? a.swing : null;
  if (!sw) a.swing = null;
  const wantPrep = inc && !sw && inc.t < PREP_TIME ? 1 : 0;
  a.prep = B.approach(a.prep, wantPrep, dt, wantPrep ? 0.09 : 0.12);
  if (inc) a.height = B.approach(a.height, Math.max(0.15, Math.min(2.2, inc.z)), dt, 0.08);
  a.stroke = inc && inc.z > 1.95 ? 'overhead' : 'ground';
  const wantCrouch = sw ? B.crouchFor(sw.height) : a.prep > 0.05 ? B.crouchFor(a.height) * a.prep : 0.05;
  a.crouch = B.approach(a.crouch, wantCrouch, dt, 0.08);

  // Raquette : geste, préparation ou garde
  let twist = 0;
  if (sw) {
    const s = Math.max(0, (clock - sw.t0) / sw.dur);
    B.racketPose({ pos: a.pos, bodyYaw: a.look.bodyYaw, hand: a.hand, mode: 'swing', stroke: sw.stroke, side: sw.side, height: sw.height, swing: s, aim: sw.aim, crouch: a.crouch, fp: a.fp }, a.racket);
    twist = B.twistFor('swing', sw.side, 0, s);
  } else if (a.prep > 0.01) {
    B.racketPose({ pos: a.pos, bodyYaw: a.look.bodyYaw, hand: a.hand, mode: 'prep', stroke: a.stroke, side: a.side, height: a.height, prep: a.prep, crouch: a.crouch }, a.racket);
    twist = B.twistFor('prep', a.side, a.prep);
  } else {
    B.racketPose({ pos: a.pos, bodyYaw: a.look.bodyYaw, hand: a.hand, mode: 'guard', crouch: a.crouch }, a.racket);
  }

  const k = a.skel;
  k.x = a.pos.x;
  k.y = a.pos.y;
  k.bodyYaw = a.look.bodyYaw;
  k.gazeYaw = a.look.gazeYaw;
  k.gazePitch = a.look.gazePitch;
  k.vx = a.vel.x;
  k.vy = a.vel.y;
  k.gait = a.gait;
  k.crouch = a.crouch;
  k.hop = a.hop;
  k.twist = twist;
  k.hand = a.hand;
  k.racket = a.racket;
  k.offHand = f.offHand || null; // main libre : tient la balle avant le service
  B.skeleton(k, a.skeleton);
  // Yeux finaux (caméra en 1re personne)
  B.eyePosition(a.pos, a.look, a.crouch * (f.crouchScale == null ? 1 : f.crouchScale), a.hop, a.eye);
  return a;
}

/*
 * Glass Lab — partie de padel en double à 4 joueurs : machine d'états pure et déterministe (sans DOM).
 *
 * Joueurs (repère monde de physics.js) :
 *   0 = toi, en bas à droite (x > 5) ;  1 = ton partenaire IA, en bas à gauche ;
 *   2 et 3 = adversaires IA, en haut (2 à leur droite, donc x < 5 ; 3 à leur gauche).
 *
 * Déroulement d'un point :
 *   - mise en place des 4 joueurs, puis service à la cuillère : la balle tombe, rebondit et part en
 *     diagonale ; elle doit rebondir dans le carré de service (sinon faute, deuxième service ; double faute
 *     = point perdu ; filet puis carré = let, on rejoue) et le retour se joue après le rebond ;
 *   - chaque frappe crée un vol (flight.js) ; l'équipe qui reçoit désigne qui prend la balle (tactics.js) ;
 *     si c'est toi, tu te places et tu appuies sur Frappe : même logique que l'échange historique
 *     (fenêtre de ±250 ms, type de coup, qualité, meilleur choix) ; si c'est une IA, elle planifie son
 *     interception, court, choisit son coup et peut faire une faute ;
 *   - le point se termine sur une faute, une balle gagnante ou une de tes erreurs ; le score suit les
 *     règles du padel (score.js) ; courte pause, nouveau point. Quand c'est ton tour, tu sers avec Frappe ;
 *   - le match se joue au format choisi (1 set, ou 2 sets gagnants avec super jeu décisif) ; une fois
 *     gagné, la partie s'arrête (phase 'over'). Sans format, les sets s'enchaînent sans fin.
 *
 * Partie orientée entraînement (option b) : les adversaires visent ton côté ≈ 65 % du temps, et leurs balles
 * vers toi suivent la répétition espacée par famille (vitres). Stats et feedback : seulement tes coups.
 *
 * step(state, dt, input) renvoie un NOUVEL état ; state.events liste ce qui s'est passé pendant ce pas.
 */
import P from './physics.js';
import Q from './quality.js';
import SG from './shotgen.js';
import PL from './players.js';
import F from './flight.js';
import T from './tactics.js';
import R from './rally.js';
import SC from './score.js';
import DEFAULT_CONFIG from './config.js';

/** Composition des équipes : équipe, côté (+1 droite, −1 gauche, dans le repère de l'équipe), IA ou non. */
const ROSTER = [
  { team: 0, side: 1, ai: false, name: 'Toi' },
  { team: 0, side: -1, ai: true, name: 'Partenaire' },
  { team: 1, side: 1, ai: true, name: 'Adversaire droite' },
  { team: 1, side: -1, ai: true, name: 'Adversaire gauche' },
];

const MISS_REASONS = Object.assign({}, R.MISS_REASONS, { serveVolley: 'Volée au retour de service' });
const POINT_PAUSE = 1.6; // s de jeu entre la fin d'un point et la mise en place du suivant
const SERVE_WAIT = 1.0; // un serveur IA attend ≈ 1 s après la mise en place (le temps de voir)
const FAULT_PAUSE = 0.9; // après une faute de service ou un let
const TOSS_Z = 1.05; // la balle est lâchée à cette hauteur, rebondit, puis est frappée au sommet du rebond
const TOSS_FALL = Math.sqrt((2 * (TOSS_Z - P.DEFAULT_PARAMS.radius)) / P.DEFAULT_PARAMS.g);
const SERVE_DROP = TOSS_FALL * (1 + P.DEFAULT_PARAMS.eFloor); // du lâcher à la frappe (≈ 0,8 s)
const SERVE_Z = P.DEFAULT_PARAMS.radius + P.DEFAULT_PARAMS.eFloor * P.DEFAULT_PARAMS.eFloor * (TOSS_Z - P.DEFAULT_PARAMS.radius);

/* ---------- Repères ---------- */

const toTeam = (team, p) => (team === 0 ? { x: p.x, y: p.y } : { x: 10 - p.x, y: 20 - p.y });
const fromTeam = toTeam; // la symétrie est sa propre inverse

function boundsOf(team, cfg) {
  const b = cfg.player.bounds;
  return team === 0 ? b : { xMin: 10 - b.xMax, xMax: 10 - b.xMin, yMin: 20 - b.yMax, yMax: 20 - b.yMin };
}

/** Côté du court couvert par un joueur, en x du repère de son équipe (pour viser ou générer une balle). */
function sideRange(side, cfg) {
  const band = cfg.tactics.centerBand;
  return side > 0 ? { xMin: 5 + band + 0.15, xMax: 9.6 } : { xMin: 0.4, xMax: 5 - band - 0.15 };
}

/* ---------- Création ---------- */

/**
 * Nouvelle partie. o = { seed, config?, level?, weights?, hand? (1 droitier, −1 gaucher), player? (ta position),
 *   format? ('1set' | '3sets', score.js ; absent : sets sans fin), score? et pointsWon? (match sauvegardé : reprise) }
 */
function createMatch(o) {
  const cfg = o.config || DEFAULT_CONFIG;
  const start = o.player || cfg.player.start;
  const fmt = SC.FORMATS[o.format] || { bestOf: 0, superTiebreak: false };
  const golden = cfg.score ? cfg.score.golden : true;
  const score = (o.score && SC.restore(o.score)) || SC.createScore({ golden, bestOf: fmt.bestOf, superTiebreak: fmt.superTiebreak });
  const s = {
    seed: o.seed >>> 0,
    cfg,
    level: o.level || 1,
    weights: o.weights || null,
    hand: o.hand || 1,
    hands: [o.hand || 1, 1, 1, 1],
    clock: 0,
    phase: 'serve',
    pauseLeft: 0,
    index: 0,
    score,
    format: SC.FORMATS[o.format] ? o.format : score.bestOf === 3 ? '3sets' : score.bestOf === 1 ? '1set' : null,
    winner: score.winner,
    serve: null, // service en cours : { by, receiver, side, second, contact, hitAt }
    serveFaults: 0,
    players: [],
    modes: ['defense', 'defense'],
    flight: null,
    recv: null,
    pointsWon: o.pointsWon ? o.pointsWon.slice() : [0, 0],
    rallyHits: 0,
    streak: 0,
    bestStreak: 0,
    balls: 0,
    hits: 0,
    last: null,
    lastPoint: null,
    events: [],
  };
  for (let i = 0; i < 4; i++) {
    const r = ROSTER[i];
    const spot = i === 0 ? start : fromTeam(r.team, T.formation(r.side, 'defense', 5, cfg));
    s.players.push(PL.createAgent({ x: spot.x, y: spot.y }));
  }
  if (s.winner != null) s.phase = 'over';
  else setupServe(s, false);
  return s;
}

/* ---------- Déplacements ---------- */

function moveUser(s, move, dt) {
  const pc = s.cfg.player;
  const u = s.players[0];
  const planted = (s.recv && s.recv.player === 0 && s.recv.user.pending) || (s.phase === 'serve' && s.serve && s.serve.by === 0);
  const m = planted ? { x: u.x, y: u.y, vx: 0, vy: 0 } : PL.stepVelocity(u, PL.inputVelocity(move, pc), dt, pc, pc.bounds);
  s.players[0] = Object.assign({}, u, m, { dist: u.dist + Math.hypot(m.x - u.x, m.y - u.y) });
}

/** Où la balle sera jouée par l'autre équipe (repère monde), pour que la paire glisse vers ce côté. */
function threatX(s, team) {
  const f = s.flight;
  if (!f) return 5;
  if (s.recv && s.recv.plan) return s.recv.plan.ballWorld.x;
  if (s.recv && s.recv.user && s.recv.user.shot.best.best) return s.recv.user.shot.best.best.ball.x;
  const tau = s.clock - f.t0;
  return F.ballAt(f, Math.min(tau, f.sim.endT)).x;
}

function aiTarget(s, i) {
  const r = ROSTER[i];
  const cfg = s.cfg;
  if (s.phase === 'serve') return { target: s.players[i].target, pace: 1 }; // chacun à sa place pour le service
  if (s.phase === 'over') return { target: s.players[i], pace: 0.55 }; // match terminé : on s'arrête
  if (s.recv && s.recv.player === i && s.recv.plan) return { target: s.recv.plan.pos, pace: 1 };
  const bx = toTeam(r.team, { x: threatX(s, r.team), y: 10 }).x;
  const mode = s.modes[r.team];
  const spot = i === 1 ? T.partnerSpot(r.side, mode, bx, toTeam(0, s.players[0]), cfg) : T.formation(r.side, mode, bx, cfg);
  // Partenaires alignés : si mon partenaire IA va chercher une balle loin de notre ligne, je le suis en profondeur
  const mate = i === 1 ? 0 : i === 2 ? 3 : 2;
  if (s.recv && s.recv.player === mate && s.recv.plan && ROSTER[mate].ai) {
    const my = toTeam(r.team, s.recv.plan.pos).y;
    if (Math.abs(my - spot.y) > 1.2) spot.y = Math.max(cfg.tactics.defenseY - 1.2, Math.min(cfg.tactics.attackY, my));
  }
  return { target: fromTeam(r.team, spot), pace: s.phase === 'live' ? 1 : 0.55 };
}

function moveAIs(s, dt) {
  for (let i = 1; i < 4; i++) {
    const { target, pace } = aiTarget(s, i);
    const a = s.players[i];
    const moved = a.target.x !== target.x || a.target.y !== target.y || a.pace !== pace ? PL.setTarget(a, target, pace) : a;
    s.players[i] = PL.stepAgent(moved, s.clock, dt, s.cfg.ai, boundsOf(ROSTER[i].team, s.cfg));
  }
}

/* ---------- Vols, réception, frappes ---------- */

function rngFor(s, salt) {
  return P.mulberry32(SG.mixSeed(s.seed, s.index * 7 + salt) ^ 0x3c6ef372);
}

/** Nouveau vol : il part de la frappe à l'instant `t0` (horloge de la partie). */
function launch(s, flight, hitter, t0) {
  const team = ROSTER[hitter].team;
  const recv = 1 - team;
  s.index++;
  s.rallyHits++;
  flight.t0 = t0;
  flight.hitter = hitter;
  s.flight = flight;
  // Transitions attaque / défense
  const first = flight.sim.contacts.find((c) => c.type === 'floor' && c.side === recv);
  const bounceY = first ? toTeam(recv, first.pos).y : null;
  const hitterY = toTeam(team, flight.init).y;
  const short = s.lastReceivedShort && s.lastReceivedShort[team];
  if (flight.serve) s.modes = team === 0 ? ['attack', 'defense'] : ['defense', 'attack']; // le serveur monte au filet
  else s.modes = T.modesAfterHit(s.modes, team, { style: flight.style, hitterY, bounceY, shortBall: short });
  // L'équipe qui reçoit fait son split-step
  for (let i = 0; i < 4; i++) if (ROSTER[i].team === recv && ROSTER[i].ai) s.players[i] = PL.splitStep(s.players[i], s.clock, s.cfg.ai);
  s.events.push({ type: 'hit', by: hitter, team, style: flight.style, index: s.index });
  assignReceiver(s);
}

/** Qui prend la balle, et plan de l'IA si c'est elle. */
function assignReceiver(s) {
  const f = s.flight;
  s.recv = null;
  if (f.verdict.fault || !f.shot) return; // faute du frappeur : personne ne joue la balle
  if (f.serve && f.serve.judge.type !== 'ok') return; // service fautif ou let : on ne joue pas
  const team = f.recv;
  const ids = team === 0 ? [0, 1] : [2, 3];
  const players = ids.map((i) => ({ side: ROSTER[i].side, hand: s.hands[i], pos: toTeam(team, s.players[i]) }));
  const params = ids.map((i) => (ROSTER[i].ai ? s.cfg.ai : Object.assign({ reaction: s.cfg.player.reactionTime }, s.cfg.player)));
  // Au service, c'est le joueur en diagonale qui reçoit
  const who = f.serve ? { index: ids.indexOf(f.serve.receiver), central: false } : T.whoTakes(players, f.shot, s.modes[team], params, s.cfg);
  let id = ids[who.index];
  // Balle courte reçue (pour monter au filet après l'avoir jouée)
  const bounce = f.shot.sim.contacts[0];
  s.lastReceivedShort = Object.assign({}, s.lastReceivedShort, { [team]: !!bounce && bounce.pos.y > 6.5 });
  if (id === 0) {
    const shot = f.shot;
    if (!shot.best) shot.best = Q.bestChoice(shot, s.players[0], s.cfg, { noVolley: !!f.serve });
    if (!shot.best.best) {
      // Injouable pour toi : au service, c'est un ace (seul le receveur peut renvoyer le service) ;
      // en jeu (balle au centre partie de l'autre côté), ton partenaire la prend
      if (f.serve) return;
      id = 1;
    } else {
      s.recv = { player: 0, user: { shot, pending: null, spawnPos: { x: s.players[0].x, y: s.players[0].y }, serve: !!f.serve } };
      s.balls++;
      s.events.push({ type: 'userBall', index: s.index, family: shot.family, central: who.central, serve: !!f.serve, spin: Q.spinOf(shot.init).label });
      if (who.central) s.events.push({ type: 'call', by: 1, mine: false });
      return;
    }
  }
  planAI(s, id, who.central);
}

/** Plan d'une IA : où, quand, quel coup, faute ou non. Sans interception possible, elle court quand même. */
function planAI(s, id, central) {
  const f = s.flight;
  const r = ROSTER[id];
  const from = toTeam(r.team, s.players[id]);
  const shot = f.shot; // déjà dans le repère de l'équipe qui reçoit
  const it = T.aiIntercept(shot, from, s.modes[r.team], s.cfg, { noVolley: !!f.serve });
  if (central && r.team === 0) s.events.push({ type: 'call', by: 1, mine: true });
  if (!it) {
    s.recv = { player: id, plan: { chase: true, pos: fromTeam(r.team, T.chaseSpot(shot)), tau: Infinity, ballWorld: fromTeam(r.team, T.chaseSpot(shot)) } };
    return;
  }
  const rng = rngFor(s, 1);
  const oppMode = s.modes[1 - r.team];
  const style = T.chooseStyle({ type: it.type, z: it.ball.z, y: it.ball.y, oppMode, level: s.level }, rng, s.cfg);
  const role = r.team === 0 ? 'partner' : 'opponent';
  const error = rng() < T.errorChance({ role, quality: it.quality, style, level: s.level }, s.cfg);
  const tau = it.t + f.cross;
  const ballWorld = F.ballAt(f, tau);
  s.recv = {
    player: id,
    plan: { tau, pos: fromTeam(r.team, it.pos), type: it.type, quality: it.quality, style, error, ballWorld, contact: { x: ballWorld.x, y: ballWorld.y, z: ballWorld.z } },
  };
}

/** Frappe d'une IA à l'instant prévu : coup choisi, ou faute (filet, dehors). */
function aiHit(s, overshoot) {
  const plan = s.recv.plan;
  const id = s.recv.player;
  const team = ROSTER[id].team;
  const c = plan.contact;
  const origin = { x: c.x, y: c.y, z: Math.max(0.15, c.z) };
  const rng = rngFor(s, 2);
  let flight = plan.error ? errorFlight(s, origin, team, plan.style, rng) : null;
  if (!flight) flight = team === 1 ? opponentShot(s, origin, plan.style, rng) : partnerShot(s, origin, plan.style, rng);
  launch(s, flight, id, s.clock - overshoot);
}

/** Faute volontairement générée : balle dans le filet ou trop longue (vitre adverse avant le rebond). */
function errorFlight(s, origin, team, style, rng) {
  const recv = 1 - team;
  const o = F.toTeamFrame(recv, origin);
  const net = rng() < 0.55;
  const target = net ? { x: 1.5 + rng() * 7, y: 10, z: 0.25 + rng() * 0.5 } : { x: 1 + rng() * 8, y: -0.8 - rng() * 1.6, z: 0.033 };
  const T0 = net ? 0.45 + rng() * 0.25 : 0.7 + rng() * 0.3;
  let init;
  if (net) {
    // Passe au plan du filet à la hauteur `z` après T0 secondes
    const g = P.DEFAULT_PARAMS.g;
    init = { x: o.x, y: o.y, z: o.z, vx: (target.x - o.x) / T0, vy: (target.y - o.y) / T0, vz: (target.z - o.z + 0.5 * g * T0 * T0) / T0 };
  } else init = P.launchToBounce(o, target, T0);
  const f = F.makeFlight(F.fromTeamFrame(recv, init), team, { style, error: true });
  return f.verdict.fault ? f : null;
}

/** Styles de repli jouables à cette hauteur de contact (d'abord le style choisi). */
function alternates(style, z, cfg) {
  const over = ['bandeja', 'vibora'];
  const ground = ['drive', 'defense', 'lob', 'chiquita'];
  const pool = over.includes(style) || style === 'smash' ? over : ground;
  return [style].concat(pool.filter((x) => x !== style && z >= cfg.styles[x].contact[0] - 0.15 && z <= cfg.styles[x].contact[1] + 0.15));
}

/**
 * Coup d'un adversaire vers ton équipe. Partie orientée entraînement : vers toi ≈ 65 % du temps, avec une
 * balle de la famille demandée par la répétition espacée (vitres), jouable depuis ta position ; sinon vers
 * ton partenaire (jouable pour lui, sauf ≈ 10 % de coups gagnants). Le smash, lui, peut être gagnant.
 */
function opponentShot(s, origin, style, rng) {
  const cfg = s.cfg;
  const base = { origin, team: 1, level: s.level, config: cfg };
  const toUser = rng() < cfg.training.userShare;
  const seed = SG.mixSeed(s.seed, 5000 + s.index);
  const styles = alternates(style, origin.z, cfg);
  const userSide = sideRange(1, cfg);
  const partnerSide = sideRange(-1, cfg);
  const zoneOf = (side, st) => ({ x: [side.xMin, side.xMax], y: cfg.styles[st].depth });
  if (style === 'smash') {
    const f = SG.generateTo(Object.assign({}, base, { style, zone: zoneOf(toUser ? userSide : partnerSide, style), seed, attempts: 80, extra: { target: toUser ? 0 : 1 } }));
    if (f) return f;
  }
  if (toUser) {
    const receiver = { pos: s.players[0], config: cfg };
    const first = SG.pickFamily(s.weights, rng);
    const order = [first].concat(SG.FAMILY_IDS.filter((f) => f !== first).sort((a, b) => SG.mixSeed(seed, SG.FAMILY_IDS.indexOf(a)) - SG.mixSeed(seed, SG.FAMILY_IDS.indexOf(b))));
    for (const st of styles) {
      for (const family of order) {
        const f = SG.generateTo(Object.assign({}, base, { style: st, family, side: userSide, receiver, seed: SG.mixSeed(seed, st.length * 31 + family.charCodeAt(0)), attempts: 40, extra: { target: 0 } }));
        if (f) return f;
      }
    }
    // Aucune famille possible depuis ce point de frappe : une balle jouable de ton côté
    for (const st of styles) {
      const f = SG.generateTo(Object.assign({}, base, { style: st, zone: zoneOf(userSide, st), receiver, seed: SG.mixSeed(seed, 911 + st.length), attempts: 80, extra: { target: 0 } }));
      if (f) return f;
    }
  }
  const winner = rng() < cfg.training.partnerWinner;
  const partner = winner ? null : { pos: s.players[1], config: T.aiConfig(cfg), playable: cfg.training.partnerPlayable };
  for (const st of styles) {
    const f = SG.generateTo(Object.assign({}, base, { style: st, zone: zoneOf(partnerSide, st), receiver: partner, seed: SG.mixSeed(seed, 77 + st.length), attempts: 80, extra: { target: 1, wanted: toUser ? 0 : 1 } }));
    if (f) return f;
  }
  return anyShot(s, origin, 1, rng);
}

/** Coup de ton partenaire vers les adversaires : vers le côté le moins couvert. */
function partnerShot(s, origin, style, rng) {
  const cfg = s.cfg;
  const opp = [2, 3].map((i) => toTeam(1, s.players[i]));
  const lane = (x) => opp.reduce((m, p) => Math.min(m, Math.abs(p.x - x)), 10);
  const aim = lane(2.4) >= lane(7.6) ? 2.4 : 7.6;
  const x = Math.max(0.8, Math.min(9.2, aim + (rng() - 0.5) * 2.4));
  for (const st of alternates(style, origin.z, cfg)) {
    const f = SG.generateTo({ origin, team: 0, style: st, zone: { x: [Math.max(0.6, x - 1), Math.min(9.4, x + 1)], y: cfg.styles[st].depth }, level: s.level, seed: SG.mixSeed(s.seed, 9000 + s.index * 3 + st.length), config: cfg, attempts: 80 });
    if (f) return f;
  }
  return anyShot(s, origin, 0, rng);
}

/** Dernier recours : une balle de fond quelconque, valide. */
function anyShot(s, origin, team, rng) {
  for (let k = 0; k < 6; k++) {
    const f = SG.generateTo({ origin, team, style: k % 2 ? 'lob' : 'drive', zone: { x: [1, 9], y: [1.5, 7.5] }, level: 1, seed: SG.mixSeed(s.seed, 777 + s.index * 13 + k), config: s.cfg, attempts: 200 });
    if (f) return f;
  }
  // Physiquement impossible (frappe sous le filet, collé à la vitre…) : la balle part dans le filet
  return errorFlight(s, origin, team, 'drive', () => 0.1) || F.makeFlight(Object.assign({}, origin, { vx: 0, vy: team === 0 ? 4 : -4, vz: 0 }), team, { style: 'drive', error: true });
}

/* ---------- Ta balle ---------- */

function userZoneTimes(s, from, to, pos) {
  const shot = s.recv.user.shot;
  const out = [];
  const dt = s.cfg.strike.sampleDt;
  for (let t = Math.max(from, shot.tStart); t < Math.min(to, shot.endT); t += dt) if (Q.inZone(Q.ballStateAt(shot, t), pos, s.cfg)) out.push(t);
  return out;
}

/** Contexte du double au moment de ta frappe (quality.js) : alignement avec ton partenaire, ton côté. */
function doublesContext(s, pos) {
  return Q.doublesContext(pos, s.players[1], s.modes[0], s.cfg);
}

function userMiss(s, reason, extra) {
  const shot = s.recv.user.shot;
  const best = shot.best;
  s.last = Object.assign(
    {
      outcome: 'miss',
      reason,
      reasonLabel: MISS_REASONS[reason],
      family: shot.family,
      index: s.index,
      player: { x: s.players[0].x, y: s.players[0].y },
      bestType: best.bestType,
      bestQuality: best.best.quality,
      level: s.level,
      doubles: doublesContext(s, s.players[0]),
    },
    extra || {}
  );
  s.streak = 0;
  s.events.push({ type: 'userMiss', result: s.last, shot });
  endPoint(s, 1, reason === 'weak' ? 'userNet' : 'userMiss');
}

function userHit(s, tc, pos, overshoot) {
  const cfg = s.cfg;
  const u = s.recv.user;
  const shot = u.shot;
  const b = Q.ballStateAt(shot, tc);
  const margin = Q.timeMargin(shot, tc, u.spawnPos, pos, cfg);
  const q = Q.shotQuality(b, pos, { timeMargin: Math.max(0, margin) }, cfg);
  const best = shot.best;
  const chosenBest = best.byType[q.type];
  const result = {
    outcome: 'hit',
    family: shot.family,
    index: s.index,
    type: q.type,
    quality: q.score,
    parts: q.parts,
    placementError: q.placementError,
    corner: q.corner,
    contactT: tc,
    ball: b,
    player: { x: pos.x, y: pos.y },
    bestType: best.bestType,
    bestQuality: best.best.quality,
    decisionOk: !!chosenBest && chosenBest.quality >= best.best.quality - cfg.quality.decisionTolerance,
    level: s.level,
    doubles: doublesContext(s, pos),
  };
  u.pending = null;
  const contact = F.ballAt(s.flight, tc + s.flight.cross);
  if (s.flight.serve && q.type === 'volley') {
    // Le retour de service doit rebondir : volée = faute
    userMiss(s, 'serveVolley', { type: result.type, quality: result.quality, contactT: tc, ball: b, placementError: result.placementError });
    return;
  }
  if (q.score < cfg.quality.minReturn) {
    // Frappe trop faible : la balle part dans le filet
    userMiss(s, 'weak', { type: result.type, quality: result.quality, contactT: tc, ball: b, placementError: result.placementError });
    const net = errorFlight(s, contact, 0, 'drive', () => 0.2);
    if (net) {
      net.t0 = s.clock - overshoot;
      net.hitter = 0;
      s.flight = net;
    }
    return;
  }
  s.hits++;
  s.streak = q.score >= cfg.quality.streak ? s.streak + 1 : 0;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  result.streak = s.streak;
  s.last = result;
  // Ton renvoi automatique : style et profondeur selon la qualité et la situation
  const rng = rngFor(s, 3);
  const opponents = [2, 3].map((i) => toTeam(1, s.players[i]));
  const ret = T.userReturn({ quality: q.score, type: q.type, z: contact.z, y: pos.y, oppMode: s.modes[1], opponents }, rng, cfg);
  let flight = SG.generateTo({ origin: contact, team: 0, style: ret.style, zone: ret.zone, level: ret.level, seed: SG.mixSeed(s.seed, 3000 + s.index), config: cfg, attempts: 120 });
  if (!flight) flight = SG.generateTo({ origin: contact, team: 0, style: 'drive', zone: { x: [1, 9], y: [1.5, 7.5] }, level: ret.level, seed: SG.mixSeed(s.seed, 3100 + s.index), config: cfg, attempts: 300 });
  if (!flight) flight = anyShot(s, contact, 0, rng);
  result.returnStyle = flight.style;
  s.events.push({ type: 'userHit', result, shot });
  launch(s, flight, 0, s.clock - overshoot);
}

/** Appui sur Frappe à l'instant tp (temps de la balle reçue, 0 au filet). */
function userPress(s, tp) {
  const u = s.recv.user;
  const tol = s.cfg.strike.timingTolerance;
  const pos = { x: s.players[0].x, y: s.players[0].y };
  const times = userZoneTimes(s, tp - tol, tp + tol, pos);
  if (times.length) {
    let tc = times[0];
    for (const t of times) if (Math.abs(t - tp) < Math.abs(tc - tp)) tc = t;
    if (tc <= tp) userHit(s, tc, pos, tp - tc);
    else u.pending = { t: tc, player: pos, pressT: tp };
    return;
  }
  const all = userZoneTimes(s, u.shot.tStart, u.shot.endT, pos);
  if (all.some((t) => t > tp + tol)) userMiss(s, 'early');
  else if (all.some((t) => t < tp - tol)) userMiss(s, 'late');
  else userMiss(s, 'far');
}

function userIncoming(s, input, tau) {
  const u = s.recv.user;
  const t = tau - s.flight.cross;
  if (u.pending) {
    if (t >= u.pending.t) userHit(s, u.pending.t, u.pending.player, t - u.pending.t);
    return;
  }
  if (input.strike) return userPress(s, t);
  if (t >= u.shot.endT) return userMiss(s, 'notReached');
  // Balle directe déjà passée derrière toi après son rebond : perdue
  const b = Q.ballStateAt(u.shot, t);
  const p = s.players[0];
  if (u.shot.family === 'direct' && b.floorBounces >= 1 && b.vy < 0 && b.y < p.y - s.cfg.zones.beforeGlass.reach - 0.3) userMiss(s, 'notReached');
}

/* ---------- Points ---------- */

const POINT_REASONS = {
  userMiss: 'ta balle',
  userNet: 'ta frappe dans le filet',
  net: 'faute au filet',
  out: 'balle dehors',
  double: 'balle gagnante',
  back: 'balle gagnante',
  dead: 'balle gagnante',
  doubleFault: 'double faute',
};

function endPoint(s, winner, reason) {
  if (s.phase !== 'live') return;
  s.phase = 'dead';
  s.pauseLeft = POINT_PAUSE;
  s.pointsWon = s.pointsWon.slice();
  s.pointsWon[winner]++;
  const f = s.flight;
  const r = SC.pointWon(s.score, winner);
  s.score = r.score;
  s.lastPoint = { winner, reason, label: POINT_REASONS[reason] || reason, by: f ? f.hitter : null, rallyHits: s.rallyHits };
  const d = SC.display(s.score);
  s.events.push({ type: 'point', winner, reason, by: f ? f.hitter : null, rallyHits: s.rallyHits, score: d, call: r.game == null ? SC.call(s.score) : null });
  if (r.game != null) {
    // Jeux du set qui vient de se jouer (avant la remise à zéro d'un set gagné)
    const games = r.set != null ? d.history[d.history.length - 1].games : s.score.games.slice();
    s.events.push({ type: 'game', winner: r.game, games, sets: s.score.sets.slice() });
  }
  if (r.set != null) s.events.push({ type: 'set', winner: r.set, sets: s.score.sets.slice(), label: SC.setLabel(d.history[d.history.length - 1]) });
  if (r.tiebreak) s.events.push({ type: 'tiebreak', super: r.superTiebreak });
  if (r.match != null) {
    s.phase = 'over';
    s.winner = r.match;
    s.events.push({ type: 'match', winner: r.match, score: d, pointsWon: s.pointsWon.slice() });
  }
  s.recv = null;
}

/* ---------- Service ---------- */

/** Carré de service du receveur (repère de son équipe) : diagonale, entre la ligne de service et le filet. */
function serviceBox(side) {
  return { x: side > 0 ? [5.25, 9.55] : [0.45, 4.75], y: [3.35, 9.4] };
}

/**
 * Mise en place d'un service (score.js : serveur, receveur, côté). Les 4 joueurs sont replacés :
 * serveur derrière la ligne de service, son partenaire au filet, receveur au fond en diagonale, son
 * partenaire en défense. second : deuxième service (après une faute).
 */
function setupServe(s, second) {
  const d = SC.display(s.score);
  const side = d.side === 'right' ? 1 : -1;
  const by = d.server;
  const recv = d.receiver;
  const sTeam = ROSTER[by].team;
  const rTeam = 1 - sTeam;
  const spots = {};
  spots[by] = { x: 5 + side * 2.3, y: 1.9 };
  spots[sTeam === 0 ? (by === 0 ? 1 : 0) : by === 2 ? 3 : 2] = { x: 5 - side * 2.05, y: s.cfg.tactics.attackY };
  spots[recv] = { x: 5 + side * 2.45, y: 1.5 };
  spots[rTeam === 0 ? (recv === 0 ? 1 : 0) : recv === 2 ? 3 : 2] = { x: 5 - side * 2.4, y: s.cfg.tactics.defenseY };
  for (let i = 0; i < 4; i++) {
    const w = fromTeam(ROSTER[i].team, spots[i]);
    s.players[i] = Object.assign({}, s.players[i], { x: w.x, y: w.y, vx: 0, vy: 0, target: { x: w.x, y: w.y }, reactAt: -Infinity });
  }
  // Contact du service : devant le serveur, du côté de son coup droit, au sommet du rebond de la balle lâchée
  const c = fromTeam(sTeam, { x: spots[by].x + 0.35 * s.hands[by], y: spots[by].y + 0.3 });
  s.serve = { by, receiver: recv, side, second: !!second, contact: { x: c.x, y: c.y, z: SERVE_Z }, hitAt: by === 0 ? null : s.clock + SERVE_WAIT + SERVE_DROP };
  s.modes = sTeam === 0 ? ['attack', 'defense'] : ['defense', 'attack'];
  s.phase = 'serve';
  s.recv = null;
  s.rallyHits = 0;
  s.lastReceivedShort = null;
  s.events.push({ type: 'serveSetup', by, receiver: recv, side: d.side, second: !!second, score: d });
}

/** Prochaine frappe de service (pour animer le geste avant) : { by, contact, hitAt, style } ou null. */
function servePreview(s) {
  if (s.phase !== 'serve' || !s.serve) return null;
  return { by: s.serve.by, contact: s.serve.contact, hitAt: s.serve.hitAt, style: 'serve' };
}

/**
 * Issue d'un service : 'fault' (filet, hors du carré, grillage après le rebond), 'let' (touche le filet
 * puis tombe dans le carré : on rejoue) ou 'ok'. t = instant de la décision (τ du vol).
 */
function judgeServe(flight, box) {
  const v = flight.verdict;
  if (v.fault) return { type: 'fault', t: v.t, reason: v.reason };
  const recv = flight.recv;
  const contacts = flight.sim.contacts;
  const bi = contacts.findIndex((c) => c.type === 'floor' && c.side === recv);
  const bounce = contacts[bi];
  const p = toTeam(recv, bounce.pos);
  if (p.x < box.x[0] - 0.25 || p.x > box.x[1] + 0.25 || p.y < 3.05 || p.y > 10) return { type: 'fault', t: bounce.t, reason: 'box' };
  if (contacts.some((c) => c.type === 'cord' && c.t < bounce.t)) return { type: 'let', t: bounce.t + 0.3 };
  const wall = contacts.slice(bi + 1).find((c) => c.type !== 'floor');
  if (wall && wall.t < v.t && !P.onGlass(wall)) return { type: 'fault', t: wall.t, reason: 'mesh' };
  return { type: 'ok', t: Infinity };
}

/** Frappe de service : balle valide vers le carré (balle d'entraînement si c'est toi qui reçois), ou faute. */
function doServe(s) {
  const sv = s.serve;
  const cfg = s.cfg;
  const team = ROSTER[sv.by].team;
  const box = serviceBox(sv.side);
  const rng = rngFor(s, 6 + (sv.second ? 1 : 0));
  const seed = SG.mixSeed(s.seed, 7000 + s.index * 5 + (sv.second ? 1 : 0));
  let flight = null;
  const base = { origin: sv.contact, team, style: 'serve', level: s.level, config: cfg };
  if (sv.by !== 0 && rng() < cfg.serveFaults[sv.second ? 1 : 0]) {
    // Faute de service : dans le filet ou trop long (au-delà de la ligne de service)
    if (rng() < 0.5) flight = errorFlight(s, sv.contact, team, 'serve', rng);
    else flight = SG.generateTo(Object.assign({}, base, { zone: { x: box.x, y: [1.2, 2.8] }, seed: seed ^ 0x51, attempts: 80 }));
  }
  if (!flight) {
    const receiver = sv.receiver === 0 ? { pos: s.players[0], config: cfg, noVolley: true } : { pos: s.players[sv.receiver], config: T.aiConfig(cfg), noVolley: true, playable: 0.4 };
    if (sv.receiver === 0) {
      // Retour de service pour toi : famille de vitres selon la répétition espacée, si le carré le permet
      const first = SG.pickFamily(s.weights, rng);
      const order = [first].concat(SG.FAMILY_IDS.filter((f) => f !== first));
      for (const family of order) {
        flight = SG.generateTo(Object.assign({}, base, { zone: box, family, receiver, seed: SG.mixSeed(seed, family.charCodeAt(0)), attempts: 40 }));
        if (flight) break;
      }
    }
    if (!flight) flight = SG.generateTo(Object.assign({}, base, { zone: box, receiver, seed: seed ^ 0x77, attempts: 200 }));
    if (!flight) flight = SG.generateTo(Object.assign({}, base, { zone: box, seed: seed ^ 0x99, attempts: 300 }));
    if (flight) flight.target = sv.receiver === 0 ? 0 : sv.receiver === 1 ? 1 : 2;
  }
  if (!flight) flight = anyShot(s, sv.contact, team, rng);
  flight.style = 'serve';
  flight.serve = { side: sv.side, receiver: sv.receiver, second: sv.second, box };
  flight.serve.judge = judgeServe(flight, box);
  s.phase = 'live';
  s.serve = null;
  launch(s, flight, sv.by, sv.hitAt);
}

/** Faute de service ou let : deuxième service, double faute (point au receveur) ou service rejoué. */
function serveFault(s, judge) {
  const f = s.flight;
  if (judge.type === 'let') {
    s.events.push({ type: 'let' });
    s.phase = 'pause';
    s.pauseLeft = FAULT_PAUSE;
    s.nextServe = { second: f.serve.second };
    return;
  }
  if (f.serve.second) {
    endPoint(s, f.recv, 'doubleFault');
    return;
  }
  s.events.push({ type: 'fault', reason: judge.reason, by: f.hitter });
  s.phase = 'pause';
  s.pauseLeft = FAULT_PAUSE;
  s.nextServe = { second: true };
}

/* ---------- Pas de jeu ---------- */

/**
 * Avance la partie de dt secondes de jeu.
 * input = { move: { x, y } (repère du court, norme ≤ 1), strike: booléen (appui sur Frappe) }
 */
function step(state, dt, input) {
  const s = Object.assign({}, state, { events: [], players: state.players.slice() });
  input = input || {};
  s.clock = state.clock + dt;
  if (s.recv && s.recv.user) s.recv = Object.assign({}, s.recv, { user: Object.assign({}, s.recv.user) });
  if (s.serve) s.serve = Object.assign({}, s.serve);
  moveUser(s, input.move, dt);
  moveAIs(s, dt);
  if (s.phase === 'over') return s; // match terminé
  if (s.phase === 'dead' || s.phase === 'pause') {
    // Fin du point (puis mise en place du suivant) ou courte pause après une faute de service / un let
    s.pauseLeft -= dt;
    if (s.pauseLeft <= 0) {
      const second = s.phase === 'pause' && s.nextServe ? s.nextServe.second : false;
      s.nextServe = null;
      setupServe(s, second);
    }
    return s;
  }
  if (s.phase === 'serve') {
    // Ton service : Frappe lâche la balle, la frappe part au sommet du rebond
    if (s.serve.by === 0 && s.serve.hitAt == null && input.strike) {
      s.serve.hitAt = s.clock + SERVE_DROP;
      s.events.push({ type: 'userServe' });
    }
    if (s.serve.hitAt != null && s.clock >= s.serve.hitAt) doServe(s);
    return s;
  }
  const f = s.flight;
  const tau = s.clock - f.t0;
  const r = s.recv;
  if (f.serve && f.serve.judge.type !== 'ok' && tau >= f.serve.judge.t) {
    serveFault(s, f.serve.judge);
    return s;
  }
  if (r && r.player === 0) userIncoming(s, input, tau);
  else if (r && r.plan && tau >= r.plan.tau) aiHit(s, tau - r.plan.tau);
  // Balle morte sans être jouée : faute du frappeur ou point gagnant
  if (s.phase === 'live' && s.flight === f && tau >= f.verdict.t) endPoint(s, f.verdict.winner, f.verdict.reason);
  return s;
}

/** Balle du service : tenue par le serveur, puis lâchée, rebond, et frappée au sommet du rebond. */
function tossBall(s) {
  const sv = s.serve;
  const c = sv.contact;
  const held = { x: c.x, y: c.y, z: TOSS_Z };
  if (sv.hitAt == null) return held;
  const t = s.clock - (sv.hitAt - SERVE_DROP);
  if (t <= 0) return held;
  const g = P.DEFAULT_PARAMS.g;
  if (t < TOSS_FALL) return { x: c.x, y: c.y, z: TOSS_Z - 0.5 * g * t * t };
  const tb = t - TOSS_FALL;
  const v = P.DEFAULT_PARAMS.eFloor * g * TOSS_FALL;
  return { x: c.x, y: c.y, z: Math.max(P.DEFAULT_PARAMS.radius, P.DEFAULT_PARAMS.radius + v * tb - 0.5 * g * tb * tb) };
}

/** Score lisible (score.js) : points, jeux, sets, serveur, mention spéciale. */
function scoreDisplay(s) {
  return SC.display(s.score);
}

/** Point attribué directement à une équipe (tests, réglages) : mêmes règles de score que endPoint. */
function awardPoint(state, team) {
  if (state.phase === 'over') return state;
  const s = Object.assign({}, state, { events: [], players: state.players.slice(), phase: 'live' });
  endPoint(s, team, team === 0 ? 'out' : 'userMiss');
  return s;
}

/** Position de la balle (repère monde), ou null avant la première mise en jeu. */
function ballPosition(s) {
  if (s.phase === 'serve' && s.serve) return tossBall(s);
  const f = s.flight;
  if (!f) return null;
  return F.ballAt(f, Math.max(0, Math.min(s.clock - f.t0, f.sim.endT)));
}

/** Ta balle en cours (format de quality.js) et son temps courant, ou null. */
function userShot(s) {
  if (!s.recv || s.recv.player !== 0) return null;
  return { shot: s.recv.user.shot, t: s.clock - s.flight.t0 - s.flight.cross, pending: s.recv.user.pending };
}

/** Mise à jour du niveau et des poids de familles (répétition espacée), sans muter l'état. */
function withSettings(state, patch) {
  return Object.assign({}, state, patch);
}

const Match = {
  ROSTER,
  SERVE_DROP,
  MISS_REASONS,
  POINT_REASONS,
  toTeam,
  fromTeam,
  sideRange,
  createMatch,
  step,
  awardPoint,
  scoreDisplay,
  servePreview,
  judgeServe,
  serviceBox,
  ballPosition,
  userShot,
  withSettings,
};

export default Match;

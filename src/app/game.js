/*
 * Glass Lab — session de jeu : match en double à 4 joueurs (core/match.js), boucle à pas fixe
 * (120 Hz de temps de jeu) avec interpolation, animation des 4 joueurs, caméra 1re personne, sons,
 * annonces de l'arbitre, feedback, statistiques (tes coups seulement) et Détail.
 *
 * Le match en cours est sauvegardé à chaque point (reprise depuis l'accueil) ; à sa fin, écran de fin
 * de match. Vitesse du jeu fixée par la difficulté adaptative (config.game.levelSpeed) : aucun réglage.
 */
import CFG from '../core/config.js';
import G from '../core/geometry.js';
import P from '../core/physics.js';
import F from '../core/flight.js';
import Q from '../core/quality.js';
import M from '../core/match.js';
import PL from '../core/players.js';
import B from '../core/body.js';
import Stats from '../core/stats.js';
import { createActor, updateActor, startSwing, placeActor, setReducedMotion } from './actors.js';
import { createReplay } from './replay.js';

const STEP = 1 / 120; // pas de physique (s de jeu)
const MAX_STEPS = 12; // au plus 0,1 s de rattrapage par image
const TOAST_OK_MS = 1400;
const TOAST_ERROR_MS = 2400; // le temps de toucher « Détail »
const USER_HOP = { splitDuration: 0.16, hop: 0.022 }; // ton split-step : visuel seulement, discret
const SWING_LEAD = B.CONTACT_AT * 0.3; // le geste commence ≈ 0,17 s avant le contact
const MATCH_END_MS = 2200; // annonce « Jeu, set et match » avant l'écran de fin

/** Ton geste selon le type de frappe. */
function userStroke(type) {
  return type === 'overhead' ? 'overhead' : type === 'volley' ? 'volley' : 'ground';
}

/** Geste correspondant au coup joué. */
function strokeOf(style, type) {
  if (type === 'overhead' || style === 'bandeja' || style === 'vibora' || style === 'smash') return 'overhead';
  if (style === 'volley') return 'volley';
  if (style === 'lob' || style === 'lobShort') return 'lob';
  if (style === 'serve') return 'serve';
  return 'ground';
}

/**
 * ctx = { renderer, input, hud, audio, device, store: { save, persist() }, params, onScreen(name) }
 */
export function createGame(ctx) {
  const { renderer, input, hud, audio, device, store } = ctx;
  const figures = renderer.figures;

  const game = {
    screen: 'home', // home | playing | paused | detail | over (fin de match)
    endTimer: 0,
    lastReason: '',
    moveFrame: { ref: null }, // joystick par rapport au regard : direction figée pendant la course
    cur: null,
    prev: null,
    acc: 0,
    strike: false,
    move: { x: 0, y: 0 },
    session: 0,
    lastError: null,
    firstBallSeen: false,
    userSplitAt: -Infinity,
    animClock: 0,
    debugInput: null,
  };

  /** Place d'attente d'un joueur (accueil, nouvelle partie). */
  const homeSpot = (i) => {
    const r = M.ROSTER[i];
    return i === 0 ? { x: 5, y: 2.2 } : M.fromTeam(r.team, { x: 5 + r.side * CFG.tactics.halfWidth, y: CFG.tactics.defenseY });
  };

  // Les 4 joueurs : toi (1re personne), ton partenaire, les deux adversaires
  const actors = [0, 1, 2, 3].map((i) => {
    const spot = homeSpot(i);
    return createActor({ team: M.ROSTER[i].team, hand: 1, fp: i === 0, x: spot.x, y: spot.y });
  });
  const user = actors[0];
  actors.forEach((a, i) => figures.setPlayer(i, { team: a.team, fp: i === 0, skin: i }));
  const replay = createReplay({ renderer, user });

  const level = () => (game.cur ? game.cur.level : store.save.level);
  const speed = () => CFG.game.levelSpeed[Math.max(0, Math.min(4, level() - 1))];

  /* ---------- Partie ---------- */

  /**
   * Lance le match : reprend le match sauvegardé s'il y en a un (sauf o.fresh), sinon en commence un
   * nouveau au format choisi à l'accueil.
   */
  function start(o) {
    const seed = ctx.params.has('seed') ? Number(ctx.params.get('seed')) >>> 0 : (Math.random() * 4294967296) >>> 0;
    const saved = o && o.fresh ? null : store.save.current;
    clearTimeout(game.endTimer);
    game.session = Date.now();
    game.cur = game.prev = M.createMatch({
      seed,
      player: CFG.player.start,
      level: store.save.level,
      weights: Stats.familyWeights(store.save.balls),
      hand: store.save.settings.lefty ? -1 : 1,
      format: saved ? saved.format : store.save.format,
      score: saved ? saved.score : null,
      pointsWon: saved ? saved.pointsWon : null,
    });
    game.acc = 0;
    game.lastError = null;
    game.firstBallSeen = false;
    game.cur.players.forEach((p, i) => placeActor(actors[i], p.x, p.y));
    saveCurrent(); // un nouveau match remplace le match sauvegardé
    hud.hideToast();
    hud.setScore(M.scoreDisplay(game.cur));
    hud.servePrompt(false);
    setScreen('playing');
    if (saved) hud.banner('Reprise du match', null, scoreLineOf(M.scoreDisplay(game.cur)), 1800);
    if (!store.save.guideDone) hud.guideShow(0);
  }

  /** Score lisible pour l'annonce de reprise : « 6-4 · 2-3 · 30-15 ». */
  function scoreLineOf(d) {
    const parts = d.history.map((h) => (h.super && h.tb ? `[${h.tb[0]}-${h.tb[1]}]` : `${h.games[0]}-${h.games[1]}`));
    if (!d.superTb) parts.push(`${d.games[0]}-${d.games[1]}`);
    parts.push(`${d.points[0]}-${d.points[1]}`);
    return parts.join(' · ');
  }

  /** Sauvegarde du match en cours (score, points gagnés), ou effacement s'il est terminé. */
  function saveCurrent() {
    const s = game.cur;
    const current = s && s.format && s.phase !== 'over' ? { format: s.format, score: s.score, pointsWon: s.pointsWon, at: Date.now() } : null;
    store.save = Object.assign({}, store.save, { current });
    store.persist();
  }

  function setScreen(name) {
    game.screen = name;
    ctx.onScreen(name);
  }

  function pause() {
    if (game.screen === 'playing') setScreen('paused');
  }

  function resume() {
    if (game.screen === 'paused' || game.screen === 'detail') {
      replay.stop();
      setScreen('playing');
    }
  }

  function quit() {
    clearTimeout(game.endTimer);
    game.cur = game.prev = null;
    replay.stop();
    hud.hideToast();
    actors.forEach((a, i) => {
      const spot = homeSpot(i);
      placeActor(a, spot.x, spot.y);
    });
    setScreen('home');
  }

  /** Le niveau et les poids des familles (répétition espacée) suivent la sauvegarde. */
  function applyMatchSettings() {
    if (!game.cur) return;
    const hands = game.cur.hands.slice();
    hands[0] = store.save.settings.lefty ? -1 : 1;
    const patch = { weights: Stats.familyWeights(store.save.balls), level: store.save.level, hand: hands[0], hands };
    game.cur = M.withSettings(game.cur, patch);
    game.prev = M.withSettings(game.prev, patch);
  }

  /* ---------- Événements de la partie ---------- */

  function onBallResult(r, shot) {
    const ball = {
      ts: Date.now(),
      session: game.session,
      family: r.family,
      outcome: r.outcome,
      reason: r.reason,
      type: r.type,
      quality: typeof r.quality === 'number' ? Math.round(r.quality * 1000) / 1000 : undefined,
      bestType: r.bestType,
      bestQuality: Math.round(r.bestQuality * 1000) / 1000,
      decisionOk: r.outcome === 'hit' ? r.decisionOk : undefined,
      placementError: typeof r.placementError === 'number' ? Math.round(r.placementError * 100) / 100 : undefined,
      level: r.level,
      streak: game.cur.streak,
      aligned: r.doubles ? r.doubles.aligned : undefined,
      teamMode: r.doubles ? r.doubles.teamMode : undefined,
    };
    const res = Stats.recordBall(store.save, ball, CFG.difficulty);
    store.save = res.state;
    store.persist();
    applyMatchSettings();
    const error = r.outcome === 'miss' || r.quality < CFG.quality.ok;
    if (error) game.lastError = { shot, result: r };
    hud.showToast(r, CFG, error ? TOAST_ERROR_MS : TOAST_OK_MS, error);
    if (res.levelChange) hud.levelChange(store.save.level, res.levelChange);
    if (hud.guideStep === 0 || hud.guideStep === 1) hud.guideShow(2);
  }

  /** Bilan cumulé des parties (sauvegardé) : [gagnés, perdus] pour les points, jeux, sets et matchs. */
  function record(kind, winner) {
    const rec = Object.assign(Stats.emptyRecord(), store.save.record);
    rec[kind] = rec[kind].slice();
    rec[kind][winner === 0 ? 0 : 1]++;
    store.save = Object.assign({}, store.save, { record: rec });
    store.persist();
  }

  /** Volume d'un son selon sa distance à toi. */
  function near(p, base) {
    const u = game.cur.players[0];
    return base * Math.max(0.25, 1 - Math.hypot(p.x - u.x, p.y - u.y) / 16);
  }

  function onEvent(e) {
    const s = game.cur;
    if (e.type === 'hit') {
      if (e.by !== 0) audio.hit(near(s.players[e.by], e.style === 'smash' ? 0.8 : 0.45));
      if (e.team === 1) game.userSplitAt = game.animClock;
    } else if (e.type === 'userHit') {
      audio.hit(0.6 + 0.4 * e.result.quality);
      audio.buzz(18);
      setTimeout(() => audio.success(e.result.quality), 60);
      onBallResult(e.result, e.shot);
    } else if (e.type === 'userMiss') {
      if (e.result.reason === 'weak') audio.hit(0.4);
      audio.miss();
      audio.buzz([30, 40, 30]);
      onBallResult(e.result, e.shot);
    } else if (e.type === 'userBall') {
      if (e.spin) hud.spinTag(e.spin); // l'effet de la balle qui t'arrive
    } else if (e.type === 'call') {
      hud.call(e.mine ? 'À moi !' : 'À toi !');
    } else if (e.type === 'point') {
      // Annonce de l'arbitre : le score, serveur d'abord (le jeu, le set et le match ont leur annonce)
      const why = M.POINT_REASONS[e.reason] || '';
      game.lastReason = `Point pour ${e.winner === 0 ? 'vous' : 'eux'}${why ? ' · ' + why : ''}`;
      if (e.call) hud.banner(e.call, e.winner === 0, game.lastReason);
      hud.setScore(e.score);
      record('points', e.winner);
      saveCurrent();
      if (e.reason !== 'userMiss' && e.reason !== 'userNet') audio.point(e.winner === 0);
    } else if (e.type === 'game') {
      hud.banner(`Jeu · ${e.winner === 0 ? 'vous' : 'eux'}`, e.winner === 0, `${e.games[0]}-${e.games[1]} · ${game.lastReason}`);
      record('games', e.winner);
    } else if (e.type === 'set') {
      record('sets', e.winner);
      hud.banner(`Set · ${e.winner === 0 ? 'vous' : 'eux'}`, e.winner === 0, `${e.label} · sets ${e.sets[0]}-${e.sets[1]}`);
    } else if (e.type === 'tiebreak') {
      hud.banner(e.super ? 'Super jeu décisif' : 'Jeu décisif', null, e.super ? '1 set partout : 10 points, 2 d’écart' : '6-6 : 7 points, 2 d’écart');
    } else if (e.type === 'match') {
      record('matches', e.winner);
      saveCurrent(); // match terminé : plus rien à reprendre
      hud.banner('Jeu, set et match', e.winner === 0, `${e.score.history.map((h) => (h.super && h.tb ? `[${h.tb[0]}-${h.tb[1]}]` : `${h.games[0]}-${h.games[1]}`)).join(' · ')} · ${e.winner === 0 ? 'victoire' : 'défaite'}`, MATCH_END_MS);
      hud.servePrompt(false);
      clearTimeout(game.endTimer);
      game.endTimer = setTimeout(() => showMatchEnd(e), MATCH_END_MS);
    } else if (e.type === 'fault') {
      hud.banner('Faute de service', null, e.reason === 'net' ? 'dans le filet · deuxième service' : e.reason === 'mesh' ? 'grillage après le rebond · deuxième service' : 'hors du carré · deuxième service');
    } else if (e.type === 'let') {
      hud.banner('Let', null, 'la balle a touché le filet : on rejoue le service');
    } else if (e.type === 'serveSetup') {
      // Mise en place du point : court fondu (les joueurs sont replacés), score à jour
      hud.cut();
      hud.setScore(e.score);
      game.serveSwung = false;
      hud.servePrompt(e.by === 0);
    } else if (e.type === 'userServe') {
      hud.servePrompt(false);
      const sv = M.servePreview(s);
      if (sv) startSwing(user, game.animClock, { aim: sv.contact, contactAt: game.animClock + (sv.hitAt - s.clock), side: user.hand, stroke: 'serve' });
      game.serveSwung = true;
    }
  }

  /** Sons des contacts (sol, vitres, filet) franchis pendant le dernier pas. */
  function contactSounds(a, b) {
    const f = b.flight;
    if (!f) return;
    const t1 = b.clock - f.t0;
    const t0 = a.flight === f ? a.clock - f.t0 : -1e-9;
    for (const c of f.sim.contacts) {
      if (c.t <= t0 || c.t > t1) continue;
      const k = Math.min(1, P.speed(c.vIn) / 18);
      if (c.type === 'floor') audio.floor(near(c.pos, k));
      else if (c.type === 'net' || c.type === 'cord') audio.net(near(c.pos, 0.6));
      else audio.glass(near(c.pos, k));
    }
  }

  function stepGame(dtReal) {
    game.acc += dtReal * speed();
    let n = 0;
    const pressed = game.strike;
    const events = [];
    while (game.acc >= STEP && n < MAX_STEPS) {
      game.prev = game.cur;
      game.cur = M.step(game.cur, STEP, { move: game.move, strike: game.strike });
      game.strike = false;
      contactSounds(game.prev, game.cur);
      for (const e of game.cur.events) {
        events.push(e);
        onEvent(e);
      }
      game.acc -= STEP;
      n++;
    }
    if (n === MAX_STEPS) game.acc = 0; // trop de retard (onglet ralenti) : on ne rattrape pas
    if (pressed && !game.strike) userSwing(events);
    if (!game.firstBallSeen && events.some((e) => e.type === 'userBall')) {
      game.firstBallSeen = true;
      if (!store.save.guideDone) hud.guideShow(1);
    }
  }

  /** Ton geste après un appui sur Frappe : synchronisé avec le contact s'il a lieu. */
  function userSwing(events) {
    const clock = game.animClock;
    const hit = events.find((e) => e.type === 'userHit');
    if (hit) return startSwing(user, clock, { aim: hit.result.ball, contactAt: clock, side: user.side, stroke: userStroke(hit.result.type) });
    const u = M.userShot(game.cur);
    if (u && u.pending) {
      const b = Q.ballStateAt(u.shot, u.pending.t);
      return startSwing(user, clock, { aim: b, contactAt: clock + (u.pending.t - u.t), side: user.side, stroke: userStroke(Q.classifyShot(b, CFG)) });
    }
    // Frappe dans le vide : le geste part quand même vers la balle (ou devant soi)
    const ball = M.ballPosition(game.cur);
    const close = ball && Math.hypot(ball.x - user.pos.x, ball.y - user.pos.y) < 1.6;
    startSwing(user, clock, { aim: close ? ball : null, contactAt: clock + 0.1, side: user.side });
  }

  /* ---------- Vue de jeu ---------- */

  const ballPos = { x: 0, y: 0, z: 0 };
  const view = { ball: null, reach: null, pathT: null, best: null, mine: null, landing: null };
  const cam = { eye: user.eye, yaw: 0, pitch: 0, vFov: 70 };
  const frames = actors.map((a, i) => ({ x: 0, y: 0, vx: 0, vy: 0, ball: null, ahead: null, focus: null, incoming: null, hop: 0, crouchScale: i === 0 ? 0.4 : 1, lookAt: null, offHand: null }));
  const userFocus = { x: 0, y: 0, z: 0, w: 0 }; // point de frappe prévu, regardé juste avant de frapper
  const receiverHead = { x: 0, y: 0, z: 1.5 };
  const incomings = actors.map(() => ({ t: 0, z: 1, x: 0, y: 0 }));
  const callPos = { x: 0, y: 0, visible: false };
  const callHead = { x: 0, y: 0, z: 0 };
  const highCache = new WeakMap(); // vol → point de chute d'une balle haute vers ton camp (ou null)
  const map = { yaw: 0, range: CFG.view.mapRange, me: { x: 0, y: 0 }, partner: { x: 0, y: 0 }, ball: null, landing: null, smash: null };

  /** Balle haute (lob) vers ton camp : son point de chute, calculé une fois par vol ; sinon null. */
  function highLanding(f) {
    if (!highCache.has(f)) highCache.set(f, f.recv === 0 && !f.serve && F.apex(f) >= CFG.view.highBall ? F.landing(f) : null);
    return highCache.get(f);
  }

  /**
   * Aides aux balles hautes, jusqu'au rebond : point de chute au sol (dans le court) et mini-carte orientée
   * comme le joystick (toi au centre, ton partenaire, la balle, son point de chute, ta place pour un smash).
   */
  function highBallAids(s, ball, u) {
    const land = s.phase === 'live' && s.flight && ball ? highLanding(s.flight) : null;
    const high = land && game.animClock - s.flight.t0 < land.t ? land : null;
    view.landing = high && !high.out ? high : null;
    if (high) {
      map.yaw = G.moveReference(game.moveFrame, user.look.gazeYaw);
      map.me.x = frames[0].x;
      map.me.y = frames[0].y;
      map.partner.x = frames[1].x;
      map.partner.y = frames[1].y;
      map.ball = ball;
      map.landing = high;
      // Smash possible sur ta balle : la place idéale pour le frapper (comme le cercle vert du Détail)
      const oh = u && u.shot.best.byType.overhead;
      map.smash = oh && u.t < oh.t ? oh.pos : null;
    }
    hud.map(high ? map : null);
  }

  function interpolatedBall(alpha, out) {
    const a = M.ballPosition(game.cur);
    if (!a) return null;
    // Effet (rotation) de la balle : la vue la fait tourner
    out.wx = a.wx;
    out.wy = a.wy;
    out.wz = a.wz;
    const b = game.prev.flight === game.cur.flight ? M.ballPosition(game.prev) : null;
    if (!b) {
      out.x = a.x;
      out.y = a.y;
      out.z = a.z;
      return out;
    }
    out.x = b.x + (a.x - b.x) * alpha;
    out.y = b.y + (a.y - b.y) * alpha;
    out.z = b.z + (a.z - b.z) * alpha;
    return out;
  }

  /** Préparation et geste d'une IA, synchronisés avec son plan de frappe. */
  function aiAnimation(i, s) {
    const a = actors[i];
    const fr = frames[i];
    fr.incoming = null;
    const plan = s.recv && s.recv.player === i ? s.recv.plan : null;
    if (plan && !plan.chase && s.flight) {
      const left = plan.tau - (game.animClock - s.flight.t0);
      const inc = incomings[i];
      inc.t = left;
      inc.z = plan.contact.z;
      inc.x = plan.contact.x;
      inc.y = plan.contact.y;
      fr.incoming = inc;
      if (left <= SWING_LEAD && left > -0.05 && !a.swing) startSwing(a, game.animClock, { aim: plan.contact, contactAt: game.animClock + Math.max(0, left), side: a.side, stroke: strokeOf(plan.style, plan.type) });
    } else if (s.phase === 'serve') {
      // Service d'une IA : le geste à la cuillère arrive au sommet du rebond de la balle lâchée
      const sv = M.servePreview(s);
      if (sv && sv.by === i && sv.hitAt != null) {
        const left = sv.hitAt - game.animClock;
        if (left <= SWING_LEAD && left > -0.05 && !a.swing) startSwing(a, game.animClock, { aim: sv.contact, contactAt: game.animClock + Math.max(0, left), side: a.hand, stroke: 'serve' });
      }
    }
    fr.hop = PL.splitHop(s.players[i], game.animClock, CFG.ai);
  }

  /** Image de jeu (ou de l'accueil) : positions interpolées, animation, caméra aux yeux. */
  function gameView(dt, aspect) {
    const dtg = dt * speed();
    const s = game.cur;
    setReducedMotion(user, device.reducedMotion);
    if (!s) {
      game.animClock += dtg;
      // Accueil : les joueurs attendent, regard vers le filet
      actors.forEach((a, i) => {
        Object.assign(frames[i], { x: a.pos.x, y: a.pos.y, vx: 0, vy: 0, ball: null, ahead: null, incoming: null, hop: 0 });
        updateActor(a, frames[i], dtg, game.animClock);
      });
      view.ball = null;
      view.reach = null;
      view.landing = null;
      hud.map(null);
    } else {
      const alpha = game.acc / STEP;
      game.animClock = s.clock - STEP + game.acc;
      const ball = interpolatedBall(alpha, ballPos);
      view.ball = ball;
      for (let i = 0; i < 4; i++) {
        const pa = game.prev.players[i];
        const pb = s.players[i];
        const fr = frames[i];
        fr.x = pa.x + (pb.x - pa.x) * alpha;
        fr.y = pa.y + (pb.y - pa.y) * alpha;
        fr.vx = pb.vx || 0;
        fr.vy = pb.vy || 0;
        fr.ball = ball;
        fr.ahead = null;
        if (i > 0) aiAnimation(i, s);
      }
      // Service : le serveur tient la balle et regarde le receveur jusqu'au lâcher
      for (const fr of frames) fr.lookAt = fr.offHand = null;
      const sv = M.servePreview(s);
      if (sv) {
        const holding = sv.hitAt == null || game.animClock < sv.hitAt - M.SERVE_DROP;
        const rcv = s.players[s.serve.receiver];
        receiverHead.x = rcv.x;
        receiverHead.y = rcv.y;
        frames[sv.by].lookAt = receiverHead;
        if (holding && ball) frames[sv.by].offHand = ball;
      }
      // Toi : regard qui anticipe la sortie de vitre, préparation quand ta balle approche
      const fu = frames[0];
      fu.incoming = null;
      const u = M.userShot(s);
      fu.focus = null;
      if (u) {
        const bb = u.shot.best.best;
        Object.assign(userFocus, { x: bb.ball.x, y: bb.ball.y, z: bb.ball.z, w: B.focusWeight(bb.t - u.t, CFG.view) });
        fu.focus = userFocus;
      }
      if (u && ball) {
        fu.ahead = Q.ballStateAt(u.shot, Math.min(u.t + CFG.view.anticipation, u.shot.endT));
        const d = Math.hypot(ball.x - fu.x, ball.y - fu.y);
        if (d < 4 && u.t > -0.05) {
          const bs = Q.ballStateAt(u.shot, Math.max(0, Math.min(u.t, u.shot.endT)));
          const inc = incomings[0];
          inc.t = d / Math.max(2, Math.hypot(bs.vx, bs.vy));
          inc.z = Math.max(0.25, Math.min(1.9, ball.z));
          inc.x = ball.x;
          inc.y = ball.y;
          fu.incoming = inc;
        }
      }
      fu.hop = device.reducedMotion ? 0 : PL.splitHop({ splitAt: game.userSplitAt }, game.animClock, USER_HOP);
      actors.forEach((a, i) => updateActor(a, frames[i], dtg, game.animClock));
      view.reach = user.pos;
      highBallAids(s, ball, u);
    }
    view.pathT = null;
    view.best = null;
    view.mine = null;
    cam.yaw = user.look.gazeYaw;
    cam.pitch = user.look.gazePitch;
    cam.vFov = G.verticalFov(CFG.view.hFov, aspect, CFG.view.vFovMin, CFG.view.vFovMax);
    renderer.setCamera(cam, null);
    // Bulle d'annonce du partenaire, au-dessus de sa tête
    const h = actors[1].skeleton.head;
    callHead.x = h.x;
    callHead.y = h.y;
    callHead.z = h.z + 0.35;
    hud.placeCall(renderer.project(callHead, callPos));
  }

  /* ---------- Boucle (appelée à chaque image par main.js) ---------- */

  function frame(dt, aspect) {
    if (game.screen === 'playing') {
      // Joystick par rapport à ce que tu regardes (haut = devant toi), direction figée pendant la course
      game.move = G.viewRelativeMove(game.moveFrame, input.moveVector(), user.look.gazeYaw, CFG.controls);
      if (input.consumeStrike()) game.strike = true;
      const bot = game.debugInput; // tests en navigateur sans affichage (?debug=1) : vecteur dans le repère du court
      if (bot) {
        game.move = bot.move || game.move;
        if (bot.strike) game.strike = true;
        bot.strike = false;
      }
      stepGame(dt);
    }
    if (replay.active) {
      hud.map(null);
      replay.frame(dt, aspect);
      if (!replay.active) gameView(dt, aspect);
    } else gameView(dt, aspect);
    renderer.ball.update(replay.active ? replay.view : view, game.screen === 'playing' || replay.active ? dt * (replay.active ? replay.speed : speed()) : 0);
    actors.forEach((a, i) => figures.update(i, a.skeleton, a.look, a.eye));
  }

  /** Écran de fin de match (après l'annonce « Jeu, set et match »). */
  function showMatchEnd(e) {
    if (!game.cur || game.cur.phase !== 'over') return;
    if (game.screen === 'detail') replay.stop();
    hud.hideToast();
    hud.renderMatchEnd({ winner: e.winner, score: e.score, points: e.pointsWon, session: Stats.sessionSummary(store.save.balls, game.session) });
    setScreen('over');
  }

  function openDetail() {
    if (!game.lastError) return;
    hud.hideToast();
    replay.start(game.lastError.shot, game.lastError.result);
    hud.renderDetail(game.lastError.shot, game.lastError.result, CFG);
    setScreen('detail');
  }

  return {
    get screen() {
      return game.screen;
    },
    get hasError() {
      return !!game.lastError;
    },
    get session() {
      return game.session;
    },
    get points() {
      return game.cur ? game.cur.pointsWon : [0, 0];
    },
    get score() {
      return game.cur ? M.scoreDisplay(game.cur) : null;
    },
    start,
    /** Nouveau match (le match sauvegardé est abandonné), au format choisi à l'accueil. */
    newMatch: () => start({ fresh: true }),
    pause,
    resume,
    quit,
    frame,
    openDetail,
    replayAgain: () => replay.restart(),
    setReplayCam: (c) => replay.setCam(c),
    applySettings() {
      user.hand = store.save.settings.lefty ? -1 : 1;
      applyMatchSettings();
    },
    // Accès de test (?debug=1)
    actors: { user, partner: actors[1], opp: actors[2], all: actors },
    get state() {
      return game.cur;
    },
    set debugInput(v) {
      game.debugInput = v;
    },
    /** Tests : attribue un point à une équipe (mêmes règles de score, mêmes annonces). */
    debugAward(team) {
      if (!game.cur) return;
      game.cur = game.prev = M.awardPoint(game.cur, team);
      for (const e of game.cur.events) onEvent(e);
    },
  };
}

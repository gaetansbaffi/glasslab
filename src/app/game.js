/*
 * Glass Lab — session de jeu : partie en double à 4 joueurs (core/match.js), boucle à pas fixe
 * (120 Hz de temps de jeu) avec interpolation, animation des 4 joueurs, caméra 1re personne, sons,
 * feedback, statistiques (tes coups seulement) et Détail.
 *
 * Vitesse du jeu fixée par la difficulté adaptative (config.game.levelSpeed) : aucun réglage.
 */
import CFG from '../core/config.js';
import G from '../core/geometry.js';
import P from '../core/physics.js';
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

/** Geste correspondant au coup joué. */
function strokeOf(style, type) {
  if (type === 'overhead' || style === 'bandeja' || style === 'vibora' || style === 'smash') return 'overhead';
  if (style === 'volley') return 'volley';
  if (style === 'lob') return 'lob';
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
    screen: 'home', // home | playing | paused | detail
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

  function start() {
    const seed = ctx.params.has('seed') ? Number(ctx.params.get('seed')) >>> 0 : (Math.random() * 4294967296) >>> 0;
    game.session = Date.now();
    game.cur = game.prev = M.createMatch({
      seed,
      player: CFG.player.start,
      level: store.save.level,
      weights: Stats.familyWeights(store.save.balls),
      hand: store.save.settings.lefty ? -1 : 1,
    });
    game.acc = 0;
    game.lastError = null;
    game.firstBallSeen = false;
    game.cur.players.forEach((p, i) => placeActor(actors[i], p.x, p.y));
    hud.setStreak(0);
    hud.hideToast();
    setScreen('playing');
    if (!store.save.guideDone) hud.guideShow(0);
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
    const patch = { weights: Stats.familyWeights(store.save.balls), level: store.save.level };
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
    hud.setStreak(game.cur.streak);
    const error = r.outcome === 'miss' || r.quality < CFG.quality.ok;
    if (error) game.lastError = { shot, result: r };
    hud.showToast(r, CFG, error ? TOAST_ERROR_MS : TOAST_OK_MS, error);
    if (res.levelChange) hud.levelChange(store.save.level, res.levelChange);
    if (hud.guideStep === 0 || hud.guideStep === 1) hud.guideShow(2);
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
    } else if (e.type === 'call') {
      hud.call(e.mine ? 'À moi !' : 'À toi !');
    } else if (e.type === 'point') {
      hud.point(e.winner === 0, M.POINT_REASONS[e.reason] || '');
      if (e.reason !== 'userMiss' && e.reason !== 'userNet') audio.point(e.winner === 0);
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
    if (hit) return startSwing(user, clock, { aim: hit.result.ball, contactAt: clock, side: user.side, stroke: hit.result.type === 'volley' ? 'volley' : 'ground' });
    const u = M.userShot(game.cur);
    if (u && u.pending) {
      const b = Q.ballStateAt(u.shot, u.pending.t);
      return startSwing(user, clock, { aim: b, contactAt: clock + (u.pending.t - u.t), side: user.side, stroke: b.floorBounces ? 'ground' : 'volley' });
    }
    // Frappe dans le vide : le geste part quand même vers la balle (ou devant soi)
    const ball = M.ballPosition(game.cur);
    const close = ball && Math.hypot(ball.x - user.pos.x, ball.y - user.pos.y) < 1.6;
    startSwing(user, clock, { aim: close ? ball : null, contactAt: clock + 0.1, side: user.side });
  }

  /* ---------- Vue de jeu ---------- */

  const ballPos = { x: 0, y: 0, z: 0 };
  const view = { ball: null, reach: null, pathT: null, best: null, mine: null };
  const cam = { eye: user.eye, yaw: 0, pitch: 0, vFov: 70 };
  const frames = actors.map((a, i) => ({ x: 0, y: 0, vx: 0, vy: 0, ball: null, ahead: null, incoming: null, hop: 0, crouchScale: i === 0 ? 0.4 : 1 }));
  const incomings = actors.map(() => ({ t: 0, z: 1, x: 0, y: 0 }));
  const callPos = { x: 0, y: 0, visible: false };
  const callHead = { x: 0, y: 0, z: 0 };

  function interpolatedBall(alpha, out) {
    const a = M.ballPosition(game.cur);
    if (!a) return null;
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
    } else if (s.phase === 'dead') {
      // Mise en jeu : le joueur qui remet la balle arme son geste
      const feed = M.feedPreview(s);
      if (feed && feed.by === i && s.pauseLeft <= SWING_LEAD && !a.swing) startSwing(a, game.animClock, { aim: feed.origin, contactAt: game.animClock + s.pauseLeft, side: a.side, stroke: feed.style === 'serve' ? 'serve' : 'ground' });
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
      // Toi : regard qui anticipe la sortie de vitre, préparation quand ta balle approche
      const fu = frames[0];
      fu.incoming = null;
      const u = M.userShot(s);
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
      game.move = input.moveVector(); // par rapport au court : haut = vers le filet
      if (input.consumeStrike()) game.strike = true;
      const bot = game.debugInput; // tests en navigateur sans affichage (?debug=1) uniquement
      if (bot) {
        game.move = bot.move || game.move;
        if (bot.strike) game.strike = true;
        bot.strike = false;
      }
      stepGame(dt);
    }
    if (replay.active) {
      replay.frame(dt, aspect);
      if (!replay.active) gameView(dt, aspect);
    } else gameView(dt, aspect);
    renderer.ball.update(replay.active ? replay.view : view);
    actors.forEach((a, i) => figures.update(i, a.skeleton, a.look, a.eye));
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
    start,
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
  };
}

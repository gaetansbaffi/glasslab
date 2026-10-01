/*
 * Glass Lab — session de jeu : boucle à pas fixe (120 Hz de temps de jeu) avec interpolation, échange,
 * animation des joueurs, caméra 1re personne, sons, feedback, statistiques et Détail.
 *
 * Vitesse du jeu fixée par la difficulté adaptative (config.game.levelSpeed) : aucun réglage.
 */
import CFG from '../core/config.js';
import G from '../core/geometry.js';
import P from '../core/physics.js';
import Q from '../core/quality.js';
import R from '../core/rally.js';
import PL from '../core/players.js';
import B from '../core/body.js';
import Stats from '../core/stats.js';
import { createActor, updateActor, startSwing, placeActor, setReducedMotion } from './actors.js';
import { createReplay } from './replay.js';

const STEP = 1 / 120; // pas de physique (s de jeu)
const MAX_STEPS = 12; // au plus 0,1 s de rattrapage par image
const TOAST_OK_MS = 1400;
const TOAST_ERROR_MS = 2400; // le temps de toucher « Détail »
const USER_HOP = { splitDuration: 0.16, hop: 0.022 }; // split-step du joueur : visuel seulement

/**
 * ctx = { renderer, input, hud, audio, device, store: { save, persist() } (sauvegarde courante), params }
 */
export function createGame(ctx) {
  const { renderer, input, hud, audio, device, store } = ctx;
  const figures = renderer.figures;

  const game = {
    screen: 'home', // home | playing | paused | detail
    cur: null,
    prev: null,
    acc: 0,
    clock: 0, // temps de jeu (s), pour les animations
    strike: false,
    move: { x: 0, y: 0 },
    session: 0,
    lastError: null,
    firstBallSeen: false,
    userSplitAt: -Infinity,
    oppSplitAt: -Infinity,
  };

  const user = createActor({ team: 0, hand: 1, fp: true, x: 5, y: 2.2 });
  const opp = createActor({ team: 1, hand: 1, x: 5, y: 18 });
  figures.setPlayer(0, { team: 0, fp: true, skin: 0 });
  figures.setPlayer(1, { team: 1, skin: 1 });
  for (let i = 2; i < 4; i++) figures.hide(i);
  const replay = createReplay({ renderer, user });

  const speed = () => CFG.game.levelSpeed[Math.max(0, Math.min(4, (game.cur ? game.cur.level : store.save.level) - 1))];

  /* ---------- Partie ---------- */

  function start() {
    const seed = ctx.params.has('seed') ? Number(ctx.params.get('seed')) >>> 0 : (Math.random() * 4294967296) >>> 0;
    game.session = Date.now();
    game.cur = game.prev = R.createRally({
      seed,
      player: CFG.player.start,
      level: store.save.level,
      weights: Stats.familyWeights(store.save.balls),
    });
    game.acc = 0;
    game.lastError = null;
    game.firstBallSeen = false;
    placeActor(user, CFG.player.start.x, CFG.player.start.y);
    placeActor(opp, game.cur.opponent.x, game.cur.opponent.y);
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
    placeActor(user, 5, 2.2);
    placeActor(opp, 5, 18);
    setScreen('home');
  }

  /** Les poids des familles (répétition espacée) et le niveau suivent la sauvegarde. */
  function applyRallySettings() {
    if (!game.cur) return;
    const patch = { weights: Stats.familyWeights(store.save.balls), level: store.save.level };
    game.cur = R.withSettings(game.cur, patch);
    game.prev = R.withSettings(game.prev, patch);
  }

  /* ---------- Événements de l'échange ---------- */

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
    };
    const res = Stats.recordBall(store.save, ball, CFG.difficulty);
    store.save = res.state;
    store.persist();
    applyRallySettings();
    hud.setStreak(game.cur.streak);
    const error = r.outcome === 'miss' || r.quality < CFG.quality.ok;
    if (error) game.lastError = { shot, result: r };
    hud.showToast(r, CFG, error ? TOAST_ERROR_MS : TOAST_OK_MS, error);
    if (res.levelChange) hud.levelChange(store.save.level, res.levelChange);
    if (hud.guideStep === 0 || hud.guideStep === 1) hud.guideShow(2);
  }

  function onRallyEvent(e) {
    if (e.type === 'newBall') {
      audio.hit(0.35); // frappe adverse
      game.userSplitAt = game.clock;
      return;
    }
    if (e.type === 'hit') {
      audio.hit(0.6 + 0.4 * e.result.quality);
      audio.buzz(18);
      game.oppSplitAt = game.clock;
      setTimeout(() => audio.success(e.result.quality), 60);
    } else if (e.type === 'miss') {
      if (e.result.reason === 'weak') audio.hit(0.4);
      audio.miss();
      audio.buzz([30, 40, 30]);
    }
    if (e.type === 'hit' || e.type === 'miss') onBallResult(e.result, game.cur.shot);
  }

  /** Sons des rebonds (sol, vitres) franchis pendant le dernier pas de physique. */
  function contactSounds(a, b) {
    if (a.shot !== b.shot) return;
    if (a.phase === 'incoming') {
      const p = b.player;
      for (const c of b.shot.sim.contacts) {
        if (c.t <= a.t || c.t > b.t) continue;
        const dist = Math.hypot(c.pos.x - p.x, c.pos.y - p.y);
        const k = Math.min(1, P.speed(c.vIn) / 18) * Math.max(0.35, 1 - dist / 12);
        if (c.type === 'floor') audio.floor(k);
        else audio.glass(k);
      }
    } else if (a.phase === 'return' && a.ret && b.ret && a.ret.t < a.ret.T && b.ret.t >= b.ret.T) {
      audio.floor(0.25); // rebond du renvoi dans le camp adverse
    }
  }

  function stepGame(dtReal) {
    const sp = speed();
    game.acc += dtReal * sp;
    let n = 0;
    const pressed = game.strike;
    let events = [];
    while (game.acc >= STEP && n < MAX_STEPS) {
      game.prev = game.cur;
      game.cur = R.step(game.cur, STEP, { move: game.move, strike: game.strike });
      game.strike = false;
      contactSounds(game.prev, game.cur);
      for (const e of game.cur.events) {
        events.push(e);
        onRallyEvent(e);
      }
      game.acc -= STEP;
      n++;
    }
    if (n === MAX_STEPS) game.acc = 0; // trop de retard (onglet ralenti) : on ne rattrape pas
    if (pressed && !game.strike) userSwing(events);
    if (!game.firstBallSeen && game.cur.phase === 'incoming' && game.cur.t > 0) {
      game.firstBallSeen = true;
      if (!store.save.guideDone) hud.guideShow(1);
    }
  }

  /** Geste du joueur après un appui sur Frappe : synchronisé avec le contact s'il a lieu. */
  function userSwing(events) {
    const s = game.cur;
    const hit = events.find((e) => e.type === 'hit');
    const side = user.side;
    if (hit) return startSwing(user, game.clock, { aim: hit.result.ball, contactAt: game.clock, side, stroke: hit.result.ball.z > 1.95 ? 'overhead' : 'ground' });
    if (s.pending && s.shot) {
      const b = Q.ballStateAt(s.shot, s.pending.t);
      return startSwing(user, game.clock, { aim: b, contactAt: game.clock + (s.pending.t - s.t), side });
    }
    // Frappe dans le vide : le geste part quand même vers la balle (ou devant soi)
    const ball = R.ballPosition(s);
    const close = ball && Math.hypot(ball.x - user.pos.x, ball.y - user.pos.y) < 1.6;
    startSwing(user, game.clock, { aim: close ? ball : null, contactAt: game.clock + 0.1, side });
  }

  /* ---------- Vue de jeu ---------- */

  const ballPos = { x: 0, y: 0, z: 0 };
  const view = { ball: null, reach: null, pathT: null, best: null, mine: null };
  const cam = { eye: user.eye, yaw: 0, pitch: 0, vFov: 70 };
  const userFrame = { x: 0, y: 0, vx: 0, vy: 0, ball: null, ahead: null, incoming: null, hop: 0, crouchScale: 0.4 };
  const oppFrame = { x: 0, y: 0, vx: 0, vy: 0, ball: null, ahead: null, incoming: null, hop: 0 };
  const userIncoming = { t: 0, z: 1, x: 0, y: 0 };
  const oppIncoming = { t: 0, z: 1, x: 0, y: 0 };
  const oppVel = { x: 0, y: 0 };
  const lastOpp = { x: 5, y: 18 };

  function interpolatedBall(alpha, out) {
    const a = R.ballPosition(game.cur);
    if (game.prev.shot !== game.cur.shot || game.prev.phase !== game.cur.phase) {
      out.x = a.x;
      out.y = a.y;
      out.z = a.z;
      return out;
    }
    const b = R.ballPosition(game.prev);
    out.x = b.x + (a.x - b.x) * alpha;
    out.y = b.y + (a.y - b.y) * alpha;
    out.z = b.z + (a.z - b.z) * alpha;
    return out;
  }

  function fovs(aspect) {
    const v = G.verticalFov(CFG.view.hFov, aspect, CFG.view.vFovMin, CFG.view.vFovMax);
    return v;
  }

  /** Image de jeu (ou de l'accueil) : positions interpolées, animation, caméra aux yeux. */
  function gameView(dt, aspect) {
    const dtg = dt * speed();
    game.clock += dtg;
    const s = game.cur;
    const reduced = device.reducedMotion;
    setReducedMotion(user, reduced);
    if (!s) {
      // Accueil : court vide, regard vers le filet ; l'adversaire attend au fond
      Object.assign(userFrame, { x: user.pos.x, y: user.pos.y, vx: 0, vy: 0, ball: null, ahead: null, incoming: null, hop: 0 });
      updateActor(user, userFrame, dtg, game.clock);
      Object.assign(oppFrame, { x: 5, y: 18, vx: 0, vy: 0, ball: null, ahead: null, incoming: null, hop: 0 });
      updateActor(opp, oppFrame, dtg, game.clock);
      view.ball = null;
      view.reach = null;
    } else {
      const alpha = game.acc / STEP;
      const ball = interpolatedBall(alpha, ballPos);
      view.ball = ball;
      // Joueur : position interpolée, vitesse réelle (foulée)
      const pa = game.prev.player;
      const pb = s.player;
      userFrame.x = pa.x + (pb.x - pa.x) * alpha;
      userFrame.y = pa.y + (pb.y - pa.y) * alpha;
      userFrame.vx = pb.vx || 0;
      userFrame.vy = pb.vy || 0;
      userFrame.ball = ball;
      userFrame.ahead = s.phase === 'incoming' ? Q.ballStateAt(s.shot, Math.min(s.t + CFG.view.anticipation, s.shot.endT)) : null;
      userFrame.incoming = null;
      if (s.phase === 'incoming') {
        const d = Math.hypot(ball.x - userFrame.x, ball.y - userFrame.y);
        if (d < 4) {
          const bs = Q.ballStateAt(s.shot, Math.min(s.t, s.shot.endT));
          userIncoming.t = d / Math.max(2, Math.hypot(bs.vx, bs.vy));
          userIncoming.z = Math.max(0.25, Math.min(1.9, ball.z));
          userIncoming.x = ball.x;
          userIncoming.y = ball.y;
          userFrame.incoming = userIncoming;
        }
      }
      userFrame.hop = reduced ? 0 : PL.splitHop({ splitAt: game.userSplitAt }, game.clock, USER_HOP);
      updateActor(user, userFrame, dtg, game.clock);
      // Adversaire : suit l'échange, prépare et frappe
      const oa = game.prev.opponent;
      const ob = s.opponent;
      oppFrame.x = oa.x + (ob.x - oa.x) * alpha;
      oppFrame.y = oa.y + (ob.y - oa.y) * alpha;
      if (dtg > 0) {
        oppVel.x = (oppFrame.x - lastOpp.x) / dtg;
        oppVel.y = (oppFrame.y - lastOpp.y) / dtg;
        lastOpp.x = oppFrame.x;
        lastOpp.y = oppFrame.y;
      }
      oppFrame.vx = oppVel.x;
      oppFrame.vy = oppVel.y;
      oppFrame.ball = ball;
      oppFrame.ahead = null;
      oppFrame.incoming = null;
      oppFrame.hop = PL.splitHop({ splitAt: game.oppSplitAt }, game.clock, CFG.ai);
      if (s.phase === 'return' && s.ret) {
        const left = s.ret.hit.t - s.ret.t;
        const p = s.ret.hit.point;
        Object.assign(oppIncoming, { t: left, z: p.z, x: p.x, y: p.y });
        oppFrame.incoming = oppIncoming;
        if (left <= B.CONTACT_AT * 0.3 && !opp.swing) startSwing(opp, game.clock, { aim: p, contactAt: game.clock + left, side: opp.side, stroke: p.z > 1.95 ? 'overhead' : 'ground' });
      } else if (s.phase === 'miss' && s.nextServe) {
        const p = s.nextServe;
        Object.assign(oppIncoming, { t: s.pauseLeft, z: p.z, x: p.x, y: p.y });
        oppFrame.incoming = oppIncoming;
        if (s.pauseLeft <= B.CONTACT_AT * 0.3 && !opp.swing) startSwing(opp, game.clock, { aim: p, contactAt: game.clock + s.pauseLeft, side: opp.side });
      }
      updateActor(opp, oppFrame, dtg, game.clock);
      view.reach = user.pos;
    }
    view.pathT = null;
    view.best = null;
    view.mine = null;
    cam.yaw = user.look.gazeYaw;
    cam.pitch = user.look.gazePitch;
    cam.vFov = fovs(aspect);
    renderer.setCamera(cam, null);
  }

  function drawFigures() {
    figures.update(0, user.skeleton, user.look);
    figures.update(1, opp.skeleton, opp.look);
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
    drawFigures();
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
    start,
    pause,
    resume,
    quit,
    frame,
    openDetail,
    replayAgain: () => replay.restart(),
    actors: { user, opp }, // accès de test (?debug=1)
    get state() {
      return game.cur;
    },
    set debugInput(v) {
      game.debugInput = v;
    },
    setReplayCam: (c) => replay.setCam(c),
    applySettings() {
      const lefty = !!store.save.settings.lefty;
      user.hand = lefty ? -1 : 1;
      applyRallySettings();
    },
  };
}

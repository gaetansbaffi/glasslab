/*
 * Glass Lab — Détail d'une balle : replay au ralenti de la balle reçue, vue 1re personne (depuis ta
 * position au moment de la frappe), de dessus ou de côté, avec la trajectoire, le meilleur point de frappe
 * (vert) et ta frappe (orange). Seul endroit où la trajectoire complète et le meilleur point sont montrés.
 */
import CFG from '../core/config.js';
import B from '../core/body.js';
import G from '../core/geometry.js';
import P from '../core/physics.js';
import Q from '../core/quality.js';
import { updateActor, placeActor } from './actors.js';

const REPLAY_SPEED = 0.4;

function shotSamples(shot) {
  const out = [];
  const g = shot.sim.params.g;
  for (let t = shot.tStart; t < 0; t += 1 / 60) out.push(Object.assign({ t }, G.ballistic(shot.init, t, g)));
  for (const s of P.sample(shot.sim, 1 / 90)) out.push(s);
  return out;
}

export function createReplay({ renderer, user }) {
  const rp = { active: false, shot: null, result: null, t: 0, cam: 'fp', hold: 0 };
  const ballPos = { x: 0, y: 0, z: 0 };
  const best = { bx: 0, by: 0, bz: 0, px: 0, py: 0 };
  const mine = { bx: 0, by: 0, bz: 0 };
  const view = { ball: ballPos, reach: null, pathT: 0, best, mine: null };
  const frameIn = { x: 0, y: 0, vx: 0, vy: 0, ball: null, ahead: null, focus: null, incoming: null, hop: 0, crouchScale: 0.4 };
  const focus = { x: 0, y: 0, z: 0, w: 0 };
  const fpCam = { eye: user.eye, yaw: 0, pitch: 0, vFov: 70 };
  const fixedCam = { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, vFov: 50, topDown: false };
  const shift = { x: 0, y: 0 };

  function setFp(on) {
    renderer.figures.setPlayer(0, { team: 0, fp: on, skin: 0 });
  }

  function start(shot, result) {
    rp.active = true;
    rp.shot = shot;
    rp.result = result;
    rp.t = shot.tStart;
    rp.cam = 'fp';
    renderer.ball.setPath(shotSamples(shot));
    placeActor(user, result.player.x, result.player.y);
    setFp(true);
  }

  function stop() {
    if (!rp.active) return;
    rp.active = false;
    renderer.ball.clearPath();
    setFp(true);
  }

  function frame(dt, aspect) {
    const shot = rp.shot;
    rp.t = Math.min(shot.endT, rp.t + dt * REPLAY_SPEED);
    const b = Q.ballStateAt(shot, rp.t);
    ballPos.x = b.x;
    ballPos.y = b.y;
    ballPos.z = b.z;
    ballPos.wx = b.wx;
    ballPos.wy = b.wy;
    ballPos.wz = b.wz;
    view.pathT = rp.t;
    const bb = shot.best.best;
    Object.assign(best, { bx: bb.ball.x, by: bb.ball.y, bz: bb.ball.z, px: bb.pos.x, py: bb.pos.y });
    const r = rp.result;
    if (r.ball) {
      Object.assign(mine, { bx: r.ball.x, by: r.ball.y, bz: r.ball.z });
      view.mine = mine;
    } else view.mine = null;
    view.reach = r.player;
    // Panneau du Détail à droite en paysage, en bas en portrait : l'image est recentrée sur la partie libre
    shift.x = aspect > 1 ? 0.2 : 0;
    shift.y = aspect <= 1 ? 0.22 : 0;
    frameIn.x = r.player.x;
    frameIn.y = r.player.y;
    frameIn.ball = ballPos;
    frameIn.ahead = Q.ballStateAt(shot, Math.min(rp.t + CFG.view.anticipation, shot.endT));
    Object.assign(focus, { x: bb.ball.x, y: bb.ball.y, z: bb.ball.z, w: B.focusWeight(bb.t - rp.t, CFG.view) });
    frameIn.focus = focus;
    updateActor(user, frameIn, dt * REPLAY_SPEED, 0);
    if (rp.cam === 'fp') {
      fpCam.yaw = user.look.gazeYaw;
      fpCam.pitch = user.look.gazePitch;
      fpCam.vFov = G.verticalFov(CFG.view.hFov, aspect, CFG.view.vFovMin, CFG.view.vFovMax);
      renderer.setCamera(fpCam, shift);
      return;
    }
    const c = fixedCam;
    if (rp.cam === 'top') {
      const dist = 16;
      const half = 5.9;
      Object.assign(c.eye, { x: 5, y: 5, z: dist });
      Object.assign(c.target, { x: 5, y: 5, z: 0 });
      c.topDown = true;
      c.vFov = (2 * Math.atan(Math.max(half, half / aspect) / dist) * 180) / Math.PI;
    } else {
      Object.assign(c.eye, { x: 19, y: 5, z: 1.6 });
      Object.assign(c.target, { x: 5, y: 5, z: 1.4 });
      c.topDown = false;
      c.vFov = G.verticalFov(48, aspect, 20, 90);
    }
    renderer.setCamera(c, shift);
  }

  return {
    get active() {
      return rp.active;
    },
    speed: REPLAY_SPEED,
    view,
    start,
    stop,
    frame,
    restart() {
      if (rp.active) rp.t = rp.shot.tStart;
    },
    setCam(c) {
      rp.cam = c;
      setFp(c === 'fp');
    },
  };
}

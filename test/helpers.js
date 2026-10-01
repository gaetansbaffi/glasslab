/*
 * Glass Lab — utilitaires partagés par les tests.
 */
import P from '../src/core/physics.js';
import G from '../src/core/geometry.js';
import R from '../src/core/rally.js';
import PL from '../src/core/players.js';
import CFG from '../src/core/config.js';

export const SEEDS = Array.from({ length: 30 }, (_, i) => 1000 + i * 7919);
export const START = { x: 5, y: 3 };

/** Lancers aléatoires couvrant tout le demi-court, y compris des tirs violents dans les coins. */
export function randomLaunches(n, seed) {
  const rng = P.mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: 0.5 + rng() * 9,
      y: 9.9,
      z: 0.5 + rng() * 2.5,
      vx: (rng() - 0.5) * 30,
      vy: -(2 + rng() * 30),
      vz: (rng() - 0.3) * 15,
    });
  }
  return out;
}

/** Balle de test : lancée depuis le filet vers un point de rebond, en T secondes. */
export function makeShot(from, to, T) {
  const init = P.launchToBounce(from, to, T);
  const sim = P.simulate(init, { maxFloorBounces: 2 });
  return { init, sim, tStart: -G.preNetDuration(init, sim.params.g), endT: sim.endT, family: 'test' };
}

/** Joystick qui amène le joueur en `to` et l'y arrête (il a de l'inertie : accélération et freinage). */
export function steerTo(player, to, dt) {
  const v = PL.arriveVelocity(player, to, CFG.player, dt);
  return { x: v.x / CFG.player.speed, y: v.y / CFG.player.speed };
}

/** Joueur automatique : va au meilleur point de frappe et appuie au bon moment. */
export function botInput(st, dt) {
  if (st.phase !== 'incoming' || st.pending) return {};
  const best = st.shot.best.best;
  return { move: steerTo(st.player, best.pos, dt), strike: st.t + dt >= best.t && st.t < best.t + dt };
}

export function runRally(rally, seconds, inputFn, dt) {
  dt = dt || 1 / 60;
  const events = [];
  let st = rally;
  for (let t = 0; t < seconds; t += dt) {
    const inp = inputFn(st, dt);
    st = R.step(st, dt, inp);
    for (const e of st.events) events.push(e);
  }
  return { st, events };
}

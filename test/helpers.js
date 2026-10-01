/*
 * Glass Lab — utilitaires partagés par les tests.
 */
import P from '../src/core/physics.js';
import G from '../src/core/geometry.js';
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

/**
 * Balle de test : au plan du filet (from), elle rebondit en `to` après T secondes (air compris, effet
 * facultatif : top = lift > 0 / coupé < 0, rad/s) ; avant le filet, la trajectoire est prolongée jusqu'à la
 * raquette adverse (instants négatifs).
 */
export function makeShot(from, to, T, top) {
  const init = P.launchToBounce(from, to, T, undefined, top ? P.spinVector(to.x - from.x, to.y - from.y, top, 0) : undefined);
  const sim = P.extendBack(P.simulate(init, { maxFloorBounces: 2 }), G.preNetDuration(init, P.DEFAULT_PARAMS.g));
  return { init, sim, tStart: sim.segments[0].t0, endT: sim.endT, family: 'test' };
}

/** Joystick qui amène le joueur en `to` et l'y arrête (il a de l'inertie : accélération et freinage). */
export function steerTo(player, to, dt) {
  const v = PL.arriveVelocity(player, to, CFG.player, dt);
  return { x: v.x / CFG.player.speed, y: v.y / CFG.player.speed };
}

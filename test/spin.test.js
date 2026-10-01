/*
 * Glass Lab — tests : effets (rotation de la balle) dans la physique et dans les coups.
 */
import { test, assert, near, section } from './harness.js';
import P from '../src/core/physics.js';
import F from '../src/core/flight.js';
import SG from '../src/core/shotgen.js';
import CFG from '../src/core/config.js';

section('Effets de balle');

const R = P.DEFAULT_PARAMS.radius;

/** Lancers du court complet avec un effet aléatoire (lift, coupé, latéral, axe quelconque). */
function spinLaunches(n, seed) {
  const rng = P.mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const far = rng() < 0.5;
    const s = {
      x: 0.5 + rng() * 9,
      y: far ? 10.4 + rng() * 9.2 : 0.4 + rng() * 9.2,
      z: 0.2 + rng() * 2.8,
      vx: (rng() - 0.5) * 24,
      vy: (far ? -1 : 1) * (2 + rng() * 28) * (rng() < 0.85 ? 1 : -1),
      vz: (rng() - 0.4) * 14,
    };
    out.push(Object.assign(s, { wx: (rng() - 0.5) * 400, wy: (rng() - 0.5) * 400, wz: (rng() - 0.5) * 400 }));
  }
  return out;
}

/** Balle lancée de (5, 16) vers un rebond en (5, 2,5), en 1 s, avec un effet top (rad/s). */
function toBackGlass(top) {
  const from = { x: 5, y: 16, z: 1.0 };
  const to = { x: 5, y: 2.5 };
  const init = P.launchToBounce(from, to, 1.0, undefined, P.spinVector(to.x - from.x, to.y - from.y, top, 0));
  return P.simulate(init, { court: 'full', maxFloorBounces: 2 });
}

test('effet nul : exactement la trajectoire sans effet', () => {
  for (const init of spinLaunches(150, 3)) {
    const plain = { x: init.x, y: init.y, z: init.z, vx: init.vx, vy: init.vy, vz: init.vz };
    const a = P.simulate(plain, { court: 'full' });
    const b = P.simulate(Object.assign({}, plain, { wx: 0, wy: 0, wz: 0 }), { court: 'full' });
    assert(a.contacts.length === b.contacts.length, 'mêmes contacts');
    for (let t = 0; t < a.endT; t += 0.04) {
      const sa = P.stateAt(a, t);
      const sb = P.stateAt(b, t);
      assert(sa.x === sb.x && sa.y === sb.y && sa.z === sb.z, 'position identique');
    }
  }
});

test('en vol : le lift plonge, le coupé flotte, l’effet latéral courbe la trajectoire', () => {
  const land = (w) => P.simulate(Object.assign({ x: 5, y: 16, z: 1, vx: 0, vy: -16, vz: 2 }, w), { court: 'full' }).contacts.find((c) => c.type === 'floor').pos;
  const flat = land({});
  const top = land(P.spinVector(0, -1, 150, 0));
  const back = land(P.spinVector(0, -1, -150, 0));
  assert(top.y > flat.y + 0.3, `le lift tombe plus court : ${top.y.toFixed(2)} contre ${flat.y.toFixed(2)}`);
  assert(back.y < flat.y - 0.3, `le coupé va plus loin : ${back.y.toFixed(2)} contre ${flat.y.toFixed(2)}`);
  // Effet latéral positif : vers la droite de la trajectoire (la balle va vers −y, sa droite est en −x)
  const right = land(P.spinVector(0, -1, 0, 120));
  const left = land(P.spinVector(0, -1, 0, -120));
  assert(right.x < 5 - 0.2 && left.x > 5 + 0.2, `courbe : ${right.x.toFixed(2)} / ${left.x.toFixed(2)}`);
});

test('rebond au sol : le coupé freine le plus, le lift le moins, un lift au-delà du roulement fait filer la balle, le latéral dévie', () => {
  const base = { x: 5, y: 5, z: R, vx: 0, vy: -12, vz: -5 };
  const out = (w) => P.reflect(Object.assign({}, base, w), 'floor', P.DEFAULT_PARAMS);
  const none = out({ wx: 0, wy: 0, wz: 0 });
  const back = out(P.spinVector(0, -1, -150, 0));
  const top = out(P.spinVector(0, -1, 150, 0));
  const kick = out(P.spinVector(0, -1, 500, 0)); // R ω ≈ 16,5 m/s > 12 m/s : plus vite que le roulement
  // Sans effet : la balle accroche le gazon et part en roulant (vitesse / (1 + κ)), avec du lift
  near(none.vy, -12 / (1 + P.DEFAULT_PARAMS.spinInertia), 1e-9);
  assert(P.spinParts(none).top > 100, 'la balle prend du lift au rebond');
  assert(-back.vy < -none.vy - 0.5, `coupé : ${back.vy.toFixed(2)}`);
  assert(-top.vy > -none.vy + 1 && -top.vy < 12, `lift : ${top.vy.toFixed(2)} (ralentit moins, sans accélérer)`);
  assert(-kick.vy > 12, `lift très appuyé : ${kick.vy.toFixed(2)} (la balle file)`);
  near(back.vz, none.vz, 1e-12, 'rebond vertical inchangé');
  // Le frottement absorbe le coupé : la balle glisse tout le contact et repart sans coupé, voire liftée
  assert(P.spinParts(back).top > -0.4 * 150, `coupé absorbé au rebond : ${P.spinParts(back).top.toFixed(0)} rad/s`);
  // Latéral (axe incliné, comme une víbora) : déviation vers la droite de la trajectoire
  const side = out(P.spinVector(0, -1, 0, 150));
  assert(side.vx < -0.8, `déviation au rebond : vx = ${side.vx.toFixed(2)}`);
});

test('vitre : le coupé « meurt » (sort bas), le lift sort haut', () => {
  const zAfter = (sim) => {
    const back = sim.contacts.find((c) => c.type === 'back');
    let z = 0;
    for (const s of P.sample(sim, 1 / 200, back.t, sim.endT)) z = Math.max(z, s.z);
    return { z, back };
  };
  const cut = zAfter(toBackGlass(-150));
  const none = zAfter(toBackGlass(0));
  const lift = zAfter(toBackGlass(150));
  assert(cut.z < none.z - 0.2 && lift.z > none.z + 0.2, `hauteur après la vitre : ${cut.z.toFixed(2)} / ${none.z.toFixed(2)} / ${lift.z.toFixed(2)}`);
  assert(cut.back.vOut.vz < none.back.vOut.vz && lift.back.vOut.vz > none.back.vOut.vz, 'vitesse verticale en sortie de vitre');
  assert(cut.back.vOut.vy < none.back.vOut.vy, 'le coupé sort moins vite de la vitre');
});

test('launchToBounce avec effet : le premier rebond tombe au point visé (au millimètre), malgré l’air et l’effet', () => {
  const rng = P.mulberry32(8);
  for (let i = 0; i < 200; i++) {
    const from = { x: 1 + rng() * 8, y: 11 + rng() * 8, z: 0.4 + rng() * 2.6 };
    const to = { x: 0.5 + rng() * 9, y: 0.5 + rng() * 9 };
    const T = 0.6 + rng() * 1.2;
    const spin = P.spinVector(to.x - from.x, to.y - from.y, (rng() - 0.5) * 400, (rng() - 0.5) * 400);
    const init = P.launchToBounce(from, to, T, undefined, spin);
    const sim = P.simulate(init, { maxFloorBounces: 1, tMax: 4, court: 'full' });
    const c = sim.contacts[0];
    if (c.type !== 'floor') continue; // filet ou paroi avant le rebond : hors sujet ici
    near(c.pos.x, to.x, 1e-3);
    near(c.pos.y, to.y, 1e-3);
    near(c.t, T, 1e-3);
  }
  const parts = P.spinParts(Object.assign({ vx: 0, vy: -10 }, P.spinVector(0, -10, -120, 40)));
  near(parts.top, -120, 1e-9);
  near(parts.side, 40, 1e-9);
});

test('court complet avec effet : jamais de traversée du sol, des parois ni du filet', () => {
  const H = P.COURT.netHeight;
  for (const init of spinLaunches(300, 21)) {
    const sim = P.simulate(init, { court: 'full', maxFloorBounces: 3, tMax: 8 });
    let prev = null;
    for (const s of P.sample(sim, 1 / 400)) {
      assert(s.z >= R - 1e-6, `sous le sol : z=${s.z}`);
      assert(s.y >= R - 1e-6 && s.y <= 20 - R + 1e-6, `vitre de fond traversée : y=${s.y}`);
      assert(s.x >= R - 1e-6 && s.x <= 10 - R + 1e-6, `paroi latérale traversée : x=${s.x}`);
      if (prev && (prev.y - 10) * (s.y - 10) < 0) {
        const k = (10 - prev.y) / (s.y - prev.y);
        assert(prev.z + (s.z - prev.z) * k >= H - R - 1e-3, 'balle passée à travers le filet');
      }
      prev = s;
    }
  }
});

test('court complet avec effet : symétrie entre les deux moitiés, et suite au demi-court identique', () => {
  for (const init of spinLaunches(100, 5)) {
    const a = P.simulate(init, { court: 'full' });
    const b = P.simulate(P.mirrorState(init), { court: 'full' });
    assert(a.contacts.length === b.contacts.length, 'mêmes contacts');
    for (let t = 0; t < a.endT; t += 0.05) {
      const sa = P.stateAt(a, t);
      const sb = P.mirrorState(P.stateAt(b, t));
      near(Math.hypot(sa.x - sb.x, sa.y - sb.y, sa.z - sb.z), 0, 1e-9);
      near(Math.hypot(sa.wx - sb.wx, sa.wy - sb.wy, sa.wz - sb.wz), 0, 1e-9);
    }
  }
  // Balle reçue (flight.js) : après le filet, le demi-court suit la même trajectoire que le court complet
  let checked = 0;
  for (const init of spinLaunches(300, 77)) {
    if (init.y < 10 || init.vy >= 0) continue;
    const f = F.makeFlight(init, 1);
    if (!f.shot || f.sim.contacts.some((c) => c.t <= f.cross + 1e-12 && c.type !== 'cord')) continue;
    for (let t = 0; t < Math.min(f.shot.endT, 2); t += 0.05) {
      const full = F.ballAt(f, t + f.cross);
      const half = P.stateAt(f.shot.sim, t);
      near(Math.hypot(full.x - half.x, full.y - half.y, full.z - half.z), 0, 1e-6);
    }
    checked++;
  }
  assert(checked > 30, 'trajectoires comparées : ' + checked);
});

test('coups : bandeja, volée et service coupés, lob lifté, víbora vers la grille', () => {
  const origin = (style) => ({ x: 4, y: 15.5, z: style === 'serve' ? 0.6 : ['bandeja', 'vibora', 'smash'].includes(style) ? 2.5 : 1.0 });
  const count = {};
  for (let s = 0; s < 40; s++) {
    for (const style of ['bandeja', 'volley', 'serve', 'lob', 'vibora']) {
      const f = SG.generateTo({ origin: origin(style), team: 1, style, level: 1 + (s % 5), seed: 300 + s, attempts: 80, config: CFG });
      if (!f) continue;
      count[style] = (count[style] || 0) + 1;
      const sp = P.spinParts(f.init);
      if (style === 'lob') assert(sp.top > 0, 'lob lifté');
      else if (style !== 'vibora') assert(sp.top < 0, `${style} coupé`);
      else {
        assert(sp.top < 0 && Math.abs(sp.side) >= 100, 'víbora : coupé et latéral');
        // L'effet latéral part vers la paroi latérale la plus proche du rebond
        const bounce = f.sim.contacts.find((c) => c.type === 'floor').pos;
        const rightX = f.init.vy / Math.hypot(f.init.vx, f.init.vy); // composante x de la droite de la trajectoire
        assert(Math.sign(sp.side) === Math.sign(rightX * (bounce.x < 5 ? -1 : 1)), 'víbora vers la grille');
      }
      // La balle reçue garde l'effet (repère du receveur)
      assert(f.shot.init.wx !== undefined, 'balle reçue avec effet');
    }
  }
  for (const style of ['bandeja', 'volley', 'serve', 'lob', 'vibora']) assert((count[style] || 0) >= 20, `${style} : ${count[style] || 0} coups générés sur 40`);
});

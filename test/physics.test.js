/*
 * Glass Lab — tests.
 */
import { test, assert, near, section } from './harness.js';
import P from '../src/core/physics.js';
import F from '../src/core/flight.js';
import Q from '../src/core/quality.js';
import { randomLaunches } from './helpers.js';

section('Physique');

test('la balle ne traverse jamais le sol ni les parois (lancers aléatoires, échantillonnage fin)', () => {
  const r = P.DEFAULT_PARAMS.radius;
  const tol = 1e-6;
  for (const init of randomLaunches(400, 7)) {
    const sim = P.simulate(init, { maxFloorBounces: 4, tMax: 6 });
    for (const s of P.sample(sim, 1 / 500)) {
      assert(s.z >= r - tol, `sous le sol : z=${s.z}`);
      assert(s.y >= r - tol, `derrière la vitre de fond : y=${s.y}`);
      assert(s.x >= r - tol && s.x <= P.COURT.width - r + tol, `hors des parois latérales : x=${s.x}`);
    }
  }
});

test('la balle ne traverse pas les parois entre deux échantillons (vérification analytique par segment)', () => {
  const r = P.DEFAULT_PARAMS.radius;
  for (const init of randomLaunches(300, 99)) {
    const sim = P.simulate(init, { maxFloorBounces: 4 });
    for (let i = 0; i < sim.segments.length; i++) {
      const seg = sim.segments[i];
      const t1 = i + 1 < sim.segments.length ? sim.segments[i + 1].t0 : sim.endT;
      const a = P.stateAt(sim, seg.t0 + 1e-12);
      const b = P.advance(seg.s, t1 - seg.t0, sim.params.g);
      // Dans un segment, la balle ne fait pas demi-tour le long d'une paroi : les extrémités suffisent
      for (const s of [a, b]) {
        assert(s.y >= r - 1e-6 && s.x >= r - 1e-6 && s.x <= P.COURT.width - r + 1e-6, 'paroi traversée');
      }
      // z est parabolique : vérifier aussi l'extrémum s'il est dans le segment
      assert(b.z >= r - 1e-6, 'sol traversé en fin de segment');
    }
  }
});

test('générateur pseudo-aléatoire : même graine → même suite, graines différentes → suites différentes', () => {
  const r1 = P.mulberry32(42);
  const r2 = P.mulberry32(42);
  const r3 = P.mulberry32(43);
  let diff = 0;
  for (let i = 0; i < 100; i++) {
    const a = r1();
    assert(a === r2(), 'générateur non déterministe');
    if (a !== r3()) diff++;
  }
  assert(diff > 90);
});

test('même état initial → trajectoire identique', () => {
  for (const init of randomLaunches(50, 4)) {
    const a = P.sample(P.simulate(init), 1 / 100);
    const b = P.sample(P.simulate(Object.assign({}, init)), 1 / 100);
    assert(JSON.stringify(a) === JSON.stringify(b));
  }
});

test('contacts (sol, vitres, grillage) : restitution e(v), frottement jusqu’au roulement au plus, jamais d’énergie créée', () => {
  const D = P.DEFAULT_PARAMS;
  const R = D.radius;
  const energy = (s) => 0.5 * (s.vx ** 2 + s.vy ** 2 + s.vz ** 2) + 0.5 * D.spinInertia * R * R * (s.wx ** 2 + s.wy ** 2 + s.wz ** 2);
  const NORMAL = { floor: [0, 0, 1], back: [0, 1, 0], left: [1, 0, 0], right: [-1, 0, 0] };
  const rng = P.mulberry32(31);
  let checked = 0;
  let mesh = 0;
  for (let i = 0; i < 2000; i++) {
    const type = ['floor', 'back', 'left', 'right'][i % 4];
    const n = NORMAL[type];
    const s = { x: 5, y: 1 + rng() * 8, z: 0.2 + rng() * 3.5, vx: (rng() - 0.5) * 40, vy: (rng() - 0.5) * 40, vz: (rng() - 0.5) * 30, wx: (rng() - 0.5) * 500, wy: (rng() - 0.5) * 500, wz: (rng() - 0.5) * 500 };
    const vn = s.vx * n[0] + s.vy * n[1] + s.vz * n[2];
    if (vn > -0.5) continue; // la balle doit arriver sur la surface
    const o = P.reflect(s, type, D);
    const vnOut = o.vx * n[0] + o.vy * n[1] + o.vz * n[2];
    const glass = type === 'floor' || P.onGlass({ type, pos: s });
    const e = glass ? P.restitution(type === 'floor' ? 'floor' : 'glass', vn) : D.meshE;
    near(vnOut, -e * vn, 1e-9, 'vitesse normale');
    assert(energy(o) <= energy(s) + 1e-9, 'énergie créée au contact ' + type);
    if (glass) {
      // Glissement du point de contact (v_t + ω × r) : réduit, jamais inversé (au plus le roulement)
      const slip = (q) => {
        const rx = -R * n[0], ry = -R * n[1], rz = -R * n[2];
        const t = [q.vx - (q.vx * n[0] + q.vy * n[1] + q.vz * n[2]) * n[0], q.vy - (q.vx * n[0] + q.vy * n[1] + q.vz * n[2]) * n[1], q.vz - (q.vx * n[0] + q.vy * n[1] + q.vz * n[2]) * n[2]];
        return [t[0] + q.wy * rz - q.wz * ry, t[1] + q.wz * rx - q.wx * rz, t[2] + q.wx * ry - q.wy * rx];
      };
      const u0 = slip(s);
      const u1 = slip(o);
      assert(u0[0] * u1[0] + u0[1] * u1[1] + u0[2] * u1[2] >= -1e-9, 'le frottement ne dépasse pas le roulement');
      assert(Math.hypot(...u1) <= Math.hypot(...u0) + 1e-9, 'glissement réduit');
    } else mesh++;
    checked++;
  }
  assert(checked > 800 && mesh > 20, `contacts testés : ${checked} (dont ${mesh} sur le grillage)`);
});

test('sans pertes ni frottement (e = 1, μ = 0), angle de sortie = angle d’incidence', () => {
  const params = { glassE: 1, glassSlope: 0, glassGrip: 0, air: 0 };
  const sim = P.simulate({ x: 5, y: 5, z: 1.5, vx: 3, vy: -8, vz: 2 }, { params, maxFloorBounces: 2 });
  const c = sim.contacts.find((k) => k.type !== 'floor');
  const { inDeg, outDeg } = P.wallAngles(c);
  near(outDeg, inDeg, 1e-9);
});

test('essai de rebond du règlement FIP : lâchée de 2,54 m, 1,35 à 1,45 m sur une surface dure, un peu moins sur le gazon', () => {
  const D = P.DEFAULT_PARAMS;
  const v = Math.sqrt(2 * D.g * 2.54); // vitesse d'impact sans air (7,06 m/s)
  const hard = P.restitution('glass', v) ** 2 * 2.54;
  assert(hard >= 1.35 && hard <= 1.45, 'vitre (surface dure) : ' + hard.toFixed(3) + ' m');
  // Sur le gazon sablé, avec l'air : vraie chute puis vrai rebond
  const sim = P.simulate({ x: 5, y: 5, z: 2.54 + D.radius, vx: 0, vy: 0, vz: 0 }, { maxFloorBounces: 2 });
  const c = sim.contacts[0];
  const up = P.maxHeight(sim, c.t, sim.endT) - D.radius;
  assert(up >= 1.15 && up <= 1.35, 'gazon : ' + up.toFixed(3) + ' m');
  // Plus l'impact est violent, plus la balle (pressurisée) s'écrase : restitution plus faible
  assert(P.restitution('floor', 20) < P.restitution('floor', 10) && P.restitution('floor', 10) < P.restitution('floor', 4), 'restitution qui baisse avec la vitesse');
});

test('launchToBounce : le premier rebond tombe au point visé, à l’instant visé (air compris)', () => {
  for (const [from, to, T] of [[{ x: 3, y: 10, z: 1.2 }, { x: 6, y: 2 }, 0.8], [{ x: 5, y: 18.5, z: 1 }, { x: 4, y: 1.5 }, 2.4], [{ x: 8, y: 12, z: 2.7 }, { x: 2, y: 5 }, 0.35]]) {
    const init = P.launchToBounce(from, to, T);
    const sim = P.simulate(init, { court: 'full', maxFloorBounces: 1 });
    const c = sim.contacts.find((k) => k.type === 'floor');
    near(c.pos.x, to.x, 1e-3);
    near(c.pos.y, to.y, 1e-3);
    near(c.t, T, 1e-3);
  }
});

test('air : le smash ralentit, le lob retombe plus raide qu’il ne monte, une balle lâchée de haut plafonne vers 22 m/s', () => {
  const D = P.DEFAULT_PARAMS;
  // Smash à ≈ 110 km/h du filet vers le fond adverse : il perd ≥ 15 % de sa vitesse avant le rebond
  const smash = P.launchToBounce({ x: 5, y: 12.5, z: 2.8 }, { x: 5, y: 3.5 }, 0.36);
  const at = P.flyFree(smash);
  assert(P.speed(smash) * 3.6 > 95 && P.hSpeed(at.s) < 0.85 * P.hSpeed(smash), `smash : ${Math.round(P.speed(smash) * 3.6)} km/h au départ, ${Math.round(P.speed(at.s) * 3.6)} km/h au rebond`);
  // Lob : la descente est plus raide que la montée (sans air, ce serait symétrique)
  const lob = P.launchToBounce({ x: 5, y: 18.5, z: 1 }, { x: 5, y: 2 }, 2.3);
  const fl = P.flyFree(lob);
  const up = (Math.atan2(lob.vz, P.hSpeed(lob)) * 180) / Math.PI;
  const down = (Math.atan2(-fl.s.vz, P.hSpeed(fl.s)) * 180) / Math.PI;
  assert(down > up + 4, `lob : ${up.toFixed(0)}° au départ, ${down.toFixed(0)}° à l’arrivée`);
  // Chute de 60 m : vitesse limite (traînée = poids) √(g / (k C_D)) ≈ 22 m/s, atteinte selon la loi exacte
  const vt = Math.sqrt(D.g / (D.air * D.drag));
  const drop = P.simulate({ x: 5, y: 5, z: 60 + D.radius, vx: 0, vy: 0, vz: 0 }, { maxFloorBounces: 1, tMax: 20 });
  near(-drop.contacts[0].vIn.vz, vt * Math.sqrt(1 - Math.exp((-2 * D.g * 60) / (vt * vt))), 0.05, 'chute avec traînée');
  assert(vt > 21 && vt < 23.5, 'vitesse limite : ' + vt.toFixed(1) + ' m/s');
});

test('rebond d’un lob : il remonte bas (pas plus de 40 % de sa hauteur) et ne file pas sauf lift très appuyé', () => {
  for (const top of [0, 60, 120]) {
    const lob = P.launchToBounce({ x: 5, y: 18.5, z: 1 }, { x: 5, y: 3 }, 2.3, undefined, P.spinVector(0, -1, top, 0));
    const sim = P.simulate(lob, { court: 'full', maxFloorBounces: 2 });
    const fl = sim.contacts.find((c) => c.type === 'floor');
    const apex = P.maxHeight(sim, 0, fl.t);
    const next = sim.contacts.find((c) => c.t > fl.t);
    const rebound = P.maxHeight(sim, fl.t, next ? next.t : sim.endT);
    assert(rebound < 0.4 * apex, `lift ${top} : sommet ${apex.toFixed(2)} m, rebond ${rebound.toFixed(2)} m`);
    const hIn = Math.hypot(fl.vIn.vx, fl.vIn.vy);
    const hOut = Math.hypot(fl.vOut.vx, fl.vOut.vy);
    assert(hOut <= hIn + 1e-9, `lift ${top} : la balle ne gagne pas de vitesse au rebond (${hIn.toFixed(2)} → ${hOut.toFixed(2)} m/s)`);
  }
});

test('précision : le vol découpé en segments suit une intégration très fine (RK4) au centimètre près', () => {
  const D = P.DEFAULT_PARAMS;
  const rk4 = (init, T) => {
    let u = [init.x, init.y, init.z, init.vx, init.vy, init.vz];
    const out = { ax: 0, ay: 0, az: 0 };
    const f = (q) => {
      P.airAccel(q[3], q[4], q[5], init.wx, init.wy, init.wz, D, out);
      return [q[3], q[4], q[5], out.ax, out.ay, out.az - D.g];
    };
    const h = 5e-4;
    const n = Math.round(T / h);
    const hh = T / n;
    for (let i = 0; i < n; i++) {
      const k1 = f(u);
      const k2 = f(u.map((v, j) => v + (hh / 2) * k1[j]));
      const k3 = f(u.map((v, j) => v + (hh / 2) * k2[j]));
      const k4 = f(u.map((v, j) => v + hh * k3[j]));
      u = u.map((v, j) => v + (hh / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    }
    return u;
  };
  const rng = P.mulberry32(8);
  let worst = 0;
  for (let i = 0; i < 25; i++) {
    const v = 8 + rng() * 26;
    const el = ((-5 + rng() * 60) * Math.PI) / 180;
    const init = Object.assign({ x: 5, y: 18, z: 1 + rng() * 1.5, vx: (rng() - 0.5) * 4, vy: -v * Math.cos(el), vz: v * Math.sin(el) }, P.spinVector(0, -1, (rng() - 0.5) * 300, (rng() - 0.5) * 200));
    const fl = P.flyFree(init);
    const ref = rk4(init, fl.t);
    worst = Math.max(worst, Math.hypot(ref[0] - fl.s.x, ref[1] - fl.s.y, ref[2] - fl.s.z));
  }
  assert(worst < 0.02, 'écart maximal au rebond : ' + (worst * 1000).toFixed(1) + ' mm');
});

/* ---------- Court complet ---------- */

/** Lancers depuis les deux moitiés, vers l'autre moitié ou non, y compris très bas (filet) et très forts. */
function fullLaunches(n, seed) {
  const rng = P.mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const far = rng() < 0.5;
    const y = far ? 10.4 + rng() * 9.2 : 0.4 + rng() * 9.2;
    out.push({
      x: 0.5 + rng() * 9,
      y,
      z: 0.2 + rng() * 2.8,
      vx: (rng() - 0.5) * 24,
      vy: (far ? -1 : 1) * (2 + rng() * 28) * (rng() < 0.85 ? 1 : -1),
      vz: (rng() - 0.4) * 14,
    });
  }
  return out;
}

test('court complet : jamais de traversée du sol, des quatre parois ni du filet', () => {
  const r = P.DEFAULT_PARAMS.radius;
  const H = P.COURT.netHeight;
  let netHits = 0;
  let cords = 0;
  for (const init of fullLaunches(400, 12)) {
    const sim = P.simulate(init, { court: 'full', maxFloorBounces: 3, tMax: 8 });
    netHits += sim.contacts.filter((c) => c.type === 'net').length;
    cords += sim.contacts.filter((c) => c.type === 'cord').length;
    let prev = null;
    for (const s of P.sample(sim, 1 / 400)) {
      assert(s.z >= r - 1e-6, `sous le sol : z=${s.z}`);
      assert(s.y >= r - 1e-6 && s.y <= 20 - r + 1e-6, `vitre de fond traversée : y=${s.y}`);
      assert(s.x >= r - 1e-6 && s.x <= 10 - r + 1e-6, `paroi latérale traversée : x=${s.x}`);
      if (prev && (prev.y - 10) * (s.y - 10) < 0) {
        // Passage du filet : interpolation de la hauteur au plan du filet
        const k = (10 - prev.y) / (s.y - prev.y);
        const z = prev.z + (s.z - prev.z) * k;
        assert(z >= H - r - 1e-3, `balle passée à travers le filet : z=${z.toFixed(3)}`);
      }
      prev = s;
    }
  }
  assert(netHits > 10 && cords > 0, `cas de filet testés : ${netHits} dans le filet, ${cords} bandes`);
});

test('court complet : symétrie entre les deux moitiés (le jeu adverse suit les mêmes lois)', () => {
  for (const init of fullLaunches(120, 5)) {
    const a = P.simulate(init, { court: 'full' });
    const b = P.simulate(P.mirrorState(init), { court: 'full' });
    assert(a.contacts.length === b.contacts.length, 'mêmes contacts');
    a.contacts.forEach((c, i) => {
      const d = b.contacts[i];
      const same = c.type === d.type || (c.type === 'back' && d.type === 'backFar') || (c.type === 'backFar' && d.type === 'back') || (c.type === 'left' && d.type === 'right') || (c.type === 'right' && d.type === 'left');
      assert(same, `${c.type} ≠ ${d.type}`);
      near(c.t, d.t, 1e-9);
    });
    for (let t = 0; t < a.endT; t += 0.05) {
      const sa = P.stateAt(a, t);
      const sb = P.mirrorState(P.stateAt(b, t));
      near(Math.hypot(sa.x - sb.x, sa.y - sb.y, sa.z - sb.z), 0, 1e-9);
    }
  }
});

test('court complet : la balle vue par le receveur est exactement le vol complet (repère, instants, contacts)', () => {
  let checked = 0;
  for (const init of fullLaunches(300, 77)) {
    const team = init.y > 10 ? 1 : 0;
    const f = F.makeFlight(init, team);
    if (!f.shot) continue;
    const recv = 1 - team;
    for (let t = f.shot.tStart; t <= f.shot.endT; t += 0.043) {
      const a = F.toTeamFrame(recv, P.stateAt(f.sim, t + f.cross));
      const b = Q.ballStateAt(f.shot, t);
      near(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), 0, 1e-9, 'même balle');
    }
    const after = f.sim.contacts.filter((c) => c.t > f.cross + 1e-9 && c.type !== 'cord' && c.type !== 'net' && c.t <= f.cross + f.shot.endT + 1e-9);
    assert(after.length === f.shot.sim.contacts.length, 'mêmes contacts');
    after.forEach((c, i) => near(c.t - f.cross, f.shot.sim.contacts[i].t, 1e-12));
    near(f.shot.tStart, -f.cross, 1e-12, 'la frappe à l’instant tStart');
    checked++;
  }
  assert(checked > 60, 'vols comparés : ' + checked);
});

test('filet : balle basse dans le filet (reste de son côté), balle qui frôle la bande (passe ralentie), balle haute (passe)', () => {
  const H = P.COURT.netHeight;
  // Balle basse : arrêtée par le filet, retombe du côté du frappeur
  const low = P.simulate({ x: 5, y: 7, z: 0.5, vx: 0, vy: 12, vz: 0.5 }, { court: 'full' });
  assert(low.contacts[0].type === 'net' && low.contacts[0].side === 0, 'dans le filet');
  assert(low.contacts.filter((c) => c.type === 'floor').every((c) => c.pos.y < 10), 'retombe du côté du frappeur');
  assert(!low.crossings.length, 'ne passe pas');
  // Frôle la bande : passe, plus lente
  const zAtNet = H + 0.015;
  const cord = P.simulate({ x: 5, y: 7, z: zAtNet, vx: 0, vy: 15, vz: 0 }, { court: 'full', params: { g: 1e-9 } });
  const c = cord.contacts.find((k) => k.type === 'cord');
  assert(c && cord.crossings[0].cord, 'bande');
  assert(c.vOut.vy < 0.5 * c.vIn.vy + 1e-9 && c.vOut.vy > 0 && c.vOut.vz > 0, 'passe ralentie, petit rebond vers le haut');
  // Balle haute : aucun contact avec le filet
  const high = P.simulate({ x: 5, y: 7, z: 1.5, vx: 0, vy: 15, vz: 2 }, { court: 'full' });
  assert(!high.contacts.some((k) => k.type === 'net' || k.type === 'cord') && high.crossings.length === 1, 'passe au-dessus');
  assert(high.contacts[0].type === 'floor' && high.contacts[0].side === 1, 'premier rebond chez l’adversaire');
  // Vitres adverses : contact backFar, sur vitre ou grillage selon la hauteur
  const deep = P.simulate({ x: 5, y: 12, z: 1, vx: 0, vy: 20, vz: 2 }, { court: 'full' });
  const back = deep.contacts.find((k) => k.type === 'backFar');
  assert(back && Math.abs(back.pos.y - (20 - P.DEFAULT_PARAMS.radius)) < 1e-9, 'vitre de fond adverse');
  assert(P.onGlass({ type: 'right', pos: { x: 10, y: 18, z: 2.5 } }) && !P.onGlass({ type: 'right', pos: { x: 10, y: 13, z: 1 } }), 'vitres latérales adverses');
});

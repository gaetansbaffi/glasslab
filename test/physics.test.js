/*
 * Glass Lab — tests.
 */
import { test, assert, near, section } from './harness.js';
import P from '../src/core/physics.js';
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
      // x et y sont linéaires : il suffit de vérifier les extrémités
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

test('la réflexion respecte l’angle d’incidence, à la perte de vitesse près', () => {
  const { eWall, wallTangent } = P.DEFAULT_PARAMS;
  let checked = 0;
  for (const init of randomLaunches(300, 3)) {
    const sim = P.simulate(init, { maxFloorBounces: 3 });
    for (const c of sim.contacts) {
      if (c.type === 'floor') continue;
      const { inDeg, outDeg } = P.wallAngles(c);
      // Avec des pertes normale (e) et tangentielle (k) : tan(sortie) = (k / e) · tan(incidence)
      const expected = (Math.atan((wallTangent / eWall) * Math.tan((inDeg * Math.PI) / 180)) * 180) / Math.PI;
      near(outDeg, expected, 1e-6, 'angle de sortie');
      // Composantes : normale inversée × e, tangentielle × k
      const n = c.type === 'back' ? 'vy' : 'vx';
      const t = c.type === 'back' ? 'vx' : 'vy';
      near(c.vOut[n], -eWall * c.vIn[n], 1e-9, 'composante normale');
      near(c.vOut[t], wallTangent * c.vIn[t], 1e-9, 'composante tangentielle');
      assert(Math.sign(c.vOut[t]) === Math.sign(c.vIn[t]) || c.vIn[t] === 0, 'la balle doit continuer dans le même sens le long de la paroi');
      checked++;
    }
  }
  assert(checked > 100, 'trop peu de contacts paroi testés : ' + checked);
});

test('sans pertes (e = 1, k = 1), angle de sortie = angle d’incidence', () => {
  const params = { eWall: 1, wallTangent: 1 };
  const sim = P.simulate({ x: 5, y: 5, z: 1.5, vx: 3, vy: -8, vz: 2 }, { params, maxFloorBounces: 2 });
  const c = sim.contacts.find((k) => k.type !== 'floor');
  const { inDeg, outDeg } = P.wallAngles(c);
  near(outDeg, inDeg, 1e-9);
});

test('rebond au sol : restitution 0,75', () => {
  const sim = P.simulate({ x: 5, y: 5, z: 2, vx: 0, vy: 0, vz: 0 }, { maxFloorBounces: 1 });
  const c = sim.contacts[0];
  near(c.vOut.vz, -0.75 * c.vIn.vz, 1e-9);
});

test('launchToBounce : le premier rebond tombe au point visé', () => {
  const init = P.launchToBounce({ x: 3, y: 10, z: 1.2 }, { x: 6, y: 2 }, 0.8);
  const sim = P.simulate(init, { maxFloorBounces: 1 });
  const c = sim.contacts[0];
  assert(c.type === 'floor');
  near(c.pos.x, 6, 1e-9);
  near(c.pos.y, 2, 1e-9);
  near(c.t, 0.8, 1e-9);
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

test('court complet : après le filet, la trajectoire est celle du demi-court historique', () => {
  let checked = 0;
  for (const init of fullLaunches(300, 77)) {
    if (init.y < 10 || init.vy >= 0) continue; // balles parties du camp adverse, vers le joueur
    const full = P.simulate(init, { court: 'full', maxFloorBounces: 2, tMax: 8 });
    const cross = full.crossings.find((c) => c.dir < 0);
    if (!cross || full.contacts.some((c) => c.t <= cross.t + 1e-12 && c.type !== 'cord')) continue;
    const at = P.stateAt(full, cross.t + 1e-9);
    const half = P.simulate(Object.assign({}, at, { y: Math.min(at.y, 10 - 1e-9) }), { maxFloorBounces: 2, tMax: 8 - cross.t });
    const fc = full.contacts.filter((c) => c.t > cross.t + 1e-9);
    for (let i = 0; i < half.contacts.length; i++) {
      assert(fc[i] && fc[i].type === half.contacts[i].type, 'séquence de contacts identique');
      near(fc[i].t - cross.t, half.contacts[i].t, 1e-6, 'instants identiques');
    }
    checked++;
  }
  assert(checked > 30, 'trajectoires comparées : ' + checked);
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

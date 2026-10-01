/*
 * Glass Lab — tests : corps du joueur (tête et corps séparés, yeux, cinématique inverse, raquette, squelette).
 */
import { test, assert, near, section } from './harness.js';
import B from '../src/core/body.js';
import G from '../src/core/geometry.js';
import P from '../src/core/physics.js';
import CFG from '../src/core/config.js';
import R from '../src/core/rally.js';
import Q from '../src/core/quality.js';
import { botInput } from './helpers.js';

section('Corps : tête, regard, bras et raquette');

const DEG = Math.PI / 180;
const DT = 1 / 120;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const V = CFG.view;
/** Champs de vision du jeu pour un écran donné (paysage de téléphone par défaut). */
const fovs = (aspect) => {
  const v = G.verticalFov(V.hFov, aspect, V.vFovMin, V.vFovMax);
  return { h: G.horizontalFov(v, aspect), v };
};

test('cou limité à ±80° ; le corps reste vers le filet tant que la balle est devant', () => {
  const rng = P.mulberry32(5);
  let look = B.createLook(0, 0);
  for (let i = 0; i < 3000; i++) {
    const target = { yaw: (rng() * 2 - 1) * Math.PI, pitch: (rng() * 2 - 1) * 1.2 };
    for (let k = 0; k < 8; k++) look = B.lookStep(look, target, DT);
    const neck = B.wrapAngle(look.gazeYaw - look.bodyYaw);
    assert(Math.abs(neck) <= B.LOOK.neckMax + 1e-9, 'cou : ' + (neck / DEG).toFixed(1) + '°');
    assert(Math.abs(B.wrapAngle(look.bodyYaw)) <= B.LOOK.bodyMax + 1e-9, 'corps trop tourné');
    assert(look.gazePitch >= B.LOOK.pitchMin - 1e-9 && look.gazePitch <= B.LOOK.pitchMax + 1e-9, 'tangage borné');
  }
  // Balle devant, jusqu'à 50° de côté : seule la tête tourne
  look = B.createLook(0, 0);
  for (const yaw of [0.3, -0.6, 50 * DEG, -50 * DEG]) {
    for (let k = 0; k < 240; k++) look = B.lookStep(look, { yaw, pitch: -0.2 }, DT);
    near(look.bodyYaw, 0, 1e-6, 'le corps reste orienté vers le filet');
    near(look.gazeYaw, yaw, 1e-3, 'la tête vise la balle');
  }
  // Aucun roulis possible : seulement lacet et tangage
  assert(Object.keys(look).sort().join() === 'bodyYaw,gazePitch,gazeYaw,neckYaw');
});

test('balle qui passe derrière : le corps pivote progressivement vers la vitre, puis revient', () => {
  let look = B.createLook(0, -0.2);
  let maxBodyStep = 0;
  let maxGazeStep = 0;
  // La balle tourne autour du joueur, de devant (0°) à derrière (178°) en 1,2 s
  for (let t = 0; t <= 1.2; t += DT) {
    const before = look;
    look = B.lookStep(look, { yaw: (178 * DEG * t) / 1.2, pitch: 0 }, DT);
    maxBodyStep = Math.max(maxBodyStep, Math.abs(B.wrapAngle(look.bodyYaw - before.bodyYaw)));
    maxGazeStep = Math.max(maxGazeStep, Math.abs(B.wrapAngle(look.gazeYaw - before.gazeYaw)));
  }
  for (let k = 0; k < 60; k++) look = B.lookStep(look, { yaw: 178 * DEG, pitch: 0 }, DT);
  assert(look.bodyYaw > 90 * DEG, 'le corps s’est retourné : ' + (look.bodyYaw / DEG).toFixed(0) + '°');
  near(look.gazeYaw, 178 * DEG, 2 * DEG, 'le regard atteint la balle derrière');
  assert(maxBodyStep <= B.LOOK.bodyMaxSpeed * DT + 1e-9 && maxGazeStep <= B.LOOK.headMaxSpeed * DT + 1e-9, 'rotations progressives (inertie, vitesse bornée)');
  // La balle passe de l'autre côté de l'axe (−178°) : pas de volte-face, on continue du même côté
  for (let k = 0; k < 30; k++) look = B.lookStep(look, { yaw: -178 * DEG, pitch: 0 }, DT);
  assert(look.bodyYaw > 90 * DEG, 'pas de volte-face par l’avant');
  // Elle revient devant : tête et corps reviennent vers le filet sans rester bloqués
  for (let k = 0; k < 240; k++) look = B.lookStep(look, { yaw: 0.1, pitch: -0.2 }, DT);
  near(look.bodyYaw, 0, 1e-3, 'corps revenu vers le filet');
  near(look.gazeYaw, 0.1, 1e-3, 'regard revenu');
  // Joueur du haut (IA) : repos vers le filet = lacet π
  let far = B.createLook(Math.PI, 0);
  for (let k = 0; k < 240; k++) far = B.lookStep(far, { yaw: Math.PI - 0.5, pitch: 0 }, DT, { restYaw: Math.PI });
  near(B.wrapAngle(far.bodyYaw - Math.PI), 0, 1e-6);
});

test('yeux à ≈ 1,65 m, au niveau de la tête et non derrière le joueur ; rotation autour du cou', () => {
  const pos = { x: 5, y: 3 };
  const flat = B.eyePosition(pos, B.createLook(0, 0), 0, 0);
  near(flat.z, 1.65, 0.005, 'hauteur des yeux');
  assert(flat.y > pos.y + 0.1, 'les yeux sont en avant du centre du corps, pas derrière');
  const rng = P.mulberry32(9);
  for (let i = 0; i < 200; i++) {
    const look = { bodyYaw: (rng() - 0.5) * 2, gazeYaw: (rng() - 0.5) * 6, gazePitch: (rng() - 0.6) * 1.8 };
    const e = B.eyePosition(pos, look, 0, 0);
    const pivot = B.neckPivot(pos, look.bodyYaw, 0, 0);
    near(dist(e, pivot), Math.hypot(B.BODY.eyeForward, B.BODY.eyeUp), 1e-9, 'les yeux tournent autour du pivot du cou');
  }
  // Collé à la vitre de fond, regard vers la vitre : les yeux restent dans le court
  const glass = B.eyePosition({ x: 5, y: 0.3 }, B.createLook(Math.PI, 0), 0, 0);
  assert(glass.y >= 0.12, 'yeux derrière la vitre');
  // Flexion : les yeux descendent
  assert(B.eyePosition(pos, B.createLook(0, 0), 1, 0).z < flat.z - 0.2);
});

test('cinématique inverse : longueurs conservées, cible atteinte, coude du côté du pôle, cible hors de portée', () => {
  const rng = P.mulberry32(21);
  const l1 = B.BODY.upperArm;
  const l2 = B.BODY.forearm;
  let reachable = 0;
  for (let i = 0; i < 500; i++) {
    const root = { x: rng() * 2, y: rng() * 2, z: 1 + rng() };
    const target = { x: root.x + (rng() - 0.5) * 1.1, y: root.y + (rng() - 0.5) * 1.1, z: root.z + (rng() - 0.5) * 1.1 };
    const pole = { x: rng() - 0.5, y: rng() - 0.5, z: -1 };
    const r = B.ik2(root, target, l1, l2, pole);
    near(dist(root, r.mid), l1, 1e-9, 'bras');
    near(dist(r.mid, r.end), l2, 1e-9, 'avant-bras');
    const d = dist(root, target);
    if (d < l1 + l2 - 1e-3 && d > Math.abs(l1 - l2) + 1e-3) {
      reachable++;
      assert(r.reached && dist(r.end, target) < 1e-9, 'cible atteignable non atteinte');
      // Coude du côté du pôle (composante perpendiculaire à l'axe)
      const u = { x: (target.x - root.x) / d, y: (target.y - root.y) / d, z: (target.z - root.z) / d };
      const m = { x: r.mid.x - root.x, y: r.mid.y - root.y, z: r.mid.z - root.z };
      const mu = m.x * u.x + m.y * u.y + m.z * u.z;
      const pu = pole.x * u.x + pole.y * u.y + pole.z * u.z;
      const perpDot = (m.x - u.x * mu) * (pole.x - u.x * pu) + (m.y - u.y * mu) * (pole.y - u.y * pu) + (m.z - u.z * mu) * (pole.z - u.z * pu);
      assert(perpDot >= -1e-9, 'coude du mauvais côté');
    } else if (d >= l1 + l2) {
      assert(!r.reached, 'hors de portée signalé');
      // Membre tendu dans la direction de la cible
      near(dist(root, r.end), l1 + l2, 1e-5);
    }
  }
  assert(reachable > 200, 'cibles atteignables testées : ' + reachable);
  const same = B.ik2({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, l1, l2, { x: 0, y: 0, z: -1 });
  assert(Number.isFinite(same.mid.x) && Number.isFinite(same.end.z), 'cible confondue avec l’épaule');
});

test('la main tient réellement la raquette (garde, préparation, coups), droitier et gaucher', () => {
  const pos = { x: 5, y: 3 };
  const sk = B.createSkeleton();
  for (const hand of [1, -1]) {
    for (const yaw of [0, 0.7, Math.PI]) {
      const poses = [{ mode: 'guard' }];
      for (const h of [0.15, 0.4, 0.9, 1.4, 1.9]) for (const side of [1, -1]) poses.push({ mode: 'prep', side, height: h, prep: 1, crouch: B.crouchFor(h) });
      for (const stroke of ['ground', 'volley', 'lob', 'overhead', 'serve']) for (let s = 0; s <= 1.0001; s += 0.1) poses.push({ mode: 'swing', stroke, side: hand, height: 1, swing: s });
      for (const o of poses) {
        const r = B.racketPose(Object.assign({ pos, bodyYaw: yaw, hand }, o));
        B.skeleton({ x: pos.x, y: pos.y, bodyYaw: yaw, hand, racket: r, crouch: o.crouch || 0 }, sk);
        const domHand = hand > 0 ? sk.handR : sk.handL;
        near(dist(domHand, sk.racket.grip), 0, 1e-12, 'prise dans la main');
        near(dist(sk.racket.grip, sk.racket.head), B.RACKET.headCenter, 1e-9, 'tamis à 30 cm de la prise');
        near(Math.hypot(sk.racket.dir.x, sk.racket.dir.y, sk.racket.dir.z), 1, 1e-9);
        assert(sk.racket.head.z > 0.05, 'raquette sous le sol');
      }
    }
  }
});

test('préparation : la tête de raquette matérialise la portée, du côté de la balle', () => {
  const pos = { x: 5, y: 3 };
  const sk = B.createSkeleton();
  for (const hand of [1, -1]) {
    for (const side of [1, -1]) {
      for (const h of [0.35, 0.7, 1.0, 1.4, 1.8]) {
        const c = B.crouchFor(h);
        const r = B.racketPose({ pos, bodyYaw: 0, hand, mode: 'prep', side, height: h, prep: 1, crouch: c });
        B.skeleton({ x: 5, y: 3, bodyYaw: 0, hand, racket: r, crouch: c, twist: B.twistFor('prep', side, 1) }, sk);
        const head = sk.racket.head;
        const lat = head.x - pos.x;
        assert(Math.sign(lat) === side, 'mauvais côté');
        // Distance latérale de la plage idéale de placement (bras + raquette)
        assert(Math.abs(lat) >= CFG.placement.lateral[0] - 0.05 && Math.abs(lat) <= CFG.placement.lateral[1] + 0.05, `portée ${lat.toFixed(2)} m (h = ${h})`);
        near(head.z, h + 0.05, 0.12, 'hauteur de la balle');
      }
    }
  }
  // Côté de balle avec hystérésis (repère du corps)
  assert(B.ballSide(1, pos, 0, { x: 4, y: 5 }) === -1, 'balle à gauche');
  assert(B.ballSide(-1, pos, 0, { x: 6, y: 5 }) === 1, 'balle à droite');
  assert(B.ballSide(1, pos, 0, { x: 4.9, y: 5 }) === 1, 'presque en face : on garde le côté');
  assert(B.ballSide(-1, pos, Math.PI, { x: 4, y: 1 }) === 1, 'corps tourné vers la vitre : gauche et droite inversées');
});

test('geste de frappe : le tamis passe par la balle au moment du contact, de l’arrière vers l’avant', () => {
  const pos = { x: 5, y: 3 };
  const aim = { x: 5.65, y: 3.3, z: 1.0 };
  const at = (s) => B.racketPose({ pos, bodyYaw: 0, hand: 1, mode: 'swing', stroke: 'ground', side: 1, height: aim.z, swing: s, aim });
  near(dist(at(B.CONTACT_AT).head, aim), 0, 1e-9, 'tamis sur la balle au contact');
  assert(at(0.25).head.y < pos.y && at(1).head.y > pos.y + 0.3, 'armé derrière puis accompagné devant');
  // Trajectoire continue (pas de saut entre deux images)
  let prev = at(0);
  for (let s = 0.01; s <= 1.0001; s += 0.01) {
    const cur = at(s);
    assert(dist(cur.head, prev.head) < 0.08, 'saut de raquette à s = ' + s.toFixed(2));
    prev = cur;
  }
  // Gaucher : geste symétrique
  const L = B.racketPose({ pos, bodyYaw: 0, hand: -1, mode: 'guard' });
  const Rr = B.racketPose({ pos, bodyYaw: 0, hand: 1, mode: 'guard' });
  near(L.head.x - pos.x, -(Rr.head.x - pos.x), 1e-12, 'garde du gaucher en miroir');
});

test('1re personne : la raquette en garde est visible en bas de l’écran, sans masquer le centre', () => {
  const pos = { x: 5, y: 3 };
  for (const aspect of [2.17, 1.78, 1.33, 0.5]) {
    const f = fovs(aspect);
    assert(f.v >= V.vFovMin - 1e-9, 'champ vertical ≥ 60°');
    if (aspect >= 1.7) assert(f.h >= 105 - 1e-9 && f.h <= 111, 'champ horizontal ≈ 105–110° en paysage : ' + f.h.toFixed(1));
    for (const hand of [1, -1]) {
      const look = B.createLook(0, V.basePitch);
      const eye = B.eyePosition(pos, look, 0, 0);
      const r = B.racketPose({ pos, bodyYaw: 0, hand, mode: 'guard' });
      // Haut du cadre visible…
      const top = { x: r.head.x + r.dir.x * 0.13, y: r.head.y + r.dir.y * 0.13, z: r.head.z + r.dir.z * 0.13 };
      assert(G.inView(eye, look.gazeYaw, look.gazePitch, top, f.h, f.v, 0.03), `haut de la raquette hors champ (rapport ${aspect})`);
      // … dans la moitié basse, du côté de la main, loin du centre de l'image
      const c = G.viewCoords(eye, look.gazeYaw, look.gazePitch, top);
      assert(c.y < 0 && Math.sign(c.x) === hand, 'en bas, du côté de la main');
      const tv = Math.tan((f.v * Math.PI) / 360);
      assert(c.y / c.z < -0.4 * tv, 'le tamis ne masque pas le centre du court');
    }
  }
});

test('squelette : proportions humaines, pieds au sol, genoux vers l’avant, foulée alternée', () => {
  const sk = B.createSkeleton();
  const base = { x: 5, y: 3, bodyYaw: 0, gazeYaw: 0, gazePitch: 0, hand: 1 };
  B.skeleton(base, sk);
  assert(sk.head.z > sk.chest.z && sk.chest.z > sk.pelvis.z && sk.pelvis.z > sk.kneeL.z && sk.kneeL.z > sk.ankleL.z, 'empilement vertical');
  near(sk.head.z + B.BODY.headRadius, 1.75, 0.07, 'taille ≈ 1,75–1,80 m');
  for (const side of ['L', 'R']) {
    near(dist(sk['hip' + side], sk['knee' + side]), B.BODY.thigh, 1e-9, 'cuisse');
    near(dist(sk['knee' + side], sk['ankle' + side]), B.BODY.shin, 1e-9, 'tibia');
    near(dist(sk['shoulder' + side], sk['elbow' + side]), B.BODY.upperArm, 1e-9, 'bras');
    assert(sk['toe' + side].z >= 0.02 && sk['ankle' + side].z >= 0.05, 'pieds au sol');
    assert(sk['knee' + side].y > (sk['hip' + side].y + sk['ankle' + side].y) / 2 - 1e-9, 'genou vers l’avant');
  }
  near(sk.shoulderR.x - sk.shoulderL.x, 2 * B.BODY.shoulderHalf, 1e-9, 'largeur d’épaules');
  // Course : pieds en opposition de phase, le pied qui avance est levé
  let opposite = 0;
  let lifted = 0;
  for (let gait = 0; gait < 3; gait += 0.05) {
    B.skeleton(Object.assign({}, base, { vx: 0, vy: 4, gait }), sk);
    const dl = sk.ankleL.y - 3;
    const dr = sk.ankleR.y - 3;
    if (Math.abs(dl) > 0.08 && Math.abs(dr) > 0.08 && Math.sign(dl) !== Math.sign(dr)) opposite++;
    if (Math.max(sk.ankleL.z, sk.ankleR.z) > B.BODY.ankleHeight + 0.05) lifted++;
  }
  assert(opposite > 20 && lifted > 20, `foulée : ${opposite} positions opposées, ${lifted} pieds levés`);
  // Flexion : bassin plus bas
  const pz = B.skeleton(base, sk).pelvis.z;
  assert(B.skeleton(Object.assign({}, base, { crouch: 1 }), sk).pelvis.z < pz - 0.25);
});

test('la balle reste visible au moment de frapper (regard qui suit la balle, champ du jeu)', () => {
  // Joueur parfait sur de vraies balles : la tête suit la balle avec gazeTarget + lookStep
  const f = fovs(2.17);
  let checked = 0;
  let visible = 0;
  for (let seed = 1; seed <= 120; seed++) {
    let st = R.createRally({ seed: 9000 + seed * 13 });
    let look = B.createLook(0, V.basePitch);
    const shot = st.shot;
    const best = shot.best.best;
    for (let i = 0; i < 800 && st.phase === 'incoming'; i++) {
      const ball = R.ballPosition(st);
      const ahead = Q.ballStateAt(shot, Math.min(st.t + V.anticipation, shot.endT));
      const eye = B.eyePosition(st.player, look, 0, 0);
      look = B.lookStep(look, B.gazeTarget(look, eye, ball, st.player, Object.assign({ idle: { x: 5, y: 12, z: 1 } }, V), ahead), DT);
      if (st.t <= best.t && st.t + DT > best.t) {
        checked++;
        if (G.inView(B.eyePosition(st.player, look, 0, 0), look.gazeYaw, look.gazePitch, ball, f.h, f.v, 0.05)) visible++;
      }
      st = R.step(st, DT, botInput(st, DT));
    }
  }
  assert(checked >= 100, 'contacts observés : ' + checked);
  assert(visible === checked, `balle hors champ au contact : ${checked - visible} / ${checked}`);
});

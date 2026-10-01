/*
 * Glass Lab — tests : déplacement des joueurs (accélération, freinage, réaction, split-step).
 */
import { test, assert, near, section } from './harness.js';
import PL from '../src/core/players.js';
import CFG from '../src/core/config.js';

section('Déplacements des joueurs');

const P = CFG.player;
const AI = CFG.ai;
const DT = 1 / 120;

/** Course en ligne droite vers un point situé à d mètres, jusqu'à l'arrêt : durée (s) et état final. */
function runTo(d, p) {
  let m = { x: 0, y: 0, vx: 0, vy: 0 };
  let t = 0;
  for (; t < 6; t += DT) {
    m = PL.stepVelocity(m, PL.arriveVelocity(m, { x: d, y: 0 }, p, DT), DT, p);
    if (Math.abs(m.x - d) < 0.05 && Math.hypot(m.vx, m.vy) < 0.3) break;
  }
  return { t, m };
}

test('accélération réaliste : ≈ 0,5 s pour atteindre la pleine vitesse, jamais au-delà de la vitesse max', () => {
  let m = { x: 5, y: 3, vx: 0, vy: 0 };
  const want = PL.inputVelocity({ x: 0, y: 1 }, P);
  let t = 0;
  let maxStep = 0;
  for (; m.vy < P.speed - 1e-9 && t < 2; t += DT) {
    const before = m.vy;
    m = PL.stepVelocity(m, want, DT, P);
    maxStep = Math.max(maxStep, m.vy - before);
    assert(Math.hypot(m.vx, m.vy) <= P.speed + 1e-9, 'vitesse max dépassée');
  }
  assert(t > 0.35 && t < 0.7, 'temps pour atteindre la pleine vitesse : ' + t.toFixed(3));
  near(maxStep, P.accel * DT, 1e-9, 'variation de vitesse bornée par pas');
  // Le temps de jeu ne rend pas l'accélération instantanée : un seul pas ne suffit jamais
  const one = PL.stepVelocity({ x: 0, y: 0, vx: 0, vy: 0 }, want, DT, P);
  assert(one.vy < 0.2 * P.speed, 'départ arrêté : pas de pleine vitesse instantanée');
});

test('freinage plus vif que l’accélération ; demi-tour = freiner puis repartir', () => {
  let m = { x: 5, y: 3, vx: 0, vy: P.speed };
  let t = 0;
  for (; m.vy > 1e-6 && t < 2; t += DT) m = PL.stepVelocity(m, { x: 0, y: 0 }, DT, P);
  near(t, P.speed / P.decel, 2 * DT, 'durée de freinage');
  assert(P.speed / P.decel < P.speed / P.accel, 'on s’arrête plus vite qu’on ne démarre');
  // Demi-tour : la vitesse passe par zéro sans à-coup
  m = { x: 5, y: 3, vx: 0, vy: P.speed };
  const back = PL.inputVelocity({ x: 0, y: -1 }, P);
  let prev = m.vy;
  for (let i = 0; i < 200; i++) {
    m = PL.stepVelocity(m, back, DT, P);
    assert(Math.abs(m.vy - prev) <= Math.max(P.accel, P.decel) * DT + 1e-9, 'à-coup de vitesse');
    prev = m.vy;
  }
  near(m.vy, -P.speed, 1e-6, 'repart à pleine vitesse dans l’autre sens');
});

test('parois : le joueur s’arrête contre les bornes, la composante de vitesse vers la paroi est annulée', () => {
  const B = P.bounds;
  let m = { x: B.xMax - 0.05, y: 3, vx: P.speed, vy: 1 };
  m = PL.stepVelocity(m, { x: P.speed, y: 1 }, 0.1, P, B);
  assert(m.x === B.xMax && m.vx === 0 && m.vy > 0, JSON.stringify(m));
});

test('temps de trajet : croissant, cohérent avec la course simulée, ancien modèle sans accélération', () => {
  let prev = 0;
  for (const d of [0.25, 0.5, 1, 2, 3, 4, 6, 9]) {
    const tt = PL.travelTime(d, P);
    assert(tt > prev, 'croissant');
    prev = tt;
    const run = runTo(d, P);
    assert(run.t >= tt - 0.05 && run.t <= tt * 1.08 + 0.05, `d = ${d} : simulé ${run.t.toFixed(3)} s, estimé ${tt.toFixed(3)} s`);
  }
  near(PL.travelTime(3, { speed: 4 }), 0.75, 1e-12, 'sans accélération : d / v');
  near(PL.travelTime(0, P), 0, 0);
  // Plus lent que l'ancien modèle instantané à 4 m/s sur les courtes distances
  assert(PL.travelTime(1, P) > 1 / 4);
});

test('comportement « arrivée » : l’IA rejoint sa cible et s’y arrête sans la dépasser', () => {
  for (const d of [0.4, 1.5, 4, 7]) {
    let m = { x: 2, y: 2, vx: 0, vy: 0 };
    const target = { x: 2 + d * 0.6, y: 2 + d * 0.8 };
    let overshoot = 0;
    for (let t = 0; t < 4; t += DT) {
      m = PL.stepVelocity(m, PL.arriveVelocity(m, target, AI, DT), DT, AI);
      const along = ((m.x - 2) * 0.6 + (m.y - 2) * 0.8) - d;
      overshoot = Math.max(overshoot, along);
    }
    assert(overshoot < 0.03, `dépassement de ${overshoot.toFixed(3)} m pour ${d} m`);
    assert(Math.hypot(m.x - target.x, m.y - target.y) < 0.02 && Math.hypot(m.vx, m.vy) < 0.05, 'arrêté sur la cible');
  }
});

test('réaction et split-step : l’agent freine pendant sa réaction, puis court ; petit saut puis flexion', () => {
  let a = PL.createAgent({ x: 5, y: 17 });
  a = PL.setTarget(a, { x: 8, y: 17 });
  for (let t = 0; t < 0.3; t += DT) a = PL.stepAgent(a, t + DT, DT, AI);
  assert(a.vx > 1, 'en mouvement avant la frappe adverse');
  const tHit = 0.3;
  a = PL.splitStep(a, tHit, AI);
  a = PL.setTarget(a, { x: 2, y: 17 }); // la balle part de l'autre côté
  let t = tHit;
  for (; t + DT < tHit + AI.reaction; t += DT) {
    const before = a.vx;
    a = PL.stepAgent(a, t + DT, DT, AI);
    assert(a.vx <= before + 1e-9 && a.vx >= 0, 'aucune accélération pendant la réaction');
  }
  const speedAtReaction = a.vx;
  for (let k = 0; k < 240; k++, t += DT) a = PL.stepAgent(a, t + DT, DT, AI);
  assert(Math.abs(speedAtReaction) < 0.05, 'à l’arrêt à la fin du split-step : ' + speedAtReaction);
  assert(Math.abs(a.x - 2) < 0.05, 'cible atteinte après la réaction : x = ' + a.x.toFixed(2));
  assert(a.dist > 3, 'distance cumulée (foulée)');
  // Saut : positif pendant le split-step, négatif à la réception, nul ensuite
  assert(PL.splitHop(a, tHit + AI.splitDuration * 0.5, AI) > 0.8 * AI.hop);
  assert(PL.splitHop(a, tHit + AI.splitDuration * 1.3, AI) < 0);
  near(PL.splitHop(a, tHit + 1, AI), 0, 0);
  near(PL.reachTime({ x: 0, y: 0 }, { x: 3, y: 4 }, AI), AI.reaction + PL.travelTime(5, AI), 1e-12);
});

/*
 * Glass Lab — tests : partie en double à 4 joueurs (match.js).
 */
import { test, assert, near, section } from './harness.js';
import M from '../src/core/match.js';
import F from '../src/core/flight.js';
import Q from '../src/core/quality.js';
import SG from '../src/core/shotgen.js';
import PL from '../src/core/players.js';
import CFG from '../src/core/config.js';

section('Partie en double (4 joueurs)');

const DT = 1 / 120;

/** Joueur parfait : va au meilleur point (avec inertie) et frappe au bon moment. */
function perfect(st) {
  const u = M.userShot(st);
  if (!u || u.pending) return {};
  const best = u.shot.best.best;
  const v = PL.arriveVelocity(st.players[0], best.pos, CFG.player, DT);
  return { move: { x: v.x / CFG.player.speed, y: v.y / CFG.player.speed }, strike: u.t + DT >= best.t && u.t < best.t + DT };
}

/**
 * Fait jouer la partie `seconds` secondes. onStep(prev, st) est appelé à chaque pas.
 * Retourne { st, events } (chaque événement porte l'horloge `at`).
 */
function play(seed, seconds, bot, onStep, opts) {
  let st = M.createMatch(Object.assign({ seed, level: 3 }, opts || {}));
  const events = [];
  for (let i = 0; i < seconds / DT; i++) {
    const prev = st;
    st = M.step(st, DT, bot ? bot(st) : {});
    for (const e of st.events) events.push(Object.assign({ at: st.clock }, e));
    if (onStep) onStep(prev, st);
  }
  return { st, events };
}

test('1 appui : la première balle arrive seule, frappée par un adversaire, vers ton équipe', () => {
  const { st, events } = play(11, 2.5, null);
  const feed = events.find((e) => e.type === 'feed');
  const hit = events.find((e) => e.type === 'hit');
  assert(feed && hit && hit.team === 1 && hit.at < 1.2, 'mise en jeu adverse en moins de 1,2 s');
  assert(st.flight && st.flight.cross != null && st.flight.recv === 0, 'la balle passe le filet vers toi');
  assert(events.some((e) => e.type === 'userBall') || (st.recv && st.recv.player === 1), 'quelqu’un de ton équipe la prend');
});

test('même graine → même partie (déterminisme), graine différente → partie différente', () => {
  const sig = (seed) => play(seed, 40, perfect).events.map((e) => [e.type, e.by, e.style, e.winner, e.at.toFixed(4)].join(':')).join('|');
  const a = sig(5);
  assert(a === sig(5), 'parties différentes');
  assert(a !== sig(6), 'graines différentes, même partie');
  assert(a.split('|').length > 30, 'trop peu d’événements');
});

test('partie orientée entraînement : ≈ 65 % des balles adverses vers toi, de ton côté du court', () => {
  let toUser = 0;
  let toPartner = 0;
  let central = 0;
  for (const seed of [1, 2, 3, 4]) {
    play(seed, 150, perfect, (prev, st) => {
      for (const e of st.events) {
        if (e.type === 'hit' && e.team === 1 && !st.flight.error) {
          if (st.flight.target === 0) toUser++;
          else toPartner++;
        }
        if (e.type === 'userBall') {
          const d = Q.ballStateAt(st.recv.user.shot, 0);
          const first = st.recv.user.shot.sim.contacts[0];
          assert(first.pos.x >= 5 - CFG.tactics.centerBand - 1e-9 || e.central, `balle attribuée hors de ton côté : x = ${first.pos.x.toFixed(2)}`);
          if (e.central) central++;
          assert(d && SG.FAMILY_IDS.includes(e.family), 'famille inconnue : ' + e.family);
        }
      }
    });
  }
  const share = toUser / (toUser + toPartner);
  assert(toUser + toPartner > 100, 'balles adverses : ' + (toUser + toPartner));
  assert(share > 0.55 && share < 0.78, 'part des balles vers toi : ' + share.toFixed(2));
});

test('les IA courent avec inertie, arrivent à temps et ne frappent que des balles légales', () => {
  let hits = 0;
  let close = 0;
  for (const seed of [21, 22]) {
    play(seed, 150, perfect, (prev, st) => {
      for (let i = 1; i < 4; i++) {
        const a = prev.players[i];
        const b = st.players[i];
        assert(Math.hypot(b.vx, b.vy) <= CFG.ai.speed + 1e-9, 'vitesse IA');
        assert(Math.hypot(b.vx - a.vx, b.vy - a.vy) <= Math.max(CFG.ai.accel, CFG.ai.decel) * DT + 1e-9, 'accélération IA instantanée');
        const team = M.ROSTER[i].team;
        assert(team === 0 ? b.y <= 10 : b.y >= 10, 'IA de l’autre côté du filet');
      }
      for (const e of st.events) {
        if (e.type !== 'hit' || e.by === 0 || !prev.recv || !prev.recv.plan) continue;
        hits++;
        const plan = prev.recv.plan;
        const p = st.players[e.by];
        if (Math.hypot(p.x - plan.pos.x, p.y - plan.pos.y) < 0.7) close++;
        // Contact : après le filet, avant le deuxième rebond, à une hauteur jouable
        const f = prev.flight;
        const tShot = plan.tau - f.cross;
        const b = Q.ballStateAt(f.shot, tShot);
        assert(tShot >= 0 && b.floorBounces < 2, 'balle jouée avant le filet ou après le deuxième rebond');
        const zone = plan.type === 'overhead' ? CFG.overhead : CFG.zones[plan.type];
        assert(b.z >= zone.zMin - 1e-6 && b.z <= zone.zMax + 1e-6, `hauteur de contact ${b.z.toFixed(2)} (${plan.type})`);
      }
    });
  }
  assert(hits > 60, 'frappes IA : ' + hits);
  assert(close / hits > 0.95, `IA à leur point de frappe : ${close}/${hits}`);
});

test('positions : équipes au fond ou au filet selon leur mode, partenaires alignés', () => {
  let samples = 0;
  let aligned = 0;
  let placed = 0;
  let modeSamples = 0;
  const since = [0, 0];
  let lastModes = null;
  play(31, 180, perfect, (prev, st) => {
    if (!lastModes || st.modes[1] !== lastModes[1]) since[1] = st.clock;
    lastModes = st.modes;
    if (st.phase !== 'live' || Math.round(st.clock * 120) % 12) return;
    const a = M.toTeam(1, st.players[2]);
    const b = M.toTeam(1, st.players[3]);
    const busy = st.recv && (st.recv.player === 2 || st.recv.player === 3);
    if (!busy) {
      samples++;
      if (Math.abs(a.y - b.y) < 1.2) aligned++;
      if (st.clock - since[1] > 1.6) {
        modeSamples++;
        const want = st.modes[1] === 'attack' ? CFG.tactics.attackY : CFG.tactics.defenseY;
        if (Math.abs((a.y + b.y) / 2 - want) < 1.0) placed++;
      }
      assert(a.x > b.x - 0.5, 'chacun de son côté (repère de l’équipe)');
    }
  });
  assert(samples > 300, 'échantillons : ' + samples);
  assert(aligned / samples > 0.85, `alignés ${aligned}/${samples}`);
  assert(placed / modeSamples > 0.8, `à leur place (attaque / défense) ${placed}/${modeSamples}`);
});

test('points : tes erreurs donnent le point aux adversaires, leurs fautes te le donnent ; nouveau point ensuite', () => {
  const lazy = play(41, 60, null).events;
  const pts = lazy.filter((e) => e.type === 'point');
  assert(pts.length >= 4, 'points : ' + pts.length);
  for (const p of pts) assert(p.winner === 1 || p.reason !== 'userMiss', 'ta balle perdue = point adverse');
  assert(lazy.some((e) => e.type === 'userMiss' && e.result.reason === 'notReached'), 'balle non jouée');
  const good = play(42, 150, perfect).events;
  const won = good.filter((e) => e.type === 'point' && e.winner === 0);
  assert(won.length >= 2 && won.some((e) => e.reason === 'net' || e.reason === 'out'), 'fautes adverses');
  for (const e of good.filter((x) => x.type === 'point')) {
    if (e.reason === 'net' || e.reason === 'out') assert(e.winner !== (e.by >= 2 ? 1 : 0), 'une faute donne le point à l’autre équipe');
    assert(good.some((x) => x.type === 'feed' && x.at > e.at && x.at - e.at < 2.5) || e.at > 145, 'nouveau point après la pause');
  }
});

test('continuité : la balle ne saute jamais, ni aux frappes ni aux fautes', () => {
  let checked = 0;
  play(51, 120, perfect, (prev, st) => {
    const a = M.ballPosition(prev);
    const b = M.ballPosition(st);
    if (!a || !b || st.events.some((e) => e.type === 'feed')) return;
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    assert(d < 0.45, `saut de balle de ${d.toFixed(2)} m à t = ${st.clock.toFixed(2)}`);
    checked++;
  });
  assert(checked > 10000);
});

test('vitesses dans les ordres de grandeur du brief (fond, volée, lob haut, smash)', () => {
  const by = {};
  for (const seed of [61, 62, 63]) {
    play(seed, 150, perfect, (prev, st) => {
      for (const e of st.events) {
        if (e.type !== 'hit' || st.flight.error) continue;
        const kmh = F.launchKmh(st.flight);
        (by[e.style] = by[e.style] || []).push({ kmh, apex: F.apex(st.flight) });
      }
    });
  }
  for (const style in by) {
    const r = CFG.styles[style].kmh;
    for (const x of by[style]) assert(x.kmh >= r[0] - 1e-6 && x.kmh <= r[1] + 1e-6, `${style} à ${x.kmh.toFixed(0)} km/h`);
  }
  assert(by.drive && by.lob && by.drive.length > 20 && by.lob.length > 10, 'coups observés : ' + Object.keys(by).join(', '));
  for (const x of by.lob) assert(x.apex >= 4.5 && x.apex <= 8.6, 'lob très haut : ' + x.apex.toFixed(1));
  // Ordres de grandeur du tableau du brief
  const within = (list, lo, hi) => list.every((x) => x.kmh >= lo && x.kmh <= hi);
  assert(within(by.drive, 35, 75) && within(by.lob, 28, 52), 'fond et lob');
  if (by.volley) assert(within(by.volley, 45, 85), 'volée');
  if (by.smash) assert(within(by.smash, 78, 130), 'smash');
});

test('tes balles : résultat complet (famille, type, qualité, meilleur choix, contexte du double)', () => {
  const { events } = play(71, 90, perfect);
  const hits = events.filter((e) => e.type === 'userHit');
  assert(hits.length >= 10, 'frappes : ' + hits.length);
  for (const { result: r } of hits) {
    assert(SG.FAMILY_IDS.includes(r.family) && Q.SHOT_TYPES.includes(r.type) && Q.SHOT_TYPES.includes(r.bestType));
    assert(r.quality >= CFG.quality.minReturn && r.quality <= 1 && typeof r.decisionOk === 'boolean');
    assert(r.doubles && typeof r.doubles.aligned === 'boolean' && r.doubles.partnerGap >= 0, 'contexte du double');
  }
  const fb = Q.feedback(hits[0].result, 'Vitre de fond');
  assert(/Volée|Demi-volée|Avant vitre|Après vitre/.test(fb.text), fb.text);
});

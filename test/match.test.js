/*
 * Glass Lab — tests : partie en double à 4 joueurs (match.js).
 */
import { test, assert, section } from './harness.js';
import M from '../src/core/match.js';
import F from '../src/core/flight.js';
import Q from '../src/core/quality.js';
import SG from '../src/core/shotgen.js';
import PL from '../src/core/players.js';
import P from '../src/core/physics.js';
import CFG from '../src/core/config.js';

const P_RADIUS = P.DEFAULT_PARAMS.radius;

section('Partie en double (4 joueurs)');

const DT = 1 / 120;

/** Joueur parfait : va au meilleur point (avec inertie), frappe au bon moment, et sert quand c'est son tour. */
function perfect(st) {
  if (st.phase === 'serve' && st.serve.by === 0) return { strike: st.serve.hitAt == null };
  const u = M.userShot(st);
  if (!u || u.pending) return {};
  const best = u.shot.best.best;
  const v = PL.arriveVelocity(st.players[0], best.pos, CFG.player, DT);
  return { move: { x: v.x / CFG.player.speed, y: v.y / CFG.player.speed }, strike: u.t + DT >= best.t && u.t < best.t + DT };
}

/** Joueur humain imparfait : comme le joueur parfait, mais il laisse passer une balle sur quatre. */
function human(st) {
  const u = M.userShot(st);
  if (u && st.index % 4 === 0) return {};
  return perfect(st);
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

test('1 appui : le premier service arrive seul, d’un adversaire, et c’est toi qui reçois', () => {
  const { st, events } = play(11, 3, null);
  const hit = events.find((e) => e.type === 'hit');
  assert(hit && hit.team === 1 && hit.style === 'serve' && hit.at < 2.2, 'service adverse en moins de 2,2 s : ' + (hit && hit.at));
  assert(st.flight && st.flight.cross != null && st.flight.recv === 0, 'la balle passe le filet vers toi');
  assert(events.some((e) => e.type === 'userBall' && e.serve), 'premier point : c’est toi qui reçois');
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
      const placed = st.events.some((e) => e.type === 'serveSetup'); // mise en place : joueurs replacés
      for (let i = 1; i < 4 && !placed; i++) {
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
  let served = -10;
  play(31, 180, perfect, (prev, st) => {
    if (!lastModes || st.modes[1] !== lastModes[1]) since[1] = st.clock;
    lastModes = st.modes;
    if (st.events.some((e) => e.type === 'hit' && e.style === 'serve')) served = st.clock;
    // Après le service, les joueurs regagnent leur côté : on observe le jeu établi
    if (st.phase !== 'live' || st.clock - served < 2.5 || Math.round(st.clock * 120) % 12) return;
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
    assert(good.some((x) => x.type === 'serveSetup' && x.at > e.at && x.at - e.at < 2.5) || e.at > 145, 'nouveau point après la pause');
  }
});

test('continuité : la balle ne saute jamais, ni aux frappes ni aux fautes', () => {
  let checked = 0;
  play(51, 120, perfect, (prev, st) => {
    const a = M.ballPosition(prev);
    const b = M.ballPosition(st);
    if (!a || !b || st.events.some((e) => e.type === 'serveSetup')) return; // mise en place du point suivant
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    assert(d < 0.45, `saut de balle de ${d.toFixed(2)} m à t = ${st.clock.toFixed(2)}`);
    checked++;
  });
  assert(checked > 10000);
});

test('calibrage du brief : vitesses de balle, lob très haut, déplacements, rythme des frappes', () => {
  // Joueurs : course 2–4 m/s, sprint 5–6 m/s, ≈ 0,5 s pour la pleine vitesse, réaction 0,2–0,3 s
  assert(CFG.player.speed >= 4 && CFG.player.speed <= 6 && CFG.ai.speed >= 5 && CFG.ai.speed <= 6, 'vitesses de course');
  for (const p of [CFG.player, CFG.ai]) assert(p.speed / p.accel >= 0.4 && p.speed / p.accel <= 0.65, 'temps pour la pleine vitesse');
  assert(CFG.player.reactionTime >= 0.2 && CFG.player.reactionTime <= 0.3 && CFG.ai.reaction >= 0.2 && CFG.ai.reaction <= 0.3, 'réaction');
  const by = {};
  const gaps = [];
  const netGaps = [];
  for (const seed of [61, 62, 63]) {
    let last = null;
    let modes = null;
    play(seed, 150, perfect, (prev, st) => {
      for (const e of st.events) {
        if (e.type === 'point') last = null;
        if (e.type !== 'hit') continue;
        if (last != null && e.style !== 'serve') {
          gaps.push(st.clock - last);
          if (modes[0] === 'attack' && modes[1] === 'attack') netGaps.push(st.clock - last);
        }
        last = st.clock;
        modes = st.modes;
        if (st.flight.error) continue;
        const kmh = F.launchKmh(st.flight);
        (by[e.style] = by[e.style] || []).push({ kmh, apex: F.apex(st.flight) });
      }
    });
  }
  // Temps entre deux frappes : ≈ 1 à 2 s, plus court au filet
  const sorted = gaps.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const netMean = netGaps.reduce((a, b) => a + b, 0) / Math.max(1, netGaps.length);
  assert(median >= 1.0 && median <= 2.0, 'temps médian entre frappes : ' + median.toFixed(2));
  assert(netGaps.length < 10 || netMean < median, `plus court au filet : ${netMean.toFixed(2)} s`);
  for (const style in by) {
    const r = CFG.styles[style].kmh;
    for (const x of by[style]) assert(x.kmh >= r[0] - 1e-6 && x.kmh <= r[1] + 1e-6, `${style} à ${x.kmh.toFixed(0)} km/h`);
  }
  assert(by.drive && by.lob && by.drive.length > 20 && by.lob.length > 10, 'coups observés : ' + Object.keys(by).join(', '));
  for (const x of by.lob) assert(x.apex >= 5 - 1e-6 && x.apex <= 8.6, 'lob très haut (5–8 m) : ' + x.apex.toFixed(1));
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

/* ---------- Service et score ---------- */

test('service : du fond, en diagonale, dans le carré, retour après le rebond ; le receveur suit le score', () => {
  let serves = 0;
  let checked = 0;
  play(81, 240, human, (prev, st) => {
    for (const e of st.events) {
      if (e.type === 'serveSetup') {
        const sv = st.serve;
        const p = M.toTeam(M.ROSTER[sv.by].team, st.players[sv.by]);
        assert(p.y < 3.05, 'le serveur est derrière la ligne de service');
        assert(sv.receiver === e.score.receiver && sv.by === e.score.server, 'serveur et receveur du score');
        // Diagonale : même côté dans le repère de chaque équipe
        const r = M.toTeam(M.ROSTER[sv.receiver].team, st.players[sv.receiver]);
        assert(Math.sign(p.x - 5) === Math.sign(r.x - 5), 'service en diagonale');
      }
      if (e.type === 'hit' && e.style === 'serve') {
        serves++;
        const f = st.flight;
        assert(f.serve && Math.abs(f.init.z - 0.6) < 0.05, 'frappe à la cuillère, après le rebond de la balle lâchée');
        if (f.serve.judge.type === 'ok') {
          checked++;
          const b = f.sim.contacts.find((c) => c.type === 'floor' && c.side === f.recv);
          const q = M.toTeam(f.recv, b.pos);
          const box = M.serviceBox(f.serve.side);
          assert(q.y >= 3.05 && q.y <= 10 && q.x >= box.x[0] - 0.25 && q.x <= box.x[1] + 0.25, 'rebond dans le carré');
          // Le receveur (IA) laisse rebondir
          if (st.recv && st.recv.plan && !st.recv.plan.chase) assert(st.recv.plan.type !== 'volley' && st.recv.plan.type !== 'overhead', 'retour de volée');
        }
      }
    }
  });
  assert(serves >= 8 && checked >= 6, `services : ${serves}, valides : ${checked}`);
});

test('ton service : il attend Frappe ; la balle est lâchée, rebondit, puis part', () => {
  // Ton équipe gagne des points jusqu'à ce que ce soit à toi de servir (2e jeu)
  let st = M.createMatch({ seed: 5, level: 3 });
  for (let k = 0; k < 12 && st.score.order[st.score.serveGame % 4] !== 0; k++) st = M.awardPoint(st, 0);
  assert(st.score.order[st.score.serveGame % 4] === 0 && st.score.games[0] === 1, 'à toi de servir');
  for (let i = 0; i < 400 && st.phase !== 'serve'; i++) st = M.step(st, DT, {});
  assert(st.phase === 'serve' && st.serve.by === 0, 'mise en place de ton service');
  for (let i = 0; i < 600; i++) st = M.step(st, DT, {});
  assert(st.phase === 'serve' && st.serve.hitAt == null, 'sans appui, pas de service');
  st = M.step(st, DT, { strike: true });
  const t0 = st.clock;
  let hit = null;
  let bounced = false;
  for (let i = 0; i < 200 && !hit; i++) {
    st = M.step(st, DT, {});
    const b = M.ballPosition(st);
    assert(b.z >= P_RADIUS - 1e-9, 'balle sous le sol');
    if (b.z < 0.05) bounced = true;
    hit = st.events.find((e) => e.type === 'hit' && e.by === 0);
  }
  assert(hit && bounced && Math.abs(st.clock - t0 - M.SERVE_DROP) < 0.02, 'service ≈ 0,8 s après l’appui, après un rebond');
  assert(st.flight.serve && st.flight.recv === 1, 'vers les adversaires');
});

test('fautes de service : deuxième service, double faute = point au receveur ; volée au retour = faute', () => {
  let faults = 0;
  let seconds = 0;
  // Serveurs IA plus fautifs que dans le jeu (8 % et 3,5 %) : le mécanisme est vérifié quel que soit le hasard
  const config = Object.assign({}, CFG, { serveFaults: [0.35, 0.25] });
  for (const seed of [91, 92, 93, 94]) {
    const { events } = play(seed, 200, human, null, { config });
    for (const e of events) {
      if (e.type === 'fault') faults++;
      if (e.type === 'serveSetup' && e.second) seconds++;
      if (e.type === 'point' && e.reason === 'doubleFault') assert(e.winner !== M.ROSTER[e.by].team, 'double faute : point au receveur');
    }
  }
  assert(faults >= 4 && seconds >= faults - 1, `fautes ${faults}, deuxièmes services ${seconds}`);
  // Volée au retour de service : on frappe avant le rebond
  let st = M.createMatch({ seed: 12, level: 3 });
  let missed = null;
  for (let i = 0; i < 600 && !missed; i++) {
    const u = M.userShot(st);
    let input = {};
    if (u && !u.pending && u.shot.sim.contacts[0]) {
      // Avance vers la balle pour la prendre de volée, frappe avant le rebond
      const b0 = u.shot.sim.contacts[0];
      const tb = b0.t - 0.12;
      const target = Q.ballStateAt(u.shot, tb);
      const v = PL.arriveVelocity(st.players[0], { x: target.x - 0.6, y: target.y - 0.2 }, CFG.player, DT);
      input = { move: { x: v.x / CFG.player.speed, y: v.y / CFG.player.speed }, strike: u.t + DT >= tb && u.t < tb + DT };
    }
    st = M.step(st, DT, input);
    missed = st.events.find((e) => e.type === 'userMiss' || e.type === 'userHit');
  }
  assert(missed && (missed.type === 'userMiss') && ['serveVolley', 'far', 'early', 'late'].includes(missed.result.reason), 'retour de volée refusé : ' + (missed && missed.result.reason));
});

test('score : points, jeux et sets avancent selon les règles ; le service tourne', () => {
  const { st, events } = play(101, 600, human);
  const points = events.filter((e) => e.type === 'point').length;
  const games = events.filter((e) => e.type === 'game').length;
  assert(points >= 12 && games >= 2, `points ${points}, jeux ${games}`);
  const g = st.score.games[0] + st.score.games[1] + 6 * (st.score.sets[0] + st.score.sets[1]);
  assert(g >= games - 1, 'jeux comptés');
  // Ordre des serveurs observé = ordre de score.js
  const servers = [];
  for (const e of events) if (e.type === 'serveSetup' && !e.second && (!servers.length || servers[servers.length - 1].game !== e.score.games.join('-') + e.score.sets.join('-'))) servers.push({ by: e.by, game: e.score.games.join('-') + e.score.sets.join('-') });
  const seq = servers.map((x) => x.by).join('');
  assert(seq.startsWith('2031'.slice(0, Math.min(4, seq.length))), 'rotation du service : ' + seq);
});

test('score avec avantage (config) : 40-40 puis avantage, jeu à deux points d’écart', () => {
  const cfg = Object.assign({}, CFG, { score: { golden: false } });
  let st = M.createMatch({ seed: 3, config: cfg });
  for (const t of [0, 0, 0, 1, 1, 1, 0]) st = M.awardPoint(st, t);
  const d = M.scoreDisplay(st);
  assert(d.points.join('-') === 'Av-40' && d.note === 'Avantage vous', JSON.stringify(d));
  st = M.awardPoint(st, 0);
  assert(st.score.games[0] === 1, 'jeu');
});

/*
 * Glass Lab — tests : tactique du double (positions, transitions, qui prend la balle, IA, ton renvoi).
 */
import { test, assert, near, section } from './harness.js';
import P from '../src/core/physics.js';
import CFG from '../src/core/config.js';
import T from '../src/core/tactics.js';
import SG from '../src/core/shotgen.js';
import PL from '../src/core/players.js';

section('Tactique du double');

const AI = CFG.ai;
const USER = Object.assign({ reaction: CFG.player.reactionTime }, CFG.player);

test('positions : défense au fond, attaque au filet, partenaires alignés, chacun son côté, la paire glisse vers la balle', () => {
  for (const mode of ['defense', 'attack']) {
    for (const ballX of [1, 3, 5, 7, 9]) {
      const r = T.formation(1, mode, ballX);
      const l = T.formation(-1, mode, ballX);
      near(r.y, l.y, 0, 'alignés');
      near(r.y, mode === 'attack' ? CFG.tactics.attackY : CFG.tactics.defenseY, 0);
      assert(r.x > l.x + 3, 'chacun son côté');
      near(r.x - l.x, 2 * (mode === 'attack' ? CFG.tactics.attackHalfWidth : CFG.tactics.halfWidth), 1e-9, 'écart constant');
    }
    assert(T.formation(1, mode, 9).x > T.formation(1, mode, 5).x && T.formation(-1, mode, 1).x < T.formation(-1, mode, 5).x, 'glisse vers la balle');
  }
  assert(T.formation(1, 'attack', 5).y - T.formation(1, 'defense', 5).y > 4, 'attaque nettement plus près du filet');
  // Le partenaire s'aligne sur toi si tu restes au fond pendant que l'équipe attaque
  const p = T.partnerSpot(-1, 'attack', 5, { x: 7, y: 2.5 });
  assert(Math.abs(p.y - 2.5) < 1, 'aligné sur toi : y = ' + p.y);
  near(T.partnerSpot(-1, 'attack', 5, { x: 7, y: 7 }).y, CFG.tactics.attackY, 0, 'ensemble au filet');
});

test('transitions : volée = attaque, lob profond = on monte et ils reculent, frappe du fond = défense', () => {
  const m = ['defense', 'defense'];
  assert(T.modesAfterHit(m, 0, { style: 'volley', hitterY: 7 })[0] === 'attack');
  const lob = T.modesAfterHit(['defense', 'attack'], 0, { style: 'lob', hitterY: 2, bounceY: 1.5 });
  assert(lob[0] === 'attack' && lob[1] === 'defense', 'lob passant : ' + lob);
  assert(T.modesAfterHit(['attack', 'defense'], 0, { style: 'drive', hitterY: 2.2 })[0] === 'defense', 'frappe du fond');
  assert(T.modesAfterHit(m, 1, { style: 'drive', hitterY: 4.8, shortBall: true })[1] === 'attack', 'balle courte jouée : on monte');
  assert(T.modesAfterHit(m, 0, { style: 'lob', hitterY: 2, bounceY: 6 })[1] === 'defense' && T.modesAfterHit(['attack', 'attack'], 0, { style: 'lob', hitterY: 2, bounceY: 6 })[1] === 'attack', 'lob court : pas de recul');
});

/** Balle de test reçue par l'équipe du bas : rebond en (x, y). */
function ballTo(x, y, seed) {
  // Une balle de fond ne peut pas rebondir juste derrière le filet : c'est alors une chiquita
  const style = y > 6.3 ? 'chiquita' : 'drive';
  const f = SG.generateTo({ origin: { x: 5, y: 17.5, z: 1 }, team: 1, style, zone: { x: [x - 0.05, x + 0.05], y: [y - 0.05, y + 0.05] }, level: 2, seed: seed || 3 });
  assert(f, 'balle de test');
  return f.shot;
}

test('qui prend la balle : celui de son côté ; au centre, le mieux placé, à égalité le coup droit', () => {
  const pair = (rx, lx, y, rh, lh) => [
    { side: 1, hand: rh || 1, pos: { x: rx, y } },
    { side: -1, hand: lh || 1, pos: { x: lx, y } },
  ];
  assert(T.whoTakes(pair(7.3, 2.7, 2.4), ballTo(8, 5), 'defense', [USER, AI]).index === 0, 'à droite');
  assert(T.whoTakes(pair(7.3, 2.7, 2.4), ballTo(2, 5), 'defense', [USER, AI]).index === 1, 'à gauche');
  // Au centre, à égale distance : le droitier de gauche (coup droit au centre) la prend
  const c = T.whoTakes(pair(7.3, 2.7, 2.4), ballTo(5, 5), 'defense', [AI, AI]);
  assert(c.central && c.index === 1, 'coup droit au centre');
  // Gaucher à droite : son coup droit est aussi au centre ; le mieux placé l'emporte
  assert(T.forehandToCenter(1, -1) && T.forehandToCenter(-1, 1) && !T.forehandToCenter(1, 1));
  const better = T.whoTakes(pair(5.6, 1.0, 2.4), ballTo(5.2, 5), 'defense', [AI, AI]);
  assert(better.index === 0, 'le mieux placé');
  // Au filet : on décide sur la volée (là où la balle croise la ligne des joueurs)
  const net = T.decisionPoint(ballTo(8, 2.5), 7.3, 'attack');
  assert(net && net.volley && net.y <= 7.6 + 1e-9, 'décision à la volée');
});

test('interception des IA : point atteignable (réaction + accélération), jamais avant le filet, préférences de jeu', () => {
  let n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const shot = ballTo(2 + (seed % 7), 1.5 + (seed % 5), seed);
    const from = { x: 3, y: 2.4 };
    const it = T.aiIntercept(shot, from, 'defense');
    if (!it) continue;
    n++;
    assert(it.t >= 0 && it.t >= shot.tStart + AI.reaction - 1e-9, 'avant la réaction ou avant le filet');
    const travel = PL.travelTime(Math.hypot(it.pos.x - from.x, it.pos.y - from.y), AI);
    assert(it.t - shot.tStart >= AI.reaction + travel - 1e-9, 'arrivée à temps');
    const zone = it.type === 'overhead' ? CFG.overhead : CFG.zones[it.type];
    assert(Math.hypot(it.ball.x - it.pos.x, it.ball.y - it.pos.y) <= zone.reach + 1e-9 && it.ball.z >= zone.zMin && it.ball.z <= zone.zMax, 'dans la zone de frappe');
    assert(it.ball.y <= 10 + 1e-9, 'balle passée');
  }
  assert(n >= 20, 'interceptions : ' + n);
  // Balle impossible à rattraper (IA très lente, à l'opposé) : null, mais elle court quand même vers la balle
  const far = ballTo(9.4, 8.6, 4);
  const slow = Object.assign({}, CFG, { ai: Object.assign({}, CFG.ai, { speed: 0.3 }) });
  assert(T.aiIntercept(far, { x: 0.6, y: 0.6 }, 'defense', slow) === null, 'hors d’atteinte');
  assert(T.aiIntercept(far, { x: 0.6, y: 0.6 }, 'defense') !== null, 'une vraie IA la rattrape (sortie de vitre)');
  assert(T.chaseSpot(far).x > 5, 'poursuite vers la balle');
});

test('coups des IA : smash seulement au filet, lob face à des joueurs au filet, hauteur de contact respectée', () => {
  const rng = P.mulberry32(8);
  const count = (o, n) => {
    const c = {};
    for (let i = 0; i < n; i++) {
      const s = T.chooseStyle(o, rng);
      c[s] = (c[s] || 0) + 1;
    }
    return c;
  };
  const net = count({ type: 'overhead', z: 2.5, y: 7.5, oppMode: 'defense', level: 4 }, 400);
  assert(net.smash > 40 && net.bandeja > 40 && net.vibora > 40, 'au filet : ' + JSON.stringify(net));
  const back = count({ type: 'overhead', z: 2.4, y: 3, oppMode: 'attack', level: 5 }, 400);
  assert(!back.smash, 'pas de smash du fond : ' + JSON.stringify(back));
  const defense = count({ type: 'afterGlass', z: 1.0, y: 1.5, oppMode: 'attack', level: 3 }, 400);
  const lobs = (defense.lob || 0) + (defense.lobShort || 0);
  assert(lobs > 80 && defense.lobShort > 15 && defense.lob > 30 && defense.chiquita > 60 && defense.defense > 80, 'défense face au filet : ' + JSON.stringify(defense));
  for (let i = 0; i < 300; i++) {
    const o = { type: ['volley', 'halfVolley', 'beforeGlass', 'afterGlass', 'overhead'][i % 5], z: 0.2 + (i % 13) * 0.22, y: 1 + (i % 9), oppMode: i % 2 ? 'attack' : 'defense', level: 1 + (i % 5) };
    const st = T.chooseStyle(o, rng);
    const c = CFG.styles[st].contact;
    assert(o.z >= c[0] - 1e-9 && o.z <= c[1] + 1e-9 || ['drive', 'volley', 'bandeja'].includes(st), `${st} joué à ${o.z.toFixed(2)} m`);
  }
});

test('fautes des IA : plus fréquentes sur une balle difficile, rares pour le partenaire, moins fréquentes au niveau 5', () => {
  const e = (o) => T.errorChance(Object.assign({ role: 'opponent', quality: 0.8, style: 'drive', level: 3 }, o));
  assert(e({ quality: 0.3 }) > e({ quality: 0.9 }), 'balle difficile');
  assert(e({ role: 'partner' }) < e({}), 'partenaire fiable');
  assert(e({ level: 5 }) < e({ level: 1 }), 'adversaires plus solides au niveau 5');
  assert(e({ style: 'smash' }) > e({ style: 'drive' }), 'coup risqué');
  for (let q = 0; q <= 1; q += 0.1) assert(e({ quality: q }) > 0 && e({ quality: q }) < 0.45);
});

test('ton renvoi : meilleure qualité = plus profond, lob du fond face au filet, volée au filet, vers le côté libre', () => {
  const rng = P.mulberry32(2);
  const depth = (q) => {
    let s = 0;
    for (let i = 0; i < 40; i++) {
      const r = T.userReturn({ quality: q, type: 'afterGlass', z: 1, y: 2, oppMode: 'defense', opponents: [{ x: 3, y: 2.4 }, { x: 7, y: 2.4 }] }, rng);
      s += (r.zone.y[0] + r.zone.y[1]) / 2;
    }
    return s / 40;
  };
  assert(depth(1) < depth(0.5) - 1 && depth(0.5) < depth(0.25), 'profondeur croissante');
  assert(T.userReturn({ quality: 0.8, type: 'afterGlass', z: 1, y: 2, oppMode: 'attack', opponents: [] }, rng).style === 'lob', 'lob');
  assert(T.userReturn({ quality: 0.4, type: 'afterGlass', z: 1, y: 2, oppMode: 'attack', opponents: [] }, rng).style === 'drive', 'lob raté = balle de fond');
  assert(T.userReturn({ quality: 0.8, type: 'volley', z: 1.2, y: 7.2, oppMode: 'defense', opponents: [] }, rng).style === 'volley', 'volée');
  // Vers le côté le moins couvert (adversaire seul à gauche du repère adverse)
  const r = T.userReturn({ quality: 0.95, type: 'afterGlass', z: 1, y: 2, oppMode: 'defense', opponents: [{ x: 2.5, y: 2.4 }, { x: 4.5, y: 2.4 }] }, rng);
  assert(r.zone.x[0] > 5, 'côté libre : ' + JSON.stringify(r.zone.x));
});

test('ton renvoi au-dessus de la tête : bandeja le plus souvent, víbora parfois, smash près du filet sur une balle haute bien frappée', () => {
  const rng = P.mulberry32(4);
  const c = {};
  for (let i = 0; i < 200; i++) {
    const r = T.userReturn({ quality: 0.7, type: 'overhead', z: 2.4, y: 4, oppMode: 'defense', opponents: [] }, rng, CFG);
    c[r.style] = (c[r.style] || 0) + 1;
  }
  assert(c.bandeja > 100 && c.vibora > 20 && !c.smash, JSON.stringify(c));
  const s = T.userReturn({ quality: 0.92, type: 'overhead', z: 2.7, y: 6.8, oppMode: 'defense', opponents: [] }, rng, CFG);
  assert(s.style === 'smash' && s.zone.y[0] >= CFG.styles.smash.depth[0], 'smash : ' + JSON.stringify(s));
});

/*
 * Glass Lab — tests : statistiques, répétition espacée, difficulté et migration du stockage.
 */
import { test, assert, near, section } from './harness.js';
import CFG from '../src/core/config.js';
import Stats from '../src/core/stats.js';
import SC from '../src/core/score.js';
import M from '../src/core/match.js';
import PL from '../src/core/players.js';

const DEFAULTS = { speed: 1, auto: false, showPath: false, showBest: true, sound: true, lefty: false };

section('Statistiques et stockage');

const ball = (o) =>
  Object.assign({ ts: 1, session: 1, family: 'B', outcome: 'hit', type: 'afterGlass', bestType: 'afterGlass', decisionOk: true, quality: 0.8, placementError: 0.2, level: 1, streak: 1 }, o);

test('enregistrement : par famille, précision de décision, résumé de session, meilleure série', () => {
  let st = Stats.createState(DEFAULTS);
  const before = st;
  st = Stats.recordBall(st, ball({}), CFG.difficulty).state;
  st = Stats.recordBall(st, ball({ bestType: 'halfVolley', decisionOk: false, quality: 0.4, placementError: 0.6, streak: 0 }), CFG.difficulty).state;
  st = Stats.recordBall(st, ball({ bestType: 'halfVolley', decisionOk: false, quality: 0.5, placementError: 0.4, streak: 0 }), CFG.difficulty).state;
  st = Stats.recordBall(st, ball({ outcome: 'miss', reason: 'late', type: undefined, quality: undefined, placementError: undefined, family: 'direct', session: 2, streak: 0 }), CFG.difficulty).state;
  assert(before.balls.length === 0, 'l’état d’origine n’est pas modifié');
  const fs = Stats.familyStats(st.balls);
  near(fs.B.rate, 1, 1e-12);
  near(fs.B.meanQuality, (0.8 + 0.4 + 0.5) / 3, 1e-12);
  near(fs.B.meanPlacementError, 0.4, 1e-12);
  near(fs.direct.rate, 0, 1e-12);
  const ds = Stats.decisionStats(st.balls);
  near(ds.accuracy, 1 / 3, 1e-12);
  assert(ds.byChosen.afterGlass.topBetter === 'halfVolley');
  near(ds.byChosen.afterGlass.topBetterRate, 2 / 3, 1e-12);
  const s1 = Stats.sessionSummary(st.balls, 1);
  assert(s1.balls === 3 && s1.returned === 3 && s1.bestStreak === 1);
  near(s1.meanQuality, (0.8 + 0.4 + 0.5) / 3, 1e-12);
  near(s1.decision, 1 / 3, 1e-12);
  near(st.bestStreak, 1, 0);
});

test('répétition espacée et difficulté adaptative (80 % / 50 %)', () => {
  const balls = [];
  for (let i = 0; i < 30; i++) for (const f of Stats.MATCH_FAMILIES) balls.push({ family: f, outcome: f === 'C' ? 'miss' : 'hit' });
  const w = Stats.familyWeights(balls);
  assert(w.C > 2 * w.A, JSON.stringify(w));
  const mk = (n, rate) => Array.from({ length: n }, (_, i) => ({ outcome: i < Math.round(n * rate) ? 'hit' : 'miss' }));
  const D = CFG.difficulty;
  near(Stats.nextLevel(mk(10, 0.9), 2, D), 3, 0);
  near(Stats.nextLevel(mk(10, 0.8), 2, D), 2, 0);
  near(Stats.nextLevel(mk(10, 0.6), 2, D), 2, 0);
  near(Stats.nextLevel(mk(10, 0.4), 2, D), 1, 0);
  near(Stats.nextLevel(mk(4, 0), 2, D), 2, 0, 'pas assez de balles');
  // Montée de niveau via recordBall
  let st = Stats.createState(DEFAULTS);
  let changed = 0;
  for (let i = 0; i < 10; i++) {
    const r = Stats.recordBall(st, ball({ ts: i, level: st.level }), D);
    st = r.state;
    changed += r.levelChange;
  }
  assert(st.level === 2 && changed === 1, 'niveau ' + st.level);
  // Les poids et le niveau sont bien utilisés par la partie : balles des adversaires vers toi
  const DT = 1 / 120;
  let m = M.createMatch({ seed: 5, weights: { direct: 0, A: 0, B: 0, C: 1, D: 0 }, level: 4 });
  const mine = [];
  for (let i = 0; i < 240 / DT && mine.length < 12; i++) {
    const u = M.userShot(m);
    let input = {};
    if (m.phase === 'serve' && m.serve.by === 0) input = { strike: m.serve.hitAt == null };
    else if (u && !u.pending) {
      const best = u.shot.best.best;
      const v = PL.arriveVelocity(m.players[0], best.pos, CFG.player, DT);
      input = { move: { x: v.x / CFG.player.speed, y: v.y / CFG.player.speed }, strike: u.t + DT >= best.t && u.t < best.t + DT };
    }
    const prev = m.flight;
    m = M.step(m, DT, input);
    if (m.flight && m.flight !== prev && m.flight.team === 1 && !m.flight.serve && m.recv && m.recv.player === 0) mine.push(m.flight);
  }
  assert(mine.length >= 8 && mine.every((f) => f.level === 4), 'niveau 4 : ' + mine.map((f) => f.level).join(','));
  const c = mine.filter((f) => f.shot.family === 'C').length;
  assert(c >= mine.length * 0.5, `famille C demandée : ${c} / ${mine.length}`);
});

test('migration : version 1 (application multi-modes) → version 2, données inutiles abandonnées', () => {
  const v1 = {
    version: 1,
    attempts: [{ ts: 1, mode: 'lecture', family: 'A', success: true }],
    levels: { lecture: 3, match: 4 },
    levelSince: { lecture: 0 },
    settings: { reveal: true, view: '3d', match: { speed: 0.75, auto: true, showPath: 'oui', showBest: false } },
    match: { balls: [ball({ ts: 5 }), ball({ ts: 6, family: 'Z' }), { pas: 'une balle' }], bestStreak: 7, levelSince: 1 },
  };
  const r = Stats.migrate(v1, DEFAULTS);
  assert(r.from === 1);
  const s = r.state;
  assert(s.version === Stats.SCHEMA_VERSION && s.level === 4 && s.bestStreak === 7);
  assert(s.balls.length === 1 && s.balls[0].ts === 5, 'balles invalides ignorées');
  assert(s.settings.speed === 0.75 && s.settings.auto === true && s.settings.showBest === false, 'réglages repris');
  assert(s.settings.showPath === false, 'réglage de mauvais type ignoré');
  assert(s.settings.sound === true && s.settings.lefty === false, 'nouveaux réglages par défaut');
  assert(!('attempts' in s) && !('reveal' in s.settings) && !('view' in s.settings), 'données des modes retirés abandonnées');
});

test('migration : version 2 (duel) → version 3, réglages supprimés abandonnés, bilan des parties initialisé', () => {
  const v2 = {
    version: 2,
    level: 3,
    levelSince: 1,
    bestStreak: 9,
    guideDone: true,
    settings: { speed: 0.5, camera: 'shoulder', fov: 110, sound: false, lefty: true, vibration: false },
    balls: [ball({ ts: 7 }), ball({ ts: 8, family: 'A' }), { cassé: true }],
  };
  const r = Stats.migrate(v2, { sound: true, lefty: false });
  assert(r.from === 2 && r.state.version === 3 && Stats.SCHEMA_VERSION === 3);
  const s = r.state;
  assert(s.level === 3 && s.bestStreak === 9 && s.guideDone && s.balls.length === 2, 'progression conservée');
  assert(JSON.stringify(s.settings) === JSON.stringify({ sound: false, lefty: true }), 'réglages : ' + JSON.stringify(s.settings));
  assert(JSON.stringify(s.record) === JSON.stringify(Stats.emptyRecord()), 'bilan vierge');
  // Bilan d'une version 3 relu, valeurs invalides remises à zéro
  const v3 = Stats.migrate({ version: 3, record: { points: [12, 'x'], games: [3, -2], sets: 'non' } }, { sound: true }).state;
  assert(JSON.stringify(v3.record) === JSON.stringify({ points: [12, 0], games: [3, 0], sets: [0, 0], matches: [0, 0] }), JSON.stringify(v3.record));
});

test('migration : données corrompues ou inconnues → état vierge, sans exception', () => {
  for (const raw of [null, undefined, 42, 'texte', [], {}, { version: 99 }, { version: 2, balls: 'pas un tableau', level: 'x' }, { version: 1, match: null }]) {
    const r = Stats.migrate(raw, DEFAULTS);
    assert(r.state.version === Stats.SCHEMA_VERSION && Array.isArray(r.state.balls), JSON.stringify(raw));
  }
  const v2 = Stats.migrate({ version: 2, balls: 'pas un tableau', level: 'x', settings: { speed: 0.5, inconnu: 1 } }, DEFAULTS).state;
  assert(v2.balls.length === 0 && v2.level === 1 && v2.settings.speed === 0.5 && !('inconnu' in v2.settings));
  near(Stats.migrate({ version: 2, level: 12 }, DEFAULTS).state.level, 5, 0, 'niveau borné');
});

test('export / import JSON : aller-retour, fichiers étrangers refusés', () => {
  let st = Stats.createState(DEFAULTS);
  st = Stats.recordBall(st, ball({}), CFG.difficulty).state;
  const back = Stats.importState(JSON.stringify(st), DEFAULTS);
  assert(JSON.stringify(back) === JSON.stringify(st), 'aller-retour exact');
  for (const bad of ['{"pas":"glasslab"}', 'pas du json', '[]']) {
    let threw = false;
    try {
      Stats.importState(bad, DEFAULTS);
    } catch (e) {
      threw = true;
    }
    assert(threw, 'refusé : ' + bad);
  }
});

test('double : part des frappes jouées aligné avec le partenaire', () => {
  const d = Stats.doublesStats([ball({ aligned: true }), ball({ aligned: false }), ball({ aligned: true }), ball({})]);
  assert(d.n === 3 && Math.abs(d.aligned - 2 / 3) < 1e-12, JSON.stringify(d));
  assert(Stats.doublesStats([]).aligned === null);
});

test('match en cours et format : sauvegardés, relus, refusés s’ils sont invalides ou terminés', () => {
  const st = Object.assign(Stats.createState(DEFAULTS), { format: '3sets' });
  let sc = SC.createScore({ bestOf: 3, superTiebreak: true });
  for (let i = 0; i < 9; i++) sc = SC.pointWon(sc, i % 3 ? 0 : 1).score;
  st.current = { format: '3sets', score: sc, pointsWon: [6, 3], at: 1700000000000 };
  const back = Stats.importState(JSON.stringify(st), DEFAULTS);
  assert(back.format === '3sets' && back.current && back.current.format === '3sets', 'format et match relus');
  assert(JSON.stringify(back.current.score) === JSON.stringify(sc) && back.current.pointsWon.join('-') === '6-3', 'score identique');
  // Match terminé, format inconnu ou score illisible : pas de reprise
  let done = SC.createScore({ bestOf: 1 });
  for (let i = 0; i < 24; i++) done = SC.pointWon(done, 0).score;
  assert(done.winner === 0 && Stats.cleanCurrent({ format: '1set', score: done }) === null, 'match terminé');
  assert(Stats.cleanCurrent({ format: '5sets', score: sc }) === null && Stats.cleanCurrent({ format: '1set', score: { points: 'x' } }) === null, 'invalide');
  const old = Stats.migrate({ version: 3, balls: [] }, DEFAULTS).state;
  assert(old.format === '1set' && old.current === null && old.record.matches.join('-') === '0-0', 'ancienne sauvegarde : valeurs par défaut');
});

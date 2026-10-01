/*
 * Glass Lab — tests : score d'une partie de padel (points, jeux, sets, jeu décisif, service).
 */
import { test, assert, section } from './harness.js';
import SC from '../src/core/score.js';

section('Score et service');

/** Joue une suite de points (0 = ton équipe, 1 = adversaires). */
function play(sc, seq) {
  let out = { score: sc };
  for (const t of seq) out = SC.pointWon(out.score, t);
  return out;
}
const rep = (t, n) => Array(n).fill(t);

test('points : 15-30-40-jeu, égalité et avantage (sans point en or)', () => {
  let sc = SC.createScore({ golden: false });
  const labels = [];
  for (const t of [0, 1, 0, 0]) {
    sc = SC.pointWon(sc, t).score;
    labels.push(SC.display(sc).points.join('-'));
  }
  assert(labels.join(' ') === '15-0 15-15 30-15 40-15', labels.join(' '));
  sc = play(SC.createScore({ golden: false }), [0, 0, 0, 1, 1, 1]).score;
  assert(SC.display(sc).note === 'Égalité' && SC.display(sc).points.join('-') === '40-40');
  sc = SC.pointWon(sc, 0).score;
  assert(SC.display(sc).points.join('-') === 'Av-40' && SC.display(sc).note === 'Avantage vous');
  sc = SC.pointWon(sc, 1).score;
  assert(SC.display(sc).note === 'Égalité', 'retour à égalité');
  const r = play(sc, [1, 1]);
  assert(r.game === 1 && r.score.games.join('-') === '0-1' && r.score.points.join('-') === '0-0', 'jeu après deux points d’avance');
});

test('point en or : à 40-40, le point suivant gagne le jeu ; c’est l’équipe qui reçoit qui choisit le côté', () => {
  let sc = play(SC.createScore(), [0, 0, 0, 1, 1, 1]).score;
  assert(SC.isGoldenPoint(sc) && SC.display(sc).note === 'Point en or');
  // Les adversaires servent le 1er jeu : ton équipe reçoit, c'est toi qui reçois le point en or
  assert(SC.server(sc) === 2 && SC.receiver(sc) === 0 && SC.serveSide(sc) === 'right');
  const partner = Object.assign({}, sc, { receiverChoice: 1 });
  assert(SC.receiver(partner) === 1, 'ton partenaire peut le recevoir');
  const r = SC.pointWon(sc, 1);
  assert(r.game === 1 && r.score.games[1] === 1);
});

test('service : rotation des 4 joueurs, côté droit au premier point puis alternance, réception en diagonale', () => {
  let sc = SC.createScore();
  // 1er jeu : l'adversaire de droite sert, à toi (côté droit), puis à ton partenaire
  assert(SC.server(sc) === 2 && SC.serveSide(sc) === 'right' && SC.receiver(sc) === 0, '1er point : vers toi');
  sc = SC.pointWon(sc, 0).score;
  assert(SC.serveSide(sc) === 'left' && SC.receiver(sc) === 1, '2e point : vers ton partenaire');
  const servers = [];
  sc = SC.createScore();
  for (let g = 0; g < 8; g++) {
    servers.push(SC.server(sc));
    sc = play(sc, rep(g % 2, 4)).score;
  }
  assert(servers.join('') === '20312031', 'ordre de service : ' + servers.join(''));
  // Quand ton équipe sert, les adversaires reçoivent en diagonale
  sc = play(SC.createScore(), rep(0, 4)).score;
  assert(SC.server(sc) === 0 && SC.receiver(sc) === 2 && SC.serveSide(sc) === 'right');
});

test('sets : 6 jeux avec 2 d’écart, 7-5 possible, jeu décisif à 6-6, la partie continue', () => {
  let r = play(SC.createScore(), [].concat(...Array(6).fill(rep(0, 4))));
  assert(r.set === 0 && r.score.sets.join('-') === '1-0' && r.score.games.join('-') === '0-0', '6-0 puis nouveau set');
  // 5-5 puis 7-5
  let sc = SC.createScore();
  for (let g = 0; g < 10; g++) sc = play(sc, rep(g % 2, 4)).score;
  assert(sc.games.join('-') === '5-5');
  r = play(sc, rep(0, 4));
  assert(r.set == null && r.score.games.join('-') === '6-5', 'pas de set à 6-5');
  r = play(r.score, rep(0, 4));
  assert(r.set === 0 && r.score.sets[0] === 1, '7-5');
  // 6-6 : jeu décisif
  sc = SC.createScore();
  for (let g = 0; g < 12; g++) sc = play(sc, rep(g % 2, 4)).score;
  assert(sc.tiebreak && SC.display(sc).note === 'Jeu décisif', 'jeu décisif');
  // Service au jeu décisif : 1 point, puis 2 points chacun
  const tbServers = [];
  let tb = sc;
  for (let k = 0; k < 7; k++) {
    tbServers.push(SC.server(tb));
    tb = SC.pointWon(tb, k % 2).score;
  }
  assert(tbServers[0] !== tbServers[1] && tbServers[1] === tbServers[2] && tbServers[3] === tbServers[4] && tbServers[2] !== tbServers[3], 'rotation : ' + tbServers.join(''));
  // 7 points avec 2 d'écart
  r = play(sc, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  assert(r.score.tiebreak && SC.display(r.score).points.join('-') === '6-6', '6-6 au jeu décisif');
  r = play(r.score, [1, 1]);
  assert(r.set === 1 && r.score.sets.join('-') === '0-1' && !r.score.tiebreak, 'set au jeu décisif (8-6)');
});

test('match en 1 set : fini à 6-4 (ou au jeu décisif), puis le score ne bouge plus', () => {
  let sc = SC.createScore({ bestOf: 1 });
  for (let g = 0; g < 9; g++) sc = play(sc, rep(g % 2 === 0 || g === 8 ? 0 : 1, 4)).score;
  // jeux : 0 gagne les jeux 0, 2, 4, 6, 8 ; 1 gagne 1, 3, 5, 7 → 5-4
  assert(sc.games.join('-') === '5-4' && sc.winner == null, 'en cours : ' + sc.games.join('-'));
  const r = play(sc, rep(0, 4));
  assert(r.match === 0 && r.set === 0 && r.score.winner === 0, 'match gagné 6-4');
  assert(SC.setLabel(r.score.history[0]) === '6-4' && SC.display(r.score).winner === 0);
  const after = SC.pointWon(r.score, 1);
  assert(after.score === r.score && after.game == null, 'match terminé : plus de point');
  // 6-6 : le jeu décisif décide du match
  sc = SC.createScore({ bestOf: 1 });
  for (let g = 0; g < 12; g++) sc = play(sc, rep(g % 2, 4)).score;
  const tb = play(sc, rep(1, 7));
  assert(tb.match === 1 && SC.setLabel(tb.score.history[0]) === '6-7', 'jeu décisif : ' + SC.setLabel(tb.score.history[0]));
});

test('2 sets gagnants : super jeu décisif en 10 points à 1 set partout', () => {
  let sc = SC.createScore({ bestOf: 3, superTiebreak: true });
  sc = play(sc, [].concat(...Array(6).fill(rep(0, 4)))).score; // 6-0
  const r1 = play(sc, [].concat(...Array(6).fill(rep(1, 4)))); // 0-6
  assert(r1.set === 1 && r1.match == null && r1.tiebreak && r1.superTiebreak, '1 set partout → super jeu décisif');
  sc = r1.score;
  const d = SC.display(sc);
  assert(d.superTb && d.note === 'Super jeu décisif' && d.sets.join('-') === '1-1');
  // 9-9 puis 11-9
  let r = play(sc, [].concat(...Array(9).fill([0, 1])));
  assert(r.match == null && r.score.points.join('-') === '9-9', 'pas fini à 9-9');
  r = play(r.score, [0, 0]);
  assert(r.match === 0 && r.score.winner === 0, 'gagné 11-9');
  assert(r.score.history.map(SC.setLabel).join(' ') === '6-0 0-6 [11-9]', r.score.history.map(SC.setLabel).join(' '));
  // 2 sets à 0 : pas de troisième set
  sc = SC.createScore({ bestOf: 3, superTiebreak: true });
  const two = play(sc, [].concat(...Array(12).fill(rep(1, 4))));
  assert(two.match === 1 && two.score.sets.join('-') === '0-2', '2-0');
});

test('enjeux et annonces : balle de break, de set, de match ; score du serveur en premier', () => {
  // Les adversaires servent le 1er jeu : à 15-40 pour ton équipe, balle de break pour vous
  let sc = play(SC.createScore({ bestOf: 1 }), [0, 0, 0]).score;
  let st = SC.display(sc).stake;
  assert(st && st.kind === 'break' && st.team === 0, 'balle de break : ' + JSON.stringify(st));
  assert(SC.call(sc) === '0-40', 'annonce serveur d’abord : ' + SC.call(sc));
  assert(SC.call(play(SC.createScore(), [0, 1]).score) === '15 partout');
  // 5-3 en 1 set, 9e jeu servi par l'adversaire de droite (ordre 2, 0, 3, 1) : à 0-40, balle de match (et de break)
  sc = SC.createScore({ bestOf: 1 });
  for (const t of [0, 1, 0, 1, 0, 1, 0, 0]) sc = play(sc, rep(t, 4)).score;
  assert(sc.games.join('-') === '5-3');
  sc = play(sc, [0, 0, 0]).score;
  st = SC.display(sc).stake;
  assert(st && st.kind === 'match' && st.team === 0, 'balle de match : ' + JSON.stringify(st));
  // Sans format (sets sans fin) : balle de set, jamais de balle de match
  sc = SC.createScore();
  for (const t of [0, 1, 0, 1, 0, 1, 0, 0]) sc = play(sc, rep(t, 4)).score;
  sc = play(sc, [0, 0, 0]).score;
  assert(SC.display(sc).stake.kind === 'set', 'balle de set');
  // Point en or au jeu décisif : pas d'enjeu de break au jeu décisif
  sc = SC.createScore({ bestOf: 1 });
  for (let g = 0; g < 12; g++) sc = play(sc, rep(g % 2, 4)).score;
  assert(SC.display(sc).stake == null && SC.call(play(sc, [1]).score).match(/^\d+-\d+$/), 'jeu décisif');
});

test('reprise d’un match sauvegardé : score relu tel quel, données invalides refusées', () => {
  let sc = SC.createScore({ bestOf: 3, superTiebreak: true });
  sc = play(sc, [].concat(...Array(7).fill(rep(0, 4)), [1, 0, 1])).score;
  const back = SC.restore(JSON.parse(JSON.stringify(sc)));
  assert(JSON.stringify(back) === JSON.stringify(sc), 'identique après sauvegarde');
  assert(SC.server(back) === SC.server(sc) && SC.display(back).points.join('-') === SC.display(sc).points.join('-'));
  assert(SC.restore(null) === null && SC.restore({}) === null, 'vide');
  assert(SC.restore(Object.assign({}, sc, { order: [0, 0, 1, 2] })) === null, 'ordre de service invalide');
  assert(SC.restore(Object.assign({}, sc, { points: [1, -2] })) === null, 'points invalides');
  assert(SC.restore(Object.assign({}, sc, { history: [{ games: 'x' }] })) === null, 'historique invalide');
});

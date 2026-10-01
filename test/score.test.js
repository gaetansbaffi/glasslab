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

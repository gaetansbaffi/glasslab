/*
 * Glass Lab — tests : génération des coups (court complet, vraie physique).
 */
import { test, assert, section } from './harness.js';
import P from '../src/core/physics.js';
import CFG from '../src/core/config.js';
import Q from '../src/core/quality.js';
import SG from '../src/core/shotgen.js';
import PL from '../src/core/players.js';
import { SEEDS } from './helpers.js';

section('Génération des balles adverses');

const FULL = { xMin: 0.3, xMax: 9.7 };

/** Balle d'un adversaire (frappe au fond, y ≈ 18) vers ton camp : famille imposée, jouable depuis `player`. */
function opponentBall(family, level, seed, o) {
  o = o || {};
  const origin = { x: 2 + (seed % 7), y: 17.6 + (seed % 3) * 0.4, z: 1.0 };
  return SG.generateTo({ origin, team: 1, style: o.style || 'drive', family, side: o.side || FULL, level, seed, attempts: 300, receiver: o.player ? { pos: o.player } : undefined });
}

test('toute balle générée est atteignable selon config.js (toutes familles, niveaux, positions)', () => {
  const positions = [{ x: 5, y: 3 }, { x: 1, y: 1 }, { x: 9, y: 8 }, { x: 2, y: 9 }];
  let n = 0;
  let none = 0;
  for (const family of SG.FAMILY_IDS) {
    for (let level = 1; level <= 5; level += 2) {
      for (const player of positions) {
        for (let i = 0; i < 4; i++) {
          const seed = 500 + i * 131 + level;
          const f = opponentBall(family, level, seed, { player });
          n++;
          // Quelques combinaisons extrêmes (joueur au filet dans un coin, famille à l'opposé) sont
          // injouables : la partie passe alors à une autre famille ou à un autre coup.
          if (!f) {
            none++;
            continue;
          }
          // Recalcul indépendant de l'atteignabilité
          const best = Q.bestChoice(f.shot, player, CFG);
          assert(best.best && best.best.quality >= CFG.quality.playable, 'qualité atteignable insuffisante');
          assert(best.best.margin >= 0, 'point de frappe atteint trop tard');
          // Trajet avec accélération, croisière et freinage (players.js)
          const travel = PL.travelTime(Math.hypot(best.best.pos.x - player.x, best.best.pos.y - player.y), CFG.player);
          assert(best.best.t - f.shot.tStart >= CFG.player.reactionTime + travel - 1e-9, 'réaction + trajet > temps disponible');
        }
      }
    }
  }
  assert(n === 5 * 3 * 4 * 4);
  assert(none <= n * 0.25, `trop de combinaisons sans balle : ${none} / ${n}`);
});

test('chaque famille est générée avec la séquence de contacts attendue et retombe chez le joueur', () => {
  const EXP = {
    direct: /^floor,floor$/,
    A: /^floor,back,floor$/,
    B: /^floor,back,(left|right),floor$/,
    C: /^floor,(left|right),back,floor$/,
    D: /^floor,(left|right),floor$/,
  };
  for (const family of SG.FAMILY_IDS) {
    let made = 0;
    for (let i = 0; i < 20; i++) {
      const f = opponentBall(family, 1 + (i % 5), 9000 + i * 7);
      if (!f) continue;
      made++;
      const seq = P.contactSequence(f.shot.sim).join(',');
      assert(EXP[family].test(seq), `${family} : ${seq}`);
      for (const c of f.shot.sim.contacts.filter((k) => k.type === 'floor')) assert(c.pos.y > 0 && c.pos.y < 10, 'rebond hors de la moitié du joueur');
      assert(f.shot.tStart < 0 && !f.verdict.fault, 'la balle part du camp adverse et passe le filet');
    }
    assert(made >= 15, `${family} : ${made} balles sur 20`);
  }
});

test('familles à vitres : classification cohérente, contacts sur vitre, deux côtés, tous niveaux', () => {
  for (const f of ['A', 'B', 'C', 'D']) {
    const sides = new Set();
    for (let level = 1; level <= 5; level++) {
      for (const seed of SEEDS.slice(0, 8)) {
        const side = seed % 2 ? { xMin: 0.3, xMax: 4.8 } : { xMin: 5.2, xMax: 9.7 };
        const flight = opponentBall(f, level, seed, { side });
        if (!flight) continue;
        const sim = flight.shot.sim;
        assert(P.classify(sim) === f, 'classification incohérente');
        for (const c of sim.contacts) {
          if (c.type === 'floor') continue;
          assert(P.onGlass(c), 'contact hors vitre');
          if (c.type !== 'back') sides.add(c.type);
        }
        if (f === 'A') sides.add(sim.contacts[0].pos.x < 5 ? 'left' : 'right');
      }
    }
    assert(sides.has('left') && sides.has('right'), f + ' : un seul côté généré');
  }
});

test('même graine → même balle, graine différente → balle différente', () => {
  for (const f of SG.FAMILY_IDS) {
    const a = opponentBall(f, 3, 12345);
    const b = opponentBall(f, 3, 12345);
    assert(a && JSON.stringify(a.init) === JSON.stringify(b.init), 'états initiaux différents');
    const c = opponentBall(f, 3, 12346);
    assert(!c || JSON.stringify(a.init) !== JSON.stringify(c.init));
  }
});

test('difficulté : balles plus rapides aux niveaux élevés', () => {
  for (const f of SG.FAMILY_IDS) {
    const avg = (level) => {
      let sum = 0;
      let n = 0;
      for (const seed of SEEDS) {
        const flight = opponentBall(f, level, seed);
        if (!flight) continue;
        sum += P.hSpeed(flight.init);
        n++;
      }
      return sum / n;
    };
    assert(avg(5) > avg(1) * 1.15, f + ' : le niveau 5 devrait être nettement plus rapide');
  }
});

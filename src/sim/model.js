/*
 * Glass Lab — simulateur de vitres : calculs (sans DOM), sur le moteur du jeu (src/core/physics.js).
 *
 * Un tir part d'un point du camp adverse (y > 10) et rebondit en un point choisi du camp du joueur
 * (y < 10), à une vitesse de départ donnée, tendu ou lobé, avec un effet (lift / coupé, latéral).
 * La trajectoire suit exactement la physique du jeu : air, effet, rebonds, vitres, grille, portes.
 */
import P from '../core/physics.js';
import F from '../core/flight.js';

/** Préréglages (repère du court : x = 0 paroi gauche vue du fond du joueur, y = 0 sa vitre de fond). */
export const PRESETS = [
  { id: 'fond', name: 'Vitre de fond', from: { x: 5, y: 18, z: 1.0 }, to: { x: 5, y: 2.2 }, kmh: 62, lob: false, top: 0, side: 0 },
  { id: 'double', name: 'Double vitre (fond → latérale)', from: { x: 2.5, y: 18, z: 1.0 }, to: { x: 8.6, y: 1.3 }, kmh: 72, lob: false, top: 0, side: 0 },
  { id: 'inverse', name: 'Latérale → fond', from: { x: 1.5, y: 17, z: 1.0 }, to: { x: 9.1, y: 3.0 }, kmh: 74, lob: false, top: 0, side: 0 },
  { id: 'laterale', name: 'Latérale seule', from: { x: 1.5, y: 14.5, z: 1.0 }, to: { x: 8.9, y: 4.6 }, kmh: 52, lob: false, top: 0, side: 0 },
  { id: 'grille', name: 'Grille', from: { x: 2, y: 13.5, z: 1.0 }, to: { x: 9.0, y: 6.8 }, kmh: 48, lob: false, top: 0, side: 0 },
  { id: 'porte', name: 'Porte (balle qui sort)', from: { x: 1, y: 12, z: 1.8 }, to: { x: 8.8, y: 9.1 }, kmh: 36, lob: false, top: 0, side: 0 },
  { id: 'lob', name: 'Lob lifté', from: { x: 5, y: 18, z: 1.0 }, to: { x: 5, y: 2.0 }, kmh: 52, lob: true, top: 100, side: 0 },
  { id: 'bandeja', name: 'Bandeja coupée', from: { x: 6, y: 12.5, z: 2.6 }, to: { x: 4, y: 2.2 }, kmh: 68, lob: false, top: -160, side: 50 },
];

const kmhOf = (s) => P.speed(s) * 3.6;

/**
 * Lancer pour rebondir en `to` depuis `from` à `kmh` km/h : la vitesse de départ en fonction de la durée de
 * vol est en U ; tendu = la durée la plus courte, lobé = la plus longue. Si la vitesse ne suffit pas, le tir
 * le moins rapide possible. Retourne { init, T, kmh, reachable }.
 */
export function solveLaunch(o) {
  const spin = o.top || o.side ? P.spinVector(o.to.x - o.from.x, o.to.y - o.from.y, o.top || 0, o.side || 0) : undefined;
  const at = (T) => P.launchToBounce(o.from, o.to, T, undefined, spin);
  const Ts = [];
  for (let T = 0.12; T <= 4.0001; T += 0.04) Ts.push(T);
  const v = Ts.map((T) => kmhOf(at(T)));
  let iMin = 0;
  for (let i = 1; i < v.length; i++) if (v[i] < v[iMin]) iMin = i;
  if (v[iMin] > o.kmh) return { init: at(Ts[iMin]), T: Ts[iMin], kmh: v[iMin], reachable: false };
  // Racine sur la branche choisie (tendue : avant le minimum, lobée : après), par dichotomie
  const branch = o.lob ? [iMin, v.length - 1] : [0, iMin];
  const [i0, i1] = branch;
  if ((v[i0] - o.kmh) * (v[i1] - o.kmh) > 0) {
    const i = Math.abs(v[i0] - o.kmh) < Math.abs(v[i1] - o.kmh) ? i0 : i1;
    return { init: at(Ts[i]), T: Ts[i], kmh: v[i], reachable: false };
  }
  let lo = Ts[i0];
  let hi = Ts[i1];
  const sLo = Math.sign(v[i0] - o.kmh);
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(kmhOf(at(mid)) - o.kmh) === sLo) lo = mid;
    else hi = mid;
  }
  const T = (lo + hi) / 2;
  const init = at(T);
  return { init, T, kmh: kmhOf(init), reachable: true };
}

const WALL_NAMES = { back: 'de fond', backFar: 'de fond adverse', left: 'latérale gauche', right: 'latérale droite' };

/** Description d'un contact : { label, kind ('floor' | 'glass' | 'mesh' | 'exit' | 'net'), … }. */
export function describe(c) {
  const v = (u) => Math.round(P.speed(u) * 3.6);
  const base = { t: c.t, pos: c.pos, kmhIn: v(c.vIn), kmhOut: v(c.vOut) };
  if (c.type === 'floor') return Object.assign(base, { kind: 'floor', label: c.pos.y < P.COURT.depth ? 'Sol (chez toi)' : 'Sol (camp adverse)' });
  if (c.type === 'net' || c.type === 'cord') return Object.assign(base, { kind: 'net', label: c.type === 'net' ? 'Filet' : 'Bande du filet' });
  if (c.type === 'exit') {
    const door = P.wallAt(c.wall, c.pos.y, Math.min(c.pos.z, 1.9)) === 'open' && c.pos.z <= 2 && (c.wall === 'left' || c.wall === 'right');
    return Object.assign(base, { kind: 'exit', label: door ? 'Sortie par la porte' : 'Sortie au-dessus du mur (' + WALL_NAMES[c.wall] + ')', kmhOut: null });
  }
  const kind = P.wallAt(c.type, c.pos.y, c.pos.z);
  return Object.assign(base, { kind, label: (kind === 'glass' ? 'Vitre ' : 'Grille ') + WALL_NAMES[c.type] });
}

const FAMILY_NAMES = { direct: 'Directe (2e rebond avant toute vitre)', A: 'A : vitre de fond', B: 'B : fond puis latérale (double vitre)', C: 'C : latérale puis fond (double vitre inversée)', D: 'D : latérale seule' };
const VERDICTS = {
  double: 'Si tu ne la joues pas : point pour le frappeur (2e rebond)',
  exit: 'Si tu ne la joues pas : point pour le frappeur (la balle sort du court)',
  back: 'Si tu ne la joues pas : point pour le frappeur (la balle repasse le filet)',
  dead: 'La balle meurt chez toi',
  net: 'Faute du frappeur : filet',
  out: 'Faute du frappeur : vitre ou grille avant le rebond',
};

/**
 * Simulation complète. o = { from, to, kmh, lob, top, side }.
 * Retourne { launch, sim, flight, contacts (décrits), samples, summary }.
 */
export function simulate(o) {
  const launch = solveLaunch(o);
  const flight = F.makeFlight(launch.init, 1);
  const sim = flight.sim;
  const contacts = sim.contacts.map(describe);
  const samples = P.sample(sim, 1 / 120);
  // Après la dernière paroi (vitre ou grille) chez toi : hauteur maximale et 2e rebond
  const mine = sim.contacts.filter((c) => c.pos.y < P.COURT.depth || c.type === 'exit');
  const floors = mine.filter((c) => c.type === 'floor');
  const walls = mine.filter((c) => c.type !== 'floor' && c.type !== 'exit');
  const last = walls[walls.length - 1];
  const end = floors[1] ? floors[1].t : sim.endT;
  const summary = {
    kmh: launch.kmh,
    reachable: launch.reachable,
    flightTime: floors[0] ? floors[0].t : null,
    apex: P.maxHeight(sim, 0, floors[0] ? floors[0].t : sim.endT),
    family: flight.shot ? (FAMILY_NAMES[flight.shot.family] || 'Hors familles') + (walls.some((c) => !P.onGlass(c)) ? ' — sur la grille' : '') : null,
    verdict: VERDICTS[flight.verdict.reason] || flight.verdict.reason,
    afterWall: last ? { height: P.maxHeight(sim, last.t, end), time: end - last.t } : null,
    playTime: floors[0] ? end - floors[0].t : null, // entre le 1er et le 2e rebond (ou la fin)
    secondBounce: floors[1] ? floors[1].pos : null,
    spin: P.spinParts(launch.init),
  };
  return { launch, sim, flight, contacts, samples, summary };
}

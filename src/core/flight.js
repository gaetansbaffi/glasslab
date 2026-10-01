/*
 * Glass Lab — vol de balle sur le court complet, depuis n'importe quel joueur (fonctions pures).
 *
 * Un vol part d'une frappe (instant τ = 0) et suit la physique du court complet (filet, vitres des deux
 * camps). On en tire :
 *   - l'issue si personne ne joue la balle (verdict) : faute du frappeur (filet, dehors) ou point gagnant
 *     (deuxième rebond, balle repartie au-dessus du filet) ;
 *   - la balle vue par l'équipe qui reçoit (`shot`), dans le format historique de quality.js :
 *     repère du receveur (sa vitre de fond en y = 0, filet en y = 10), t = 0 au passage du filet,
 *     tStart < 0 = instant de la frappe. Pour l'équipe du haut, le repère est le symétrique du court.
 */
import P from './physics.js';
import G from './geometry.js';

const SIM_OPTS = { court: 'full', maxFloorBounces: 2, tMax: 8 };

/** Équipe du côté d'un point : 0 = moitié du bas (y < 10), 1 = moitié du haut. */
function sideOf(y) {
  return y < P.COURT.depth ? 0 : 1;
}

/** Repère d'une équipe : identité pour l'équipe du bas, symétrie centrale pour celle du haut. */
function toTeamFrame(team, s) {
  return team === 0 ? Object.assign({}, s) : P.mirrorState(s);
}

/**
 * Issue du vol si personne ne joue la balle.
 * Retourne { winner (équipe), fault (faute du frappeur ?), reason, t (instant de la décision),
 *            bounceAt (premier rebond valide chez le receveur, ou null) }.
 *   reason : 'net' (filet ou rebond chez soi), 'out' (vitre ou grillage adverse avant le rebond),
 *            'double' (deuxième rebond), 'back' (repassée au-dessus du filet), 'dead' (fin de simulation).
 */
function judge(sim, team) {
  const recv = 1 - team;
  const events = sim.contacts.map((c) => ({ t: c.t, c })).concat(sim.crossings.map((x) => ({ t: x.t, x })));
  events.sort((a, b) => a.t - b.t || (a.x ? -1 : 1));
  let crossed = false;
  let bounceAt = null;
  let netAt = null;
  for (const e of events) {
    if (e.x) {
      const towardRecv = recv === 1 ? e.x.dir > 0 : e.x.dir < 0;
      if (!crossed && towardRecv) crossed = true;
      else if (crossed && bounceAt != null && !towardRecv) return { winner: team, fault: false, reason: 'back', t: e.t, bounceAt };
      continue;
    }
    const c = e.c;
    if (!crossed) {
      if (c.type === 'net' && netAt == null) netAt = c.t;
      if (c.type === 'floor') return { winner: recv, fault: true, reason: 'net', t: netAt != null ? Math.max(c.t, netAt + 0.25) : c.t, bounceAt: null };
      continue;
    }
    if (c.type === 'cord') continue;
    if (bounceAt == null) {
      if (c.type === 'floor' && c.side === recv) bounceAt = c.t;
      else return { winner: recv, fault: true, reason: 'out', t: c.t, bounceAt: null };
    } else if (c.type === 'floor') return { winner: team, fault: false, reason: 'double', t: c.t, bounceAt };
  }
  if (!crossed) return { winner: recv, fault: true, reason: 'net', t: netAt != null ? netAt + 0.6 : sim.endT, bounceAt: null };
  if (bounceAt == null) return { winner: recv, fault: true, reason: 'out', t: sim.endT, bounceAt: null };
  return { winner: team, fault: false, reason: 'dead', t: sim.endT, bounceAt };
}

/** Famille de la balle reçue (contacts dans le camp du receveur) : direct, A, B, C, D ou null. */
function familyOf(sim) {
  const seq = P.contactSequence(sim).join(',');
  if (seq === 'floor,floor') return 'direct';
  return P.classify(sim);
}

/**
 * Balle vue par le receveur (format de quality.js), à partir du passage du filet.
 * Retourne null si la balle ne passe pas le filet.
 */
function receiverShot(sim, team, crossT) {
  const recv = 1 - team;
  const at = toTeamFrame(recv, P.stateAt(sim, crossT + 1e-9));
  at.y = Math.min(at.y, P.COURT.depth); // au plan du filet
  const half = P.simulate(at, { maxFloorBounces: 2, tMax: Math.max(0.5, 8 - crossT) });
  return { init: at, sim: half, tStart: -crossT, endT: half.endT, family: familyOf(half), team: recv };
}

/**
 * Nouveau vol depuis l'état de frappe `init` (repère monde) par l'équipe `team`.
 * extra : champs ajoutés tels quels (frappeur, style de coup…).
 */
function makeFlight(init, team, extra) {
  const sim = P.simulate(init, SIM_OPTS);
  const recv = 1 - team;
  const cross = sim.crossings.find((x) => (recv === 1 ? x.dir > 0 : x.dir < 0)) || null;
  const flight = Object.assign({ init: Object.assign({}, init), team, recv, sim, cross: cross ? cross.t : null }, extra || {});
  flight.verdict = judge(sim, team);
  flight.shot = cross ? receiverShot(sim, team, cross.t) : null;
  return flight;
}

/** Position de la balle (repère monde) à l'instant τ du vol. */
function ballAt(flight, tau) {
  return P.stateAt(flight.sim, tau);
}

/** Instant τ du vol correspondant à l'instant t de la balle reçue (t = 0 au filet). */
function tauOfShot(flight, t) {
  return t + flight.cross;
}

/** Point du repère d'une équipe → repère monde (la symétrie est sa propre inverse). */
function fromTeamFrame(team, p) {
  return team === 0 ? Object.assign({}, p) : P.mirrorState(p);
}

/** Vitesse de la balle au départ de la raquette (km/h). */
function launchKmh(flight) {
  return P.speed(flight.init) * 3.6;
}

/** Hauteur maximale atteinte avant le premier rebond (m). */
function apex(flight) {
  const first = flight.sim.contacts.find((c) => c.type === 'floor');
  const t1 = first ? first.t : flight.sim.endT;
  const s = flight.init;
  if (s.vz <= 0) return s.z;
  const tTop = Math.min(t1, s.vz / (flight.sim.params.g - (s.az || 0)));
  return G.ballistic(s, tTop, flight.sim.params.g).z;
}

const Flight = {
  SIM_OPTS,
  sideOf,
  toTeamFrame,
  fromTeamFrame,
  judge,
  familyOf,
  receiverShot,
  makeFlight,
  ballAt,
  tauOfShot,
  launchKmh,
  apex,
};

export default Flight;

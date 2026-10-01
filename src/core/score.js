/*
 * Glass Lab — score d'une partie de padel (fonctions pures, sans DOM).
 *
 *   - points : 15, 30, 40, jeu ; à 40-40, avantage ou point en or (point décisif) ;
 *   - jeux : 6 jeux avec 2 d'écart ; à 6-6, jeu décisif (tie-break) en 7 points avec 2 d'écart ;
 *   - sets et match : selon le format (FORMATS) — match en 1 set, ou en 2 sets gagnants avec, à 1 set
 *     partout, un super jeu décisif en 10 points ; sans format (bestOf = 0), les sets s'enchaînent sans fin ;
 *   - service : les équipes alternent à chaque jeu, les partenaires alternent quand leur équipe sert
 *     (ordre fixe sur 4 joueurs) ; chaque jeu commence du côté droit, puis on alterne à chaque point ;
 *     au point en or, l'équipe qui reçoit choisit qui reçoit ; au jeu décisif, on change de serveur
 *     après le premier point puis tous les deux points.
 *
 * Équipes : 0 = ton équipe, 1 = adversaires. Joueurs : 0 toi, 1 partenaire, 2 et 3 adversaires.
 */

const TEAM_OF = [0, 0, 1, 1];
const LABELS = ['0', '15', '30', '40'];

/**
 * Formats de match proposés. bestOf : nombre maximal de sets ; superTiebreak : à 1 set partout, le
 * dernier set est remplacé par un super jeu décisif en 10 points (format courant des tournois amateurs).
 */
const FORMATS = {
  '1set': { id: '1set', bestOf: 1, superTiebreak: false, name: '1 set' },
  '3sets': { id: '3sets', bestOf: 3, superTiebreak: true, name: '2 sets gagnants' },
};

/**
 * Nouveau score. o = { order : ordre de service des 4 joueurs (défaut : adversaire droite, toi,
 * adversaire gauche, partenaire), golden : point en or (défaut vrai), receiverChoice : joueur qui reçoit
 * le point en or quand ton équipe reçoit (défaut : toi), bestOf : 1 ou 3 sets (0 ou absent : sans fin),
 * superTiebreak : super jeu décisif à 1 set partout }.
 */
function createScore(o) {
  o = o || {};
  return {
    points: [0, 0],
    games: [0, 0],
    sets: [0, 0],
    tiebreak: false,
    superTb: false, // le jeu décisif en cours est un super jeu décisif (10 points)
    order: (o.order || [2, 0, 3, 1]).slice(),
    serveGame: 0, // jeux joués depuis le début (rang dans l'ordre de service)
    tbStart: 0, // rang du premier serveur du jeu décisif
    golden: o.golden !== false,
    receiverChoice: o.receiverChoice == null ? 0 : o.receiverChoice,
    gamesPlayed: 0,
    bestOf: o.bestOf || 0,
    superTiebreak: !!o.superTiebreak,
    history: [], // sets terminés : { games: [a, b], tb: points du jeu décisif ou null, super: vrai si super jeu décisif }
    winner: null, // équipe gagnante du match, une fois terminé
  };
}

/** Points joués dans le jeu en cours. */
function pointsPlayed(sc) {
  return sc.points[0] + sc.points[1];
}

/** Qui sert le point en cours. */
function server(sc) {
  if (sc.tiebreak) {
    const k = pointsPlayed(sc);
    return sc.order[(sc.tbStart + Math.ceil(k / 2)) % 4];
  }
  return sc.order[sc.serveGame % 4];
}

/** Point décisif (point en or) : 40-40 sans avantage. */
function isGoldenPoint(sc) {
  return !sc.tiebreak && sc.golden && sc.points[0] >= 3 && sc.points[1] >= 3 && sc.points[0] === sc.points[1];
}

/**
 * Côté du service : 'right' (premier point du jeu) puis alternance. Au point en or, l'équipe qui reçoit
 * choisit : ton équipe fait recevoir `receiverChoice` (toi par défaut), les adversaires leur joueur de droite.
 */
function serveSide(sc) {
  if (isGoldenPoint(sc)) {
    const recvTeam = 1 - TEAM_OF[server(sc)];
    if (recvTeam === 0) return sc.receiverChoice === 1 ? 'left' : 'right';
    return 'right';
  }
  return pointsPlayed(sc) % 2 === 0 ? 'right' : 'left';
}

/** Joueur qui reçoit : dans l'équipe qui reçoit, celui du côté du service (diagonale). */
function receiver(sc) {
  const recvTeam = 1 - TEAM_OF[server(sc)];
  const right = serveSide(sc) === 'right';
  return recvTeam === 0 ? (right ? 0 : 1) : right ? 2 : 3;
}

/** Le jeu (ou le jeu décisif) est-il gagné par une équipe après ce point ? */
function gameWinner(sc) {
  const [a, b] = sc.points;
  if (sc.tiebreak) {
    const n = sc.superTb ? 10 : 7;
    if (a >= n && a - b >= 2) return 0;
    if (b >= n && b - a >= 2) return 1;
    return null;
  }
  // Point en or : le premier à 4 points gagne (à 40-40, le point suivant décide)
  if (sc.golden) return a >= 4 ? 0 : b >= 4 ? 1 : null;
  if (a >= 4 && a - b >= 2) return 0;
  if (b >= 4 && b - a >= 2) return 1;
  return null;
}

/**
 * Point gagné par l'équipe `team`. Retourne { score (copie), game: équipe | null, set: équipe | null,
 * tiebreak: vrai si un jeu décisif commence, superTiebreak: vrai si c'est un super jeu décisif,
 * match: équipe gagnante si le match se termine }. Un match terminé n'évolue plus.
 */
function pointWon(sc, team) {
  const out = { score: sc, game: null, set: null, tiebreak: false, superTiebreak: false, match: null };
  if (sc.winner != null) return out;
  const s = Object.assign({}, sc, { points: sc.points.slice(), games: sc.games.slice(), sets: sc.sets.slice(), history: (sc.history || []).slice() });
  out.score = s;
  s.points[team]++;
  const g = gameWinner(s);
  if (g == null) return out;
  out.game = g;
  s.gamesPlayed++;
  s.games[g]++;
  const wasTiebreak = s.tiebreak;
  const wasSuper = !!s.superTb;
  const tbPoints = s.points.slice();
  s.points = [0, 0];
  // Service du jeu suivant : après un jeu décisif, le joueur suivant celui qui l'a commencé
  if (wasTiebreak) s.serveGame = s.tbStart + 1;
  else s.serveGame++;
  s.tiebreak = false;
  s.superTb = false;
  const [a, b] = s.games;
  let setWinner = null;
  if (wasTiebreak) setWinner = g;
  else if (a >= 6 && a - b >= 2) setWinner = 0;
  else if (b >= 6 && b - a >= 2) setWinner = 1;
  if (setWinner != null) {
    out.set = setWinner;
    s.sets[setWinner]++;
    s.history.push({ games: s.games.slice(), tb: wasTiebreak ? tbPoints : null, super: wasSuper });
    s.games = [0, 0]; // nouveau set
    if (s.bestOf && s.sets[setWinner] >= Math.ceil(s.bestOf / 2)) {
      s.winner = setWinner;
      out.match = setWinner;
    } else if (s.superTiebreak && s.bestOf === 3 && s.sets[0] === 1 && s.sets[1] === 1) {
      // 1 set partout : le dernier set se joue en super jeu décisif (10 points, 2 d'écart)
      s.tiebreak = true;
      s.superTb = true;
      s.tbStart = s.serveGame;
      out.tiebreak = true;
      out.superTiebreak = true;
    }
  } else if (a === 6 && b === 6) {
    s.tiebreak = true;
    s.tbStart = s.serveGame;
    out.tiebreak = true;
  }
  return out;
}

/**
 * Enjeu du prochain point : { kind: 'match' | 'set' | 'break', team } si une équipe peut gagner le match,
 * le set, ou le jeu de service adverse (balle de break), sinon null. Si les deux équipes ont un enjeu
 * (point en or), on garde le plus fort, à égalité celui de l'équipe qui reçoit.
 */
function stake(sc) {
  if (sc.winner != null) return null;
  const rank = { match: 3, set: 2, break: 1 };
  const recvTeam = 1 - TEAM_OF[server(sc)];
  let best = null;
  for (const team of [recvTeam, 1 - recvTeam]) {
    const r = pointWon(sc, team);
    const kind = r.match != null ? 'match' : r.set != null ? 'set' : r.game != null && team === recvTeam && !sc.tiebreak ? 'break' : null;
    if (kind && (!best || rank[kind] > rank[best.kind])) best = { kind, team };
  }
  return best;
}

/** Affichage des points d'une équipe : « 0, 15, 30, 40, Av » ou nombre au jeu décisif. */
function pointLabel(sc, team) {
  const [a, b] = sc.points;
  const mine = team === 0 ? a : b;
  const other = team === 0 ? b : a;
  if (sc.tiebreak) return String(mine);
  if (mine >= 3 && other >= 3) {
    if (sc.golden || mine === other) return '40';
    return mine > other ? 'Av' : '40';
  }
  return LABELS[Math.min(3, mine)];
}

/**
 * Résumé lisible : points, jeux, sets, serveur, côté, mention spéciale (point en or, jeu décisif,
 * égalité, avantage).
 */
function display(sc) {
  const [a, b] = sc.points;
  let note = '';
  if (sc.tiebreak) note = sc.superTb ? 'Super jeu décisif' : 'Jeu décisif';
  else if (isGoldenPoint(sc)) note = 'Point en or';
  else if (a >= 3 && b >= 3) note = a === b ? 'Égalité' : a > b ? 'Avantage vous' : 'Avantage eux';
  return {
    points: [pointLabel(sc, 0), pointLabel(sc, 1)],
    games: sc.games.slice(),
    sets: sc.sets.slice(),
    history: (sc.history || []).map((h) => ({ games: h.games.slice(), tb: h.tb ? h.tb.slice() : null, super: !!h.super })),
    server: server(sc),
    serverTeam: TEAM_OF[server(sc)],
    receiver: receiver(sc),
    side: serveSide(sc),
    tiebreak: sc.tiebreak,
    superTb: !!sc.superTb,
    golden: isGoldenPoint(sc),
    bestOf: sc.bestOf || 0,
    winner: sc.winner == null ? null : sc.winner,
    stake: stake(sc),
    note,
  };
}

/** Annonce de l'arbitre après un point : score du serveur en premier (« 30-15 », « 40 partout »…). */
function call(sc) {
  const sTeam = TEAM_OF[server(sc)];
  const [a, b] = sc.points;
  if (sc.tiebreak) return `${sc.points[sTeam]}-${sc.points[1 - sTeam]}`;
  if (a >= 3 && b >= 3) {
    if (a === b) return isGoldenPoint(sc) ? '40 partout · point en or' : 'Égalité';
    return a > b ? 'Avantage vous' : 'Avantage eux';
  }
  if (a === b) return `${LABELS[a]} partout`;
  return `${LABELS[sc.points[sTeam]]}-${LABELS[sc.points[1 - sTeam]]}`;
}

/** Score d'un set terminé : « 6-4 », « 7-6 » (jeu décisif), « [10-8] » (super jeu décisif). */
function setLabel(h) {
  if (h.super && h.tb) return `[${h.tb[0]}-${h.tb[1]}]`;
  return `${h.games[0]}-${h.games[1]}`;
}

const isPair = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x) && x >= 0 && x < 1000);

/**
 * Score relu d'une sauvegarde (match en cours) : contrôle chaque champ, retourne un score valide ou null.
 */
function restore(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const order = raw.order;
  if (!Array.isArray(order) || order.length !== 4 || [0, 1, 2, 3].some((i) => order.indexOf(i) < 0)) return null;
  if (!isPair(raw.points) || !isPair(raw.games) || !isPair(raw.sets)) return null;
  const int = (v) => (Number.isInteger(v) && v >= 0 && v < 100000 ? v : null);
  const serveGame = int(raw.serveGame);
  const tbStart = int(raw.tbStart);
  const gamesPlayed = int(raw.gamesPlayed);
  if (serveGame == null || tbStart == null || gamesPlayed == null) return null;
  const bestOf = raw.bestOf === 1 || raw.bestOf === 3 ? raw.bestOf : 0;
  const history = Array.isArray(raw.history) ? raw.history : [];
  if (!history.every((h) => h && isPair(h.games) && (h.tb == null || isPair(h.tb)))) return null;
  const winner = raw.winner === 0 || raw.winner === 1 ? raw.winner : null;
  return {
    points: raw.points.slice(),
    games: raw.games.slice(),
    sets: raw.sets.slice(),
    tiebreak: !!raw.tiebreak,
    superTb: !!raw.superTb,
    order: order.slice(),
    serveGame,
    tbStart,
    golden: raw.golden !== false,
    receiverChoice: raw.receiverChoice === 1 ? 1 : 0,
    gamesPlayed,
    bestOf,
    superTiebreak: !!raw.superTiebreak,
    history: history.map((h) => ({ games: h.games.slice(), tb: h.tb ? h.tb.slice() : null, super: !!h.super })),
    winner,
  };
}

const Score = {
  TEAM_OF,
  FORMATS,
  createScore,
  pointsPlayed,
  server,
  receiver,
  serveSide,
  isGoldenPoint,
  gameWinner,
  pointWon,
  stake,
  pointLabel,
  display,
  call,
  setLabel,
  restore,
};

export default Score;

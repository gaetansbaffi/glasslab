/*
 * Glass Lab — score d'une partie de padel (fonctions pures, sans DOM).
 *
 *   - points : 15, 30, 40, jeu ; à 40-40, avantage ou point en or (point décisif) ;
 *   - jeux : 6 jeux avec 2 d'écart ; à 6-6, jeu décisif (tie-break) en 7 points avec 2 d'écart ;
 *   - sets : la partie ne s'arrête jamais, un nouveau set commence à la fin du précédent ;
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
 * Nouveau score. o = { order : ordre de service des 4 joueurs (défaut : adversaire droite, toi,
 * adversaire gauche, partenaire), golden : point en or (défaut vrai), receiverChoice : joueur qui reçoit
 * le point en or quand ton équipe reçoit (défaut : toi) }.
 */
function createScore(o) {
  o = o || {};
  return {
    points: [0, 0],
    games: [0, 0],
    sets: [0, 0],
    tiebreak: false,
    order: (o.order || [2, 0, 3, 1]).slice(),
    serveGame: 0, // jeux joués depuis le début (rang dans l'ordre de service)
    tbStart: 0, // rang du premier serveur du jeu décisif
    golden: o.golden !== false,
    receiverChoice: o.receiverChoice == null ? 0 : o.receiverChoice,
    gamesPlayed: 0,
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
    if (a >= 7 && a - b >= 2) return 0;
    if (b >= 7 && b - a >= 2) return 1;
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
 * tiebreak: vrai si un jeu décisif commence }.
 */
function pointWon(sc, team) {
  const s = Object.assign({}, sc, { points: sc.points.slice(), games: sc.games.slice(), sets: sc.sets.slice() });
  s.points[team]++;
  const g = gameWinner(s);
  const out = { score: s, game: null, set: null, tiebreak: false };
  if (g == null) return out;
  out.game = g;
  s.gamesPlayed++;
  s.games[g]++;
  const wasTiebreak = s.tiebreak;
  s.points = [0, 0];
  // Service du jeu suivant : après un jeu décisif, le joueur suivant celui qui l'a commencé
  if (wasTiebreak) s.serveGame = s.tbStart + 1;
  else s.serveGame++;
  s.tiebreak = false;
  const [a, b] = s.games;
  let setWinner = null;
  if (wasTiebreak) setWinner = g;
  else if (a >= 6 && a - b >= 2) setWinner = 0;
  else if (b >= 6 && b - a >= 2) setWinner = 1;
  if (setWinner != null) {
    out.set = setWinner;
    s.sets[setWinner]++;
    s.games = [0, 0]; // la partie continue : nouveau set
  } else if (a === 6 && b === 6) {
    s.tiebreak = true;
    s.tbStart = s.serveGame;
    out.tiebreak = true;
  }
  return out;
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
  if (sc.tiebreak) note = 'Jeu décisif';
  else if (isGoldenPoint(sc)) note = 'Point en or';
  else if (a >= 3 && b >= 3) note = a === b ? 'Égalité' : a > b ? 'Avantage vous' : 'Avantage eux';
  return {
    points: [pointLabel(sc, 0), pointLabel(sc, 1)],
    games: sc.games.slice(),
    sets: sc.sets.slice(),
    server: server(sc),
    serverTeam: TEAM_OF[server(sc)],
    receiver: receiver(sc),
    side: serveSide(sc),
    note,
  };
}

const Score = {
  TEAM_OF,
  createScore,
  pointsPlayed,
  server,
  receiver,
  serveSide,
  isGoldenPoint,
  gameWinner,
  pointWon,
  pointLabel,
  display,
};

export default Score;

/*
 * Glass Lab — constantes ajustables du mode « Match infini ».
 * Toutes les valeurs sont en unités SI (mètres, secondes, m/s) sauf mention contraire.
 * Aucune logique ici : rally.js, shotgen.js et quality.js lisent ces valeurs.
 */

const CONFIG = {
  player: {
    speed: 5.0, // vitesse max de déplacement du joueur, joystick à fond (m/s, en temps de jeu)
    accel: 10, // accélération (m/s²) : ≈ 0,5 s pour atteindre la pleine vitesse
    decel: 18, // freinage (m/s²)
    reactionTime: 0.25, // délai de réaction après la frappe adverse (s)
    start: { x: 5, y: 3 }, // position de départ (m) : centre, un peu devant la ligne de service
    bounds: { xMin: 0.3, xMax: 9.7, yMin: 0.3, yMax: 9.5 }, // zone de jeu (moitié de défense)
  },

  // Joueurs IA (partenaire et adversaires) : mêmes lois de déplacement, réaction et split-step
  ai: {
    speed: 5.5, // sprint (m/s)
    accel: 10,
    decel: 18,
    reaction: 0.22, // temps de réaction après une frappe adverse (s), split-step compris
    splitDuration: 0.16, // durée du petit saut d'équilibre (s)
    hop: 0.06, // hauteur du split-step (m)
  },

  // Vue 1re personne : un seul réglage, fixé par le jeu (aucun choix de vue ni de champ de vision)
  view: {
    hFov: 108, // champ horizontal en paysage (°)
    vFovMin: 60, // champ vertical minimal (°) : le sol proche reste visible
    vFovMax: 100, // champ vertical maximal (°) : en portrait, le champ horizontal se réduit
    deadYaw: 0.22, // zone morte du regard quand la balle est loin (rad)
    basePitch: -0.28, // regard légèrement plongeant (rad, ≈ −16°)
    pitchFollow: 0.45, // suivi de la hauteur de la balle quand elle est loin (0–1)
    nearFrom: 1.2, // en deçà (m), suivi serré de la balle
    nearTo: 5.5, // au-delà (m), regard calme
    anticipation: 0.22, // balle derrière soi qui revient : on regarde où elle sera dans 0,22 s
    behindFrom: 1.4, // « derrière » commence à 80° du filet (rad)…
    behindTo: 2.27, // … et l'est complètement à 130°
    maxBack: 1.6, // le regard ne se retourne pas au-delà de ≈ 92° du filet : on se met de profil, la vitre reste au bord du champ
    focusFrom: 0.3, // dans les 0,3 dernières secondes avant la frappe prévue, le regard est posé sur le point de frappe…
    focusTo: 0.8, // … et s'y déplace progressivement à partir de 0,8 s avant
  },

  // Joystick par rapport à ce que tu regardes. La direction est figée dès que le pouce pousse franchement
  // (≥ lockOn) et tant qu'il pousse (≥ lockOff) : la caméra peut tourner sans faire dévier ta course.
  controls: { lockOn: 0.45, lockOff: 0.3 },

  strike: {
    timingTolerance: 0.25, // ± tolérance entre l'appui sur « Frappe » et le passage dans la zone (s)
    sampleDt: 1 / 120, // pas d'échantillonnage de la trajectoire (s)
  },

  /**
   * Zone de frappe par type de coup :
   *   zMin / zMax   : hauteur de contact acceptée (m)
   *   ideal         : fenêtre de hauteur idéale (m) — qualité de hauteur maximale
   *   reach         : distance horizontale max joueur ↔ balle (m)
   */
  zones: {
    volley: { zMin: 0.5, zMax: 2.0, ideal: [0.9, 1.5], reach: 1.3 },
    halfVolley: { zMin: 0.03, zMax: 0.4, ideal: [0.12, 0.35], reach: 1.2 },
    beforeGlass: { zMin: 0.35, zMax: 1.8, ideal: [0.8, 1.3], reach: 1.3 },
    afterGlass: { zMin: 0.35, zMax: 1.8, ideal: [0.8, 1.3], reach: 1.3 },
  },

  classify: {
    halfVolleyWindow: 0.15, // demi-volée : contact dans les X s après le rebond au sol
    halfVolleyMaxZ: 0.4, // … balle sous cette hauteur, et montante
  },

  quality: {
    // Poids des composantes (somme = 1)
    weights: { height: 0.35, placement: 0.3, ease: 0.15, clearance: 0.2 },
    playable: 0.45, // qualité minimale atteignable pour qu'une balle soit générée
    minReturn: 0.2, // en dessous, la frappe part dans le filet (échange perdu)
    streak: 0.6, // seuil de qualité pour prolonger la série
    good: 0.7, // ≥ : feedback vert
    ok: 0.45, // ≥ : feedback orange, sinon rouge
    decisionTolerance: 0.1, // choix « juste » si sa qualité est à moins de 0,1 du meilleur
  },

  placement: {
    // Le joueur doit être derrière la ligne de la balle (la balle devant lui, côté filet)
    ahead: [0, 0.6], // avance idéale de la balle sur le joueur, en profondeur (m)
    aheadZero: [-0.5, 1.5], // qualité nulle au-delà
    lateral: [0.45, 0.85], // distance latérale idéale (bras + raquette) (m)
    lateralZero: 0.1, // en dessous : le joueur est sous la balle
    idealOffset: { lateral: 0.65, ahead: 0.3 }, // position idéale utilisée par le « meilleur choix »
  },

  ease: {
    marginFull: 0.6, // marge de temps donnant l'aisance maximale (s)
    speedEasy: 6, // vitesse de balle confortable (m/s)
    speedHard: 22, // vitesse de balle très difficile (m/s)
  },

  clearance: {
    min: 0.2, // dégagement nul (m)
    full: 1.0, // dégagement confortable (m)
    cornerPenalty: 0.6, // facteur si la balle est à moins de `full` de deux parois
  },

  returnShot: {
    shortY: 12.5, // retombée d'un renvoi de qualité minimale (m, camp adverse : 10 → 20)
    deepY: 18.5, // retombée d'un renvoi parfait
    netMargin: 0.25, // marge au-dessus du filet (0,88 m)
    xSpread: 3.5, // dispersion latérale de la retombée autour du centre (± m)
    flightTime: [1.4, 0.9], // durée de vol : qualité faible → lente, haute qualité → rapide (s)
  },

  shotgen: {
    maxAttempts: 300, // tirages max par balle (échantillonnage par rejet)
    levels: 5,
    // Famille « directe » : rebond puis 2e rebond avant toute vitre (balle courte)
    direct: { yb: [4.5, 8.5], angle: [-12, 12], T: [[1.15, 1.5], [0.75, 1.0]], z0: [0.9, 1.6] },
    /*
     * Familles à vitres (balle qui arrive vers la paroi droite ; la gauche s'obtient par symétrie).
     * Pour chaque plage [niveau 1, niveau 5] : xb / yb = point de rebond (m), angle = angle de la
     * trajectoire par rapport à l'axe du court (°), z0 = hauteur au filet (m), T = durée filet → rebond (s).
     */
    glassT: [[0.95, 1.25], [0.6, 0.8]],
    glass: {
      A: { xb: [2.5, 7.5], yb: [0.4, 3.2], angle: [[-6, 6], [-14, 14]], z0: [0.95, 1.9] },
      B: { xb: [6.3, 9.3], yb: [0.4, 2.8], angle: [[10, 26], [18, 36]], z0: [0.95, 1.7] },
      C: { xb: [7.4, 9.6], yb: [1.6, 4.5], angle: [[22, 38], [30, 48]], z0: [0.95, 1.6] },
      D: { xb: [7.6, 9.6], yb: [3.6, 6.5], angle: [[26, 42], [34, 52]], z0: [0.95, 1.5] },
    },
  },

  /*
   * Coups des 4 joueurs (court complet). Pour chaque style :
   *   mode 'net'   : hauteur de passage au-dessus du filet (m), [niveau 1, niveau 5] ;
   *   mode 'speed' : vitesse au départ de la raquette (m/s), [niveau 1, niveau 5], trajectoire tendue ;
   *   depth        : distance du rebond à la vitre de fond du receveur (m) ;
   *   kmh          : vitesse au départ admise (km/h), ordres de grandeur du brief (à calibrer) ;
   *   apex         : hauteur maximale (m) avant le rebond ;
   *   contact      : hauteurs de frappe où le coup est jouable (m) ;
   *   spin         : effet (rad/s ; 100 rad/s ≈ 16 tours/s) — top : lift (> 0) ou coupé (< 0) ; side :
   *                  intensité de l'effet latéral, vers la paroi latérale la plus proche si toWall.
   */
  styles: {
    drive: { name: 'Balle de fond', mode: 'net', net: [[2.0, 2.9], [1.15, 1.75]], depth: [1.2, 8.6], kmh: [38, 72], apex: [0, 3.6], contact: [0.3, 1.9], spin: { top: [-60, 90], side: [0, 25] } },
    defense: { name: 'Défense après vitre', mode: 'net', net: [[2.3, 3.2], [1.5, 2.4]], depth: [1.0, 8.0], kmh: [35, 70], apex: [0, 4.2], contact: [0.3, 1.9], spin: { top: [-110, 30], side: [0, 30] } },
    lob: { name: 'Lob', mode: 'net', net: [[5.1, 7.4], [4.7, 6.9]], depth: [0.6, 3.6], kmh: [28, 52], apex: [5.0, 8.5], contact: [0.2, 1.9], spin: { top: [20, 160], side: [0, 20] } },
    chiquita: { name: 'Chiquita', mode: 'net', net: [[1.05, 1.4], [0.98, 1.25]], depth: [6.4, 9.3], kmh: [22, 48], apex: [0, 2.2], contact: [0.2, 1.5], spin: { top: [-40, 80], side: [0, 20] } },
    volley: { name: 'Volée', mode: 'speed', speed: [[14, 18], [17, 22]], depth: [1.5, 8.6], kmh: [48, 82], apex: [0, 2.4], contact: [0.5, 1.95], spin: { top: [-170, -40], side: [0, 40] } },
    bandeja: { name: 'Bandeja', mode: 'speed', speed: [[13, 16.5], [15.5, 20]], depth: [0.8, 4.8], kmh: [45, 75], apex: [0, 3.2], contact: [1.8, 3.1], spin: { top: [-200, -90], side: [20, 70] } },
    vibora: { name: 'Víbora', mode: 'speed', speed: [[16, 19.5], [19, 24]], depth: [1.0, 5.2], kmh: [55, 90], apex: [0, 3.2], contact: [1.8, 3.1], spin: { top: [-170, -70], side: [100, 190], toWall: true } },
    smash: { name: 'Smash', mode: 'speed', speed: [[22.5, 26], [26, 33]], depth: [3.0, 7.8], kmh: [80, 125], apex: [0, 3.2], contact: [2.0, 3.1], spin: { top: [0, 140], side: [0, 40] } },
    serve: { name: 'Service', mode: 'net', net: [[1.55, 2.1], [1.15, 1.55]], depth: [3.3, 9.6], kmh: [32, 62], apex: [0, 2.6], contact: [0.55, 1.0], spin: { top: [-150, -50], side: [20, 90] } },
  },
  minNetClearance: 0.05, // marge au-dessus de la bande pour un coup voulu (m)

  // Tactique du double (repère de chaque équipe : sa vitre de fond en y = 0)
  tactics: {
    defenseY: 2.4, // défense : au fond, devant les vitres (m de sa vitre)
    attackY: 7.3, // attaque : au filet
    halfWidth: 2.35, // demi-écart entre partenaires en défense (m)
    attackHalfWidth: 2.05, // … et au filet
    shift: 0.3, // déplacement latéral de la paire vers la balle (fraction de l'écart au centre)
    shiftMax: 1.1,
    centerBand: 0.75, // balle au centre (± m) : le mieux placé, à égalité celui dont le coup droit est au centre
    forehandBonus: 0.25, // avantage (s) du coup droit au centre
    alignTolerance: 2.0, // au-delà (m), le partenaire s'aligne sur toi plutôt que sur le plan de l'équipe
  },

  // Partie orientée entraînement (option b du brief) : les adversaires visent plus souvent ton côté
  training: {
    userShare: 0.65, // part des balles adverses vers toi
    partnerPlayable: 0.5, // les balles vers ton partenaire restent jouables pour lui…
    partnerWinner: 0.15, // … sauf ≈ 15 % : coups gagnants possibles
  },

  // Fautes des IA : base + part liée à la difficulté de la balle reçue + risque du coup
  errors: {
    opponent: { base: 0.075, hard: 0.32 },
    partner: { base: 0.035, hard: 0.12 },
    risk: { smash: 0.06, vibora: 0.04, chiquita: 0.03, lob: 0.02, bandeja: 0.015, volley: 0.01, drive: 0, defense: 0.01, serve: 0 },
  },
  serveFaults: [0.08, 0.035], // fautes des serveurs IA : premier, deuxième service
  // Zone de frappe au-dessus de la tête (IA : bandeja, víbora, smash)
  overhead: { zMin: 1.9, zMax: 3.1, ideal: [2.3, 2.8], reach: 1.0 },

  // Score : point en or à 40-40 (vrai) ou avantage (faux). Fixé par le jeu, pas de réglage.
  score: { golden: true },

  difficulty: {
    window: 10, // nombre de balles récentes considérées
    up: 0.8, // taux de réussite au-delà duquel le niveau monte
    down: 0.5, // en dessous, il descend
  },

  rally: {
    // Échange continu : l'adversaire court jouer ton renvoi et renvoie depuis l'endroit où il le frappe
    oppSpeed: 6, // vitesse max de l'adversaire (m/s)
    oppHitHeight: 1.0, // il frappe ton renvoi quand il redescend à cette hauteur après le rebond (m)
    oppMaxY: 19.2, // … et avant la vitre de fond adverse (m, la vitre est en y = 20)
    oppStepIn: 2.5, // il ne laisse pas la balle filer plus de 2,5 m après le rebond : renvoi court = il avance
    oppReach: 0.6, // décalage latéral entre l'adversaire et la balle qu'il frappe (m)
    serve: { x: [2.5, 7.5], y: [17, 18.5], z: 1.0 }, // départ d'un nouveau point après une faute
    // Hauteur de passage au-dessus du filet, niveau 1 → niveau 5 (m) : plus basse = balle plus tendue et rapide
    netHeight: [[2.2, 3.2], [1.1, 1.8]],
    attackDrop: 0.35, // jusqu'à 0,35 m plus bas quand l'adversaire frappe près du filet (renvoi court = attaque)
    minNetHeight: 0.98, // jamais sous le haut du filet + marge (m)
    hSpeed: [5, 24], // vitesse horizontale admise des balles adverses (m/s)
  },
  game: {
    // Vitesse du jeu fixée par la difficulté adaptative (remplace l'ancien réglage) : le niveau 1 démarre
    // plus lent, le niveau 5 est en temps réel
    levelSpeed: [0.75, 0.84, 0.92, 0.97, 1],
    missPause: 1.3, // pause après un échange perdu (s de jeu)
    feedbackMs: 1800, // durée d'affichage du feedback (ms, temps réel)
  },
};

export default CONFIG;

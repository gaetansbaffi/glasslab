# Glass Lab — état des lieux après reconstruction

> État au 1ᵉʳ octobre 2026 (effets, système de points, caméra calme, balles hautes, vraie physique ajoutés), dépôt `gaetansbaffi/glasslab`, branche `claude/admiring-dirac-jzm3bk`.
> Le brief de reconstruction précédent (état du dépôt `glassmaster`, branche `claude/confident-curie-9n5fu8-jeu`) est dans l'historique git : commit `03ca104`.
> Statut des informations : **[fait]** vérifié dans le code ou par les tests · **[à vérifier]** non vérifiable sans un vrai téléphone ou un joueur · **[reco]** recommandation.

---

## 1. En une phrase

Glass Lab est devenu un **match de padel en double, vécu en 1re personne dans le corps du joueur** : toi et ton partenaire IA contre deux adversaires IA, en 1 set ou en 2 sets gagnants, avec service, vrai score du padel, effets de balle et positions d'attaque et de défense. Ta balle garde la logique d'entraînement d'origine : tu te places, tu appuies sur **Frappe**, le jeu compare ton coup au meilleur coup possible.

## 2. Ce qui a été fait, étape par étape [fait]

| Étape (ordre du brief) | Commit | Livré |
|---|---|---|
| 0. Import du code d'origine | `03ca104` | copie exacte de `glassmaster`, 50 tests verts |
| 1. 1re personne incarnée, mode unique | `19a2a37` | tête et corps séparés, corps complet, bras en cinématique inverse, 3 réglages, `main.js` découpé |
| 2. Court complet, 4 joueurs | `b82ae30` | filet obstacle, vitres adverses, positions, qui prend la balle, IA (défense, lob, volée, etc.), option (b) |
| 3. Service, score, coups avancés, calibrage | `d424d46` | service réel, score du padel, bandeja / víbora / smash / chiquita, test de calibrage |
| 4. Effets de balle (demande après publication) | `4cafdb1` | coupé, lift, latéral en vol et aux rebonds ; effet par coup ; balle qui tourne ; étiquette et Détail |
| 5. Vrai système de points (demande après publication) | `eff478a` | formats 1 set / 2 sets gagnants, super jeu décisif, fin de match, tableau de score, annonces, reprise |
| 6. Caméra calme (retour du joueur) | `ddbbb7f` | tête plus lente, de profil au plus, regard posé sur le point de frappe, joystick par rapport au regard |
| 7. Balles hautes (retour du joueur) | `510566b` | bandeja / víbora / smash pour toi, lob court des IA, ombre cerclée, point de chute au sol, mini-carte |
| 8. Vraie physique (retour du joueur) | `9f37cfd` | air (traînée, Magnus), rebonds avec frottement et restitution réalistes, grillage, temps réel à tous les niveaux |

`node test/run.js` : **110 tests, 0 échec** (les 10 tests de l'ancien duel, retiré, ne comptent plus). Chaque étape a été jouée en navigateur sans affichage (Chromium, WebGL logiciel) par un joueur automatique, sans erreur JavaScript.

## 3. Critères d'acceptation du brief (§9)

| Critère | Statut |
|---|---|
| De l'ouverture à la première balle : 1 appui | **[fait]** Jouer → service adverse vers toi après ≈ 1,8 s, sans autre action (test). |
| Aucun scroll, zoom ou menu involontaire ; joystick et Frappe en même temps | **[fait]** conservé de la version d'origine (multi-touch, `touch-action`, `preventDefault`). **[à vérifier]** sur téléphone. |
| 1re personne incarnée (§6), aucun choix de vue ni de champ | **[fait]** voir §4. Le Détail garde ses vues de replay (1re personne, dessus, côté) : ce sont des vues d'analyse, pas de jeu. |
| Partie à 4 joueurs (§7) : animés, attaque / défense, attribution, service et score, vitesses du tableau | **[fait]** voir §5 et §6. |
| 3 réglages au maximum | **[fait]** son et vibration, mode gaucher, données (test en navigateur : 2 interrupteurs + Données). |
| Logique conservée et étendue, `src/core` pur, tests ajoutés (tête, corps, IK, déplacements, positions, attribution, service, score) | **[fait]** 45 des 50 tests d'origine conservés (2 adaptés au déplacement avec accélération) ; les 5 autres testaient la vue épaule, la caméra derrière le joueur, le déplacement relatif au regard et l'ancienne raquette, retirés avec ces fonctions et remplacés par les tests du corps ; 50 tests ajoutés. |
| 60 i/s sur un téléphone milieu de gamme ; PWA hors ligne | **[à vérifier]** ≈ 25 appels de rendu et ≈ 7 000 triangles par image, résolution dynamique et ombres coupables automatiquement ; jamais mesuré sur un vrai téléphone. Service worker mis à jour (`glasslab-v4.5.0`). |

## 4. La 1re personne [fait sauf mention]

- **Yeux** à 1,65 m, en avant du pivot du cou, qui tournent avec la tête : en regardant vers le bas, ils avancent et descendent comme dans un vrai corps (`body.eyePosition`).
- **Champ de vision fixe** : 108° horizontal en paysage (téléphone 19,5:9 → 64,8° vertical ; 16:9 → 75°), vertical entre 60° et 100°, horizontal réduit en portrait.
- **Tête et corps séparés** (`body.lookStep`) : regard lissé (demi-vie 0,08 s, au plus 4 rad/s ≈ 230°/s), cou limité à ±80°, le corps ne pivote qu'au-delà de 55° et jusqu'à 115°. Les angles sont « déroulés » : la tête ne reste jamais bloquée en revenant d'une balle passée derrière. Aucun roulis.
- **Regard qui suit la balle** (`body.gazeTarget`) : zone morte et suivi partiel quand la balle est loin, suivi serré quand elle approche ; sur une sortie de vitre qui revient, anticipation de 0,22 s ; **de profil au plus** (≈ 92° du filet, sans volte-face d'un côté à l'autre) ; **regard posé sur le point de frappe** dans la dernière seconde avant la frappe prévue.
- **Caméra calmée après retour du joueur** (« la caméra est compliquée, elle fait des trucs bizarres avec le déplacement »). Mesures sur 360 balles simulées (3 séries de 120), avant → après : grands pivots (> 90° en 1 s) 93 à 104 → 31 à 38 par série (≈ −65 %) ; vitesse maximale de la tête 516 → 229°/s ; temps passé à tourner vite (> 3 rad/s) ≈ 25 % → ≈ 15 % ; balle hors champ au contact 5 → **0 sur 360**. En partie dans le navigateur : regard à plus de 100° du filet 6–8 % → 0 % du temps.
- **Joystick par rapport au regard** (`geometry.viewRelativeMove`), à la place du repère du court imposé par le brief : haut = devant soi ; direction figée dès que le pouce pousse franchement et tant qu'il pousse, pour que la rotation de la caméra ne fasse pas dévier la course.
- **Corps** : 16 pièces low-poly par joueur ; buste, bras, jambes et pieds visibles en regardant vers le bas ; ton ombre portée devant toi (soleil derrière ton équipe).
- **Bras et raquette** : cinématique inverse à deux segments, la main tient la prise (test sur toutes les poses). Garde : haut du cadre visible en bas de l'écran, entre le centre et le bouton Frappe. Préparation : le tamis se présente du côté de la balle, à 0,45–0,85 m (la portée idéale). Geste synchronisé avec le contact ; en 1re personne, la main et la raquette restent à plus de 0,3 m des yeux (test).
- **Lisibilité** : balle 2×, contour, ombre ronde, trait vers le sol, anneau de portée ; sur les balles hautes, ombre cerclée, point de chute et mini-carte (§ 5.3).
- **[à vérifier]** Le critère du brief — « juger sa position et la balle au moins aussi bien qu'en vue épaule à 110° » — dépend du ressenti d'un joueur : non vérifiable ici.

## 5. La partie à 4 [fait]

- **Physique** : court complet (`physics.simulate(…, { court: 'full' })`) avec les deux moitiés, toutes les vitres et le filet comme obstacle (dans le filet : la balle retombe de son côté ; bande frôlée : elle passe ralentie). Le demi-court historique reste le mode par défaut, inchangé. Tests : aucune traversée, symétrie, cohérence avec le demi-court.
- **Joueurs** : accélération, freinage, réaction, split-step (`players.js`) ; ta course aussi (5 m/s, ≈ 0,5 s pour la pleine vitesse). L'atteignabilité des balles utilise ce modèle.
- **Tactique** (`tactics.js`) : défense à 2,4 m de la vitre, attaque à 7,3 m ; partenaires alignés (le partenaire s'aligne sur toi si tu restes au fond) ; transitions sur lob profond et balle courte ; qui prend la balle (côté, centre, coup droit) ; interception des IA (y compris au-dessus de la tête) ; choix du coup ; fautes.
- **Option (b) orientée entraînement** : 67 % des balles adverses vers toi sur 6 parties simulées (cible 65 %), en familles de vitres selon la répétition espacée ; stats et feedback sur tes coups, avec le contexte du double (alignement, ton côté) dans le message et le Détail.
- **Service et score** (`score.js`, `match.js`) : service à la cuillère après rebond, derrière la ligne de service, en diagonale ; carré, faute, deuxième service, double faute, let, retour après le rebond ; 15-30-40-jeu, point en or (avantage dans `config.js`), jeux, jeu décisif ; rotation du service.

### 5.1 Effets de balle [fait]

- **Modèle** (`physics.js`, depuis l'étape 8, § 5.4) : la balle porte un vecteur rotation. En vol, effet Magnus avec la portance mesurée sur des balles feutrées ; aux contacts (sol, vitres), le frottement agit sur la vraie vitesse de glissement (vitesse + rotation), jusqu'au roulement au plus.
- **Effets mesurés** sur une balle type (58 km/h, même point de rebond, 1 s de vol) : hauteur maximale après la vitre de fond **0,74 m coupée**, 1,24 m sans effet, **1,72 m liftée** ; vitesse horizontale après le rebond 6,8 / 7,6 / 9,3 m/s (11,8 avant) ; latéral (150 rad/s) : 1,05 m/s de déviation au rebond.
- **Effet de chaque coup** (`config.styles.*.spin`) : bandeja, volée, service coupés ; víbora coupée et latérale vers la grille ; lob lifté ; smash plat ou lifté ; fond de court et défense variés. Balles reçues sur 3 matchs simulés : **coupées 33 %, liftées 20 %, coupées latérales 6 %, sans effet marqué 41 %**.
- **Lisibilité** : balle avec sa couture, qui tourne selon l'effet (rotation affichée ralentie à 12 %, au plus 22 rad/s, sinon illisible à 60 i/s) ; étiquette de 1,3 s sur la balle qui t'arrive ; ligne « Effet » dans le Détail (ce que l'effet change et quoi faire).
- **Rythme** : ≈ 10 frappes et ≈ 23 s par point ; génération d'un coup au pire ≈ 12 ms sur PC (7,5 ms avant l'étape 8).

### 5.2 Vrai système de points [fait]

- **Formats** (`score.js`) : **1 set** (6 jeux, jeu décisif à 6-6) ou **2 sets gagnants** avec, à 1 set partout, un **super jeu décisif** en 10 points (2 d'écart). Le match se termine : vainqueur, score par set, plus de service.
- **Enjeux et annonces** : balle de break, de set, de match (pour vous / pour eux), point en or, jeu décisif ; annonce de l'arbitre après chaque point, **score du serveur en premier** (« 30-15 », « 15 partout », « 40 partout · point en or »), avec la raison du point ; « Jeu · vous », « Set · eux · 6-4 », « Jeu, set et match ».
- **Interface** : tableau de score type télévision en haut à gauche ; accueil avec le format, « Reprendre » (match sauvegardé à chaque point, relu et validé au chargement) et « Nouveau match » ; écran de fin (victoire ou défaite, score par set, points, tes indicateurs) ; bilan des matchs dans Stats. Le compteur « série » quitte l'écran de jeu (il reste dans la pause et les stats).
- **Durée mesurée** (joueur automatique qui laisse passer 1 balle sur 4, niveau 3) : **1 set en 15 à 27 min de jeu** (6-1, 4-6, 7-5), mesuré avant l'étape 8 (le jeu tourne maintenant en temps réel à tous les niveaux). Un match en 2 sets gagnants équilibré devrait durer 30 à 50 min (estimation, non mesurée sur un match serré).

### 5.3 Balles hautes : coups au-dessus de la tête et lisibilité [fait]

- **Retour du joueur** : « les balles hautes sont très dures à comprendre, donc les bandejas et smashs très compliqués ». Deux causes : tu n'avais **pas de coup au-dessus de la tête** (une balle au-dessus de 2 m se jouait après le rebond) ; et en 1re personne, quand le regard monte vers un lob (jusqu'à 40°, avec 66° de champ vertical en paysage), **le bas de l'écran passe au-dessus de l'horizon** : le sol, ton ombre et le point de chute sortent du champ au moment où il faut se placer.
- **Coup au-dessus de la tête** (`zones.overhead`) : contact avant le rebond entre 1,9 et 3,1 m (idéal 2,3 à 2,8 m), portée 1 m, balle à 0,35 m sur le côté et 0,3 m devant toi. Renvoi automatique : **bandeja** par défaut, **víbora** une fois sur trois sur un bon coup (qualité ≥ 0,6), **smash** sur une balle très bien jouée (qualité ≥ 0,8) à moins de 5 m du filet et prise à 2,45 m ou plus. Geste au-dessus de la tête, main et raquette hors des yeux (test) ; balle visible au contact sur 60 lobs courts simulés (test). Au retour de service, c'est une faute (comme une volée).
- **Préférence tactique** (`userPrefer.attack`) : au filet, le meilleur choix ajoute +0,06 au coup au-dessus de la tête et +0,03 à la volée (garder le filet) ; le message affiche « bon choix » dès que ton coup est à moins de 0,1 du meilleur.
- **Lob court des IA** (`styles.lobShort`) : 3,2 à 5,4 m de haut, il retombe entre 3,6 et 6,2 m de la vitre ; une IA remplace son lob par un lob court d'autant plus souvent que sa frappe est mauvaise (25 % à 70 %).
- **Aides, du coup adverse au rebond** (≈ 2 s en médiane) : ombre plus foncée et cerclée de blanc ; **point de chute** (cible jaune au sol, dans le court) ; **mini-carte** (104 px, en haut à droite sous Pause, rayon 7 m) **orientée comme le joystick**, y compris quand sa direction est figée pendant la course : toi au centre avec l'anneau de portée, ton partenaire, la balle (plus grosse quand elle est haute), son trajet en pointillés jusqu'au point de chute (hors de la surface du court si elle sort) et un **cercle vert à ta place idéale pour le coup au-dessus de la tête** (même repère que le cercle vert du Détail). Le point de chute est calculé une fois par vol (`flight.landing`) et toujours d'accord avec l'arbitrage (test).
- **Mesures** (6 parties de 5 min, joueur parfait, niveau 3) : balles hautes vers ton camp **18 % des frappes adverses** (83 sur 452), dont 49 pour toi, avec un smash possible sur 37. Sur tes 249 balles : coup au-dessus de la tête **meilleur choix 8 %**, possible 16 % ; 20 joués : **bandeja 12, víbora 5, smash 3**.

### 5.4 Vraie physique de balle [fait]

- **Retour du joueur** : « les rebonds sur les lobs et volées n'ont aucun sens, pas cohérents avec la réalité terrestre » (et « je ne vois pas de différence » sur les aides aux balles hautes). Diagnostic mesuré en partie : le modèle d'effet ajoutait de la vitesse au rebond (frottement calculé sur la rotation seule, pas sur le vrai glissement), la restitution était fixe, il n'y avait pas d'air, et le jeu tournait au ralenti aux bas niveaux (75 % au niveau 1 : gravité perçue ≈ 0,56 g, des balles « de Lune »).
- **Air** : traînée (C_D 0,55, balle de 57,7 g et 6,6 cm) et effet Magnus (C_L = S / (2,022 S + 0,981), S = R ω / v, mesures publiées sur des balles feutrées). Vitesse limite ≈ 22 m/s ; un smash parti à 110 km/h rebondit à ≈ 95 km/h et touche la vitre vers 55 km/h ; un lob retombe plus raide qu'il ne monte.
- **Rebonds** : glissement puis roulement selon le frottement (gazon μ 0,6, vitre 0,3), restitution qui baisse avec la vitesse d'impact (gazon 0,78 − 0,009 v, vitre 0,80 − 0,0095 v : essai du règlement FIP respecté sur surface dure, ≈ 1,2 m sur le gazon) ; le grillage amortit (restitution 0,35). Test : 2 000 contacts aléatoires, jamais d'énergie créée, jamais de frottement au-delà du roulement.
- **Calcul** : segments de 0,05 s d'accélération constante, évaluée au milieu (écart < 2 cm avec une intégration RK4 très fine, test) ; chaque contact reste exact dans son segment ; tir itératif (Broyden) pour viser un rebond ; la balle vue par le receveur est le vol complet lui-même.
- **Avant → après, en partie** (4 parties de 4 min, joueur parfait, niveau 3) :

| Mesure | Avant | Après |
|---|---|---|
| Hauteur de remontée d'un lob après son rebond (médiane / max) | 3,81 / 4,62 m | **2,35 / 2,78 m** |
| Lobs qui accélèrent au rebond | 65 % (jusqu'à +38 %) | 8 % (lift très appuyé seulement) |
| Vitesse horizontale gardée au rebond (fond de court / volée) | 0,92 / 0,85 | **0,66 / 0,71** |
| Vitesse gardée à la vitre (fond de court / smash) | 0,84 / 0,91 | 0,82 / 0,76 |
| Vitesse du temps au niveau 1 | 75 % | **100 %** |
| Temps médian entre la frappe adverse et ton point de frappe idéal, niveau 1 | 2,23 s (ralenti) | 1,56 s |

## 6. Calibrage (tableau du brief) [fait]

Mesuré sur 4 parties simulées de 5 minutes (joueur parfait, vraie physique depuis l'étape 8), et vérifié par un test :

| Élément | Brief | Jeu |
|---|---|---|
| Balle de fond / défense | 40–70 km/h | 38–72 et 35–70 km/h (médiane 61 et 50) |
| Volée | 50–80 km/h | 60–83 km/h (médiane 68) |
| Lob | 30–50 km/h, 5–8 m | **43–59 km/h** (médiane 52), 5,1–8,4 m : avec l'air, il faut partir plus vite pour monter à 5–8 m et retomber au fond |
| Smash | 80–120 km/h et plus | 98–125 km/h (médiane 111, rare : au filet seulement) |
| Course / sprint | 2–4 / 5–6 m/s | IA 5,5 m/s (replacement à 55 %), toi 5 m/s |
| Pleine vitesse | ≈ 0,5 s | 0,5 s (toi), 0,55 s (IA) |
| Réaction | 0,2–0,3 s | 0,22 s (IA), 0,25 s (calcul de l'atteignabilité) |
| Temps entre deux frappes | 1–2 s, plus court au filet | médiane 1,6 s, plus court au filet (test) |

Répartition des coups : balles de fond et défense ≈ 50 %, lobs ≈ 22 % (dont lobs courts 4 %), chiquitas ≈ 10 %, services 6 %, volées 4 %, coups au-dessus de la tête ≈ 8 %.

## 7. Choix faits, à valider [reco]

- **Côté du joueur** : tu joues à droite (côté « drive »), ton partenaire à gauche ; au service, les serveurs changent de côté à chaque point comme dans le règlement, puis chacun regagne son côté.
- **Point en or par défaut** (règle répandue), l'avantage est un simple réglage de `config.js` (pas d'écran : 3 réglages maximum).
- **Format par défaut : 1 set** (15 à 27 min) ; le format 2 sets gagnants utilise le super jeu décisif au 3e set pour rester jouable sur téléphone. Le choix se fait sur l'accueil (ce n'est pas un réglage) et « Jouer » reste à 1 appui.
- **Annonce dans la convention de l'arbitre** (score du serveur en premier) : réaliste, mais « 15-30 » peut surprendre quand c'est ton équipe qui mène ; le tableau de score reste par équipe.
- **Effets** : valeurs plausibles (≈ 3 à 32 tours/s), non mesurées sur de vrais joueurs ; rotation affichée ralentie ; étiquette d'effet = aide d'entraînement (un vrai joueur lit l'effet sur le geste adverse).
- **Replacement entre deux points** : court fondu au noir, les 4 joueurs sont replacés pour le service (plus confortable en 1re personne qu'un déplacement automatique de la caméra).
- **Ton renvoi reste automatique** (lob, balle de fond ou volée selon la situation et ta qualité) : le brief entraîne la décision, pas le geste.
- **Temps réel à tous les niveaux** (fin du ralenti, qui faussait la gravité) : au niveau 1, ≈ 30 % de temps en moins pour réagir qu'avant (1,56 s au lieu de 2,23 s en médiane). Contre-argument : le niveau 1 devient plus dur ; des balles de débutant plus lentes et plus hautes au niveau 1 ont été essayées : elles ne rendent que ≈ 0,1 s (le temps dépend surtout du type de coup). Si c'est trop dur, l'aide à prévoir est d'élargir la fenêtre de frappe aux bas niveaux, pas de ralentir le temps.
- **Physique de référence** : coefficients publiés pour des balles feutrées et règlement FIP ; gazon (restitution un peu plus faible que sur surface dure, frottement 0,6), vitre (frottement 0,3) et grillage (restitution 0,35) sont des valeurs plausibles, à confirmer par un joueur.
- **Aides aux balles hautes fortes** : la mini-carte dit où tombe la balle et où te placer. Contre-argument : un vrai joueur doit le lire seul, et le cercle vert apparaît dès qu'un smash est possible, même quand laisser rebondir serait meilleur (possible sur 16 % de tes balles, meilleur choix sur 8 %). Options si c'est trop facile : mini-carte réservée aux niveaux 1 à 3, ou point de chute seul.
- **Seuils du renvoi au-dessus de la tête** (smash : qualité ≥ 0,8, à moins de 5 m du filet, contact ≥ 2,45 m ; víbora : qualité ≥ 0,6, une fois sur trois) et préférence au filet (+0,06) : non calibrés avec un entraîneur.
- **Le partenaire est fiable** (≈ 2 fois moins de fautes que les adversaires) pour ne pas frustrer ; les adversaires peuvent gagner des points contre lui (≈ 15 % de ses balles ne sont pas forcément jouables).

## 8. Limites et dette connues [fait]

- **Jamais testé sur un vrai téléphone** ; tests navigateur en Chromium sans affichage, rendu WebGL logiciel. Sur iOS, pas d'API plein écran dans Safari ni de vibration.
- **Physique de référence, pas mesurée sur un vrai court** : la rotation ne s'amortit pas en vol ; le grillage est un simple amortisseur ; murs infinis (pas de balle « por 3 » ou « por 4 ») ; balle toujours neuve (pas d'usure ni de perte de pression).
- **Tu ne choisis pas l'effet ni la direction de ton renvoi** : ils suivent le coup choisi automatiquement.
- **Pas de changement de côté** aux jeux impairs (court symétrique, tu restes en bas).
- **Pas de contact raquette-balle** : la frappe est jugée sur la position et le moment d'appui.
- **Heuristiques non calibrées avec des entraîneurs** : qualité, meilleur choix, choix des coups et fautes des IA.
- **Joystick par rapport au regard** (choix du joueur, contre le brief) : la direction reste figée tant que le pouce pousse ; après une grande rotation de la caméra, il faut relâcher pour repartir dans la direction regardée.
- **Pas de coup au-dessus de la tête après le rebond** (balle haute qui ressort de la vitre) : elle se joue en défense. Tu ne choisis pas entre bandeja, víbora et smash (automatique).
- **`src/core` alloue de petits objets à chaque pas** (états immuables, 4 joueurs) ; la génération d'une balle à la frappe adverse coûte ≈ 0,4 ms en médiane et jusqu'à ≈ 9 ms au pire sur PC (≈ 4 fois plus sur téléphone : une image sautée possible, rarement).
- L'ancien duel (`rally.js`) et le générateur de balles du demi-court ont été retirés à l'étape 8 : le jeu ne les utilisait plus et ils reposaient sur l'ancienne physique sans air (les motifs de perte sont dans `match.js`).
- **Publication** : chaque envoi publie après les tests ; une version plus ancienne que celle en ligne n'est jamais republiée (cas vécu : la création de `main` sur le commit d'import avait remis l'ancien jeu en ligne) ; une republication sans nouveau code passe par « Run workflow » ou une étiquette `publication-*` (droits du propriétaire du dépôt : l'accès de Claude Code est refusé, 403) ; la version en ligne s'affiche en bas de l'accueil.

## 9. À tester à la main sur un vrai téléphone [à vérifier]

1. Ouverture → Jouer → premier service : 1 appui, plein écran et paysage (Android), installation PWA (Android et iOS), lancement hors ligne.
2. Joystick et Frappe en même temps, aucun zoom, scroll ou menu contextuel ; mode gaucher.
3. **Confort de la 1re personne** : aucune nausée sur 5 minutes en paysage ; caméra calme (de profil au plus quand la balle passe derrière) ; regard posé sur le point de frappe juste avant de frapper ; court fondu entre les points.
3 bis. **Joystick par rapport au regard** : haut = devant soi ; la course ne dévie pas quand la caméra tourne ; relâcher pour repartir dans la direction regardée.
4. **Lisibilité** : juger sa position par rapport à la balle (ombre, trait, anneau, raquette présentée) au moins aussi bien qu'en vue épaule à 110° ; balle visible au moment de frapper.
5. Garde : haut de la raquette visible sans masquer le jeu ni être caché par le bouton Frappe ; ses bras et ses jambes en regardant vers le bas.
6. Cadence : 60 i/s visés (`?debug=1`) ; que la résolution dynamique et la coupure des ombres suffisent.
7. Partie : positions crédibles, annonces « À moi ! / À toi ! », ton service (invite, Frappe), score, jeu, set, fautes de service.
8. Son, vibration, Wake Lock, pause automatique quand l'application passe en arrière-plan.
9. **Effets** : l'étiquette (« Balle coupée »…) se lit sans gêner ; la rotation de la balle se voit quand elle approche ; une balle coupée reste basse après la vitre, une liftée sort haut (ressenti de joueur).
10. **Score** : tableau lisible en plein jeu sur un petit écran ; annonces compréhensibles (« 15-30 » serveur d'abord) ; fin de match et écran de fin ; **Reprendre** après avoir fermé l'application (le match reprend au même score).
11. **Balles hautes** : la mini-carte se lit d'un coup d'œil sans gêner (taille, place sous Pause) ; pousser le pouce vers le cercle vert y mène ; le point de chute au sol aide quand il est visible ; bandeja et smash réussis sur un lob court ; trop ou pas assez d'aide ?
12. **Physique** : rebonds des lobs, des volées et des sorties de vitre crédibles (« comme sur un vrai court ») ; vitesse du jeu au niveau 1 supportable en temps réel.

## 10. Suites possibles [reco]

1. Tester sur 2 ou 3 téléphones (Android milieu de gamme, iPhone) et ajuster le confort (vitesse de tête, zone morte, fondu) et la cadence.
2. Calibrer avec un entraîneur : poids de la qualité, meilleur choix, choix des coups et fautes des IA, part des balles vers toi.
3. Sorties « por 3 / por 4 » (murs finis, balle jouable hors du court) ; valider avec un joueur les rebonds sur le gazon, les vitres et le grillage.
4. Donner au joueur le choix de la direction et de l'effet de son renvoi (par exemple : glisser sur Frappe vers le haut = lift, vers le bas = coupé), si l'entraînement de la décision le justifie.
5. Changement de côté aux jeux impairs (pause de 90 s raccourcie) et statistiques par match (aces, fautes directes, coups gagnants).

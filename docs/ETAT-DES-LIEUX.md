# Glass Lab — état des lieux après reconstruction

> État au 1ᵉʳ octobre 2026 (effets et système de points ajoutés), dépôt `gaetansbaffi/glasslab`, branche `claude/admiring-dirac-jzm3bk`.
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

`node test/run.js` : **109 tests, 0 échec**. Chaque étape a été jouée en navigateur sans affichage (Chromium, WebGL logiciel) par un joueur automatique, sans erreur JavaScript.

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
- **Tête et corps séparés** (`body.lookStep`) : regard lissé (demi-vie 0,05 s, au plus 9 rad/s), cou limité à ±80°, le corps ne pivote qu'au-delà de 55° et jusqu'à 115°. Les angles sont « déroulés » : la tête ne reste jamais bloquée en revenant d'une balle passée derrière. Aucun roulis.
- **Regard qui suit la balle** (`body.gazeTarget`) : zone morte et suivi partiel quand la balle est loin, suivi serré quand elle approche ; sur une sortie de vitre qui revient, anticipation de 0,22 s. Mesure sur 109 frappes simulées : sans anticipation, 23 balles hors du champ au contact (tête limitée à 7 rad/s) ou 16 (à 9 rad/s) ; avec anticipation et 9 rad/s, **0 sur 109**, et l'impact sur la vitre reste visible 79 % du temps (contre 84 % sans anticipation).
- **Corps** : 16 pièces low-poly par joueur ; buste, bras, jambes et pieds visibles en regardant vers le bas ; ton ombre portée devant toi (soleil derrière ton équipe).
- **Bras et raquette** : cinématique inverse à deux segments, la main tient la prise (test sur toutes les poses). Garde : haut du cadre visible en bas de l'écran, entre le centre et le bouton Frappe. Préparation : le tamis se présente du côté de la balle, à 0,45–0,85 m (la portée idéale). Geste synchronisé avec le contact ; en 1re personne, la main et la raquette restent à plus de 0,3 m des yeux (test).
- **Lisibilité** : balle 2×, contour, ombre ronde, trait vers le sol, anneau de portée.
- **[à vérifier]** Le critère du brief — « juger sa position et la balle au moins aussi bien qu'en vue épaule à 110° » — dépend du ressenti d'un joueur : non vérifiable ici.

## 5. La partie à 4 [fait]

- **Physique** : court complet (`physics.simulate(…, { court: 'full' })`) avec les deux moitiés, toutes les vitres et le filet comme obstacle (dans le filet : la balle retombe de son côté ; bande frôlée : elle passe ralentie). Le demi-court historique reste le mode par défaut, inchangé. Tests : aucune traversée, symétrie, cohérence avec le demi-court.
- **Joueurs** : accélération, freinage, réaction, split-step (`players.js`) ; ta course aussi (5 m/s, ≈ 0,5 s pour la pleine vitesse). L'atteignabilité des balles utilise ce modèle.
- **Tactique** (`tactics.js`) : défense à 2,4 m de la vitre, attaque à 7,3 m ; partenaires alignés (le partenaire s'aligne sur toi si tu restes au fond) ; transitions sur lob profond et balle courte ; qui prend la balle (côté, centre, coup droit) ; interception des IA (y compris au-dessus de la tête) ; choix du coup ; fautes.
- **Option (b) orientée entraînement** : 67 % des balles adverses vers toi sur 6 parties simulées (cible 65 %), en familles de vitres selon la répétition espacée ; stats et feedback sur tes coups, avec le contexte du double (alignement, ton côté) dans le message et le Détail.
- **Service et score** (`score.js`, `match.js`) : service à la cuillère après rebond, derrière la ligne de service, en diagonale ; carré, faute, deuxième service, double faute, let, retour après le rebond ; 15-30-40-jeu, point en or (avantage dans `config.js`), jeux, jeu décisif ; rotation du service.

### 5.1 Effets de balle [fait]

- **Modèle** (`physics.js`) : la balle porte un vecteur rotation. En vol, effet Magnus figé sur chaque segment (le calcul reste exact et déterministe) ; aux contacts (sol, vitres), le frottement transforme une partie de la rotation en vitesse, dans la limite du frottement disponible. **Sans effet, la trajectoire est identique au bit près** à l'ancienne (vérifié sur la physique, la génération des coups et une partie complète, puis par un test).
- **Effets mesurés** sur une balle type (même point de rebond, 1 s de vol) : hauteur maximale après la vitre de fond **0,65 m coupée**, 0,99 m sans effet, **1,54 m liftée** ; vitesse après le rebond 10,3 / 12,2 / 14,0 m/s ; latéral (150 rad/s) : 2,2 m/s de déviation au rebond.
- **Effet de chaque coup** (`config.styles.*.spin`) : bandeja, volée, service coupés ; víbora coupée et latérale vers la grille ; lob lifté ; smash plat ou lifté ; fond de court et défense variés. Balles reçues sur 3 matchs simulés : **coupées 33 %, liftées 20 %, coupées latérales 6 %, sans effet marqué 41 %**.
- **Lisibilité** : balle avec sa couture, qui tourne selon l'effet (rotation affichée ralentie à 12 %, au plus 22 rad/s, sinon illisible à 60 i/s) ; étiquette de 1,3 s sur la balle qui t'arrive ; ligne « Effet » dans le Détail (ce que l'effet change et quoi faire).
- **Rythme inchangé** : ≈ 10 frappes et ≈ 23 s par point (30 s avant, sur un autre tirage) ; génération d'un coup au pire ≈ 7 ms sur PC.

### 5.2 Vrai système de points [fait]

- **Formats** (`score.js`) : **1 set** (6 jeux, jeu décisif à 6-6) ou **2 sets gagnants** avec, à 1 set partout, un **super jeu décisif** en 10 points (2 d'écart). Le match se termine : vainqueur, score par set, plus de service.
- **Enjeux et annonces** : balle de break, de set, de match (pour vous / pour eux), point en or, jeu décisif ; annonce de l'arbitre après chaque point, **score du serveur en premier** (« 30-15 », « 15 partout », « 40 partout · point en or »), avec la raison du point ; « Jeu · vous », « Set · eux · 6-4 », « Jeu, set et match ».
- **Interface** : tableau de score type télévision en haut à gauche ; accueil avec le format, « Reprendre » (match sauvegardé à chaque point, relu et validé au chargement) et « Nouveau match » ; écran de fin (victoire ou défaite, score par set, points, tes indicateurs) ; bilan des matchs dans Stats. Le compteur « série » quitte l'écran de jeu (il reste dans la pause et les stats).
- **Durée mesurée** (joueur automatique qui laisse passer 1 balle sur 4, niveau 3) : **1 set en 15 à 27 min de jeu** (6-1, 4-6, 7-5). Au niveau 1, le jeu tourne à 75 % du temps réel : compter un tiers de plus. Un match en 2 sets gagnants équilibré devrait durer 30 à 50 min (estimation, non mesurée sur un match serré).

## 6. Calibrage (tableau du brief) [fait]

Mesuré sur 4 parties simulées de 5 minutes (joueur parfait), et vérifié par un test :

| Élément | Brief | Jeu |
|---|---|---|
| Balle de fond / défense | 40–70 km/h | 35–72 km/h (médiane 60 et 47) |
| Volée | 50–80 km/h | 56–75 km/h |
| Lob | 30–50 km/h, 5–8 m | 36–49 km/h, 5,0–8,3 m |
| Smash | 80–120 km/h et plus | 95–101 km/h (rare : au filet seulement) |
| Course / sprint | 2–4 / 5–6 m/s | IA 5,5 m/s (replacement à 55 %), toi 5 m/s |
| Pleine vitesse | ≈ 0,5 s | 0,5 s (toi), 0,55 s (IA) |
| Réaction | 0,2–0,3 s | 0,22 s (IA), 0,25 s (calcul de l'atteignabilité) |
| Temps entre deux frappes | 1–2 s, plus court au filet | médiane 1,6 s ; 1,4 s quand les deux équipes sont au filet |

Rythme : ≈ 10 frappes et ≈ 22 s par point avec un joueur qui laisse passer une balle sur quatre. Répartition des coups : balles de fond et défense ≈ 42 %, lobs ≈ 29 %, chiquitas ≈ 10 %, volées ≈ 6 %, coups au-dessus de la tête ≈ 6 %.

## 7. Choix faits, à valider [reco]

- **Côté du joueur** : tu joues à droite (côté « drive »), ton partenaire à gauche ; au service, les serveurs changent de côté à chaque point comme dans le règlement, puis chacun regagne son côté.
- **Point en or par défaut** (règle répandue), l'avantage est un simple réglage de `config.js` (pas d'écran : 3 réglages maximum).
- **Format par défaut : 1 set** (15 à 27 min) ; le format 2 sets gagnants utilise le super jeu décisif au 3e set pour rester jouable sur téléphone. Le choix se fait sur l'accueil (ce n'est pas un réglage) et « Jouer » reste à 1 appui.
- **Annonce dans la convention de l'arbitre** (score du serveur en premier) : réaliste, mais « 15-30 » peut surprendre quand c'est ton équipe qui mène ; le tableau de score reste par équipe.
- **Effets** : valeurs plausibles (≈ 3 à 32 tours/s), non mesurées sur de vrais joueurs ; rotation affichée ralentie ; étiquette d'effet = aide d'entraînement (un vrai joueur lit l'effet sur le geste adverse).
- **Replacement entre deux points** : court fondu au noir, les 4 joueurs sont replacés pour le service (plus confortable en 1re personne qu'un déplacement automatique de la caméra).
- **Ton renvoi reste automatique** (lob, balle de fond ou volée selon la situation et ta qualité) : le brief entraîne la décision, pas le geste.
- **Le partenaire est fiable** (≈ 2 fois moins de fautes que les adversaires) pour ne pas frustrer ; les adversaires peuvent gagner des points contre lui (≈ 15 % de ses balles ne sont pas forcément jouables).

## 8. Limites et dette connues [fait]

- **Jamais testé sur un vrai téléphone** ; tests navigateur en Chromium sans affichage, rendu WebGL logiciel. Sur iOS, pas d'API plein écran dans Safari ni de vibration.
- **Physique simplifiée** : effets avec Magnus figé par segment et frottement de contact simple ; pas de frottement de l'air ; le grillage renvoie comme une vitre ; murs infinis (pas de balle « por 3 » ou « por 4 »).
- **Tu ne choisis pas l'effet ni la direction de ton renvoi** : ils suivent le coup choisi automatiquement.
- **Pas de changement de côté** aux jeux impairs (court symétrique, tu restes en bas).
- **Pas de contact raquette-balle** : la frappe est jugée sur la position et le moment d'appui.
- **Heuristiques non calibrées avec des entraîneurs** : qualité, meilleur choix, choix des coups et fautes des IA.
- **Déplacements par rapport au court** : quand tu regardes vers ta vitre, « haut » t'éloigne de ce que tu regardes. Le brief l'impose ; à surveiller dans les retours.
- **Pas de smash pour toi** : une balle au-dessus de 2 m se joue après le rebond.
- **`src/core` alloue de petits objets à chaque pas** (états immuables, 4 joueurs) ; la génération d'une balle à la frappe adverse coûte ≈ 0,4 ms en médiane et jusqu'à ≈ 9 ms au pire sur PC (≈ 4 fois plus sur téléphone : une image sautée possible, rarement).
- `rally.js` (duel d'origine) n'est plus utilisé par le jeu ; il est conservé car testé et réutilisé (motifs de perte).

## 9. À tester à la main sur un vrai téléphone [à vérifier]

1. Ouverture → Jouer → premier service : 1 appui, plein écran et paysage (Android), installation PWA (Android et iOS), lancement hors ligne.
2. Joystick et Frappe en même temps, aucun zoom, scroll ou menu contextuel ; mode gaucher.
3. **Confort de la 1re personne** : aucune nausée sur 5 minutes en paysage ; rotation de la tête quand la balle passe derrière soi ; court fondu entre les points.
4. **Lisibilité** : juger sa position par rapport à la balle (ombre, trait, anneau, raquette présentée) au moins aussi bien qu'en vue épaule à 110° ; balle visible au moment de frapper.
5. Garde : haut de la raquette visible sans masquer le jeu ni être caché par le bouton Frappe ; ses bras et ses jambes en regardant vers le bas.
6. Cadence : 60 i/s visés (`?debug=1`) ; que la résolution dynamique et la coupure des ombres suffisent.
7. Partie : positions crédibles, annonces « À moi ! / À toi ! », ton service (invite, Frappe), score, jeu, set, fautes de service.
8. Son, vibration, Wake Lock, pause automatique quand l'application passe en arrière-plan.
9. **Effets** : l'étiquette (« Balle coupée »…) se lit sans gêner ; la rotation de la balle se voit quand elle approche ; une balle coupée reste basse après la vitre, une liftée sort haut (ressenti de joueur).
10. **Score** : tableau lisible en plein jeu sur un petit écran ; annonces compréhensibles (« 15-30 » serveur d'abord) ; fin de match et écran de fin ; **Reprendre** après avoir fermé l'application (le match reprend au même score).

## 10. Suites possibles [reco]

1. Tester sur 2 ou 3 téléphones (Android milieu de gamme, iPhone) et ajuster le confort (vitesse de tête, zone morte, fondu) et la cadence.
2. Calibrer avec un entraîneur : poids de la qualité, meilleur choix, choix des coups et fautes des IA, part des balles vers toi.
3. Grillage réaliste et sorties « por 3 / por 4 », frottement de l'air ; valider les valeurs d'effet avec un joueur.
4. Donner au joueur le choix de la direction et de l'effet de son renvoi (par exemple : glisser sur Frappe vers le haut = lift, vers le bas = coupé), si l'entraînement de la décision le justifie.
5. Changement de côté aux jeux impairs (pause de 90 s raccourcie) et statistiques par match (aces, fautes directes, coups gagnants).

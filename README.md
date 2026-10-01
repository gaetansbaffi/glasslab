# Glass Lab — padel en double, en 1re personne

Un jeu de padel en **3D**, vécu **dans le corps du joueur**, pour entraîner la **lecture des vitres** et le **choix du coup**. Un vrai match en double, en 1 set ou en 2 sets gagnants : toi et ton partenaire (IA) contre deux adversaires (IA), avec service, score du padel, effets de balle et positions d'attaque et de défense. Tu te places, tu appuies sur **Frappe** au bon moment, et le jeu compare ton coup au meilleur coup possible.

Conçu **mobile d'abord** (plein écran, deux pouces, paysage conseillé), jouable au **clavier sur PC**. JavaScript sans bundler, Three.js en copie locale, PWA hors ligne.

## Jouer

**Jouer** : le match démarre au format choisi sur l'accueil (**1 set** ou **2 sets gagnants**), le premier service adverse arrive vers toi sans autre action. Le match est sauvegardé à chaque point : si tu quittes, **Reprendre** le continue au même score ; **Nouveau match** l'abandonne.

| Action | Mobile | PC |
|---|---|---|
| Se déplacer | joystick : pouce n'importe où dans la moitié gauche de l'écran | ZQSD (AZERTY), WASD (QWERTY) ou flèches |
| Frapper, servir | gros bouton **Frappe** en bas à droite | Espace |
| Pause | bouton en haut à droite | Échap |
| Plein écran | accueil et pause | F |

- **Déplacements par rapport à ce que tu regardes** : haut = droit devant toi, bas = en arrière, gauche / droite = de côté. Dès que ton pouce pousse franchement, la direction est **figée tant qu'il pousse** : si la caméra tourne pour suivre la balle, ta course ne dévie pas. Relâche (ou ramène le pouce au centre) pour repartir dans la direction regardée.
- **C'est le moment de l'appui qui décide du coup** : volée (avant le rebond), **coup au-dessus de la tête** (balle haute avant le rebond, contact entre 1,9 et 3,1 m), demi-volée (juste après le rebond, balle basse et montante), avant vitre, après vitre. Si la balle est dans ta zone de frappe à ±250 ms près, elle est renvoyée automatiquement (on entraîne la décision, pas le geste) : plus la qualité est haute, plus le renvoi est profond et rapide. Du fond face à des adversaires au filet, un bon coup part en lob. Au-dessus de la tête, ton renvoi est une **bandeja** (coupée, en profondeur, pour garder le filet), une **víbora** (plus rapide, coupée et latérale) sur un bon coup, ou un **smash** sur une balle très bien jouée près du filet ; au filet, le meilleur choix privilégie légèrement ces coups qui gardent le filet.
- **Ton service** : quand c'est ton tour, une invite s'affiche ; Frappe lâche la balle, qui rebondit et part à la cuillère en diagonale.
- Après chaque balle : un message court (coup joué, qualité de 0 à 1, meilleur choix). Après une erreur, **Détail** rejoue la balle au ralenti (vue 1re personne, de dessus ou de côté), avec la trajectoire, le meilleur point de frappe et une règle à retenir.

## En 1re personne, dans un corps

- **Tes yeux** sont à ≈ 1,65 m et tournent autour de ton cou ; champ de vision fixé par le jeu : 108° en paysage (vertical ≥ 60°), adapté en portrait.
- **Tête et corps séparés, caméra calme** : ta tête suit la balle sans à-coups (au plus ≈ 230°/s, zone morte quand la balle est loin, aucun roulis) ; ton cou tourne jusqu'à ±80°, puis ton corps pivote. Quand la balle part vers ta vitre de fond, tu te mets **de profil** (au plus ≈ 92° du filet) au lieu de te retourner : l'impact reste au bord de l'écran et la balle revient dans le champ. **Juste avant de frapper, ton regard se pose sur le point de frappe** : la balle y arrive, visible au contact, sans que la tête coure après elle.
- **Ton corps** est visible : buste, bras, jambes, pieds, et ton ombre sur le court devant toi. Tes bras sont animés en cinématique inverse : ta main tient la raquette, en garde en bas de l'écran ; quand la balle arrive, la raquette se présente du côté de la balle, à distance de frappe (elle matérialise ta portée) ; le geste part vers la balle à l'appui.
- **Aides discrètes, toujours actives** : balle grossie ≈ 2× avec contour, ombre ronde à sa verticale et trait jusqu'au sol, anneau de portée à tes pieds. Pas de trajectoire pendant le jeu.
- **Balles hautes (lob vers ton camp), jusqu'au rebond** : quand tu lèves les yeux vers la balle, le sol sort du champ. L'ombre reste nettement visible, cerclée de blanc ; le **point de chute** est marqué au sol (cible jaune) ; une **mini-carte** apparaît en haut à droite, orientée comme le joystick (haut = devant toi) : toi au centre avec ton anneau de portée, ton partenaire, la balle et son trajet jusqu'au point de chute et, si tu peux la jouer au-dessus de la tête, **ta place pour le smash** (cercle vert). Pousse le pouce vers le cercle vert, puis Frappe quand la balle redescend sur toi.

## La partie en double

- **4 joueurs animés** : course avec accélération (≈ 0,5 s pour la pleine vitesse), pas chassés, split-step à chaque frappe adverse, préparation, gestes (fond de court, volée, lob, smash, service).
- **Positions** : chaque équipe est en **défense** (au fond, près des vitres) ou en **attaque** (au filet) ; les partenaires restent alignés, couvrent chacun leur côté et glissent ensemble vers la balle. On monte au filet derrière un lob profond ou une balle courte, on recule sur un lob très profond.
- **Qui prend la balle** : celui de son côté ; au centre, le mieux placé, et à égalité celui dont le coup droit est au centre. Ton partenaire annonce « À moi ! » ou « À toi ! » sur les balles au centre. Toi, tu joues le côté droit.
- **Coups des IA** : défense après vitre, balle de fond, lob (5 à 8 m de haut), lob court (3 à 5 m, qui retombe au milieu du court : plus fréquent quand l'IA est en difficulté, c'est la balle à smasher), chiquita, volée, bandeja, víbora, smash (au filet). Le coup dépend de leur position et de la balle reçue ; elles se trompent plus souvent sur une balle difficile.
- **Service réel** : à la cuillère après un rebond, derrière la ligne de service, en diagonale, dans le carré (sinon faute, deuxième service, double faute ; filet puis carré = let) ; retour obligatoirement après le rebond.
- **Vrai système de points** : 15-30-40-jeu avec **point en or** à 40-40 (l'avantage est disponible dans `config.js`), jeux à 6 avec 2 d'écart, jeu décisif en 7 points à 6-6. Match en **1 set**, ou en **2 sets gagnants** avec, à 1 set partout, un **super jeu décisif** en 10 points (format courant des tournois amateurs). Tableau de score type télévision (sets, jeux, points, équipe au service, enjeu : balle de break, de set, de match) ; après chaque point, l'annonce de l'arbitre, score du serveur en premier (« 30-15 », « 40 partout · point en or »), avec la raison du point ; « Jeu », « Set », « Jeu, set et match » ; écran de fin de match (victoire ou défaite, score par set, tes indicateurs).
- **Vraie physique de balle (sur Terre)** : gravité et **air** — la balle ralentit (un smash parti à 110 km/h rebondit à ≈ 95 km/h et touche la vitre vers 55 km/h), un lob retombe plus raide qu'il ne monte ; **rebonds** calculés sur la vraie vitesse de glissement au contact : la balle accroche le gazon, perd de la vitesse et prend du lift, et remonte selon une restitution qui baisse avec la violence du choc (règlement FIP : lâchée de 2,54 m, elle remonte de 1,35 à 1,45 m sur une surface dure, ≈ 1,2 m sur le gazon). Un lob de 6 à 7 m remonte vers 2,2 m (et non plus 3,8 m) ; une balle ne gagne jamais d'énergie. Le **grillage amortit** la balle. Le jeu tourne **en temps réel à tous les niveaux** (pas de ralenti, qui donnait une gravité de Lune).
- **Effets de balle** : les coups ont de l'effet — bandeja, volée et service **coupés**, víbora **coupée et latérale** vers la grille, lob **lifté**, smash plat ou lifté. En vol, le lift plonge, le coupé flotte, le latéral courbe ; au rebond, le coupé freine le plus et **sort bas de la vitre**, le lift freine le moins et **sort haut** (un lift très appuyé fait filer la balle), le latéral dévie. La balle porte sa couture et tourne selon son effet (rotation ralentie pour rester lisible) ; une étiquette brève annonce l'effet de la balle qui t'arrive (« Balle coupée », « Balle liftée », « Effet latéral »), et le Détail explique ce qu'il change pour toi.
- **Partie orientée entraînement** : les adversaires visent ton côté ≈ 65 % du temps, avec des balles qui t'obligent à lire les vitres ; les familles de balles où tu échoues reviennent plus souvent (répétition espacée). Les stats et le feedback ne portent que sur tes coups.
- **Difficulté adaptative** : au-delà de 80 % de balles renvoyées sur 10, le niveau monte (balles plus rapides, adversaires plus solides) ; sous 50 %, il descend. Le niveau règle la vitesse et la hauteur des balles, jamais celle du temps.

## Réglages (3)

**Son et vibration**, **mode gaucher** (raquette dans la main gauche, joystick à droite, Frappe à gauche), **données** (export / import JSON, réinitialisation). Tout le reste est fixé : vue, champ de vision, déplacements, aides, vitesse, qualité graphique (automatique), mouvements réduits (selon `prefers-reduced-motion` du système).

## Installer comme une application (PWA)

- **Android (Chrome)** : menu ⋮ → « Installer l'application ».
- **iPhone / iPad (Safari)** : Partager → « Sur l'écran d'accueil » (Safari n'a pas d'API plein écran : c'est l'application installée qui s'ouvre sans barre d'adresse).
- **PC (Chrome, Edge)** : icône d'installation dans la barre d'adresse.

Après le premier chargement, le jeu fonctionne **hors ligne** (`sw.js`). Sur GitHub Pages, `VERSION` est remplacée automatiquement à chaque publication ; en local, change-la à la main.

## Publication (GitHub Pages)

- Chaque envoi sur `main` ou sur une branche `claude/…` lance les tests puis publie le jeu sur la branche `gh-pages` (`.github/workflows/pages.yml`, `tools/publier.sh`). Une version cassée n'est jamais publiée.
- **Jamais de retour en arrière** : un envoi dont le commit est déjà en ligne, ou plus ancien que celui en ligne, ne republie rien (ex. création d'une branche sur un ancien commit).
- **Republier sans nouveau code** (rare) : « Run workflow » dans l'onglet Actions de GitHub, ou une étiquette `publication-<n>` sur le commit voulu (`git tag publication-3 <commit> && git push origin publication-3`). Les deux demandent tes droits GitHub : l'accès de Claude Code ne peut ni lancer une action ni créer d'étiquette (refus 403) ; ses envois de code, eux, publient normalement.
- La version publiée (commit et date) s'affiche **en bas de l'accueil**. Le service worker prend ce commit pour version : un téléphone reçoit la mise à jour au plus tard au deuxième rechargement (ou en rouvrant l'application installée).

## Lancer en local

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

Un serveur HTTP est nécessaire (modules ES, service worker). Sur un téléphone du même réseau : `http://<adresse-IP-du-PC>:8000` (sans HTTPS, le service worker et le Wake Lock sont désactivés ; la version publiée sur GitHub Pages les active).

| Paramètre d'URL | Effet |
|---|---|
| `?seed=123` | rejoue exactement la même partie |
| `?debug=1` | affiche la cadence, la résolution, les ombres, les appels de rendu ; expose l'état pour les tests en navigateur |
| `?nosw` | n'enregistre pas le service worker (développement) |

## Tests

```bash
node test/run.js
```

Node ≥ 18, sans librairie : **110 tests**. Ils couvrent la physique (demi-court et court complet : aucune traversée des parois ni du filet, symétrie, filet et bande ; **essai de rebond du règlement FIP**, restitution qui baisse avec la vitesse, **jamais d'énergie créée à un contact** (2 000 contacts), frottement jamais au-delà du roulement, traînée (smash ralenti, lob plus raide à la descente, vitesse limite ≈ 22 m/s), lob qui remonte bas, **précision du vol découpé face à une intégration RK4 très fine (< 2 cm)**, balle vue par le receveur = vol complet), les effets (lift / coupé / latéral en vol, au rebond et à la vitre, lancer qui compense l'air et l'effet, effet de chaque coup), le corps (cou limité à ±80°, pivot du corps, yeux, cinématique inverse, main sur la raquette, garde visible, geste jamais devant les yeux, **balle visible au contact sur 120 frappes simulées**, caméra jamais au-delà du profil, sans volte-face), les déplacements (joystick par rapport au regard avec direction figée pendant la course, accélération, freinage, réaction, split-step), la qualité et le meilleur choix, la génération des coups (familles, vitres, atteignables, déterminisme, niveaux), la tactique (positions, transitions, qui prend la balle, interception, choix du coup, lob court, fautes, ton renvoi dont bandeja / víbora / smash), les coups au-dessus de la tête (zone, meilleur choix, balle visible au contact, geste loin des yeux), les aides aux balles hautes (point de chute d'accord avec l'arbitrage, balle dehors, mini-carte orientée comme le joystick), le score et le service (formats de match, super jeu décisif, enjeux, annonces, reprise), la partie à 4 (fin de match, reprise) (déterminisme, 1 appui, part des balles vers toi, IA à temps et légales, continuité de la balle, **calibrage sur le tableau du brief**), les stats, la migration de la sauvegarde et la **pureté de `src/core`** (ni DOM ni Three.js).

## Architecture

```
index.html, style.css, manifest.webmanifest, sw.js, icons/
vendor/three@0.170.0/     Three.js, copie locale versionnée (licence MIT)
src/main.js               démarrage, écrans, boucle d'images, PWA
src/app/                  session de jeu (pas fixe 120 Hz + interpolation), animation des 4 joueurs,
                          Détail (replay), appareil (plein écran, veille), qualité automatique
src/view/                 rendu Three.js : court, joueurs instanciés et ombres, balle et aides
src/input.js, hud.js, audio.js, settings.js, storage.js
src/core/                 fonctions pures, sans DOM ni Three.js, testées :
  physics.js              vraie balle : air (traînée, Magnus), rebonds avec frottement et restitution e(v), grillage
  flight.js               vol de balle depuis n'importe quel joueur, issue, balle vue par le receveur
  geometry.js             repères, joystick, clavier, champ de vision
  body.js                 tête et corps, yeux, cinématique inverse, raquette, squelette
  players.js              déplacements : accélération, freinage, réaction, split-step
  quality.js              type de coup, qualité, meilleur choix, contexte du double, textes
  shotgen.js              balles d'entraînement (familles) et coups de tout style vers toute zone
  tactics.js              positions, transitions, qui prend la balle, interception et coups des IA
  score.js                score du padel, formats de match, enjeux, annonces, rotation du service
  match.js                partie à 4 joueurs (service, échange, points)
  stats.js                sauvegarde v3 (dont format et match en cours), migration, stats, difficulté
  config.js               toutes les constantes
test/                     tests Node (node test/run.js)
tools/make-icons.js       génère les icônes PWA
```

**Sauvegarde** : clé `glasslab.v3` du localStorage (schéma 3). Les sauvegardes `glasslab.v2` (échange en duel) et `glasslab.v1` sont migrées automatiquement ; les réglages supprimés sont abandonnés, la progression est conservée.

## Constantes principales (`src/core/config.js`)

| Constante | Valeur | Rôle |
|---|---|---|
| `player.speed` / `accel` / `decel` | 5 m/s · 10 · 18 m/s² | ta course : ≈ 0,5 s pour la pleine vitesse |
| `ai.speed` / `reaction` | 5,5 m/s · 0,22 s | IA : sprint, réaction (split-step compris) |
| `view.hFov` / `vFovMin` | 108° · 60° | champ de vision fixe |
| `view.deadYaw` / `anticipation` | 0,22 rad · 0,22 s | regard calme, anticipation des sorties de vitre |
| `view.maxBack` / `focusFrom`–`focusTo` | 1,6 rad · 0,3–0,8 s | de profil au plus ; regard posé sur le point de frappe juste avant de frapper |
| `view.highBall` / `mapRange` | 3 m · 7 m | balle « haute » (aides : point de chute, mini-carte) ; rayon de la mini-carte |
| `controls.lockOn` / `lockOff` | 0,45 · 0,3 | joystick : direction figée au-delà, libérée en deçà |
| `strike.timingTolerance` | ±0,25 s | fenêtre de frappe |
| `zones.*`, `quality.*`, `placement.*` | voir fichier | zones de frappe, poids de la qualité, placement idéal |
| `zones.overhead` | contact 1,9–3,1 m, idéal 2,3–2,8 m, portée 1 m | coup au-dessus de la tête : balle à 0,35 m sur le côté et 0,3 m devant toi |
| `userPrefer.attack` | au-dessus de la tête +0,06 · volée +0,03 | au filet, le meilleur choix privilégie les coups qui gardent le filet |
| `styles.*` | voir fichier | coups des 4 joueurs : hauteur au filet ou vitesse, profondeur, km/h admis, hauteur max |
| `styles.*.spin` | ex. bandeja −200 à −90 rad/s | effet de chaque coup : lift (> 0) ou coupé (< 0), latéral |
| `physics.DEFAULT_PARAMS` (air) | ρA/2m 0,0356 /m · C_D 0,55 · C_L = S / (2,022 S + 0,981) | traînée et effet Magnus d'une balle feutrée de 57,7 g |
| `physics.DEFAULT_PARAMS` (rebonds) | e = 0,78 − 0,009 v (gazon), 0,80 − 0,0095 v (vitre) · μ 0,6 gazon / 0,3 vitre · grillage e 0,35 | restitution qui baisse avec la vitesse d'impact, frottement, amortissement du grillage |
| `physics.DEFAULT_PARAMS.step` | 0,05 s | segment de vol d'accélération constante (écart < 2 cm avec une intégration très fine) |
| `serveFaults` | 8 % · 3,5 % | fautes des serveurs IA (premier, deuxième service) |
| `tactics.*` | défense 2,4 m, attaque 7,3 m | positions, écart des partenaires, balle au centre |
| `training.userShare` | 0,65 | part des balles adverses vers toi |
| `errors.*` | voir fichier | fautes des IA selon la difficulté de la balle et le coup |
| `score.golden` | vrai | point en or (faux : avantage) |
| `difficulty` | 10 balles, 80 % / 50 % | difficulté adaptative |

## Limites connues

- **Jamais testé sur un vrai téléphone** : seulement en Chromium sans affichage, avec un rendu WebGL logiciel (≈ 20 à 50 i/s, non représentatif). Fluidité, ressenti du joystick, confort de la 1re personne (nausée), plein écran, verrouillage paysage, vibration et son restent à vérifier.
- **Physique de référence, pas mesurée sur un vrai court** : coefficients d'air et de rebond tirés de mesures publiées sur des balles feutrées (tennis) et du règlement FIP ; gazon, vitres et grillage avec des valeurs plausibles, à confirmer par un joueur. La rotation ne s'amortit pas en vol ; le grillage est un simple amortisseur ; les murs sont infinis : la balle ne sort jamais du court (pas de smash « por 3 » ou « por 4 »).
- **Temps réel à tous les niveaux** : sans le ralenti, au niveau 1 tu as ≈ 30 % de temps en moins qu'avant pour réagir (1,6 s au lieu de 2,2 s en médiane entre la frappe adverse et ton point de frappe idéal).
- **Tu ne choisis pas l'effet de ton renvoi** : il suit le coup joué automatiquement (lob lifté, volée coupée…).
- **La frappe n'est pas un contact raquette-balle** : elle est jugée sur ta position et le moment d'appui ; la raquette dessinée est un indicateur de portée.
- **Tu ne choisis ni la direction ni le type de ton renvoi** : il est automatique (lob, balle de fond, volée, bandeja, víbora ou smash selon la situation et ta qualité). Pas de coup au-dessus de la tête après le rebond (balle haute qui sort de la vitre) : elle se joue en défense.
- **Aides aux balles hautes = aide d'entraînement forte** : la mini-carte montre où tombe la balle et où te placer pour un smash, ce qu'un vrai joueur doit lire seul ; le cercle vert apparaît dès qu'un smash est possible, même quand laisser rebondir serait meilleur.
- **Heuristiques non calibrées avec des entraîneurs** : qualité, meilleur choix, choix des coups et fautes des IA, part des balles vers toi. Les vitesses sont des ordres de grandeur, vérifiés par un test.
- **Joystick par rapport au regard** : tant que ton pouce pousse, la direction reste celle du moment où tu as commencé ; si la caméra a beaucoup tourné entre-temps, relâche pour repartir dans la direction regardée.
- **Ton service** est toujours bon et en diagonale ; on ne change pas de côté aux jeux impairs (tu restes en bas, le court est symétrique).
- Les IA ne se gênent pas physiquement et ne communiquent que sur les balles au centre ; le partenaire s'aligne sur toi si tu restes au fond.
- La génération d'une balle se fait au moment de la frappe adverse (≈ 0,4 ms en médiane, jusqu'à ≈ 9 ms au pire sur PC).

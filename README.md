# Glass Lab — padel en double, en 1re personne

Un jeu de padel en **3D**, vécu **dans le corps du joueur**, pour entraîner la **lecture des vitres** et le **choix du coup**. Une vraie partie en double, sans fin : toi et ton partenaire (IA) contre deux adversaires (IA), avec service, score et positions d'attaque et de défense. Tu te places, tu appuies sur **Frappe** au bon moment, et le jeu compare ton coup au meilleur coup possible.

Conçu **mobile d'abord** (plein écran, deux pouces, paysage conseillé), jouable au **clavier sur PC**. JavaScript sans bundler, Three.js en copie locale, PWA hors ligne.

## Jouer

**Jouer** : la partie démarre, le premier service adverse arrive vers toi sans autre action.

| Action | Mobile | PC |
|---|---|---|
| Se déplacer | joystick : pouce n'importe où dans la moitié gauche de l'écran | ZQSD (AZERTY), WASD (QWERTY) ou flèches |
| Frapper, servir | gros bouton **Frappe** en bas à droite | Espace |
| Pause | bouton en haut à droite | Échap |
| Plein écran | accueil et pause | F |

- **Déplacements par rapport au court**, toujours : haut = vers le filet, bas = vers ta vitre de fond, gauche / droite = le long du filet. Ils ne dépendent jamais de la direction de ta tête.
- **C'est le moment de l'appui qui décide du coup** : volée (avant le rebond), demi-volée (juste après le rebond, balle basse et montante), avant vitre, après vitre. Si la balle est dans ta zone de frappe à ±250 ms près, elle est renvoyée automatiquement (on entraîne la décision, pas le geste) : plus la qualité est haute, plus le renvoi est profond et rapide. Du fond face à des adversaires au filet, un bon coup part en lob.
- **Ton service** : quand c'est ton tour, une invite s'affiche ; Frappe lâche la balle, qui rebondit et part à la cuillère en diagonale.
- Après chaque balle : un message court (coup joué, qualité de 0 à 1, meilleur choix). Après une erreur, **Détail** rejoue la balle au ralenti (vue 1re personne, de dessus ou de côté), avec la trajectoire, le meilleur point de frappe et une règle à retenir.

## En 1re personne, dans un corps

- **Tes yeux** sont à ≈ 1,65 m et tournent autour de ton cou ; champ de vision fixé par le jeu : 108° en paysage (vertical ≥ 60°), adapté en portrait.
- **Tête et corps séparés** : ta tête suit la balle (lissage de quelques centièmes de seconde, zone morte quand la balle est loin, aucun roulis) ; ton cou tourne jusqu'à ±80°, puis ton corps pivote progressivement quand la balle passe derrière toi, vers la vitre. Sur une sortie de vitre qui revient, ton regard anticipe là où la balle arrive : elle reste visible au moment de frapper.
- **Ton corps** est visible : buste, bras, jambes, pieds, et ton ombre sur le court devant toi. Tes bras sont animés en cinématique inverse : ta main tient la raquette, en garde en bas de l'écran ; quand la balle arrive, la raquette se présente du côté de la balle, à distance de frappe (elle matérialise ta portée) ; le geste part vers la balle à l'appui.
- **Aides discrètes, toujours actives** : balle grossie ≈ 2× avec contour, ombre ronde à sa verticale et trait jusqu'au sol, anneau de portée à tes pieds. Pas de trajectoire pendant le jeu.

## La partie en double

- **4 joueurs animés** : course avec accélération (≈ 0,5 s pour la pleine vitesse), pas chassés, split-step à chaque frappe adverse, préparation, gestes (fond de court, volée, lob, smash, service).
- **Positions** : chaque équipe est en **défense** (au fond, près des vitres) ou en **attaque** (au filet) ; les partenaires restent alignés, couvrent chacun leur côté et glissent ensemble vers la balle. On monte au filet derrière un lob profond ou une balle courte, on recule sur un lob très profond.
- **Qui prend la balle** : celui de son côté ; au centre, le mieux placé, et à égalité celui dont le coup droit est au centre. Ton partenaire annonce « À moi ! » ou « À toi ! » sur les balles au centre. Toi, tu joues le côté droit.
- **Coups des IA** : défense après vitre, balle de fond, lob (5 à 8 m de haut), chiquita, volée, bandeja, víbora, smash (au filet). Le coup dépend de leur position et de la balle reçue ; elles se trompent plus souvent sur une balle difficile.
- **Service et score réels** : service à la cuillère après un rebond, derrière la ligne de service, en diagonale, dans le carré (sinon faute, deuxième service, double faute ; filet puis carré = let) ; retour obligatoirement après le rebond. 15-30-40-jeu avec **point en or** à 40-40 (l'avantage est disponible dans `config.js`), jeux à 6 avec 2 d'écart, jeu décisif à 6-6. La partie ne s'arrête jamais : un nouveau set commence à la fin du précédent.
- **Partie orientée entraînement** : les adversaires visent ton côté ≈ 65 % du temps, avec des balles qui t'obligent à lire les vitres ; les familles de balles où tu échoues reviennent plus souvent (répétition espacée). Les stats et le feedback ne portent que sur tes coups.
- **Difficulté adaptative** : au-delà de 80 % de balles renvoyées sur 10, le niveau monte (balles plus rapides, adversaires plus solides) ; sous 50 %, il descend. Le niveau règle aussi la vitesse du jeu : le niveau 1 démarre à 75 % du temps réel.

## Réglages (3)

**Son et vibration**, **mode gaucher** (raquette dans la main gauche, joystick à droite, Frappe à gauche), **données** (export / import JSON, réinitialisation). Tout le reste est fixé : vue, champ de vision, déplacements, aides, vitesse, qualité graphique (automatique), mouvements réduits (selon `prefers-reduced-motion` du système).

## Installer comme une application (PWA)

- **Android (Chrome)** : menu ⋮ → « Installer l'application ».
- **iPhone / iPad (Safari)** : Partager → « Sur l'écran d'accueil » (Safari n'a pas d'API plein écran : c'est l'application installée qui s'ouvre sans barre d'adresse).
- **PC (Chrome, Edge)** : icône d'installation dans la barre d'adresse.

Après le premier chargement, le jeu fonctionne **hors ligne** (`sw.js`). Pour publier une mise à jour, change `VERSION` dans `sw.js`.

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

Node ≥ 18, sans librairie : **95 tests**. Ils couvrent la physique (demi-court historique et court complet : aucune traversée des parois ni du filet, symétrie, filet et bande), le corps (cou limité à ±80°, pivot du corps, yeux, cinématique inverse, main sur la raquette, garde visible, geste jamais devant les yeux, **balle visible au contact sur 109 frappes simulées**), les déplacements (accélération, freinage, réaction, split-step), la qualité et le meilleur choix, la génération des balles (familles, styles, vitesses), l'échange historique, la tactique (positions, transitions, qui prend la balle, interception, choix du coup, fautes, ton renvoi), le score et le service, la partie à 4 (déterminisme, 1 appui, part des balles vers toi, IA à temps et légales, continuité de la balle, **calibrage sur le tableau du brief**), les stats, la migration de la sauvegarde et la **pureté de `src/core`** (ni DOM ni Three.js).

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
  physics.js              rebonds exacts ; demi-court historique ou court complet (filet obstacle)
  flight.js               vol de balle depuis n'importe quel joueur, issue, balle vue par le receveur
  geometry.js             repères, joystick, clavier, champ de vision
  body.js                 tête et corps, yeux, cinématique inverse, raquette, squelette
  players.js              déplacements : accélération, freinage, réaction, split-step
  quality.js              type de coup, qualité, meilleur choix, contexte du double, textes
  shotgen.js              balles d'entraînement (familles) et coups de tout style vers toute zone
  tactics.js              positions, transitions, qui prend la balle, interception et coups des IA
  score.js                score du padel, rotation du service
  match.js                partie à 4 joueurs (service, échange, points)
  rally.js                échange historique en duel (conservé, testé)
  stats.js                sauvegarde v3, migration, stats, répétition espacée, difficulté
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
| `strike.timingTolerance` | ±0,25 s | fenêtre de frappe |
| `zones.*`, `quality.*`, `placement.*` | voir fichier | zones de frappe, poids de la qualité, placement idéal |
| `styles.*` | voir fichier | coups des 4 joueurs : hauteur au filet ou vitesse, profondeur, km/h admis, hauteur max |
| `tactics.*` | défense 2,4 m, attaque 7,3 m | positions, écart des partenaires, balle au centre |
| `training.userShare` | 0,65 | part des balles adverses vers toi |
| `errors.*` | voir fichier | fautes des IA selon la difficulté de la balle et le coup |
| `score.golden` | vrai | point en or (faux : avantage) |
| `game.levelSpeed` | 0,75 → 1 | vitesse du jeu du niveau 1 au niveau 5 |
| `difficulty` | 10 balles, 80 % / 50 % | difficulté adaptative |

## Limites connues

- **Jamais testé sur un vrai téléphone** : seulement en Chromium sans affichage, avec un rendu WebGL logiciel (≈ 20 à 50 i/s, non représentatif). Fluidité, ressenti du joystick, confort de la 1re personne (nausée), plein écran, verrouillage paysage, vibration et son restent à vérifier.
- **Pas d'effet ni de frottement de l'air** : ni slice, ni lift, ni bandeja ou víbora « coupées » qui restent basses après la vitre ; le grillage renvoie la balle comme une vitre, et la balle ne sort jamais du court (pas de smash « por 3 » ou « por 4 »).
- **La frappe n'est pas un contact raquette-balle** : elle est jugée sur ta position et le moment d'appui ; la raquette dessinée est un indicateur de portée.
- **Tu ne choisis ni la direction ni le type de ton renvoi** : il est automatique (lob, balle de fond ou volée selon la situation et ta qualité). Tu n'as pas de smash : une balle trop haute se joue après le rebond.
- **Heuristiques non calibrées avec des entraîneurs** : qualité, meilleur choix, choix des coups et fautes des IA, part des balles vers toi. Les vitesses sont des ordres de grandeur, vérifiés par un test.
- **Déplacements par rapport au court** : quand tu regardes vers ta vitre de fond, pousser le joystick vers le haut t'éloigne de ce que tu regardes (c'est voulu, mais peut dérouter).
- **Ton service** est toujours bon et en diagonale ; le score ne change pas de côté de terrain (tu restes en bas).
- Les IA ne se gênent pas physiquement et ne communiquent que sur les balles au centre ; le partenaire s'aligne sur toi si tu restes au fond.
- La génération d'une balle se fait au moment de la frappe adverse (≈ 0,4 ms en médiane, jusqu'à ≈ 9 ms au pire sur PC).

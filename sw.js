/*
 * Glass Lab — service worker : cache-first des fichiers locaux, jeu jouable hors ligne après le premier
 * chargement. Sur GitHub Pages, VERSION est remplacée à chaque publication par le commit publié
 * (tools/publier.sh) : l'ancien cache est supprimé à l'activation. En local, la changer à la main.
 *
 * Mise à jour : la nouvelle version relit chaque fichier sur le réseau (jamais le cache HTTP du
 * navigateur, qui rendrait l'ancienne) ; un fichier introuvable ne bloque pas la mise à jour (il sera
 * chargé depuis le réseau) ; la fiche de version (publication.txt) est toujours lue sur le réseau.
 * FILES doit lister exactement les fichiers du jeu (vérifié par test/pwa.test.js).
 */
const VERSION = 'glasslab-28613a2';
const FILES = [
  './',
  './index.html',
  './simulateur.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/three@0.170.0/three.module.min.js',
  './src/main.js',
  './src/input.js',
  './src/hud.js',
  './src/audio.js',
  './src/settings.js',
  './src/storage.js',
  './src/app/actors.js',
  './src/app/device.js',
  './src/app/game.js',
  './src/app/perf.js',
  './src/app/replay.js',
  './src/view/ball.js',
  './src/view/court.js',
  './src/view/figures.js',
  './src/view/renderer.js',
  './src/core/body.js',
  './src/core/config.js',
  './src/core/flight.js',
  './src/core/geometry.js',
  './src/core/match.js',
  './src/core/physics.js',
  './src/core/players.js',
  './src/core/quality.js',
  './src/core/score.js',
  './src/core/shotgen.js',
  './src/core/stats.js',
  './src/core/tactics.js',
  './src/sim/model.js',
  './src/sim/simulator.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => Promise.all(FILES.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Fiche de version : toujours la plus récente (réseau d'abord, cache hors ligne)
  if (url.origin === self.location.origin && url.pathname.endsWith('/publication.txt')) {
    event.respondWith(fetch(req.url, { cache: 'no-store' }).catch(() => caches.match(req)));
    return;
  }
  // Ouverture d'une page (avec ou sans ?seed=, ?debug=…) : cette page en cache (le jeu pour la racine)
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    const page = /\/simulateur\.html$/.test(url.pathname) ? './simulateur.html' : './index.html';
    event.respondWith(caches.match(page).then((hit) => hit || fetch(req)));
    return;
  }
  // Cache d'abord ; sinon réseau, et mise en cache à l'exécution (y compris hors liste)
  event.respondWith(
    caches.match(req, { ignoreSearch: url.origin === self.location.origin }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
    )
  );
});

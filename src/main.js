/*
 * Glass Lab — point d'entrée : démarrage, écrans, boucle d'images, PWA.
 * La logique de jeu est dans src/core (pure, testée) ; la session dans src/app/game.js ;
 * le rendu dans src/view.
 */
import Stats from './core/stats.js';
import { createRenderer, webglAvailable } from './view/renderer.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { loadState, saveState, exportState, importStateFile, storageAvailable } from './storage.js';
import { device } from './app/device.js';
import { createPerf } from './app/perf.js';
import { createGame } from './app/game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const store = {
  save: loadState(),
  persist() {
    saveState(store.save);
  },
};

let renderer = null;
let input = null;
let hud = null;
let game = null;
let perf = null;
const audio = createAudio();

/* ---------- Écrans ---------- */

function onScreen(name) {
  const playing = name === 'playing';
  $('ui').hidden = !(playing || name === 'paused');
  $('detail').hidden = name !== 'detail';
  input.setEnabled(playing);
  device.keepAwake(playing || name === 'detail');
  if (name === 'home') {
    hud.renderHome(store.save);
    hud.show('home');
  } else if (name === 'over') hud.show('matchEnd');
  else if (name === 'paused') {
    hud.renderSummary(Stats.sessionSummary(store.save.balls, game.session), game.score, game.points);
    $('lastDetailBtn').hidden = !game.hasError;
    hud.show('pause');
  } else hud.show(null);
  if (playing && device.isTouch && window.innerHeight > window.innerWidth) {
    hud.setHint(true);
    setTimeout(() => hud.setHint(false), 4500);
  }
}

/* ---------- Réglages ---------- */

function applySettings() {
  const s = store.save.settings;
  input.setLefty(s.lefty);
  audio.setEnabled(s.sound);
  audio.setVibration(s.sound); // la vibration suit le son : un seul réglage
  game.applySettings();
}

function changeSetting(key, value) {
  store.save = Object.assign({}, store.save, { settings: Object.assign({}, store.save.settings, { [key]: value }) });
  store.persist();
  applySettings();
}

/* ---------- Taille d'écran ---------- */

const screenSize = { w: 1, h: 1 };

function measure() {
  const vv = window.visualViewport;
  screenSize.w = Math.round(vv ? vv.width : window.innerWidth);
  screenSize.h = Math.round(vv ? vv.height : window.innerHeight);
  if (renderer) renderer.resize(screenSize.w, screenSize.h);
  document.documentElement.classList.toggle('portrait', screenSize.h > screenSize.w);
}

/* ---------- Boucle ---------- */

let last = 0;
let rafId = 0;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  game.frame(dt, screenSize.w / screenSize.h);
  renderer.render();
  perf.adapt(dt);
  perf.show(now);
}

function startLoop() {
  if (rafId) return;
  last = 0;
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

/* ---------- Branchements ---------- */

/** Plein écran et paysage sur mobile, au moment de lancer le jeu (geste de l'utilisateur requis). */
function immersive() {
  if (device.isTouch) device.fullscreen(true).then(() => device.lockLandscape());
}

function wireUi() {
  // Jouer : reprend le match en cours s'il y en a un, sinon nouveau match au format choisi
  $('playBtn').addEventListener('click', () => {
    immersive();
    game.start();
  });
  $('newMatchBtn').addEventListener('click', () => {
    if (!window.confirm('Abandonner le match en cours et en commencer un nouveau ?')) return;
    immersive();
    game.newMatch();
  });
  document.querySelectorAll('.fmt-btn').forEach((b) =>
    b.addEventListener('click', () => {
      store.save = Object.assign({}, store.save, { format: b.dataset.format });
      store.persist();
      hud.renderHome(store.save);
    })
  );
  $('newMatchEndBtn').addEventListener('click', () => game.newMatch());
  $('homeEndBtn').addEventListener('click', () => game.quit());
  $('pauseBtn').addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    game.pause();
  });
  $('resumeBtn').addEventListener('click', () => game.resume());
  $('quitBtn').addEventListener('click', () => game.quit());
  $('lastDetailBtn').addEventListener('click', () => game.openDetail());
  $('toastDetail').addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    game.openDetail();
  });
  $('detailResumeBtn').addEventListener('click', () => game.resume());
  $('replayAgainBtn').addEventListener('click', () => game.replayAgain());
  document.querySelectorAll('.cam-btn').forEach((b) =>
    b.addEventListener('click', () => {
      game.setReplayCam(b.dataset.cam);
      hud.setCamButtons(b.dataset.cam);
    })
  );
  document.querySelectorAll('.fs-btn').forEach((b) => b.addEventListener('click', () => device.fullscreen()));
  document.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => {
      const from = game.screen === 'home' ? 'home' : game.screen === 'over' ? 'matchEnd' : 'pause';
      if (b.dataset.open === 'settings') hud.renderSettings(store.save.settings, changeSetting);
      else hud.renderStats(store.save);
      hud.openSub(b.dataset.open, from);
    })
  );
  document.querySelectorAll('.back-btn').forEach((b) => b.addEventListener('click', () => hud.back()));

  // Données : export, import, réinitialisation
  $('exportBtn').addEventListener('click', () => {
    exportState(store.save);
    hud.dataMessage('Sauvegarde exportée.');
  });
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    importStateFile(file)
      .then((st) => {
        store.save = st;
        store.persist();
        applySettings();
        hud.renderSettings(store.save.settings, changeSetting);
        hud.dataMessage(`Import réussi : ${store.save.balls.length} balles.`);
      })
      .catch((err) => hud.dataMessage('Import impossible : ' + err.message));
  });
  $('resetBtn').addEventListener('click', () => {
    if (!window.confirm('Effacer toute la progression et les réglages ? (pense à exporter avant)')) return;
    store.save = Stats.createState(DEFAULT_SETTINGS);
    store.persist();
    applySettings();
    hud.renderSettings(store.save.settings, changeSetting);
    hud.dataMessage('Progression effacée.');
  });
  if (!storageAvailable) hud.dataMessage('Stockage indisponible (navigation privée ?) : la progression ne sera pas conservée.');

  input.on('pause', () => {
    if (game.screen === 'playing') game.pause();
    else if (game.screen === 'paused') game.resume();
  });
  input.on('fullscreen', () => device.fullscreen());
  input.on('activity', () => hud.guideStep === 0 && hud.guideHide(0));
  hud.onGuideDone(() => {
    store.save = Object.assign({}, store.save, { guideDone: true });
    store.persist();
  });
}

/* ---------- Démarrage ---------- */

function fatal(msg) {
  if (msg) $('fatalText').textContent = msg;
  $('fatal').hidden = false;
}

function boot() {
  if (!webglAvailable()) return fatal();
  try {
    renderer = createRenderer($('game'), { antialias: (window.devicePixelRatio || 1) < 1.5, players: 4 });
  } catch (e) {
    return fatal('Impossible de démarrer le rendu 3D (' + e.message + ').');
  }
  input = createInput({ touchLayer: $('touch'), strikeButton: $('strikeBtn') });
  hud = createHud();
  perf = createPerf(renderer, { debug: params.get('debug') === '1', el: $('fps') });
  game = createGame({ renderer, input, hud, audio, device, store, params, onScreen });
  measure();
  applySettings();
  wireUi();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', () => setTimeout(measure, 150));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', measure);
  // Pas de zoom ni de menu contextuel involontaires
  for (const ev of ['contextmenu', 'gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!e.target.closest || !e.target.closest('.scroll, .detail-sheet')) e.preventDefault();
    },
    { passive: false }
  );
  // Pause automatique quand l'onglet perd le focus ; rendu suspendu en arrière-plan
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.pause();
      stopLoop();
      audio.suspend();
    } else {
      startLoop();
      audio.unlock();
      if (device.wantAwake) device.keepAwake(true); // le verrou de veille est perdu en arrière-plan
    }
  });
  window.addEventListener('blur', () => game.pause());
  // L'audio ne peut démarrer qu'après un geste de l'utilisateur
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.unlock(), { capture: true, passive: true });
  $('fps').hidden = params.get('debug') !== '1';
  document.documentElement.classList.toggle('debug', params.get('debug') === '1');
  onScreen('home');
  startLoop();
  registerServiceWorker();
  showBuild();
  // Accès de test (navigateur sans affichage) : état courant, sans effet sur le jeu
  if (params.has('debug')) window.__glasslab = { game, store, renderer };
}

/**
 * Version publiée, en bas de l'accueil : publication.txt est écrit à chaque publication sur GitHub Pages
 * (tools/publier.sh : commit, origine, date). Absent en local : rien n'est affiché.
 */
function showBuild() {
  fetch('publication.txt')
    .then((r) => (r.ok ? r.text() : ''))
    .then((text) => {
      const [sha, , date] = text.trim().split(/\s+/);
      if (!/^[0-9a-f]{7,40}$/.test(sha || '')) return;
      const d = new Date(date);
      const when = isNaN(d) ? '' : ' · ' + d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      $('buildInfo').textContent = `Version ${sha.slice(0, 7)}${when}`;
      $('buildInfo').hidden = false;
    })
    .catch(() => {});
}

/** PWA : service worker (hors ligne après le premier chargement), seulement en HTTPS ou en local. */
function registerServiceWorker() {
  try {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || local) && !params.has('nosw')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  } catch (e) {
    /* ignoré */
  }
}

boot();

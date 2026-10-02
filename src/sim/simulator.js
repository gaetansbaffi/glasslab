/*
 * Glass Lab — simulateur de vitres : interface (vue de dessus, vue de côté, réglages, résultats).
 * Les calculs sont dans model.js, sur le moteur physique du jeu.
 */
import P from '../core/physics.js';
import { PRESETS, simulate } from './model.js';

const $ = (id) => document.getElementById(id);
const C = P.COURT;
const COL = { turf: '#2463b0', out: '#16304a', line: 'rgba(255,255,255,0.85)', glass: '#8fe3ff', mesh: '#a6b1bd', door: '#ff9f1c', ball: '#f2ff1f', shadow: 'rgba(0,0,0,0.35)', net: '#e8edf2', text: '#9fb0c0' };

const state = Object.assign({ preset: PRESETS[0].id }, JSON.parse(JSON.stringify(PRESETS[0])));
let result = null;
let anim = { t: 0, slow: false, last: 0 };
let placing = 'bounce'; // un toucher dans ton camp place : 'bounce' (le rebond) ou 'me' (toi)
let camMode = 'player';
let pathFor = null; // résultat dont la trajectoire 3D est construite

/** Ta place sur le terrain : choisie, sinon un peu devant le rebond (là où l'on attend la balle). */
function mePos() {
  if (state.me) return state.me;
  return { x: Math.max(1.2, Math.min(C.width - 1.2, state.to.x + (state.to.x > 5 ? -1.2 : 1.2))), y: Math.max(1.8, Math.min(8.5, state.to.y + 2.6)) };
}

/* ---------- Réglages ---------- */

function bindRange(id, key, fmt) {
  const el = $(id);
  const out = $(id + 'Out');
  const show = () => (out.textContent = fmt(state[key]));
  el.addEventListener('input', () => {
    state[key] = Number(el.value);
    state.preset = null;
    show();
    run();
  });
  return () => {
    el.value = state[key];
    show();
  };
}

const syncers = [
  bindRange('kmh', 'kmh', (v) => `${v} km/h`),
  bindRange('top', 'top', (v) => (v === 0 ? 'aucun' : `${v > 0 ? 'lift' : 'coupé'} ${Math.abs(v)} rad/s (${(Math.abs(v) / (2 * Math.PI)).toFixed(0)} tours/s)`)),
  bindRange('side', 'side', (v) => (v === 0 ? 'aucun' : `${v > 0 ? 'droite' : 'gauche'} ${Math.abs(v)} rad/s`)),
];
$('hz').addEventListener('input', () => {
  state.from.z = Number($('hz').value);
  state.preset = null;
  syncAll();
  run();
});

function syncAll() {
  syncers.forEach((f) => f());
  $('hz').value = state.from.z;
  $('hzOut').textContent = `${state.from.z.toFixed(2).replace('.', ',')} m`;
  $('tense').classList.toggle('on', !state.lob);
  $('lob').classList.toggle('on', state.lob);
  $('speed').classList.toggle('on', anim.slow);
  const f = (v) => v.toFixed(1).replace('.', ',');
  $('points').textContent = `Frappe : x ${f(state.from.x)} m, à ${f(state.from.y - 10)} m du filet · rebond : x ${f(state.to.x)} m, à ${f(state.to.y)} m de ta vitre de fond`;
  for (const b of document.querySelectorAll('#presets .chip')) b.classList.toggle('on', b.dataset.id === state.preset);
}

for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.type = 'button';
  b.dataset.id = p.id;
  b.textContent = p.name;
  b.addEventListener('click', () => {
    Object.assign(state, JSON.parse(JSON.stringify(p)), { preset: p.id, me: null });
    syncAll();
    run();
  });
  $('presets').appendChild(b);
}
$('tense').addEventListener('click', () => {
  state.lob = false;
  state.preset = null;
  syncAll();
  run();
});
$('lob').addEventListener('click', () => {
  state.lob = true;
  state.preset = null;
  syncAll();
  run();
});
$('replay').addEventListener('click', () => (anim.t = 0));
$('speed').addEventListener('click', () => {
  anim.slow = !anim.slow;
  syncAll();
});

/* ---------- Calcul ---------- */

function run() {
  result = simulate(state);
  anim.t = 0;
  renderResults();
}

const fmt = (v, d) => (v == null ? '—' : v.toFixed(d == null ? 2 : d).replace('.', ','));

function renderResults() {
  const s = result.summary;
  const rows = [
    ['Vitesse au départ', `${Math.round(s.kmh)} km/h` + (s.reachable ? '' : ' <span class="warn">(trop lent pour ce point : tir le moins rapide possible)</span>')],
    ['Effet', s.spin.rate < 1 ? 'aucun' : `${s.spin.top >= 0 ? 'lift' : 'coupé'} ${Math.round(Math.abs(s.spin.top))} · latéral ${Math.round(s.spin.side)} rad/s`],
    ['Vol jusqu’au rebond', s.flightTime == null ? '—' : `${fmt(s.flightTime)} s`],
    ['Hauteur maximale', `${fmt(s.apex)} m`],
    ['Famille', s.family || '—'],
    ['Après la dernière paroi', s.afterWall ? `monte à ${fmt(s.afterWall.height)} m, ${fmt(s.afterWall.time)} s avant le 2e rebond` : '—'],
    ['Entre les deux rebonds', s.playTime == null ? '—' : `${fmt(s.playTime)} s pour la jouer`],
    ['Issue', s.verdict],
  ];
  $('summary').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  $('contacts').innerHTML = result.contacts
    .map((c, i) => `<tr><td class="n">${i + 1}</td><td class="k-${c.kind}">${c.label}</td><td>${fmt(c.t)} s</td><td>${fmt(c.pos.z)} m</td><td>${c.kmhIn}${c.kmhOut == null ? '' : ' → ' + c.kmhOut}</td></tr>`)
    .join('');
}

/* ---------- Dessin ---------- */

function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

/** Repère de la vue de dessus : x à droite, y vers le haut (ta vitre de fond en bas). */
function topFrame(w, h) {
  const m = 0.7;
  const k = Math.min(w / (C.width + 2 * m), h / (C.length + 2 * m));
  const ox = (w - C.width * k) / 2;
  const oy = (h + C.length * k) / 2;
  return { k, X: (x) => ox + x * k, Y: (y) => oy - y * k, inv: (px, py) => ({ x: (px - ox) / k, y: (oy - py) / k }) };
}

/** Segments d'une paroi latérale (à hauteur de balle basse, 1 m) : vitre, grille, porte. */
function sideSegments() {
  const segs = [];
  const ys = [0, C.depth];
  for (const g of C.sideGlass) ys.push(g.from, g.to);
  for (const d of C.doors) ys.push(d.from, d.to);
  const cuts = [...new Set(ys)].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    segs.push({ from: cuts[i], to: cuts[i + 1], kind: P.wallAt('left', mid, 1) });
  }
  return segs;
}
const SIDE = sideSegments();
const wallColor = (kind) => (kind === 'glass' ? COL.glass : kind === 'mesh' ? COL.mesh : COL.door);

function drawTop(t) {
  const { g, w, h } = fit($('viewTop'));
  const f = topFrame(w, h);
  g.clearRect(0, 0, w, h);
  g.fillStyle = COL.turf;
  g.fillRect(f.X(0), f.Y(C.length), C.width * f.k, C.length * f.k);
  // Lignes : service et centrale, filet
  g.strokeStyle = COL.line;
  g.lineWidth = 1.5;
  g.beginPath();
  for (const y of [C.serviceLine, C.length - C.serviceLine]) {
    g.moveTo(f.X(0), f.Y(y));
    g.lineTo(f.X(C.width), f.Y(y));
  }
  g.moveTo(f.X(C.width / 2), f.Y(C.serviceLine));
  g.lineTo(f.X(C.width / 2), f.Y(C.length - C.serviceLine));
  g.stroke();
  g.strokeStyle = COL.net;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(f.X(-0.15), f.Y(C.depth));
  g.lineTo(f.X(C.width + 0.15), f.Y(C.depth));
  g.stroke();
  // Parois : fonds vitrés, latérales vitre / grille / porte (dans les deux moitiés)
  g.lineWidth = 6;
  g.lineCap = 'butt';
  g.strokeStyle = COL.glass;
  g.beginPath();
  for (const y of [0, C.length]) {
    g.moveTo(f.X(0), f.Y(y));
    g.lineTo(f.X(C.width), f.Y(y));
  }
  g.stroke();
  for (const half of [0, 1]) {
    for (const s of SIDE) {
      const y0 = half ? C.length - s.from : s.from;
      const y1 = half ? C.length - s.to : s.to;
      g.strokeStyle = wallColor(s.kind);
      g.setLineDash(s.kind === 'open' ? [4, 4] : s.kind === 'mesh' ? [2, 2] : []);
      g.beginPath();
      for (const x of [0, C.width]) {
        g.moveTo(f.X(x), f.Y(y0));
        g.lineTo(f.X(x), f.Y(y1));
      }
      g.stroke();
    }
  }
  g.setLineDash([]);
  if (!result) return;
  // Trajectoire : ombre au sol, jusqu'à l'instant t (puis le reste en pâle)
  const pts = result.samples;
  g.lineWidth = 2;
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? COL.ball : 'rgba(242,255,31,0.25)';
    g.beginPath();
    let started = false;
    for (const p of pts) {
      if (pass && p.t > t) break;
      if (!started) g.moveTo(f.X(p.x), f.Y(p.y));
      else g.lineTo(f.X(p.x), f.Y(p.y));
      started = true;
    }
    g.stroke();
  }
  // Points visés et contacts
  marker(g, f.X(state.from.x), f.Y(state.from.y), '#ffffff', 'F');
  marker(g, f.X(state.to.x), f.Y(state.to.y), COL.ball, '');
  const me = mePos();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(f.X(me.x), f.Y(me.y), 5, 0, 2 * Math.PI);
  g.fill();
  g.font = '700 12px system-ui, sans-serif';
  g.fillText('Toi', f.X(me.x) + 8, f.Y(me.y) + 4);
  result.sim.contacts.forEach((c, i) => {
    if (c.type === 'cord') return;
    badge(g, f.X(c.pos.x), f.Y(c.pos.y), i + 1, c.t <= t);
  });
  const b = P.stateAt(result.sim, t);
  g.fillStyle = COL.shadow;
  g.beginPath();
  g.arc(f.X(b.x), f.Y(b.y), 6, 0, 2 * Math.PI);
  g.fill();
  g.fillStyle = COL.ball;
  g.strokeStyle = '#2e3300';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(f.X(b.x), f.Y(b.y), 4 + Math.min(6, b.z * 1.5), 0, 2 * Math.PI);
  g.fill();
  g.stroke();
}

function marker(g, x, y, color, label) {
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x, y, 8, 0, 2 * Math.PI);
  g.moveTo(x - 11, y);
  g.lineTo(x + 11, y);
  g.moveTo(x, y - 11);
  g.lineTo(x, y + 11);
  g.stroke();
  if (label) {
    g.fillStyle = color;
    g.font = '700 12px system-ui, sans-serif';
    g.fillText(label, x + 10, y - 8);
  }
}

function badge(g, x, y, n, done) {
  g.fillStyle = done ? '#0b1219' : 'rgba(11,18,25,0.55)';
  g.strokeStyle = done ? '#ffffff' : 'rgba(255,255,255,0.5)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(x, y, 9, 0, 2 * Math.PI);
  g.fill();
  g.stroke();
  g.fillStyle = done ? '#ffffff' : 'rgba(255,255,255,0.6)';
  g.font = '700 11px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), x, y + 0.5);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
}

function drawSide(t) {
  const { g, w, h } = fit($('viewSide'));
  const zMax = 5;
  const pad = { l: 26, r: 8, t: 8, b: 18 };
  const k = Math.min((w - pad.l - pad.r) / (C.length + 1), (h - pad.t - pad.b) / zMax);
  const Y = (y) => pad.l + (y + 0.5) * k; // ta vitre de fond à gauche
  const Z = (z) => h - pad.b - z * k;
  g.clearRect(0, 0, w, h);
  // Repères de hauteur
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.fillStyle = COL.text;
  g.font = '11px system-ui, sans-serif';
  g.lineWidth = 1;
  for (let z = 1; z <= 4; z++) {
    g.beginPath();
    g.moveTo(Y(-0.5), Z(z));
    g.lineTo(Y(C.length + 0.5), Z(z));
    g.stroke();
    g.fillText(`${z} m`, 2, Z(z) + 4);
  }
  // Sol, filet, fonds (vitre 3 m + grille 1 m)
  g.fillStyle = COL.turf;
  g.fillRect(Y(0), Z(0), C.length * k, 4);
  g.strokeStyle = COL.net;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(Y(C.depth), Z(0));
  g.lineTo(Y(C.depth), Z(C.netHeight));
  g.stroke();
  for (const y of [0, C.length]) {
    g.lineWidth = 5;
    g.strokeStyle = COL.glass;
    g.beginPath();
    g.moveTo(Y(y), Z(0));
    g.lineTo(Y(y), Z(C.backGlassHeight));
    g.stroke();
    g.strokeStyle = COL.mesh;
    g.setLineDash([2, 2]);
    g.beginPath();
    g.moveTo(Y(y), Z(C.backGlassHeight));
    g.lineTo(Y(y), Z(C.backHeight));
    g.stroke();
    g.setLineDash([]);
  }
  // Latérale vue à travers (escalier vitré, porte), en pâle
  g.globalAlpha = 0.35;
  for (const half of [0, 1]) {
    for (const s of C.sideGlass) {
      const y0 = half ? C.length - s.to : s.from;
      g.fillStyle = COL.glass;
      g.fillRect(Y(y0), Z(s.height), (s.to - s.from) * k, s.height * k);
    }
    for (const d of C.doors) {
      const y0 = half ? C.length - d.to : d.from;
      g.strokeStyle = COL.door;
      g.lineWidth = 2;
      g.strokeRect(Y(y0), Z(d.height), (d.to - d.from) * k, d.height * k);
    }
  }
  g.globalAlpha = 1;
  if (!result) return;
  const pts = result.samples;
  g.lineWidth = 2;
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? COL.ball : 'rgba(242,255,31,0.25)';
    g.beginPath();
    let started = false;
    for (const p of pts) {
      if (pass && p.t > t) break;
      if (!started) g.moveTo(Y(p.y), Z(p.z));
      else g.lineTo(Y(p.y), Z(p.z));
      started = true;
    }
    g.stroke();
  }
  result.sim.contacts.forEach((c, i) => {
    if (c.type === 'cord') return;
    badge(g, Y(c.pos.y), Z(c.pos.z), i + 1, c.t <= t);
  });
  const b = P.stateAt(result.sim, t);
  g.fillStyle = COL.ball;
  g.strokeStyle = '#2e3300';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(Y(b.y), Z(b.z), 5, 0, 2 * Math.PI);
  g.fill();
  g.stroke();
}

/* ---------- Toucher le court : rebond (chez toi) ou frappe (en face) ---------- */

$('viewTop').addEventListener('pointerdown', (ev) => {
  const r = $('viewTop').getBoundingClientRect();
  const f = topFrame(r.width, r.height);
  const p = f.inv(ev.clientX - r.left, ev.clientY - r.top);
  const x = Math.max(0.3, Math.min(C.width - 0.3, p.x));
  if (p.y < C.depth && placing === 'me') state.me = { x, y: Math.max(0.3, Math.min(C.depth - 0.5, p.y)) };
  else if (p.y < C.depth) state.to = { x, y: Math.max(0.2, Math.min(C.depth - 0.2, p.y)) };
  else state.from = { x, y: Math.max(C.depth + 0.5, Math.min(C.length - 0.3, p.y)), z: state.from.z };
  state.preset = null;
  syncAll();
  run();
});

for (const b of document.querySelectorAll('#place .chip')) {
  b.addEventListener('click', () => {
    placing = b.dataset.place;
    for (const o of document.querySelectorAll('#place .chip')) o.classList.toggle('on', o === b);
  });
}
for (const b of document.querySelectorAll('#cams .chip')) {
  b.addEventListener('click', () => {
    camMode = b.dataset.cam;
    for (const o of document.querySelectorAll('#cams .chip')) o.classList.toggle('on', o === b);
  });
}

/* ---------- Vue 3D : le court du jeu, vu depuis la place choisie ---------- */

let r3 = null;
const look = { x: 5, y: 15, z: 1 }; // point regardé (vue « toi ») : suit la balle en douceur
const cam = { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, vFov: 60 };
const view = { ball: null, reach: null, pathT: null, best: null, mine: null, landing: null };
import('../view/renderer.js')
  .then(({ createRenderer, webglAvailable }) => {
    if (!webglAvailable()) throw new Error('WebGL');
    r3 = createRenderer($('view3d'), { antialias: true, players: 0 });
  })
  .catch(() => {
    $('card3d').hidden = true; // sans WebGL : vues de dessus et de côté seulement
  });

function draw3d(t, dt) {
  if (!r3 || !result) return;
  const el = $('view3d');
  const w = el.clientWidth;
  const h = el.clientHeight;
  r3.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r3.resize(w, h);
  if (pathFor !== result) {
    r3.ball.setPath(result.samples);
    pathFor = result;
  }
  const b = P.stateAt(result.sim, t);
  const me = mePos();
  const k = 1 - Math.exp(-dt / 0.12);
  if (t === 0) Object.assign(look, { x: state.from.x, y: state.from.y, z: state.from.z });
  else {
    look.x += (b.x - look.x) * k;
    look.y += (b.y - look.y) * k;
    look.z += (b.z - look.z) * k;
  }
  if (camMode === 'player') {
    Object.assign(cam.eye, { x: me.x, y: me.y, z: 1.65 });
    Object.assign(cam.target, look);
    cam.vFov = 62;
  } else if (camMode === 'behind') {
    Object.assign(cam.eye, { x: 5, y: -2.4, z: 2.6 });
    Object.assign(cam.target, { x: 5, y: 5, z: 0.9 });
    cam.vFov = 58;
  } else if (camMode === 'side') {
    Object.assign(cam.eye, { x: 13.5, y: 6.5, z: 2.6 });
    Object.assign(cam.target, { x: 5, y: 6.5, z: 0.9 });
    cam.vFov = 58;
  } else {
    Object.assign(cam.eye, { x: state.from.x, y: Math.min(C.length + 1, state.from.y + 1.2), z: 1.8 });
    Object.assign(cam.target, { x: state.to.x, y: state.to.y, z: 0.6 });
    cam.vFov = 58;
  }
  // Regarder exactement vers le bas (balle à la verticale) n'a pas de sens pour la caméra : on décale
  if (Math.hypot(cam.target.x - cam.eye.x, cam.target.y - cam.eye.y) < 0.05) cam.target.y += 0.05;
  r3.setCamera(cam, null);
  view.ball = b;
  view.reach = camMode === 'player' ? null : me;
  view.pathT = t;
  r3.ball.update(view, dt);
  r3.render();
}

/* ---------- Animation ---------- */

function loop(now) {
  const dt = anim.last ? Math.min(0.05, (now - anim.last) / 1000) : 0;
  anim.last = now;
  if (result) {
    anim.t += dt * (anim.slow ? 0.25 : 1);
    if (anim.t > result.sim.endT + 1.2) anim.t = 0; // pause d'une seconde, puis on recommence
  }
  const t = result ? Math.min(anim.t, result.sim.endT) : 0;
  drawTop(t);
  drawSide(t);
  draw3d(t, dt * (anim.slow ? 0.25 : 1));
  requestAnimationFrame(loop);
}

syncAll();
run();
requestAnimationFrame(loop);

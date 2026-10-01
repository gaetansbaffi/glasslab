/*
 * Glass Lab — interface superposée : HUD minimal, écrans (accueil, pause, fin de match, réglages, stats)
 * et Détail. Pendant le jeu : le tableau de score, Pause, joystick, Frappe, le toast et les annonces brèves.
 * Réglages : son et vibration, mode gaucher, données (3 au total) ; le format du match se choisit à l'accueil.
 */
import Q from './core/quality.js';
import P from './core/physics.js';
import G from './core/geometry.js';
import SG from './core/shotgen.js';
import SC from './core/score.js';
import Stats from './core/stats.js';
import { SETTINGS_UI } from './settings.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d) => n.toFixed(d == null ? 2 : d).replace('.', ',');
const pct = (v) => (v == null ? '—' : Math.round(v * 100) + ' %');
const NAMES = Q.SHOT_NAMES;
const lower = (t) => NAMES[t].toLowerCase();

/** Conseil court pour chaque motif de perte. */
const MISS_HINT = {
  early: 'attends que la balle entre dans ta zone',
  late: 'frappe plus tôt, la balle était passée',
  far: 'rapproche-toi de la balle avant de frapper',
  notReached: 'déplace-toi dès la frappe adverse',
  weak: 'mauvaise position : frappe ratée',
};

/** Mini-carte : lignes du court (m) — vitres, filet, lignes de service, ligne centrale. */
const C = P.COURT;
const MAP_LINES = [
  { a: [0, 0], b: [C.width, 0], k: 'glass' },
  { a: [0, 0], b: [0, C.length], k: 'glass' },
  { a: [C.width, 0], b: [C.width, C.length], k: 'glass' },
  { a: [0, C.length], b: [C.width, C.length], k: 'glass' },
  { a: [0, C.depth], b: [C.width, C.depth], k: 'net' },
  { a: [0, C.serviceLine], b: [C.width, C.serviceLine], k: 'line' },
  { a: [0, C.length - C.serviceLine], b: [C.width, C.length - C.serviceLine], k: 'line' },
  { a: [C.width / 2, C.serviceLine], b: [C.width / 2, C.length - C.serviceLine], k: 'line' },
];
const MAP_STYLE = {
  glass: ['rgba(142, 203, 255, 0.75)', 1.5],
  net: ['rgba(255, 255, 255, 0.95)', 2],
  line: ['rgba(255, 255, 255, 0.35)', 1],
};
const MAP_REACH = 1.1; // anneau de portée (m), comme au sol

const STAKES = { break: 'Balle de break', set: 'Balle de set', match: 'Balle de match' };
const who = (team) => (team === 0 ? 'vous' : 'eux');

/** Enjeu du point en mots : « Point en or · balle de set pour vous », « Avantage eux »… (ou ''). */
export function stakeText(d) {
  const parts = [];
  if (d.note) parts.push(d.note);
  if (d.stake) parts.push(`${STAKES[d.stake.kind]} pour ${who(d.stake.team)}`);
  return parts.map((p, i) => (i ? p.charAt(0).toLowerCase() + p.slice(1) : p)).join(' · ');
}

/** Score du match en une ligne : sets terminés puis jeux et points en cours (« 6-4 · 2-3 · 30-15 »). */
export function scoreLine(d, withPoints) {
  const parts = d.history.map(SC.setLabel);
  if (d.winner == null) {
    if (!d.superTb) parts.push(`${d.games[0]}-${d.games[1]}`);
    if (withPoints && (d.superTb || d.points.some((p) => p !== '0'))) parts.push(`${d.points[0]}-${d.points[1]}`);
  }
  return parts.join(' · ');
}

export function createHud() {
  const toast = { el: $('toast'), timer: 0 };
  const guide = { el: $('guide'), step: -1, timer: 0, onDone: null };
  const screens = ['home', 'pause', 'matchEnd', 'settings', 'stats'];
  let backTo = null;

  function show(name) {
    for (const s of screens) $(s).hidden = s !== name;
  }

  /* ----- Toast de feedback ----- */

  /** Texte court du feedback (icône + couleur + mots, jamais la couleur seule). */
  function feedbackLine(r, cfg) {
    if (r.outcome === 'miss' && r.reason !== 'weak') {
      return { level: 'bad', icon: '✕', title: `${r.reasonLabel} · mieux : ${lower(r.bestType)}`, sub: MISS_HINT[r.reason] };
    }
    const why = Q.weakness(r, cfg) || Q.doublesAdvice(r.doubles);
    if (r.outcome === 'miss') return { level: 'bad', icon: '✕', title: `${NAMES[r.type]} ${fmt(r.quality)} · dans le filet`, sub: why || MISS_HINT.weak };
    const level = r.quality >= cfg.quality.good ? 'good' : r.quality >= cfg.quality.ok ? 'ok' : 'bad';
    const icon = level === 'good' ? '✓' : level === 'ok' ? '~' : '!';
    // Choix à moins de decisionTolerance du meilleur : bon choix aussi (pas de « mieux » pour 0,01)
    if (r.type === r.bestType || r.decisionOk) return { level, icon, title: `${NAMES[r.type]} ${fmt(r.quality)} · bon choix`, sub: why };
    return { level, icon, title: `${NAMES[r.type]} ${fmt(r.quality)} · mieux : ${lower(r.bestType)} ${fmt(r.bestQuality)}`, sub: why };
  }

  function showToast(r, cfg, ms, withDetail) {
    const f = feedbackLine(r, cfg);
    toast.el.className = 'toast ' + f.level;
    $('toastIcon').textContent = f.icon;
    $('toastTitle').textContent = f.title;
    $('toastSub').textContent = f.sub || '';
    $('toastSub').hidden = !f.sub;
    $('toastDetail').hidden = !withDetail;
    toast.el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(hideToast, ms);
    return f;
  }

  function hideToast() {
    clearTimeout(toast.timer);
    toast.el.hidden = true;
  }

  /* ----- Bulles de guide (premier lancement, jamais bloquantes) ----- */

  const GUIDE = [
    { text: 'Déplace-toi', cls: 'at-joy' },
    { text: 'Appuie sur Frappe au bon moment', cls: 'at-strike' },
    { text: 'Lis le conseil', cls: 'at-toast' },
  ];

  function guideShow(i) {
    if (guide.step >= i || guide.step === 99) return;
    guide.step = i;
    const g = GUIDE[i];
    guide.el.textContent = g.text;
    guide.el.className = 'guide ' + g.cls;
    guide.el.hidden = false;
    clearTimeout(guide.timer);
    guide.timer = setTimeout(() => guideHide(i), 6000);
  }

  function guideHide(i) {
    if (guide.step !== i || guide.el.hidden) return;
    guide.el.hidden = true;
    if (i === GUIDE.length - 1) {
      guide.step = 99;
      if (guide.onDone) guide.onDone();
    }
  }

  guide.el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    guideHide(guide.step);
  });

  /* ----- Réglages : deux interrupteurs (la section Données est fixe dans le HTML) ----- */

  function renderSettings(settings, onChange) {
    const list = $('settingsList');
    list.innerHTML = '';
    for (const def of SETTINGS_UI) {
      const row = document.createElement('div');
      row.className = 'setting';
      const id = 'set-' + def.key;
      row.innerHTML = `<label class="lbl" for="${id}">${def.label}${def.hint ? `<small>${def.hint}</small>` : ''}</label>`;
      const sw = document.createElement('span');
      sw.className = 'switch';
      sw.innerHTML = `<input type="checkbox" role="switch" id="${id}"><span></span>`;
      const input = sw.firstChild;
      input.checked = !!settings[def.key];
      input.addEventListener('change', () => onChange(def.key, input.checked));
      row.append(sw);
      list.append(row);
    }
  }

  /* ----- Annonces du partenaire (« À moi ! », « À toi ! ») au-dessus de sa tête ----- */

  const callEl = $('call');
  let callTimer = 0;
  function call(text) {
    callEl.textContent = text;
    callEl.hidden = false;
    clearTimeout(callTimer);
    callTimer = setTimeout(() => (callEl.hidden = true), 1300);
  }

  /** Suit la tête du partenaire à l'écran ; hors champ, la bulle se range en haut à gauche. */
  function placeCall(p) {
    if (callEl.hidden) return;
    const off = !p.visible;
    callEl.classList.toggle('docked', off);
    if (!off) callEl.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    else callEl.style.transform = '';
  }

  /* ----- Effet de la balle qui t'arrive : étiquette brève (« Balle coupée », « Balle liftée »…) ----- */

  let spinTimer = 0;
  function spinTag(label) {
    const el = $('spinTag');
    const l = label.toLowerCase();
    el.className = 'spin-tag ' + (l.includes('coup') ? 'cut' : l.includes('lift') ? 'top' : 'side');
    el.textContent = label;
    el.hidden = false;
    clearTimeout(spinTimer);
    spinTimer = setTimeout(() => (el.hidden = true), 1300);
  }

  /* ----- Mini-carte des balles hautes : vue de dessus orientée comme le joystick (haut = devant toi) ----- */

  const mapEl = $('ballMap');
  const mapCtx = mapEl.getContext('2d');
  let mapOn = false;

  /**
   * m = { yaw (lacet du joystick), range (m), me, partner, ball: {x,y,z}, landing: {x,y}, smash: {x,y} | null }
   * ou null (carte masquée). Toi au centre ; pousser le pouce vers un repère de la carte y mène.
   */
  function map(m) {
    if (!m) {
      if (mapOn) mapEl.classList.remove('on');
      mapOn = false;
      return;
    }
    if (!mapOn) mapEl.classList.add('on');
    mapOn = true;
    const size = mapEl.clientWidth || 104;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (mapEl.width !== px) mapEl.width = mapEl.height = px;
    const g = mapCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const R = size / 2;
    const k = (R - 6) / m.range; // px par mètre
    const edge = R - 7; // repères trop loin : posés au bord de la carte
    const at = (p, clamp) => {
      const v = G.toStickFrame(p.x - m.me.x, p.y - m.me.y, m.yaw);
      let x = v.x * k;
      let y = v.y * k;
      const l = Math.hypot(x, y);
      if (clamp && l > edge) {
        x *= edge / l;
        y *= edge / l;
      }
      return { x: R + x, y: R - y };
    };
    const disc = (p, r, fill, stroke) => {
      g.beginPath();
      g.arc(p.x, p.y, r, 0, 2 * Math.PI);
      if (fill) {
        g.fillStyle = fill;
        g.fill();
      }
      if (stroke) {
        g.strokeStyle = stroke;
        g.stroke();
      }
    };
    g.save();
    g.beginPath();
    g.arc(R, R, R - 1, 0, 2 * Math.PI);
    g.fillStyle = 'rgba(12, 20, 28, 0.66)';
    g.fill();
    g.clip();
    // Surface du court (dehors = fond sombre) : un lob qui sort tombe hors de la surface
    const corners = [at({ x: 0, y: 0 }), at({ x: C.width, y: 0 }), at({ x: C.width, y: C.length }), at({ x: 0, y: C.length })];
    g.beginPath();
    corners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fillStyle = 'rgba(40, 110, 200, 0.45)';
    g.fill();
    g.lineCap = 'round';
    for (const l of MAP_LINES) {
      const a = at({ x: l.a[0], y: l.a[1] });
      const b = at({ x: l.b[0], y: l.b[1] });
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokeStyle = MAP_STYLE[l.k][0];
      g.lineWidth = MAP_STYLE[l.k][1];
      g.stroke();
    }
    g.lineWidth = 1;
    disc({ x: R, y: R }, MAP_REACH * k, 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.4)');
    disc(at(m.partner, true), 3.5, 'rgba(255, 255, 255, 0.5)');
    // Trajet au sol de la balle jusqu'à son point de chute
    const ball = at(m.ball, true);
    const land = at(m.landing, true);
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(ball.x, ball.y);
    g.lineTo(land.x, land.y);
    g.strokeStyle = 'rgba(242, 255, 31, 0.55)';
    g.lineWidth = 1.5;
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 2;
    disc(land, 5, null, '#f2ff1f');
    disc(land, 1.6, '#f2ff1f');
    if (m.smash) {
      g.lineWidth = 2.5;
      disc(at(m.smash, true), 5.5, 'rgba(46, 232, 138, 0.25)', '#2ee88a');
    }
    // La balle : plus elle est haute, plus le point est gros
    g.lineWidth = 1.5;
    disc(ball, 2.5 + Math.min(3.5, m.ball.z * 0.5), '#f2ff1f', '#2e3300');
    // Toi : flèche vers le haut (devant toi, haut du joystick)
    g.beginPath();
    g.moveTo(R, R - 6.5);
    g.lineTo(R + 4.5, R + 4);
    g.lineTo(R - 4.5, R + 4);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.strokeStyle = '#0b1219';
    g.lineWidth = 1;
    g.stroke();
    g.restore();
    g.lineWidth = 1.5;
    disc({ x: R, y: R }, R - 1, null, 'rgba(255, 255, 255, 0.55)');
  }

  /* ----- Score : tableau en haut à gauche ----- */

  function setScore(d) {
    if (!d) return;
    const rows = [$('scoreUs'), $('scoreThem')];
    rows.forEach((row, team) => {
      row.querySelector('.srv').textContent = d.serverTeam === team && d.winner == null ? '●' : '';
      // Sets terminés : jeux de chaque set (points du super jeu décisif), gagnés en blanc
      row.querySelector('.hist').innerHTML = d.history
        .map((h) => `<span class="${h.games[team] > h.games[1 - team] ? 'w' : ''}">${h.super && h.tb ? h.tb[team] : h.games[team]}</span>`)
        .join('');
      row.querySelector('.games').textContent = d.superTb || d.winner != null ? '' : d.games[team];
      const pts = row.querySelector('.pts');
      pts.textContent = d.points[team];
      pts.hidden = d.winner != null;
    });
    const note = $('scoreNote');
    const text = d.winner == null ? stakeText(d) : '';
    note.textContent = text;
    note.hidden = !text;
  }

  /**
   * Grande annonce brève : score annoncé par l'arbitre, jeu, set, faute de service, let.
   * won : vrai / faux / null (neutre) ; sub : ligne d'explication (raison du point…).
   */
  let bannerTimer = 0;
  function banner(text, won, sub, ms) {
    const el = $('banner');
    el.className = 'banner' + (won === true ? ' won' : won === false ? ' lost' : '');
    $('bannerText').textContent = text;
    $('bannerSub').textContent = sub || '';
    el.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => (el.hidden = true), ms || 1700);
  }

  /** « À toi de servir » près du bouton Frappe. */
  function servePrompt(on) {
    $('servePrompt').hidden = !on;
  }

  /** Changement de point : court fondu au noir (les joueurs sont replacés pendant le noir). */
  function cut() {
    const el = $('fade');
    el.classList.remove('fading');
    el.style.opacity = '1';
    void el.offsetWidth;
    el.classList.add('fading');
    el.style.opacity = '0';
  }

  /* ----- Niveau : annonce discrète quand la difficulté adaptative change ----- */

  let levelTimer = 0;
  function levelChange(level, delta) {
    const el = $('level');
    el.textContent = `Niveau ${level} ${delta > 0 ? '↑' : '↓'}`;
    el.hidden = false;
    clearTimeout(levelTimer);
    levelTimer = setTimeout(() => (el.hidden = true), 2200);
  }

  /* ----- Stats (minimalistes) ----- */

  function renderStats(state) {
    const balls = state.balls;
    const fs = Stats.familyStats(balls);
    const ds = Stats.decisionStats(balls);
    let html = `<div class="summary">
      <div class="kpi"><b>${balls.length}</b><span>Balles jouées</span></div>
      <div class="kpi"><b>${pct(ds.accuracy)}</b><span>Précision de décision</span></div>
      <div class="kpi"><b>${state.bestStreak}</b><span>Meilleure série</span></div>
      <div class="kpi"><b>${state.level}</b><span>Niveau</span></div></div>`;
    html += '<table class="stats-table"><thead><tr><th>Famille de balle</th><th class="num">Réussite</th><th class="num">Qualité moy.</th></tr></thead><tbody>';
    for (const f of Stats.MATCH_FAMILIES) {
      const x = fs[f];
      html += `<tr><td>${SG.FAMILIES[f].short} <small>(${x.n})</small></td><td class="num">${pct(x.rate)}</td><td class="num">${x.meanQuality == null ? '—' : fmt(x.meanQuality)}</td></tr>`;
    }
    html += '</tbody></table>';
    const tips = [];
    for (const t of Q.SHOT_TYPES) {
      const c = ds.byChosen[t];
      if (c.n && c.topBetter && c.topBetterRate >= 0.2) tips.push(`Tu choisis ${lower(t)} alors qu’une ${lower(c.topBetter)} était meilleure ${pct(c.topBetterRate)} du temps.`);
    }
    const dbl = Stats.doublesStats(balls);
    if (dbl.n >= 5) {
      html += `<p class="small">Aligné avec ton partenaire au moment de frapper : <b>${pct(dbl.aligned)}</b> (${dbl.n} frappes).</p>`;
      if (dbl.aligned < 0.7) tips.push('Reste aligné avec ton partenaire : montez et reculez ensemble.');
    }
    if (tips.length) html += '<h3>À travailler</h3><ul class="detail-lines">' + tips.map((t) => `<li>${t}</li>`).join('') + '</ul>';
    const rec = state.record;
    if (rec && rec.points[0] + rec.points[1] > 0) {
      const m = rec.matches || [0, 0];
      html += `<p class="small">Matchs gagnés ${m[0]}, perdus ${m[1]} · sets ${rec.sets[0]}-${rec.sets[1]} · jeux ${rec.games[0]}-${rec.games[1]} · points ${rec.points[0]}-${rec.points[1]}.</p>`;
    }
    if (!balls.length) html += '<p class="small">Joue quelques balles pour voir tes statistiques.</p>';
    $('statsBody').innerHTML = html;
  }

  /** Quatre indicateurs de la session (tes balles). */
  function kpis(s) {
    return `
      <div class="kpi"><b>${s.balls}</b><span>Tes balles</span></div>
      <div class="kpi"><b>${s.meanQuality == null ? '—' : fmt(s.meanQuality)}</b><span>Qualité moyenne</span></div>
      <div class="kpi"><b>${s.bestStreak}</b><span>Meilleure série</span></div>
      <div class="kpi"><b>${pct(s.decision)}</b><span>Précision de décision</span></div>`;
  }

  function renderSummary(s, score, points) {
    const fmtName = score && score.bestOf ? (score.bestOf === 1 ? 'Match en 1 set' : 'Match en 2 sets gagnants') : '';
    const sc = score ? `${scoreLine(score, true)}${stakeText(score) ? ' · ' + stakeText(score) : ''}` : '';
    $('summary').innerHTML = `
      ${sc ? `<p class="summary-score">${sc}<small>${fmtName ? fmtName + ' · ' : ''}Points gagnés ${points[0]} · perdus ${points[1]}</small></p>` : ''}
      ${kpis(s)}`;
  }

  /** Fin de match : victoire ou défaite, score par set, points et tes indicateurs de la session. */
  function renderMatchEnd(o) {
    const won = o.winner === 0;
    const title = $('matchEndTitle');
    title.textContent = won ? 'Victoire' : 'Défaite';
    title.className = 'end-title ' + (won ? 'won' : 'lost');
    $('matchEndScore').innerHTML = `${o.score.history.map(SC.setLabel).join(' · ')}<small>Points gagnés ${o.points[0]} · perdus ${o.points[1]}</small>`;
    $('matchEndSummary').innerHTML = kpis(o.session);
  }

  /** Accueil : « Jouer » ou « Reprendre » (match en cours), format du prochain match. */
  function renderHome(save) {
    const cur = save.current;
    $('playBtn').textContent = cur ? 'Reprendre' : 'Jouer';
    const info = $('resumeInfo');
    if (cur) {
      const d = SC.display(cur.score);
      info.textContent = `Match en cours (${SC.FORMATS[cur.format].name}) · ${scoreLine(d, true)}`;
    }
    info.hidden = !cur;
    $('newMatchBtn').hidden = !cur;
    $('formatsLbl').textContent = cur ? 'Nouveau match' : 'Match';
    document.querySelectorAll('.fmt-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.format === save.format)));
  }

  /* ----- Détail ----- */

  function renderDetail(shot, r, cfg) {
    const fb = Q.feedback(r, SG.FAMILIES[shot.family].name, cfg);
    const ex = Q.explainBall(shot, r);
    $('detailTitle').textContent = fb.text;
    $('detailLines').innerHTML = ex.lines.map((l) => `<li>${l}</li>`).join('');
    $('detailRule').textContent = ex.rule;
  }

  function setCamButtons(mode) {
    document.querySelectorAll('.cam-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cam === mode)));
  }

  return {
    show,
    showToast,
    hideToast,
    guideShow,
    guideHide,
    onGuideDone(fn) {
      guide.onDone = fn;
    },
    get guideStep() {
      return guide.step;
    },
    renderSettings,
    levelChange,
    call,
    placeCall,
    spinTag,
    map,
    setScore,
    banner,
    servePrompt,
    cut,
    renderStats,
    renderSummary,
    renderMatchEnd,
    renderHome,
    renderDetail,
    setCamButtons,
    /** Ouvre un sous-écran (réglages, stats) en mémorisant l'écran de retour. */
    openSub(name, from) {
      backTo = from;
      show(name);
    },
    back() {
      show(backTo);
    },
    setHint(on) {
      $('hint').hidden = !on;
    },
    dataMessage(msg) {
      $('dataMsg').textContent = msg;
    },
  };
}

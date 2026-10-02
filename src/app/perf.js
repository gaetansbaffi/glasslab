/*
 * Glass Lab — qualité graphique automatique (aucun réglage) : résolution dynamique visant 60 i/s,
 * ombres des joueurs coupées en dernier recours. ?debug=1 affiche la cadence.
 */

export function createPerf(renderer, opts) {
  const perf = {
    maxPr: Math.min(window.devicePixelRatio || 1, 2), // pixel ratio plafonné à 2
    minPr: 0.55,
    pr: 0,
    fps: 60,
    low: 0, // durée cumulée sous 50 i/s
    high: 0, // durée cumulée au-dessus de 58 i/s
    debug: !!opts.debug,
    shown: 0,
    el: opts.el,
  };

  function setPixelRatio(pr) {
    perf.pr = pr;
    renderer.setPixelRatio(pr);
  }
  setPixelRatio(perf.maxPr);

  /** Baisse la résolution si < 50 i/s pendant 2 s, la remonte si stable (≥ 58 i/s pendant 4 s). */
  function adapt(dt) {
    perf.fps += (1 / Math.max(dt, 1e-3) - perf.fps) * 0.1;
    if (perf.fps < 50) {
      perf.low += dt;
      perf.high = 0;
      if (perf.low > 2) {
        perf.low = 0;
        if (perf.pr > perf.minPr) setPixelRatio(Math.max(perf.minPr, +(perf.pr * 0.85).toFixed(2)));
        else if (renderer.shadows) renderer.setShadows(false);
      }
    } else if (perf.fps >= 58) {
      perf.high += dt;
      perf.low = 0;
      if (perf.high > 4) {
        perf.high = 0;
        if (perf.pr < perf.maxPr) setPixelRatio(Math.min(perf.maxPr, +(perf.pr * 1.1).toFixed(2)));
      }
    } else perf.low = perf.high = 0;
  }

  function show(now) {
    if (!perf.debug || now - perf.shown < 500) return;
    perf.shown = now;
    const info = renderer.renderer.info.render;
    perf.el.textContent = `${Math.round(perf.fps)} i/s · résolution ×${perf.pr.toFixed(2)} · ombres ${renderer.shadows ? 'oui' : 'non'} · ${info.calls} appels · ${info.triangles} triangles`;
  }

  return { adapt, show, get fps() { return perf.fps; } };
}

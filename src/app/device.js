/*
 * Glass Lab — appareil : plein écran, verrouillage en paysage, maintien de l'écran allumé, tactile,
 * préférence « réduire les animations ». Tout est en try/catch : rien n'est garanti selon les navigateurs
 * (iOS Safari n'a ni plein écran ni verrouillage d'orientation).
 */

export const device = {
  isTouch: (() => {
    try {
      return window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {
      return false;
    }
  })(),

  reducedMotion: (() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  })(),

  async fullscreen(on) {
    try {
      const el = document.documentElement;
      const isOn = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (on === undefined) on = !isOn;
      if (on && !isOn) await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen());
      else if (!on && isOn) await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen());
    } catch (e) {
      /* refusé ou indisponible (iOS Safari) : le manifeste PWA prend le relais */
    }
  },

  async lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (e) {
      /* verrouillage impossible hors plein écran ou non supporté : le portrait reste jouable */
    }
  },

  wakeLock: null,
  wantAwake: false,
  async keepAwake(on) {
    device.wantAwake = on;
    try {
      if (on && !device.wakeLock && navigator.wakeLock) {
        device.wakeLock = await navigator.wakeLock.request('screen');
        device.wakeLock.addEventListener('release', () => (device.wakeLock = null));
      } else if (!on && device.wakeLock) {
        await device.wakeLock.release();
        device.wakeLock = null;
      }
    } catch (e) {
      device.wakeLock = null;
    }
  },

  /** Suit les changements de la préférence système « réduire les animations ». */
  onReducedMotionChange(fn) {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', () => {
        device.reducedMotion = mq.matches;
        fn(mq.matches);
      });
    } catch (e) {
      /* ignoré */
    }
  },
};

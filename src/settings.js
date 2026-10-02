/*
 * Glass Lab — réglages : un seul mode de jeu, trois réglages au total (son et vibration, mode gaucher,
 * données). Tout le reste est fixé par le jeu : vue 1re personne, champ de vision, déplacements par rapport
 * au regard, aides visuelles discrètes, difficulté et vitesse adaptatives, qualité graphique automatique,
 * mouvements réduits selon le système (prefers-reduced-motion).
 */

export const DEFAULT_SETTINGS = {
  sound: true, // son et vibration
  lefty: false, // mode gaucher : raquette dans la main gauche, joystick à droite, Frappe à gauche
};

/** Contrôles de l'écran Réglages (la section Données est dans le HTML). */
export const SETTINGS_UI = [
  { key: 'sound', label: 'Son et vibration', type: 'toggle' },
  { key: 'lefty', label: 'Mode gaucher', hint: 'Raquette dans la main gauche, joystick à droite, Frappe à gauche.', type: 'toggle' },
];

/** Préférence système « réduire les animations » (aucun réglage dans le jeu). */
export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

/* global __APP_VERSION__ */

/**
 * Build identity, injected at build time by the `define` block in vite.config.js
 * (git short SHA + commit date, with a "(dev)" suffix under the dev server). Shown in the
 * Settings panel and logged at boot so a deployed GitHub Pages build can be told apart from a
 * stale cached one at a glance.
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown';

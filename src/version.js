/* global __APP_VERSION__ */

/**
 * Build identity, injected at build time by the `define` block in vite.config.js:
 * `v<package.json version> · <git short SHA> · <commit date>`, with a "(dev)" suffix under the
 * dev server. Shown in the Settings panel and logged at boot so a deployed GitHub Pages build can
 * be told apart from a stale cached one at a glance, and so a bug report names a release.
 *
 * Not a semver string — do not parse it. The version is single-sourced in package.json; bump it
 * with `npm version <patch|minor|major>`, which tags the commit (see CHANGELOG.md).
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown';

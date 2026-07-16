// @ts-check

/**
 * Attribute coercion for `<hexlife-world>` (#25 Phase 2).
 *
 * These functions are the entire trust boundary between a stranger's HTML and the sim, and the
 * rule they encode is the element's first law: **an embed never throws into the host page.** Every
 * unparseable value falls back to a sane default and every out-of-range value clamps, so the worst a
 * typo can do is produce a boring world — not a red error in someone's blog console.
 *
 * They live in their own module (rather than beside the element) purely so they can be unit-tested:
 * `HexLifeElement.js` evaluates `class extends HTMLElement` at import time, which node has no
 * business doing. Same motive as the Phase 0 extractions in `src/core/`.
 */

/**
 * @param {string|null} raw
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number} `raw` as an int in [min,max], or `fallback` if it isn't a number at all.
 */
export function clampInt(raw, min, max, fallback) {
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/**
 * @param {string|null} raw
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number} `raw` as a float in [min,max], or `fallback` if it isn't a number at all.
 */
export function clampFloat(raw, min, max, fallback) {
    const n = parseFloat(String(raw));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/**
 * @param {string|null} raw
 * @returns {number|null} A uint32 seed, or null for "no seed" (⇒ a nondeterministic run).
 *
 * `seed="0"` is deliberately null. `EmbedSim.reset` and `WorldWorker` both branch on a *falsy* seed
 * to `Math.random`, so accepting 0 as a seed would silently promise a determinism the engine does
 * not deliver — the one lie this widget cannot afford to tell.
 */
export function readSeed(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n) >>> 0;
}

/**
 * The `palette-on` / `palette-off` custom-gradient override (mirrors the app's `customGradient` LUT
 * mode, so it feeds `generateColorLUT` unchanged).
 *
 * @param {string|null} on Comma-separated hex colors for live cells.
 * @param {string|null} off Comma-separated hex colors for dead cells.
 * @returns {{on: string[], off: string[]}|null} null unless `on` yields at least one color — that
 *   null is what leaves the `palette` attribute in charge. A one-sided override gets a dark neutral
 *   `off` gradient so it still looks deliberate rather than broken.
 */
export function readGradient(on, off) {
    const parse = (/** @type {string|null} */ s) =>
        (s || '').split(',').map(c => c.trim()).filter(Boolean);
    const onColors = parse(on);
    if (onColors.length === 0) return null;
    const offColors = parse(off);
    return { on: onColors, off: offColors.length ? offColors : ['#111111'] };
}

/**
 * Should a wheel event zoom the embed, or belong to the page it sits on?
 *
 * `wheel-zoom="ctrl"` is for embeds inside a scrollable feed: swallowing the wheel there traps a
 * reader who only meant to scroll past. Ctrl/meta+wheel still zooms — and because a trackpad pinch
 * is delivered as ctrl+wheel in Chromium and Firefox, pinch-to-zoom keeps working untouched.
 *
 * Anything other than `"ctrl"` (absent, `"free"`, a typo) means free zooming: the default is the
 * pre-existing behavior, so an unrecognized value can't silently disable an embed's zoom.
 *
 * @param {string|null} mode The `wheel-zoom` attribute.
 * @param {{ctrlKey?: boolean, metaKey?: boolean}} e The wheel event (only its modifiers are read).
 * @returns {boolean} True if the embed should zoom (and preventDefault).
 */
export function wheelZoomAllowed(mode, e) {
    if (String(mode).trim() !== 'ctrl') return true;
    return Boolean(e && (e.ctrlKey || e.metaKey));
}

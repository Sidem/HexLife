// @ts-check

/**
 * Attribute coercion for `<hexlife-ca>`, the k-state element.
 *
 * The k-state sibling of `attrs.js`, and it inherits that module's first law: **an embed never
 * throws into the host page.** Unparseable values fall back, out-of-range values clamp.
 *
 * One deliberate exception, and it is the interesting one. `rows` in block mode **must** be a
 * multiple of 3 — the three-phase triangular partition is seamless only if the sublattice residue
 * `(q − r) mod 3` survives the row wrap, and 64 (the binary element's own default) fails it. The
 * engine throws there rather than rounding, on the grounds that the grid you asked for should not
 * silently become a different grid. {@link readCaRows} therefore does not silently round either: it
 * *reports* the problem so the element can render it in its error box, which keeps both promises at
 * once — the host page sees no exception, and nobody gets a seam they did not ask for.
 *
 * Lives in its own module so it can be unit-tested: `HexCAElement.js` evaluates
 * `class extends HTMLElement` at import time, which node has no business doing. Same motive as
 * `attrs.js`.
 */

import { clampFloat, clampInt } from './attrs.js';

/** Rows must be a multiple of this in block mode, or the partition has a seam at the row wrap. */
export const BLOCK_ROW_MULTIPLE = 3;

/** State caps, mirroring `ca.js` (which mirrors `worldk.rs`). `caAttrs.test.js` pins them together. */
export const MAX_NEIGHBORHOOD_STATES = 4;
export const MAX_BLOCK_STATES = 16;

export const CA_DEFAULTS = Object.freeze({
    states: 2,
    /** Not 64. The binary element's default is invalid in block mode, and a default that is legal in
     *  one backend and fatal in the other is a trap; 66 is the nearest value legal in both. */
    rows: 66,
    backend: 'neighborhood',
    speed: 10,
    maxDpr: 1.5,
});

export const CA_ROWS_MIN = 6;
/** Lower than the app's, for the same reason `<hexlife-world>` caps at 512: an embed is a decoration. */
export const CA_ROWS_MAX = 512;

/**
 * Columns for a given row count, matching how `<hexlife-world>` derives a landscape grid — the
 * element is square-ish by default and a hex grid is wider than it is tall per cell.
 * Always even, because the column wrap has to preserve the hex parity the neighbour table depends on.
 * @param {number} rows
 * @returns {number}
 */
export function caColumnsForRows(rows) {
    // sqrt(3)/1.5 is the cell aspect ratio (height/width spacing), so this makes the grid roughly
    // square on screen rather than roughly square in cell counts.
    const raw = Math.round((rows * Math.sqrt(3)) / 1.5);
    return Math.max(2, raw + (raw % 2));
}

/**
 * @param {string|null} raw The `backend` attribute.
 * @returns {'neighborhood'|'block'} Anything unrecognized falls back to the default, so a typo
 *   cannot silently switch a world onto the other engine's semantics.
 */
export function readCaBackend(raw) {
    const value = String(raw ?? '').trim().toLowerCase();
    return value === 'block' ? 'block' : 'neighborhood';
}

/**
 * @param {string|null} raw The `states` attribute.
 * @param {'neighborhood'|'block'} backend
 * @returns {number} `k`, clamped into the backend's range.
 */
export function readCaStates(raw, backend) {
    const max = backend === 'block' ? MAX_BLOCK_STATES : MAX_NEIGHBORHOOD_STATES;
    return clampInt(raw, 2, max, Math.min(CA_DEFAULTS.states, max));
}

/**
 * Rows, plus — in block mode — whether the value is one the partition can actually use.
 *
 * @param {string|null} raw The `rows` attribute.
 * @param {'neighborhood'|'block'} backend
 * @returns {{rows: number, problem: {message: string, detail: string}|null}} `problem` is non-null
 *   only when block mode was asked for with a row count that is not a multiple of 3. It names the
 *   two nearest legal counts, because "use 63 or 66" is the whole of what the author needs to know.
 */
export function readCaRows(raw, backend) {
    const rows = clampInt(raw, CA_ROWS_MIN, CA_ROWS_MAX, CA_DEFAULTS.rows);
    if (backend !== 'block' || rows % BLOCK_ROW_MULTIPLE === 0) return { rows, problem: null };
    const below = rows - (rows % BLOCK_ROW_MULTIPLE);
    const above = below + BLOCK_ROW_MULTIPLE;
    return {
        rows,
        problem: {
            message: 'Invalid “rows” for block mode.',
            detail: `The 3-phase partition needs a multiple of 3, so it has no seam at the row wrap. `
                + `${rows} is not one — try ${below} or ${above}.`,
        },
    };
}

/** @param {string|null} raw @returns {number} Ticks/second. */
export function readCaSpeed(raw) {
    return clampFloat(raw, 0, 1000, CA_DEFAULTS.speed);
}

/** @param {string|null} raw @returns {number} devicePixelRatio cap. */
export function readCaMaxDpr(raw) {
    return clampFloat(raw, 1, 4, CA_DEFAULTS.maxDpr);
}

/**
 * Parse one `#rgb` / `#rrggbb` colour.
 * @param {string} raw
 * @returns {[number, number, number]|null}
 */
export function parseHexColor(raw) {
    const value = String(raw ?? '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(value)) {
        return [
            parseInt(value[0] + value[0], 16),
            parseInt(value[1] + value[1], 16),
            parseInt(value[2] + value[2], 16),
        ];
    }
    if (/^[0-9a-fA-F]{6}$/.test(value)) {
        return [
            parseInt(value.slice(0, 2), 16),
            parseInt(value.slice(2, 4), 16),
            parseInt(value.slice(4, 6), 16),
        ];
    }
    return null;
}

/**
 * The built-in `k`-entry palette: state 0 is the background the app already uses, and the rest are
 * spread evenly around the hue circle.
 *
 * Evenly spaced rather than a designed ramp because `k` is not known until runtime and a k-state
 * world has no *ordering* semantics to encode — state 3 is not "more" than state 1. Maximal hue
 * separation is the only thing that is right for every model, and a host with real semantics (the
 * coffee demo's air/water/ground) should pass its own colours.
 *
 * @param {number} states
 * @returns {Array<[number, number, number]>}
 */
export function defaultStatePalette(states) {
    const k = Math.max(1, Math.floor(states) || 1);
    /** @type {Array<[number, number, number]>} */
    const out = [[26, 26, 26]];   // Config.BACKGROUND_COLOR, so state 0 reads as empty space.
    for (let i = 1; i < k; i++) {
        // Skip the golden-angle trick: with k ≤ 16 known up front, an even sweep is more separated.
        const hue = ((i - 1) / Math.max(1, k - 1)) * 360;
        out.push(hslToRgb(hue, 0.62, 0.58));
    }
    return out.slice(0, k);
}

/**
 * @param {number} h Degrees.
 * @param {number} s 0–1.
 * @param {number} l 0–1.
 * @returns {[number, number, number]}
 */
function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l - c / 2;
    /** @type {[number, number, number]} */
    let rgb = [0, 0, 0];
    if (hp < 1) rgb = [c, x, 0];
    else if (hp < 2) rgb = [x, c, 0];
    else if (hp < 3) rgb = [0, c, x];
    else if (hp < 4) rgb = [0, x, c];
    else if (hp < 5) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return [
        Math.round((rgb[0] + m) * 255),
        Math.round((rgb[1] + m) * 255),
        Math.round((rgb[2] + m) * 255),
    ];
}

/**
 * The `palette` attribute: a comma-separated list of one colour per state.
 *
 * Short lists are padded from the built-in palette and long ones truncated, rather than rejected —
 * an author tweaking two of four colours should not have to restate the other two, and a stale
 * colour left over from a `states` change should not blank the world.
 *
 * @param {string|null} raw
 * @param {number} states
 * @returns {Array<[number, number, number]>} Always exactly `states` entries.
 */
export function readCaPalette(raw, states) {
    const fallback = defaultStatePalette(states);
    const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return fallback;
    return fallback.map((standIn, index) => {
        if (index >= parts.length) return standIn;
        return parseHexColor(parts[index]) || standIn;
    });
}

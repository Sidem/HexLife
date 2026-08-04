// @ts-check

/**
 * Attribute coercion for `<hexlife-grid>`.
 *
 * Same contract and the same motive as `attrs.js`: these are the trust boundary between a stranger's
 * HTML and 256 wasm worlds, and **an embed never throws into the host page** — an unparseable entry
 * is dropped, an unparseable layout falls back to the derived one. They live here rather than beside
 * the element purely so they can be unit-tested: `HexLifeGridElement.js` evaluates
 * `class extends HTMLElement` at import time, which node has no business doing.
 */

import { codeToHex } from '../core/rulesetCode.js';

/**
 * Split a `rulesets` attribute into individual codes.
 *
 * Commas, semicolons and whitespace all separate, so a 256-entry list can be written across as many
 * lines as it takes to stay readable in the markup rather than as one unbroken kilobyte.
 *
 * @param {string|null|undefined} raw
 * @returns {string[]}
 */
export function splitRulesetList(raw) {
    return String(raw || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Resolve one entry of a `rulesets` list to the canonical 32-char hex.
 *
 * Both spellings are accepted on purpose. The hex is the identity everywhere else in HexLife, but a
 * *constraint class* is naturally written in the tagged short codes — the totalistic class is
 * exactly `T00`–`TFF`, which is both shorter than 256 hex strings and self-documenting about what
 * the grid is showing.
 *
 * @param {string} code
 * @returns {string|null} Uppercase 32-char hex, or null if the code is not well-formed.
 */
export function resolveRulesetCode(code) {
    return codeToHex(String(code || '')) || null;
}

/**
 * Choose a tile layout for `count` worlds.
 *
 * Squarest-first: the grid is a *map*, and a map reads best when neither axis dominates. An exact
 * square wins outright (256 → 16×16); otherwise the widest divisor at or below the square root, in
 * landscape orientation because screens are. A prime count has no honest grid, so it gets one row.
 *
 * @param {number} count
 * @returns {{cols: number, rows: number}}
 */
export function autoLayout(count) {
    const n = Math.max(1, Math.floor(count) || 1);
    const root = Math.round(Math.sqrt(n));
    if (root * root === n) return { cols: root, rows: root };
    for (let cols = Math.floor(Math.sqrt(n)); cols >= 1; cols--) {
        if (n % cols === 0) {
            const rows = n / cols;
            return cols >= rows ? { cols, rows } : { cols: rows, rows: cols };
        }
    }
    return { cols: n, rows: 1 };
}

/**
 * Parse a `layout="COLSxROWS"` attribute, falling back to {@link autoLayout}.
 *
 * Note it is *not* checked against `count`: a layout with more tiles than worlds simply leaves the
 * tail empty, and one with fewer draws the first `cols × rows`. Both are more useful than an error,
 * and neither can crash — `drawGrid` iterates the shorter of the two.
 *
 * @param {string|null|undefined} raw
 * @param {number} count
 * @returns {{cols: number, rows: number}}
 */
export function readLayout(raw, count) {
    const m = /^(\d+)\s*[x×*]\s*(\d+)$/.exec(String(raw || '').trim());
    if (!m) return autoLayout(count);
    const cols = parseInt(m[1], 10);
    const rows = parseInt(m[2], 10);
    if (!(cols > 0) || !(rows > 0)) return autoLayout(count);
    return { cols, rows };
}

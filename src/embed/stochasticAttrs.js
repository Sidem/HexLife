// @ts-check

/**
 * Attribute coercion for `<hexlife-stochastic>`.
 *
 * The stochastic sibling of `caAttrs.js`, and it inherits the same first law: **an embed never
 * throws into the host page.** Unparseable values fall back, out-of-range values clamp.
 *
 * Two things differ from the k-state module, both because of what the stochastic engine is:
 *
 * - **No `rows` problem case.** `<hexlife-ca>` has to refuse `rows % 3 != 0` in block mode because
 *   the triangular partition would seam at the row wrap. Neither stochastic backend partitions the
 *   grid, so every row count in range is legal and this module only ever clamps.
 * - **A backend-aware default palette.** The lattice gas's five visible states *mean* something
 *   fixed — vacuum, amber, cyan, both, wall — so spreading them evenly around the hue circle, which
 *   is the right answer for an arbitrary `k`, is the wrong answer here. The neighborhood backend has
 *   no such semantics and keeps the k-state ramp.
 *
 * Lives in its own module for the same reason `caAttrs.js` does: `HexStochasticElement.js` evaluates
 * `class extends HTMLElement` at import time, which node has no business doing, and these are the
 * parts worth unit-testing.
 */

import { clampFloat, clampInt } from './attrs.js';
import { caColumnsForRows, defaultStatePalette, parseHexColor } from './caAttrs.js';

/** Visible-state count of the lattice-gas projection: vacuum · amber · cyan · mixed · wall. */
export const GAS_VISIBLE_STATES = 5;

export const STOCHASTIC_DEFAULTS = Object.freeze({
    /** Matches `<hexlife-ca>`, so an author moving between the two elements gets the same size. */
    rows: 66,
    speed: 10,
    maxDpr: 1.5,
    /**
     * A **fixed** default rather than entropy, because §7 of the plan forbids hidden entropy: two
     * loads of the same page must be the same run. A host that wants a different one assigns
     * `element.seed`, which is script — and a stochastic element needs script anyway, since a rule
     * can only arrive through `setRule()` or a `code`.
     */
    seed: 12345n,
});

export const STOCHASTIC_ROWS_MIN = 6;
/** Same cap as `<hexlife-ca>`, for the same reason: an embed is a decoration, not the Explorer. */
export const STOCHASTIC_ROWS_MAX = 512;

/**
 * Columns for a given row count.
 *
 * Shared with the k-state element rather than re-derived, because the property that matters here is
 * one that module already guarantees: the result is **even**. `WorldStochastic` refuses an odd
 * column count outright — the odd-q torus cannot close its parity without it — so this is a
 * correctness constraint, not a cosmetic one.
 *
 * @param {number} rows
 * @returns {number}
 */
export function stochasticColumnsForRows(rows) {
    return caColumnsForRows(rows);
}

/** @param {string|null} raw @returns {number} */
export function readStochasticRows(raw) {
    return clampInt(raw, STOCHASTIC_ROWS_MIN, STOCHASTIC_ROWS_MAX, STOCHASTIC_DEFAULTS.rows);
}

/** @param {string|null} raw @returns {number} Ticks/second. */
export function readStochasticSpeed(raw) {
    return clampFloat(raw, 0, 1000, STOCHASTIC_DEFAULTS.speed);
}

/**
 * The lattice gas's five visible states, in projection order.
 *
 * Amber and cyan are the two conserved species; `mixed` is a site holding both, which is a genuinely
 * different reading and gets its own colour rather than one of theirs; `wall` is a lattice site the
 * tick reflects off, so it reads as structure rather than as matter.
 * @type {Array<[number, number, number]>}
 */
const GAS_PALETTE = [
    [26, 26, 26],      // vacuum — Config.BACKGROUND_COLOR, so empty space reads as empty space
    [224, 163, 65],    // amber
    [53, 198, 214],    // cyan
    [242, 242, 242],   // mixed
    [107, 114, 128],   // wall
];

/**
 * @param {number} states
 * @param {'neighborhood'|'lattice-gas'} backend
 * @returns {Array<[number, number, number]>} Exactly `max(1, states)` entries.
 */
export function defaultStochasticPalette(states, backend) {
    const k = Math.max(1, Math.floor(states) || 1);
    if (backend !== 'lattice-gas') return defaultStatePalette(k);
    const out = GAS_PALETTE.slice(0, k);
    // Only reachable if the gas ever grows a sixth visible state; pad rather than hand the renderer
    // a short palette, which it would reject and leave the world undrawn.
    while (out.length < k) out.push([26, 26, 26]);
    return /** @type {Array<[number, number, number]>} */ (out);
}

/**
 * The `palette` attribute: a comma-separated list of one colour per visible state.
 *
 * Short lists are padded from the backend's default and long ones truncated, exactly as
 * `readCaPalette` does — an author recolouring the two gas species should not have to restate the
 * wall colour.
 *
 * @param {string|null} raw
 * @param {number} states
 * @param {'neighborhood'|'lattice-gas'} backend
 * @returns {Array<[number, number, number]>}
 */
export function readStochasticPalette(raw, states, backend) {
    const fallback = defaultStochasticPalette(states, backend);
    const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return fallback;
    return fallback.map((standIn, index) => {
        if (index >= parts.length) return standIn;
        return parseHexColor(parts[index]) || standIn;
    });
}

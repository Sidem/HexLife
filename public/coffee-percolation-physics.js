/**
 * Pure geometry and scheduling helpers for `coffee-percolation.html`.
 *
 * Kept DOM- and Wasm-free so the hex-grid invariants can be unit-tested. The simulation page is
 * copied verbatim from `public/`, so this sibling module is copied beside it and stays importable in
 * both Vite development and the GitHub Pages build.
 */

/** The pulse recipe's deliberately quiet pre-infusion interval. */
export const PULSE_BLOOM_TICKS = 40;
export const PULSE_REST_TICKS = 60;

/**
 * Return `count` distinct, approximately even positions in `[0, span)`, rotated by `phase`.
 * `count <= span` is load-bearing: an inlet cell can accept at most one liquid unit per tick.
 */
function evenlySpaced(span, count, phase) {
    const n = Math.max(0, Math.min(span, Math.floor(count)));
    if (n === 0) return [];
    const shift = ((Math.floor(phase) % span) + span) % span;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = (Math.floor(((i + 0.5) * span) / n) + shift) % span;
    return out;
}

/**
 * Which top-row columns receive an injection attempt this tick.
 *
 * This is a one-dimensional boundary schedule over an odd-q hex grid, not a square-grid neighbour
 * operation: every returned index is a column in the same physical top row. Distinctness matters
 * because returning a column twice cannot pour twice into the same cell; the second attempt merely
 * sees the water written by the first and silently loses apparent flow.
 *
 * @param {{columns: number, flow: number, mode: string, tick: number, remaining: number}} options
 * @returns {number[]}
 */
export function injectionColumns({ columns, flow, mode, tick, remaining }) {
    const cols = Math.max(1, Math.floor(columns));
    const requested = Math.max(0, Math.floor(flow));
    const left = Math.max(0, Math.floor(remaining));

    if (mode === 'dump') return evenlySpaced(cols, Math.min(left, cols), tick);

    let rate = Math.min(requested, left);
    if (mode === 'pulse') {
        if (tick < PULSE_BLOOM_TICKS) rate = Math.max(1, Math.round(rate * 0.35));
        else if (tick < PULSE_BLOOM_TICKS + PULSE_REST_TICKS) rate = 0;
    }

    if (mode === 'centre') {
        const halfWidth = Math.max(1, Math.floor(cols * 0.04));
        const width = halfWidth * 2;
        const start = Math.floor(cols / 2) - halfWidth;
        return evenlySpaced(width, Math.min(rate, width), tick).map((column) => start + column);
    }

    // Preserve the shower's original irrational phase walk: it keeps repeated pours from locking
    // to a small set of columns on the hex lattice. The UI caps flow below every offered width, so
    // these positions are distinct without another arbitration pass.
    const out = [];
    for (let i = 0; i < Math.min(rate, cols); i++) {
        out.push(Math.floor(((i + (tick * 0.37)) % rate) * (cols / Math.max(1, rate))) % cols);
    }
    return out;
}

/**
 * A left-to-right reflection of a toroidal, flat-top odd-q hex grid.
 *
 * In axial coordinates `q = col`, `r = row - floor(col / 2)`, reflection about q=0 is
 * `(q, r) -> (-q, q+r)`. With an even column count this is an involution that preserves every row,
 * swaps SE with SW and NE with NW, and leaves N/S alone.
 *
 * @param {number} rows
 * @param {number} columns Must be even so the toroidal wrap preserves odd-q parity.
 * @returns {Uint32Array}
 */
export function buildHexMirror(rows, columns) {
    if (!Number.isInteger(rows) || rows < 1) throw new RangeError('rows must be a positive integer.');
    if (!Number.isInteger(columns) || columns < 2 || columns % 2 !== 0) {
        throw new RangeError('columns must be a positive even integer.');
    }

    const map = new Uint32Array(rows * columns);
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
            const axialR = row - Math.floor(col / 2);
            const mirroredQ = -col;
            let mirroredRow = axialR + col + Math.floor(mirroredQ / 2);
            mirroredRow = ((mirroredRow % rows) + rows) % rows;
            const mirroredCol = ((mirroredQ % columns) + columns) % columns;
            map[row * columns + col] = mirroredRow * columns + mirroredCol;
        }
    }
    return map;
}

/**
 * Progress can pause while the last parcel crosses already-wet or empty cells. Free fall receives
 * its vertical bond once per three partition phases; six ticks additionally cover both alternating
 * triangle handednesses. One full six-tick period per row is therefore a conservative whole-grid
 * transit allowance before calling a brew finished.
 */
export function quietTickLimit(rows) {
    return Math.max(240, Math.max(1, Math.floor(rows)) * 6);
}

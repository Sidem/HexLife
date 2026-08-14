/**
 * Physical HCP site coordinates. DOM-free and vitest-safe.
 *
 * Matches the 2D odd-q pixel convention (`gridToPixelCoords`) in the plane, then stacks layers
 * at the ideal HCP spacing `R√2` with odd layers translated to the hollow of the even-layer
 * up-triangle that owns `(q, r)`.
 *
 * In-plane neighbour identity is `src/core/neighbor-dirs.json`. Interlayer offsets are
 * `src/core/hcp-dirs.json`. This module does not re-derive those numbers.
 */

import neighborDirs from '../core/neighbor-dirs.json';
import hcpDirs from '../core/hcp-dirs.json';

export const SQRT3 = Math.sqrt(3);
export const SQRT2 = Math.sqrt(2);

/** In-plane neighbour distance at circumradius `R`. */
export function latticeSpacing(hexSize) {
    return SQRT3 * hexSize;
}

/** Ideal HCP layer spacing: `a · √(2/3) = R√2`. */
export function layerSpacing(hexSize) {
    return SQRT2 * hexSize;
}

/**
 * World-space centre of the site at `(col, row, layer)`.
 * @param {number} col
 * @param {number} row
 * @param {number} layer
 * @param {number} [hexSize=1]
 * @returns {{x: number, y: number, z: number}}
 */
export function sitePosition(col, row, layer, hexSize = 1) {
    const r = hexSize;
    let x = col * 1.5 * r;
    let y = row * SQRT3 * r;
    if ((col & 1) !== 0) y += 0.5 * SQRT3 * r;
    if ((layer & 1) !== 0) {
        x += 0.5 * r;
        y += 0.5 * SQRT3 * r;
    }
    return {x, y, z: layer * SQRT2 * r};
}

/**
 * Layer-major linear index.
 * @param {number} layer
 * @param {number} row
 * @param {number} col
 * @param {number} rows
 * @param {number} cols
 */
export function indexFromCoords(layer, row, col, rows, cols) {
    return ((layer * rows) + row) * cols + col;
}

/**
 * Inverse of {@link indexFromCoords}.
 * @param {number} index
 * @param {number} rows
 * @param {number} cols
 * @returns {{layer: number, row: number, col: number}}
 */
export function coordsFromIndex(index, rows, cols) {
    const layerSize = rows * cols;
    const layer = Math.floor(index / layerSize);
    const rem = index - layer * layerSize;
    const row = Math.floor(rem / cols);
    return {layer, row, col: rem - row * cols};
}

/** In-plane offset table for a column. Parity is by COLUMN despite the JSON key names. */
export function inPlaneOffsets(col) {
    return (col & 1) !== 0 ? neighborDirs.odd_r : neighborDirs.even_r;
}

/**
 * Interlayer `(dc, dr)` triples. `toward` is `'down'` (+layer) or `'up'` (−layer).
 * HCP: up offsets equal down offsets.
 * @param {number} layer
 * @param {number} col
 * @param {'down'|'up'} toward
 * @returns {number[][]}
 */
export function interlayerOffsets(layer, col, toward) {
    const layerKey = (layer & 1) === 0 ? 'even_layer' : 'odd_layer';
    const colKey = (col & 1) === 0 ? 'even_col' : 'odd_col';
    return hcpDirs[`${layerKey}_${colKey}_${toward}`];
}

export function inPlaneSource() {
    return hcpDirs.in_plane_source;
}

export function slotOrder() {
    return hcpDirs.slot_order;
}

/**
 * Distance between two site positions.
 * @param {{x: number, y: number, z: number}} a
 * @param {{x: number, y: number, z: number}} b
 */
export function siteDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.hypot(dx, dy, dz);
}

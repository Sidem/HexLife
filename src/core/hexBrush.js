// @ts-check

/**
 * Pure brush helpers for embeds / world codes — no config.js.
 * Mirrors the app's neighborhood BFS + cube-line interpolation used by DrawStrategy.
 *
 * Neighbor offsets are inlined (must match `neighbor-dirs.json`) so this module stays free of
 * JSON import attributes — Devvit's Node unit tests load WorldCodec unbundled.
 */

/** Matches Config.DEFAULT_NEIGHBORHOOD_SIZE — used when a legacy world code omits brush size. */
export const DEFAULT_BRUSH_SIZE = 2;
/** Matches Config.MAX_NEIGHBORHOOD_SIZE. */
export const MAX_BRUSH_SIZE = 40;

// Keep in lockstep with src/core/neighbor-dirs.json (odd_r / even_r).
const ODD_R = [[-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1], [0, 1]];
const EVEN_R = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [0, 1]];

/**
 * @param {unknown} n
 * @returns {number} Clamped integer brush size in [0, MAX_BRUSH_SIZE].
 */
export function clampBrushSize(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return DEFAULT_BRUSH_SIZE;
    return Math.max(0, Math.min(MAX_BRUSH_SIZE, v));
}

/**
 * Cube-line hex interpolation (same geometry as utils.getHexLine). Pure.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {Array<{col: number, row: number}>}
 */
export function getHexLine(x1, y1, x2, y2) {
    const toCube = (r, q) => {
        const x = q - (r - (r & 1)) / 2;
        const z = r;
        return { x, z, y: -x - z };
    };
    const fromCube = (x, _y, z) => ({ col: x + (z - (z & 1)) / 2, row: z });

    const p1 = toCube(y1, x1);
    const p2 = toCube(y2, x2);
    const dist = Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y), Math.abs(p1.z - p2.z));
    if (dist === 0) return [{ col: x1, row: y1 }];

    const points = [];
    for (let i = 0; i <= dist; i++) {
        const t = i / dist;
        const cubeX = p1.x + (p2.x - p1.x) * t;
        const cubeY = p1.y + (p2.y - p1.y) * t;
        const cubeZ = p1.z + (p2.z - p1.z) * t;

        let rx = Math.round(cubeX);
        let ry = Math.round(cubeY);
        let rz = Math.round(cubeZ);
        const xDiff = Math.abs(rx - cubeX);
        const yDiff = Math.abs(ry - cubeY);
        const zDiff = Math.abs(rz - cubeZ);

        if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
        else if (yDiff > zDiff) ry = -rx - rz;
        else rz = -rx - ry;

        points.push(fromCube(rx, ry, rz));
    }
    return points;
}

/**
 * Collect cell indices within brush radius of (startCol, startRow). Toroidal wrap.
 * @param {number} startCol
 * @param {number} startRow
 * @param {number} maxDistance brush size (0 = single cell)
 * @param {number} cols
 * @param {number} rows
 * @param {Set<number>} outSet cleared and filled
 */
export function collectBrushCells(startCol, startRow, maxDistance, cols, rows, outSet) {
    outSet.clear();
    if (!Number.isInteger(startCol) || !Number.isInteger(startRow)) return;
    if (startCol < 0 || startRow < 0 || startCol >= cols || startRow >= rows) return;

    const numCells = cols * rows;
    const queue = [];
    const visited = new Map();
    let head = 0;

    const startIndex = startRow * cols + startCol;
    queue.push([startCol, startRow, 0]);
    visited.set(startIndex, 0);
    outSet.add(startIndex);

    while (head < queue.length) {
        const [cc, cr, cd] = queue[head++];
        if (cd >= maxDistance) continue;

        const dirs = (cc % 2 !== 0) ? ODD_R : EVEN_R;
        for (const [dx, dy] of dirs) {
            const nc = cc + dx;
            const nr = cr + dy;
            const wc = ((nc % cols) + cols) % cols;
            const wr = ((nr % rows) + rows) % rows;
            const neighborIndex = wr * cols + wc;
            if (neighborIndex < 0 || neighborIndex >= numCells) continue;
            if (visited.has(neighborIndex)) continue;
            visited.set(neighborIndex, cd + 1);
            outSet.add(neighborIndex);
            queue.push([wc, wr, cd + 1]);
        }
    }
}

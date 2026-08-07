// @ts-check

/**
 * Deterministic **sparse structured** initial states: empty space with small structures scattered
 * into it.
 *
 * The counterpart to {@link ./initialStateStrategies/DensityStrategy.js DensityStrategy}, and the
 * opposite intent. A density fill answers "what does this rule do to noise?" — every cell is already
 * decided, and anything anyone adds later is a perturbation the rule erases within a few
 * generations. A sparse structured state answers "what does this rule do to *things*?" — a placed
 * cluster in a stable vacuum is an object, so gliders travel, oscillators persist, and a later edit
 * has a visible causal wake instead of dissolving into the soup.
 *
 * That only means anything for a **vacuum-stable** rule (`isVacuumStable` in `rulesetHex.js`): if
 * the empty neighbourhood fires, every dead cell ignites on tick one and the world saturates no
 * matter how it started. This module does not check the rule — it does not take one — but a host
 * pairing it with an unstable rule has built a dense world with extra steps.
 *
 * **The live-cell count is exact**, not approximate: `round(occupancy × rows × columns)` cells are
 * live, always. Structures are only ever chosen from those that still fit in the remaining budget,
 * and overlap can only ever light fewer cells than a structure's size, so the count is approached
 * from below and finished exactly. A host that records occupancy as admission evidence can state it
 * as a fact rather than a target.
 *
 * Dependency-light on purpose (`rng.js` only), so `src/embed/` can expose it to Node hosts without
 * dragging in `config.js`.
 */

import { mulberry32 } from './rng.js';

/**
 * The hex neighbour-offset tables, as `[deltaColumn, deltaRow]` — a third copy of the canonical
 * tables in `src/core/neighbor-dirs.json`, alongside the ones in `config.js` and the Wasm engine.
 *
 * Copied rather than imported because that JSON reaches this module only through `config.js`, which
 * imports it extensionless — a Vite-ism plain Node rejects — and Node hosts import this file through
 * `@hexlife/embed/sim`. `tests/sparseStructures.test.js` compares these against the JSON directly,
 * so drift fails a test rather than silently placing structures with the wrong geometry.
 *
 * Note that the parity that selects a table is the **column**, not the row, despite the canonical
 * `odd_r`/`even_r` names. That is what `World::new` does, and matching it is the whole point.
 */
const NEIGHBOR_DIRS_ODD_COLUMN = [[-1, 1], [-1, 0], [0, -1], [1, 0], [1, 1], [0, 1]];
const NEIGHBOR_DIRS_EVEN_COLUMN = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [0, 1]];

/**
 * The placeable structures, as **walks** from an origin cell: each path is a sequence of neighbour
 * direction indices, and the cell it ends on is lit.
 *
 * Walks rather than `(row, column)` offsets because a hex offset grid changes its neighbour table
 * with column parity — a fixed offset list would be one shape on even columns and a different,
 * usually disconnected, shape on odd ones. Every structure here is connected on both parities and at
 * every position, seam included, because it is defined by adjacency rather than by arithmetic.
 *
 * Kept small and generic on purpose. These are not curated spaceships for a particular rule — the
 * rule is not known here. They are the smallest shapes that give a rule something to act on: a lone
 * cell, an edge, a line, a bend, a fan, and a ring around a hole.
 *
 * **Sorted by ascending size**, which {@link createSparseStructureState} relies on to pick from the
 * structures that still fit without allocating a filtered list per placement.
 */
export const SPARSE_STRUCTURES = Object.freeze([
    Object.freeze({ name: 'dot', paths: Object.freeze([[]]) }),
    Object.freeze({ name: 'pair', paths: Object.freeze([[], [0]]) }),
    Object.freeze({ name: 'line', paths: Object.freeze([[], [0], [0, 0]]) }),
    Object.freeze({ name: 'bend', paths: Object.freeze([[], [0], [0, 5]]) }),
    Object.freeze({ name: 'fan', paths: Object.freeze([[], [0], [2]]) }),
    Object.freeze({ name: 'ring', paths: Object.freeze([[0], [1], [2], [3], [4], [5]]) }),
]);

/** The largest structure, used to size the placement-attempt budget. */
const LARGEST_STRUCTURE = SPARSE_STRUCTURES.reduce((largest, structure) => Math.max(largest, structure.paths.length), 0);

/**
 * How many leading structures fit within `remaining` cells. Exact because the list is size-sorted;
 * at least one (the single-cell `dot`) whenever `remaining >= 1`.
 * @param {number} remaining
 * @returns {number}
 */
function eligibleStructureCount(remaining) {
    let count = 0;
    while (count < SPARSE_STRUCTURES.length && SPARSE_STRUCTURES[count].paths.length <= remaining) count++;
    return count;
}

/**
 * Walk `path` from `(originColumn, originRow)` and return the row-major index it lands on, wrapping
 * on both axes.
 * @param {readonly number[]} path
 * @param {number} originColumn
 * @param {number} originRow
 * @param {number} rows
 * @param {number} columns
 * @returns {number}
 */
function walkToIndex(path, originColumn, originRow, rows, columns) {
    let column = originColumn;
    let row = originRow;
    for (const direction of path) {
        const dirs = column % 2 !== 0 ? NEIGHBOR_DIRS_ODD_COLUMN : NEIGHBOR_DIRS_EVEN_COLUMN;
        const [deltaColumn, deltaRow] = dirs[direction];
        column = (column + deltaColumn + columns) % columns;
        row = (row + deltaRow + rows) % rows;
    }
    return row * columns + column;
}

/**
 * Create a deterministic sparse structured state: an empty grid with seeded structures placed in it.
 *
 * Reproducible from `(rows, columns, seed, occupancy)` alone on every machine and runtime — the same
 * contract `createDensityState` carries, and the reason a world's genesis can be re-derived from its
 * manifest rather than trusted from whoever uploaded it first.
 *
 * `occupancy` is a fraction of the whole grid. The useful range for an inhabitable world is roughly
 * `1e-3` to `1e-2`; the function accepts anything in `[0, 1]`, but past a few percent the structures
 * merge and the result is a density fill with extra steps.
 *
 * @param {{rows: number, columns: number, seed: number, occupancy?: number}} options
 * @returns {Uint8Array} row-major cells, with exactly `round(occupancy * rows * columns)` set to 1.
 */
export function createSparseStructureState({ rows, columns, seed, occupancy = 0.002 }) {
    if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows <= 0 || columns <= 0
        || !Number.isSafeInteger(rows * columns)) {
        throw new RangeError('createSparseStructureState: rows and columns must contain a safe positive number of cells.');
    }
    if (!Number.isSafeInteger(seed)) {
        throw new RangeError('createSparseStructureState: seed must be a safe integer.');
    }
    if (!Number.isFinite(occupancy) || occupancy < 0 || occupancy > 1) {
        throw new RangeError('createSparseStructureState: occupancy must be between 0 and 1.');
    }

    const numCells = rows * columns;
    const cells = new Uint8Array(numCells);
    const target = Math.round(occupancy * numCells);
    if (target === 0) return cells;

    const rng = mulberry32(seed);
    let live = 0;

    // Every attempt draws exactly three values — structure, column, row — so the sequence a seed
    // produces does not depend on how many cells an earlier placement happened to light.
    const attemptBudget = target * LARGEST_STRUCTURE + 64;
    for (let attempt = 0; live < target && attempt < attemptBudget; attempt++) {
        const choices = eligibleStructureCount(target - live);
        const structure = SPARSE_STRUCTURES[Math.min(choices - 1, Math.floor(rng() * choices))];
        const originColumn = Math.min(columns - 1, Math.floor(rng() * columns));
        const originRow = Math.min(rows - 1, Math.floor(rng() * rows));
        for (const path of structure.paths) {
            const index = walkToIndex(path, originColumn, originRow, rows, columns);
            if (cells[index] === 0) {
                cells[index] = 1;
                live++;
            }
        }
    }

    // Overlapping placements light fewer cells than they cost in budget, so on a crowded grid the
    // loop above can run out of attempts short of the target. Finish deterministically by scanning
    // from a seeded offset: `target <= numCells`, so one pass always suffices and the count is exact.
    if (live < target) {
        let index = Math.min(numCells - 1, Math.floor(rng() * numCells));
        for (let scanned = 0; scanned < numCells && live < target; scanned++) {
            if (cells[index] === 0) {
                cells[index] = 1;
                live++;
            }
            index = index + 1 === numCells ? 0 : index + 1;
        }
    }

    return cells;
}

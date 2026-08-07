/**
 * DOM-free headless HexLife entry point for Node.js, browser workers, and other hosts.
 * Evolution is delegated to the same `EmbedSim` Wasm runtime used by `<hexlife-world>`.
 */

import { EmbedSim, initEmbedWasm } from './EmbedSim.js';
import { mulberry32 } from '../core/rng.js';
import { DensityStrategy } from '../core/initialStateStrategies/DensityStrategy.js';
import { createSparseStructureState } from '../core/sparseStructures.js';

const densityStrategy = new DensityStrategy();

/**
 * @param {ConstructorParameters<typeof EmbedSim>[0]} options
 * @returns {Promise<EmbedSim>}
 */
export async function createSimulation(options) {
    await initEmbedWasm();
    return new EmbedSim(options);
}

/**
 * Create the canonical seeded density state without initializing Wasm.
 *
 * Unlike the custom element's `seed` attribute, every finite integer is deterministic here,
 * including zero. Hosts that derive seeds from hashes must not acquire a one-in-2^32 random branch.
 * Density 0 and 1 retain HexLife's canonical opposite-state center cell.
 *
 * @param {{rows: number, columns: number, seed: number, density?: number}} options
 * @returns {Uint8Array}
 */
export function createDensityState({ rows, columns, seed, density = 0.5 }) {
    if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows <= 0 || columns <= 0
        || !Number.isSafeInteger(rows * columns)) {
        throw new RangeError('createDensityState: rows and columns must contain a safe positive number of cells.');
    }
    if (!Number.isSafeInteger(seed)) {
        throw new RangeError('createDensityState: seed must be a safe integer.');
    }
    if (!Number.isFinite(density) || density < 0 || density > 1) {
        throw new RangeError('createDensityState: density must be between 0 and 1.');
    }
    const cells = new Uint8Array(rows * columns);
    densityStrategy.generate(cells, { density }, mulberry32(seed), {
        GRID_ROWS: rows,
        GRID_COLS: columns,
        NUM_CELLS: cells.length,
    });
    return cells;
}

/**
 * Create the canonical seeded **sparse structured** state without initializing Wasm: empty space
 * with small connected structures scattered into it.
 *
 * The initializer for worlds meant to be inhabited rather than observed. `createDensityState` fills
 * every cell, so a later edit is a perturbation the rule erases; this leaves a vacuum, so a placed
 * cluster is an object with a causal wake. It is only meaningful for a vacuum-stable ruleset — see
 * `isVacuumStable` in `@hexlife/embed/api` — because an unstable rule ignites empty space on tick one.
 *
 * Exactly `round(occupancy * rows * columns)` cells are live. Deterministic for every safe-integer
 * seed, including zero, and identical across Node and browser workers like every other seeded path.
 *
 * @param {{rows: number, columns: number, seed: number, occupancy?: number}} options
 * @returns {Uint8Array}
 */
export function createSparseState(options) {
    return createSparseStructureState(options);
}

/**
 * Pack row-major binary cells LSB-first within each byte.
 * @param {ArrayLike<number>} cells
 * @returns {Uint8Array}
 */
export function packCells(cells) {
    const packed = new Uint8Array(Math.ceil(cells.length / 8));
    for (let index = 0; index < cells.length; index++) {
        const value = cells[index];
        if (value !== 0 && value !== 1) {
            throw new TypeError(`packCells: cell ${index} must be 0 or 1, received ${value}.`);
        }
        if (value === 1) packed[index >> 3] |= 1 << (index & 7);
    }
    return packed;
}

/**
 * Unpack an LSB-first cell bitset into per-cell bytes.
 * @param {Uint8Array} packed
 * @param {number} cellCount
 * @returns {Uint8Array}
 */
export function unpackCells(packed, cellCount) {
    if (!Number.isSafeInteger(cellCount) || cellCount < 0) {
        throw new RangeError('unpackCells: cellCount must be a non-negative safe integer.');
    }
    const expected = Math.ceil(cellCount / 8);
    if (packed.length !== expected) {
        throw new RangeError(`unpackCells: received ${packed.length} bytes, expected ${expected}.`);
    }
    if (cellCount % 8 !== 0 && packed.length > 0) {
        const usedMask = (1 << (cellCount % 8)) - 1;
        if ((packed[packed.length - 1] & ~usedMask) !== 0) {
            throw new RangeError('unpackCells: non-zero padding bits are not canonical.');
        }
    }
    const cells = new Uint8Array(cellCount);
    for (let index = 0; index < cellCount; index++) {
        cells[index] = (packed[index >> 3] >> (index & 7)) & 1;
    }
    return cells;
}

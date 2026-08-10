/**
 * `@hexlife/embed/stochastic` — isolated stochastic-engine loader and Phase-1 runtime shell.
 *
 * This module is intentionally the only package entry that imports the stochastic Wasm artifact.
 * The root, `/sim`, and `/ca` entries continue to load the long-standing default artifact only.
 */

import init, {
    random_u32 as wasmRandomU32,
    WorldStochastic,
} from '../core/stochastic-wasm/hexlife_stochastic_wasm.js';
// eslint-disable-next-line import/no-unresolved
import wasmUrl from '../core/stochastic-wasm/hexlife_stochastic_wasm_bg.wasm?url';

/** Version of the Philox tuple mapping used by every stochastic decision. */
export const STOCHASTIC_RNG_VERSION = 1;

const DATA_URI_RE = /^data:[^,]*;base64,(.*)$/s;
const U32_MAX = 0xFFFF_FFFF;
const U64_MAX = (1n << 64n) - 1n;

/** @type {any} */
let wasmExports = null;
/** @type {Promise<any> | null} */
let initPromise = null;

/** @param {string} url */
async function loadWasmBytes(url) {
    const dataUri = DATA_URI_RE.exec(url);
    if (dataUri) {
        const binary = atob(dataUri[1]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }
    return (await fetch(url)).arrayBuffer();
}

/** Initialize only the stochastic Wasm artifact. Concurrent calls share one promise. */
export async function initStochasticEngine() {
    if (wasmExports) return;
    if (!initPromise) {
        initPromise = (async () => {
            const bytes = await loadWasmBytes(wasmUrl);
            wasmExports = await init({module_or_path: bytes});
        })();
    }
    await initPromise;
}

/** @param {bigint|number} value @param {string} label */
function toU64(value, label) {
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new RangeError(`${label} must be a non-negative safe integer or bigint.`);
        }
        value = BigInt(value);
    }
    if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) {
        throw new RangeError(`${label} must fit an unsigned 64-bit integer.`);
    }
    return value;
}

/** @param {number} value @param {string} label */
function toU32(value, label) {
    if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
        throw new RangeError(`${label} must fit an unsigned 32-bit integer.`);
    }
    return value;
}

/** Stable Philox4x32-10 sample for `(seed, generation, cellIndex, streamId)`. */
export function randomU32(seed, generation, cellIndex, streamId) {
    if (!wasmExports) {
        throw new Error('randomU32: await initStochasticEngine() first.');
    }
    return wasmRandomU32(
        toU64(seed, 'seed'),
        toU64(generation, 'generation'),
        toU32(cellIndex, 'cellIndex'),
        toU32(streamId, 'streamId'),
    );
}

/** @type {Set<StochasticWorld>} */
const liveWorlds = new Set();

function refreshAllViews() {
    for (const world of liveWorlds) world._refreshViews();
}

/**
 * Phase-1 world shell. It owns geometry, seed, the visible-state buffer, and native topology but
 * has no transition rule or `tick()` until the Phase-2 neighborhood backend lands.
 */
export class StochasticWorld {
    /** @param {{rows: number, columns: number, seed: bigint|number}} options */
    constructor({rows, columns, seed}) {
        if (!wasmExports) {
            throw new Error('StochasticWorld: await initStochasticEngine() before construction.');
        }
        if (!Number.isInteger(rows) || !Number.isInteger(columns)) {
            throw new RangeError('StochasticWorld: rows and columns must be integers.');
        }

        this._wasm = wasmExports;
        try {
            this.world = new WorldStochastic(columns, rows, toU64(seed, 'seed'));
        } catch (cause) {
            if (cause instanceof Error) throw cause;
            throw new Error(String(cause));
        }
        this.rows = this.world.rows();
        this.columns = this.world.columns();
        this.numCells = this.world.num_cells();
        this.seed = this.world.seed();
        liveWorlds.add(this);
        refreshAllViews();
    }

    _refreshViews() {
        this.state = new Uint8Array(this._wasm.memory.buffer, this.world.state_ptr(), this.numCells);
    }

    get generation() {
        return this.world.generation();
    }

    /** Sample this world's seed/current generation without advancing mutable RNG state. */
    sample(cellIndex, streamId) {
        try {
            return this.world.rng_sample(
                toU32(cellIndex, 'cellIndex'),
                toU32(streamId, 'streamId'),
            );
        } catch (cause) {
            if (cause instanceof Error) throw cause;
            throw new Error(String(cause));
        }
    }

    dispose() {
        if (!this.world) return;
        liveWorlds.delete(this);
        this.world.free();
        this.world = null;
        this.state = null;
    }
}

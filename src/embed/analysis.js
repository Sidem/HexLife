/**
 * Optional native analysis over binary worlds.
 *
 * Both helpers exist so a demo can ask the engine a bounded question instead of snapshotting a
 * grid and answering it in JavaScript. Neither changes `run_tick`, and a page that never constructs
 * one pays nothing at all — no buffer, no branch, no store.
 */

import {
    BirthLanes as WasmBirthLanes,
    WorldDifference as WasmWorldDifference,
} from '../core/wasm-engine/hexlife_wasm.js';
import {
    refreshAllWasmViews,
    registerViewOwner,
    unregisterViewOwner,
    wasmExportsOrThrow,
} from './EmbedSim.js';

/** The engines return this instead of throwing across the Wasm boundary; see `ANALYSIS_SIZE_MISMATCH`. */
const SIZE_MISMATCH = 0xFFFF_FFFF;

/** Bounded pitch lanes reported by {@link BirthLaneMeter}. */
export const BIRTH_LANES = 8;

function rawWorld(sim, label) {
    const world = sim && (sim.world ?? sim);
    if (!world || typeof world.state_ptr !== 'function') {
        throw new TypeError(`${label}: expected a simulation from @hexlife/embed.`);
    }
    return world;
}

/**
 * A persistent XOR mask over two binary worlds of the same size.
 *
 * Replaces "snapshot both grids, XOR them in JavaScript, upload the mask" with one native call.
 * The mask is a live view into Wasm memory, so reading it copies nothing.
 */
export class DifferenceMask {
    /** @param {number} numCells */
    constructor(numCells) {
        if (!Number.isSafeInteger(numCells) || numCells <= 0) {
            throw new RangeError('DifferenceMask: numCells must be a positive safe integer.');
        }
        this._wasm = wasmExportsOrThrow();
        this.numCells = numCells;
        this.difference = new WasmWorldDifference(numCells);
        registerViewOwner(this);
        // Allocating the mask may have grown the shared memory and detached every other view.
        refreshAllWasmViews();
    }

    _refreshViews() {
        this.mask = new Uint8Array(
            this._wasm.memory.buffer,
            this.difference.mask_ptr(),
            this.numCells,
        );
    }

    /** Cells that differ, from the last comparison. */
    get hamming() {
        return this.difference.hamming();
    }

    /** Recompute the mask from two simulations. Returns the Hamming distance. */
    compare(left, right) {
        const hamming = this.difference.compare(
            rawWorld(left, 'DifferenceMask.compare'),
            rawWorld(right, 'DifferenceMask.compare'),
        );
        return this._checked(hamming, left, right);
    }

    /**
     * Recompute the mask and publish it straight into a k-state world's own state buffer.
     *
     * The difference never becomes a JavaScript array and nothing crosses the boundary to display
     * it — the display world is simply told, inside Wasm, what its cells now are.
     */
    compareInto(left, right, display) {
        const target = display && (display.world ?? display);
        if (!target || typeof target.set_cells !== 'function') {
            throw new TypeError('DifferenceMask.compareInto: expected a <hexlife-ca> world to display into.');
        }
        const hamming = this.difference.compare_into(
            rawWorld(left, 'DifferenceMask.compareInto'),
            rawWorld(right, 'DifferenceMask.compareInto'),
            target,
        );
        return this._checked(hamming, left, right);
    }

    _checked(hamming, left, right) {
        if (hamming === SIZE_MISMATCH) {
            throw new RangeError(
                `DifferenceMask: expected two worlds of ${this.numCells} cells, received `
                + `${rawWorld(left, 'DifferenceMask').num_cells()} and `
                + `${rawWorld(right, 'DifferenceMask').num_cells()}.`,
            );
        }
        return hamming;
    }

    dispose() {
        if (!this.difference) return;
        unregisterViewOwner(this);
        this.difference.free();
        this.difference = null;
        this.mask = null;
    }
}

/**
 * Eight bounded birth lanes with at most one representative index each.
 *
 * The engine double-buffers, so the previous generation is already in Wasm memory: this owns no
 * per-cell storage and copies nothing. `sample` reports the births of the most recent tick.
 */
export class BirthLaneMeter {
    /** @param {object} sim a simulation from `@hexlife/embed` */
    constructor(sim) {
        this._wasm = wasmExportsOrThrow();
        this.lanes = new WasmBirthLanes(rawWorld(sim, 'BirthLaneMeter'));
        registerViewOwner(this);
        refreshAllWasmViews();
    }

    _refreshViews() {
        this.counts = new Uint32Array(
            this._wasm.memory.buffer,
            this.lanes.counts_ptr(),
            BIRTH_LANES,
        );
        this.representatives = new Int32Array(
            this._wasm.memory.buffer,
            this.lanes.representatives_ptr(),
            BIRTH_LANES,
        );
    }

    /** Births across all lanes, from the last {@link BirthLaneMeter.sample}. */
    get total() {
        return this.lanes.total();
    }

    /**
     * Scan the births the most recent tick produced. Returns the total; `counts` and
     * `representatives` are live views holding eight entries each.
     */
    sample(sim) {
        const total = this.lanes.sample(rawWorld(sim, 'BirthLaneMeter.sample'));
        if (total === SIZE_MISMATCH) {
            throw new RangeError('BirthLaneMeter.sample: the world changed size; build a new meter.');
        }
        return total;
    }

    /** Clear the reported result without scanning. */
    clear() {
        this.lanes.clear();
    }

    dispose() {
        if (!this.lanes) return;
        unregisterViewOwner(this);
        this.lanes.free();
        this.lanes = null;
        this.counts = this.representatives = null;
    }
}

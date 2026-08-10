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

/** Maximum visible states in the bounded neighborhood backend. */
export const MAX_STOCHASTIC_STATES = 16;
/** New-rule default: Philox4x32-10 with the version-1 tuple mapping. */
export const RNG_PHILOX_V1 = 'philox-v1';
/** Exact migration compatibility for the three frozen JavaScript demo models. */
export const RNG_LEGACY_DEMO_V0 = 'legacy-demo-v0';

const DATA_URI_RE = /^data:[^,]*;base64,(.*)$/s;
const U32_MAX = 0xFFFF_FFFF;
const U64_MAX = (1n << 64n) - 1n;
const RULE_HEADER_BYTES = 8;
const RULE_ROW_BYTES = 272;
const MAX_TRANSITIONS = 64;
const NO_NEIGHBOR_STATE = 0xFF;
const RNG_TAGS = {[RNG_LEGACY_DEMO_V0]: 0, [RNG_PHILOX_V1]: 1};

/**
 * Build the 64 mask probabilities for independent exposure from matching neighbors.
 * `chance` is either one probability for all six directions or six canonical-direction values.
 */
export function independentNeighborChance(chance) {
    const directions = typeof chance === 'number' ? new Array(6).fill(chance) : Array.from(chance);
    if (directions.length !== 6) {
        throw new RangeError('independentNeighborChance: expected one chance or six directions.');
    }
    for (const value of directions) assertProbability(value, 'independentNeighborChance');
    const probabilities = new Float64Array(64);
    for (let mask = 0; mask < 64; mask++) {
        let survival = 1;
        for (let direction = 0; direction < 6; direction++) {
            if (mask & (1 << direction)) survival *= 1 - directions[direction];
        }
        probabilities[mask] = 1 - survival;
    }
    return probabilities;
}

/**
 * Compile the bounded author object into canonical `HSN1` bytes consumed directly by Rust.
 * Rows are canonicalized by state then descending priority; stochastic rows require stable streams.
 */
export function compileStochasticRule({states, transitions, rng = RNG_PHILOX_V1}) {
    if (!Number.isInteger(states) || states < 2 || states > MAX_STOCHASTIC_STATES) {
        throw new RangeError(`compileStochasticRule: states must be in 2..${MAX_STOCHASTIC_STATES}.`);
    }
    if (!Array.isArray(transitions) || transitions.length > MAX_TRANSITIONS) {
        throw new RangeError(`compileStochasticRule: transitions must be an array of at most ${MAX_TRANSITIONS} rows.`);
    }
    if (!(rng in RNG_TAGS)) {
        throw new RangeError(`compileStochasticRule: unsupported RNG '${rng}'.`);
    }

    const rows = transitions.map((transition, inputIndex) => compileTransition(transition, inputIndex, states));
    rows.sort((a, b) => a.from - b.from || b.priority - a.priority);
    for (let index = 1; index < rows.length; index++) {
        const previous = rows[index - 1];
        const current = rows[index];
        if (previous.from === current.from && previous.priority === current.priority) {
            throw new RangeError(
                `compileStochasticRule: state ${current.from} has ambiguous priority ${current.priority}.`,
            );
        }
    }

    const bytes = new Uint8Array(RULE_HEADER_BYTES + rows.length * RULE_ROW_BYTES);
    bytes.set([0x48, 0x53, 0x4E, 0x31, states, RNG_TAGS[rng], rows.length & 0xFF, rows.length >>> 8]);
    const view = new DataView(bytes.buffer);
    rows.forEach((row, index) => {
        const offset = RULE_HEADER_BYTES + index * RULE_ROW_BYTES;
        bytes[offset] = row.from;
        bytes[offset + 1] = row.to;
        bytes[offset + 2] = row.neighborState;
        bytes[offset + 3] = row.resetAge ? 1 : 0;
        view.setUint16(offset + 4, row.minAge, true);
        view.setUint16(offset + 6, row.maxAge, true);
        view.setUint16(offset + 8, row.priority, true);
        view.setUint32(offset + 12, row.stream, true);
        row.thresholds.forEach((threshold, mask) => view.setUint32(offset + 16 + mask * 4, threshold, true));
    });
    return bytes;
}

function compileTransition(transition, inputIndex, states) {
    if (!transition || typeof transition !== 'object') {
        throw new TypeError(`compileStochasticRule: transition ${inputIndex} must be an object.`);
    }
    const from = assertState(transition.from, states, `transition ${inputIndex}.from`);
    const to = assertState(transition.to, states, `transition ${inputIndex}.to`);
    const neighborState = transition.neighborState == null
        ? NO_NEIGHBOR_STATE
        : assertState(transition.neighborState, states, `transition ${inputIndex}.neighborState`);
    const minAge = transition.minAge ?? 0;
    const maxAge = transition.maxAge ?? 0xFFFF;
    const priority = transition.priority ?? 0;
    for (const [label, value] of [['minAge', minAge], ['maxAge', maxAge], ['priority', priority]]) {
        if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
            throw new RangeError(`compileStochasticRule: transition ${inputIndex}.${label} must fit u16.`);
        }
    }
    if (minAge > maxAge) {
        throw new RangeError(`compileStochasticRule: transition ${inputIndex} has an empty age range.`);
    }

    if (transition.probability != null && transition.probabilityByMask != null) {
        throw new TypeError(`compileStochasticRule: transition ${inputIndex} has two probability sources.`);
    }
    let probabilities;
    if (transition.probabilityByMask != null) {
        probabilities = Array.from(transition.probabilityByMask);
        if (probabilities.length !== 64) {
            throw new RangeError(`compileStochasticRule: transition ${inputIndex} needs 64 mask probabilities.`);
        }
    } else {
        probabilities = new Array(64).fill(transition.probability ?? 1);
    }
    const thresholds = probabilities.map((probability) => probabilityThreshold(probability));
    const stochastic = thresholds.some((threshold) => threshold !== 0 && threshold !== U32_MAX);
    if (stochastic && transition.stream == null) {
        throw new TypeError(`compileStochasticRule: stochastic transition ${inputIndex} needs a stable stream.`);
    }

    return {
        from,
        to,
        neighborState,
        minAge,
        maxAge,
        priority,
        resetAge: transition.resetAge ?? true,
        stream: streamId(transition.stream ?? 0),
        thresholds,
    };
}

function probabilityThreshold(probability) {
    assertProbability(probability, 'compileStochasticRule');
    if (probability === 0) return 0;
    if (probability === 1) return U32_MAX;
    return Math.min(U32_MAX - 1, Math.ceil(probability * 0x1_0000_0000));
}

function streamId(stream) {
    if (typeof stream === 'number') return toU32(stream, 'stream');
    if (typeof stream !== 'string' || stream.length === 0) {
        throw new TypeError('compileStochasticRule: stream must be a non-empty string or u32.');
    }
    let hash = 0x811C_9DC5;
    for (const byte of new TextEncoder().encode(stream)) {
        hash ^= byte;
        hash = Math.imul(hash, 0x0100_0193);
    }
    return hash >>> 0;
}

function assertProbability(value, label) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`${label}: probability must be between 0 and 1.`);
    }
}

function assertState(value, states, label) {
    if (!Number.isInteger(value) || value < 0 || value >= states) {
        throw new RangeError(`compileStochasticRule: ${label} must be a state below ${states}.`);
    }
    return value;
}

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
    /** @param {{rows: number, columns: number, seed: bigint|number, rule?: Uint8Array, cells?: ArrayLike<number>, elapsedAges?: ArrayLike<number>}} options */
    constructor({rows, columns, seed, rule = null, cells = null, elapsedAges = null}) {
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
        if (rule) this.setRule(rule);
        if (cells) this.setInitialState(cells, elapsedAges);
    }

    _refreshViews() {
        this.state = new Uint8Array(this._wasm.memory.buffer, this.world.state_ptr(), this.numCells);
        this.nextState = new Uint8Array(this._wasm.memory.buffer, this.world.next_state_ptr(), this.numCells);
        this._elapsedAges = new Uint16Array(
            this._wasm.memory.buffer,
            this.world.elapsed_ages_ptr(),
            this.numCells,
        );
        this._census = new Uint32Array(this._wasm.memory.buffer, this.world.census_ptr(), MAX_STOCHASTIC_STATES);
        this._transitionCounts = new Uint32Array(
            this._wasm.memory.buffer,
            this.world.transition_counts_ptr(),
            MAX_TRANSITIONS,
        );
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

    /** Install canonical bytes from {@link compileStochasticRule}. May grow Wasm memory. */
    setRule(rule) {
        this._assertLive();
        rethrowAsError(() => this.world.set_neighborhood_rule(
            rule instanceof Uint8Array ? rule : Uint8Array.from(rule),
        ));
        refreshAllViews();
    }

    /** Replace the exact generation-zero state and reset snapshot. */
    setInitialState(cells, elapsedAges = null) {
        this._assertLive();
        const state = cells instanceof Uint8Array ? cells : Uint8Array.from(cells);
        const ages = elapsedAges == null
            ? new Uint16Array(this.numCells)
            : elapsedAges instanceof Uint16Array ? elapsedAges : Uint16Array.from(elapsedAges);
        rethrowAsError(() => this.world.set_initial_state(state, ages));
    }

    /** Intervention-only bulk replacement at the current generation. */
    setCells(cells, elapsedAges = null) {
        this._assertLive();
        const state = cells instanceof Uint8Array ? cells : Uint8Array.from(cells);
        const ages = elapsedAges == null
            ? new Uint16Array(this.numCells)
            : elapsedAges instanceof Uint16Array ? elapsedAges : Uint16Array.from(elapsedAges);
        rethrowAsError(() => this.world.set_cells(state, ages));
    }

    setCell(index, value) {
        this._assertLive();
        rethrowAsError(() => this.world.set_cell(index, value));
    }

    /** Advance exact dense generations; Phase 3 adds optional skipping around this reference path. */
    tick(count = 1) {
        this._assertLive();
        const ticks = Math.max(0, Math.floor(count));
        let changed = 0;
        for (let index = 0; index < ticks; index++) {
            changed = rethrowAsError(() => this.world.run_tick());
            [this.state, this.nextState] = [this.nextState, this.state];
        }
        return changed;
    }

    reset() {
        this._assertLive();
        rethrowAsError(() => this.world.reset());
    }

    get states() {
        return this.world.states();
    }

    get lastChangedCount() {
        return this.world.last_changed_count();
    }

    census() {
        this._assertLive();
        return new Uint32Array(this._census.subarray(0, this.states));
    }

    transitionCounts() {
        this._assertLive();
        return new Uint32Array(this._transitionCounts.subarray(0, this.world.transition_count_len()));
    }

    checksum() {
        this._assertLive();
        return this.world.checksum_state();
    }

    auxiliaryChecksum() {
        this._assertLive();
        return this.world.checksum_auxiliary();
    }

    snapshotElapsedAges() {
        this._assertLive();
        this.world.compute_elapsed_ages();
        return new Uint16Array(this._elapsedAges);
    }

    snapshotCells() {
        return this.state ? new Uint8Array(this.state) : null;
    }

    dispose() {
        if (!this.world) return;
        liveWorlds.delete(this);
        this.world.free();
        this.world = null;
        this.state = this.nextState = this._elapsedAges = this._census = this._transitionCounts = null;
    }

    _assertLive() {
        if (!this.world) throw new Error('StochasticWorld: this world has been disposed.');
    }
}

function rethrowAsError(fn) {
    try {
        return fn();
    } catch (cause) {
        if (cause instanceof Error) throw cause;
        throw new Error(String(cause));
    }
}

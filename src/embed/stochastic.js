/**
 * `@hexlife/embed/stochastic` — isolated stochastic-engine loader and Phase-1 runtime shell.
 *
 * This module is intentionally the only package entry that imports the stochastic Wasm artifact.
 * The root, `/sim`, and `/ca` entries continue to load the long-standing default artifact only.
 */

import init, {
    is_conservative_gas_rule as wasmIsConservativeGasRule,
    random_u32 as wasmRandomU32,
    WorldStochastic,
} from '../core/stochastic-wasm/hexlife_stochastic_wasm.js';
// eslint-disable-next-line import/no-unresolved
import wasmUrl from '../core/stochastic-wasm/hexlife_stochastic_wasm_bg.wasm?url';

// The `HXS1.` world code. Re-exported here because this is the DOM-free entry: a Node host can
// validate a pasted code without loading the isolated stochastic artifact at all. Imported rather
// than re-exported straight through, because `StochasticWorld.code()` uses the backend tags itself.
import {
    decodeStochasticCode,
    encodeStochasticCode,
    isStochasticCode,
    isValidStochasticGeometry,
    stochasticAuxiliaryBytes,
    STOCHASTIC_BACKEND_LATTICE_GAS,
    STOCHASTIC_BACKEND_NEIGHBORHOOD,
    STOCHASTIC_PALETTE_NONE,
    STOCHASTIC_PALETTE_RGB,
} from '../core/StochasticCodec.js';

export {
    decodeStochasticCode,
    encodeStochasticCode,
    isStochasticCode,
    isValidStochasticGeometry,
    stochasticAuxiliaryBytes,
    STOCHASTIC_BACKEND_LATTICE_GAS,
    STOCHASTIC_BACKEND_NEIGHBORHOOD,
    STOCHASTIC_PALETTE_NONE,
    STOCHASTIC_PALETTE_RGB,
};

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

/** Backend selector for {@link StochasticWorld}. */
export const BACKEND_NEIGHBORHOOD = 'neighborhood';
export const BACKEND_LATTICE_GAS = 'lattice-gas';

const GAS_HEADER_BYTES = 12;
const GAS_CONFIGURATIONS = 1 << 12;
const GAS_RULE_BYTES = GAS_HEADER_BYTES + GAS_CONFIGURATIONS * 8;

/** Visible states projected from the six velocity channels of a lattice-gas site. */
export const GAS_STATES = Object.freeze({vacuum: 0, amber: 1, cyan: 2, mixed: 3, wall: 4});
/** Species labels carried by an occupied channel. */
export const GAS_SPECIES = Object.freeze({empty: 0, amber: 1, cyan: 2});

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

/**
 * The canonical two-species hexagonal collision operator.
 *
 * Two rules, both momentum-conserving and both sixfold rotation-equivariant:
 *
 * - a **head-on pair** in opposite channels rotates ±60°, which is the only genuinely ambiguous
 *   outcome in the set and therefore the only one that consumes a random number;
 * - a **symmetric triad** in alternating channels rotates to the other triad.
 *
 * Everything else streams through untouched. Species travel with their particle, so amber and cyan
 * counts are conserved entry by entry rather than on average.
 *
 * @param {number[]} channels six species values in canonical direction order
 */
export function hexGasCollide(channels) {
    const occupied = [];
    for (let direction = 0; direction < 6; direction++) {
        if (channels[direction] !== 0) occupied.push(direction);
    }
    if (occupied.length === 2 && occupied[1] - occupied[0] === 3) {
        const [first, second] = occupied;
        const primary = new Array(6).fill(0);
        const alternate = new Array(6).fill(0);
        primary[(first + 1) % 6] = channels[first];
        primary[(second + 1) % 6] = channels[second];
        alternate[(first + 5) % 6] = channels[first];
        alternate[(second + 5) % 6] = channels[second];
        return {primary, alternate, probability: 0.5};
    }
    if (
        occupied.length === 3
        && occupied[1] - occupied[0] === 2
        && occupied[2] - occupied[1] === 2
    ) {
        const rotated = new Array(6).fill(0);
        for (const direction of occupied) rotated[(direction + 1) % 6] = channels[direction];
        return rotated;
    }
    return channels;
}

/**
 * Compile a collision operator into canonical `HSG1` bytes.
 *
 * `collide` runs once per packed configuration at compile time — never per cell per tick — and may
 * return either six outgoing channels or `{primary, alternate, probability}` for an outcome with a
 * genuine symmetry choice. `scatter` is an optional thermal ±60° rotation applied after collision;
 * it is deliberately not momentum-conserving, and `scatter: 0` is the momentum-conserving mode.
 */
export function compileGasRule({collide = hexGasCollide, scatter = 0, rng = RNG_PHILOX_V1} = {}) {
    if (typeof collide !== 'function') {
        throw new TypeError('compileGasRule: collide must be a function.');
    }
    assertProbability(scatter, 'compileGasRule');
    if (!(rng in RNG_TAGS)) {
        throw new RangeError(`compileGasRule: unsupported RNG '${rng}'.`);
    }

    const bytes = new Uint8Array(GAS_RULE_BYTES);
    bytes.set([0x48, 0x53, 0x47, 0x31, 2, RNG_TAGS[rng], 0, 0]);
    const view = new DataView(bytes.buffer);
    // Quantized even: the tick reuses this sample's low bit as the ±60° coin, which is an exactly
    // fair choice only when the threshold is even. The loader rejects an odd one.
    view.setUint32(8, probabilityThreshold(scatter) & ~1, true);
    const thresholdBase = GAS_HEADER_BYTES + GAS_CONFIGURATIONS * 4;

    const channels = new Array(6);
    for (let config = 0; config < GAS_CONFIGURATIONS; config++) {
        let legal = true;
        for (let direction = 0; direction < 6; direction++) {
            channels[direction] = (config >>> (2 * direction)) & 3;
            if (channels[direction] === 3) legal = false;
        }
        // Unreachable by streaming; pinned to the identity so the compiled bytes stay canonical.
        if (!legal) {
            view.setUint32(GAS_HEADER_BYTES + config * 4, config | (config << 16), true);
            continue;
        }
        const outcome = collide([...channels], config);
        const primary = packGasChannels(Array.isArray(outcome) ? outcome : outcome.primary, config);
        const alternate = Array.isArray(outcome)
            ? primary
            : packGasChannels(outcome.alternate ?? outcome.primary, config);
        const probability = Array.isArray(outcome) ? 0 : outcome.probability ?? 0.5;
        view.setUint32(GAS_HEADER_BYTES + config * 4, (primary | (alternate << 16)) >>> 0, true);
        if (primary !== alternate) {
            view.setUint32(thresholdBase + config * 4, probabilityThreshold(probability), true);
        }
    }
    return bytes;
}

function packGasChannels(outgoing, config) {
    if (!outgoing || outgoing.length !== 6) {
        throw new RangeError(`compileGasRule: configuration ${config} produced ${outgoing?.length ?? 0} channels, expected 6.`);
    }
    let packed = 0;
    for (let direction = 0; direction < 6; direction++) {
        const species = outgoing[direction];
        if (!Number.isInteger(species) || species < 0 || species > 2) {
            throw new RangeError(`compileGasRule: configuration ${config} produced species ${species}, expected 0..2.`);
        }
        packed |= species << (2 * direction);
    }
    return packed;
}

/** Whether `rule` is a well-formed `HSG1` table that conserves both species for every entry. */
export function isConservativeGasRule(rule) {
    if (!wasmExports) {
        throw new Error('isConservativeGasRule: await initStochasticEngine() first.');
    }
    return wasmIsConservativeGasRule(rule instanceof Uint8Array ? rule : Uint8Array.from(rule));
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
 * Allocation-free stochastic-neighborhood runtime.
 *
 * The world owns geometry, seed, topology, visible state, state epochs, census, transition counts,
 * and its activity metadata natively. Normal ticks copy nothing into Wasm and allocate nothing.
 */
export class StochasticWorld {
    /** @param {{rows: number, columns: number, seed: bigint|number, backend?: string, rule?: Uint8Array, cells?: ArrayLike<number>, elapsedAges?: ArrayLike<number>, channels?: ArrayLike<number>, walls?: ArrayLike<number>}} options */
    constructor({
        rows,
        columns,
        seed,
        backend = BACKEND_NEIGHBORHOOD,
        rule = null,
        cells = null,
        elapsedAges = null,
        channels = null,
        walls = null,
    }) {
        if (!wasmExports) {
            throw new Error('StochasticWorld: await initStochasticEngine() before construction.');
        }
        if (!Number.isInteger(rows) || !Number.isInteger(columns)) {
            throw new RangeError('StochasticWorld: rows and columns must be integers.');
        }
        if (backend !== BACKEND_NEIGHBORHOOD && backend !== BACKEND_LATTICE_GAS) {
            throw new RangeError(`StochasticWorld: unknown backend '${backend}'.`);
        }

        this._wasm = wasmExports;
        this.backend = backend;
        this._isGas = backend === BACKEND_LATTICE_GAS;
        try {
            this.world = this._isGas
                ? WorldStochastic.new_lattice_gas(columns, rows, toU64(seed, 'seed'))
                : new WorldStochastic(columns, rows, toU64(seed, 'seed'));
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
        if (this._isGas) {
            if (channels || walls) this.setInitialGasState(channels, walls);
        } else if (cells) {
            this.setInitialState(cells, elapsedAges);
        }
    }

    _refreshViews() {
        const memory = this._wasm.memory.buffer;
        this.state = new Uint8Array(memory, this.world.state_ptr(), this.numCells);
        this.nextState = new Uint8Array(memory, this.world.next_state_ptr(), this.numCells);
        this._elapsedAges = new Uint16Array(memory, this.world.elapsed_ages_ptr(), this.numCells);
        this._census = new Uint32Array(memory, this.world.census_ptr(), MAX_STOCHASTIC_STATES);
        this._transitionCounts = new Uint32Array(
            memory,
            this.world.transition_counts_ptr(),
            MAX_TRANSITIONS,
        );
        if (this._isGas) {
            this._walls = new Uint8Array(memory, this.world.walls_ptr(), this.numCells);
        }
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

    /**
     * Install canonical rule bytes for this world's backend — `HSN1` from
     * {@link compileStochasticRule} or `HSG1` from {@link compileGasRule}. May grow Wasm memory.
     */
    setRule(rule) {
        this._assertLive();
        const bytes = rule instanceof Uint8Array ? rule : Uint8Array.from(rule);
        rethrowAsError(() => (this._isGas
            ? this.world.set_gas_rule(bytes)
            : this.world.set_neighborhood_rule(bytes)));
        refreshAllViews();
    }

    /**
     * Replace the exact generation-zero lattice-gas state and reset snapshot.
     *
     * `channels` holds six species values per cell in canonical direction order; `walls` marks the
     * reflecting sites. Both are one-shot uploads — normal ticks copy nothing into Wasm.
     */
    setInitialGasState(channels, walls = null) {
        this._assertLive();
        rethrowAsError(() => this.world.set_gas_initial_state(
            toChannelBytes(channels, this.numCells),
            toWallBytes(walls, this.numCells),
        ));
    }

    /** Intervention-only bulk lattice-gas replacement at the current generation. */
    setGasCells(channels, walls = null) {
        this._assertLive();
        rethrowAsError(() => this.world.set_gas_cells(
            toChannelBytes(channels, this.numCells),
            toWallBytes(walls, this.numCells),
        ));
    }

    /** Open or close one barrier site. Opening a membrane edits only the native wall buffer. */
    setWall(index, isWall) {
        this._assertLive();
        rethrowAsError(() => this.world.set_wall(index, Boolean(isWall)));
    }

    /** Exact particle total for one species (1 = amber, 2 = cyan). */
    speciesCount(species) {
        this._assertLive();
        return this.world.species_count(species);
    }

    /** Sites the collision table rewrote on the last tick. */
    collisionCount() {
        this._assertLive();
        return this.world.collision_count();
    }

    /**
     * Six species values per cell, for export or debugging only.
     *
     * The live channel view is rebuilt here rather than cached: the gas tick swaps its two channel
     * buffers, so `channels_ptr()` alternates and a stored view would silently go one tick stale.
     */
    snapshotChannels() {
        this._assertLive();
        const live = new Uint16Array(
            this._wasm.memory.buffer,
            this.world.channels_ptr(),
            this.numCells,
        );
        const out = new Uint8Array(this.numCells * 6);
        for (let index = 0; index < this.numCells; index++) {
            const config = live[index];
            for (let direction = 0; direction < 6; direction++) {
                out[index * 6 + direction] = (config >>> (2 * direction)) & 3;
            }
        }
        return out;
    }

    snapshotWalls() {
        this._assertLive();
        return new Uint8Array(this._walls);
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

    /**
     * Turn exact activity skipping off (or back on). Off forces the dense reference path, which
     * must produce identical state, ages, census, transition counts, and checksums every tick.
     */
    setSkippingEnabled(enabled) {
        this._assertLive();
        this.world.set_skipping_enabled(Boolean(enabled));
    }

    get skippingEnabled() {
        return this.world.skipping_enabled();
    }

    /** Chunks recomputed during the last tick — the diagnostic behind the sparse-workload gate. */
    activeChunkCount() {
        this._assertLive();
        return this.world.active_chunk_count();
    }

    chunkCount() {
        this._assertLive();
        return this.world.chunk_count();
    }

    /**
     * Clamp every stored epoch to at most 65,535 ticks back. Ticking does this automatically long
     * before the `u32` distance could become ambiguous; the explicit call exists for tests.
     */
    rebaseEpochs() {
        this._assertLive();
        this.world.rebase_epochs();
    }

    /** Advance exact generations. Skipping is on by default and is exact, not an approximation. */
    tick(count = 1) {
        this._assertLive();
        const ticks = Math.max(0, Math.floor(count));
        let changed = 0;
        for (let index = 0; index < ticks; index++) {
            changed = rethrowAsError(() => this.world.run_tick());
            // The neighborhood tick swaps its two visible buffers; the gas projects in place, so
            // its live view never moves. Neither path allocates or copies a grid.
            if (!this._isGas) [this.state, this.nextState] = [this.nextState, this.state];
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

    /**
     * Visible cells that differ from another same-sized stochastic world.
     *
     * The comparison runs entirely inside Wasm and returns one scalar, so a paired instrument can
     * update every tick without snapshotting or scanning either grid in JavaScript.
     */
    differenceCount(other) {
        this._assertLive();
        if (!(other instanceof StochasticWorld)) {
            throw new TypeError('StochasticWorld.differenceCount: other must be a StochasticWorld.');
        }
        other._assertLive();
        if (this.rows !== other.rows || this.columns !== other.columns) {
            throw new RangeError(
                `StochasticWorld.differenceCount: equal geometry required, received `
                + `${this.rows}x${this.columns} and ${other.rows}x${other.columns}.`,
            );
        }
        return this.world.visible_difference_count(other.world);
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

    /** The canonical compiled rule bytes currently installed. */
    ruleBytes() {
        this._assertLive();
        const length = this.world.rule_len();
        return new Uint8Array(
            new Uint8Array(this._wasm.memory.buffer, this.world.rule_ptr(), length),
        );
    }

    /**
     * Freeze this world into an `HXS1.` code that resumes to an identical *next tick*, not merely
     * an identical frame: the seed, generation, compiled rule, and auxiliary state all travel.
     */
    async code({palette = null, speed = 10} = {}) {
        this._assertLive();
        const common = {
            backend: this._isGas ? STOCHASTIC_BACKEND_LATTICE_GAS : STOCHASTIC_BACKEND_NEIGHBORHOOD,
            rows: this.rows,
            columns: this.columns,
            states: this.states,
            seed: this.seed,
            generation: this.generation,
            rule: this.ruleBytes(),
            palette,
            speed,
        };
        return encodeStochasticCode(this._isGas
            ? {...common, channels: this.snapshotChannels(), walls: this.snapshotWalls()}
            : {...common, cells: this.snapshotCells(), elapsedAges: this.snapshotElapsedAges()});
    }

    dispose() {
        if (!this.world) return;
        liveWorlds.delete(this);
        this.world.free();
        this.world = null;
        this.state = this.nextState = this._elapsedAges = this._census = this._transitionCounts = null;
        this._walls = null;
    }

    _assertLive() {
        if (!this.world) throw new Error('StochasticWorld: this world has been disposed.');
    }
}

/**
 * Rebuild the exact world an `HXS1.` code describes, at its own generation.
 *
 * Returns `null` for anything that is not a decodable code, so a pasted string is a "no" rather
 * than an exception. The engine must already be initialized.
 */
export async function createStochasticWorldFromCode(code) {
    const decoded = await decodeStochasticCode(code);
    if (!decoded) return null;
    const gas = decoded.backend === STOCHASTIC_BACKEND_LATTICE_GAS;
    const world = new StochasticWorld({
        rows: decoded.rows,
        columns: decoded.columns,
        seed: decoded.seed,
        backend: gas ? BACKEND_LATTICE_GAS : BACKEND_NEIGHBORHOOD,
        rule: decoded.rule,
    });
    try {
        if (gas) world.setInitialGasState(decoded.channels, decoded.walls);
        else world.setInitialState(decoded.cells, decoded.elapsedAges);
        world.world.resume_at_generation(decoded.generation);
    } catch (cause) {
        world.dispose();
        throw cause;
    }
    return {world, palette: decoded.palette, speed: decoded.speed};
}

function toChannelBytes(channels, numCells) {
    if (channels == null) return new Uint8Array(numCells * 6);
    return channels instanceof Uint8Array ? channels : Uint8Array.from(channels);
}

function toWallBytes(walls, numCells) {
    if (walls == null) return new Uint8Array(numCells);
    return walls instanceof Uint8Array ? walls : Uint8Array.from(walls);
}

function rethrowAsError(fn) {
    try {
        return fn();
    } catch (cause) {
        if (cause instanceof Error) throw cause;
        throw new Error(String(cause));
    }
}

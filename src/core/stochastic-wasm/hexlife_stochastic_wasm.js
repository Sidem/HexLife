/* @ts-self-types="./hexlife_stochastic_wasm.d.ts" */

/**
 * Dense stochastic-neighborhood world. Every per-cell buffer has final capacity at construction;
 * installing a rule may replace only the bounded compiled row table and canonical rule bytes.
 */
export class WorldStochastic {
    static __wrap(ptr) {
        const obj = Object.create(WorldStochastic.prototype);
        obj.__wbg_ptr = ptr;
        WorldStochasticFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorldStochasticFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_worldstochastic_free(ptr, 0);
    }
    /**
     * Chunks recomputed during the last tick, out of [`WorldStochastic::chunk_count`].
     * @returns {number}
     */
    active_chunk_count() {
        const ret = wasm.worldstochastic_active_chunk_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    backend() {
        const ret = wasm.worldstochastic_backend(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    census_ptr() {
        const ret = wasm.worldstochastic_census_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    channels_ptr() {
        const ret = wasm.worldstochastic_channels_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Hash of everything a code must restore beyond the visible state: epochs for the neighborhood
     * backend, velocity channels and walls for the gas.
     * @returns {number}
     */
    checksum_auxiliary() {
        const ret = wasm.worldstochastic_checksum_auxiliary(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    checksum_state() {
        const ret = wasm.worldstochastic_checksum_state(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    chunk_count() {
        const ret = wasm.worldstochastic_chunk_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Sites whose incoming configuration was rewritten by the collision table on the last tick.
     * @returns {number}
     */
    collision_count() {
        const ret = wasm.worldstochastic_collision_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    columns() {
        const ret = wasm.worldstochastic_columns(this.__wbg_ptr);
        return ret >>> 0;
    }
    compute_elapsed_ages() {
        wasm.worldstochastic_compute_elapsed_ages(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    elapsed_ages_ptr() {
        const ret = wasm.worldstochastic_elapsed_ages_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {bigint}
     */
    generation() {
        const ret = wasm.worldstochastic_generation(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {number}
     */
    last_changed_count() {
        const ret = wasm.worldstochastic_last_changed_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} columns
     * @param {number} rows
     * @param {bigint} seed
     */
    constructor(columns, rows, seed) {
        const ret = wasm.worldstochastic_new(columns, rows, seed);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WorldStochasticFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * A lattice-gas world. A separate constructor rather than a runtime switch so neither backend
     * allocates the other's per-cell buffers.
     * @param {number} columns
     * @param {number} rows
     * @param {bigint} seed
     * @returns {WorldStochastic}
     */
    static new_lattice_gas(columns, rows, seed) {
        const ret = wasm.worldstochastic_new_lattice_gas(columns, rows, seed);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WorldStochastic.__wrap(ret[0]);
    }
    /**
     * @returns {number}
     */
    next_state_ptr() {
        const ret = wasm.worldstochastic_next_state_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    num_cells() {
        const ret = wasm.worldstochastic_num_cells(this.__wbg_ptr);
        return ret >>> 0;
    }
    rebase_epochs() {
        wasm.worldstochastic_rebase_epochs(this.__wbg_ptr);
    }
    reset() {
        const ret = wasm.worldstochastic_reset(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Clamp every stored epoch to at most `u16::MAX` ticks back so the `u32` distance can never
     * approach the half-range. Exact, because [`saturating_age`] already saturates there.
     * Resume the current world at `generation`, preserving every elapsed age exactly.
     *
     * Epochs are absolute generations, so moving the clock means moving them by the same delta â€”
     * otherwise a decoded code would restore the right cells with the wrong ages. The current
     * world also becomes the reset target, which is the `HXS1` capture policy: a code is the exact
     * world it was taken from, and resetting returns to that world rather than to generation zero.
     * @param {bigint} generation
     */
    resume_at_generation(generation) {
        wasm.worldstochastic_resume_at_generation(this.__wbg_ptr, generation);
    }
    /**
     * @param {number} cell_index
     * @param {number} stream_id
     * @returns {number}
     */
    rng_sample(cell_index, stream_id) {
        const ret = wasm.worldstochastic_rng_sample(this.__wbg_ptr, cell_index, stream_id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @returns {number}
     */
    rows() {
        const ret = wasm.worldstochastic_rows(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    rule_len() {
        const ret = wasm.worldstochastic_rule_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    rule_ptr() {
        const ret = wasm.worldstochastic_rule_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Advance one generation.
     *
     * The backend is dispatched exactly once, here â€” never inside a per-cell loop. For the
     * neighborhood backend `run_tick_dense` is the reference and the skipping path must agree with
     * it on state, ages, census, transition counts, and both checksums after every tick.
     * @returns {number}
     */
    run_tick() {
        const ret = wasm.worldstochastic_run_tick(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @returns {bigint}
     */
    seed() {
        const ret = wasm.worldstochastic_seed(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @param {number} index
     * @param {number} value
     */
    set_cell(index, value) {
        const ret = wasm.worldstochastic_set_cell(this.__wbg_ptr, index, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Intervention-only bulk replacement at the current generation.
     * @param {Uint8Array} cells
     * @param {Uint16Array} elapsed_ages
     */
    set_cells(cells, elapsed_ages) {
        const ptr0 = passArray8ToWasm0(cells, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray16ToWasm0(elapsed_ages, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.worldstochastic_set_cells(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Intervention-only bulk replacement at the current generation.
     * @param {Uint8Array} channels
     * @param {Uint8Array} walls
     */
    set_gas_cells(channels, walls) {
        const ptr0 = passArray8ToWasm0(channels, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(walls, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.worldstochastic_set_gas_cells(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Replace the reset snapshot: six species channels per cell, plus the wall bitmap.
     *
     * Walls hold no particles, so any channel written on a wall site is dropped rather than
     * silently leaking mass on the first tick.
     * @param {Uint8Array} channels
     * @param {Uint8Array} walls
     */
    set_gas_initial_state(channels, walls) {
        const ptr0 = passArray8ToWasm0(channels, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(walls, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.worldstochastic_set_gas_initial_state(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Install a canonical `HSG1` collision table. Allocation is allowed here; `run_tick` never
     * allocates. The table is rejected unless every reachable entry conserves both species.
     * @param {Uint8Array} bytes
     */
    set_gas_rule(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.worldstochastic_set_gas_rule(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Replace the reset snapshot and reset the world to generation zero.
     * @param {Uint8Array} cells
     * @param {Uint16Array} elapsed_ages
     */
    set_initial_state(cells, elapsed_ages) {
        const ptr0 = passArray8ToWasm0(cells, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray16ToWasm0(elapsed_ages, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.worldstochastic_set_initial_state(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Install canonical `HSN1` bytes. Allocation is allowed here; `run_tick` never allocates.
     * @param {Uint8Array} bytes
     */
    set_neighborhood_rule(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.worldstochastic_set_neighborhood_rule(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Turn exact activity skipping off (or back on). Off forces the dense reference path for every
     * tick; re-enabling wakes the whole grid so the metadata is rebuilt from a computed generation.
     * @param {boolean} enabled
     */
    set_skipping_enabled(enabled) {
        wasm.worldstochastic_set_skipping_enabled(this.__wbg_ptr, enabled);
    }
    /**
     * Open or close one lattice site's barrier. This is the whole membrane API: opening a gate
     * edits the native wall buffer only and never replaces the grid.
     * @param {number} index
     * @param {boolean} is_wall
     */
    set_wall(index, is_wall) {
        const ret = wasm.worldstochastic_set_wall(this.__wbg_ptr, index, is_wall);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {boolean}
     */
    skipping_enabled() {
        const ret = wasm.worldstochastic_skipping_enabled(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Exact particle count for one species: 1 = amber, 2 = cyan. Conserved by every legal table.
     * @param {number} species
     * @returns {number}
     */
    species_count(species) {
        const ret = wasm.worldstochastic_species_count(this.__wbg_ptr, species);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    state_ptr() {
        const ret = wasm.worldstochastic_state_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    states() {
        const ret = wasm.worldstochastic_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    transition_count_len() {
        const ret = wasm.worldstochastic_transition_count_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    transition_counts_ptr() {
        const ret = wasm.worldstochastic_transition_counts_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Count visible-state disagreements with another native stochastic world.
     *
     * This is deliberately a scalar aggregate rather than two exported snapshots: paired demos
     * may display divergence every tick without moving either full grid through JavaScript or
     * running a host-owned per-cell loop. The pass allocates nothing.
     * @param {WorldStochastic} other
     * @returns {number}
     */
    visible_difference_count(other) {
        _assertClass(other, WorldStochastic);
        const ret = wasm.worldstochastic_visible_difference_count(this.__wbg_ptr, other.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    walls_ptr() {
        const ret = wasm.worldstochastic_walls_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WorldStochastic.prototype[Symbol.dispose] = WorldStochastic.prototype.free;

/**
 * Whether `bytes` is a well-formed `HSG1` table that conserves both species everywhere.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function is_conservative_gas_rule(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_conservative_gas_rule(ptr0, len0);
    return ret !== 0;
}

/**
 * Counter-based Philox4x32-10 sample for one stochastic decision: word 0 of the block above.
 * @param {bigint} seed
 * @param {bigint} generation
 * @param {number} cell_index
 * @param {number} stream_id
 * @returns {number}
 */
export function random_u32(seed, generation, cell_index, stream_id) {
    const ret = wasm.random_u32(seed, generation, cell_index, stream_id);
    return ret >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_bbadd78c1bac3a77: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./hexlife_stochastic_wasm_bg.js": import0,
    };
}

const WorldStochasticFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_worldstochastic_free(ptr, 1));

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray16ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 2, 2) >>> 0;
    getUint16ArrayMemory0().set(arg, ptr / 2);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint16ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('hexlife_stochastic_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

/* @ts-self-types="./hexlife_hcp_wasm.d.ts" */

/**
 * A k-state cellular automaton on the hexagonal close-packed lattice.
 */
export class WorldHcp {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorldHcpFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_worldhcp_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    active_chunk_count() {
        const ret = wasm.worldhcp_active_chunk_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    backend() {
        const ret = wasm.worldhcp_backend(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    block_alternates() {
        const ret = wasm.worldhcp_block_alternates(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} state
     * @returns {number}
     */
    census_of(state) {
        const ret = wasm.worldhcp_census_of(this.__wbg_ptr, state);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    census_ptr() {
        const ret = wasm.worldhcp_census_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    checksum_state() {
        const ret = wasm.worldhcp_checksum_state(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    chunk_count() {
        const ret = wasm.worldhcp_chunk_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Zero every cell in `layer` whose state bit is set in `mask`. Counts land in `layer_scratch`.
     * @param {number} layer
     * @param {number} mask
     */
    clear_states_in_layer(layer, mask) {
        const ret = wasm.worldhcp_clear_states_in_layer(this.__wbg_ptr, layer, mask);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    cols() {
        const ret = wasm.worldhcp_cols(this.__wbg_ptr);
        return ret >>> 0;
    }
    compute_census() {
        wasm.worldhcp_compute_census(this.__wbg_ptr);
    }
    /**
     * @param {number} value
     */
    fill(value) {
        const ret = wasm.worldhcp_fill(this.__wbg_ptr, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {boolean}
     */
    is_settled() {
        const ret = wasm.worldhcp_is_settled(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    last_changed_count() {
        const ret = wasm.worldhcp_last_changed_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Occupancy of one layer. Counts land in `layer_scratch`.
     * @param {number} layer
     */
    layer_census(layer) {
        const ret = wasm.worldhcp_layer_census(this.__wbg_ptr, layer);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    layer_scratch_ptr() {
        const ret = wasm.worldhcp_layer_scratch_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    layers() {
        const ret = wasm.worldhcp_layers(this.__wbg_ptr);
        return ret >>> 0;
    }
    mark_all_dirty() {
        wasm.worldhcp_mark_all_dirty(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    ncells() {
        const ret = wasm.worldhcp_ncells(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Neighbour in `0..12`, or `0xFFFFFFFF` when that bond is missing (open face / wall).
     * @param {number} cell
     * @param {number} direction
     * @returns {number}
     */
    neighbor_of(cell, direction) {
        const ret = wasm.worldhcp_neighbor_of(this.__wbg_ptr, cell, direction);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Allocate every buffer to final capacity. Throws rather than silently changing the grid.
     * @param {number} layers
     * @param {number} rows
     * @param {number} cols
     * @param {number} states
     * @param {number} stacking
     * @param {number} xy_boundary
     * @param {number} z_boundary
     */
    constructor(layers, rows, cols, states, stacking, xy_boundary, z_boundary) {
        const ret = wasm.worldhcp_new(layers, rows, cols, states, stacking, xy_boundary, z_boundary);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WorldHcpFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Write `to` where current == `from` at the listed in-layer indices. Returns how many wrote.
     * @param {number} layer
     * @param {Uint32Array} indices
     * @param {number} from
     * @param {number} to
     * @returns {number}
     */
    paint_if(layer, indices, from, to) {
        const ptr0 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.worldhcp_paint_if(this.__wbg_ptr, layer, ptr0, len0, from, to);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Phase the *next* tick will use, in `0..6`.
     * @returns {number}
     */
    phase() {
        const ret = wasm.worldhcp_phase(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    rows() {
        const ret = wasm.worldhcp_rows(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    rule_len() {
        const ret = wasm.worldhcp_rule_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Advance one generation. Writes in place; no second buffer, no JS copy.
     * @returns {number}
     */
    run_tick() {
        const ret = wasm.worldhcp_run_tick(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Advance `count` generations and return the final changed-cell count.
     * @param {number} count
     * @returns {number}
     */
    run_ticks(count) {
        const ret = wasm.worldhcp_run_ticks(this.__wbg_ptr, count);
        return ret >>> 0;
    }
    /**
     * @param {boolean} alternates
     */
    set_block_alternates(alternates) {
        wasm.worldhcp_set_block_alternates(this.__wbg_ptr, alternates);
    }
    /**
     * Install the `k^4` packed-output table. **Allocates** (the slice is copied in from JS).
     * @param {Uint32Array} rule
     */
    set_block_rule(rule) {
        const ptr0 = passArray32ToWasm0(rule, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.worldhcp_set_block_rule(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Set one cell and wake its chunk.
     * @param {number} index
     * @param {number} value
     */
    set_cell(index, value) {
        const ret = wasm.worldhcp_set_cell(this.__wbg_ptr, index, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Overwrite every cell. **Allocates**. This is the supported bulk write.
     * @param {Uint8Array} cells
     */
    set_cells(cells) {
        const ptr0 = passArray8ToWasm0(cells, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.worldhcp_set_cells(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {boolean} enabled
     */
    set_skipping_enabled(enabled) {
        wasm.worldhcp_set_skipping_enabled(this.__wbg_ptr, enabled);
    }
    /**
     * Restore the partition phase so a decoded world resumes the next tick identically.
     * @param {bigint} count
     */
    set_tick_count(count) {
        wasm.worldhcp_set_tick_count(this.__wbg_ptr, count);
    }
    /**
     * @returns {boolean}
     */
    skipping_enabled() {
        const ret = wasm.worldhcp_skipping_enabled(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    stacking() {
        const ret = wasm.worldhcp_stacking(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    state_ptr() {
        const ret = wasm.worldhcp_state_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    states() {
        const ret = wasm.worldhcp_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {bigint}
     */
    tick_count() {
        const ret = wasm.worldhcp_tick_count(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {number}
     */
    xy_boundary() {
        const ret = wasm.worldhcp_xy_boundary(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    z_boundary() {
        const ret = wasm.worldhcp_z_boundary(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WorldHcp.prototype[Symbol.dispose] = WorldHcp.prototype.free;

/**
 * Layout version hosts can record with a recipe.
 * @returns {number}
 */
export function hcp_engine_version() {
    const ret = wasm.hcp_engine_version();
    return ret >>> 0;
}

/**
 * World-space `(x, y, z)` of one site at circumradius `hex_size`. Same formula as `hcpCoords.js`.
 * @param {number} col
 * @param {number} row
 * @param {number} layer
 * @param {number} hex_size
 * @returns {Float64Array}
 */
export function hcp_site_xyz(col, row, layer, hex_size) {
    const ret = wasm.hcp_site_xyz(col, row, layer, hex_size);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
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
        "./hexlife_hcp_wasm_bg.js": import0,
    };
}

const WorldHcpFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_worldhcp_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
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
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
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
        module_or_path = new URL('hexlife_hcp_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

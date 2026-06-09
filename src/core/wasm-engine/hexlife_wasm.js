/* @ts-self-types="./hexlife_wasm.d.ts" */

export class World {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorldFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_world_free(ptr, 0);
    }
    /**
     * Number of active cells in the current generation (as of the last `run_tick`).
     * @returns {number}
     */
    active_count() {
        const ret = wasm.world_active_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Normalized Shannon entropy of the 7-cell (center + 6 neighbors) block patterns over the
     * current state buffer. Ported from JS so the full-grid scan runs in Wasm instead of on the
     * worker's JS heap. Result is normalized into [0, 1] by dividing by 7 bits.
     * @returns {number}
     */
    block_entropy() {
        const ret = wasm.world_block_entropy(this.__wbg_ptr);
        return ret;
    }
    /**
     * Rolling hash of the current state buffer, used for cycle detection.
     * @returns {number}
     */
    checksum_state() {
        const ret = wasm.world_checksum_state(this.__wbg_ptr);
        return ret;
    }
    /**
     * Public constructor that can be called from JavaScript. All buffers are allocated once,
     * here, and never reallocated for the lifetime of the `World` — so the pointers handed to
     * JavaScript (and the views built over them) stay valid as long as Wasm memory is not grown.
     * @param {number} grid_cols
     * @param {number} grid_rows
     */
    constructor(grid_cols, grid_rows) {
        const ret = wasm.world_new(grid_cols, grid_rows);
        this.__wbg_ptr = ret;
        WorldFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    next_rule_indices_ptr() {
        const ret = wasm.world_next_rule_indices_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    next_state_ptr() {
        const ret = wasm.world_next_state_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    num_cells() {
        const ret = wasm.world_num_cells(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Zero the per-rule usage counters (used on world reset / load).
     */
    reset_rule_usage_counters() {
        wasm.world_reset_rule_usage_counters(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    rule_indices_ptr() {
        const ret = wasm.world_rule_indices_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    rule_usage_counters_ptr() {
        const ret = wasm.world_rule_usage_counters_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    ruleset_ptr() {
        const ret = wasm.world_ruleset_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Advance the simulation by one step.
     *
     * Reads `state` + `ruleset`, writes `next_state` + `next_rule_indices`, and increments the
     * per-rule usage counters. The current/next buffers are then swapped internally, so after the
     * call the new generation lives in `state` (and JavaScript must mirror the swap of its views).
     * Returns the number of active cells in the new generation.
     * @returns {number}
     */
    run_tick() {
        const ret = wasm.world_run_tick(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    state_ptr() {
        const ret = wasm.world_state_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) World.prototype[Symbol.dispose] = World.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_bbadd78c1bac3a77: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
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
        "./hexlife_wasm_bg.js": import0,
    };
}

const WorldFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_world_free(ptr, 1));

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
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

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
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
        module_or_path = new URL('hexlife_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

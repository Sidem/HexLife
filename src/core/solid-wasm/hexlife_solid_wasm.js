/* @ts-self-types="./hexlife_solid_wasm.d.ts" */

export class WorldSolid {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorldSolidFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_worldsolid_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get basePlate() {
        const ret = wasm.worldsolid_basePlate(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get columns() {
        const ret = wasm.worldsolid_columns(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The linear index of `cell`'s neighbor in canonical `direction` 0..5 — the same table the
     * lateral faces are culled against.
     *
     * Bounded and O(1): this is a geometry accessor for parity checks, never a data path. Layer
     * data crosses the boundary in exactly one bulk copy per layer (§2), and it does not come
     * through here.
     * @param {number} cell
     * @param {number} direction
     * @returns {number}
     */
    neighborOf(cell, direction) {
        const ret = wasm.worldsolid_neighborOf(this.__wbg_ptr, cell, direction);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Validate the geometry and fix the allocation plan.
     *
     * Every buffer sized from these numbers is allocated up front in later phases: growing the
     * isolated linear memory after JavaScript has built a view into it detaches that view, and the
     * whole point of the one-`set`-per-layer ingestion path is that the view is built once.
     * @param {number} rows
     * @param {number} columns
     * @param {number} ticks
     * @param {number} sub_layers
     * @param {number} base_plate
     * @param {number} solid_states
     */
    constructor(rows, columns, ticks, sub_layers, base_plate, solid_states) {
        const ret = wasm.worldsolid_new(rows, columns, ticks, sub_layers, base_plate, solid_states);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WorldSolidFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get numCells() {
        const ret = wasm.worldsolid_numCells(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get rows() {
        const ret = wasm.worldsolid_rows(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get solidStates() {
        const ret = wasm.worldsolid_solidStates(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get subLayers() {
        const ret = wasm.worldsolid_subLayers(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get ticks() {
        const ret = wasm.worldsolid_ticks(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Height of the finished volume in layers, base plate included.
     * @returns {number}
     */
    get totalLayers() {
        const ret = wasm.worldsolid_totalLayers(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Bytes the bit-packed volume will occupy once Phase 1 allocates it. Exposed now so a host can
     * refuse an unprintable request before paying for it.
     * @returns {number}
     */
    get volumeBytes() {
        const ret = wasm.worldsolid_volumeBytes(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WorldSolid.prototype[Symbol.dispose] = WorldSolid.prototype.free;

/**
 * Engine version for hosts recording a reproducible recipe.
 * @returns {number}
 */
export function solid_engine_version() {
    const ret = wasm.solid_engine_version();
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
        "./hexlife_solid_wasm_bg.js": import0,
    };
}

const WorldSolidFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_worldsolid_free(ptr, 1));

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
        module_or_path = new URL('hexlife_solid_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

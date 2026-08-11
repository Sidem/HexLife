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
     * Cull every face shared with a kept solid voxel and emit the rest as an indexed mesh.
     *
     * A lateral face becomes one quad (two triangles); a cap becomes a four-triangle fan — a
     * six-triangle centre fan would cost 50% more for nothing, and caps are a minority of the
     * surface in any tall extrusion.
     * @param {number} merge
     */
    buildMesh(merge) {
        const ret = wasm.worldsolid_buildMesh(this.__wbg_ptr, merge);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Triangles belonging to a top or bottom cap. Caps are the one thing greedy merging leaves
     * alone (§5.5), so this is the measurement that decides whether an ear clipper is ever worth
     * writing — the answer is "only if this dominates the total".
     * @returns {number}
     */
    get capTriangleCount() {
        const ret = wasm.worldsolid_capTriangleCount(this.__wbg_ptr);
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
     * Components found in the welded volume, before the retention policy.
     * @returns {number}
     */
    get componentCount() {
        const ret = wasm.worldsolid_componentCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get droppedVoxels() {
        const ret = wasm.worldsolid_droppedVoxels(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Weld the volume, label components, apply the retention policy, and report what happened.
     *
     * A slicer will not join separate bodies — it will happily print forty loose fragments — so
     * the report exists to tell the user which case they are in *before* they find out on the
     * build plate.
     * @param {number} keep
     */
    finalizeVolume(keep) {
        const ret = wasm.worldsolid_finalizeVolume(this.__wbg_ptr, keep);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Components that never reach layer 0. Under a vacuum-stable rule with bridge interpolation
     * this is provably zero; anywhere else it is the count of pieces that would print loose.
     * @returns {number}
     */
    get floating() {
        const ret = wasm.worldsolid_floating(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    get isFinalized() {
        const ret = wasm.worldsolid_isFinalized(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Components that survived the policy. One means the object prints as a single piece.
     * @returns {number}
     */
    get keptComponents() {
        const ret = wasm.worldsolid_keptComponents(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get keptVoxels() {
        const ret = wasm.worldsolid_keptVoxels(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Pointer to the staging layer. JS builds one `Uint8Array` over this and reuses it forever.
     * @returns {number}
     */
    layerPtr() {
        const ret = wasm.worldsolid_layerPtr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get meshLen() {
        const ret = wasm.worldsolid_meshLen(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    meshPtr() {
        const ret = wasm.worldsolid_meshPtr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The linear index of `cell`'s neighbor in canonical `direction` 0..5, or `-1` where that
     * direction leaves the grid.
     *
     * This is the table lateral faces are culled against and components are grown over, exposed so
     * a host can pin the mesh's adjacency against `neighbor-dirs.json` rather than trusting a
     * second derivation of the hex geometry. Bounded and O(1) — never a data path.
     * @param {number} cell
     * @param {number} direction
     * @returns {number}
     */
    neighborOf(cell, direction) {
        const ret = wasm.worldsolid_neighborOf(this.__wbg_ptr, cell, direction);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * Validate the geometry and allocate every buffer.
     *
     * Everything is allocated here, up front: growing the isolated linear memory after JavaScript
     * has built a view into it detaches that view, and the whole point of the one-`set`-per-layer
     * ingestion path is that the view is built exactly once.
     * @param {number} rows
     * @param {number} columns
     * @param {number} ticks
     * @param {number} sub_layers
     * @param {number} base_plate
     * @param {number} solid_states
     * @param {number} interpolate
     */
    constructor(rows, columns, ticks, sub_layers, base_plate, solid_states, interpolate) {
        const ret = wasm.worldsolid_new(rows, columns, ticks, sub_layers, base_plate, solid_states, interpolate);
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
     * Ingest the staging layer as tick `pushedLayers`.
     *
     * Applies the `solidStates` mask while bit-packing — one pass, no intermediate — and, from the
     * second tick on, fills the interpolation layers that sit between this layer and the previous
     * one now that both endpoints are known.
     */
    pushLayer() {
        const ret = wasm.worldsolid_pushLayer(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    get pushedLayers() {
        const ret = wasm.worldsolid_pushedLayers(this.__wbg_ptr);
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
     * Serialize the built mesh. `cell_size` is the hexagon circumradius in millimetres and
     * `layer_height` the thickness of one layer; they are independent so the Z aspect ratio is a
     * print decision rather than a tick-count accident.
     *
     * Writes into a Wasm buffer and leaves it addressable through `meshPtr`/`meshLen`. JavaScript
     * never formats a triangle.
     * @param {number} format
     * @param {number} cell_size
     * @param {number} layer_height
     */
    serializeMesh(format, cell_size, layer_height) {
        const ret = wasm.worldsolid_serializeMesh(this.__wbg_ptr, format, cell_size, layer_height);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
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
     * @returns {number}
     */
    get triangleCount() {
        const ret = wasm.worldsolid_triangleCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get vertexCount() {
        const ret = wasm.worldsolid_vertexCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Bytes the bit-packed volume occupies.
     * @returns {number}
     */
    get volumeBytes() {
        const ret = wasm.worldsolid_volumeBytes(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * FNV-1a over the packed volume. The mesh must be a pure function of its inputs, and this is
     * the cheapest way for a test to hold the first half of that promise.
     * @returns {number}
     */
    volumeChecksum() {
        const ret = wasm.worldsolid_volumeChecksum(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Whether the voxel at `(cell, layer)` is solid. Bounded accessor for tests and hosts that
     * want to inspect a fixture; the pipeline never reads the volume one voxel at a time from JS.
     * @param {number} cell
     * @param {number} layer
     * @returns {boolean}
     */
    voxelAt(cell, layer) {
        const ret = wasm.worldsolid_voxelAt(this.__wbg_ptr, cell, layer);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Members of the container the last `serializeMesh` produced, or 0 for a single-file format.
     *
     * This is how JavaScript learns that it is holding a 3MF and must wrap the parts in a zip:
     * Rust emits every byte and every checksum, and JS contributes only the deflate — which is
     * native, not a loop — and about ninety bytes of header per entry.
     * @returns {number}
     */
    get zipPartCount() {
        const ret = wasm.worldsolid_zipPartCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * CRC-32 of the part's UNCOMPRESSED bytes, which is what a zip entry header records.
     * @param {number} index
     * @returns {number}
     */
    zipPartCrc32(index) {
        const ret = wasm.worldsolid_zipPartCrc32(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {number} index
     * @returns {number}
     */
    zipPartLength(index) {
        const ret = wasm.worldsolid_zipPartLength(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {number} index
     * @returns {string}
     */
    zipPartName(index) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.worldsolid_zipPartName(this.__wbg_ptr, index);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Byte offset of part `index` within `meshPtr`.
     * @param {number} index
     * @returns {number}
     */
    zipPartOffset(index) {
        const ret = wasm.worldsolid_zipPartOffset(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
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

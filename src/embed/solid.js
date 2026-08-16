/**
 * `@hexlife/embed/solid` — the solid extrusion engine: a run of any HexLife engine, extruded
 * through time into a printable solid.
 *
 * This module is intentionally the ONLY package entry that imports the solid Wasm artifact. The
 * root, `/sim`, `/ca`, and `/stochastic` entries load their own artifacts and never this one; a
 * page that embeds a world pays nothing for a mesher it does not call.
 *
 * DOM-free, like `/sim` and `/ca`: it works in Node and in workers.
 *
 * The engine simulates nothing. A host runs whichever engine it likes and hands over one layer of
 * cell states per tick; the stack welds the accumulated layers, finds components, meshes the
 * surface, and serializes the bytes. Every per-voxel loop lives in Rust — the only data movement
 * JavaScript performs is one bulk `TypedArray.prototype.set` per layer.
 *
 * The published contract for this entry point lives in `packages/hexlife-embed/README.md`.
 */

import {
    initSync,
    solid_engine_version as wasmSolidEngineVersion,
    WorldSolid,
} from '../core/solid-wasm/hexlife_solid_wasm.js';
// eslint-disable-next-line import/no-unresolved
import wasmUrl from '../core/solid-wasm/hexlife_solid_wasm_bg.wasm?url';

const DATA_URI_RE = /^data:[^,]*;base64,(.*)$/s;

/**
 * Interpolation between consecutive ingested layers.
 *
 * `bridge` is the default and the reason the feature works at all: it converts diagonal
 * space-time edge contact — two prisms meeting along a single zero-thickness hinge — into real
 * face contact, without the fattening that `union` causes.
 */
export const INTERPOLATE_NONE = 'none';
export const INTERPOLATE_BRIDGE = 'bridge';
export const INTERPOLATE_UNION = 'union';

// Wire tags. The strings are the API; these are what crosses into Rust.
const INTERPOLATE_TAGS = {
    [INTERPOLATE_NONE]: 0,
    [INTERPOLATE_BRIDGE]: 1,
    [INTERPOLATE_UNION]: 2,
};

/** Which components survive `finalize()`. */
export const KEEP_ALL = 'all';
export const KEEP_LARGEST = 'largest';
export const KEEP_PLATE_CONNECTED = 'plate-connected';

const KEEP_TAGS = {[KEEP_ALL]: 0, [KEEP_LARGEST]: 1, [KEEP_PLATE_CONNECTED]: 2};

/** Serialized mesh formats. */
export const FORMAT_STL = 'stl';
export const FORMAT_PLY = 'ply';
export const FORMAT_3MF = '3mf';

const FORMAT_TAGS = {[FORMAT_STL]: 0, [FORMAT_PLY]: 1, [FORMAT_3MF]: 2};

/**
 * Quad merging. `greedy` collapses runs of coplanar exposed faces into single quads, which is
 * where most of the triangle budget goes; `none` is the setting to reach for when a strict
 * manifold validator objects to the T-junctions merging necessarily creates.
 *
 * `none` is a first-class setting, not a debug flag. Both meshes bound exactly the same solid —
 * the engine proves it by comparing their surface areas and enclosed volumes exactly — but merging
 * leaves T-junctions where one wall's run ends partway along its neighbour's. Slicers intersect
 * planes and never notice. Strict manifold validators do, and `none` is the answer for them.
 */
export const MERGE_NONE = 'none';
export const MERGE_GREEDY = 'greedy';

const MERGE_TAGS = {[MERGE_NONE]: 0, [MERGE_GREEDY]: 1};

/** Solid-state mask for a binary world: state 1 is matter, state 0 is void. */
export const SOLID_STATES_BINARY = 0b10;

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

/** Initialize only the solid Wasm artifact. Concurrent calls share one promise. */
export async function initSolidEngine() {
    if (wasmExports) return;
    if (!initPromise) {
        initPromise = (async () => {
            const bytes = await loadWasmBytes(wasmUrl);
            wasmExports = initSync({module: await WebAssembly.compile(bytes)});
        })();
    }
    await initPromise;
}

/**
 * Version of the volume layout, mesh, and serialized bytes. Record it alongside the option block
 * and an object is reproducible exactly: the export is a pure function of its inputs.
 */
export function solidEngineVersion() {
    if (!wasmExports) {
        throw new Error('solidEngineVersion: await initSolidEngine() first.');
    }
    return wasmSolidEngineVersion();
}

/**
 * Bytes of linear memory the solid artifact currently holds.
 *
 * Wasm memory grows and never shrinks, so after a run this is the run's peak — which is the number
 * §8's memory budget is written against, and the only honest way to check it. It counts this
 * artifact alone: the simulating engine a host is driving has its own, separate memory.
 */
export function solidMemoryBytes() {
    if (!wasmExports) {
        throw new Error('solidMemoryBytes: await initSolidEngine() first.');
    }
    return wasmExports.memory.buffer.byteLength;
}

/** @param {unknown} value @param {string} label @param {number} fallback */
function toCount(value, label, fallback) {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || /** @type {number} */ (value) < 0) {
        throw new RangeError(`createSolidStack: ${label} must be a non-negative integer.`);
    }
    return /** @type {number} */ (value);
}

/**
 * A stack under construction: geometry fixed, layers accumulating.
 *
 * Held by JavaScript only as a handle. Every buffer sized by the geometry lives in the isolated
 * Wasm memory and is allocated once at construction, because growing that memory would detach the
 * layer view the ingestion loop reuses.
 */
export class SolidStack {
    /** @param {any} options */
    constructor(options) {
        const {
            rows,
            cols,
            ticks,
            solidStates = SOLID_STATES_BINARY,
            interpolate = INTERPOLATE_BRIDGE,
            subLayers = 1,
            basePlate = 0,
        } = options ?? {};

        if (!(interpolate in INTERPOLATE_TAGS)) {
            throw new RangeError(
                `createSolidStack: interpolate must be one of ${Object.keys(INTERPOLATE_TAGS).join(', ')}.`,
            );
        }
        if (!Number.isInteger(solidStates) || solidStates < 0 || solidStates > 0xFFFF_FFFF) {
            throw new RangeError('createSolidStack: solidStates must be a 32-bit state mask.');
        }

        // `none` means no synthesized layers, whatever `subLayers` says. Otherwise a caller who
        // switched interpolation off would silently keep paying for duplicated layers.
        const effectiveSubLayers =
            interpolate === INTERPOLATE_NONE ? 0 : toCount(subLayers, 'subLayers', 1);

        this.interpolate = interpolate;
        this.subLayers = effectiveSubLayers;

        /** @type {Uint8Array | null} */
        this._layerView = null;

        // Allocating this stack may grow the isolated linear memory, which detaches every view an
        // earlier stack handed out. Refresh all of them only if the buffer actually changed.
        const previousBuffer = wasmExports.memory.buffer;
        this._world = new WorldSolid(
            toCount(rows, 'rows', 0),
            toCount(cols, 'cols', 0),
            toCount(ticks, 'ticks', 0),
            effectiveSubLayers,
            toCount(basePlate, 'basePlate', 0),
            solidStates,
            INTERPOLATE_TAGS[interpolate],
        );
        liveStacks.add(this);
        if (wasmExports.memory.buffer !== previousBuffer) refreshAllViews();
        else this._refreshViews();
    }

    /** @returns {any} */
    _live() {
        if (!this._world) throw new Error('SolidStack: this stack has been freed.');
        return this._world;
    }

    _refreshViews() {
        if (this._world && this._layerView) {
            this._layerView = new Uint8Array(
                wasmExports.memory.buffer,
                this._world.layerPtr(),
                this._world.numCells,
            );
        }
    }

    get rows() {
        return this._live().rows;
    }

    get cols() {
        return this._live().columns;
    }

    get numCells() {
        return this._live().numCells;
    }

    get ticks() {
        return this._live().ticks;
    }

    get basePlate() {
        return this._live().basePlate;
    }

    get solidStates() {
        return this._live().solidStates;
    }

    /** Height of the finished volume in layers, base plate included. */
    get totalLayers() {
        return this._live().totalLayers;
    }

    /** Bytes the bit-packed volume occupies. Check it before committing to a large run. */
    get volumeBytes() {
        return this._live().volumeBytes;
    }

    /** Layers ingested so far. */
    get pushedLayers() {
        return this._live().pushedLayers;
    }

    get isFinalized() {
        return this._live().isFinalized;
    }

    /**
     * The staging layer, as a view straight into the isolated Wasm memory.
     *
     * Build it ONCE, outside the tick loop, and reuse it:
     *
     * ```js
     * const layer = stack.layerView();
     * for (let t = 0; t < ticks; t++) { world.tick(); layer.set(world.state); stack.pushLayer(); }
     * ```
     *
     * That `set` is one memcpy and it is the only data movement JavaScript is permitted anywhere in
     * this pipeline. A `for` loop copying cells is a defect even though it runs only once per tick.
     * Prefer the engine's live `state` view over `snapshotCells()`, which allocates a copy per tick
     * for no benefit here.
     */
    layerView() {
        const world = this._live();
        if (!this._layerView || this._layerView.buffer !== wasmExports.memory.buffer) {
            this._layerView = new Uint8Array(
                wasmExports.memory.buffer,
                world.layerPtr(),
                world.numCells,
            );
        }
        return this._layerView;
    }

    /**
     * Ingest the staging layer as the next tick, applying the `solidStates` mask and bit-packing in
     * one pass. From the second tick on it also fills the interpolation layers below it, now that
     * both endpoints of the bridge are known.
     */
    pushLayer() {
        this._live().pushLayer();
    }

    /**
     * Weld the volume, label components, apply the retention policy, and report what happened.
     *
     * A slicer will not join separate bodies — it will happily print forty loose fragments — so
     * read the report before exporting. `keptComponents === 1` is "this prints as one piece".
     *
     * @param {{keepComponents?: string}} [options]
     */
    finalize(options = {}) {
        const keep = options.keepComponents ?? KEEP_ALL;
        if (!(keep in KEEP_TAGS)) {
            throw new RangeError(
                `finalize: keepComponents must be one of ${Object.keys(KEEP_TAGS).join(', ')}.`,
            );
        }
        const world = this._live();
        world.finalizeVolume(KEEP_TAGS[keep]);
        return {
            componentCount: world.componentCount,
            keptComponents: world.keptComponents,
            keptVoxels: world.keptVoxels,
            droppedVoxels: world.droppedVoxels,
            floating: world.floating,
        };
    }

    /**
     * The linear index of `cell`'s neighbor in canonical `direction` 0..5, or `-1` where that
     * direction leaves the grid.
     *
     * This is the very table lateral faces are culled against and components are grown over, so a
     * host can pin the mesh's adjacency against `neighbor-dirs.json` rather than trusting a second
     * derivation of the hex geometry. Bounded accessor, not a data path.
     *
     * Note the `-1`: the printed object has an OPEN boundary even though the simulation is
     * toroidal. Two pieces touching only across the seam are two pieces.
     *
     * @param {number} cell @param {number} direction
     */
    neighborOf(cell, direction) {
        return this._live().neighborOf(cell, direction);
    }

    /**
     * Whether the voxel at `(cell, layer)` is solid. For inspecting a fixture — the pipeline never
     * reads the volume one voxel at a time.
     *
     * @param {number} cell @param {number} layer
     */
    voxelAt(cell, layer) {
        return this._live().voxelAt(cell, layer);
    }

    /** FNV-1a over the packed volume: the cheap half of the determinism promise. */
    volumeChecksum() {
        return this._live().volumeChecksum();
    }

    /** Triangles in the last built mesh. */
    get triangleCount() {
        return this._live().triangleCount;
    }

    /** Welded vertices in the last built mesh. */
    get vertexCount() {
        return this._live().vertexCount;
    }

    /**
     * Triangles in the last built mesh that belong to a top or bottom cap.
     *
     * Greedy merging welds lateral walls and leaves caps alone, so this is what says whether cap
     * merging would be worth anything on a given object. On a tall extrusion it is a rounding
     * error; on a wide, short one it is the whole mesh.
     */
    get capTriangleCount() {
        return this._live().capTriangleCount;
    }

    /**
     * Mesh the finalized volume and serialize it.
     *
     * `cellSize` is the hexagon circumradius in millimetres and `layerHeight` the thickness of one
     * layer. They are independent on purpose: the Z aspect ratio of the object is a print decision,
     * not an accident of how many ticks were run.
     *
     * Async because the 3MF container is deflated by `CompressionStream` — the one piece of this
     * pipeline JavaScript owns, and only because it is not a per-voxel loop.
     *
     * @param {{format?: string, cellSize?: number, layerHeight?: number, merge?: string}} [options]
     * @returns {Promise<Uint8Array>}
     */
    async export(options = {}) {
        const {
            format = FORMAT_STL,
            cellSize = 2,
            layerHeight = 0.8,
            merge = MERGE_GREEDY,
        } = options;
        if (!(format in FORMAT_TAGS)) {
            throw new RangeError(
                `export: format must be one of ${Object.keys(FORMAT_TAGS).join(', ')}.`,
            );
        }
        if (!(merge in MERGE_TAGS)) {
            throw new RangeError(`export: merge must be one of ${Object.keys(MERGE_TAGS).join(', ')}.`);
        }
        const world = this._live();
        const previousBuffer = wasmExports.memory.buffer;
        world.buildMesh(MERGE_TAGS[merge]);
        world.serializeMesh(FORMAT_TAGS[format], cellSize, layerHeight);
        // Serialization allocates, so the memory may have grown and every view into it is stale.
        // Re-view here, and refresh the layer views the caller may still be holding.
        if (wasmExports.memory.buffer !== previousBuffer) refreshAllViews();

        const parts = world.zipPartCount;
        if (parts === 0) {
            const bytes = new Uint8Array(wasmExports.memory.buffer, world.meshPtr(), world.meshLen);
            // Copy out: the Blob must outlive the next export, which will overwrite this buffer.
            return bytes.slice();
        }

        // A container format. Rust produced every payload byte and every checksum; all that is left
        // is the deflate — native, and not a per-voxel loop — and the zip envelope.
        const entries = [];
        for (let index = 0; index < parts; index++) {
            const offset = world.zipPartOffset(index);
            const length = world.zipPartLength(index);
            const payload = new Uint8Array(
                wasmExports.memory.buffer,
                world.meshPtr() + offset,
                length,
            ).slice();
            entries.push({
                name: world.zipPartName(index),
                crc32: world.zipPartCrc32(index),
                size: length,
                deflated: await deflateRaw(payload),
            });
        }
        return buildZip(entries);
    }

    /**
     * Release the isolated Wasm buffers. Mandatory — the same leak as `EmbedSim.free()`: the
     * stack's volume is the largest allocation in the artifact and nothing else reclaims it.
     */
    free() {
        if (this._world) {
            liveStacks.delete(this);
            this._layerView = null;
            this._world.free();
            this._world = null;
        }
    }
}

/** @type {string | null} */
let deflateFormat = null;

/**
 * Raw DEFLATE, the compression method a zip entry declares.
 *
 * `deflate-raw` is the direct answer and is what every current browser has. Where it is missing —
 * Node before 20.11, Safari before 16.4 — `deflate` produces the same stream wrapped in zlib's
 * 2-byte header and 4-byte Adler-32 trailer, so trimming those recovers it exactly. That is a
 * constant-size slice, not a re-encode.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
async function deflateRaw(bytes) {
    if (!deflateFormat) {
        try {
            void new CompressionStream('deflate-raw');
            deflateFormat = 'deflate-raw';
        } catch {
            deflateFormat = 'deflate';
        }
    }
    const stream = new CompressionStream(deflateFormat);
    const writer = stream.writable.getWriter();
    // Write and read concurrently: awaiting the write first deadlocks on backpressure as soon as
    // the payload is larger than the stream's queue, which a real model always is.
    const written = writer.write(bytes).then(() => writer.close());
    const out = new Uint8Array(await new Response(stream.readable).arrayBuffer());
    await written;
    return deflateFormat === 'deflate' ? out.subarray(2, out.length - 4) : out;
}

const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_DEFLATED = 8;
/** 1980-01-01, the epoch of the MS-DOS timestamp a zip header carries. A fixed date keeps the
 *  container reproducible; a real clock would make every export differ from the last. */
const ZIP_DOS_DATE = 0x0021;

/**
 * Assemble deflated parts into a zip container.
 *
 * The only JavaScript byte-writing in this pipeline, and it is bounded: thirty bytes of local
 * header plus forty-six of central directory per entry, of which there are three.
 *
 * @param {Array<{name: string, crc32: number, size: number, deflated: Uint8Array}>} entries
 */
function buildZip(entries) {
    const encoder = new TextEncoder();
    const named = entries.map((entry) => ({...entry, path: encoder.encode(entry.name)}));

    let total = 22;
    for (const entry of named) {
        total += 30 + entry.path.length + entry.deflated.length + 46 + entry.path.length;
    }

    const zip = new Uint8Array(total);
    const view = new DataView(zip.buffer);
    let at = 0;
    const offsets = [];

    for (const entry of named) {
        offsets.push(at);
        view.setUint32(at, ZIP_LOCAL_SIGNATURE, true);
        view.setUint16(at + 4, 20, true);
        view.setUint16(at + 6, 0, true);
        view.setUint16(at + 8, ZIP_DEFLATED, true);
        view.setUint16(at + 10, 0, true);
        view.setUint16(at + 12, ZIP_DOS_DATE, true);
        view.setUint32(at + 14, entry.crc32, true);
        view.setUint32(at + 18, entry.deflated.length, true);
        view.setUint32(at + 22, entry.size, true);
        view.setUint16(at + 26, entry.path.length, true);
        view.setUint16(at + 28, 0, true);
        zip.set(entry.path, at + 30);
        at += 30 + entry.path.length;
        zip.set(entry.deflated, at);
        at += entry.deflated.length;
    }

    const centralStart = at;
    for (let index = 0; index < named.length; index++) {
        const entry = named[index];
        view.setUint32(at, ZIP_CENTRAL_SIGNATURE, true);
        view.setUint16(at + 4, 20, true);
        view.setUint16(at + 6, 20, true);
        view.setUint16(at + 8, 0, true);
        view.setUint16(at + 10, ZIP_DEFLATED, true);
        view.setUint16(at + 12, 0, true);
        view.setUint16(at + 14, ZIP_DOS_DATE, true);
        view.setUint32(at + 16, entry.crc32, true);
        view.setUint32(at + 20, entry.deflated.length, true);
        view.setUint32(at + 24, entry.size, true);
        view.setUint16(at + 28, entry.path.length, true);
        view.setUint32(at + 42, offsets[index], true);
        zip.set(entry.path, at + 46);
        at += 46 + entry.path.length;
    }

    view.setUint32(at, ZIP_END_SIGNATURE, true);
    view.setUint16(at + 8, named.length, true);
    view.setUint16(at + 10, named.length, true);
    view.setUint32(at + 12, at - centralStart, true);
    view.setUint32(at + 16, centralStart, true);
    return zip;
}

/** @type {Set<SolidStack>} */
const liveStacks = new Set();

function refreshAllViews() {
    for (const stack of liveStacks) stack._refreshViews();
}

/**
 * Create a stack for a run of `ticks` ticks over a `rows × cols` grid.
 *
 * `basePlate` is a construction option rather than a `finalize()` one because it adds layers to
 * the volume, and the volume is allocated exactly once (§5.1): the layer view a host builds must
 * stay valid for every tick.
 *
 * @param {{rows: number, cols: number, ticks: number, solidStates?: number,
 *          interpolate?: string, subLayers?: number, basePlate?: number}} options
 */
export function createSolidStack(options) {
    if (!wasmExports) {
        throw new Error('createSolidStack: await initSolidEngine() first.');
    }
    return new SolidStack(options);
}

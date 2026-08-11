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
 * Phase 0 (artifact isolation) ships the loader, the geometry contract, and the handle. Ingestion,
 * interpolation, components, meshing, and export arrive in later phases.
 */

import init, {
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
            wasmExports = await init({module_or_path: bytes});
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
        // EARLIER stack handed out. Refresh them before this one is even usable.
        this._world = new WorldSolid(
            toCount(rows, 'rows', 0),
            toCount(cols, 'cols', 0),
            toCount(ticks, 'ticks', 0),
            effectiveSubLayers,
            toCount(basePlate, 'basePlate', 0),
            solidStates,
            INTERPOLATE_TAGS[interpolate],
        );
        refreshAllViews();
        liveStacks.add(this);
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

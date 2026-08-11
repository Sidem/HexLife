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

const INTERPOLATE_MODES = [INTERPOLATE_NONE, INTERPOLATE_BRIDGE, INTERPOLATE_UNION];

/** Which components survive `finalize()`. */
export const KEEP_ALL = 'all';
export const KEEP_LARGEST = 'largest';
export const KEEP_PLATE_CONNECTED = 'plate-connected';

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

        if (!INTERPOLATE_MODES.includes(interpolate)) {
            throw new RangeError(
                `createSolidStack: interpolate must be one of ${INTERPOLATE_MODES.join(', ')}.`,
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

        this._world = new WorldSolid(
            toCount(rows, 'rows', 0),
            toCount(cols, 'cols', 0),
            toCount(ticks, 'ticks', 0),
            effectiveSubLayers,
            toCount(basePlate, 'basePlate', 0),
            solidStates,
        );
    }

    /** @returns {any} */
    _live() {
        if (!this._world) throw new Error('SolidStack: this stack has been freed.');
        return this._world;
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

    /**
     * The linear index of `cell`'s neighbor in canonical `direction` 0..5 — the very table the
     * lateral faces are culled against, so a host can pin the mesh's adjacency against
     * `neighbor-dirs.json` rather than trusting a second derivation of the hex geometry.
     *
     * A bounded geometry accessor, not a data path: layers cross the boundary in one bulk copy.
     *
     * @param {number} cell @param {number} direction
     */
    neighborOf(cell, direction) {
        return this._live().neighborOf(cell, direction);
    }

    /**
     * Release the isolated Wasm buffers. Mandatory — the same leak as `EmbedSim.free()`: the
     * stack's volume is the largest allocation in the artifact and nothing else reclaims it.
     */
    free() {
        if (this._world) {
            this._world.free();
            this._world = null;
        }
    }
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

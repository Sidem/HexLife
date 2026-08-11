/* tslint:disable */
/* eslint-disable */

export class WorldSolid {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Cull every face shared with a kept solid voxel and emit the rest as an indexed mesh.
     *
     * A lateral face becomes one quad (two triangles); a cap becomes a four-triangle fan — a
     * six-triangle centre fan would cost 50% more for nothing, and caps are a minority of the
     * surface in any tall extrusion.
     */
    buildMesh(merge: number): void;
    /**
     * Weld the volume, label components, apply the retention policy, and report what happened.
     *
     * A slicer will not join separate bodies — it will happily print forty loose fragments — so
     * the report exists to tell the user which case they are in *before* they find out on the
     * build plate.
     */
    finalizeVolume(keep: number): void;
    /**
     * Pointer to the staging layer. JS builds one `Uint8Array` over this and reuses it forever.
     */
    layerPtr(): number;
    meshPtr(): number;
    /**
     * The linear index of `cell`'s neighbor in canonical `direction` 0..5, or `-1` where that
     * direction leaves the grid.
     *
     * This is the table lateral faces are culled against and components are grown over, exposed so
     * a host can pin the mesh's adjacency against `neighbor-dirs.json` rather than trusting a
     * second derivation of the hex geometry. Bounded and O(1) — never a data path.
     */
    neighborOf(cell: number, direction: number): number;
    /**
     * Validate the geometry and allocate every buffer.
     *
     * Everything is allocated here, up front: growing the isolated linear memory after JavaScript
     * has built a view into it detaches that view, and the whole point of the one-`set`-per-layer
     * ingestion path is that the view is built exactly once.
     */
    constructor(rows: number, columns: number, ticks: number, sub_layers: number, base_plate: number, solid_states: number, interpolate: number);
    /**
     * Ingest the staging layer as tick `pushedLayers`.
     *
     * Applies the `solidStates` mask while bit-packing — one pass, no intermediate — and, from the
     * second tick on, fills the interpolation layers that sit between this layer and the previous
     * one now that both endpoints are known.
     */
    pushLayer(): void;
    /**
     * Serialize the built mesh. `cell_size` is the hexagon circumradius in millimetres and
     * `layer_height` the thickness of one layer; they are independent so the Z aspect ratio is a
     * print decision rather than a tick-count accident.
     *
     * Writes into a Wasm buffer and leaves it addressable through `meshPtr`/`meshLen`. JavaScript
     * never formats a triangle.
     */
    serializeMesh(format: number, cell_size: number, layer_height: number): void;
    /**
     * FNV-1a over the packed volume. The mesh must be a pure function of its inputs, and this is
     * the cheapest way for a test to hold the first half of that promise.
     */
    volumeChecksum(): number;
    /**
     * Whether the voxel at `(cell, layer)` is solid. Bounded accessor for tests and hosts that
     * want to inspect a fixture; the pipeline never reads the volume one voxel at a time from JS.
     */
    voxelAt(cell: number, layer: number): boolean;
    /**
     * CRC-32 of the part's UNCOMPRESSED bytes, which is what a zip entry header records.
     */
    zipPartCrc32(index: number): number;
    zipPartLength(index: number): number;
    zipPartName(index: number): string;
    /**
     * Byte offset of part `index` within `meshPtr`.
     */
    zipPartOffset(index: number): number;
    readonly basePlate: number;
    /**
     * Triangles belonging to a top or bottom cap. Caps are the one thing greedy merging leaves
     * alone (§5.5), so this is the measurement that decides whether an ear clipper is ever worth
     * writing — the answer is "only if this dominates the total".
     */
    readonly capTriangleCount: number;
    readonly columns: number;
    /**
     * Components found in the welded volume, before the retention policy.
     */
    readonly componentCount: number;
    readonly droppedVoxels: number;
    /**
     * Components that never reach layer 0. Under a vacuum-stable rule with bridge interpolation
     * this is provably zero; anywhere else it is the count of pieces that would print loose.
     */
    readonly floating: number;
    readonly isFinalized: boolean;
    /**
     * Components that survived the policy. One means the object prints as a single piece.
     */
    readonly keptComponents: number;
    readonly keptVoxels: number;
    readonly meshLen: number;
    readonly numCells: number;
    readonly pushedLayers: number;
    readonly rows: number;
    readonly solidStates: number;
    readonly subLayers: number;
    readonly ticks: number;
    /**
     * Height of the finished volume in layers, base plate included.
     */
    readonly totalLayers: number;
    readonly triangleCount: number;
    readonly vertexCount: number;
    /**
     * Bytes the bit-packed volume occupies.
     */
    readonly volumeBytes: number;
    /**
     * Members of the container the last `serializeMesh` produced, or 0 for a single-file format.
     *
     * This is how JavaScript learns that it is holding a 3MF and must wrap the parts in a zip:
     * Rust emits every byte and every checksum, and JS contributes only the deflate — which is
     * native, not a loop — and about ninety bytes of header per entry.
     */
    readonly zipPartCount: number;
}

/**
 * Engine version for hosts recording a reproducible recipe.
 */
export function solid_engine_version(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_worldsolid_free: (a: number, b: number) => void;
    readonly worldsolid_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly worldsolid_layerPtr: (a: number) => number;
    readonly worldsolid_pushLayer: (a: number) => [number, number];
    readonly worldsolid_finalizeVolume: (a: number, b: number) => [number, number];
    readonly worldsolid_rows: (a: number) => number;
    readonly worldsolid_columns: (a: number) => number;
    readonly worldsolid_numCells: (a: number) => number;
    readonly worldsolid_ticks: (a: number) => number;
    readonly worldsolid_subLayers: (a: number) => number;
    readonly worldsolid_basePlate: (a: number) => number;
    readonly worldsolid_solidStates: (a: number) => number;
    readonly worldsolid_totalLayers: (a: number) => number;
    readonly worldsolid_volumeBytes: (a: number) => number;
    readonly worldsolid_pushedLayers: (a: number) => number;
    readonly worldsolid_isFinalized: (a: number) => number;
    readonly worldsolid_neighborOf: (a: number, b: number, c: number) => [number, number, number];
    readonly worldsolid_componentCount: (a: number) => number;
    readonly worldsolid_keptComponents: (a: number) => number;
    readonly worldsolid_keptVoxels: (a: number) => number;
    readonly worldsolid_droppedVoxels: (a: number) => number;
    readonly worldsolid_floating: (a: number) => number;
    readonly worldsolid_buildMesh: (a: number, b: number) => [number, number];
    readonly worldsolid_triangleCount: (a: number) => number;
    readonly worldsolid_vertexCount: (a: number) => number;
    readonly worldsolid_serializeMesh: (a: number, b: number, c: number, d: number) => [number, number];
    readonly worldsolid_meshPtr: (a: number) => number;
    readonly worldsolid_meshLen: (a: number) => number;
    readonly worldsolid_capTriangleCount: (a: number) => number;
    readonly worldsolid_zipPartCount: (a: number) => number;
    readonly worldsolid_zipPartName: (a: number, b: number) => [number, number, number, number];
    readonly worldsolid_zipPartOffset: (a: number, b: number) => [number, number, number];
    readonly worldsolid_zipPartLength: (a: number, b: number) => [number, number, number];
    readonly worldsolid_zipPartCrc32: (a: number, b: number) => [number, number, number];
    readonly worldsolid_volumeChecksum: (a: number) => number;
    readonly worldsolid_voxelAt: (a: number, b: number, c: number) => [number, number, number];
    readonly solid_engine_version: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

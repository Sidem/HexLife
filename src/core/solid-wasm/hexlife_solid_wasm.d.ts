/* tslint:disable */
/* eslint-disable */

export class WorldSolid {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The linear index of `cell`'s neighbor in canonical `direction` 0..5 — the same table the
     * lateral faces are culled against.
     *
     * Bounded and O(1): this is a geometry accessor for parity checks, never a data path. Layer
     * data crosses the boundary in exactly one bulk copy per layer (§2), and it does not come
     * through here.
     */
    neighborOf(cell: number, direction: number): number;
    /**
     * Validate the geometry and fix the allocation plan.
     *
     * Every buffer sized from these numbers is allocated up front in later phases: growing the
     * isolated linear memory after JavaScript has built a view into it detaches that view, and the
     * whole point of the one-`set`-per-layer ingestion path is that the view is built once.
     */
    constructor(rows: number, columns: number, ticks: number, sub_layers: number, base_plate: number, solid_states: number);
    readonly basePlate: number;
    readonly columns: number;
    readonly numCells: number;
    readonly rows: number;
    readonly solidStates: number;
    readonly subLayers: number;
    readonly ticks: number;
    /**
     * Height of the finished volume in layers, base plate included.
     */
    readonly totalLayers: number;
    /**
     * Bytes the bit-packed volume will occupy once Phase 1 allocates it. Exposed now so a host can
     * refuse an unprintable request before paying for it.
     */
    readonly volumeBytes: number;
}

/**
 * Engine version for hosts recording a reproducible recipe.
 */
export function solid_engine_version(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_worldsolid_free: (a: number, b: number) => void;
    readonly worldsolid_new: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly worldsolid_rows: (a: number) => number;
    readonly worldsolid_columns: (a: number) => number;
    readonly worldsolid_numCells: (a: number) => number;
    readonly worldsolid_ticks: (a: number) => number;
    readonly worldsolid_subLayers: (a: number) => number;
    readonly worldsolid_basePlate: (a: number) => number;
    readonly worldsolid_solidStates: (a: number) => number;
    readonly worldsolid_totalLayers: (a: number) => number;
    readonly worldsolid_volumeBytes: (a: number) => number;
    readonly worldsolid_neighborOf: (a: number, b: number, c: number) => [number, number, number];
    readonly solid_engine_version: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
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

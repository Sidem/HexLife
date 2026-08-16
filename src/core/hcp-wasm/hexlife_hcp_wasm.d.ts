/* tslint:disable */
/* eslint-disable */

/**
 * A k-state cellular automaton on the hexagonal close-packed lattice.
 */
export class WorldHcp {
    free(): void;
    [Symbol.dispose](): void;
    active_chunk_count(): number;
    backend(): number;
    block_alternates(): boolean;
    census_of(state: number): number;
    census_ptr(): number;
    checksum_state(): number;
    chunk_count(): number;
    /**
     * Zero every cell in `layer` whose state bit is set in `mask`. Counts land in `layer_scratch`.
     */
    clear_states_in_layer(layer: number, mask: number): void;
    cols(): number;
    compute_census(): void;
    fill(value: number): void;
    is_settled(): boolean;
    last_changed_count(): number;
    /**
     * Occupancy of one layer. Counts land in `layer_scratch`.
     */
    layer_census(layer: number): void;
    layer_scratch_ptr(): number;
    layers(): number;
    mark_all_dirty(): void;
    ncells(): number;
    /**
     * Neighbour in `0..12`, or `0xFFFFFFFF` when that bond is missing (open face / wall).
     */
    neighbor_of(cell: number, direction: number): number;
    /**
     * Allocate every buffer to final capacity. Throws rather than silently changing the grid.
     */
    constructor(layers: number, rows: number, cols: number, states: number, stacking: number, xy_boundary: number, z_boundary: number);
    /**
     * Write `to` where current == `from` at the listed in-layer indices. Returns how many wrote.
     */
    paint_if(layer: number, indices: Uint32Array, from: number, to: number): number;
    /**
     * Phase the *next* tick will use, in `0..6`.
     */
    phase(): number;
    rows(): number;
    rule_len(): number;
    /**
     * Advance one generation. Writes in place; no second buffer, no JS copy.
     */
    run_tick(): number;
    /**
     * Advance `count` generations and return the final changed-cell count.
     */
    run_ticks(count: number): number;
    set_block_alternates(alternates: boolean): void;
    /**
     * Install the `k^4` packed-output table. **Allocates** (the slice is copied in from JS).
     */
    set_block_rule(rule: Uint32Array): void;
    /**
     * Set one cell and wake its chunk.
     */
    set_cell(index: number, value: number): void;
    /**
     * Overwrite every cell. **Allocates**. This is the supported bulk write.
     */
    set_cells(cells: Uint8Array): void;
    set_skipping_enabled(enabled: boolean): void;
    /**
     * Restore the partition phase so a decoded world resumes the next tick identically.
     */
    set_tick_count(count: bigint): void;
    skipping_enabled(): boolean;
    stacking(): number;
    state_ptr(): number;
    states(): number;
    tick_count(): bigint;
    xy_boundary(): number;
    z_boundary(): number;
}

/**
 * Layout version hosts can record with a recipe.
 */
export function hcp_engine_version(): number;

/**
 * World-space `(x, y, z)` of one site at circumradius `hex_size`. Same formula as `hcpCoords.js`.
 */
export function hcp_site_xyz(col: number, row: number, layer: number, hex_size: number): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_worldhcp_free: (a: number, b: number) => void;
    readonly worldhcp_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly worldhcp_layers: (a: number) => number;
    readonly worldhcp_rows: (a: number) => number;
    readonly worldhcp_cols: (a: number) => number;
    readonly worldhcp_ncells: (a: number) => number;
    readonly worldhcp_states: (a: number) => number;
    readonly worldhcp_stacking: (a: number) => number;
    readonly worldhcp_xy_boundary: (a: number) => number;
    readonly worldhcp_z_boundary: (a: number) => number;
    readonly worldhcp_rule_len: (a: number) => number;
    readonly worldhcp_backend: (a: number) => number;
    readonly worldhcp_state_ptr: (a: number) => number;
    readonly worldhcp_census_ptr: (a: number) => number;
    readonly worldhcp_layer_scratch_ptr: (a: number) => number;
    readonly worldhcp_set_block_rule: (a: number, b: number, c: number) => [number, number];
    readonly worldhcp_set_cells: (a: number, b: number, c: number) => [number, number];
    readonly worldhcp_set_cell: (a: number, b: number, c: number) => [number, number];
    readonly worldhcp_fill: (a: number, b: number) => [number, number];
    readonly worldhcp_paint_if: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly worldhcp_clear_states_in_layer: (a: number, b: number, c: number) => [number, number];
    readonly worldhcp_layer_census: (a: number, b: number) => [number, number];
    readonly worldhcp_mark_all_dirty: (a: number) => void;
    readonly worldhcp_set_skipping_enabled: (a: number, b: number) => void;
    readonly worldhcp_skipping_enabled: (a: number) => number;
    readonly worldhcp_set_block_alternates: (a: number, b: number) => void;
    readonly worldhcp_block_alternates: (a: number) => number;
    readonly worldhcp_run_tick: (a: number) => number;
    readonly worldhcp_run_ticks: (a: number, b: number) => number;
    readonly worldhcp_tick_count: (a: number) => bigint;
    readonly worldhcp_set_tick_count: (a: number, b: bigint) => void;
    readonly worldhcp_phase: (a: number) => number;
    readonly worldhcp_last_changed_count: (a: number) => number;
    readonly worldhcp_is_settled: (a: number) => number;
    readonly worldhcp_compute_census: (a: number) => void;
    readonly worldhcp_census_of: (a: number, b: number) => number;
    readonly worldhcp_checksum_state: (a: number) => number;
    readonly worldhcp_active_chunk_count: (a: number) => number;
    readonly worldhcp_chunk_count: (a: number) => number;
    readonly worldhcp_neighbor_of: (a: number, b: number, c: number) => [number, number, number];
    readonly hcp_engine_version: () => number;
    readonly hcp_site_xyz: (a: number, b: number, c: number, d: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
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

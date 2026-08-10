/* tslint:disable */
/* eslint-disable */

/**
 * Dense stochastic-neighborhood world. Every per-cell buffer has final capacity at construction;
 * installing a rule may replace only the bounded compiled row table and canonical rule bytes.
 */
export class WorldStochastic {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Chunks recomputed during the last tick, out of [`WorldStochastic::chunk_count`].
     */
    active_chunk_count(): number;
    backend(): number;
    census_ptr(): number;
    channels_ptr(): number;
    /**
     * Hash of everything a code must restore beyond the visible state: epochs for the neighborhood
     * backend, velocity channels and walls for the gas.
     */
    checksum_auxiliary(): number;
    checksum_state(): number;
    chunk_count(): number;
    /**
     * Sites whose incoming configuration was rewritten by the collision table on the last tick.
     */
    collision_count(): number;
    columns(): number;
    compute_elapsed_ages(): void;
    elapsed_ages_ptr(): number;
    generation(): bigint;
    last_changed_count(): number;
    constructor(columns: number, rows: number, seed: bigint);
    /**
     * A lattice-gas world. A separate constructor rather than a runtime switch so neither backend
     * allocates the other's per-cell buffers.
     */
    static new_lattice_gas(columns: number, rows: number, seed: bigint): WorldStochastic;
    next_state_ptr(): number;
    num_cells(): number;
    rebase_epochs(): void;
    reset(): void;
    /**
     * Clamp every stored epoch to at most `u16::MAX` ticks back so the `u32` distance can never
     * approach the half-range. Exact, because [`saturating_age`] already saturates there.
     * Resume the current world at `generation`, preserving every elapsed age exactly.
     *
     * Epochs are absolute generations, so moving the clock means moving them by the same delta â€”
     * otherwise a decoded code would restore the right cells with the wrong ages. The current
     * world also becomes the reset target, which is the `HXS1` capture policy: a code is the exact
     * world it was taken from, and resetting returns to that world rather than to generation zero.
     */
    resume_at_generation(generation: bigint): void;
    rng_sample(cell_index: number, stream_id: number): number;
    rows(): number;
    rule_len(): number;
    rule_ptr(): number;
    /**
     * Advance one generation.
     *
     * The backend is dispatched exactly once, here â€” never inside a per-cell loop. For the
     * neighborhood backend `run_tick_dense` is the reference and the skipping path must agree with
     * it on state, ages, census, transition counts, and both checksums after every tick.
     */
    run_tick(): number;
    seed(): bigint;
    set_cell(index: number, value: number): void;
    /**
     * Intervention-only bulk replacement at the current generation.
     */
    set_cells(cells: Uint8Array, elapsed_ages: Uint16Array): void;
    /**
     * Intervention-only bulk replacement at the current generation.
     */
    set_gas_cells(channels: Uint8Array, walls: Uint8Array): void;
    /**
     * Replace the reset snapshot: six species channels per cell, plus the wall bitmap.
     *
     * Walls hold no particles, so any channel written on a wall site is dropped rather than
     * silently leaking mass on the first tick.
     */
    set_gas_initial_state(channels: Uint8Array, walls: Uint8Array): void;
    /**
     * Install a canonical `HSG1` collision table. Allocation is allowed here; `run_tick` never
     * allocates. The table is rejected unless every reachable entry conserves both species.
     */
    set_gas_rule(bytes: Uint8Array): void;
    /**
     * Replace the reset snapshot and reset the world to generation zero.
     */
    set_initial_state(cells: Uint8Array, elapsed_ages: Uint16Array): void;
    /**
     * Install canonical `HSN1` bytes. Allocation is allowed here; `run_tick` never allocates.
     */
    set_neighborhood_rule(bytes: Uint8Array): void;
    /**
     * Turn exact activity skipping off (or back on). Off forces the dense reference path for every
     * tick; re-enabling wakes the whole grid so the metadata is rebuilt from a computed generation.
     */
    set_skipping_enabled(enabled: boolean): void;
    /**
     * Open or close one lattice site's barrier. This is the whole membrane API: opening a gate
     * edits the native wall buffer only and never replaces the grid.
     */
    set_wall(index: number, is_wall: boolean): void;
    skipping_enabled(): boolean;
    /**
     * Exact particle count for one species: 1 = amber, 2 = cyan. Conserved by every legal table.
     */
    species_count(species: number): number;
    state_ptr(): number;
    states(): number;
    transition_count_len(): number;
    transition_counts_ptr(): number;
    walls_ptr(): number;
}

/**
 * Whether `bytes` is a well-formed `HSG1` table that conserves both species everywhere.
 */
export function is_conservative_gas_rule(bytes: Uint8Array): boolean;

/**
 * Counter-based Philox4x32-10 sample for one stochastic decision: word 0 of the block above.
 */
export function random_u32(seed: bigint, generation: bigint, cell_index: number, stream_id: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly random_u32: (a: bigint, b: bigint, c: number, d: number) => number;
    readonly __wbg_worldstochastic_free: (a: number, b: number) => void;
    readonly worldstochastic_new: (a: number, b: number, c: bigint) => [number, number, number];
    readonly worldstochastic_new_lattice_gas: (a: number, b: number, c: bigint) => [number, number, number];
    readonly worldstochastic_backend: (a: number) => number;
    readonly worldstochastic_rows: (a: number) => number;
    readonly worldstochastic_columns: (a: number) => number;
    readonly worldstochastic_num_cells: (a: number) => number;
    readonly worldstochastic_states: (a: number) => number;
    readonly worldstochastic_seed: (a: number) => bigint;
    readonly worldstochastic_generation: (a: number) => bigint;
    readonly worldstochastic_state_ptr: (a: number) => number;
    readonly worldstochastic_next_state_ptr: (a: number) => number;
    readonly worldstochastic_elapsed_ages_ptr: (a: number) => number;
    readonly worldstochastic_census_ptr: (a: number) => number;
    readonly worldstochastic_transition_counts_ptr: (a: number) => number;
    readonly worldstochastic_transition_count_len: (a: number) => number;
    readonly worldstochastic_rule_ptr: (a: number) => number;
    readonly worldstochastic_rule_len: (a: number) => number;
    readonly worldstochastic_last_changed_count: (a: number) => number;
    readonly worldstochastic_rng_sample: (a: number, b: number, c: number) => [number, number, number];
    readonly worldstochastic_set_neighborhood_rule: (a: number, b: number, c: number) => [number, number];
    readonly worldstochastic_set_initial_state: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly worldstochastic_set_cells: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly worldstochastic_set_cell: (a: number, b: number, c: number) => [number, number];
    readonly worldstochastic_set_gas_rule: (a: number, b: number, c: number) => [number, number];
    readonly worldstochastic_set_gas_initial_state: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly worldstochastic_set_gas_cells: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly worldstochastic_set_wall: (a: number, b: number, c: number) => [number, number];
    readonly worldstochastic_channels_ptr: (a: number) => number;
    readonly worldstochastic_walls_ptr: (a: number) => number;
    readonly worldstochastic_species_count: (a: number, b: number) => number;
    readonly worldstochastic_collision_count: (a: number) => number;
    readonly worldstochastic_reset: (a: number) => [number, number];
    readonly worldstochastic_set_skipping_enabled: (a: number, b: number) => void;
    readonly worldstochastic_skipping_enabled: (a: number) => number;
    readonly worldstochastic_active_chunk_count: (a: number) => number;
    readonly worldstochastic_chunk_count: (a: number) => number;
    readonly worldstochastic_run_tick: (a: number) => [number, number, number];
    readonly worldstochastic_resume_at_generation: (a: number, b: bigint) => void;
    readonly worldstochastic_rebase_epochs: (a: number) => void;
    readonly worldstochastic_compute_elapsed_ages: (a: number) => void;
    readonly worldstochastic_checksum_state: (a: number) => number;
    readonly worldstochastic_checksum_auxiliary: (a: number) => number;
    readonly is_conservative_gas_rule: (a: number, b: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
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

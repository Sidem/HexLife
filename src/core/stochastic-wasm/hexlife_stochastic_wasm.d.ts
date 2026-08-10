/* tslint:disable */
/* eslint-disable */

/**
 * Dense stochastic-neighborhood world. Every per-cell buffer has final capacity at construction;
 * installing a rule may replace only the bounded compiled row table and canonical rule bytes.
 */
export class WorldStochastic {
    free(): void;
    [Symbol.dispose](): void;
    census_ptr(): number;
    checksum_auxiliary(): number;
    checksum_state(): number;
    columns(): number;
    compute_elapsed_ages(): void;
    elapsed_ages_ptr(): number;
    generation(): bigint;
    last_changed_count(): number;
    constructor(columns: number, rows: number, seed: bigint);
    next_state_ptr(): number;
    num_cells(): number;
    reset(): void;
    rng_sample(cell_index: number, stream_id: number): number;
    rows(): number;
    rule_len(): number;
    rule_ptr(): number;
    /**
     * Advance one dense generation. Phase 3 adds temporal activity skipping around this reference.
     */
    run_tick(): number;
    seed(): bigint;
    set_cell(index: number, value: number): void;
    /**
     * Intervention-only bulk replacement at the current generation.
     */
    set_cells(cells: Uint8Array, elapsed_ages: Uint16Array): void;
    /**
     * Replace the reset snapshot and reset the world to generation zero.
     */
    set_initial_state(cells: Uint8Array, elapsed_ages: Uint16Array): void;
    /**
     * Install canonical `HSN1` bytes. Allocation is allowed here; `run_tick` never allocates.
     */
    set_neighborhood_rule(bytes: Uint8Array): void;
    state_ptr(): number;
    states(): number;
    transition_count_len(): number;
    transition_counts_ptr(): number;
}

/**
 * Counter-based Philox4x32-10 sample for one stochastic decision.
 *
 * Counter words are `[cell_index, stream_id, generation_lo, generation_hi]`; key words are the
 * low/high halves of `seed`. No mutable cursor exists, so skipping a cell or reordering rule rows
 * cannot shift any other cell's stream.
 */
export function random_u32(seed: bigint, generation: bigint, cell_index: number, stream_id: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly random_u32: (a: bigint, b: bigint, c: number, d: number) => number;
    readonly __wbg_worldstochastic_free: (a: number, b: number) => void;
    readonly worldstochastic_new: (a: number, b: number, c: bigint) => [number, number, number];
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
    readonly worldstochastic_reset: (a: number) => [number, number];
    readonly worldstochastic_run_tick: (a: number) => [number, number, number];
    readonly worldstochastic_compute_elapsed_ages: (a: number) => void;
    readonly worldstochastic_checksum_state: (a: number) => number;
    readonly worldstochastic_checksum_auxiliary: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
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
